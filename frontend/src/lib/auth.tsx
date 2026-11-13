"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, UserProfile } from "@/lib/api";

const DEFAULT_PUBLIC_USER: UserProfile = {
  user_id: "public",
  role: "public",
  display_name: "Public Visitor",
  is_authenticated: false,
};

interface AuthContextValue {
  user: UserProfile;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: DEFAULT_PUBLIC_USER,
  loading: true,
  error: null,
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile>(DEFAULT_PUBLIC_USER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = await api.getMe();
      setUser(profile);
    } catch (err) {
      setUser(DEFAULT_PUBLIC_USER);
      setError(err instanceof Error ? err.message : "Could not verify session.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    api
      .getMe()
      .then((profile) => {
        if (active) {
          setUser(profile);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setUser(DEFAULT_PUBLIC_USER);
          setError(err instanceof Error ? err.message : "Could not verify session.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(DEFAULT_PUBLIC_USER);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

