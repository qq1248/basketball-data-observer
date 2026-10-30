import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  BasketballListResponse,
  BasketballDetailResponse,
  BasketballDateStatsResponse,
  BasketballStatsResponse,
  BasketballParlayResponse,
  BasketballRecalcHandicapResponse,
  PredictionAccuracyResponse,
  OddsTrendResponse,
   MatchMultiSourceResponse,
   DailyReviewResponse,
 } from '@shared/api.interface';

export interface GetBasketballParams {
  date?: string;
  league?: string;
  confidence?: 'high' | 'medium' | 'low';
  direction?: string;
  sort?: 'kickoff' | 'confidence';
  status?: 'upcoming' | 'finished';
  sourceFilter?: 'all' | 'jingcai' | 'others';
  page?: number;
  pageSize?: number;
  dateMode?: 'business' | 'kickoff';
}

export async function getBasketballMatches(
  params: GetBasketballParams = {},
): Promise<BasketballListResponse> {
  try {
    const queryParams = new URLSearchParams();
    if (params.date) queryParams.set('date', params.date);
    if (params.league) queryParams.set('league', params.league);
    if (params.confidence) queryParams.set('confidence', params.confidence);
    if (params.direction) queryParams.set('direction', params.direction);
    if (params.sort) queryParams.set('sort', params.sort);
    if (params.status) queryParams.set('status', params.status);
    if (params.sourceFilter && params.sourceFilter !== 'all') queryParams.set('sourceFilter', params.sourceFilter);
    if (params.page !== undefined) queryParams.set('page', String(params.page));
    if (params.pageSize !== undefined) queryParams.set('pageSize', String(params.pageSize));
    if (params.dateMode) queryParams.set('dateMode', params.dateMode);
    const url = `/api/basketball${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    const data = response.data ?? {};
    return {
      ...data,
      items: data.items ?? [],
      total: data.total ?? 0,
    };
  } catch (error) {
    logger.error('获取篮球比赛列表失败', error);
    throw error;
  }
}

export async function getBasketballDateStats(
  startDate: string,
  endDate: string,
): Promise<BasketballDateStatsResponse> {
  try {
    const response = await axiosForBackend({
      url: `/api/basketball/date-stats?startDate=${startDate}&endDate=${endDate}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取篮球日期统计失败', error);
    throw error;
  }
}

export async function getBasketballMatchDetail(
  id: string,
): Promise<BasketballDetailResponse> {
  try {
    const response = await axiosForBackend({
      url: `/api/basketball/detail/${id}`,
      method: 'GET',
    });
    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${typeof response.data === 'string' ? response.data : 'Request failed'}`);
    }
    return response.data;
  } catch (error) {
    logger.error('获取篮球比赛详情失败', error);
    throw error;
  }
}

export async function getBasketballStats(): Promise<BasketballStatsResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/basketball/stats',
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取篮球统计数据失败', error);
    throw error;
  }
}

export async function getBasketballParlay(date?: string): Promise<BasketballParlayResponse> {
  try {
    const url = date ? `/api/basketball/parlay?date=${date}` : '/api/basketball/parlay';
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取篮球组合方案失败', error);
    throw error;
  }
}

export async function recalcHandicapHits(): Promise<BasketballRecalcHandicapResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/basketball/recalc-handicap-hits',
      method: 'POST',
    });
    return response.data;
  } catch (error) {
    logger.error('让分命中重算失败', error);
    throw error;
  }
}

export async function getPredictionAccuracy(days?: number): Promise<PredictionAccuracyResponse> {
  try {
    const params = new URLSearchParams();
    if (days !== undefined) params.set('days', String(days));
    const url = `/api/basketball/prediction-accuracy${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    const d = response.data ?? {};
    return {
      hasData: d.hasData ?? false,
      sampleSize: d.sampleSize ?? 0,
      totalFinished: d.totalFinished ?? 0,
      directionalCount: d.directionalCount ?? 0,
      directionRate: d.directionRate ?? 0,
      days: d.days ?? days ?? 30,
      updatedAt: d.updatedAt ?? new Date().toISOString(),
      wdw: d.wdw ?? { hitRate: 0, total: 0, hits: 0 },
      handicap: d.handicap ?? { hitRate: 0, total: 0, hits: 0 },
      overUnder: d.overUnder ?? { hitRate: 0, total: 0, hits: 0 },
      dailyTrend: d.dailyTrend ?? [],
    };
  } catch (error) {
    logger.error('获取篮球命中率统计失败', error);
    throw error;
  }
}

export async function getBasketballOddsTrend(matchId: string): Promise<OddsTrendResponse> {
  try {
    const response = await axiosForBackend({
      url: `/api/basketball/odds-trend/${matchId}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取篮球指数走势失败', error);
    throw error;
  }
}

export async function getBasketballMultiSource(matchId: string): Promise<MatchMultiSourceResponse> {
  try {
    const response = await axiosForBackend({
      url: `/api/basketball/multi-source/${matchId}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取篮球多源对照失败', error);
    throw error;
  }
}

export async function getBasketballDailyReview(
  date: string,
  source = 'sporttery',
): Promise<DailyReviewResponse | null> {
  try {
    const response = await axiosForBackend({
      url: `/api/basketball/review?date=${date}&source=${source}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取篮球每日复盘失败', error);
    throw error;
  }
}
