import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Github, Settings, GitMerge, Users, Zap, ArrowRight } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Avatar } from '@/components/shared/Avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useUser } from '@/stores/authStore';
import { rooms as roomsApi, users as usersApi } from '@/lib/api';
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
  const [rooms, setRooms] = useState<Room[]>([]);
  const [codebases, setCodebases] = useState<SavedCodebase[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      roomsApi.list().then((r) => setRooms(r.data)).catch(() => {}),
      usersApi.codebases().then((r) => setCodebases(r.data)).catch(() => {}),
    ]).finally(() => setIsLoading(false));
  }, []);

  const completedRooms = rooms.filter((r) => r.status === 'complete').length;
  const displayName = user?.displayName ?? '';
  const email = user?.email ?? '';

  return (
    <div className="min-h-screen bg-ms-base">
      <Navbar />
      <div className="max-w-4xl mx-auto px-6 py-10 grid md:grid-cols-[1fr_260px] gap-8">
        {/* Left */}
        <div className="space-y-6">
          {/* User card */}
          <div className="rounded-xl border border-ms-border bg-ms-surface p-6">
            <div className="flex items-start gap-4 mb-6">
              <Avatar name={displayName} size="lg" />
              <div className="flex-1">
                <h1 className="text-xl font-extrabold tracking-tight">{displayName}</h1>
                <p className="text-sm text-ms-fg3">{email}</p>
                {user?.githubId && (
                  <a
                    href={`https://github.com/${user.githubId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-ms-blue hover:underline mt-1"
                  >
                    <Github size={12} /> @{user.githubId}
                  </a>
                )}
              </div>
            </div>

            {/* Stats — real data */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Rooms',       value: isLoading ? '…' : String(rooms.length),         icon: Users,    color: 'text-ms-blue'   },
                { label: 'Merges done', value: isLoading ? '…' : String(completedRooms),        icon: GitMerge, color: 'text-ms-purple' },
                { label: 'Codebases',   value: isLoading ? '…' : String(codebases.length),      icon: Zap,      color: 'text-ms-green'  },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="rounded-lg border border-ms-border bg-ms-raised p-4 text-center">
                  <Icon size={14} className={`${color} mx-auto mb-1`} />
                  <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
                  <div className="text-xs text-ms-fg3 mt-1">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent rooms — real data */}
          <div className="rounded-xl border border-ms-border bg-ms-surface p-5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-ms-fg3 mb-4">Recent rooms</h2>
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 rounded-lg border border-ms-border bg-ms-raised animate-ms-pulse" />
                ))}
              </div>
            ) : rooms.length === 0 ? (
              <p className="text-sm text-ms-fg3 text-center py-6">No rooms yet.</p>
            ) : (
              <div className="space-y-2">
                {rooms.slice(0, 6).map((room) => {
                  const badge = STATUS_BADGE[room.status] ?? STATUS_BADGE.waiting;
                  const href = room.status === 'complete'
                    ? `/rooms/${room.code}/merge`
                    : `/rooms/${room.code}/lobby`;
                  return (
                    <Link
                      key={room.id}
                      to={href}
                      className="flex items-center gap-3 p-3 rounded-lg border border-ms-border hover:bg-ms-raised transition-all group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{room.name}</div>
                        <div className="text-xs text-ms-fg3 truncate">{room.brief}</div>
                      </div>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      <span className="text-[10px] text-ms-fg3">{timeAgo(room.createdAt)}</span>
                      <ArrowRight size={12} className="text-ms-fg3 group-hover:text-ms-fg transition-colors" />
                    </Link>
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
                  const { auth } = await import('@/lib/api');
                  const r = await auth.githubUrl();
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
                {codebases.slice(0, 4).map((cb) => (
                  <div key={cb.id} className="flex items-center justify-between text-xs">
                    <span className="text-ms-fg2 truncate flex-1">{cb.roomName}</span>
                    <span className="text-ms-fg3 ml-2">{timeAgo(cb.createdAt)}</span>
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
