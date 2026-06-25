import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Download, Share2, CheckCircle, Circle, Loader2, FileText,
  GitMerge, AlertTriangle, ExternalLink, Github, Terminal,
  RotateCcw, XCircle,
} from 'lucide-react';
import { RoomHeader } from '@/components/shared/RoomHeader';
import { Button } from '@/components/ui/button';
import { useMergeStore } from '@/stores/mergeStore';
import { useRoomStore } from '@/stores/roomStore';
import { useTaskStore } from '@/stores/taskStore';
import { useUser } from '@/stores/authStore';
import { getSocket, connectSocket, emit, joinSocketRoom } from '@/lib/socket';
import { merge as mergeApi, auth as authApi } from '@/lib/api';
import { cn, copyToClipboard } from '@/lib/utils';

const STAGE_LABELS = [
  'Analyzing all codebases',
  'Resolving interface connections',
  'Fixing integration issues',
  'Running in integration sandbox',
];

const OP_COLORS: Record<string, string> = {
  added: '#3FB950', modified: '#4F8EF7', removed: '#F85149',
};
const OP_LABELS: Record<string, string> = {
  added: '+', modified: '~', removed: '-',
};

function RunResultBadge({ ok, exitCode }: { ok: boolean | null; exitCode?: number }) {
  if (ok === null || ok === undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ms-fg3 border border-ms-border rounded-full px-3 py-1">
        <Circle size={11} /> No entry point
      </span>
    );
  }
  return ok ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ms-green border border-ms-green/30 bg-ms-green/10 rounded-full px-3 py-1">
      <CheckCircle size={11} /> Ran successfully {exitCode === 124 ? '(server)' : `(exit ${exitCode})`}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ms-red border border-ms-red/30 bg-ms-red/10 rounded-full px-3 py-1">
      <XCircle size={11} /> Failed (exit {exitCode})
    </span>
  );
}

export default function MergePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { room, members } = useRoomStore();
  const { tasks } = useTaskStore();
  const branchCount = members.length || tasks.length;
  const user = useUser();
  const isLead = !!(user && room && user.id === room.leadId);

  const {
    phase, logs, termLog, result, runResult, attempt, error,
    setPhase, appendLog, appendTermCmd, resolveTermCmd,
    setResult, setRunResult, setError, reset,
  } = useMergeStore();

  const stage = Math.min(STAGE_LABELS.length - 1, Math.floor(logs.length / 2));

  const [copied, setCopied] = useState(false);
  const [reopening, setReopening] = useState(false);

  // GitHub push state
  const [ghRepo, setGhRepo] = useState('');
  const [ghBranch, setGhBranch] = useState('mosaic-merge');
  const [ghPushing, setGhPushing] = useState(false);
  const [ghResult, setGhResult] = useState<{ url: string; filesPushed: number } | null>(null);
  const [ghError, setGhError] = useState('');

  const logEndRef = useRef<HTMLDivElement>(null);
  const termEndRef = useRef<HTMLDivElement>(null);

  // Track in-flight terminal cmd id for integration sandbox
  const pendingTermRef = useRef<string | null>(null);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => { termEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [termLog]);

  useEffect(() => {
    if (!code) return;
    connectSocket();
    joinSocketRoom(code);
    useRoomStore.getState().fetchRoom(code);
    useTaskStore.getState().fetchTasks(code);
    mergeApi.result(code)
      .then((r) => {
        if (r.data?.mergedFiles && Object.keys(r.data.mergedFiles).length > 0) {
          setResult(r.data);
          if (r.data.runResult) {
            setRunResult(r.data.runResult, r.data.attempt ?? 1);
          }
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    connectSocket();
    const socket = getSocket();

    socket.on('merge_log_stream', (payload: Record<string, unknown>) => {
      const text = (payload.message ?? payload.text ?? '') as string;
      const rawTag = ((payload.tag ?? 'INFO') as string).toLowerCase();
      const tag = (rawTag === 'success' || rawTag === 'ok' ? 'ok'
        : rawTag === 'warn' || rawTag === 'warning' ? 'warn'
        : 'info') as 'info' | 'ok' | 'warn';
      if (text) appendLog({ tag, text });
      if (useMergeStore.getState().phase === 'idle') setPhase('merging');
    });

    socket.on('merge_terminal', (payload: Record<string, unknown>) => {
      const cmd = (payload.cmd ?? '') as string;
      const done = payload.done as boolean | undefined;

      if (!done) {
        // New command starting
        const id = appendTermCmd(cmd);
        pendingTermRef.current = id;
      } else if (pendingTermRef.current) {
        resolveTermCmd(
          pendingTermRef.current,
          (payload.stdout ?? '') as string,
          (payload.stderr ?? '') as string,
          (payload.exit_code ?? -1) as number,
        );
        pendingTermRef.current = null;
      }
    });

    socket.on('merge_complete', (payload: Record<string, unknown>) => {
      const rr = payload.run_result as import('@/types').MergeRunResult | undefined;
      const att = (payload.attempt ?? 1) as number;
      if (rr) setRunResult(rr, att);
      else setPhase('complete');

      // Fetch full result for diff/conflicts
      mergeApi.result(code!).then((r) => {
        setResult(r.data);
      }).catch(() => {});
    });

    socket.on('merge_error', (payload: { message?: string }) => {
      setError(payload.message ?? 'Merge failed. Please try again.');
    });

    socket.on('coding_reopened', () => {
      // Navigate all users back to the coding room
      navigate(`/rooms/${code}/code`);
    });

    return () => {
      socket.off('merge_log_stream');
      socket.off('merge_terminal');
      socket.off('merge_complete');
      socket.off('merge_error');
      socket.off('coding_reopened');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const handleStartMerge = () => {
    reset();
    setPhase('merging');
    emit('trigger_merge', { roomId: room?.id });
  };

  const handleReopenCoding = () => {
    setReopening(true);
    emit('reopen_coding', {});
    // navigation happens via coding_reopened socket event
  };

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

  return (
    <div className="min-h-screen bg-ms-base">
      <RoomHeader roomName={room?.name} code={code} crumb="Merge" live={false}>
        {phase === 'complete' && runResult?.ok && (
          <span className="text-[10px] font-bold text-ms-green border border-ms-green/30 bg-ms-green/10 rounded px-2 py-0.5 uppercase tracking-wider">
            Runs OK
          </span>
        )}
        {phase === 'complete' && runResult?.ok === false && (
          <span className="text-[10px] font-bold text-ms-red border border-ms-red/30 bg-ms-red/10 rounded px-2 py-0.5 uppercase tracking-wider">
            Run Failed
          </span>
        )}
        {attempt > 0 && (
          <span className="text-[10px] font-semibold text-ms-fg3 border border-ms-border rounded px-2 py-0.5">
            Attempt #{attempt}
          </span>
        )}
      </RoomHeader>

      <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-[1fr_300px] gap-8">
        {/* Main */}
        <div>
          {/* Header row */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight mb-1">Semantic merge</h1>
              <p className="text-sm text-ms-fg3">
                {phase === 'idle' && `${branchCount || 'All'} branch${branchCount !== 1 ? 'es' : ''} ready to merge`}
                {phase === 'merging' && `AI is reconciling ${branchCount || ''} branch${branchCount !== 1 ? 'es' : ''}…`}
                {phase === 'complete' && result && `${result.diffReport?.length ?? 0} files unified · ${result.conflicts?.length ?? 0} conflict${result.conflicts?.length !== 1 ? 's' : ''} auto-resolved`}
                {phase === 'complete' && !result && 'Merge complete'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {phase === 'idle' && isLead && (
                <Button size="lg" className="bg-ms-purple hover:bg-[#b585ff] text-white" onClick={handleStartMerge}>
                  <GitMerge size={16} /> Start merge
                </Button>
              )}
              {phase === 'idle' && !isLead && (
                <span className="text-xs text-ms-fg3">Waiting for the team lead…</span>
              )}
              {phase === 'complete' && isLead && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="border border-ms-amber/40 text-ms-amber hover:bg-ms-amber/10"
                  loading={reopening}
                  onClick={handleReopenCoding}
                >
                  <RotateCcw size={14} /> Reopen coding
                </Button>
              )}
              {phase === 'complete' && isLead && (
                <Button size="sm" className="bg-ms-purple hover:bg-[#b585ff] text-white" onClick={handleStartMerge}>
                  <GitMerge size={14} /> Re-merge
                </Button>
              )}
            </div>
          </div>

          {/* Stage cards */}
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

          {/* Error */}
          {phase === 'idle' && error && (
            <div className="rounded-xl border border-ms-red/40 bg-ms-red/5 p-4 mb-4 flex items-center gap-3">
              <AlertTriangle size={16} className="text-ms-red flex-none" />
              <span className="text-sm text-ms-red">{error}</span>
            </div>
          )}

          {/* Idle */}
          {phase === 'idle' && !error && (
            <div className="rounded-xl border border-ms-border bg-ms-surface p-8 text-center">
              <GitMerge size={32} className="text-ms-purple mx-auto mb-4" />
              <h3 className="font-bold text-lg mb-2">All {branchCount || ''} branch{branchCount !== 1 ? 'es' : ''} submitted</h3>
              <p className="text-sm text-ms-fg2 max-w-md mx-auto">
                Mosaic AI will review every file, resolve interface mismatches semantically,
                and produce a unified runnable codebase.
              </p>
            </div>
          )}

          {/* Merging spinner */}
          {phase === 'merging' && (
            <div className="rounded-xl border border-ms-purple/30 bg-ms-purple/5 p-8 text-center mb-6">
              <Loader2 size={32} className="text-ms-purple mx-auto mb-4 animate-ms-spin" />
              <h3 className="font-bold text-lg text-ms-purple mb-2">{STAGE_LABELS[stage]}…</h3>
              <p className="text-sm text-ms-fg2">Reconciling {branchCount || ''} branch{branchCount !== 1 ? 'es' : ''}</p>
            </div>
          )}

          {/* Integration sandbox terminal (visible while merging and after) */}
          {(phase === 'merging' || phase === 'complete') && termLog.length > 0 && (
            <div className="rounded-xl border border-ms-border bg-ms-surface overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-ms-subtle flex items-center gap-2">
                <Terminal size={13} className="text-ms-fg3" />
                <span className="text-xs font-bold uppercase tracking-wider text-ms-fg3">
                  Integration sandbox
                </span>
              </div>
              <div className="p-3 h-48 overflow-y-auto font-mono text-[11px] space-y-2 bg-[#0d1117]">
                {termLog.map((entry) => (
                  <div key={entry.id}>
                    <div className="flex items-center gap-2 text-[#58a6ff]">
                      <span className="opacity-50">$</span>
                      <span>{entry.cmd}</span>
                      {entry.pending && <Loader2 size={10} className="animate-ms-spin opacity-60" />}
                    </div>
                    {entry.stdout && (
                      <pre className="text-[#e6edf3] whitespace-pre-wrap mt-1 ml-4 leading-relaxed">
                        {entry.stdout.slice(0, 2000)}{entry.stdout.length > 2000 ? '\n…' : ''}
                      </pre>
                    )}
                    {entry.stderr && (
                      <pre className="text-[#f85149] whitespace-pre-wrap mt-0.5 ml-4 leading-relaxed">
                        {entry.stderr.slice(0, 1000)}{entry.stderr.length > 1000 ? '\n…' : ''}
                      </pre>
                    )}
                    {!entry.pending && (
                      <div className={cn(
                        'ml-4 text-[10px] mt-0.5',
                        entry.exitCode === 0 || entry.exitCode === 124 ? 'text-[#3fb950]' : 'text-[#f85149]'
                      )}>
                        exit {entry.exitCode}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={termEndRef} />
              </div>
            </div>
          )}

          {/* Run result */}
          {phase === 'complete' && runResult !== null && (
            <div className={cn(
              'rounded-xl border p-5 mb-6',
              runResult.ok
                ? 'border-ms-green/40 bg-ms-green/5'
                : runResult.ok === false
                ? 'border-ms-red/40 bg-ms-red/5'
                : 'border-ms-border bg-ms-surface'
            )}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold text-sm">Integration run result</span>
                <RunResultBadge ok={runResult.ok} exitCode={runResult.exit_code} />
              </div>
              {runResult.cmd && (
                <div className="font-mono text-xs text-ms-fg3 mb-2">$ {runResult.cmd}</div>
              )}
              {runResult.ok === false && isLead && (
                <p className="text-xs text-ms-fg2 mt-2">
                  The merged project didn't run cleanly. Use <strong>Reopen coding</strong> to send the team back to fix their tasks, then re-merge.
                </p>
              )}
              {runResult.ok && (
                <p className="text-xs text-ms-fg2 mt-2">
                  The merged project ran without errors. Download the ZIP or push to GitHub.
                </p>
              )}
              {runResult.error && (
                <pre className="text-xs text-ms-red mt-2 whitespace-pre-wrap">{runResult.error}</pre>
              )}
              {runResult.note && (
                <p className="text-xs text-ms-fg3 mt-2">{runResult.note}</p>
              )}
            </div>
          )}

          {/* Complete: conflict + diff report */}
          {phase === 'complete' && (
            <>
              {result?.conflicts && result.conflicts.length > 0 && (
                <div className="rounded-xl border border-ms-amber/30 bg-ms-amber/5 p-5 mb-6">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle size={16} className="text-ms-amber" />
                    <span className="font-bold text-ms-amber">{result.conflicts.length} conflict{result.conflicts.length !== 1 ? 's' : ''} auto-resolved</span>
                  </div>
                  <div className="space-y-3">
                    {result.conflicts.map((c) => (
                      <div key={c.id} className="flex gap-3">
                        <AlertTriangle size={14} className="text-ms-amber mt-0.5 flex-none" />
                        <div>
                          <div className="text-sm font-semibold mb-1">{c.description}</div>
                          <div className="text-xs text-ms-fg2 leading-relaxed">{c.resolution}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {result?.conflicts?.length === 0 && (
                <div className="rounded-xl border border-ms-green/40 bg-ms-green/5 p-5 mb-6 flex items-center gap-2">
                  <CheckCircle size={16} className="text-ms-green" />
                  <span className="font-bold text-ms-green">No conflicts — clean merge</span>
                </div>
              )}

              {result?.diffReport && result.diffReport.length > 0 && (
                <div className="rounded-xl border border-ms-border bg-ms-surface overflow-hidden">
                  <div className="px-4 py-3 border-b border-ms-subtle">
                    <span className="text-xs font-bold uppercase tracking-wider text-ms-fg3">
                      Merged file tree · {result.diffReport.length} changed
                    </span>
                  </div>
                  <div className="divide-y divide-ms-subtle">
                    {result.diffReport.map((f) => (
                      <div key={f.path} className="flex items-center gap-3 px-4 py-3 hover:bg-ms-raised transition-colors">
                        <span
                          className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-none"
                          style={{ background: `${OP_COLORS[f.operation]}20`, color: OP_COLORS[f.operation] }}
                        >
                          {OP_LABELS[f.operation]}
                        </span>
                        <FileText size={13} className="text-ms-fg3 flex-none" />
                        <span className="flex-1 font-mono text-sm text-ms-fg">{f.path}</span>
                        <span className="text-xs font-mono" style={{ color: OP_COLORS[f.operation] }}>
                          {f.operation === 'added' ? '+' : f.operation === 'removed' ? '-' : '~'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* GitHub push */}
          {phase === 'complete' && runResult?.ok && (
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
                    <a href={ghResult.url} target="_blank" rel="noreferrer"
                      className="text-xs text-ms-blue hover:underline inline-flex items-center gap-1">
                      View on GitHub <ExternalLink size={10} />
                    </a>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="text-[10px] font-semibold text-ms-fg3 uppercase tracking-wider block mb-1">Repository</label>
                      <input type="text" value={ghRepo} onChange={(e) => setGhRepo(e.target.value)}
                        placeholder="owner/repo"
                        className="w-full bg-ms-raised border border-ms-border rounded-lg px-3 py-1.5 text-xs text-ms-fg placeholder:text-ms-fg3 focus:outline-none focus:border-ms-blue" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-ms-fg3 uppercase tracking-wider block mb-1">Branch</label>
                      <input type="text" value={ghBranch} onChange={(e) => setGhBranch(e.target.value)}
                        placeholder="mosaic-merge"
                        className="w-full bg-ms-raised border border-ms-border rounded-lg px-3 py-1.5 text-xs text-ms-fg placeholder:text-ms-fg3 focus:outline-none focus:border-ms-blue" />
                    </div>
                    {ghError && <p className="text-xs text-ms-red">{ghError}</p>}
                    <Button className="w-full" size="sm" disabled={!ghRepo.trim() || ghPushing} loading={ghPushing} onClick={handleGitHubPush}>
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
              {logs.map((log, i) => (
                <div key={log.id ?? i} className="flex items-start gap-2">
                  <span style={{ color: log.color }}>
                    {log.tag === 'ok' ? '✓' : log.tag === 'warn' ? '⚐' : '▸'}
                  </span>
                  <span className="text-ms-fg2 leading-snug">{log.text}</span>
                </div>
              ))}
              {phase === 'merging' && logs.length === 0 && (
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
