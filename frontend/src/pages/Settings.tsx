import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { users as usersApi } from '@/lib/api';

type Theme = 'dark' | 'light' | 'system';
type Lang  = 'Python' | 'TypeScript' | 'Go';

const THEMES: { key: Theme; label: string; swatch: string[] }[] = [
  { key: 'dark',   label: 'Dark',   swatch: ['#0D1117', '#161B22', '#4F8EF7'] },
  { key: 'light',  label: 'Light',  swatch: ['#F5F5F5', '#FFFFFF', '#0969DA'] },
  { key: 'system', label: 'System', swatch: ['#0D1117', '#F5F5F5', '#4F8EF7'] },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-widest text-ms-fg3 mb-4">{title}</h2>
      <div className="rounded-xl border border-ms-border bg-ms-surface p-5">
        {children}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        'relative w-9 h-5 rounded-full transition-colors flex-none',
        checked ? 'bg-ms-blue' : 'bg-ms-raised border border-ms-border'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all',
          checked ? 'left-[18px]' : 'left-0.5'
        )}
      />
    </button>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const [theme, setTheme] = useState<Theme>('dark');
  const [lang, setLang]   = useState<Lang>('Python');
  const [notif, setNotif] = useState({ blocked: true, merge: true, mention: false });
  const [showDanger, setShowDanger] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteError('');
    try {
      await usersApi.deleteAccount();
      logout();
      navigate('/');
    } catch (e) {
      setDeleteError((e as Error).message);
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-ms-base">
      <Navbar />
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight mb-1">Settings</h1>
          <p className="text-sm text-ms-fg3">Preferences and account configuration</p>
        </div>

        {/* Theme */}
        <Section title="Appearance">
          <div className="flex gap-3">
            {THEMES.map((t) => (
              <button
                key={t.key}
                onClick={() => setTheme(t.key)}
                className={cn(
                  'flex-1 rounded-xl border p-4 text-left transition-all',
                  theme === t.key
                    ? 'border-ms-blue/60 bg-ms-blue/10'
                    : 'border-ms-border bg-ms-raised hover:border-ms-border'
                )}
              >
                <div className="flex gap-1 mb-3">
                  {t.swatch.map((c, i) => (
                    <div key={i} className="w-4 h-4 rounded-full" style={{ background: c }} />
                  ))}
                </div>
                <div className={cn('text-sm font-semibold', theme === t.key ? 'text-ms-blue' : 'text-ms-fg2')}>
                  {t.label}
                </div>
              </button>
            ))}
          </div>
        </Section>

        {/* Defaults */}
        <Section title="Defaults">
          <div className="space-y-5">
            <div>
              <label className="text-xs font-semibold text-ms-fg3 uppercase tracking-wider block mb-2">
                Default language
              </label>
              <div className="flex gap-1 p-1 bg-ms-raised border border-ms-border rounded-lg">
                {(['Python', 'TypeScript', 'Go'] as Lang[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={cn(
                      'flex-1 py-1.5 rounded text-sm font-semibold transition-all',
                      lang === l
                        ? 'bg-ms-surface text-ms-fg shadow-sm'
                        : 'text-ms-fg3 hover:text-ms-fg2'
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <div className="space-y-4">
            {[
              { key: 'blocked' as const, label: 'Teammate blocked', sub: 'Notify when a teammate hits a blocker' },
              { key: 'merge'   as const, label: 'Merge complete',   sub: 'Notify when the merge finishes' },
              { key: 'mention' as const, label: 'Mentions',         sub: 'Notify when someone @-mentions you' },
            ].map((n) => (
              <div key={n.key} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{n.label}</div>
                  <div className="text-xs text-ms-fg3">{n.sub}</div>
                </div>
                <Toggle
                  checked={notif[n.key]}
                  onChange={() => setNotif((s) => ({ ...s, [n.key]: !s[n.key] }))}
                />
              </div>
            ))}
          </div>
        </Section>

        {/* Danger zone */}
        <Section title="Danger zone">
          {!showDanger ? (
            <button
              onClick={() => setShowDanger(true)}
              className="text-sm font-semibold text-ms-red border border-ms-red/30 bg-ms-red/5 hover:bg-ms-red/10 rounded-lg px-4 py-2 transition-colors"
            >
              Delete account
            </button>
          ) : (
            <div className="rounded-lg border border-ms-red/40 bg-ms-red/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={14} className="text-ms-red flex-none" />
                <span className="text-sm font-bold text-ms-red">This cannot be undone</span>
              </div>
              <p className="text-sm text-ms-fg2 mb-4">
                All your rooms, codebases, and history will be permanently deleted.
              </p>
              {deleteError && (
                <p className="text-xs text-ms-red mb-3">{deleteError}</p>
              )}
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" loading={isDeleting} onClick={handleDeleteAccount}>
                  Yes, delete everything
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowDanger(false)} disabled={isDeleting}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
