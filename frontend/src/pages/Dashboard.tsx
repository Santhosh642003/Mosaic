import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Download, GitMerge, Users, Zap, Clock, ArrowRight, Trash2 } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useUser } from '@/stores/authStore';
import { rooms as roomsApi, users as usersApi, merge as mergeApi } from '@/lib/api';
import type { Room, SavedCodebase } from '@/types';

import { timeAgo } from '@/lib/utils';

const ROOM_EMOJIS = ['💬', '🏆', '🍳', '🚀', '🎮', '🌐', '🛠️', '🎯'];

function roomEmoji(room: Room, index: number): string {
  const lang = room.language?.[0]?.toLowerCase() ?? '';
  if (lang === 'python') return '🐍';
  if (lang === 'go') return '🐹';
  if (lang === 'typescript' || lang === 'javascript') return '⚡';
  return ROOM_EMOJIS[index % ROOM_EMOJIS.length];
}

const STATUS_BADGE: Record<string, { label: string; variant: 'green' | 'purple' | 'blue' | 'amber' }> = {
  waiting:      { label: 'Waiting',      variant: 'amber' },
  decomposing:  { label: 'Decomposing',  variant: 'blue' },
  coding:       { label: 'Active',       variant: 'green' },
  merging:      { label: 'Merging',      variant: 'purple' },
  complete:     { label: 'Complete',     variant: 'purple' },
};

export default function Dashboard() {
  const user = useUser();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [codebases, setCodebases] = useState<SavedCodebase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const handleDelete = async (room: Room) => {
    if (!window.confirm(`Delete "${room.name}"? This permanently removes the room and its codebase.`)) return;
    setDeleting((s) => new Set(s).add(room.id));
    try {
      await roomsApi.remove(room.code);
      setRooms((rs) => rs.filter((r) => r.id !== room.id));
    } catch {
      window.alert('Could not delete the room. Only the room lead can delete it.');
    } finally {
      setDeleting((s) => {
        const next = new Set(s);
        next.delete(room.id);
        return next;
      });
    }
  };

  useEffect(() => {
    Promise.all([
      roomsApi.list().then((r) => setRooms(r.data)).catch(() => {}),
      usersApi.codebases().then((r) => setCodebases(r.data)).catch(() => {}),
    ]).finally(() => setIsLoading(false));
  }, []);

  const completedRooms = rooms.filter((r) => r.status === 'complete').length;
  const activeRooms = rooms.filter((r) =>
    ['waiting', 'decomposing', 'coding', 'merging'].includes(r.status)
  ).length;
  const isEmpty = !isLoading && rooms.length === 0;

  return (
    <div className="min-h-screen bg-ms-base">
      <Navbar />

      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Welcome back, {user?.displayName.split(' ')[0] ?? 'there'}
            </h1>
            <p className="text-sm text-ms-fg3 mt-1">Your rooms and activity</p>
          </div>
          <Button onClick={() => navigate('/rooms/new')}>
            <Plus size={16} /> New Room
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { icon: Users,    label: 'Your rooms',       value: String(rooms.length),         color: 'text-ms-blue'   },
            { icon: Zap,      label: 'Active rooms',     value: String(activeRooms),          color: 'text-ms-green'  },
            { icon: GitMerge, label: 'Merges done',      value: String(completedRooms),       color: 'text-ms-purple' },
            { icon: Clock,    label: 'Saved codebases',  value: String(codebases.length),     color: 'text-ms-amber'  },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="rounded-xl border border-ms-border bg-ms-surface p-5">
              <Icon size={16} className={`${color} mb-3`} />
              <div className={`text-2xl font-extrabold ${color}`}>{isLoading ? '…' : value}</div>
              <div className="text-xs text-ms-fg3 mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Rooms */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-ms-fg3">Recent rooms</h2>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-xl border border-ms-border bg-ms-surface animate-ms-pulse" />
              ))}
            </div>
          ) : isEmpty ? (
            <div className="rounded-xl border border-dashed border-ms-border bg-ms-surface p-14 text-center">
              <div className="text-4xl mb-4">🚀</div>
              <h3 className="font-bold text-lg mb-2">No rooms yet</h3>
              <p className="text-sm text-ms-fg2 mb-6 max-w-xs mx-auto">
                Create your first room and invite your team to start hacking.
              </p>
              <Button onClick={() => navigate('/rooms/new')}>
                <Plus size={16} /> Create your first room
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {rooms.map((room, idx) => {
                const badge = STATUS_BADGE[room.status] ?? STATUS_BADGE.waiting;
                const href = room.status === 'complete'
                  ? `/rooms/${room.code}/merge`
                  : `/rooms/${room.code}/lobby`;
                const isLead = user?.id === room.leadId;
                const isDeleting = deleting.has(room.id);

                return (
                  <div
                    key={room.id}
                    className="flex items-center gap-4 p-4 rounded-xl border border-ms-border bg-ms-surface hover:border-ms-raised transition-all group"
                  >
                    <Link to={href} className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-ms-raised border border-ms-border flex items-center justify-center text-xl flex-none">
                        {roomEmoji(room, idx)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-ms-fg">{room.name}</span>
                          <span className="font-mono text-[10px] text-ms-fg3">#{room.code}</span>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </div>
                        <p className="text-xs text-ms-fg3 truncate">{room.brief}</p>
                      </div>
                      <div className="flex items-center gap-3 flex-none">
                        <div className="flex items-center gap-1 text-xs text-ms-fg3">
                          <Users size={12} />
                          <span>{room.maxTeammates}</span>
                        </div>
                        <div className="text-xs text-ms-fg3">{timeAgo(room.createdAt)}</div>
                      </div>
                    </Link>
                    {isLead ? (
                      <button
                        onClick={() => handleDelete(room)}
                        disabled={isDeleting}
                        title="Delete room"
                        className="flex-none p-1.5 rounded-md text-ms-fg3 hover:text-ms-red hover:bg-ms-red/10 transition-colors disabled:opacity-40"
                      >
                        <Trash2 size={15} />
                      </button>
                    ) : (
                      <ArrowRight size={14} className="flex-none text-ms-fg3 group-hover:text-ms-fg transition-colors" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Saved codebases */}
        {codebases.length > 0 && (
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-ms-fg3 mb-4">Saved codebases</h2>
            <div className="grid sm:grid-cols-3 gap-3">
              {codebases.map((cb) => (
                <div key={cb.id} className="rounded-xl border border-ms-border bg-ms-surface p-4">
                  <div className="text-sm font-bold mb-1">{cb.roomName}</div>
                  <div className="text-xs text-ms-fg3 mb-3">{cb.language?.join(' · ') ?? '—'}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-ms-fg3">
                      {cb.mergedFiles ? Object.keys(cb.mergedFiles).length : 0} files · {timeAgo(cb.createdAt)}
                    </span>
                    <a
                      href={mergeApi.downloadUrl(cb.roomCode)}
                      className="flex items-center gap-1 text-xs text-ms-blue hover:underline"
                    >
                      <Download size={11} /> ZIP
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
