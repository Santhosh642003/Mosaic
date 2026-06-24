import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RoomCodeInput } from '@/components/shared/RoomCodeDisplay';
import { useRoomStore } from '@/stores/roomStore';
import { useUser } from '@/stores/authStore';
import { cn } from '@/lib/utils';

type JoinError = 'invalid' | 'full' | 'closed' | 'other' | null;

const ERROR_MSGS: Record<NonNullable<Exclude<JoinError, 'other'>>, string> = {
  invalid: 'No room found with that code. Check for typos and try again.',
  full: 'That room is full. Ask the team lead to increase the limit.',
  closed: 'That room has ended and is no longer accepting members.',
};

export default function JoinRoom() {
  const { code: urlCode } = useParams();
  const navigate = useNavigate();
  const user = useUser();
  const { joinRoom, isLoading } = useRoomStore();

  const [code, setCode] = useState(urlCode?.toUpperCase() ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [joinError, setJoinError] = useState<JoinError>(null);
  const [joinErrorMsg, setJoinErrorMsg] = useState('');
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (urlCode) setCode(urlCode.toUpperCase());
  }, [urlCode]);

  const triggerShake = () => {
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 6) return;

    setJoinError(null);
    try {
      await joinRoom(code, user ? undefined : displayName);
      navigate(`/rooms/${code}/lobby`);
    } catch (err) {
      const msg = (err as Error).message.toLowerCase();
      if (msg.includes('not found') || msg.includes('invalid')) {
        setJoinError('invalid');
      } else if (msg.includes('full')) {
        setJoinError('full');
      } else if (msg.includes('closed') || msg.includes('ended')) {
        setJoinError('closed');
      } else {
        setJoinError('other');
        setJoinErrorMsg((err as Error).message);
      }
      triggerShake();
    }
  };

  return (
    <div className="min-h-screen bg-ms-base flex flex-col items-center justify-center p-6">
      <Link to="/" className="mb-10">
        <MosaicLogo size="lg" />
      </Link>

      <div
        className={cn(
          'w-full max-w-sm bg-ms-surface border rounded-2xl p-8 shadow-xl transition-all',
          joinError ? 'border-ms-red/60' : 'border-ms-border',
          shaking && 'animate-ms-shake'
        )}
      >
        <h1 className="text-xl font-extrabold tracking-tight mb-1">Join a room</h1>
        <p className="text-sm text-ms-fg3 mb-8">Enter the 6-character code from your team lead.</p>

        <form onSubmit={handleJoin} className="space-y-5">
          <div>
            <label className="text-xs font-semibold text-ms-fg2 uppercase tracking-wider block mb-3">
              Room code
            </label>
            <RoomCodeInput
              value={code}
              onChange={(v) => { setCode(v); setJoinError(null); setJoinErrorMsg(''); }}
              error={!!joinError}
            />
          </div>

          {!user && (
            <Input
              label="Your name"
              placeholder="Enter your display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              hint="Guest — no account needed"
            />
          )}

          {joinError && (
            <div className="flex items-start gap-2 text-sm text-ms-red bg-ms-red/10 border border-ms-red/30 rounded-lg p-3">
              <AlertCircle size={14} className="mt-0.5 flex-none" />
              <p>{joinError === 'other' ? joinErrorMsg : ERROR_MSGS[joinError]}</p>
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            size="lg"
            loading={isLoading}
            disabled={code.length < 6 || (!user && !displayName.trim())}
          >
            Join room <ArrowRight size={16} />
          </Button>
        </form>

        <div className="mt-6 pt-5 border-t border-ms-subtle text-center">
          <p className="text-xs text-ms-fg3">
            Want to create a room?{' '}
            <Link to="/auth" className="text-ms-blue hover:underline font-semibold">
              Sign up free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
