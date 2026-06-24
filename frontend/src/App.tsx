import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { ProtectedRoute, PublicOnlyRoute } from '@/components/layout/ProtectedRoute';

const Landing      = lazy(() => import('@/pages/Landing'));
const Auth         = lazy(() => import('@/pages/Auth'));
const Dashboard    = lazy(() => import('@/pages/Dashboard'));
const CreateRoom   = lazy(() => import('@/pages/CreateRoom'));
const JoinRoom     = lazy(() => import('@/pages/JoinRoom'));
const Lobby        = lazy(() => import('@/pages/Lobby'));
const Decomposition = lazy(() => import('@/pages/Decomposition'));
const CodingSession = lazy(() => import('@/pages/CodingSession'));
const MergePage    = lazy(() => import('@/pages/Merge'));
const Profile      = lazy(() => import('@/pages/Profile'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
const Errors       = lazy(() => import('@/pages/Errors'));
const NotFound     = lazy(() => import('@/pages/NotFound'));

function PageLoader() {
  return (
    <div className="min-h-screen bg-ms-base flex items-center justify-center">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-ms-blue animate-bounce"
            style={{ animationDelay: `${i * 0.12}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Landing />} />
          <Route path="/join" element={<JoinRoom />} />
          <Route path="/join/:code" element={<JoinRoom />} />
          <Route path="/errors" element={<Errors />} />

          {/* Auth — redirect if already signed in */}
          <Route element={<PublicOnlyRoute />}>
            <Route path="/auth" element={<Auth />} />
          </Route>

          {/* Protected — must be signed in */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/rooms/new" element={<CreateRoom />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          {/* Room routes — accessible to guests who have joined */}
          <Route path="/rooms/:code/lobby" element={<Lobby />} />
          <Route path="/rooms/:code/decompose" element={<Decomposition />} />
          <Route path="/rooms/:code/code" element={<CodingSession />} />
          <Route path="/rooms/:code/merge" element={<MergePage />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
