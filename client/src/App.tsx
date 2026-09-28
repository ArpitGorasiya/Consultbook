import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Shell } from './components/Shell';
import { BookingPage } from './pages/BookingPage';
import { AdminPage } from './pages/AdminPage';
import { SignInPage } from './pages/SignInPage';

export default function App() {
  const { user, ready, restore } = useAuth();
  useEffect(() => {
    void restore();
  }, [restore]);
  if (!ready) return <main className="loading-screen">Opening your studio...</main>;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <SignInPage />} />
      <Route path="/" element={user ? <Shell /> : <Navigate to="/login" replace />}>
        <Route
          index
          element={user?.role === 'ADMIN' ? <Navigate to="/admin" replace /> : <BookingPage />}
        />
        <Route
          path="admin"
          element={user?.role === 'ADMIN' ? <AdminPage /> : <Navigate to="/" replace />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
