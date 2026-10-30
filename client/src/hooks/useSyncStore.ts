import { useCallback, useRef, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { useGuestStore, type GuestData, type GuestRecord } from './useGuestStore';

const USER_SYNC_URL = '/api/user/sync';

interface SyncResponse {
  success: boolean;
  data: GuestData;
}

interface FetchUserDataResponse {
  data: GuestData;
}

export function useSyncStore(): {
  user: ReturnType<typeof useAuth>['user'];
  authLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<ReturnType<typeof useAuth>['user']>;
  mergeGuestToCloud: () => Promise<void>;
  favorites: string[];
  toggleFavorite: (matchId: string) => void;
  isFavorite: (matchId: string) => boolean;
  addFavorite: (matchId: string) => void;
  removeFavorite: (matchId: string) => void;
  followedTeams: string[];
  followTeam: (teamName: string) => void;
  unfollowTeam: (teamName: string) => void;
  isFollowingTeam: (teamName: string) => boolean;
  settings: Record<string, unknown>;
  updateSettings: (partial: Record<string, unknown>) => void;
  getSetting: (key: string) => unknown;
  records: GuestRecord[];
  addRecord: (record: GuestRecord) => void;
  clearRecords: () => void;
  syncToCloud: () => Promise<void>;
  fetchFromCloud: () => Promise<GuestData | null>;
} {
  const { user, loading: authLoading, login: authLogin, register: authRegister, logout: authLogout, fetchMe } = useAuth();
  const guestStore = useGuestStore();
  const syncTimerRef = useRef<number | null>(null);

  // 登录后拉取云端数据并合并
  const fetchFromCloud = useCallback(async (): Promise<GuestData | null> => {
    if (!user) return null;
    try {
      const { data } = await axiosForBackend.get<FetchUserDataResponse>(
        USER_SYNC_URL,
      );
      return data.data;
    } catch (error: unknown) {
      logger.error('拉取云端用户数据失败', error);
      return null;
    }
  }, [user]);

  // 写入云端（PUT 全量同步）
  const syncToCloud = useCallback(async (): Promise<void> => {
    if (!user) return;
    try {
      const payload: GuestData = guestStore.getAll();
      await axiosForBackend.put<SyncResponse>(USER_SYNC_URL, payload);
    } catch (error: unknown) {
      logger.error('同步数据到云端失败', error);
      toast.error('数据同步失败');
    }
  }, [user, guestStore]);

  // 防抖同步：登录态下操作后延迟同步到云端
  const debouncedSync = useCallback((): void => {
    if (!user) return;
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = window.setTimeout(() => {
      void syncToCloud();
    }, 800);
  }, [user, syncToCloud]);

  // 登录时合并游客数据到云端
  const mergeGuestToCloud = useCallback(async (): Promise<void> => {
    const remoteData: GuestData | null = await fetchFromCloud();
    const merged: GuestData = guestStore.mergeWithRemote(
      remoteData ?? { favorites: [], followedTeams: [], settings: {}, records: [] },
    );
    // 用合并结果替换本地
    guestStore.replaceAll(merged);
    // 写回云端
    if (user) {
      try {
        await axiosForBackend.put<SyncResponse>(USER_SYNC_URL, merged);
      } catch (error: unknown) {
        logger.error('合并后写回云端失败', error);
        toast.error('数据同步失败');
      }
    }
  }, [fetchFromCloud, guestStore, user]);

  // 登录：调 auth.login + 合并游客数据
  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      await authLogin(email, password);
      await fetchMe();
      await mergeGuestToCloud();
    },
    [authLogin, fetchMe, mergeGuestToCloud],
  );

  // 注册：调 auth.register + 上传游客数据
  const register = useCallback(
    async (email: string, password: string): Promise<void> => {
      await authRegister(email, password);
      await fetchMe();
      // 新注册用户云端无数据，直接把游客数据上传
      const localData: GuestData = guestStore.getAll();
      try {
        await axiosForBackend.put<SyncResponse>(USER_SYNC_URL, localData);
      } catch (error: unknown) {
        logger.error('注册后同步数据失败', error);
        toast.error('数据同步失败');
      }
    },
    [authRegister, fetchMe, guestStore],
  );

  // 登出：不清空本地数据（回到游客模式）
  const logout = useCallback(async (): Promise<void> => {
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    await authLogout();
    // user 设为 null 后，后续操作走 localStorage
  }, [authLogout]);

  // —— 收藏代理 ——
  const toggleFavorite = useCallback(
    (matchId: string): void => {
      guestStore.toggleFavorite(matchId);
      if (user) debouncedSync();
    },
    [guestStore, user, debouncedSync],
  );

  const addFavorite = useCallback(
    (matchId: string): void => {
      guestStore.addFavorite(matchId);
      if (user) debouncedSync();
    },
    [guestStore, user, debouncedSync],
  );

  const removeFavorite = useCallback(
    (matchId: string): void => {
      guestStore.removeFavorite(matchId);
      if (user) debouncedSync();
    },
    [guestStore, user, debouncedSync],
  );

  const isFavorite = useCallback(
    (matchId: string): boolean => guestStore.isFavorite(matchId),
    [guestStore],
  );

  // —— 关注球队代理 ——
  const followTeam = useCallback(
    (teamName: string): void => {
      guestStore.followTeam(teamName);
      if (user) debouncedSync();
    },
    [guestStore, user, debouncedSync],
  );

  const unfollowTeam = useCallback(
    (teamName: string): void => {
      guestStore.unfollowTeam(teamName);
      if (user) debouncedSync();
    },
    [guestStore, user, debouncedSync],
  );

  const isFollowingTeam = useCallback(
    (teamName: string): boolean => guestStore.isFollowingTeam(teamName),
    [guestStore],
  );

  // —— 设置代理 ——
  const updateSettings = useCallback(
    (partial: Record<string, unknown>): void => {
      guestStore.updateSettings(partial);
      if (user) debouncedSync();
    },
    [guestStore, user, debouncedSync],
  );

  const getSetting = useCallback(
    (key: string): unknown => guestStore.getSetting(key),
    [guestStore],
  );

  // —— 记录代理 ——
  const addRecord = useCallback(
    (record: GuestRecord): void => {
      guestStore.addRecord(record);
      if (user) debouncedSync();
    },
    [guestStore, user, debouncedSync],
  );

  const clearRecords = useCallback((): void => {
    guestStore.clearRecords();
    if (user) debouncedSync();
  }, [guestStore, user, debouncedSync]);

  // 清理防抖定时器
  useEffect(() => {
    return () => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
      }
    };
  }, []);

  return {
    user,
    authLoading,
    login,
    register,
    logout,
    fetchMe,
    mergeGuestToCloud,
    favorites: guestStore.favorites,
    toggleFavorite,
    isFavorite,
    addFavorite,
    removeFavorite,
    followedTeams: guestStore.followedTeams,
    followTeam,
    unfollowTeam,
    isFollowingTeam,
    settings: guestStore.settings,
    updateSettings,
    getSetting,
    records: guestStore.records,
    addRecord,
    clearRecords,
    syncToCloud,
    fetchFromCloud,
  };
}
