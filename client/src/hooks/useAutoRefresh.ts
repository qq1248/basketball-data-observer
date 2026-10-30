import { useEffect, useRef, useCallback } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';

interface UseAutoRefreshOptions {
  enabled?: boolean;
  intervalMs?: number;
  onRefresh: () => Promise<void> | void;
}

export function useAutoRefresh({
  enabled = true,
  intervalMs = 90000,
  onRefresh,
}: UseAutoRefreshOptions) {
  const timerRef = useRef<number | null>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const start = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = window.setInterval(() => {
      try {
        const result = onRefreshRef.current();
        if (result && typeof result.catch === 'function') {
          result.catch((err: unknown) => {
            logger.warn('auto refresh failed', err);
          });
        }
      } catch (err) {
        logger.warn('auto refresh failed', err);
      }
    }, intervalMs);
  }, [intervalMs]);

  const stop = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (enabled) start();
    else stop();
    return stop;
  }, [enabled, start, stop]);

  return { start, stop };
}
