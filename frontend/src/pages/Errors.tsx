import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw, Wifi, WifiOff, AlertTriangle, Home, ArrowLeft, Plus } from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function ErrorCard({ title, children, border = '#30363D' }: { title: string; children: React.ReactNode; border?: string }) {
  return (
    <div className="rounded-xl border bg-ms-surface overflow-hidden" style={{ borderColor: border }}>
      <div className="px-4 py-3 border-b border-ms-subtle bg-ms-raised">
        <span className="text-xs font-bold uppercase tracking-wider text-ms-fg3">{title}</span>
      </div>
      <div className="p-8 flex flex-col items-center text-center gap-4">
        {children}
      </div>
    </div>
  );
}

function NotFoundCard() {
  return (
    <ErrorCard title="404 — Page not found" border="#F8514940">
      <div className="text-5xl font-black text-ms-fg3">404</div>
      <div>
        <h3 className="font-bold text-lg mb-1">This page got merged away</h3>
        <p className="text-sm text-ms-fg3">It may have been moved or never existed.</p>
      </div>
      <Button size="sm" asChild>
        <Link to="/"><Home size={13} /> Back to home</Link>
      </Button>
    </ErrorCard>
  );
}

function RoomNotFoundCard() {
  const [code] = useState('8XQ2PP');
  return (
    <ErrorCard title="Room not found">
      <div className="w-12 h-12 rounded-xl border border-ms-red/30 bg-ms-red/10 flex items-center justify-center">
        <AlertTriangle size={20} className="text-ms-red" />
      </div>
      <div>
        <h3 className="font-bold text-lg mb-1">No room with code #{code}</h3>
        <p className="text-sm text-ms-fg3">The code may have expired or been entered incorrectly.</p>
      </div>
      <Button variant="ghost" size="sm" asChild>
        <Link to="/join"><ArrowLeft size={13} /> Try another code</Link>
      </Button>
    </ErrorCard>
  );
}

function RoomExpiredCard() {
  return (
    <ErrorCard title="Room expired">
      <div className="w-12 h-12 rounded-xl border border-ms-amber/30 bg-ms-amber/10 flex items-center justify-center">
        <span className="text-2xl">⏰</span>
      </div>
      <div>
        <h3 className="font-bold text-lg mb-1">This room has expired</h3>
        <p className="text-sm text-ms-fg3">Rooms are active for 48 hours after creation.</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost">View final project</Button>
        <Button size="sm"><Plus size={13} /> New room</Button>
      </div>
    </ErrorCard>
  );
}

function MergeFailedCard() {
  const [retrying, setRetrying] = useState(false);
  return (
    <ErrorCard title="Merge failed" border="#F8514940">
      <div className="w-12 h-12 rounded-xl border border-ms-red/30 bg-ms-red/10 flex items-center justify-center">
        <AlertTriangle size={20} className="text-ms-red" />
      </div>
      <div>
        <h3 className="font-bold text-lg mb-1">Merge failed</h3>
        <p className="text-sm text-ms-fg3">
          Unresolved import in{' '}
          <code className="font-mono text-ms-red text-xs">gateway/events.py:14</code>
        </p>
      </div>
      <div className="flex gap-2">
        <button className="text-xs text-ms-blue hover:underline">See error log</button>
        <Button
          size="sm"
          loading={retrying}
          onClick={() => { setRetrying(true); setTimeout(() => setRetrying(false), 2000); }}
        >
          <RefreshCw size={13} /> Retry merge
        </Button>
      </div>
    </ErrorCard>
  );
}

function ConnectionLostCard() {
  const [attempt, setAttempt] = useState(2);
  const [countdown, setCountdown] = useState(3);
  const [connected, setConnected] = useState(false);

  const simulate = () => {
    setAttempt((a) => a + 1);
    setCountdown(3);
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(t);
          setConnected(true);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  return (
    <ErrorCard title="Connection lost" border={connected ? '#3FB95040' : '#30363D'}>
      <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center border',
        connected ? 'border-ms-green/30 bg-ms-green/10' : 'border-ms-amber/30 bg-ms-amber/10')}>
        {connected
          ? <Wifi size={20} className="text-ms-green" />
          : <WifiOff size={20} className="text-ms-amber animate-ms-pulse" />}
      </div>
      <div>
        <h3 className="font-bold text-lg mb-1">
          {connected ? 'Reconnected' : 'Connection lost'}
        </h3>
        <p className="text-sm text-ms-fg3">
          {connected
            ? 'You\'re back online. All changes synced.'
            : `Attempt ${attempt} · retrying in ${countdown}s`}
        </p>
      </div>
      {!connected && (
        <Button size="sm" variant="ghost" onClick={simulate}>
          <RefreshCw size={13} /> Retry now
        </Button>
      )}
    </ErrorCard>
  );
}

function EmptyDashboardCard() {
  const navigate = useNavigate();
  return (
    <ErrorCard title="Empty dashboard">
      <div className="text-4xl">🚀</div>
      <div>
        <h3 className="font-bold text-lg mb-1">No rooms yet</h3>
        <p className="text-sm text-ms-fg3 max-w-xs">
          Create your first room to start a hackathon project with your team.
        </p>
      </div>
      <Button size="sm" onClick={() => navigate('/rooms/new')}>
        <Plus size={13} /> Create first room
      </Button>
    </ErrorCard>
  );
}

export default function Errors() {
  return (
    <div className="min-h-screen bg-ms-base">
      <header className="sticky top-0 z-40 h-14 border-b border-ms-subtle bg-ms-surface/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto h-full px-6 flex items-center gap-4">
          <Link to="/"><MosaicLogo /></Link>
          <span className="text-ms-fg3">/</span>
          <span className="text-ms-fg2 text-sm">Error & empty states</span>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold tracking-tight mb-1">Error & empty states</h1>
          <p className="text-sm text-ms-fg3">All error conditions Mosaic handles gracefully.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <NotFoundCard />
          <RoomNotFoundCard />
          <RoomExpiredCard />
          <MergeFailedCard />
          <ConnectionLostCard />
          <EmptyDashboardCard />
        </div>
      </div>
    </div>
  );
}
