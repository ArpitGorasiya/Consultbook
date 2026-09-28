import { CalendarDays, CircleUserRound, LogOut, ShieldCheck, Sparkles } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Shell() {
  const { user, clear } = useAuth();
  const navigate = useNavigate();
  async function logout() {
    try {
      await api.post('/auth/logout');
    } finally {
      clear();
      navigate('/login');
      toast.success('Signed out');
    }
  }
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Sparkles size={17} />
          </span>
          <span>
            consultbook<span className="brand-live">live</span>
          </span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          {user?.role === 'ADMIN' ? (
            <NavLink to="/admin">
              <ShieldCheck size={16} /> Operations
            </NavLink>
          ) : (
            <NavLink to="/">
              <CalendarDays size={16} /> Book a session
            </NavLink>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">{user?.name.slice(0, 1).toUpperCase()}</div>
          <div className="profile-copy">
            <strong>{user?.name}</strong>
            <span>{user?.role === 'ADMIN' ? 'Administrator' : 'Client account'}</span>
          </div>
          <button className="icon-button" title="Sign out" onClick={() => void logout()}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-kicker">
            CONSULTATIONS / <span>{user?.role === 'ADMIN' ? 'OPERATIONS' : 'SCHEDULING'}</span>
          </div>
          <div className="topbar-right">
            <span className="live-dot" /> Live availability <CircleUserRound size={17} />
          </div>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
