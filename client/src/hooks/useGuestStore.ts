import { useState, useCallback } from 'react';

const STORAGE_KEYS = {
  favorites: 'guest:favorites',
  followedTeams: 'guest:followedTeams',
  settings: 'guest:settings',
  records: 'guest:records',
} as const;

export interface GuestData {
  favorites: string[];
  followedTeams: string[];
  settings: Record<string, unknown>;
  records: GuestRecord[];
}

export interface GuestRecord {
  matchId: string;
  actionType: string;
  createdAt: string;
  [key: string]: unknown;
}

function readArray(key: string): string[] {
  try {
    const raw: string | null = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function readObject(key: string): Record<string, unknown> {
  try {
    const raw: string | null = localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readRecords(key: string): GuestRecord[] {
  try {
    const raw: string | null = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GuestRecord[]) : [];
  } catch {
    return [];
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage 不可用时静默失败
  }
}

export function useGuestStore(): {
  favorites: string[];
  followedTeams: string[];
  settings: Record<string, unknown>;
  records: GuestRecord[];
  addFavorite: (matchId: string) => void;
  removeFavorite: (matchId: string) => void;
  toggleFavorite: (matchId: string) => void;
  isFavorite: (matchId: string) => boolean;
  followTeam: (teamName: string) => void;
  unfollowTeam: (teamName: string) => void;
  isFollowingTeam: (teamName: string) => boolean;
  updateSettings: (partial: Record<string, unknown>) => void;
  getSetting: (key: string) => unknown;
  addRecord: (record: GuestRecord) => void;
  clearRecords: () => void;
  mergeWithRemote: (remoteData: Partial<GuestData>) => GuestData;
  replaceAll: (data: Partial<GuestData>) => void;
  getAll: () => GuestData;
} {
  const [favorites, setFavorites] = useState<string[]>(() =>
    readArray(STORAGE_KEYS.favorites),
  );
  const [followedTeams, setFollowedTeams] = useState<string[]>(() =>
    readArray(STORAGE_KEYS.followedTeams),
  );
  const [settings, setSettings] = useState<Record<string, unknown>>(() =>
    readObject(STORAGE_KEYS.settings),
  );
  const [records, setRecords] = useState<GuestRecord[]>(() =>
    readRecords(STORAGE_KEYS.records),
  );

  // —— 收藏 ——
  const addFavorite = useCallback((matchId: string): void => {
    setFavorites((prev: string[]) => {
      if (prev.includes(matchId)) return prev;
      const next = [...prev, matchId];
      writeStorage(STORAGE_KEYS.favorites, next);
      return next;
    });
  }, []);

  const removeFavorite = useCallback((matchId: string): void => {
    setFavorites((prev: string[]) => {
      const next = prev.filter((id) => id !== matchId);
      writeStorage(STORAGE_KEYS.favorites, next);
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((matchId: string): void => {
    setFavorites((prev: string[]) => {
      const exists = prev.includes(matchId);
      const next = exists
        ? prev.filter((id) => id !== matchId)
        : [...prev, matchId];
      writeStorage(STORAGE_KEYS.favorites, next);
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (matchId: string): boolean => favorites.includes(matchId),
    [favorites],
  );

  // —— 关注球队 ——
  const followTeam = useCallback((teamName: string): void => {
    setFollowedTeams((prev: string[]) => {
      if (prev.includes(teamName)) return prev;
      const next = [...prev, teamName];
      writeStorage(STORAGE_KEYS.followedTeams, next);
      return next;
    });
  }, []);

  const unfollowTeam = useCallback((teamName: string): void => {
    setFollowedTeams((prev: string[]) => {
      const next = prev.filter((name) => name !== teamName);
      writeStorage(STORAGE_KEYS.followedTeams, next);
      return next;
    });
  }, []);

  const isFollowingTeam = useCallback(
    (teamName: string): boolean => followedTeams.includes(teamName),
    [followedTeams],
  );

  // —— 设置 ——
  const updateSettings = useCallback(
    (partial: Record<string, unknown>): void => {
      setSettings((prev: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...prev, ...partial };
        writeStorage(STORAGE_KEYS.settings, next);
        return next;
      });
    },
    [],
  );

  const getSetting = useCallback(
    (key: string): unknown => settings[key],
    [settings],
  );

  // —— 记录 ——
  const addRecord = useCallback((record: GuestRecord): void => {
    setRecords((prev: GuestRecord[]) => {
      // 按 matchId 去重，保留最新
      const filtered = prev.filter((r) => r.matchId !== record.matchId);
      const next = [record, ...filtered];
      writeStorage(STORAGE_KEYS.records, next);
      return next;
    });
  }, []);

  const clearRecords = useCallback((): void => {
    setRecords([]);
    writeStorage(STORAGE_KEYS.records, []);
  }, []);

  // —— 合并与替换 ——
  const mergeWithRemote = useCallback(
    (remoteData: Partial<GuestData>): GuestData => {
      const local: GuestData = {
        favorites: [...favorites],
        followedTeams: [...followedTeams],
        settings: { ...settings },
        records: [...records],
      };

      const remoteFavs = remoteData.favorites ?? [];
      const remoteTeams = remoteData.followedTeams ?? [];
      const remoteSettings = remoteData.settings ?? {};
      const remoteRecords = remoteData.records ?? [];

      const mergedFavorites = Array.from(
        new Set([...local.favorites, ...remoteFavs]),
      );
      const mergedFollowedTeams = Array.from(
        new Set([...local.followedTeams, ...remoteTeams]),
      );
      const mergedSettings: Record<string, unknown> = {
        ...remoteSettings,
        ...local.settings,
      };
      // records 按 matchId 去重取最新
      const recordMap = new Map<string, GuestRecord>();
      for (const r of remoteRecords) recordMap.set(r.matchId, r);
      for (const r of local.records) {
        const existing = recordMap.get(r.matchId);
        if (!existing || r.createdAt > existing.createdAt) {
          recordMap.set(r.matchId, r);
        }
      }
      const mergedRecords = Array.from(recordMap.values());

      const merged: GuestData = {
        favorites: mergedFavorites,
        followedTeams: mergedFollowedTeams,
        settings: mergedSettings,
        records: mergedRecords,
      };

      return merged;
    },
    [favorites, followedTeams, settings, records],
  );

  const replaceAll = useCallback((data: Partial<GuestData>): void => {
    const newFavorites = data.favorites ?? [];
    const newFollowedTeams = data.followedTeams ?? [];
    const newSettings = data.settings ?? {};
    const newRecords = data.records ?? [];

    setFavorites(newFavorites);
    setFollowedTeams(newFollowedTeams);
    setSettings(newSettings);
    setRecords(newRecords);

    writeStorage(STORAGE_KEYS.favorites, newFavorites);
    writeStorage(STORAGE_KEYS.followedTeams, newFollowedTeams);
    writeStorage(STORAGE_KEYS.settings, newSettings);
    writeStorage(STORAGE_KEYS.records, newRecords);
  }, []);

  const getAll = useCallback((): GuestData => ({
    favorites: [...favorites],
    followedTeams: [...followedTeams],
    settings: { ...settings },
    records: [...records],
  }), [favorites, followedTeams, settings, records]);

  return {
    favorites,
    followedTeams,
    settings,
    records,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorite,
    followTeam,
    unfollowTeam,
    isFollowingTeam,
    updateSettings,
    getSetting,
    addRecord,
    clearRecords,
    mergeWithRemote,
    replaceAll,
    getAll,
  };
}
