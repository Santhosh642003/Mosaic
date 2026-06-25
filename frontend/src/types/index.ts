// ─── Auth ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatar?: string;
  githubId?: string;
  hasGithubToken?: boolean;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  tokenType: string;
}

// ─── Room ────────────────────────────────────────────────────────────────────

export type RoomStatus =
  | 'waiting'
  | 'decomposing'
  | 'coding'
  | 'merging'
  | 'complete';

export interface Room {
  id: string;
  code: string;
  name: string;
  brief: string;
  language: string[];
  maxTeammates: number;
  status: RoomStatus;
  leadId: string;
  createdAt: string;
  completedAt?: string;
}

export type MemberStatus = 'waiting' | 'coding' | 'blocked' | 'done';
export type MemberRole = 'lead' | 'member';

export interface RoomMember {
  id: string;
  userId?: string;
  displayName: string;
  initials: string;
  avatarColor: string;
  role: MemberRole;
  taskId?: string;
  status: MemberStatus;
  skills?: string;
  isGuest: boolean;
}

export interface RoomState {
  room: Room;
  members: RoomMember[];
  tasks: Task[];
}

// ─── Task ─────────────────────────────────────────────────────────────────────

export type TaskStatus = 'unassigned' | 'in_progress' | 'done';
export type Complexity = 'Low' | 'Medium' | 'High';

export interface Contract {
  signature: string;
  description?: string;
  taskId?: string;
}

export interface Task {
  id: string;
  roomId: string;
  name: string;
  description: string;
  tech: string;
  files: string[];
  exposes: Contract[];
  dependsOn: Contract[];
  assignedTo?: string;
  assigneeName?: string;
  suggestedAssignee?: string;
  status: TaskStatus;
  complexity: Complexity;
  color: string;
  code: Record<string, string>;
}

// ─── Merge ───────────────────────────────────────────────────────────────────

export type MergePhase = 'idle' | 'merging' | 'complete' | 'failed';

export interface DiffEntry {
  path: string;
  operation: 'added' | 'modified' | 'removed';
  diff?: string;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface Conflict {
  id: string;
  description: string;
  resolution: string;
  files: string[];
}

export interface MergeResult {
  id: string;
  roomId: string;
  mergedFiles: Record<string, string>;
  diffReport: DiffEntry[];
  conflicts: Conflict[];
  createdAt: string;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  codeBlocks?: CodeBlock[];
  streaming?: boolean;
  timestamp: string;
}

export interface CodeBlock {
  language: string;
  code: string;
}

// ─── Socket events ───────────────────────────────────────────────────────────

export interface ServerToClientEvents {
  room_state: (state: RoomState) => void;
  teammate_status_update: (payload: { memberId: string; status: MemberStatus }) => void;
  task_assigned: (payload: { task_id: string; assigned_to: string; assignee_name: string; status: string }) => void;
  decomposition_stream: (payload: { chunk: string; taskIndex?: number }) => void;
  decomposition_complete: (tasks: Task[]) => void;
  decomposition_started: () => void;
  ai_response_stream: (payload: { chunk: string; done: boolean }) => void;
  agent_response: (payload: { agentId: string; reply: string; edits: { path: string; content: string; summary?: string }[] }) => void;
  task_submitted: (payload: { taskId: string; memberId: string }) => void;
  all_tasks_done: () => void;
  merge_log_stream: (payload: { tag: 'info' | 'ok' | 'warn'; text: string }) => void;
  merge_complete: (result: MergeResult) => void;
  merge_error: (payload: { message?: string }) => void;
  error: (payload: { code: string; message: string }) => void;
  agent_event: (payload: AgentEventPayload) => void;
  terminal_result: (payload: TerminalResultPayload) => void;
}

export interface ClientToServerEvents {
  join_room: (payload: { code: string; token?: string | null; memberId?: string }) => void;
  update_status: (payload: { status: MemberStatus }) => void;
  submit_task: (payload: { taskId: string; code: Record<string, string> }) => void;
  trigger_decomposition: (payload: { roomId?: string }) => void;
  trigger_merge: (payload: { roomId?: string }) => void;
  ai_prompt: (payload: { taskId?: string; prompt: string; contextCode?: string }) => void;
  agent_action: (payload: { taskId?: string; agentId: string; prompt: string; files: Record<string, string> }) => void;
  assign_task: (payload: { taskId: string }) => void;
  agent_run: (payload: { instruction: string }) => void;
  terminal_exec: (payload: { cmd: string }) => void;
  // Task coding session (real sandbox + agent loop)
  task_agent_prompt: (payload: { prompt: string; taskId?: string }) => void;
  task_session_end: (payload: Record<string, never>) => void;
  task_terminal_exec: (payload: { cmd: string }) => void;
}

// ─── Agent playground ─────────────────────────────────────────────────────────

export interface TerminalResultPayload {
  cmd: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  source: 'agent' | 'user';
}

export interface AgentEventPayload {
  type: 'step' | 'thinking' | 'tool_call' | 'tool_result' | 'complete' | 'error' | 'sandbox_ready' | 'sandbox_destroyed';
  step: number;
  // thinking
  content?: string;
  // tool_call / tool_result
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_result?: Record<string, unknown>;
  // complete
  summary?: string;
  // error
  error?: string;
  // sandbox_ready
  sandbox_id?: string;
  // files mirror (included whenever files change)
  files?: Record<string, string>;
}

// ─── API responses ────────────────────────────────────────────────────────────

export interface ApiError {
  detail: string;
  code?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SavedCodebase {
  id: string;
  roomId: string;
  roomName: string;
  roomCode: string;
  language: string[];
  mergedFiles: Record<string, string>;
  createdAt: string;
}
