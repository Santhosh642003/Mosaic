import { useNavigate } from 'react-router-dom';
import { LogOut, Wifi } from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { useRoomStore } from '@/stores/roomStore';
import { useTaskStore } from '@/stores/taskStore';
import { useUser } from '@/stores/authStore';
import { disconnectSocket } from '@/lib/socket';

interface RoomHeaderProps {
  /** Room display name (falls back to the code). */
  roomName?: string;
  /** Room code, shown as #CODE. */
  code?: string;
  /** Current step label, e.g. "Lobby", "Decomposition", "Merge". */
  crumb: string;
  /** Show the green "Live" indicator. */
  live?: boolean;
  /** Extra controls rendered before the Leave button. */
  children?: React.ReactNode;
}

/**
 * Consistent header for all in-room pages: clickable logo, breadcrumb trail,
 * an optional live indicator, and a "Leave room" action that tears down the
 * session and returns the user to a sensible home.
 */
export function RoomHeader({ roomName, code, crumb, live = true, children }: RoomHeaderProps) {
  const navigate = useNavigate();
  const user = useUser();
  const resetRoom = useRoomStore((s) => s.reset);
  const resetTasks = useTaskStore((s) => s.reset);

  const handleLeave = () => {
    disconnectSocket();
    resetRoom();
    resetTasks();
    navigate(user ? '/dashboard' : '/');
  };

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-ms-subtle bg-ms-surface/90 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto h-full px-6 flex items-center gap-3">
        <button onClick={() => navigate(user ? '/dashboard' : '/')} className="flex-none">
          <MosaicLogo />
        </button>
        <span className="text-ms-fg3">/</span>
        <span className="font-semibold truncate max-w-[160px]">{roomName || code || 'Room'}</span>
        {code && <span className="font-mono text-xs text-ms-fg3 hidden sm:inline">#{code}</span>}
        <span className="text-ms-fg3">/</span>
        <span className="text-ms-fg2 text-sm">{crumb}</span>

        <div className="ml-auto flex items-center gap-3">
          {live && (
            <div className="flex items-center gap-1.5 text-ms-green text-xs font-semibold">
              <Wifi size={12} />
              <span className="hidden sm:inline">Live</span>
            </div>
          )}
          {children}
          <button
            onClick={handleLeave}
            className="flex items-center gap-1.5 text-xs font-semibold text-ms-fg3 hover:text-ms-red border border-ms-border hover:border-ms-red/40 rounded-md px-2.5 py-1.5 transition-colors"
          >
            <LogOut size={13} />
            <span className="hidden sm:inline">Leave room</span>
          </button>
        </div>
      </div>
    </header>
  );
}
