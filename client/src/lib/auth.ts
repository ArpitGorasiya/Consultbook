import { create } from 'zustand';
import { api, setAccessToken } from './api';

export type User = { id: string; name: string; email: string; role: 'CUSTOMER' | 'ADMIN' };
type AuthState = {
  user: User | null;
  ready: boolean;
  setSession: (user: User, token: string) => void;
  clear: () => void;
  restore: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  setSession: (user, token) => {
    sessionStorage.setItem('consultbook-access-token', token);
    setAccessToken(token);
    set({ user, ready: true });
  },
  clear: () => {
    sessionStorage.removeItem('consultbook-access-token');
    setAccessToken('');
    set({ user: null, ready: true });
  },
  restore: async () => {
    const savedToken = sessionStorage.getItem('consultbook-access-token');
    if (savedToken) {
      setAccessToken(savedToken);
      try {
        const current = await api.get<{ user: User }>('/auth/me');
        set({ user: current.data.user, ready: true });
        return;
      } catch {
        sessionStorage.removeItem('consultbook-access-token');
        setAccessToken('');
      }
    }
    try {
      const refreshed = await api.post<{ accessToken: string }>('/auth/refresh');
      sessionStorage.setItem('consultbook-access-token', refreshed.data.accessToken);
      setAccessToken(refreshed.data.accessToken);
      const current = await api.get<{ user: User }>('/auth/me');
      set({ user: current.data.user, ready: true });
    } catch {
      setAccessToken('');
      set({ user: null, ready: true });
    }
  },
}));
