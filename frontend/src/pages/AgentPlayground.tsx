import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import Editor from '@monaco-editor/react';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import type { AgentEventPayload, TerminalResultPayload } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: number;
  type: AgentEventPayload['type'] | 'info';
  step: number;
  text: string;
  ok?: boolean;
}

interface TermEntry {
  id: number;
  step: number;
  cmd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null; // null = pending
  source: 'agent' | 'user';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toolLabel(name: string, args: Record<string, unknown> = {}): string {
  switch (name) {
    case 'write_file':    return `write   ${args.path ?? ''}`;
    case 'read_file':     return `read    ${args.path ?? ''}`;
    case 'edit_file':     return `edit    ${args.path ?? ''}`;
    case 'delete_file':   return `delete  ${args.path ?? ''}`;
    case 'list_files':    return 'list_files';
    case 'task_complete': return `✓ task_complete`;
    default:              return name;
  }
}

function fileResultSummary(name: string, result: Record<string, unknown>): { text: string; ok?: boolean } {
  if (name === 'write_file' || name === 'edit_file') {
    const ok = Boolean(result.ok);
    return { text: ok ? 'OK' : String(result.error ?? 'FAIL'), ok };
  }
  if (name === 'read_file') {
    const content = result.content as string | undefined;
    return { text: content ? `${content.length} chars` : '(empty)' };
  }
  if (name === 'list_files') {
    const files = result.files as string[] | undefined;
    return { text: files?.join('  ') ?? '(none)' };
  }
  return { text: JSON.stringify(result).slice(0, 120) };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentPlayground() {
  const [instruction, setInstruction]   = useState('');
  const [running, setRunning]           = useState(false);
  const [sandboxActive, setSandboxActive] = useState(false);
  const [log, setLog]                   = useState<LogEntry[]>([]);
  const [termLog, setTermLog]           = useState<TermEntry[]>([]);
  const [files, setFiles]               = useState<Record<string, string>>({});
  const [activeFile, setActiveFile]     = useState<string | null>(null);
  const [cmdInput, setCmdInput]         = useState('');
  const [cmdHistory, setCmdHistory]     = useState<string[]>([]);
  const [histIdx, setHistIdx]           = useState(-1);   // -1 = not browsing

  const logEndRef    = useRef<HTMLDivElement>(null);
  const termEndRef   = useRef<HTMLDivElement>(null);
  const cmdInputRef  = useRef<HTMLInputElement>(null);
  const logIdRef     = useRef(0);
  const termIdRef    = useRef(0);

  // Pending agent run_command: waiting for its tool_result
  const pendingAgentCmdRef = useRef<{ id: number; cmd: string } | null>(null);

  const addLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLog(prev => [...prev, { id: logIdRef.current++, ...entry }]);
  }, []);

  // Auto-scroll both panels
  useLayoutEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [log]);
  useLayoutEffect(() => { termEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [termLog]);

  // Pick first file when files change and nothing selected
  useEffect(() => {
    const keys = Object.keys(files);
    if (keys.length > 0 && (activeFile === null || !files[activeFile])) {
      setActiveFile(keys[0]);
    }
  }, [files, activeFile]);

  useEffect(() => {
    const socket = connectSocket();

    const onAgentEvent = (payload: AgentEventPayload) => {
      const step = payload.step ?? 0;

      if (payload.files) setFiles(payload.files);

      switch (payload.type) {
        case 'sandbox_ready':
          setSandboxActive(true);
          addLog({ type: 'info', step, text: `Sandbox ready (${payload.sandbox_id ?? ''})` });
          break;

        case 'step':
          addLog({ type: 'step', step, text: `── Step ${step + 1} ──` });
          break;

        case 'thinking':
          addLog({ type: 'thinking', step, text: payload.content ?? '' });
          break;

        case 'tool_call':
          if (payload.tool_name === 'run_command') {
            const cmd = String(payload.tool_args?.cmd ?? '');
            const id = termIdRef.current++;
            pendingAgentCmdRef.current = { id, cmd };
            setTermLog(prev => [...prev, { id, step, cmd, stdout: '', stderr: '', exitCode: null, source: 'agent' }]);
          } else {
            addLog({ type: 'tool_call', step, text: toolLabel(payload.tool_name ?? '', payload.tool_args) });
          }
          break;

        case 'tool_result':
          if (payload.tool_name === 'run_command') {
            const r = payload.tool_result ?? {};
            const ec = r.exit_code as number ?? -1;
            const stdout = (r.stdout as string | undefined)?.trimEnd() ?? '';
            const stderr = (r.stderr as string | undefined)?.trimEnd() ?? '';
            const pending = pendingAgentCmdRef.current;
            if (pending !== null) {
              setTermLog(prev => prev.map(e =>
                e.id === pending.id ? { ...e, stdout, stderr, exitCode: ec } : e,
              ));
              pendingAgentCmdRef.current = null;
            }
          } else {
            const { text, ok } = fileResultSummary(payload.tool_name ?? '', payload.tool_result ?? {});
            addLog({ type: 'tool_result', step, text, ok });
          }
          break;

        case 'complete':
          addLog({ type: 'complete', step, text: payload.summary ?? 'Done' });
          setRunning(false);
          // Keep sandbox active — user can still run commands until a new session
          break;

        case 'error':
          addLog({ type: 'error', step, text: payload.error ?? 'Unknown error' });
          setRunning(false);
          break;

        case 'sandbox_destroyed':
          addLog({ type: 'info', step, text: 'Sandbox destroyed' });
          setSandboxActive(false);
          setRunning(false);
          break;
      }
    };

    const onTerminalResult = (payload: TerminalResultPayload) => {
      setTermLog(prev => {
        // Find the most recent pending user entry and resolve it
        const idx = [...prev].reverse().findIndex(e => e.source === 'user' && e.exitCode === null && e.cmd === payload.cmd);
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
    return () => {
      socket.off('agent_event', onAgentEvent);
      socket.off('terminal_result', onTerminalResult);
      disconnectSocket();
    };
  }, [addLog]);

  const handleRun = () => {
    if (!instruction.trim() || running) return;
    setLog([]);
    setTermLog([]);
    setFiles({});
    setActiveFile(null);
    setSandboxActive(false);
    pendingAgentCmdRef.current = null;
    setRunning(true);
    getSocket().emit('agent_run', { instruction: instruction.trim() });
  };

  const submitCmd = () => {
    const cmd = cmdInput.trim();
    if (!cmd || !sandboxActive) return;

    // Add to history (deduplicate consecutive same command)
    setCmdHistory(prev => (prev[0] === cmd ? prev : [cmd, ...prev].slice(0, 100)));
    setHistIdx(-1);
    setCmdInput('');

    // Optimistically add a pending entry
    const id = termIdRef.current++;
    setTermLog(prev => [...prev, { id, step: 0, cmd, stdout: '', stderr: '', exitCode: null, source: 'user' }]);

    getSocket().emit('terminal_exec', { cmd });
  };

  const handleCmdKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCmd();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(histIdx + 1, cmdHistory.length - 1);
      setHistIdx(next);
      setCmdInput(cmdHistory[next] ?? '');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx <= 0) { setHistIdx(-1); setCmdInput(''); return; }
      const next = histIdx - 1;
      setHistIdx(next);
      setCmdInput(cmdHistory[next] ?? '');
      return;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#0d0d0d] text-gray-200 font-mono text-sm select-none">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/10 bg-[#111] shrink-0">
        <span className="text-white font-semibold tracking-wide">Agent Playground</span>
        <span className="text-xs text-gray-500 ml-auto">sandbox · single task</span>
      </div>

      {/* Instruction bar */}
      <div className="flex gap-2 px-4 py-2.5 border-b border-white/10 bg-[#111] shrink-0">
        <textarea
          className="flex-1 resize-none rounded bg-[#1a1a1a] border border-white/10 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 min-h-[52px] select-text"
          placeholder="Describe what to build… e.g. 'Create a FastAPI /health endpoint and verify it responds'"
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRun(); }}
          disabled={running}
        />
        <button
          onClick={handleRun}
          disabled={!instruction.trim() || running}
          className="px-5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium self-end mb-0.5 h-9 transition-colors"
        >
          {running ? 'Running…' : 'Run'}
        </button>
      </div>

      {/* Top row: reasoning log | Monaco editor */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: agent reasoning + file ops */}
        <div className="w-[340px] shrink-0 flex flex-col border-r border-white/10 overflow-y-auto p-2.5 gap-0.5">
          <PanelLabel>Agent</PanelLabel>
          {log.length === 0 && !running && (
            <div className="text-gray-600 text-xs mt-6 text-center">Reasoning will appear here</div>
          )}
          {log.map(entry => <LogLine key={entry.id} entry={entry} />)}
          <div ref={logEndRef} />
        </div>

        {/* Right column: Monaco + Terminal */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Monaco */}
          <div className="flex flex-col flex-1 min-h-0 border-b border-white/10">
            <div className="flex overflow-x-auto border-b border-white/10 bg-[#111] shrink-0 min-h-[34px]">
              <PanelLabel className="border-r border-white/10 pr-3">Files</PanelLabel>
              {Object.keys(files).map(path => (
                <button
                  key={path}
                  onClick={() => setActiveFile(path)}
                  className={`px-3 py-1.5 text-xs whitespace-nowrap border-r border-white/10 transition-colors ${
                    activeFile === path
                      ? 'bg-[#1e1e1e] text-indigo-400'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a]'
                  }`}
                >
                  {path.split('/').pop()}
                </button>
              ))}
              {Object.keys(files).length === 0 && (
                <span className="px-3 py-1.5 text-xs text-gray-600 self-center">No files yet</span>
              )}
            </div>
            <div className="flex-1 min-h-0">
              {activeFile && files[activeFile] !== undefined ? (
                <Editor
                  height="100%"
                  path={activeFile}
                  value={files[activeFile]}
                  language={guessLanguage(activeFile)}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    scrollBeyondLastLine: false,
                    renderLineHighlight: 'none',
                    lineNumbers: 'on',
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-600 text-xs">
                  {Object.keys(files).length === 0
                    ? 'Files will appear here as the agent writes them'
                    : 'Select a file'}
                </div>
              )}
            </div>
          </div>

          {/* Terminal */}
          <div className="flex flex-col h-[240px] shrink-0 bg-[#0a0a0a]">
            {/* Terminal header */}
            <div className="flex items-center gap-3 px-3 py-1.5 border-b border-white/10 bg-[#111] shrink-0">
              <PanelLabel>Terminal</PanelLabel>
              <div className="flex items-center gap-2 ml-auto text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 opacity-70" />
                  <span className="text-gray-600">agent</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 opacity-70" />
                  <span className="text-gray-600">you</span>
                </span>
              </div>
              {!sandboxActive && (
                <span className="text-[10px] text-gray-600 ml-2">no sandbox</span>
              )}
            </div>

            {/* Output area */}
            <div
              className="flex-1 overflow-y-auto p-3 space-y-3 cursor-text"
              onClick={() => cmdInputRef.current?.focus()}
            >
              {termLog.length === 0 && (
                <span className="text-gray-600 text-xs">Command output will appear here</span>
              )}
              {termLog.map(entry => <TermBlock key={entry.id} entry={entry} />)}
              <div ref={termEndRef} />
            </div>

            {/* Command input */}
            <div className="flex items-center gap-2 px-3 py-2 border-t border-white/10 shrink-0">
              <span className={`text-xs shrink-0 ${sandboxActive ? 'text-emerald-400' : 'text-gray-600'}`}>❯</span>
              <input
                ref={cmdInputRef}
                type="text"
                value={cmdInput}
                onChange={e => { setCmdInput(e.target.value); setHistIdx(-1); }}
                onKeyDown={handleCmdKeyDown}
                disabled={!sandboxActive}
                placeholder={sandboxActive ? 'Type a command… (↑↓ history)' : 'Waiting for sandbox…'}
                className="flex-1 bg-transparent border-none outline-none text-xs text-gray-100 placeholder-gray-600 disabled:opacity-40 select-text"
                autoComplete="off"
                spellCheck={false}
              />
              {sandboxActive && cmdInput.trim() && (
                <button
                  onClick={submitCmd}
                  className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors px-1"
                  tabIndex={-1}
                >
                  Enter
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PanelLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`text-[10px] uppercase tracking-widest text-gray-600 px-1 py-1 shrink-0 ${className}`}>
      {children}
    </span>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const base = 'px-2 py-0.5 rounded text-xs leading-relaxed whitespace-pre-wrap break-all select-text';

  switch (entry.type) {
    case 'step':
      return <div className={`${base} text-gray-600 mt-2 text-[10px]`}>{entry.text}</div>;
    case 'thinking':
      return <div className={`${base} text-gray-400 italic`}>{entry.text}</div>;
    case 'tool_call':
      return <div className={`${base} text-yellow-400`}>→ {entry.text}</div>;
    case 'tool_result': {
      const color = entry.ok === false ? 'text-red-400' : entry.ok === true ? 'text-green-400' : 'text-gray-400';
      return <div className={`${base} ${color} ml-3`}>{entry.text}</div>;
    }
    case 'complete':
      return (
        <div className={`${base} text-green-300 font-semibold mt-2 border border-green-800 bg-green-950/30 px-3 py-1.5`}>
          ✓ {entry.text}
        </div>
      );
    case 'error':
      return (
        <div className={`${base} text-red-300 border border-red-800 bg-red-950/30 px-3 py-1.5`}>
          ✗ {entry.text}
        </div>
      );
    case 'info':
      return <div className={`${base} text-gray-600 text-[10px]`}>{entry.text}</div>;
    default:
      return null;
  }
}

function TermBlock({ entry }: { entry: TermEntry }) {
  const isRunning = entry.exitCode === null;
  const exitOk    = entry.exitCode === 0;
  const isUser    = entry.source === 'user';

  return (
    <div className="space-y-0.5 select-text">
      {/* Command line */}
      <div className="flex items-start gap-1.5">
        <span className={`shrink-0 text-xs ${isUser ? 'text-emerald-400' : 'text-indigo-400'}`}>$</span>
        <span className="text-gray-200 text-xs whitespace-pre-wrap break-all flex-1">{entry.cmd}</span>
        <span
          title={isUser ? 'you' : 'agent'}
          className={`shrink-0 text-[9px] px-1 py-0 rounded-sm self-center font-medium ${
            isUser
              ? 'bg-emerald-900/50 text-emerald-500'
              : 'bg-indigo-900/50 text-indigo-400'
          }`}
        >
          {isUser ? 'you' : 'agent'}
        </span>
        {isRunning && <span className="text-yellow-500 text-[10px] animate-pulse shrink-0">…</span>}
      </div>

      {/* stdout */}
      {entry.stdout && (
        <pre className="text-gray-300 text-xs whitespace-pre-wrap break-all pl-4 leading-relaxed">
          {entry.stdout}
        </pre>
      )}

      {/* stderr */}
      {entry.stderr && (
        <pre className="text-yellow-600/80 text-xs whitespace-pre-wrap break-all pl-4 leading-relaxed">
          {entry.stderr}
        </pre>
      )}

      {/* Exit code */}
      {!isRunning && (
        <div className={`pl-4 text-[10px] font-semibold ${exitOk ? 'text-green-500' : 'text-red-400'}`}>
          exit {entry.exitCode}
        </div>
      )}
    </div>
  );
}

// ── Language detection ────────────────────────────────────────────────────────

function guessLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    py: 'python', js: 'javascript', ts: 'typescript',
    tsx: 'typescript', jsx: 'javascript', json: 'json',
    md: 'markdown', sh: 'shell', bash: 'shell',
    html: 'html', css: 'css', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', txt: 'plaintext',
  };
  return map[ext] ?? 'plaintext';
}
