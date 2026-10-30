import { useState, useEffect, useCallback } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
}

interface LoginPayload {
  email: string;
  password: string;
}

interface RegisterPayload {
  email: string;
  password: string;
}

interface AuthResponse {
  user: AuthUser;
}

const AUTH_BASE = '/api/auth';

export function useAuth(): AuthState & {
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<AuthUser | null>;
} {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchMe = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const { data } = await axiosForBackend.get<AuthResponse>(
        `${AUTH_BASE}/me`,
      );
      setUser(data.user);
      return data.user;
    } catch (error: unknown) {
      // 401 或其他错误 → user=null，不跳转
      logger.debug('fetchMe: 用户未登录或请求失败', error);
      setUser(null);
      return null;
    }
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      const payload: LoginPayload = { email, password };
      const { data } = await axiosForBackend.post<AuthResponse>(
        `${AUTH_BASE}/login`,
        payload,
      );
      setUser(data.user);
      return data.user;
    },
    [],
  );

  const register = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      const payload: RegisterPayload = { email, password };
      const { data } = await axiosForBackend.post<AuthResponse>(
        `${AUTH_BASE}/register`,
        payload,
      );
      setUser(data.user);
      return data.user;
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await axiosForBackend.post(`${AUTH_BASE}/logout`);
    } catch (error: unknown) {
      logger.error('登出请求失败', error);
    } finally {
      setUser(null);
    }
  }, []);

  // 初始加载时验证登录态
  useEffect(() => {
    let mounted: boolean = true;
    setLoading(true);
    fetchMe().finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [fetchMe]);

  return { user, loading, login, register, logout, fetchMe };
}
