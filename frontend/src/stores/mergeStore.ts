import { create } from 'zustand';
import type { MergePhase, MergeResult } from '@/types';

interface LogEntry {
  id: string;
  tag: 'info' | 'ok' | 'warn';
  text: string;
  color: string;
  timestamp: string;
}

interface MergeState {
  phase: MergePhase;
  stage: number; // 0 = Analyzing, 1 = Resolving, 2 = Fixing, 3 = Finalizing
  logs: LogEntry[];
  result: MergeResult | null;
  error: string | null;

  setPhase: (phase: MergePhase) => void;
  setStage: (stage: number) => void;
  appendLog: (entry: Omit<LogEntry, 'id' | 'timestamp' | 'color'> & { color?: string }) => void;
  setResult: (result: MergeResult) => void;
  setError: (error: string) => void;
  reset: () => void;
}

const initial = {
  phase: 'idle' as MergePhase,
  stage: 0,
  logs: [],
  result: null,
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

  setResult: (result) => set({ result, phase: 'complete' }),
  setError: (error) => set({ error, phase: 'failed' }),
  reset: () => set(initial),
}));
