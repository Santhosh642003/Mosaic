import { create } from 'zustand';
import type { Task, TaskStatus, Complexity, ChatMessage } from '@/types';
import { tasks as tasksApi } from '@/lib/api';
import { useRoomStore } from '@/stores/roomStore';

/**
 * Normalize a raw task object into the canonical `Task` shape, regardless of
 * whether it came from the socket (snake_case, LLM field names like `name` /
 * `provided_by`) or the HTTP API (camelCased by the axios interceptor).
 *
 * This is the single source of truth for task shape — every code path that
 * loads tasks MUST go through it, otherwise contracts render blank and
 * complexity badges break depending on which path delivered the data.
 */
export function normalizeTask(raw: Record<string, unknown>): Task {
  const cap = (c: string): Complexity => {
    const s = (c || 'medium').toString();
    return (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()) as Complexity;
  };

  const assignedTo = (raw.assigned_to ?? raw.assignedTo) as string | undefined;

  // Enrich assignee display name — the HTTP TaskResponse doesn't include it,
  // so resolve from the room roster by member id.
  let assigneeName = (raw.assignee_name ?? raw.assigneeName) as string | undefined;
  if (!assigneeName && assignedTo) {
    const member = useRoomStore.getState().members.find((m) => m.id === assignedTo);
    assigneeName = member?.displayName;
  }

  return {
    id: raw.id as string,
    roomId: (raw.room_id ?? raw.roomId ?? '') as string,
    name: (raw.name ?? '') as string,
    description: (raw.description ?? '') as string,
    tech: (raw.tech ?? '') as string,
    complexity: cap((raw.complexity ?? 'medium') as string),
    color: (raw.color ?? '#4F8EF7') as string,
    files: (raw.files ?? []) as string[],
    exposes: ((raw.exposes ?? []) as Record<string, unknown>[]).map((e) => ({
      signature: (e.signature ?? e.name ?? '') as string,
      description: (e.description ?? '') as string,
    })),
    dependsOn: ((raw.depends_on ?? raw.dependsOn ?? []) as Record<string, unknown>[]).map((d) => ({
      signature: (d.signature ?? d.name ?? '') as string,
      taskId: (d.task_id ?? d.taskId ?? d.provided_by ?? d.providedBy ?? '') as string,
    })),
    assignedTo,
    assigneeName,
    suggestedAssignee: (raw.suggested_assignee ?? raw.suggestedAssignee) as string | undefined,
    status: (raw.status ?? 'unassigned') as TaskStatus,
    code: (raw.code ?? {}) as Record<string, string>,
  };
}

interface TaskState {
  tasks: Task[];
  myTaskId: string | null;
  decompositionChunks: string[];
  isDecomposing: boolean;
  chatMessages: ChatMessage[];
  isChatStreaming: boolean;
  isLoading: boolean;
  error: string | null;

  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, patch: Partial<Task>) => void;
  setTaskStatus: (taskId: string, status: TaskStatus) => void;
  setMyTaskId: (id: string | null) => void;

  appendDecompositionChunk: (chunk: string) => void;
  setIsDecomposing: (v: boolean) => void;
  clearDecompositionChunks: () => void;

  addChatMessage: (msg: ChatMessage) => void;
  appendChatChunk: (chunk: string) => void;
  finalizeChatStream: () => void;
  setIsChatStreaming: (v: boolean) => void;

  fetchTasks: (roomCode: string) => Promise<void>;
  assignTask: (roomCode: string, taskId: string) => Promise<void>;
  reset: () => void;
}

const initial = {
  tasks: [],
  myTaskId: null,
  decompositionChunks: [],
  isDecomposing: false,
  chatMessages: [],
  isChatStreaming: false,
  isLoading: false,
  error: null,
};

export const useTaskStore = create<TaskState>()((set, _get) => ({
  ...initial,

  setTasks: (tasks) => set({ tasks }),

  addTask: (task) =>
    set((s) => ({
      tasks: s.tasks.some((t) => t.id === task.id) ? s.tasks : [...s.tasks, task],
    })),

  updateTask: (taskId, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    })),

  setTaskStatus: (taskId, status) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)),
    })),

  setMyTaskId: (id) => set({ myTaskId: id }),

  appendDecompositionChunk: (chunk) =>
    set((s) => ({ decompositionChunks: [...s.decompositionChunks, chunk] })),

  setIsDecomposing: (v) => set({ isDecomposing: v }),
  clearDecompositionChunks: () => set({ decompositionChunks: [] }),

  addChatMessage: (msg) =>
    set((s) => ({ chatMessages: [...s.chatMessages, msg] })),

  appendChatChunk: (chunk) =>
    set((s) => {
      const msgs = [...s.chatMessages];
      const last = msgs[msgs.length - 1];
      if (last?.streaming) {
        msgs[msgs.length - 1] = { ...last, content: last.content + chunk };
      }
      return { chatMessages: msgs };
    }),

  finalizeChatStream: () =>
    set((s) => ({
      chatMessages: s.chatMessages.map((m, i) =>
        i === s.chatMessages.length - 1 ? { ...m, streaming: false } : m
      ),
      isChatStreaming: false,
    })),

  setIsChatStreaming: (v) => set({ isChatStreaming: v }),

  fetchTasks: async (roomCode) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await tasksApi.list(roomCode);
      const normalized = (data as unknown as Record<string, unknown>[]).map(normalizeTask);
      const myMemberId = useRoomStore.getState().myMemberId;
      const mine = normalized.find((t) => t.assignedTo && t.assignedTo === myMemberId);
      set({ tasks: normalized, myTaskId: mine?.id ?? null });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  assignTask: async (roomCode, taskId) => {
    try {
      const { data } = await tasksApi.assign(roomCode, taskId);
      // Normalize into the canonical shape (also enriches assignee name).
      const enriched = normalizeTask(data as unknown as Record<string, unknown>);
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === taskId ? enriched : t)),
        myTaskId: taskId,
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  reset: () => set(initial),
}));

export const useTasks = () => useTaskStore((s) => s.tasks);
export const useMyTask = () =>
  useTaskStore((s) => s.tasks.find((t) => t.id === s.myTaskId) ?? null);
