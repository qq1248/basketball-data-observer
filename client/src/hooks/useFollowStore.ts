import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'app_follows_v1';

export type SportType = 'football' | 'basketball';

interface FollowData {
  teams: {
    football: string[];
    basketball: string[];
  };
  leagues: {
    football: string[];
    basketball: string[];
  };
}

const defaultData: FollowData = {
  teams: { football: [], basketball: [] },
  leagues: { football: [], basketball: [] },
};

function readFromStorage(): FollowData {
  if (typeof window === 'undefined') return defaultData;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData;
    const parsed = JSON.parse(raw);
    // 兼容性校验
    return {
      teams: {
        football: Array.isArray(parsed.teams?.football) ? parsed.teams.football : [],
        basketball: Array.isArray(parsed.teams?.basketball) ? parsed.teams.basketball : [],
      },
      leagues: {
        football: Array.isArray(parsed.leagues?.football) ? parsed.leagues.football : [],
        basketball: Array.isArray(parsed.leagues?.basketball) ? parsed.leagues.basketball : [],
      },
    };
  } catch {
    return defaultData;
  }
}

function writeToStorage(data: FollowData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
}

// 简单的订阅机制，让多个组件共享状态
let globalData: FollowData = readFromStorage();
const listeners = new Set<(data: FollowData) => void>();

function notifyListeners(): void {
  listeners.forEach((fn: (data: FollowData) => void) => fn(globalData));
}

export function useFollowStore() {
  const [data, setData] = useState<FollowData>(globalData);

  useEffect(() => {
    const listener = (newData: FollowData) => setData(newData);
    listeners.add(listener);
    // 同步最新（防止 SSR 后初次挂载时不一致）
    setData(globalData);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const toggleTeam = useCallback((sport: SportType, teamName: string) => {
    if (!teamName) return;
    const list = globalData.teams[sport];
    const idx = list.indexOf(teamName);
    const newList = idx >= 0
      ? list.filter((t: string) => t !== teamName)
      : [...list, teamName];
    globalData = {
      ...globalData,
      teams: { ...globalData.teams, [sport]: newList },
    };
    writeToStorage(globalData);
    notifyListeners();
  }, []);

  const toggleLeague = useCallback((sport: SportType, leagueName: string) => {
    if (!leagueName) return;
    const list = globalData.leagues[sport];
    const idx = list.indexOf(leagueName);
    const newList = idx >= 0
      ? list.filter((l: string) => l !== leagueName)
      : [...list, leagueName];
    globalData = {
      ...globalData,
      leagues: { ...globalData.leagues, [sport]: newList },
    };
    writeToStorage(globalData);
    notifyListeners();
  }, []);

  const isTeamFollowed = useCallback((sport: SportType, teamName: string): boolean => {
    if (!teamName) return false;
    return globalData.teams[sport].includes(teamName);
  }, []);

  const isLeagueFollowed = useCallback((sport: SportType, leagueName: string): boolean => {
    if (!leagueName) return false;
    return globalData.leagues[sport].includes(leagueName);
  }, []);

  const getFollowedTeams = useCallback((sport: SportType): string[] => {
    return [...globalData.teams[sport]];
  }, []);

  const getFollowedLeagues = useCallback((sport: SportType): string[] => {
    return [...globalData.leagues[sport]];
  }, []);

  // 用于订阅模式下的 isFollowed 状态（随 data 变化而更新）
  const checkTeamFollowed = useCallback((sport: SportType, teamName: string): boolean => {
    if (!teamName) return false;
    return data.teams[sport].includes(teamName);
  }, [data]);

  const checkLeagueFollowed = useCallback((sport: SportType, leagueName: string): boolean => {
    if (!leagueName) return false;
    return data.leagues[sport].includes(leagueName);
  }, [data]);

  return {
    data,
    toggleTeam,
    toggleLeague,
    isTeamFollowed,
    isLeagueFollowed,
    getFollowedTeams,
    getFollowedLeagues,
    // 响应式版本（触发重渲染）
    checkTeamFollowed,
    checkLeagueFollowed,
  };
}
