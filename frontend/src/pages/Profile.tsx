import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Github, ExternalLink, Eye, EyeOff, Plus, Settings } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Avatar } from '@/components/shared/Avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useUser } from '@/stores/authStore';

const LANGUAGES = [
  { name: 'Python',     pct: 72 },
  { name: 'TypeScript', pct: 54 },
  { name: 'Go',         pct: 28 },
  { name: 'Rust',       pct: 14 },
];

const ACTIVITY = [
  { name: 'PingChat',          icon: '💬', desc: 'Auth + WebSocket + React SPA',  status: 'coding'  as const, code: '4K7P2X' },
  { name: 'Leaderboard Engine',icon: '🏆', desc: 'Go + Redis + TypeScript',        status: 'done'    as const, code: 'R8QN5W' },
  { name: 'Recipe AI',         icon: '🍳', desc: 'Python + FastAPI + React',       status: 'done'    as const, code: 'M2LX9T' },
];

export default function Profile() {
  const user = useUser();
  const [keyVisible, setKeyVisible] = useState(false);

  const displayName = user?.displayName ?? 'Devin Park';
  const email = user?.email ?? 'devin@mosaic.dev';

  return (
    <div className="min-h-screen bg-ms-base">
      <Navbar />
      <div className="max-w-5xl mx-auto px-6 py-10 grid md:grid-cols-[1fr_280px] gap-8">
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
                  <a href={`https://github.com/${user.githubId}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-ms-blue hover:underline mt-1">
                    <Github size={12} /> @{user.githubId}
                  </a>
                )}
              </div>
              <Button variant="ghost" size="sm">Edit profile</Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Rooms', value: '9',  color: 'text-ms-fg' },
                { label: 'Tasks done', value: '31', color: 'text-ms-green' },
                { label: 'Merges', value: '6',  color: 'text-ms-purple' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg border border-ms-border bg-ms-raised p-4 text-center">
                  <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
                  <div className="text-xs text-ms-fg3 mt-1">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Language usage */}
          <div className="rounded-xl border border-ms-border bg-ms-surface p-5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-ms-fg3 mb-4">Languages used</h2>
            <div className="space-y-3">
              {LANGUAGES.map((l) => (
                <div key={l.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{l.name}</span>
                    <span className="text-ms-fg3">{l.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-ms-raised overflow-hidden">
                    <div
                      className="h-full rounded-full bg-ms-blue transition-all"
                      style={{ width: `${l.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Activity */}
          <div className="rounded-xl border border-ms-border bg-ms-surface p-5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-ms-fg3 mb-4">Recent rooms</h2>
            <div className="space-y-3">
              {ACTIVITY.map((a) => (
                <Link
                  key={a.code}
                  to={`/rooms/${a.code}/${a.status === 'done' ? 'merge' : 'lobby'}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-ms-border hover:border-ms-raised hover:bg-ms-raised transition-all group"
                >
                  <span className="text-xl">{a.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{a.name}</div>
                    <div className="text-xs text-ms-fg3 truncate">{a.desc}</div>
                  </div>
                  <Badge variant={a.status === 'coding' ? 'green' : 'purple'}>
                    {a.status === 'coding' ? 'Active' : 'Done'}
                  </Badge>
                  <ExternalLink size={12} className="text-ms-fg3 group-hover:text-ms-fg transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* API keys */}
          <div className="rounded-xl border border-ms-border bg-ms-surface p-5 sticky top-20">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-ms-fg3">API keys</h2>
              <Badge variant="amber">Power user</Badge>
            </div>

            <div className="space-y-3">
              {/* Groq key */}
              <div>
                <div className="text-xs font-semibold text-ms-fg2 mb-1.5">Groq</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 font-mono text-xs bg-ms-raised border border-ms-border rounded px-2.5 py-2 text-ms-fg3 overflow-hidden">
                    {keyVisible ? 'gsk_real_key_would_go_here_12345' : 'gsk_••••••••••••••••••••'}
                  </div>
                  <button
                    onClick={() => setKeyVisible((v) => !v)}
                    className="text-ms-fg3 hover:text-ms-fg transition-colors"
                  >
                    {keyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Add another */}
              <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-dashed border-ms-border text-xs text-ms-fg3 hover:text-ms-fg hover:border-ms-border transition-colors">
                <Plus size={12} /> Add API key
              </button>
            </div>

            <div className="mt-4 pt-4 border-t border-ms-subtle">
              <p className="text-xs text-ms-fg3 leading-relaxed">
                Bring your own API keys for higher rate limits and model access.
              </p>
            </div>
          </div>

          <Link
            to="/settings"
            className="flex items-center justify-between w-full rounded-xl border border-ms-border bg-ms-surface p-4 hover:bg-ms-raised transition-colors"
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Settings size={14} className="text-ms-fg3" />
              Account settings
            </div>
            <ExternalLink size={12} className="text-ms-fg3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
