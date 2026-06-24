import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { auth as authApi } from '@/lib/api';

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
  clearError: () => void;
  setToken: (token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      error: null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const { data } = await authApi.login(email, password);
          localStorage.setItem('access_token', data.accessToken);
          set({ token: data.accessToken });
          await get().fetchMe();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      register: async (email, password, displayName) => {
        set({ isLoading: true, error: null });
        try {
          const { data } = await authApi.register(email, password, displayName);
          localStorage.setItem('access_token', data.accessToken);
          set({ token: data.accessToken });
          await get().fetchMe();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        } finally {
          set({ isLoading: false });
        }
      },

      logout: () => {
        localStorage.removeItem('access_token');
        set({ user: null, token: null, error: null });
      },

      fetchMe: async () => {
        try {
          const { data } = await authApi.me();
          set({ user: data });
        } catch {
          set({ user: null, token: null });
          localStorage.removeItem('access_token');
        }
      },

      clearError: () => set({ error: null }),

      setToken: (token) => {
        localStorage.setItem('access_token', token);
        set({ token });
      },
    }),
    {
      name: 'mosaic-auth',
      partialize: (s) => ({ token: s.token }),
    }
  )
);

export const useUser = () => useAuthStore((s) => s.user);
export const useIsAuthed = () => useAuthStore((s) => !!s.user);
