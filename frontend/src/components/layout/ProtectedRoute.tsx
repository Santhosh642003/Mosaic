import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useUser } from '@/stores/authStore';

export function ProtectedRoute() {
  const user = useUser();
  const location = useLocation();

  if (!user) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent(location.pathname)}`} replace />;
  }

  return <Outlet />;
}

/** Redirect authenticated users away from auth pages. */
export function PublicOnlyRoute() {
  const user = useUser();
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get('redirect') ?? '/dashboard';

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}
