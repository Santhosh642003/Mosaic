import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Download, GitMerge, Users, Zap, Clock, ArrowRight } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useUser } from '@/stores/authStore';
import { rooms as roomsApi } from '@/lib/api';
import type { Room } from '@/types';

import { timeAgo, avatarColor } from '@/lib/utils';


const ROOM_ICONS: Record<string, string> = {
  '1': '💬', '2': '🏆', '3': '🍳',
};

const STATUS_BADGE: Record<string, { label: string; variant: 'green' | 'purple' | 'blue' | 'amber' }> = {
  waiting:      { label: 'Waiting',      variant: 'amber' },
  decomposing:  { label: 'Decomposing',  variant: 'blue' },
  coding:       { label: 'Active',       variant: 'green' },
  merging:      { label: 'Merging',      variant: 'purple' },
  complete:     { label: 'Complete',     variant: 'purple' },
};

const TEAM_SAMPLES = ['Maya', 'Arjun', 'Sofia', 'Devon'];

export default function Dashboard() {
  const user = useUser();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    roomsApi.list()
      .then((r) => setRooms(r.data))
      .catch(() => {/* leave empty on error */})
      .finally(() => setIsLoading(false));
  }, []);

  const displayRooms = rooms;
  const isEmpty = !isLoading && displayRooms.length === 0;

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
            { icon: Users,    label: 'Rooms created',    value: '9',  color: 'text-ms-blue'   },
            { icon: Zap,      label: 'Tasks completed',  value: '31', color: 'text-ms-green'  },
            { icon: GitMerge, label: 'Merges done',      value: '6',  color: 'text-ms-purple' },
            { icon: Clock,    label: 'Hours saved',      value: '48', color: 'text-ms-amber'  },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="rounded-xl border border-ms-border bg-ms-surface p-5">
              <Icon size={16} className={`${color} mb-3`} />
              <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
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
              {displayRooms.map((room) => {
                const badge = STATUS_BADGE[room.status] ?? STATUS_BADGE.waiting;
                const href = room.status === 'complete'
                  ? `/rooms/${room.code}/merge`
                  : `/rooms/${room.code}/lobby`;

                return (
                  <Link
                    key={room.id}
                    to={href}
                    className="flex items-center gap-4 p-4 rounded-xl border border-ms-border bg-ms-surface hover:border-ms-raised hover:-translate-y-0.5 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-ms-raised border border-ms-border flex items-center justify-center text-xl flex-none">
                      {ROOM_ICONS[room.id] ?? '📦'}
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
                      <div className="flex -space-x-1.5">
                        {TEAM_SAMPLES.slice(0, room.maxTeammates).map((name) => (
                          <div
                            key={name}
                            className="w-6 h-6 rounded-full border-2 border-ms-surface flex items-center justify-center text-[8px] font-bold text-white"
                            style={{ background: avatarColor(name) }}
                            title={name}
                          >
                            {name[0]}
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-ms-fg3">{timeAgo(room.createdAt)}</div>
                      <ArrowRight size={14} className="text-ms-fg3 group-hover:text-ms-fg transition-colors" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Saved codebases */}
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-ms-fg3 mb-4">Saved codebases</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { name: 'PingChat', lang: 'TypeScript · React · FastAPI', files: 24, date: '2 hours ago' },
              { name: 'Leaderboard', lang: 'Go · TypeScript · Redis', files: 18, date: '1 day ago' },
              { name: 'Recipe AI', lang: 'Python · React', files: 31, date: '3 days ago' },
            ].map((cb) => (
              <div key={cb.name} className="rounded-xl border border-ms-border bg-ms-surface p-4">
                <div className="text-sm font-bold mb-1">{cb.name}</div>
                <div className="text-xs text-ms-fg3 mb-3">{cb.lang}</div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ms-fg3">{cb.files} files · {cb.date}</span>
                  <button className="flex items-center gap-1 text-xs text-ms-blue hover:underline">
                    <Download size={11} /> ZIP
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
