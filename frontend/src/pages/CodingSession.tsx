import { useState, useEffect, useRef, useLayoutEffect, lazy, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, Check, ChevronRight, Send, Zap, Shield, TestTube,
  BookOpen, Clock, LogOut, Wrench, Eye, Bug,
} from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { Avatar } from '@/components/shared/Avatar';
import { Button } from '@/components/ui/button';
import { useTaskStore, useMyTask } from '@/stores/taskStore';
import { useRoomStore, useRoom } from '@/stores/roomStore';
import { useUser } from '@/stores/authStore';
import { getSocket, connectSocket, disconnectSocket, emit, joinSocketRoom } from '@/lib/socket';
import { cn } from '@/lib/utils';
import type { ChatMessage, AgentEventPayload, TerminalResultPayload } from '@/types';

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.default }))
);

// ── Constants ─────────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { icon: Zap,      label: 'Write boilerplate' },
  { icon: Shield,   label: 'Add error handling' },
  { icon: TestTube, label: 'Write tests' },
  { icon: BookOpen, label: 'Explain code' },
];

const AGENTS = [
  { id: 'builder',   name: 'Builder',   icon: Wrench,   color: '#4F8EF7', blurb: 'Writes & runs code in sandbox' },
  { id: 'reviewer',  name: 'Reviewer',  icon: Eye,      color: '#A371F7', blurb: 'Reviews & refactors' },
  { id: 'tester',    name: 'Tester',    icon: TestTube, color: '#3FB950', blurb: 'Writes & runs tests' },
  { id: 'debugger',  name: 'Debugger',  icon: Bug,      color: '#F85149', blurb: 'Finds & fixes bugs' },
  { id: 'explainer', name: 'Explainer', icon: BookOpen, color: '#D29922', blurb: 'Explains code' },
] as const;

// ── Types local to this file ──────────────────────────────────────────────────

interface TermEntry {
  id: number;
  step: number;
  cmd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  source: 'agent' | 'user';
}

// Compact in-chat agent event (thinking + non-terminal tool activity)
interface AgentChip {
  id: number;
  kind: 'thinking' | 'tool' | 'result';
  text: string;
  ok?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function guessLang(name: string) {
  if (name.endsWith('.py')) return 'python';
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'typescript';
  if (name.endsWith('.js') || name.endsWith('.jsx')) return 'javascript';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.md')) return 'markdown';
  if (name.endsWith('.sh')) return 'shell';
  if (name.endsWith('.html')) return 'html';
  if (name.endsWith('.css')) return 'css';
  return 'plaintext';
}

function toolLabel(name: string, args: Record<string, unknown> = {}) {
  switch (name) {
    case 'write_file':    return `write ${args.path ?? ''}`;
    case 'read_file':     return `read ${args.path ?? ''}`;
    case 'edit_file':     return `edit ${args.path ?? ''}`;
    case 'delete_file':   return `delete ${args.path ?? ''}`;
    case 'list_files':    return 'list_files';
    case 'task_complete': return '✓ task_complete';
    default:              return name;
  }
}

function fileResultText(name: string, result: Record<string, unknown>): { text: string; ok?: boolean } {
  if (name === 'write_file' || name === 'edit_file') {
    const ok = Boolean(result.ok);
    return { text: ok ? 'OK' : String(result.error ?? 'FAIL'), ok };
  }
  if (name === 'read_file') {
    const c = result.content as string | undefined;
    return { text: c ? `${c.length} chars` : '(empty)' };
  }
  if (name === 'list_files') {
    const f = result.files as unknown[] | undefined;
    return { text: f?.length ? `${f.length} entries` : '(empty)' };
  }
  return { text: JSON.stringify(result).slice(0, 80) };
}

// ── Mobile guard ──────────────────────────────────────────────────────────────

function MobileGuard() {
  return (
    <div className="ide-guard min-h-screen flex-col items-center justify-center p-8 text-center">
      <MosaicLogo size="lg" className="justify-center mb-8" />
      <h2 className="text-xl font-bold mb-3">Open on desktop to code</h2>
      <p className="text-ms-fg2 text-sm max-w-xs leading-relaxed">
        The Mosaic coding session requires a wide screen. Open this URL on a laptop or desktop to continue.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CodingSession() {
  const { code } = useParams<{ code: string }>();
  const navigate  = useNavigate();
  const myTask    = useMyTask();
  const room      = useRoom();
  const user      = useUser();
  const { chatMessages, addChatMessage, isChatStreaming, setIsChatStreaming, reset: resetTasks } = useTaskStore();
  const { members, myMemberId, reset: resetRoom } = useRoomStore();

  // ── Editor state ─────────────────────────────────────────────────────────
  const [editorCode, setEditorCode]   = useState<Record<string, string>>(myTask?.code ?? {});
  const [activeFile, setActiveFile]   = useState('');
  const [isBlocked, setIsBlocked]     = useState(false);
  const [input, setInput]             = useState('');
  const [timer, setTimer]             = useState(0);
  const [isMarking, setIsMarking]     = useState(false);
  const [submitted, setSubmitted]     = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>('builder');

  // ── Sandbox / agent session state ─────────────────────────────────────────
  const [sandboxActive, setSandboxActive] = useState(false);
  // Live chips shown in chat while agent is working (cleared on complete/error)
  const [agentChips, setAgentChips]       = useState<AgentChip[]>([]);
  // Terminal log (run_command entries only)
  const [termLog, setTermLog]             = useState<TermEntry[]>([]);
  const [termInput, setTermInput]         = useState('');
  const [termHistory, setTermHistory]     = useState<string[]>([]);
  const [termHistIdx, setTermHistIdx]     = useState(-1);

  const chatEndRef    = useRef<HTMLDivElement>(null);
  const termEndRef    = useRef<HTMLDivElement>(null);
  const termInputRef  = useRef<HTMLInputElement>(null);
  const chipIdRef     = useRef(0);
  const termIdRef     = useRef(0);
  const pendingAgentTermRef = useRef<{ id: number } | null>(null);

  const activeAgent = AGENTS.find((a) => a.id === selectedAgent) ?? AGENTS[0];

  const fileNames = Array.from(new Set([...(myTask?.files ?? []), ...Object.keys(editorCode)]));
  const taskFiles = fileNames.map((name) => ({ name, lang: guessLang(name) }));
  const currentCode = editorCode[activeFile] ?? '';

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useLayoutEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, agentChips]);
  useLayoutEffect(() => { termEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [termLog]);

  // ── Timer ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTimer((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Rehydrate room + tasks on mount ───────────────────────────────────────
  useEffect(() => {
    if (!code) return;
    connectSocket();
    (async () => {
      await useRoomStore.getState().fetchRoom(code);
      await useTaskStore.getState().fetchTasks(code);
      joinSocketRoom(code);
    })();
  }, [code]);

  // Seed editor from task when task loads
  useEffect(() => {
    if (!myTask) return;
    setEditorCode((prev) => (Object.keys(prev).length ? prev : (myTask.code ?? {})));
    setActiveFile((prev) => prev || myTask.files?.[0] || '');
  }, [myTask]);

  // ── Socket listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    connectSocket();
    const socket = getSocket();

    const onAgentEvent = (payload: AgentEventPayload) => {
      const step = payload.step ?? 0;

      // Update file mirror in editor
      if (payload.files) {
        setEditorCode(payload.files);
        const paths = Object.keys(payload.files);
        setActiveFile((prev) => (prev && payload.files![prev] !== undefined ? prev : paths[0] ?? prev));
      }

      switch (payload.type) {
        case 'sandbox_ready':
          setSandboxActive(true);
          break;

        case 'sandbox_destroyed':
          setSandboxActive(false);
          setAgentChips([]);
          break;

        case 'thinking':
          setAgentChips((prev) => [
            ...prev,
            { id: chipIdRef.current++, kind: 'thinking', text: payload.content ?? '' },
          ]);
          break;

        case 'tool_call':
          if (payload.tool_name === 'run_command') {
            const cmd = String(payload.tool_args?.cmd ?? '');
            const id = termIdRef.current++;
            pendingAgentTermRef.current = { id };
            setTermLog((prev) => [
              ...prev,
              { id, step, cmd, stdout: '', stderr: '', exitCode: null, source: 'agent' },
            ]);
          } else {
            setAgentChips((prev) => [
              ...prev,
              { id: chipIdRef.current++, kind: 'tool', text: toolLabel(payload.tool_name ?? '', payload.tool_args) },
            ]);
          }
          break;

        case 'tool_result':
          if (payload.tool_name === 'run_command') {
            const r = payload.tool_result ?? {};
            const ec = r.exit_code as number ?? -1;
            const stdout = (r.stdout as string | undefined)?.trimEnd() ?? '';
            const stderr = (r.stderr as string | undefined)?.trimEnd() ?? '';
            const pending = pendingAgentTermRef.current;
            if (pending) {
              setTermLog((prev) =>
                prev.map((e) => e.id === pending.id ? { ...e, stdout, stderr, exitCode: ec } : e),
              );
              pendingAgentTermRef.current = null;
            }
          } else {
            const { text, ok } = fileResultText(payload.tool_name ?? '', payload.tool_result ?? {});
            setAgentChips((prev) => [
              ...prev,
              { id: chipIdRef.current++, kind: 'result', text, ok },
            ]);
          }
          break;

        case 'complete': {
          const summary = payload.summary ?? 'Task complete.';
          addChatMessage({
            id: Date.now().toString(),
            role: 'assistant',
            content: `✓ ${summary}`,
            timestamp: new Date().toISOString(),
          });
          setAgentChips([]);
          setIsChatStreaming(false);
          break;
        }

        case 'error': {
          const errText = payload.error ?? 'An error occurred.';
          addChatMessage({
            id: Date.now().toString(),
            role: 'assistant',
            content: `Error: ${errText}`,
            timestamp: new Date().toISOString(),
          });
          setAgentChips([]);
          setIsChatStreaming(false);
          break;
        }
      }
    };

    const onTerminalResult = (payload: TerminalResultPayload) => {
      setTermLog((prev) => {
        const idx = [...prev].reverse().findIndex(
          (e) => e.source === 'user' && e.exitCode === null && e.cmd === payload.cmd,
        );
        if (idx === -1) return prev;
        const realIdx = prev.length - 1 - idx;
        return prev.map((e, i) =>
          i === realIdx
            ? { ...e, stdout: payload.stdout.trimEnd(), stderr: payload.stderr.trimEnd(), exitCode: payload.exit_code }
            : e,
        );
      });
    };

    socket.on('agent_event', onAgentEvent);
    socket.on('terminal_result', onTerminalResult);
    socket.on('all_tasks_done', () => navigate(`/rooms/${code}/merge`));

    return () => {
      socket.off('agent_event', onAgentEvent);
      socket.off('terminal_result', onTerminalResult);
      socket.off('all_tasks_done');
    };
  }, [addChatMessage, setIsChatStreaming, navigate, code]);

  // Destroy task sandbox on unmount
  useEffect(() => {
    return () => { emit('task_session_end', {}); };
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const formatTimer = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const sendMessage = (text: string) => {
    if (!text.trim() || isChatStreaming) return;
    addChatMessage({
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    });
    setInput('');
    setAgentChips([]);
    setIsChatStreaming(true);
    // Use the real sandbox agent loop — task context injected server-side
    emit('task_agent_prompt', { prompt: text, taskId: myTask?.id });
  };

  const handleLeave = () => {
    emit('task_session_end', {});
    disconnectSocket();
    resetRoom();
    resetTasks();
    navigate(user ? '/dashboard' : '/');
  };

  const handleMarkDone = () => {
    if (!myTask || submitted) return;
    setIsMarking(true);
    const submitCode = Object.keys(editorCode).length > 0
      ? editorCode
      : activeFile ? { [activeFile]: currentCode } : {};
    // End sandbox session first, then submit
    emit('task_session_end', {});
    emit('submit_task', { taskId: myTask.id, code: submitCode });
    emit('update_status', { status: 'done' });
    setSubmitted(true);
    setIsMarking(false);
  };

  // ── Terminal ───────────────────────────────────────────────────────────────
  const submitTermCmd = () => {
    const cmd = termInput.trim();
    if (!cmd || !sandboxActive) return;
    setTermHistory((prev) => (prev[0] === cmd ? prev : [cmd, ...prev].slice(0, 100)));
    setTermHistIdx(-1);
    setTermInput('');
    const id = termIdRef.current++;
    setTermLog((prev) => [...prev, { id, step: 0, cmd, stdout: '', stderr: '', exitCode: null, source: 'user' }]);
    emit('task_terminal_exec', { cmd });
  };

  const handleTermKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); submitTermCmd(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(termHistIdx + 1, termHistory.length - 1);
      setTermHistIdx(next);
      setTermInput(termHistory[next] ?? '');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (termHistIdx <= 0) { setTermHistIdx(-1); setTermInput(''); return; }
      const next = termHistIdx - 1;
      setTermHistIdx(next);
      setTermInput(termHistory[next] ?? '');
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const teammates = members
    .filter((m) => m.id !== myMemberId)
    .map((m) => ({ name: m.displayName, initials: m.initials, status: m.status, color: m.avatarColor }));

  const initialMessage: ChatMessage = {
    id: '0',
    role: 'assistant',
    content: myTask
      ? `Hi! I'm your AI pair programmer scoped to **${myTask.name}**.\n\nI have full context on your task, interface contracts, and sandbox. Ask me to build, test, debug, or explain anything — I'll write the code, run it, and verify it actually works.`
      : "Hi! I'm your AI pair programmer. Once you're assigned a task, I'll have full context. What would you like to build?",
    timestamp: new Date().toISOString(),
  };
  const displayMessages = chatMessages.length > 0 ? chatMessages : [initialMessage];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <MobileGuard />
      <div className="ide-layout h-screen flex flex-col bg-ms-deep overflow-hidden">
        {/* Top bar */}
        <div className="flex-none h-11 flex items-center px-4 gap-4 border-b border-ms-subtle bg-ms-surface">
          <MosaicLogo size="sm" />
          <span className="text-ms-fg3 text-sm">|</span>
          <span className="text-sm font-semibold">{room?.name ?? code}</span>
          <span className="text-[10px] font-mono text-ms-fg3">#{code}</span>
          <span className="text-ms-fg3">·</span>
          <span className="text-sm text-ms-blue font-semibold">{myTask?.name ?? 'No task assigned'}</span>

          {/* Sandbox indicator */}
          {sandboxActive && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-800/40">
              ● sandbox
            </span>
          )}

          {/* Teammate pills */}
          <div className="flex items-center gap-2 ml-4">
            {teammates.map((tm) => (
              <div key={tm.name} className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold"
                style={{
                  color: tm.status === 'done' ? '#A371F7' : tm.status === 'coding' ? '#3FB950' : '#D29922',
                  borderColor: tm.status === 'done' ? '#A371F730' : tm.status === 'coding' ? '#3FB95030' : '#D2992230',
                  background: tm.status === 'done' ? '#A371F710' : tm.status === 'coding' ? '#3FB95010' : '#D2992210',
                }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: tm.status === 'done' ? '#A371F7' : tm.status === 'coding' ? '#3FB950' : '#D29922' }} />
                {tm.name.split(' ')[0]}
              </div>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5 font-mono text-sm text-ms-fg3">
              <Clock size={12} />
              {formatTimer(timer)}
            </div>
            <button onClick={handleLeave} className="flex items-center gap-1.5 text-xs font-semibold text-ms-fg3 hover:text-ms-red transition-colors">
              <LogOut size={13} /> Leave
            </button>
            <Button size="sm" className="bg-ms-green hover:bg-[#56d364] text-white"
              loading={isMarking} disabled={submitted || !myTask} onClick={handleMarkDone}>
              <Check size={14} /> {submitted ? 'Waiting for team…' : 'Mark as Done'}
            </Button>
          </div>
        </div>

        {/* Blocked banner */}
        {isBlocked && (
          <div className="flex-none flex items-center gap-3 px-4 py-2 bg-ms-amber/10 border-b border-ms-amber/30 text-ms-amber text-sm">
            <AlertTriangle size={14} />
            <span className="font-semibold">You marked yourself as blocked.</span>
            <span className="text-ms-amber/80">Team has been notified.</span>
            <button onClick={() => setIsBlocked(false)} className="ml-auto text-ms-amber/60 hover:text-ms-amber text-lg leading-none">×</button>
          </div>
        )}

        {/* 3-column layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* ── Left panel ── */}
          <div className="w-56 flex-none border-r border-ms-subtle bg-ms-surface flex flex-col overflow-y-auto">
            <div className="p-3 border-b border-ms-subtle">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ background: myTask?.color ?? '#3FB950' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3">Your task</span>
              </div>
              <div className="text-sm font-bold text-ms-fg">{myTask?.name ?? 'Task'}</div>
              <div className="text-[11px] text-ms-fg3 mt-1 leading-relaxed">{myTask?.description ?? 'Code your assigned task.'}</div>
            </div>

            <div className="p-2 border-b border-ms-subtle flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 px-1 mb-2">Files</p>
              {taskFiles.length > 0 ? taskFiles.map((f) => (
                <button key={f.name} onClick={() => setActiveFile(f.name)}
                  className={cn('w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[12px] font-mono transition-colors',
                    activeFile === f.name ? 'bg-ms-blue/20 text-ms-blue' : 'text-ms-fg3 hover:text-ms-fg hover:bg-ms-raised')}>
                  <ChevronRight size={10} className={activeFile === f.name ? 'rotate-90' : ''} />
                  {f.name}
                </button>
              )) : <p className="text-[10px] text-ms-fg3 px-2 py-1">No files yet</p>}
            </div>

            <div className="p-2 border-b border-ms-subtle">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 px-1 mb-2">Exposes</p>
              <div className="space-y-1">
                {myTask?.exposes?.length ? myTask.exposes.map((c) => (
                  <div key={c.signature} className="text-[10px] font-mono px-2 py-1 rounded bg-ms-deep border border-ms-subtle text-ms-green">{c.signature}</div>
                )) : <p className="text-[10px] text-ms-fg3 px-2 py-1">None</p>}
              </div>
              {myTask?.dependsOn?.length ? (
                <>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 px-1 mt-3 mb-2">Needs</p>
                  <div className="space-y-1">
                    {myTask.dependsOn.map((c) => (
                      <div key={c.signature} className="text-[10px] font-mono px-2 py-1 rounded bg-ms-deep border border-ms-subtle text-ms-blue">{c.signature}</div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            <div className="p-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 px-1 mb-2">Team</p>
              {teammates.length > 0 ? teammates.map((tm) => (
                <div key={tm.name} className="flex items-center gap-2 px-1 py-1.5">
                  <Avatar name={tm.name} size="xs" color={tm.color} status={tm.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-ms-fg truncate">{tm.name.split(' ')[0]}</div>
                    <div className="text-[10px] text-ms-fg3 capitalize truncate">{tm.status}</div>
                  </div>
                </div>
              )) : <p className="text-[10px] text-ms-fg3 px-2 py-1">No teammates yet</p>}
              <button
                onClick={() => { setIsBlocked((b) => !b); emit('update_status', { status: isBlocked ? 'coding' : 'blocked' }); }}
                className={cn('w-full mt-2 py-1.5 rounded text-[11px] font-semibold border transition-colors',
                  isBlocked ? 'border-ms-amber/40 bg-ms-amber/10 text-ms-amber' : 'border-ms-border text-ms-fg3 hover:text-ms-amber hover:border-ms-amber/40 hover:bg-ms-amber/5')}>
                {isBlocked ? '✓ Blocked (undo)' : "I'm Blocked"}
              </button>
            </div>
          </div>

          {/* ── Center: Monaco + Terminal ── */}
          <div className="flex-1 flex flex-col min-w-0 bg-ms-deep">
            {/* Tab bar */}
            <div className="flex-none flex items-center border-b border-ms-subtle bg-ms-surface h-9">
              {taskFiles.map((f) => (
                <button key={f.name} onClick={() => setActiveFile(f.name)}
                  className={cn('px-4 h-full text-xs font-mono border-r border-ms-subtle transition-colors',
                    activeFile === f.name ? 'bg-ms-deep text-ms-fg border-t-2 border-t-ms-blue' : 'text-ms-fg3 hover:text-ms-fg hover:bg-ms-raised')}>
                  {f.name}
                </button>
              ))}
            </div>

            {/* Monaco editor */}
            <div className="flex-1 overflow-hidden min-h-0">
              <Suspense fallback={<div className="h-full flex items-center justify-center"><div className="text-ms-fg3 text-sm font-mono animate-ms-pulse">Loading editor…</div></div>}>
                <MonacoEditor
                  height="100%"
                  language={taskFiles.find((f) => f.name === activeFile)?.lang ?? 'plaintext'}
                  value={currentCode}
                  onChange={(val) => setEditorCode((prev) => ({ ...prev, [activeFile]: val ?? '' }))}
                  theme="vs-dark"
                  options={{
                    fontSize: 13,
                    fontFamily: '"JetBrains Mono", Menlo, monospace',
                    fontLigatures: true,
                    lineNumbers: 'on',
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    automaticLayout: true,
                    padding: { top: 12 },
                  }}
                />
              </Suspense>
            </div>

            {/* Status bar */}
            <div className="flex-none h-6 flex items-center px-4 gap-4 bg-ms-blue text-white text-[10px] font-mono">
              <span className="capitalize">{taskFiles.find((f) => f.name === activeFile)?.lang ?? 'plaintext'}</span>
              <span>·</span><span>UTF-8</span><span>·</span><span>LF</span>
              <span className="ml-auto">{activeFile}</span>
            </div>

            {/* Terminal panel */}
            <div className="flex-none h-44 border-t border-ms-subtle bg-[#0a0a0a] flex flex-col font-mono">
              <div className="flex items-center gap-2 px-3 py-1 border-b border-white/10 bg-[#111] shrink-0">
                <span className="text-[10px] uppercase tracking-widest text-gray-600">Terminal</span>
                <div className="flex items-center gap-2 ml-auto text-[9px] text-gray-600">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500 opacity-70 inline-block" />agent</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 opacity-70 inline-block" />you</span>
                </div>
                {!sandboxActive && <span className="text-[9px] text-gray-600">no sandbox</span>}
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2 cursor-text text-xs"
                onClick={() => termInputRef.current?.focus()}>
                {termLog.length === 0 && (
                  <span className="text-gray-600 text-[11px]">Command output will appear here as the agent works</span>
                )}
                {termLog.map((e) => <TermBlock key={e.id} entry={e} />)}
                <div ref={termEndRef} />
              </div>
              <div className="flex items-center gap-2 px-2 py-1.5 border-t border-white/10 shrink-0">
                <span className={`text-xs shrink-0 ${sandboxActive ? 'text-emerald-400' : 'text-gray-600'}`}>❯</span>
                <input
                  ref={termInputRef}
                  type="text"
                  value={termInput}
                  onChange={(e) => { setTermInput(e.target.value); setTermHistIdx(-1); }}
                  onKeyDown={handleTermKeyDown}
                  disabled={!sandboxActive}
                  placeholder={sandboxActive ? 'Type a command… (↑↓ history)' : 'Waiting for sandbox…'}
                  className="flex-1 bg-transparent border-none outline-none text-xs text-gray-100 placeholder-gray-600 disabled:opacity-40"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
          </div>

          {/* ── Right: AI chat ── */}
          <div className="w-72 flex-none border-l border-ms-subtle bg-ms-surface flex flex-col">
            {/* Header + agent picker */}
            <div className="flex-none px-3 py-3 border-b border-ms-subtle">
              <div className="flex items-center gap-2 px-1 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3">AI agents</span>
                <span className="ml-auto text-[10px] text-ms-green font-semibold">● Live</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {AGENTS.map((a) => {
                  const selected = a.id === selectedAgent;
                  return (
                    <button key={a.id} onClick={() => setSelectedAgent(a.id)} title={a.blurb}
                      className={cn('flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-semibold whitespace-nowrap transition-all',
                        selected ? 'text-white' : 'text-ms-fg3 border-ms-border hover:text-ms-fg')}
                      style={selected ? { background: a.color, borderColor: a.color } : undefined}>
                      <a.icon size={11} />{a.name}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 px-1 text-[10px] text-ms-fg3">
                <span className="font-semibold" style={{ color: activeAgent.color }}>{activeAgent.name}</span>
                {' · '}{activeAgent.blurb}
                {myTask ? ` · ${myTask.name}` : ' · no task'}
              </div>
            </div>

            {/* Messages + live agent chips */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {displayMessages.map((msg) => (
                <div key={msg.id} className={cn('flex gap-2', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                  {msg.role === 'assistant' && (
                    <div className="w-5 h-5 rounded bg-ms-purple/20 flex items-center justify-center flex-none mt-0.5">
                      <span className="text-ms-purple text-[8px] font-bold">AI</span>
                    </div>
                  )}
                  <div className={cn('max-w-[85%] rounded-xl p-3 text-xs leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-ms-blue/20 text-ms-fg border border-ms-blue/20'
                      : 'bg-ms-raised border border-ms-border text-ms-fg2')}>
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Live agent working chips (current turn only) */}
              {agentChips.length > 0 && (
                <div className="space-y-1 pl-7">
                  {agentChips.map((chip) => (
                    <div key={chip.id} className={cn('text-[10px] font-mono px-2 py-0.5 rounded',
                      chip.kind === 'thinking' ? 'text-gray-500 italic' :
                      chip.kind === 'tool' ? 'text-yellow-600 bg-yellow-950/20' :
                      chip.ok === false ? 'text-red-400 bg-red-950/20' :
                      chip.ok === true ? 'text-green-500 bg-green-950/20' :
                      'text-gray-500')}>
                      {chip.kind === 'tool' && '→ '}{chip.text}
                    </div>
                  ))}
                  <div className="flex items-center gap-1 pl-1">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-1 h-1 rounded-full bg-ms-purple animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Quick actions + input */}
            <div className="flex-none px-3 py-2 border-t border-ms-subtle">
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_ACTIONS.map((a) => (
                  <button key={a.label} onClick={() => setInput(a.label)}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-ms-border bg-ms-raised text-[10px] text-ms-fg3 hover:text-ms-fg hover:border-ms-border transition-colors">
                    <a.icon size={10} />{a.label}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                  placeholder={isChatStreaming ? 'Agent is working…' : 'Ask AI to write, run, test, debug…'}
                  rows={2}
                  disabled={isChatStreaming}
                  className="flex-1 bg-ms-raised border border-ms-border rounded-lg px-3 py-2 text-xs text-ms-fg placeholder:text-ms-fg3 resize-none focus:outline-none focus:ring-1 focus:ring-ms-blue disabled:opacity-60"
                />
                <button onClick={() => sendMessage(input)} disabled={!input.trim() || isChatStreaming}
                  className="w-8 h-8 rounded-lg bg-ms-blue disabled:opacity-40 flex items-center justify-center flex-none hover:bg-[#6B9EF8] transition-colors">
                  <Send size={13} className="text-white" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Terminal block ────────────────────────────────────────────────────────────

function TermBlock({ entry }: { entry: TermEntry }) {
  const isRunning = entry.exitCode === null;
  const exitOk    = entry.exitCode === 0;
  const isUser    = entry.source === 'user';
  return (
    <div className="space-y-0.5 select-text">
      <div className="flex items-start gap-1.5">
        <span className={`shrink-0 text-[11px] ${isUser ? 'text-emerald-400' : 'text-indigo-400'}`}>$</span>
        <span className="text-gray-200 text-[11px] whitespace-pre-wrap break-all flex-1">{entry.cmd}</span>
        <span className={cn('shrink-0 text-[9px] px-1 rounded-sm font-medium', isUser ? 'bg-emerald-900/50 text-emerald-500' : 'bg-indigo-900/50 text-indigo-400')}>
          {isUser ? 'you' : 'agent'}
        </span>
        {isRunning && <span className="text-yellow-500 text-[10px] animate-pulse shrink-0">…</span>}
      </div>
      {entry.stdout && <pre className="text-gray-300 text-[10px] whitespace-pre-wrap break-all pl-3 leading-relaxed">{entry.stdout}</pre>}
      {entry.stderr && <pre className="text-yellow-600/80 text-[10px] whitespace-pre-wrap break-all pl-3 leading-relaxed">{entry.stderr}</pre>}
      {!isRunning && (
        <div className={`pl-3 text-[9px] font-semibold ${exitOk ? 'text-green-500' : 'text-red-400'}`}>
          exit {entry.exitCode}
        </div>
      )}
    </div>
  );
}
