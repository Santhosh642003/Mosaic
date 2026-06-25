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
  exitCode?: number;
  ok?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toolLabel(name: string, args: Record<string, unknown> = {}): string {
  switch (name) {
    case 'run_command':   return `$ ${args.cmd ?? ''}`;
    case 'write_file':    return `write  ${args.path ?? ''}`;
    case 'read_file':     return `read   ${args.path ?? ''}`;
    case 'edit_file':     return `edit   ${args.path ?? ''}`;
    case 'delete_file':   return `delete ${args.path ?? ''}`;
    case 'list_files':    return 'list_files';
    case 'task_complete': return `✓ task_complete`;
    default:              return name;
  }
}

function resultSummary(name: string, result: Record<string, unknown>): { text: string; exitCode?: number; ok?: boolean } {
  if (name === 'run_command') {
    const ec = result.exit_code as number | undefined;
    const stdout = (result.stdout as string | undefined)?.trim() ?? '';
    const stderr = (result.stderr as string | undefined)?.trim() ?? '';
    const out = [stdout, stderr].filter(Boolean).join('\n');
    return { text: out ? out : '(no output)', exitCode: ec };
  }
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
    return { text: files?.join(', ') ?? '(none)' };
  }
  return { text: JSON.stringify(result).slice(0, 120) };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentPlayground() {
  const [instruction, setInstruction] = useState('');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logIdRef = useRef(0);

  const addLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLog(prev => [...prev, { id: logIdRef.current++, ...entry }]);
  }, []);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

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

      if (payload.files) {
        setFiles(payload.files);
      }

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
          addLog({ type: 'tool_call', step, text: toolLabel(payload.tool_name ?? '', payload.tool_args) });
          break;
        case 'tool_result': {
          const { text, exitCode, ok } = resultSummary(payload.tool_name ?? '', payload.tool_result ?? {});
          addLog({ type: 'tool_result', step, text, exitCode, ok });
          break;
        }
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
    setFiles({});
    setActiveFile(null);
    setRunning(true);
    const socket = getSocket();
    socket.emit('agent_run', { instruction: instruction.trim() });
  };

  return (
    <div className="flex flex-col h-screen bg-[#0d0d0d] text-gray-200 font-mono text-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-[#111]">
        <span className="text-white font-semibold tracking-wide">Agent Playground</span>
        <span className="text-xs text-gray-500 ml-auto">sandbox · single task</span>
      </div>

      {/* Instruction bar */}
      <div className="flex gap-2 px-4 py-3 border-b border-white/10 bg-[#111]">
        <textarea
          className="flex-1 resize-none rounded bg-[#1a1a1a] border border-white/10 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 min-h-[60px]"
          placeholder="Describe what to build… e.g. 'Create a FastAPI /health endpoint and verify it responds'"
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRun(); }}
          disabled={running}
        />
        <button
          onClick={handleRun}
          disabled={!instruction.trim() || running}
          className="px-5 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium self-end transition-colors"
        >
          {running ? 'Running…' : 'Run'}
        </button>
      </div>

      {/* Main split */}
      <div className="flex flex-1 overflow-hidden">
        {/* Event log */}
        <div className="w-1/2 flex flex-col border-r border-white/10 overflow-y-auto p-3 gap-0.5">
          {log.length === 0 && !running && (
            <div className="text-gray-600 text-xs mt-4 text-center">Enter an instruction and click Run</div>
          )}
          {log.map(entry => <LogLine key={entry.id} entry={entry} />)}
          <div ref={logEndRef} />
        </div>

        {/* File viewer */}
        <div className="w-1/2 flex flex-col">
          {/* File tabs */}
          <div className="flex gap-0 overflow-x-auto border-b border-white/10 bg-[#111] min-h-[36px]">
            {Object.keys(files).map(path => (
              <button
                key={path}
                onClick={() => setActiveFile(path)}
                className={`px-3 py-2 text-xs whitespace-nowrap border-r border-white/10 transition-colors ${
                  activeFile === path
                    ? 'bg-[#1e1e1e] text-indigo-400'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a]'
                }`}
              >
                {path.split('/').pop()}
              </button>
            ))}
            {Object.keys(files).length === 0 && (
              <span className="px-3 py-2 text-xs text-gray-600">No files yet</span>
            )}
          </div>

          {/* Monaco editor */}
          <div className="flex-1">
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
      </div>
    </div>
  );
}

// ── Log line ──────────────────────────────────────────────────────────────────

function LogLine({ entry }: { entry: LogEntry }) {
  const base = 'px-2 py-0.5 rounded text-xs leading-relaxed whitespace-pre-wrap break-all';

  switch (entry.type) {
    case 'step':
      return <div className={`${base} text-gray-500 mt-2`}>{entry.text}</div>;
    case 'thinking':
      return <div className={`${base} text-gray-400 italic ml-2`}>{entry.text}</div>;
    case 'tool_call':
      return <div className={`${base} text-yellow-400`}>→ {entry.text}</div>;
    case 'tool_result': {
      const color =
        entry.exitCode !== undefined
          ? entry.exitCode === 0 ? 'text-green-400' : 'text-red-400'
          : entry.ok === false ? 'text-red-400'
          : entry.ok === true ? 'text-green-400'
          : 'text-gray-400';
      const prefix = entry.exitCode !== undefined ? `[${entry.exitCode}] ` : '';
      return <div className={`${base} ${color} ml-4`}>{prefix}{entry.text}</div>;
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
      return <div className={`${base} text-gray-600`}>{entry.text}</div>;
    default:
      return null;
  }
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
