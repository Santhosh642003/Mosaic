import { useNavigate } from 'react-router-dom';
import { ArrowRight, Zap, GitMerge, Users, Code2, Shield, Clock } from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { Button } from '@/components/ui/button';
import { useUser } from '@/stores/authStore';

const STEPS = [
  {
    num: '01',
    icon: Zap,
    color: '#A371F7',
    title: 'Decompose',
    desc: 'Paste your project brief. Mosaic AI breaks it into 3–5 parallelizable tasks with defined interface contracts — function signatures, API schemas, data models.',
  },
  {
    num: '02',
    icon: Code2,
    color: '#4F8EF7',
    title: 'Build in parallel',
    desc: "Each teammate gets their own AI coding session scoped to their task. Monaco editor + Mosaic AI as co-pilot. Everyone ships simultaneously.",
  },
  {
    num: '03',
    icon: GitMerge,
    color: '#3FB950',
    title: 'Semantic merge',
    desc: 'Mosaic AI reviews all codebases, resolves integration conflicts semantically, and produces a unified working project downloadable as a ZIP.',
  },
];

const FEATURES = [
  {
    icon: Users,
    color: '#4F8EF7',
    title: 'Everyone codes at once',
    desc: 'Stop waiting for your turn. Every teammate has their own isolated AI coding environment running in parallel.',
  },
  {
    icon: Shield,
    color: '#A371F7',
    title: 'Interface contracts',
    desc: 'AI defines shared function signatures and API schemas upfront. Every session respects the contract — no integration surprises.',
  },
  {
    icon: GitMerge,
    color: '#3FB950',
    title: 'Semantic AI merge',
    desc: "Not just line diffs. Mosaic understands what your code does and resolves cross-branch conflicts the way a senior dev would.",
  },
  {
    icon: Clock,
    color: '#D29922',
    title: 'Live teammate status',
    desc: 'See who\'s coding, who\'s blocked, who\'s done — in real time. No Slack pinging required.',
  },
];

const TASKS = [
  { id: 'T1', color: '#4F8EF7', name: 'Auth service', owner: 'Maya', status: 'Done' },
  { id: 'T2', color: '#3FB950', name: 'Message API', owner: 'Arjun', status: 'Coding' },
  { id: 'T3', color: '#A371F7', name: 'WebSocket gateway', owner: 'Sofia', status: 'Coding' },
  { id: 'T4', color: '#D29922', name: 'React frontend', owner: 'Devon', status: 'Blocked' },
];

const STATUS_COLORS: Record<string, string> = {
  Done: '#A371F7', Coding: '#3FB950', Blocked: '#D29922',
};

export default function Landing() {
  const navigate = useNavigate();
  const user = useUser();

  return (
    <div className="min-h-screen bg-ms-base font-sans">
      {/* ── Navbar ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 h-14 border-b border-ms-subtle bg-ms-surface/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto h-full px-6 flex items-center gap-6">
          <MosaicLogo />
          <nav className="hidden md:flex items-center gap-5 flex-1">
            <a href="#features" className="text-sm text-ms-fg2 hover:text-ms-fg transition-colors">Features</a>
            <a href="#how" className="text-sm text-ms-fg2 hover:text-ms-fg transition-colors">How it works</a>
          </nav>
          <div className="flex items-center gap-2 ml-auto">
            {user ? (
              <Button size="sm" onClick={() => navigate('/dashboard')}>
                Dashboard <ArrowRight size={14} />
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => navigate('/auth')}>Sign in</Button>
                <Button size="sm" onClick={() => navigate('/auth?tab=signup')}>Start for free</Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative pt-24 pb-20 px-6 text-center overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-ms-blue/5 blur-[80px] rounded-full" />
          <div className="absolute top-20 left-1/3 w-[300px] h-[200px] bg-ms-purple/5 blur-[60px] rounded-full" />
        </div>

        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-ms-blue/30 bg-ms-blue/10 text-ms-blue text-xs font-semibold mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-ms-blue animate-ms-pulse" />
            Built for hackathon teams · Powered by Llama 3.3 70B
          </div>

          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.1] mb-6">
            Stop taking turns.
            <br />
            <span className="gradient-text">Ship together.</span>
          </h1>

          <p className="text-lg text-ms-fg2 max-w-xl mx-auto mb-10 leading-relaxed">
            Mosaic decomposes your hackathon project into parallel tasks, gives each teammate
            their own AI coding session, then semantically merges everything into one working codebase.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" onClick={() => navigate('/rooms/new')} className="w-full sm:w-auto">
              Start a room <ArrowRight size={16} />
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate('/join')} className="w-full sm:w-auto">
              Join with code
            </Button>
          </div>

          <p className="mt-4 text-xs text-ms-fg3">No account needed to join a room</p>
        </div>

        {/* Faux product preview */}
        <div className="relative max-w-4xl mx-auto mt-16">
          <div className="rounded-xl border border-ms-border bg-ms-deep overflow-hidden shadow-2xl">
            {/* Window chrome */}
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-ms-subtle bg-ms-surface">
              <div className="w-3 h-3 rounded-full bg-ms-red/60" />
              <div className="w-3 h-3 rounded-full bg-ms-amber/60" />
              <div className="w-3 h-3 rounded-full bg-ms-green/60" />
              <span className="ml-3 text-xs font-mono text-ms-fg3">mosaic.dev · PingChat · Arjun — Message API</span>
            </div>
            {/* 3-panel preview */}
            <div className="grid grid-cols-[160px_1fr_220px] h-56">
              {/* Left: file tree */}
              <div className="border-r border-ms-subtle p-3 space-y-1">
                <p className="text-[10px] font-semibold text-ms-fg3 uppercase tracking-wider mb-2">Files</p>
                {['messages.py', 'models.py', 'router.py'].map((f, i) => (
                  <div key={f} className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono cursor-pointer transition-colors ${i === 0 ? 'bg-ms-blue/20 text-ms-blue' : 'text-ms-fg3 hover:text-ms-fg hover:bg-ms-raised'}`}>
                    <span>{i === 0 ? '▶' : ' '}</span>{f}
                  </div>
                ))}
              </div>
              {/* Center: editor */}
              <div className="p-4 font-mono text-[11px] text-ms-fg overflow-hidden">
                <div className="text-ms-fg3 mb-1">{'// messages.py · line 24'}</div>
                {[
                  { n: 24, code: <><span className="text-ms-purple">async def</span> <span className="text-ms-blue">save_message</span><span className="text-ms-fg">(room_id: str, msg: MessageIn):</span></> },
                  { n: 25, code: <><span className="text-ms-fg3">    </span><span className="text-ms-purple">async with</span> <span className="text-ms-fg">Session() </span><span className="text-ms-purple">as</span> <span className="text-ms-fg">db:</span></> },
                  { n: 26, code: <><span className="text-ms-fg3">        </span><span className="text-ms-fg">record = Message(room_id=room_id, **msg.dict())</span></> },
                  { n: 27, code: <><span className="text-ms-fg3">        </span><span className="text-ms-fg">db.add(record)</span></> },
                  { n: 28, code: <><span className="text-ms-fg3">        </span><span className="text-ms-purple">await</span> <span className="text-ms-fg">db.commit()</span></> },
                  { n: 29, code: <><span className="text-ms-fg3">        </span><span className="text-ms-purple">return</span> <span className="text-ms-fg">record.to_dict()</span></> },
                ].map(({ n, code }) => (
                  <div key={n} className="flex gap-3 leading-5">
                    <span className="text-ms-fg3 w-5 select-none text-right">{n}</span>
                    <span>{code}</span>
                  </div>
                ))}
              </div>
              {/* Right: AI chat */}
              <div className="border-l border-ms-subtle p-3 flex flex-col gap-2">
                <p className="text-[10px] font-semibold text-ms-fg3 uppercase tracking-wider">AI Chat · Mosaic AI</p>
                <div className="bg-ms-raised rounded p-2 text-[11px] text-ms-fg2 leading-4">
                  Add error handling for duplicate messages and return a 409 status
                </div>
                <div className="bg-ms-blue/10 border border-ms-blue/20 rounded p-2 text-[11px] text-ms-fg leading-4">
                  I'll add a unique constraint check. Here's the updated handler with proper error codes...
                </div>
                <div className="mt-auto flex items-center gap-1.5 bg-ms-raised rounded px-2 py-1.5">
                  <span className="text-[10px] text-ms-fg3 flex-1">Ask AI…</span>
                  <span className="text-ms-blue text-[10px]">↵</span>
                </div>
              </div>
            </div>
          </div>
          {/* Team status bar below preview */}
          <div className="mt-3 flex items-center justify-center gap-3 flex-wrap">
            {TASKS.map((t) => (
              <div key={t.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs"
                style={{ borderColor: `${STATUS_COLORS[t.status]}30`, background: `${STATUS_COLORS[t.status]}10`, color: STATUS_COLORS[t.status] }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLORS[t.status] }} />
                {t.owner} · {t.name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section id="how" className="py-20 px-6 border-t border-ms-subtle">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-ms-blue mb-3">How it works</p>
            <h2 className="text-3xl font-extrabold tracking-tight">From brief to codebase in 3 steps</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map((step, i) => (
              <div key={step.num} className="relative">
                {i < 2 && (
                  <div className="hidden md:block absolute top-8 left-full w-full h-px border-t border-dashed border-ms-border z-0" style={{ width: 'calc(100% + 2rem)', left: 'calc(100% - 1rem)' }} />
                )}
                <div className="relative z-10 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: `${step.color}20`, border: `1px solid ${step.color}40` }}>
                      <step.icon size={18} style={{ color: step.color }} />
                    </div>
                    <span className="font-mono text-xs text-ms-fg3">{step.num}</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold mb-2">{step.title}</h3>
                    <p className="text-sm text-ms-fg2 leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section id="features" className="py-20 px-6 border-t border-ms-subtle">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-ms-purple mb-3">Features</p>
            <h2 className="text-3xl font-extrabold tracking-tight">Everything a hackathon team needs</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title}
                className="rounded-xl border border-ms-border bg-ms-surface p-6 hover:border-ms-raised transition-all hover:-translate-y-0.5">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-4"
                  style={{ background: `${f.color}20`, border: `1px solid ${f.color}30` }}>
                  <f.icon size={16} style={{ color: f.color }} />
                </div>
                <h3 className="font-bold mb-2">{f.title}</h3>
                <p className="text-sm text-ms-fg2 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Running example ─────────────────────────────────────────────── */}
      <section className="py-20 px-6 border-t border-ms-subtle">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl border border-ms-border bg-ms-surface p-8 md:p-10">
            <div className="flex flex-col md:flex-row gap-8 items-start">
              <div className="flex-1">
                <div className="text-xs font-bold uppercase tracking-widest text-ms-fg3 mb-2">Example project</div>
                <h3 className="text-2xl font-extrabold tracking-tight mb-3">PingChat</h3>
                <p className="text-ms-fg2 text-sm leading-relaxed mb-4">
                  "Build a real-time chat app with auth, message history, WebSocket support, and a React frontend.
                  Deploy-ready with PostgreSQL and Redis."
                </p>
                <div className="text-xs text-ms-fg3">4 teammates · TypeScript + FastAPI + React</div>
              </div>
              <div className="flex-1 space-y-2">
                {TASKS.map((t) => (
                  <div key={t.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-ms-border bg-ms-raised">
                    <div className="w-1 h-10 rounded-full flex-none" style={{ background: t.color }} />
                    <div className="font-mono text-xs text-ms-fg3 w-5">{t.id}</div>
                    <div className="flex-1 text-sm font-semibold">{t.name}</div>
                    <div className="text-xs text-ms-fg3">{t.owner}</div>
                    <div className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ color: STATUS_COLORS[t.status], background: `${STATUS_COLORS[t.status]}15` }}>
                      {t.status}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Testimonial ─────────────────────────────────────────────────── */}
      <section className="py-20 px-6 border-t border-ms-subtle text-center">
        <div className="max-w-2xl mx-auto">
          <div className="flex justify-center gap-1 mb-6">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className="text-ms-amber text-lg">★</span>
            ))}
          </div>
          <blockquote className="text-xl font-medium leading-relaxed text-ms-fg mb-6">
            "We used Mosaic at HackMIT and shipped a full-stack app in 8 hours.
            Our fourth teammate was unblocked 20 minutes in — previously she'd have waited 4 hours."
          </blockquote>
          <div className="flex items-center justify-center gap-3">
            <div className="w-9 h-9 rounded-full bg-ms-blue flex items-center justify-center text-white text-sm font-bold">
              MC
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold">Maya Chen</div>
              <div className="text-xs text-ms-fg3">Team Lead · HackMIT 2025</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <section className="py-20 px-6 border-t border-ms-subtle">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold tracking-tight mb-4">
            Your next hackathon starts <span className="gradient-text">now</span>
          </h2>
          <p className="text-ms-fg2 mb-8">
            Create a room in 30 seconds. No credit card. No setup. Just ship.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" onClick={() => navigate('/rooms/new')}>
              Start a room — it's free <ArrowRight size={16} />
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate('/join')}>
              Join with code
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-ms-subtle py-10 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <MosaicLogo size="sm" />
          <div className="flex items-center gap-5 text-xs text-ms-fg3">
            <a href="#" className="hover:text-ms-fg transition-colors">Privacy</a>
            <a href="#" className="hover:text-ms-fg transition-colors">Terms</a>
            <a href="https://github.com" className="hover:text-ms-fg transition-colors">GitHub</a>
          </div>
          <div className="text-xs text-ms-fg3">© 2026 Mosaic · Built for builders</div>
        </div>
      </footer>
    </div>
  );
}
