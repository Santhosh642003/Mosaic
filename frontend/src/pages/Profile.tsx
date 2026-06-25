import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Github, Settings, GitMerge, Users, Layers, ArrowRight, Trash2, Plus } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Avatar } from '@/components/shared/Avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useUser } from '@/stores/authStore';
import { rooms as roomsApi, users as usersApi, auth as authApi } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import type { Room, SavedCodebase } from '@/types';

const STATUS_BADGE: Record<string, { label: string; variant: 'green' | 'purple' | 'amber' | 'blue' }> = {
  waiting:     { label: 'Waiting',  variant: 'amber' },
  decomposing: { label: 'Active',   variant: 'blue' },
  coding:      { label: 'Active',   variant: 'green' },
  merging:     { label: 'Merging',  variant: 'purple' },
  complete:    { label: 'Done',     variant: 'purple' },
};

export default function Profile() {
  const user = useUser();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [codebases, setCodebases] = useState<SavedCodebase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      roomsApi.list().then((r) => setRooms(r.data)).catch(() => {}),
      usersApi.codebases().then((r) => setCodebases(r.data)).catch(() => {}),
    ]).finally(() => setIsLoading(false));
  }, []);

  const completedRooms = rooms.filter((r) => r.status === 'complete').length;
  const displayName = user?.displayName ?? '';
  const email = user?.email ?? '';

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

  return (
    <div className="min-h-screen bg-ms-base">
      <Navbar />
      <div className="max-w-4xl mx-auto px-6 py-10 grid md:grid-cols-[1fr_260px] gap-8">
        {/* Left */}
        <div className="space-y-6">
          {/* User card */}
          <div className="rounded-2xl border border-ms-border bg-ms-surface p-6">
            <div className="flex items-center gap-4">
              <Avatar name={displayName} size="lg" />
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-extrabold tracking-tight truncate">{displayName}</h1>
                <p className="text-sm text-ms-fg3 truncate">{email}</p>
                {user?.hasGithubToken && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ms-green mt-1.5">
                    <Github size={12} /> GitHub connected
                  </span>
                )}
              </div>
            </div>

            {/* Stats — real data */}
            <div className="grid grid-cols-3 gap-3 mt-6">
              {[
                { label: 'Rooms',       value: isLoading ? '…' : String(rooms.length),     icon: Users,    color: 'text-ms-blue'   },
                { label: 'Merges done', value: isLoading ? '…' : String(completedRooms),   icon: GitMerge, color: 'text-ms-purple' },
                { label: 'Codebases',   value: isLoading ? '…' : String(codebases.length), icon: Layers,   color: 'text-ms-green'  },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="rounded-xl border border-ms-border bg-ms-raised p-4 text-center">
                  <Icon size={14} className={`${color} mx-auto mb-1.5`} />
                  <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
                  <div className="text-xs text-ms-fg3 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Rooms — real data, deletable by the lead */}
          <div className="rounded-2xl border border-ms-border bg-ms-surface p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-ms-fg3">Your rooms</h2>
              <Button size="sm" variant="ghost" onClick={() => navigate('/rooms/new')}>
                <Plus size={14} /> New
              </Button>
            </div>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-xl border border-ms-border bg-ms-raised animate-ms-pulse" />
                ))}
              </div>
            ) : rooms.length === 0 ? (
              <p className="text-sm text-ms-fg3 text-center py-8">No rooms yet — create one to get started.</p>
            ) : (
              <div className="space-y-2">
                {rooms.map((room) => {
                  const badge = STATUS_BADGE[room.status] ?? STATUS_BADGE.waiting;
                  const href = room.status === 'complete'
                    ? `/rooms/${room.code}/merge`
                    : `/rooms/${room.code}/lobby`;
                  const isLead = user?.id === room.leadId;
                  const isDeleting = deleting.has(room.id);
                  return (
                    <div
                      key={room.id}
                      className="flex items-center gap-3 p-3 rounded-xl border border-ms-border hover:bg-ms-raised transition-colors group"
                    >
                      <Link to={href} className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm truncate">{room.name}</span>
                            <span className="font-mono text-[10px] text-ms-fg3">#{room.code}</span>
                          </div>
                          <div className="text-xs text-ms-fg3 truncate">{room.brief}</div>
                        </div>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        <span className="text-[10px] text-ms-fg3 hidden sm:block">{timeAgo(room.createdAt)}</span>
                      </Link>
                      {isLead ? (
                        <button
                          onClick={() => handleDelete(room)}
                          disabled={isDeleting}
                          title="Delete room"
                          className="flex-none p-1.5 rounded-md text-ms-fg3 hover:text-ms-red hover:bg-ms-red/10 transition-colors disabled:opacity-40"
                        >
                          <Trash2 size={14} />
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
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          <Link
            to="/settings"
            className="flex items-center justify-between w-full rounded-xl border border-ms-border bg-ms-surface p-4 hover:bg-ms-raised transition-colors"
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Settings size={14} className="text-ms-fg3" />
              Account settings
            </div>
            <ArrowRight size={12} className="text-ms-fg3" />
          </Link>

          {user?.hasGithubToken ? (
            <div className="rounded-xl border border-ms-green/30 bg-ms-green/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-ms-green mb-1">
                <Github size={14} /> GitHub connected
              </div>
              <p className="text-xs text-ms-fg3">
                You can push merged codebases directly to your repositories.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-ms-border bg-ms-surface p-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                <Github size={14} className="text-ms-fg3" /> Connect GitHub
              </div>
              <p className="text-xs text-ms-fg3 mb-3">
                Push merged codebases directly to your repositories.
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="w-full"
                onClick={async () => {
                  const r = await authApi.githubUrl();
                  if (r.data.url) window.location.href = r.data.url;
                }}
              >
                <Github size={13} /> Connect GitHub
              </Button>
            </div>
          )}

          {codebases.length > 0 && (
            <div className="rounded-xl border border-ms-border bg-ms-surface p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ms-fg3 mb-3">Saved codebases</h3>
              <div className="space-y-2">
                {codebases.slice(0, 5).map((cb) => (
                  <div key={cb.id} className="flex items-center justify-between text-xs">
                    <span className="text-ms-fg2 truncate flex-1">{cb.roomName}</span>
                    <span className="text-ms-fg3 ml-2 flex-none">{timeAgo(cb.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
