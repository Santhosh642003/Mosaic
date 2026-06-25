import { create } from 'zustand';
import type { Task, TaskStatus, ChatMessage } from '@/types';
import { tasks as tasksApi } from '@/lib/api';
import { useRoomStore } from '@/stores/roomStore';

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
      set({ tasks: data });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  assignTask: async (roomCode, taskId) => {
    try {
      const { data } = await tasksApi.assign(roomCode, taskId);
      // Enrich with assignee display name from members store
      const members = useRoomStore.getState().members;
      const assignee = members.find((m) => m.id === data.assignedTo);
      const enriched: Task = {
        ...data,
        assigneeName: assignee?.displayName ?? data.assigneeName,
      };
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
