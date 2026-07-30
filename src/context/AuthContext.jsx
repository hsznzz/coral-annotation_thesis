import { createContext, useContext, useEffect, useState } from 'react';
import { authService } from '../api/services/authService.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    authService
      .getCurrentUser()
      .then((p) => {
        if (active) setProfile(p);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const unsubscribe = authService.onAuthStateChange(async (session) => {
      if (!session?.user) {
        if (active) setProfile(null);
        return;
      }
      try {
        const p = await authService.getProfile(session.user.id);
        if (active) setProfile(p);
      } catch {
        if (active) setProfile(null);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const logout = async () => {
    await authService.logout();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ profile, loading, isAdmin: profile?.role === 'admin', logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook belongs with its provider
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
