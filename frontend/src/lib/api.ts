/**
 * Axios API client.
 * Automatically:
 *  - Attaches the JWT from localStorage as a Bearer token
 *  - Converts snake_case response keys → camelCase (backend uses snake_case)
 *  - Throws readable Error objects on non-2xx responses
 */

import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import type { Room, RoomMember, AuthTokens, User, Task, RoomState, MergeResult, SavedCodebase } from '@/types';

// ── snake_case → camelCase transformer ────────────────────────────────────────

function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function transformKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(transformKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        toCamel(k),
        transformKeys(v),
      ])
    );
  }
  return obj;
}

// ── Axios instance ─────────────────────────────────────────────────────────────

const client: AxiosInstance = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT on every request
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Transform response keys and normalise errors
client.interceptors.response.use(
  (res: AxiosResponse) => {
    res.data = transformKeys(res.data);
    return res;
  },
  (err) => {
    const detail =
      err.response?.data?.detail ??
      err.response?.data?.message ??
      err.message ??
      'Request failed';
    return Promise.reject(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)));
  }
);

// ── Auth ───────────────────────────────────────────────────────────────────────

export const auth = {
  register: (email: string, password: string, displayName: string) =>
    client.post<AuthTokens>('/auth/register', { email, password, display_name: displayName }),

  login: (email: string, password: string) =>
    client.post<AuthTokens>('/auth/login', { email, password }),

  me: () => client.get<User>('/auth/me'),

  githubUrl: () => client.get<{ url: string }>('/auth/github'),

  forgotPassword: (email: string) =>
    client.post('/auth/forgot-password', { email }),
};

// ── Rooms ──────────────────────────────────────────────────────────────────────

export const rooms = {
  create: (body: { name: string; brief: string; language: string[]; maxTeammates: number; skills?: string }) =>
    client.post<Room>('/rooms', {
      name: body.name,
      brief: body.brief,
      language: body.language,
      max_teammates: body.maxTeammates,
      skills: body.skills ?? null,
    }),

  join: (code: string, displayName?: string, skills?: string) =>
    client.post<RoomMember>(`/rooms/${code}/join`, {
      display_name: displayName ?? null,
      skills: skills ?? null,
    }),

  get: (code: string) => client.get<Room>(`/rooms/${code}`),

  state: (code: string) => client.get<RoomState>(`/rooms/${code}/state`),

  list: () => client.get<Room[]>('/rooms'),
};

// ── Tasks ──────────────────────────────────────────────────────────────────────

export const tasks = {
  list: (roomCode: string) => client.get<Task[]>(`/rooms/${roomCode}/tasks`),

  get: (roomCode: string, taskId: string) =>
    client.get<Task>(`/rooms/${roomCode}/tasks/${taskId}`),

  assign: (roomCode: string, taskId: string) =>
    client.post<Task>(`/rooms/${roomCode}/tasks/${taskId}/assign`),

  submit: (roomCode: string, taskId: string, code: Record<string, string>) =>
    client.post<Task>(`/rooms/${roomCode}/tasks/${taskId}/submit`, { code }),
};

// ── Users ─────────────────────────────────────────────────────────────────────

export const users = {
  codebases: () => client.get<SavedCodebase[]>('/users/me/codebases'),

  deleteAccount: () => client.delete('/users/me'),
};

// ── Merge ──────────────────────────────────────────────────────────────────────

export const merge = {
  trigger: (roomCode: string) => client.post(`/rooms/${roomCode}/merge`),

  result: (roomCode: string) => client.get<MergeResult>(`/rooms/${roomCode}/merge/result`),

  downloadUrl: (roomCode: string) => `/api/rooms/${roomCode}/merge/download`,

  pushToGitHub: (
    roomCode: string,
    repo: string,
    branch: string,
    commitMessage: string,
  ) =>
    client.post<{ repo: string; branch: string; url: string; filesPushed: number }>(
      `/rooms/${roomCode}/merge/push-github`,
      { repo, branch, commit_message: commitMessage },
    ),
};
