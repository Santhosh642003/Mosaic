import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Github, Eye, EyeOff, ArrowLeft, Mail } from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/authStore';
import { auth as authApi } from '@/lib/api';
import { cn } from '@/lib/utils';

type Mode = 'login' | 'signup' | 'forgot';

export default function Auth() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login, register, isLoading, error, clearError } = useAuthStore();

  const [mode, setMode] = useState<Mode>((params.get('tab') as Mode) ?? 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  useEffect(() => { clearError(); }, [mode, clearError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (mode === 'signup') {
        await register(email, password, displayName);
      } else if (mode === 'login') {
        await login(email, password);
      } else {
        await authApi.forgotPassword(email);
        setForgotSent(true);
        return;
      }
      const redirect = params.get('redirect') ?? '/dashboard';
      navigate(redirect);
    } catch {
      // error already in store
    }
  };

  const handleGithub = async () => {
    try {
      const { data } = await authApi.githubUrl();
      window.location.href = data.url;
    } catch {
      // fallback direct redirect if API call fails
      window.location.href = '/api/auth/github';
    }
  };

  return (
    <div className="min-h-screen bg-ms-base flex">
      {/* ── Brand panel ─────────────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[46%] flex-col justify-between p-10 bg-ms-deep border-r border-ms-subtle">
        <Link to="/">
          <MosaicLogo size="lg" />
        </Link>

        <div className="space-y-6">
          <div className="text-4xl font-extrabold tracking-tight leading-tight">
            Stop waiting.<br />
            <span className="gradient-text">Ship in parallel.</span>
          </div>
          <p className="text-ms-fg2 leading-relaxed">
            Mosaic gives every hackathon teammate their own AI coding session — simultaneously.
            Decompose, build, merge. In hours, not days.
          </p>
          <div className="flex items-start gap-4 pt-4">
            <div className="w-10 h-10 rounded-full bg-ms-blue flex items-center justify-center text-white text-sm font-bold flex-none">
              MC
            </div>
            <div>
              <p className="text-sm italic text-ms-fg leading-relaxed">
                "We shipped a full-stack real-time chat app in 8 hours using Mosaic.
                All four of us were coding the entire time."
              </p>
              <p className="mt-2 text-xs text-ms-fg3">Maya Chen · HackMIT 2025</p>
            </div>
          </div>
        </div>

        <div className="text-xs text-ms-fg3">
          Trusted at HackMIT · MLH Global Hack · ETHGlobal
        </div>
      </div>

      {/* ── Auth card ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8 flex justify-center">
            <Link to="/"><MosaicLogo /></Link>
          </div>

          {mode !== 'forgot' ? (
            <>
              {/* Tab switcher */}
              <div className="flex border border-ms-border rounded-lg p-0.5 mb-6 bg-ms-surface">
                {(['login', 'signup'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      'flex-1 py-2 text-sm font-semibold rounded-md transition-all',
                      mode === m
                        ? 'bg-ms-raised text-ms-fg shadow-sm'
                        : 'text-ms-fg3 hover:text-ms-fg2'
                    )}
                  >
                    {m === 'login' ? 'Log in' : 'Sign up'}
                  </button>
                ))}
              </div>

              <div className="mb-6">
                <h1 className="text-xl font-bold mb-1">
                  {mode === 'login' ? 'Welcome back' : 'Create your account'}
                </h1>
                <p className="text-sm text-ms-fg3">
                  {mode === 'login'
                    ? 'Sign in to access your rooms and history'
                    : 'Get started — no credit card required'}
                </p>
              </div>

              {/* OAuth */}
              <div className="flex flex-col gap-2 mb-5">
                <button
                  onClick={handleGithub}
                  className="flex items-center justify-center gap-2 w-full h-9 rounded-md border border-ms-border bg-ms-raised text-sm font-semibold text-ms-fg hover:bg-ms-border transition-colors"
                >
                  <Github size={16} />
                  Continue with GitHub
                </button>
                <button className="flex items-center justify-center gap-2 w-full h-9 rounded-md border border-ms-border bg-ms-raised text-sm font-semibold text-ms-fg hover:bg-ms-border transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>
              </div>

              <div className="flex items-center gap-3 mb-5">
                <div className="flex-1 h-px bg-ms-subtle" />
                <span className="text-xs text-ms-fg3">or</span>
                <div className="flex-1 h-px bg-ms-subtle" />
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'signup' && (
                  <Input
                    label="Display name"
                    placeholder="Arjun Patel"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                  />
                )}
                <Input
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <div className="flex flex-col gap-1.5">
                  <div className="relative">
                    <Input
                      label="Password"
                      type={showPw ? 'text' : 'password'}
                      placeholder={mode === 'signup' ? 'Min 8 characters' : '••••••••'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={mode === 'signup' ? 8 : undefined}
                      error={error ?? undefined}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-8 text-ms-fg3 hover:text-ms-fg2 transition-colors"
                    >
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {mode === 'login' && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => setMode('forgot')}
                      className="text-xs text-ms-blue hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                <Button type="submit" className="w-full" loading={isLoading}>
                  {mode === 'login' ? 'Sign in' : 'Create account'}
                </Button>
              </form>

              {mode === 'signup' && (
                <p className="mt-4 text-xs text-ms-fg3 text-center leading-relaxed">
                  By creating an account you agree to our{' '}
                  <a href="#" className="text-ms-blue hover:underline">Terms</a> and{' '}
                  <a href="#" className="text-ms-blue hover:underline">Privacy Policy</a>.
                </p>
              )}
            </>
          ) : (
            /* Forgot password flow */
            <div>
              <button
                onClick={() => { setMode('login'); setForgotSent(false); }}
                className="flex items-center gap-1.5 text-sm text-ms-fg3 hover:text-ms-fg mb-6 transition-colors"
              >
                <ArrowLeft size={14} /> Back to sign in
              </button>

              {forgotSent ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-full bg-ms-green/10 border border-ms-green/30 flex items-center justify-center mx-auto mb-4">
                    <Mail size={20} className="text-ms-green" />
                  </div>
                  <h2 className="text-lg font-bold mb-2">Check your email</h2>
                  <p className="text-sm text-ms-fg2">
                    We sent a reset link to <strong className="text-ms-fg">{email}</strong>
                  </p>
                </div>
              ) : (
                <>
                  <h2 className="text-xl font-bold mb-1">Reset your password</h2>
                  <p className="text-sm text-ms-fg3 mb-6">
                    We'll send a reset link to your email address.
                  </p>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <Input
                      label="Email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                    <Button type="submit" className="w-full" loading={isLoading}>
                      Send reset link
                    </Button>
                  </form>
                </>
              )}
            </div>
          )}

          {/* Guest note */}
          <div className="mt-8 p-3 rounded-lg border border-ms-subtle bg-ms-surface text-center">
            <p className="text-xs text-ms-fg3">
              Joining a room?{' '}
              <Link to="/join" className="text-ms-blue hover:underline font-semibold">
                Enter code as guest
              </Link>{' '}
              — no account needed
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
