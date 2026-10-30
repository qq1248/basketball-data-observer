import { useState, useEffect } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { getBasketballDateStats } from '@client/src/api/basketball';
import { getDateStats } from '@client/src/api/matches';
import type { BasketballDateStatsItem } from '@shared/api.interface';
import type { DateStatsItem } from '@shared/api.interface';

export type SportType = 'basketball' | 'football';

export interface UseDateStatsResult {
  items: BasketballDateStatsItem[] | DateStatsItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDateStats(
  sport: SportType,
  startDate: string,
  endDate: string,
): UseDateStatsResult {
  const [items, setItems] = useState<BasketballDateStatsItem[] | DateStatsItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      let response: { items: BasketballDateStatsItem[] | DateStatsItem[] };
      if (sport === 'basketball') {
        response = await getBasketballDateStats(startDate, endDate);
      } else {
        response = await getDateStats(startDate, endDate);
      }
      setItems(response.items || []);
    } catch (err: unknown) {
      logger.error('获取日期统计数据失败', err);
      setError(err instanceof Error ? err.message : '获取数据失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport, startDate, endDate]);

  return { items, loading, error, refetch: fetchData };
}
