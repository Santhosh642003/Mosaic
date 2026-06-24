import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Check, ArrowRight, Upload, ChevronLeft } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RoomCodeDisplay } from '@/components/shared/RoomCodeDisplay';
import { useRoomStore } from '@/stores/roomStore';
import { cn, copyToClipboard } from '@/lib/utils';

const FRAMEWORKS = [
  'React', 'Next.js', 'Vue', 'Svelte',
  'FastAPI', 'Express', 'Django', 'Rails',
  'TypeScript', 'Python', 'Go', 'Rust',
  'PostgreSQL', 'MongoDB', 'Redis', 'SQLite',
  'Docker', 'GraphQL',
];

export default function CreateRoom() {
  const navigate = useNavigate();
  const { createRoom, isLoading, error } = useRoomStore();

  const [step, setStep] = useState<'form' | 'done'>('form');
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [selectedFW, setSelectedFW] = useState<string[]>(['React', 'FastAPI', 'PostgreSQL']);
  const [maxTeam, setMaxTeam] = useState(4);
  const [roomCode, setRoomCode] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  const toggleFW = (fw: string) => {
    setSelectedFW((s) =>
      s.includes(fw) ? s.filter((f) => f !== fw) : [...s, fw]
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const room = await createRoom(name, brief, selectedFW, maxTeam);
      setRoomCode(room.code);
      setStep('done');
    } catch {
      // error in store
    }
  };

  const shareLink = `${window.location.origin}/join/${roomCode}`;

  const handleCopyLink = async () => {
    await copyToClipboard(shareLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-ms-base">
      <Navbar />

      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-ms-fg3 mb-8">
          <Link to="/dashboard" className="flex items-center gap-1 hover:text-ms-fg transition-colors">
            <ChevronLeft size={14} /> Dashboard
          </Link>
          <span>/</span>
          <span className="text-ms-fg">New room</span>
        </div>

        {step === 'form' ? (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight mb-1">Create a room</h1>
            <p className="text-sm text-ms-fg3 mb-8">Set up your hackathon project and invite your team.</p>

            <form onSubmit={handleCreate} className="space-y-7">
              <Input
                label="Room name"
                placeholder="PingChat"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />

              <Textarea
                label="Project brief"
                placeholder="Describe what you want to build in 2-3 sentences. The more specific, the better the task decomposition."
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                className="min-h-[120px]"
                required
              />

              {/* Framework chips */}
              <div>
                <label className="text-xs font-semibold text-ms-fg2 uppercase tracking-wider block mb-3">
                  Language & framework
                </label>
                <div className="flex flex-wrap gap-2">
                  {FRAMEWORKS.map((fw) => {
                    const selected = selectedFW.includes(fw);
                    return (
                      <button
                        key={fw}
                        type="button"
                        onClick={() => toggleFW(fw)}
                        className={cn(
                          'px-3 py-1.5 rounded-md border text-xs font-semibold transition-all',
                          selected
                            ? 'border-ms-blue/60 bg-ms-blue/15 text-ms-blue'
                            : 'border-ms-border bg-ms-raised text-ms-fg3 hover:text-ms-fg hover:border-ms-border'
                        )}
                      >
                        {fw}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Max teammates */}
              <div>
                <label className="text-xs font-semibold text-ms-fg2 uppercase tracking-wider block mb-3">
                  Max teammates
                </label>
                <div className="flex gap-2">
                  {[2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setMaxTeam(n)}
                      className={cn(
                        'w-10 h-10 rounded-lg border text-sm font-bold transition-all',
                        maxTeam === n
                          ? 'border-ms-blue/60 bg-ms-blue/15 text-ms-blue'
                          : 'border-ms-border bg-ms-raised text-ms-fg3 hover:text-ms-fg'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Upload (coming soon) */}
              <div className="rounded-xl border border-dashed border-ms-border p-5 opacity-60">
                <div className="flex items-center gap-3">
                  <Upload size={18} className="text-ms-fg3" />
                  <div>
                    <div className="text-sm font-semibold text-ms-fg2">Upload existing codebase</div>
                    <div className="text-xs text-ms-fg3">Extend an existing project — coming in v2</div>
                  </div>
                  <span className="ml-auto text-xs font-semibold text-ms-amber border border-ms-amber/30 bg-ms-amber/10 rounded px-2 py-0.5">
                    Soon
                  </span>
                </div>
              </div>

              {error && (
                <div className="text-sm text-ms-red bg-ms-red/10 border border-ms-red/30 rounded-lg p-3">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" size="lg" loading={isLoading}>
                Generate room code <ArrowRight size={16} />
              </Button>
            </form>
          </>
        ) : (
          /* Success state */
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-2xl bg-ms-green/10 border border-ms-green/30 flex items-center justify-center mx-auto mb-6">
              <Check size={24} className="text-ms-green" />
            </div>

            <h1 className="text-2xl font-extrabold tracking-tight mb-2">Room created!</h1>
            <p className="text-ms-fg3 mb-8">Share this code with your teammates to get everyone in.</p>

            {/* Code display */}
            <div className="flex justify-center mb-6">
              <RoomCodeDisplay code={roomCode} size="lg" />
            </div>

            {/* Shareable link */}
            <div className="flex items-center gap-2 bg-ms-surface border border-ms-border rounded-lg px-4 py-3 mb-8 max-w-sm mx-auto">
              <span className="flex-1 text-sm font-mono text-ms-fg3 truncate">{shareLink}</span>
              <button
                onClick={handleCopyLink}
                className={cn(
                  'flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded border transition-colors',
                  linkCopied
                    ? 'border-ms-green/30 bg-ms-green/10 text-ms-green'
                    : 'border-ms-border text-ms-fg2 hover:text-ms-fg'
                )}
              >
                {linkCopied ? <Check size={12} /> : <Copy size={12} />}
                {linkCopied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="flex flex-col gap-3 max-w-xs mx-auto">
              <Button size="lg" onClick={() => navigate(`/rooms/${roomCode}/lobby`)}>
                Go to room lobby <ArrowRight size={16} />
              </Button>
              <Button variant="ghost" size="md" onClick={() => setStep('form')}>
                Edit room settings
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
