import { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import type { AgentEventPayload } from '@/types';

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
  exitCode: number | null; // null = still running
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
  const [instruction, setInstruction] = useState('');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [termLog, setTermLog] = useState<TermEntry[]>([]);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const logEndRef  = useRef<HTMLDivElement>(null);
  const termEndRef = useRef<HTMLDivElement>(null);
  const logIdRef   = useRef(0);
  const termIdRef  = useRef(0);

  // Pending run_command: cmd string waiting for its result
  const pendingCmdRef = useRef<{ id: number; cmd: string } | null>(null);

  const addLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLog(prev => [...prev, { id: logIdRef.current++, ...entry }]);
  }, []);

  // Auto-scroll both panels
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [log]);
  useEffect(() => { termEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [termLog]);

  // Pick first file when files change and nothing selected
  useEffect(() => {
    const keys = Object.keys(files);
    if (keys.length > 0 && (activeFile === null || !files[activeFile])) {
      setActiveFile(keys[0]);
    }
  }, [files, activeFile]);

  useEffect(() => {
    const socket = connectSocket();

    const onEvent = (payload: AgentEventPayload) => {
      const step = payload.step ?? 0;

      if (payload.files) setFiles(payload.files);

      switch (payload.type) {
        case 'sandbox_ready':
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
            pendingCmdRef.current = { id, cmd };
            setTermLog(prev => [...prev, { id, step, cmd, stdout: '', stderr: '', exitCode: null }]);
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
            const pending = pendingCmdRef.current;
            if (pending !== null) {
              setTermLog(prev => prev.map(e =>
                e.id === pending.id ? { ...e, stdout, stderr, exitCode: ec } : e
              ));
              pendingCmdRef.current = null;
            }
          } else {
            const { text, ok } = fileResultSummary(payload.tool_name ?? '', payload.tool_result ?? {});
            addLog({ type: 'tool_result', step, text, ok });
          }
          break;

        case 'complete':
          addLog({ type: 'complete', step, text: payload.summary ?? 'Done' });
          setRunning(false);
          break;

        case 'error':
          addLog({ type: 'error', step, text: payload.error ?? 'Unknown error' });
          setRunning(false);
          break;

        case 'sandbox_destroyed':
          addLog({ type: 'info', step, text: 'Sandbox destroyed' });
          setRunning(false);
          break;
      }
    };

    socket.on('agent_event', onEvent);
    return () => {
      socket.off('agent_event', onEvent);
      disconnectSocket();
    };
  }, [addLog]);

  const handleRun = () => {
    if (!instruction.trim() || running) return;
    setLog([]);
    setTermLog([]);
    setFiles({});
    setActiveFile(null);
    pendingCmdRef.current = null;
    setRunning(true);
    getSocket().emit('agent_run', { instruction: instruction.trim() });
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

        {/* Right: file editor */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Top: Monaco */}
          <div className="flex flex-col flex-1 min-h-0 border-b border-white/10">
            {/* File tabs */}
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

            {/* Editor */}
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

          {/* Bottom: terminal */}
          <div className="flex flex-col h-[220px] shrink-0 bg-[#0a0a0a]">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/10 bg-[#111] shrink-0">
              <PanelLabel>Terminal</PanelLabel>
              {running && termLog.some(e => e.exitCode === null) && (
                <span className="text-xs text-yellow-500 ml-1 animate-pulse">running…</span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {termLog.length === 0 && (
                <span className="text-gray-600 text-xs">Command output will appear here</span>
              )}
              {termLog.map(entry => <TermBlock key={entry.id} entry={entry} />)}
              <div ref={termEndRef} />
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

  return (
    <div className="space-y-0.5 select-text">
      {/* Command line */}
      <div className="flex items-start gap-1.5">
        <span className="text-indigo-400 shrink-0">$</span>
        <span className="text-gray-200 text-xs whitespace-pre-wrap break-all">{entry.cmd}</span>
        {isRunning && <span className="text-yellow-500 text-[10px] ml-1 animate-pulse shrink-0">…</span>}
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
