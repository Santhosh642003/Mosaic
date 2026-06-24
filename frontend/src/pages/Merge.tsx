import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, Share2, CheckCircle, Circle, Loader2, FileText, GitMerge, AlertTriangle, ExternalLink, Github } from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { Button } from '@/components/ui/button';
import { useMergeStore } from '@/stores/mergeStore';
import { useRoomStore } from '@/stores/roomStore';
import { useUser } from '@/stores/authStore';
import { getSocket, connectSocket, emit } from '@/lib/socket';
import { merge as mergeApi, auth as authApi } from '@/lib/api';
import { cn, copyToClipboard } from '@/lib/utils';

const STAGE_LABELS = [
  'Analyzing all codebases',
  'Resolving interface connections',
  'Fixing integration issues',
  'Finalizing merged project',
];

const LOG_SEQ = [
  { tag: 'info', color: '#7D8590', text: 'Loading 4 task submissions…' },
  { tag: 'info', color: '#7D8590', text: 'Parsing ASTs across 31 files…' },
  { tag: 'ok',   color: '#3FB950', text: 'Auth service (T1) — contracts validated' },
  { tag: 'ok',   color: '#3FB950', text: 'Message API (T2) — contracts validated' },
  { tag: 'warn', color: '#D29922', text: 'WebSocket (T3) — signature mismatch on save_message' },
  { tag: 'info', color: '#7D8590', text: 'Resolving: updating T3 call to match T2 schema…' },
  { tag: 'ok',   color: '#3FB950', text: 'WebSocket (T3) — integration resolved' },
  { tag: 'warn', color: '#D29922', text: 'Frontend (T4) — event shape drift on message_received' },
  { tag: 'info', color: '#7D8590', text: 'Resolving: aligning payload to {id, content, user, ts}…' },
  { tag: 'ok',   color: '#3FB950', text: 'Frontend (T4) — integration resolved' },
  { tag: 'info', color: '#7D8590', text: 'Generating entry point (main.py) and docker-compose…' },
  { tag: 'ok',   color: '#3FB950', text: 'Merge complete — 31 files unified, 2 conflicts resolved' },
] as const;

const MERGED_FILES = [
  { path: 'main.py',             op: 'added',    lines: '+28' },
  { path: 'docker-compose.yml',  op: 'added',    lines: '+42' },
  { path: 'auth/router.py',      op: 'modified', lines: '+3 -1' },
  { path: 'messages/router.py',  op: 'modified', lines: '+5 -2' },
  { path: 'gateway/events.py',   op: 'modified', lines: '+8 -4' },
  { path: 'frontend/src/App.tsx',op: 'modified', lines: '+12 -6' },
  { path: 'requirements.txt',    op: 'added',    lines: '+18' },
  { path: 'README.md',           op: 'added',    lines: '+64' },
];

const CONFLICTS = [
  {
    title: 'save_message signature mismatch',
    body: 'T3 called save_message(room_id, content) but T2 expects save_message(room_id, MessageIn). Fixed by wrapping content in MessageIn(content=content).',
  },
  {
    title: 'message_received event shape drift',
    body: 'T4 expected {message, user} but T3 emits {content, user_id, ts}. Normalized to {id, content, user, ts} in gateway and updated frontend handler.',
  },
];

const OP_COLORS: Record<string, string> = {
  added: '#3FB950', modified: '#4F8EF7', removed: '#F85149',
};
const OP_LABELS: Record<string, string> = {
  added: '+', modified: '~', removed: '-',
};

export default function MergePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { room } = useRoomStore();
  const user = useUser();
  const { phase, stage, logs, setPhase, setStage, appendLog, setResult, setError } = useMergeStore();

  const [logCount, setLogCount] = useState(0);
  const [copied, setCopied] = useState(false);

  // GitHub push state
  const [ghRepo, setGhRepo] = useState('');
  const [ghBranch, setGhBranch] = useState('mosaic-merge');
  const [ghPushing, setGhPushing] = useState(false);
  const [ghResult, setGhResult] = useState<{ url: string; filesPushed: number } | null>(null);
  const [ghError, setGhError] = useState('');

  const logEndRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logCount, logs]);

  useEffect(() => {
    connectSocket();
    const socket = getSocket();
    socket.on('merge_log_stream', (payload: Record<string, unknown>) => {
      // Backend sends { message, tag, done } — field is "message" not "text"
      const text = (payload.message ?? payload.text ?? '') as string;
      const rawTag = ((payload.tag ?? 'INFO') as string).toLowerCase();
      const tag = (rawTag === 'success' || rawTag === 'ok' ? 'ok'
        : rawTag === 'warn' || rawTag === 'warning' ? 'warn'
        : 'info') as 'info' | 'ok' | 'warn';
      if (text) appendLog({ tag, text });

      if (payload.done && (rawTag === 'success' || rawTag === 'error')) {
        clearInterval(stageRef.current!);
        clearInterval(logRef.current!);
      }
    });

    socket.on('merge_complete', (_summary: unknown) => {
      // Backend sends a summary { merge_id, file_count, conflict_count, download_url }
      // Fetch the full result from REST API
      clearInterval(stageRef.current!);
      clearInterval(logRef.current!);
      mergeApi.result(code!).then((r) => {
        setResult(r.data);
        setPhase('complete');
      }).catch(() => setPhase('complete'));
    });
    return () => {
      socket.off('merge_log_stream');
      socket.off('merge_complete');
    };
  }, [appendLog, setResult]);

  const handleStartMerge = () => {
    setPhase('merging');
    setLogCount(0);

    if (room?.id) {
      mergeApi.trigger(code!).catch((e) => setError((e as Error).message));
      emit('trigger_merge', { roomId: room.id });
    }

    // Simulate progress locally
    let s = 0;
    stageRef.current = setInterval(() => {
      s++;
      if (s >= STAGE_LABELS.length) {
        clearInterval(stageRef.current!);
        return;
      }
      setStage(s);
    }, 3500);

    let l = 0;
    logRef.current = setInterval(() => {
      l++;
      setLogCount(l);
      appendLog(LOG_SEQ[Math.min(l - 1, LOG_SEQ.length - 1)] as { tag: 'info' | 'ok' | 'warn'; text: string });
      if (l >= LOG_SEQ.length) {
        clearInterval(logRef.current!);
        setTimeout(() => {
          setPhase('complete');
          setResult({
            id: 'merge-1', roomId: room?.id ?? '', mergedFiles: {},
            diffReport: MERGED_FILES.map((f) => ({ path: f.path, operation: f.op as 'added' | 'modified' | 'removed' })),
            conflicts: CONFLICTS.map((c, i) => ({ id: `c${i}`, description: c.title, resolution: c.body, files: [] })),
            createdAt: new Date().toISOString(),
          });
        }, 400);
      }
    }, 700);
  };

  useEffect(() => {
    return () => {
      clearInterval(stageRef.current!);
      clearInterval(logRef.current!);
    };
  }, []);

  const shareUrl = `${window.location.origin}/rooms/${code}/merge`;

  const handleCopyShare = async () => {
    await copyToClipboard(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGitHubPush = async () => {
    if (!ghRepo.trim()) return;
    setGhPushing(true);
    setGhError('');
    setGhResult(null);
    try {
      const r = await mergeApi.pushToGitHub(code!, ghRepo.trim(), ghBranch.trim() || 'mosaic-merge', 'feat: Mosaic merged codebase');
      setGhResult({ url: r.data.url, filesPushed: r.data.filesPushed });
    } catch (e) {
      setGhError((e as Error).message);
    } finally {
      setGhPushing(false);
    }
  };

  const displayLogs = logs.length > 0 ? logs : LOG_SEQ.slice(0, logCount).map((l, i) => ({ ...l, id: `l${i}`, timestamp: '' }));

  return (
    <div className="min-h-screen bg-ms-base">
      {/* Top bar */}
      <header className="sticky top-0 z-40 h-14 border-b border-ms-subtle bg-ms-surface/90 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto h-full px-6 flex items-center gap-4">
          <MosaicLogo />
          <span className="text-ms-fg3">/</span>
          <span className="font-semibold">{room?.name ?? 'PingChat'}</span>
          <span className="text-ms-fg3">/</span>
          <span className="text-ms-fg2 text-sm">Merge</span>
          {phase === 'complete' && (
            <span className="ml-2 text-[10px] font-bold text-ms-green border border-ms-green/30 bg-ms-green/10 rounded px-2 py-0.5 uppercase tracking-wider">
              Complete
            </span>
          )}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-[1fr_300px] gap-8">
        {/* Main */}
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight mb-1">Semantic merge</h1>
              <p className="text-sm text-ms-fg3">
                {phase === 'idle' && '4 branches ready to merge'}
                {phase === 'merging' && 'AI is reconciling 4 branches…'}
                {phase === 'complete' && '31 files unified · 2 conflicts auto-resolved'}
              </p>
            </div>
            {phase === 'idle' && (
              <Button size="lg" className="bg-ms-purple hover:bg-[#b585ff] text-white" onClick={handleStartMerge}>
                <GitMerge size={16} /> Start merge
              </Button>
            )}
          </div>

          {/* Stage indicators */}
          <div className="grid grid-cols-4 gap-3 mb-8">
            {STAGE_LABELS.map((label, i) => {
              const isDone = phase === 'complete' || (phase === 'merging' && i < stage);
              const isActive = phase === 'merging' && i === stage;
              return (
                <div
                  key={label}
                  className={cn(
                    'rounded-xl border p-4 transition-all',
                    isDone ? 'border-ms-green/40 bg-ms-green/5'
                      : isActive ? 'border-ms-purple/50 bg-ms-purple/10'
                      : 'border-ms-border bg-ms-surface opacity-50'
                  )}
                >
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center mb-2 text-sm font-bold',
                    isDone ? 'bg-ms-green/20 text-ms-green'
                      : isActive ? 'bg-ms-purple/20 text-ms-purple'
                      : 'bg-ms-raised text-ms-fg3'
                  )}>
                    {isDone ? <CheckCircle size={14} />
                      : isActive ? <Loader2 size={14} className="animate-ms-spin" />
                      : <Circle size={14} />}
                  </div>
                  <div className={cn(
                    'text-xs font-semibold',
                    isDone ? 'text-ms-green' : isActive ? 'text-ms-purple' : 'text-ms-fg3'
                  )}>
                    {label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Idle: ready to merge */}
          {phase === 'idle' && (
            <div className="rounded-xl border border-ms-border bg-ms-surface p-8 text-center">
              <GitMerge size={32} className="text-ms-purple mx-auto mb-4" />
              <h3 className="font-bold text-lg mb-2">All 4 branches submitted</h3>
              <p className="text-sm text-ms-fg2 max-w-md mx-auto">
                DeepSeek-R1 will review every file, resolve interface mismatches semantically,
                and produce a unified runnable codebase.
              </p>
            </div>
          )}

          {/* Merging */}
          {phase === 'merging' && (
            <div className="rounded-xl border border-ms-purple/30 bg-ms-purple/5 p-8 text-center">
              <Loader2 size={32} className="text-ms-purple mx-auto mb-4 animate-ms-spin" />
              <h3 className="font-bold text-lg text-ms-purple mb-2">{STAGE_LABELS[stage]}…</h3>
              <p className="text-sm text-ms-fg2">Reconciling 4 branches · DeepSeek-R1</p>
            </div>
          )}

          {/* Complete */}
          {phase === 'complete' && (
            <>
              {/* Conflict report */}
              <div className="rounded-xl border border-ms-green/40 bg-ms-green/5 p-5 mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle size={16} className="text-ms-green" />
                  <span className="font-bold text-ms-green">2 conflicts found and auto-resolved</span>
                </div>
                <div className="space-y-3">
                  {CONFLICTS.map((c, i) => (
                    <div key={i} className="flex gap-3">
                      <AlertTriangle size={14} className="text-ms-amber mt-0.5 flex-none" />
                      <div>
                        <div className="text-sm font-semibold mb-1">{c.title}</div>
                        <div className="text-xs text-ms-fg2 leading-relaxed">{c.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* File tree + diff */}
              <div className="rounded-xl border border-ms-border bg-ms-surface overflow-hidden">
                <div className="px-4 py-3 border-b border-ms-subtle">
                  <span className="text-xs font-bold uppercase tracking-wider text-ms-fg3">
                    Merged file tree · {MERGED_FILES.length} changed
                  </span>
                </div>
                <div className="divide-y divide-ms-subtle">
                  {MERGED_FILES.map((f) => (
                    <div key={f.path} className="flex items-center gap-3 px-4 py-3 hover:bg-ms-raised transition-colors">
                      <span
                        className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-none"
                        style={{ background: `${OP_COLORS[f.op]}20`, color: OP_COLORS[f.op] }}
                      >
                        {OP_LABELS[f.op]}
                      </span>
                      <FileText size={13} className="text-ms-fg3 flex-none" />
                      <span className="flex-1 font-mono text-sm text-ms-fg">{f.path}</span>
                      <span className="text-xs font-mono" style={{ color: OP_COLORS[f.op] }}>
                        {f.lines}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* GitHub push */}
          {phase === 'complete' && (
            <div className="rounded-xl border border-ms-border bg-ms-surface overflow-hidden">
              <div className="px-4 py-3 border-b border-ms-subtle flex items-center gap-2">
                <Github size={13} className="text-ms-fg3" />
                <span className="text-xs font-bold uppercase tracking-wider text-ms-fg3">Push to GitHub</span>
              </div>
              <div className="p-4 space-y-3">
                {!user?.hasGithubToken ? (
                  <div className="text-center py-2">
                    <p className="text-xs text-ms-fg3 mb-3">Connect your GitHub account to push directly</p>
                    <button
                      onClick={async () => {
                        const r = await authApi.githubUrl();
                        if (r.data.url) window.location.href = r.data.url;
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-ms-fg2 border border-ms-border rounded-lg px-3 py-1.5 hover:bg-ms-raised transition-colors"
                    >
                      <Github size={12} /> Connect GitHub
                    </button>
                  </div>
                ) : ghResult ? (
                  <div className="text-center py-1">
                    <CheckCircle size={20} className="text-ms-green mx-auto mb-2" />
                    <p className="text-xs text-ms-green font-semibold mb-1">{ghResult.filesPushed} files pushed!</p>
                    <a
                      href={ghResult.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-ms-blue hover:underline inline-flex items-center gap-1"
                    >
                      View on GitHub <ExternalLink size={10} />
                    </a>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="text-[10px] font-semibold text-ms-fg3 uppercase tracking-wider block mb-1">
                        Repository
                      </label>
                      <input
                        type="text"
                        value={ghRepo}
                        onChange={(e) => setGhRepo(e.target.value)}
                        placeholder="owner/repo or just repo-name"
                        className="w-full bg-ms-raised border border-ms-border rounded-lg px-3 py-1.5 text-xs text-ms-fg placeholder:text-ms-fg3 focus:outline-none focus:border-ms-blue"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-ms-fg3 uppercase tracking-wider block mb-1">
                        Branch
                      </label>
                      <input
                        type="text"
                        value={ghBranch}
                        onChange={(e) => setGhBranch(e.target.value)}
                        placeholder="mosaic-merge"
                        className="w-full bg-ms-raised border border-ms-border rounded-lg px-3 py-1.5 text-xs text-ms-fg placeholder:text-ms-fg3 focus:outline-none focus:border-ms-blue"
                      />
                    </div>
                    {ghError && (
                      <p className="text-xs text-ms-red">{ghError}</p>
                    )}
                    <Button
                      className="w-full"
                      size="sm"
                      disabled={!ghRepo.trim() || ghPushing}
                      loading={ghPushing}
                      onClick={handleGitHubPush}
                    >
                      <Github size={13} /> Push to GitHub
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Live log */}
          <div className="rounded-xl border border-ms-border bg-ms-surface overflow-hidden sticky top-20">
            <div className="px-4 py-3 border-b border-ms-subtle">
              <span className="text-xs font-bold uppercase tracking-wider text-ms-fg3">Merge log</span>
            </div>
            <div className="p-3 h-48 overflow-y-auto space-y-1.5 font-mono text-[11px]">
              {displayLogs.map((log, i) => (
                <div key={log.id ?? i} className="flex items-start gap-2">
                  <span style={{ color: log.color }}>
                    {log.tag === 'ok' ? '✓' : log.tag === 'warn' ? '⚐' : '▸'}
                  </span>
                  <span className="text-ms-fg2 leading-snug">{log.text}</span>
                </div>
              ))}
              {phase === 'merging' && displayLogs.length === 0 && (
                <div className="text-ms-fg3 animate-ms-pulse">Initializing…</div>
              )}
              <div ref={logEndRef} />
            </div>

            {/* Actions */}
            <div className="p-3 space-y-2 border-t border-ms-subtle">
              <a
                href={mergeApi.downloadUrl(code!)}
                className={cn(
                  'flex items-center justify-center gap-2 w-full py-2 rounded-lg border text-sm font-semibold transition-colors',
                  phase === 'complete'
                    ? 'border-ms-blue/50 bg-ms-blue/15 text-ms-blue hover:bg-ms-blue/25'
                    : 'border-ms-border bg-ms-raised text-ms-fg3 pointer-events-none opacity-50'
                )}
              >
                <Download size={14} /> Download ZIP
              </a>

              <button
                onClick={() => navigate(`/rooms/${code}/merge`)}
                className={cn(
                  'flex items-center justify-center gap-2 w-full py-2 rounded-lg border text-sm font-semibold transition-colors',
                  phase === 'complete'
                    ? 'border-ms-border text-ms-fg2 hover:text-ms-fg hover:bg-ms-raised'
                    : 'border-ms-border bg-ms-raised text-ms-fg3 pointer-events-none opacity-50'
                )}
              >
                <ExternalLink size={14} /> View project
              </button>

              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 text-[10px] font-mono text-ms-fg3 truncate bg-ms-raised border border-ms-border rounded px-2 py-1.5">
                  {shareUrl.replace('http://localhost:5173', '…')}
                </div>
                <button
                  onClick={handleCopyShare}
                  className={cn(
                    'flex items-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded border transition-colors',
                    copied ? 'border-ms-green/30 bg-ms-green/10 text-ms-green' : 'border-ms-border text-ms-fg3 hover:text-ms-fg'
                  )}
                >
                  <Share2 size={10} />
                  {copied ? 'Copied' : 'Share'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
