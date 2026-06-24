import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Lock, ArrowRight, Cpu, Sparkles } from 'lucide-react';
import { Avatar } from '@/components/shared/Avatar';
import { RoomHeader } from '@/components/shared/RoomHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTaskStore } from '@/stores/taskStore';
import { useRoomStore } from '@/stores/roomStore';
import { useUser } from '@/stores/authStore';
import { getSocket, connectSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';

import type { Task } from '@/types';

const MOCK_TASKS: Task[] = [
  {
    id: 't1', roomId: 'r1', name: 'Auth service', complexity: 'Medium', color: '#4F8EF7',
    description: 'JWT-based auth with registration, login, GitHub OAuth, and session management via Redis.',
    tech: 'FastAPI · python-jose · bcrypt · Redis',
    files: ['auth/router.py', 'auth/models.py', 'auth/dependencies.py', 'auth/schemas.py'],
    exposes: [
      { signature: 'POST /auth/register → User', description: 'Register new user' },
      { signature: 'POST /auth/login → Token', description: 'Issue JWT' },
      { signature: 'GET /auth/me → User', description: 'Current user from token' },
      { signature: 'verify_token(token: str) → UserID', description: 'Dep injection helper' },
    ],
    dependsOn: [],
    assignedTo: 'u1', assigneeName: 'Maya Chen',
    status: 'in_progress', code: {},
  },
  {
    id: 't2', roomId: 'r1', name: 'Message API', complexity: 'Medium', color: '#3FB950',
    description: 'REST endpoints for sending and fetching messages with pagination, stored in PostgreSQL.',
    tech: 'FastAPI · SQLAlchemy · PostgreSQL',
    files: ['messages/router.py', 'messages/models.py', 'messages/schemas.py'],
    exposes: [
      { signature: 'POST /messages → Message', description: 'Save message' },
      { signature: 'GET /messages/{room_id} → list[Message]', description: 'Paginated history' },
      { signature: 'save_message(room_id, msg) → Message', description: 'Internal fn' },
    ],
    dependsOn: [{ signature: 'verify_token(token) → UserID', taskId: 't1' }],
    assignedTo: undefined, assigneeName: undefined,
    status: 'unassigned', code: {},
  },
  {
    id: 't3', roomId: 'r1', name: 'WebSocket gateway', complexity: 'High', color: '#A371F7',
    description: 'Real-time message broadcast over Socket.io with Redis pub/sub and room-level fanout.',
    tech: 'python-socketio · Redis · uvicorn',
    files: ['gateway/socket_manager.py', 'gateway/events.py', 'gateway/presence.py'],
    exposes: [
      { signature: 'on_connect(socket_id, room_id)', description: 'Handle join' },
      { signature: 'broadcast_message(room_id, msg)', description: 'Fanout to room' },
      { signature: 'emit_presence(room_id, users)', description: 'Presence update' },
    ],
    dependsOn: [
      { signature: 'save_message(room_id, msg) → Message', taskId: 't2' },
      { signature: 'verify_token(token) → UserID', taskId: 't1' },
    ],
    assignedTo: 'u3', assigneeName: 'Sofia Reyes',
    status: 'in_progress', code: {},
  },
  {
    id: 't4', roomId: 'r1', name: 'React frontend', complexity: 'High', color: '#D29922',
    description: 'React + TypeScript SPA with auth forms, real-time chat UI, message history, and presence indicators.',
    tech: 'React 18 · TypeScript · Tailwind · Socket.io',
    files: ['frontend/src/App.tsx', 'frontend/src/pages/', 'frontend/src/components/'],
    exposes: [
      { signature: 'ChatRoom component (roomId: string)', description: 'Main UI' },
      { signature: 'usePresence(roomId) → User[]', description: 'Presence hook' },
    ],
    dependsOn: [
      { signature: 'POST /auth/login → Token', taskId: 't1' },
      { signature: 'GET /messages/{room_id}', taskId: 't2' },
      { signature: 'broadcast_message / on_connect', taskId: 't3' },
    ],
    assignedTo: 'u4', assigneeName: 'Devon Park',
    status: 'in_progress', code: {},
  },
];

const STREAM_MSGS = [
  'Analyzing project brief…',
  'Identifying parallelizable boundaries…',
  'Defining interface contracts…',
  'Generating task 1 of 4…',
  'Generating task 2 of 4…',
  'Generating task 3 of 4…',
  'Generating task 4 of 4…',
  'Finalizing contract graph…',
];

const COMPLEXITY_BADGE: Record<string, 'green' | 'amber' | 'red'> = {
  Low: 'green', Medium: 'amber', High: 'red',
};

function TaskCard({ task, index, onAssign, myAssignment, myName }: {
  task: Task; index: number; onAssign: (id: string) => void; myAssignment: string | null; myName?: string;
}) {
  const isAssigned = !!task.assignedTo;
  const isMyTask = task.id === myAssignment;
  const suggestedForMe =
    !!task.suggestedAssignee && !!myName &&
    task.suggestedAssignee.trim().toLowerCase() === myName.trim().toLowerCase();

  return (
    <div
      className="rounded-xl border border-ms-border bg-ms-surface overflow-hidden animate-ms-pop"
      style={{ borderLeftWidth: 3, borderLeftColor: task.color, animationDelay: `${index * 0.15}s` }}
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-ms-fg3">T{index + 1}</span>
            <h3 className="font-bold text-ms-fg">{task.name}</h3>
          </div>
          <Badge variant={COMPLEXITY_BADGE[task.complexity]}>{task.complexity}</Badge>
        </div>

        <p className="text-sm text-ms-fg2 leading-relaxed mb-4">{task.description}</p>

        {/* Tech */}
        <div className="flex items-center gap-1.5 mb-4">
          <span className="text-[10px] font-semibold text-ms-fg3 uppercase tracking-wider">Stack:</span>
          <span className="text-xs font-mono text-ms-fg3">{task.tech}</span>
        </div>

        {/* Files */}
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 mb-2">Owns</p>
          <div className="flex flex-wrap gap-1.5">
            {task.files.map((f) => (
              <span key={f} className="text-[11px] font-mono px-2 py-0.5 rounded bg-ms-raised border border-ms-border text-ms-fg3">
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Exposes */}
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 mb-2">Exposes</p>
          <div className="space-y-1">
            {task.exposes.slice(0, 2).map((c) => (
              <div key={c.signature} className="text-[11px] font-mono px-2 py-1 rounded bg-ms-deep border border-ms-subtle text-ms-green">
                {c.signature}
              </div>
            ))}
            {task.exposes.length > 2 && (
              <span className="text-[10px] text-ms-fg3">+{task.exposes.length - 2} more</span>
            )}
          </div>
        </div>

        {/* Depends on */}
        {task.dependsOn.length > 0 && (
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 mb-2">Depends on</p>
            <div className="space-y-1">
              {task.dependsOn.map((d) => {
                const depTask = MOCK_TASKS.find((t) => t.id === d.taskId);
                return (
                  <div key={d.signature} className="flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded bg-ms-deep border border-ms-subtle"
                    style={{ color: depTask?.color ?? '#7D8590' }}>
                    <ChevronRight size={10} />
                    {d.signature}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI suggestion (only while unassigned) */}
        {!isAssigned && task.suggestedAssignee && (
          <div className={cn(
            'flex items-center gap-1.5 mb-3 text-[11px] rounded-md px-2 py-1.5 border',
            suggestedForMe
              ? 'text-ms-blue border-ms-blue/30 bg-ms-blue/10'
              : 'text-ms-fg3 border-ms-subtle bg-ms-deep'
          )}>
            <Sparkles size={11} className="flex-none" />
            <span>
              AI suggests <span className="font-semibold">{task.suggestedAssignee}</span>
              {suggestedForMe && ' — that\'s you'}
            </span>
          </div>
        )}

        {/* Assignment */}
        <div className="flex items-center justify-between pt-3 border-t border-ms-subtle">
          {isAssigned ? (
            <div className="flex items-center gap-2">
              <Avatar name={task.assigneeName!} size="xs" />
              <span className="text-xs text-ms-fg2">{task.assigneeName}</span>
              {isMyTask && (
                <span className="text-[10px] font-bold text-ms-blue border border-ms-blue/30 bg-ms-blue/10 rounded px-1.5 py-0.5">
                  yours
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-ms-amber font-semibold">Unassigned</span>
          )}

          {!isMyTask && !isAssigned && (
            <Button
              size="sm"
              variant={suggestedForMe ? 'primary' : 'ghost'}
              onClick={() => onAssign(task.id)}
            >
              Assign to me
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Decomposition() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { tasks, setTasks, assignTask, myTaskId, setIsDecomposing, isDecomposing } = useTaskStore();
  const { room, members, myMemberId } = useRoomStore();
  const user = useUser();

  // My display name — from the room member record (works for guests) or the
  // authenticated user. Used to highlight tasks the AI suggested for me.
  const myName =
    members.find((m) => m.id === myMemberId)?.displayName ?? user?.displayName;

  const [revealed, setRevealed] = useState(0);
  const [streamIdx, setStreamIdx] = useState(0);
  const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const displayTasks = tasks.length > 0 ? tasks : MOCK_TASKS;

  useEffect(() => {
    setIsDecomposing(true);

    // Simulate streaming while waiting for real socket events
    streamRef.current = setInterval(() => {
      setStreamIdx((i) => {
        if (i >= STREAM_MSGS.length - 1) {
          clearInterval(streamRef.current!);
          return i;
        }
        return i + 1;
      });
    }, 600);

    // Socket integration
    connectSocket();
    const socket = getSocket();

    socket.on('decomposition_stream', ({ chunk }: { chunk: string }) => {
      if (chunk) setStreamIdx((i) => Math.min(i + 1, STREAM_MSGS.length - 1));
    });

    socket.on('decomposition_complete', (data: unknown) => {
      // Backend sends { tasks: [...], room_status: "coding" }
      const d = data as Record<string, unknown>;
      const rawTasks = (Array.isArray(d) ? d : ((d.tasks ?? []) as unknown[])) as Record<string, unknown>[];

      const normalized = rawTasks.map((t) => ({
        id: t.id as string,
        roomId: (t.room_id ?? t.roomId ?? '') as string,
        name: t.name as string,
        description: t.description as string,
        tech: (t.tech ?? '') as string,
        complexity: (() => {
          const c = ((t.complexity ?? 'medium') as string);
          return (c.charAt(0).toUpperCase() + c.slice(1)) as 'Low' | 'Medium' | 'High';
        })(),
        color: (t.color ?? '#4F8EF7') as string,
        files: (t.files ?? []) as string[],
        exposes: ((t.exposes ?? []) as Record<string, string>[]).map((e) => ({
          signature: (e.name ?? e.signature ?? '') as string,
          description: (e.description ?? '') as string,
        })),
        dependsOn: ((t.depends_on ?? t.dependsOn ?? []) as Record<string, string>[]).map((d) => ({
          signature: (d.name ?? d.signature ?? '') as string,
          taskId: (d.provided_by ?? d.taskId ?? '') as string,
        })),
        assignedTo: (t.assigned_to ?? t.assignedTo) as string | undefined,
        suggestedAssignee: (t.suggested_assignee ?? t.suggestedAssignee) as string | undefined,
        status: (t.status ?? 'unassigned') as 'unassigned' | 'in_progress' | 'done',
        code: (t.code ?? {}) as Record<string, string>,
      }));

      clearInterval(streamRef.current!);
      clearInterval(revealRef.current!);
      setTasks(normalized);
      setIsDecomposing(false);
      setRevealed(normalized.length);
    });

    // If real tasks already loaded (page refresh), show them immediately
    if (tasks.length > 0) {
      clearInterval(streamRef.current!);
      setIsDecomposing(false);
      setRevealed(tasks.length);
    } else {
      // Reveal mock cards as placeholders while real decomp runs
      revealRef.current = setInterval(() => {
        setRevealed((r) => {
          if (r >= MOCK_TASKS.length) {
            clearInterval(revealRef.current!);
            setIsDecomposing(false);
            return r;
          }
          return r + 1;
        });
      }, 900);
    }

    return () => {
      clearInterval(streamRef.current!);
      clearInterval(revealRef.current!);
      socket.off('decomposition_stream');
      socket.off('decomposition_complete');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAssign = async (taskId: string) => {
    if (!code) return;
    await assignTask(code, taskId);
  };

  const visibleTasks = displayTasks.slice(0, revealed);
  const unassignedCount = displayTasks.filter((t) => !t.assignedTo).length;
  const allAssigned = revealed >= displayTasks.length && unassignedCount === 0;

  const allContracts = displayTasks.flatMap((t) =>
    t.exposes.map((c) => ({ ...c, taskName: t.name, taskColor: t.color }))
  );

  return (
    <div className="min-h-screen bg-ms-base">
      {/* Top bar */}
      <RoomHeader roomName={room?.name} code={code} crumb="Decomposition" />

      <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-[1fr_300px] gap-8">
        {/* Main */}
        <div>
          {/* Brief */}
          <div className="rounded-xl border border-ms-border bg-ms-surface p-5 mb-6">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 mb-2">Project brief</p>
            <p className="text-sm text-ms-fg2 leading-relaxed">
              {room?.brief ?? 'Build a real-time chat app with auth, message history, WebSocket support, and a React frontend. PostgreSQL for persistence, Redis for pub/sub.'}
            </p>
          </div>

          {/* Status */}
          {isDecomposing && (
            <div className="flex items-center gap-3 mb-6 px-4 py-3 rounded-lg border border-ms-purple/30 bg-ms-purple/5">
              <Cpu size={14} className="text-ms-purple animate-ms-pulse flex-none" />
              <span className="text-sm text-ms-fg2 font-mono">{STREAM_MSGS[streamIdx]}</span>
              <div className="ml-auto flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-ms-purple animate-bounce"
                    style={{ animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
            </div>
          )}

          {/* Task cards */}
          <div className="space-y-4">
            {visibleTasks.map((task, i) => (
              <TaskCard
                key={task.id}
                task={task}
                index={i}
                onAssign={handleAssign}
                myAssignment={myTaskId}
                myName={myName}
              />
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Interface contracts */}
          <div className="rounded-xl border border-ms-border bg-ms-surface sticky top-20">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ms-subtle">
              <span className="text-xs font-bold uppercase tracking-wider text-ms-fg3">
                Interface contracts
              </span>
              {revealed >= displayTasks.length && (
                <div className="flex items-center gap-1 text-[10px] text-ms-amber">
                  <Lock size={10} />
                  Frozen
                </div>
              )}
            </div>
            <div className="p-3 space-y-2 max-h-[60vh] overflow-y-auto">
              {allContracts.map((c, i) => (
                <div key={i} className="rounded border border-ms-subtle bg-ms-deep p-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-2 h-2 rounded-full flex-none" style={{ background: c.taskColor }} />
                    <span className="text-[10px] text-ms-fg3">{c.taskName}</span>
                  </div>
                  <div className="text-[11px] font-mono" style={{ color: c.taskColor }}>
                    {c.signature}
                  </div>
                </div>
              ))}
              {allContracts.length === 0 && (
                <p className="text-xs text-ms-fg3 text-center py-4">
                  Contracts appear as tasks are generated…
                </p>
              )}
            </div>

            <div className="p-3 border-t border-ms-subtle">
              {unassignedCount > 0 && revealed >= displayTasks.length && (
                <p className="text-xs text-ms-amber text-center mb-3">
                  {unassignedCount} task{unassignedCount > 1 ? 's' : ''} unassigned
                </p>
              )}
              <Button
                className="w-full"
                disabled={!allAssigned}
                onClick={() => navigate(`/rooms/${code}/code`)}
              >
                Start coding <ArrowRight size={14} />
              </Button>
              {!allAssigned && revealed < displayTasks.length && (
                <p className="text-xs text-ms-fg3 text-center mt-2">
                  Waiting for decomposition…
                </p>
              )}
              {!allAssigned && revealed >= displayTasks.length && unassignedCount > 0 && (
                <p className="text-xs text-ms-fg3 text-center mt-2">
                  All tasks must be assigned
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
