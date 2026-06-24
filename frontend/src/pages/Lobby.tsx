import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Users, ArrowRight, Wifi } from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { Avatar } from '@/components/shared/Avatar';
import { Button } from '@/components/ui/button';
import { RoomCodeDisplay } from '@/components/shared/RoomCodeDisplay';
import { useRoomStore } from '@/stores/roomStore';
import { useUser } from '@/stores/authStore';
import { connectSocket, getSocket } from '@/lib/socket';
import { cn, avatarColor, initials } from '@/lib/utils';
import type { MemberRole, MemberStatus, RoomMember } from '@/types';

function normalizeMember(m: Record<string, unknown>): RoomMember {
  const name = (m.display_name ?? m.displayName ?? '') as string;
  return {
    id: m.id as string,
    displayName: name,
    initials: initials(name),
    avatarColor: avatarColor(name),
    role: (m.role ?? 'member') as MemberRole,
    status: (m.status ?? 'waiting') as MemberStatus,
    isGuest: (m.is_guest ?? m.isGuest ?? false) as boolean,
  };
}

export default function Lobby() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const user = useUser();
  const { room, members, setMembers, myMemberId, fetchRoom } = useRoomStore();

  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (!code) return;

    // Load room data via HTTP first (reliable, camelCased via axios)
    fetchRoom(code);

    connectSocket();
    const socket = getSocket();
    const token = localStorage.getItem('access_token');
    socket.emit('join_room', { code, token });

    socket.on('room_state', (rawState: unknown) => {
      // Backend socket emits: { room_id, code, status, members: { id: {...snake_case} } }
      // Normalize to what the store expects
      const rs = rawState as Record<string, unknown>;
      const membersRaw = (rs.members ?? {}) as Record<string, Record<string, unknown>>;
      const membersArr: RoomMember[] = Array.isArray(membersRaw)
        ? (membersRaw as unknown as Record<string, unknown>[]).map(normalizeMember)
        : Object.values(membersRaw).map(normalizeMember);
      setMembers(membersArr);
    });

    socket.on('teammate_status_update', (payload: { member_id?: string; memberId?: string; status: MemberStatus }) => {
      const id = payload.member_id ?? payload.memberId ?? '';
      setMembers(
        members.map((m) => (m.id === id ? { ...m, status: payload.status } : m))
      );
    });

    return () => {
      socket.off('room_state');
      socket.off('teammate_status_update');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const isLead = user ? members.find((m) => m.id === myMemberId)?.role === 'lead' : false;
  const canStart = members.length >= 2;
  const roomName = room?.name ?? '';
  const roomBrief = room?.brief ?? '';

  const handleStartDecomposition = () => {
    setIsStarting(true);
    getSocket().emit('trigger_decomposition', { roomId: room?.id ?? '' });
    setTimeout(() => navigate(`/rooms/${code}/decompose`), 300);
  };

  return (
    <div className="min-h-screen bg-ms-base">
      <header className="sticky top-0 z-40 h-14 border-b border-ms-subtle bg-ms-surface/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto h-full px-6 flex items-center gap-4">
          <MosaicLogo />
          <span className="text-ms-fg3">/</span>
          <span className="font-semibold">{roomName || '…'}</span>
          <span className="font-mono text-xs text-ms-fg3">#{code}</span>
          <div className="ml-auto flex items-center gap-1.5 text-ms-green text-xs font-semibold">
            <Wifi size={12} />
            Live
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10 grid md:grid-cols-[1fr_300px] gap-8">
        {/* Main */}
        <div>
          <div className="mb-8">
            <p className="text-xs font-semibold text-ms-fg3 uppercase tracking-wider mb-3">Room code</p>
            <RoomCodeDisplay code={code ?? ''} size="lg" />
            <p className="text-xs text-ms-fg3 mt-2">Share this code with teammates to invite them</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-ms-fg3">
                Team · {members.length} joined
              </h2>
              {!canStart && members.length > 0 && (
                <span className="text-xs text-ms-fg3">Waiting for at least 2 members</span>
              )}
            </div>

            {members.length === 0 ? (
              <div className="flex items-center gap-3 p-4 rounded-xl border border-dashed border-ms-border bg-ms-raised/50">
                <div className="w-9 h-9 rounded-full border-2 border-dashed border-ms-border flex items-center justify-center">
                  <Users size={14} className="text-ms-fg3" />
                </div>
                <span className="text-sm text-ms-fg3 italic">Connecting…</span>
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((member, i) => (
                  <div
                    key={member.id}
                    className={cn(
                      'flex items-center gap-3 p-4 rounded-xl border border-ms-border bg-ms-surface',
                      'transition-all animate-ms-pop'
                    )}
                    style={{ animationDelay: `${i * 0.05}s` }}
                  >
                    <Avatar name={member.displayName} size="md" color={member.avatarColor} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{member.displayName}</span>
                        {member.role === 'lead' && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-ms-amber border border-ms-amber/30 bg-ms-amber/10 rounded px-1.5 py-0.5">
                            Lead
                          </span>
                        )}
                        {member.id === myMemberId && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 border border-ms-border bg-ms-raised rounded px-1.5 py-0.5">
                            you
                          </span>
                        )}
                      </div>
                      {member.isGuest && (
                        <span className="text-xs text-ms-fg3">Guest</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-ms-green font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-ms-green animate-ms-pulse" />
                      Joined
                    </div>
                  </div>
                ))}

                {members.length < (room?.maxTeammates ?? 4) && (
                  <div className="flex items-center gap-3 p-4 rounded-xl border border-dashed border-ms-border bg-ms-raised/50">
                    <div className="w-9 h-9 rounded-full border-2 border-dashed border-ms-border flex items-center justify-center">
                      <Users size={14} className="text-ms-fg3" />
                    </div>
                    <span className="text-sm text-ms-fg3 italic">Waiting for teammate…</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {roomBrief && (
            <div className="rounded-xl border border-ms-border bg-ms-surface p-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ms-fg3 mb-3">Project brief</h3>
              <p className="text-sm text-ms-fg2 leading-relaxed">{roomBrief}</p>
            </div>
          )}

          <div className="rounded-xl border border-ms-border bg-ms-surface p-5">
            {isLead ? (
              <>
                <Button
                  className="w-full"
                  size="lg"
                  disabled={!canStart}
                  loading={isStarting}
                  onClick={handleStartDecomposition}
                >
                  Start decomposition <ArrowRight size={16} />
                </Button>
                {!canStart && (
                  <p className="text-xs text-ms-fg3 text-center mt-2">
                    Need at least 2 members to start
                  </p>
                )}
                {canStart && (
                  <p className="text-xs text-ms-fg3 text-center mt-2">
                    AI will decompose the project into parallel tasks
                  </p>
                )}
              </>
            ) : (
              <div className="text-center py-2">
                <div className="flex justify-center mb-3">
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-2 h-2 rounded-full bg-ms-blue animate-bounce"
                        style={{ animationDelay: `${i * 0.12}s` }} />
                    ))}
                  </div>
                </div>
                <p className="text-sm text-ms-fg2">Waiting for the team lead to start decomposition…</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
