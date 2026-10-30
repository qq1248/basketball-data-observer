import { useCallback, useRef } from 'react';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * 全局 in-memory 详情缓存（Map 实现，key = matchId）。
 * 模块级单例，跨组件共享缓存。
 */
const detailCache = new Map<string, CacheEntry<unknown>>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of detailCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      detailCache.delete(key);
    }
  }
}

export function useMatchDetailCache<T>(sport: 'football' | 'basketball' = 'football') {
  const prefixRef = useRef<string>(sport);

  const buildKey = useCallback((id: string): string => {
    return `${prefixRef.current}:${id}`;
  }, []);

  const getDetail = useCallback((id: string): T | null => {
    const key = buildKey(id);
    const entry = detailCache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      detailCache.delete(key);
      return null;
    }
    return entry.data;
  }, [buildKey]);

  const setDetail = useCallback((id: string, data: T): void => {
    const key = buildKey(id);
    detailCache.set(key, { data, timestamp: Date.now() });
    // 写入时顺便清理过期条目，避免内存无限制增长
    if (detailCache.size > 100) {
      pruneExpired();
    }
  }, [buildKey]);

  const clear = useCallback((): void => {
    detailCache.clear();
  }, []);

  const invalidate = useCallback((id: string): void => {
    const key = buildKey(id);
    detailCache.delete(key);
  }, [buildKey]);

  return { getDetail, setDetail, clear, invalidate };
}
