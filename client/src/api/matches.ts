import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  CreateMatchRequest,
  UpdateMatchRequest,
  MatchListResponse,
  MatchDetailResponse,
  MatchOddsResponse,
  YesterdayReviewResponse,
  DateStatsResponse,
  LiveScoreResponse,
  FootballBacktestResponse,
  PredictionAccuracyResponse,
  OddsTrendResponse,
   MatchMultiSourceResponse,
   DailyReviewResponse,
 } from '@shared/api.interface';

export interface GetMatchesParams {
  date?: string;
  league?: string;
  confidence?: 'high' | 'medium' | 'low';
  direction?: string;
  sort?: 'kickoff' | 'confidence';
  status?: 'upcoming' | 'finished' | 'cancelled';
  source?: 'sporttery' | 'beidan';
  sourceFilter?: 'all' | 'official' | 'jingcai' | 'beidan' | 'international' | 'others';
  page?: number;
  pageSize?: number;
}

export async function getLiveScores(date: string): Promise<LiveScoreResponse> {
  try {
    const response = await axiosForBackend({
      url: `/api/matches/live-scores?date=${date}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取实时比分失败', error);
    throw error;
  }
}

export async function getMatches(
  params: GetMatchesParams = {},
): Promise<MatchListResponse> {
  try {
    const queryParams = new URLSearchParams();
    if (params.date) queryParams.set('date', params.date);
    if (params.league) queryParams.set('league', params.league);
    if (params.confidence) queryParams.set('confidence', params.confidence);
    if (params.direction) queryParams.set('direction', params.direction);
    if (params.sort) queryParams.set('sort', params.sort);
    if (params.status) queryParams.set('status', params.status);
    if (params.source) queryParams.set('source', params.source);
    if (params.sourceFilter) queryParams.set('sourceFilter', params.sourceFilter);
    if (params.page !== undefined) queryParams.set('page', String(params.page));
    if (params.pageSize !== undefined) queryParams.set('pageSize', String(params.pageSize));
    const url = `/api/matches${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取比赛列表失败', error);
    throw error;
  }
}

export async function getMatchOdds(
  matchId: string,
): Promise<MatchOddsResponse> {
  try {
    const response = await axiosForBackend({
      url: `/api/matches/${matchId}/odds`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
     logger.error('获取比赛指数详情失败', error);
    throw error;
  }
}

export async function getYesterdayReview(): Promise<YesterdayReviewResponse | null> {
  try {
    const response = await axiosForBackend({
      url: '/api/matches/yesterday/review',
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取昨日复盘失败', error);
    return null;
  }
}

export async function getDateStats(
  startDate?: string,
  endDate?: string,
  source?: string,
): Promise<DateStatsResponse> {
  try {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (source) params.set('source', source);
    const url = `/api/matches/date-stats${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取日期统计失败', error);
    throw error;
  }
}

export async function getBacktest(): Promise<FootballBacktestResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/matches/backtest',
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取足球回测数据失败', error);
    throw error;
  }
}

export async function getMatch(id: string): Promise<MatchDetailResponse> {
  try {
    const response = await axiosForBackend({
      url: `/api/matches/${id}`,
      method: 'GET',
    });
    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: ${typeof response.data === 'string' ? response.data : 'Request failed'}`);
    }
    return response.data;
  } catch (error) {
    logger.error('获取比赛详情失败', error);
    throw error;
  }
}

export async function createMatch(data: CreateMatchRequest): Promise<MatchDetailResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/matches',
      method: 'POST',
      data,
    });
    return response.data;
  } catch (error) {
    logger.error('创建比赛失败', error);
    throw error;
  }
}

export async function updateMatch(
  id: string,
  data: UpdateMatchRequest,
): Promise<MatchDetailResponse> {
  try {
    const response = await axiosForBackend({
      url: `/api/matches/${id}`,
      method: 'PATCH',
      data,
    });
    return response.data;
  } catch (error) {
    logger.error('更新比赛失败', error);
    throw error;
  }
}

export async function deleteMatch(id: string): Promise<void> {
  try {
    await axiosForBackend({
      url: `/api/matches/${id}`,
      method: 'DELETE',
    });
  } catch (error) {
    logger.error('删除比赛失败', error);
    throw error;
  }
}

export async function getPredictionAccuracy(days?: number): Promise<PredictionAccuracyResponse> {
  try {
    const params = new URLSearchParams();
    if (days !== undefined) params.set('days', String(days));
    const url = `/api/matches/prediction-accuracy${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取足球命中率统计失败', error);
    throw error;
  }
}

export async function getOddsTrend(matchId: string): Promise<OddsTrendResponse> {
  try {
    const response = await axiosForBackend({
      url: `/api/matches/${matchId}/odds-trend`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取指数走势失败', error);
    throw error;
  }
}

export async function getMultiSource(matchId: string): Promise<MatchMultiSourceResponse> {
  try {
    const response = await axiosForBackend({
      url: `/api/matches/${matchId}/multi-source`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取多源对照失败', error);
    throw error;
  }
}

export async function getFootballDailyReview(
  date: string,
  source = 'sporttery',
): Promise<DailyReviewResponse | null> {
  try {
    const response = await axiosForBackend({
      url: `/api/matches/review?date=${date}&source=${source}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取足球每日复盘失败', error);
    throw error;
  }
}
