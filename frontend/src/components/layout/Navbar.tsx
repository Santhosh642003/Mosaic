import { Link, useNavigate } from 'react-router-dom';
import { LogOut, User, Settings } from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { Avatar } from '@/components/shared/Avatar';
import { Button } from '@/components/ui/button';
import { useAuthStore, useUser } from '@/stores/authStore';
import { useState, useRef, useEffect } from 'react';

export function Navbar() {
  const user = useUser();
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-ms-subtle bg-ms-surface/90 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto h-full px-6 flex items-center gap-6">
        <Link to="/" className="flex-none">
          <MosaicLogo />
        </Link>

        {/* Public nav links */}
        <nav className="hidden md:flex items-center gap-5 flex-1">
          <a href="/#features" className="text-sm text-ms-fg2 hover:text-ms-fg transition-colors">
            Features
          </a>
          <a href="/#how" className="text-sm text-ms-fg2 hover:text-ms-fg transition-colors">
            How it works
          </a>
        </nav>

        <div className="flex items-center gap-2 ml-auto">
          {user ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => navigate('/rooms/new')}>
                New Room
              </Button>
              <div className="relative" ref={menuRef}>
                <button onClick={() => setMenuOpen((o) => !o)} className="rounded-full focus:outline-none focus:ring-2 focus:ring-ms-blue">
                  <Avatar name={user.displayName} size="sm" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-52 bg-ms-surface border border-ms-border rounded-xl shadow-2xl py-1 z-50 animate-ms-rise">
                    <div className="px-3 py-2 border-b border-ms-subtle">
                      <p className="text-sm font-semibold text-ms-fg">{user.displayName}</p>
                      <p className="text-xs text-ms-fg3 truncate">{user.email}</p>
                    </div>
                    <Link
                      to="/profile"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-ms-fg2 hover:text-ms-fg hover:bg-ms-raised transition-colors"
                    >
                      <User size={14} /> Profile
                    </Link>
                    <Link
                      to="/settings"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-ms-fg2 hover:text-ms-fg hover:bg-ms-raised transition-colors"
                    >
                      <Settings size={14} /> Settings
                    </Link>
                    <hr className="border-ms-subtle my-1" />
                    <button
                      onClick={() => { logout(); navigate('/'); setMenuOpen(false); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-ms-red hover:bg-ms-red/10 transition-colors"
                    >
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => navigate('/auth')}>
                Sign in
              </Button>
              <Button size="sm" onClick={() => navigate('/auth?tab=signup')}>
                Start for free
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
