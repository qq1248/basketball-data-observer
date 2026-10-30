import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  MatchStatsResponse,
  BasketballStatsResponse,
  BasketballBacktestResponse,
} from '@shared/api.interface';

export async function getFootballStats(): Promise<MatchStatsResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/stats/football',
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取足球统计数据失败', error);
    throw error;
  }
}

export async function getBasketballStats(): Promise<BasketballStatsResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/basketball/stats',
      method: 'GET',
    });
    const d = response.data ?? {};
    return {
      overview: d.overview ?? {
        totalWdw: 0,
        totalHandicap: 0,
        totalOverUnder: 0,
        wdwHitRate: 0,
        handicapHitRate: 0,
        overUnderHitRate: 0,
        totalMatches: 0,
        finishedMatches: 0,
      },
      byLeague: d.byLeague ?? [],
      bySpreadRange: d.bySpreadRange ?? [],
      byConfidence: d.byConfidence ?? [],
      recentHits: d.recentHits ?? [],
    };
  } catch (error) {
    logger.error('获取篮球统计数据失败', error);
    throw error;
  }
}

export interface GetBasketballBacktestParams {
  days?: number;
  startDate?: string;
  endDate?: string;
}

export async function getBasketballBacktest(
  params: GetBasketballBacktestParams = {},
): Promise<BasketballBacktestResponse> {
  try {
    const queryParams = new URLSearchParams();
    if (params.days !== undefined) queryParams.set('days', String(params.days));
    if (params.startDate) queryParams.set('startDate', params.startDate);
    if (params.endDate) queryParams.set('endDate', params.endDate);
    const url = `/api/basketball/backtest${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取篮球回测数据失败', error);
    throw error;
  }
}
