import { create } from 'zustand';
import type { MergePhase, MergeResult, MergeRunResult } from '@/types';

interface LogEntry {
  id: string;
  tag: 'info' | 'ok' | 'warn';
  text: string;
  color: string;
  timestamp: string;
}

export interface TerminalEntry {
  id: string;
  cmd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  pending: boolean;
}

interface MergeState {
  phase: MergePhase;
  stage: number;
  logs: LogEntry[];
  termLog: TerminalEntry[];
  result: MergeResult | null;
  runResult: MergeRunResult | null;
  attempt: number;
  error: string | null;

  setPhase: (phase: MergePhase) => void;
  setStage: (stage: number) => void;
  appendLog: (entry: Omit<LogEntry, 'id' | 'timestamp' | 'color'> & { color?: string }) => void;
  appendTermCmd: (cmd: string) => string; // returns generated id
  resolveTermCmd: (id: string, stdout: string, stderr: string, exitCode: number) => void;
  setResult: (result: MergeResult) => void;
  setRunResult: (r: MergeRunResult, attempt: number) => void;
  setError: (error: string) => void;
  reset: () => void;
}

const initial = {
  phase: 'idle' as MergePhase,
  stage: 0,
  logs: [],
  termLog: [],
  result: null,
  runResult: null,
  attempt: 0,
  error: null,
};

export const useMergeStore = create<MergeState>()((set) => ({
  ...initial,

  setPhase: (phase) => set({ phase }),
  setStage: (stage) => set({ stage }),

  appendLog: (entry) =>
    set((s) => ({
      logs: [
        ...s.logs,
        {
          ...entry,
          color: entry.color ?? '#7D8590',
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date().toISOString(),
        },
      ],
    })),

  appendTermCmd: (cmd) => {
    const id = `t-${Date.now()}-${Math.random()}`;
    set((s) => ({
      termLog: [
        ...s.termLog,
        { id, cmd, stdout: '', stderr: '', exitCode: null, pending: true },
      ],
    }));
    return id;
  },

  resolveTermCmd: (id, stdout, stderr, exitCode) =>
    set((s) => ({
      termLog: s.termLog.map((e) =>
        e.id === id ? { ...e, stdout, stderr, exitCode, pending: false } : e,
      ),
    })),

  setResult: (result) => set({ result }),
  setRunResult: (runResult, attempt) => set({ runResult, attempt, phase: 'complete' }),
  setError: (error) => set({ error, phase: 'idle' }),
  reset: () => set(initial),
}));
