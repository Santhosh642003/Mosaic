import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { useAuthStore } from '@/stores/authStore';

/**
 * Handles the GitHub OAuth redirect. The backend redirects the browser here
 * with either `?token=<jwt>` on success or `?error=<message>` on failure.
 */
export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setToken, fetchMe } = useAuthStore();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = params.get('token');
    const errParam = params.get('error');

    if (errParam) {
      setError(errParam);
      return;
    }
    if (!token) {
      setError('No authentication token received.');
      return;
    }

    (async () => {
      setToken(token);
      await fetchMe();
      const redirect = params.get('redirect') ?? '/dashboard';
      navigate(redirect, { replace: true });
    })();
  }, [params, setToken, fetchMe, navigate]);

  return (
    <div className="min-h-screen bg-ms-base flex flex-col items-center justify-center p-6">
      <MosaicLogo size="lg" className="mb-8" />
      {error ? (
        <div className="w-full max-w-sm flex items-start gap-2 text-sm text-ms-red bg-ms-red/10 border border-ms-red/30 rounded-lg p-4">
          <AlertCircle size={16} className="mt-0.5 flex-none" />
          <div>
            <p className="font-semibold mb-1">Sign-in failed</p>
            <p className="text-ms-red/80">{error}</p>
            <button
              onClick={() => navigate('/auth', { replace: true })}
              className="mt-3 text-ms-blue hover:underline font-semibold"
            >
              Back to sign in
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-ms-blue animate-bounce"
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </div>
          <p className="text-sm text-ms-fg3">Completing sign-in…</p>
        </div>
      )}
    </div>
  );
}
