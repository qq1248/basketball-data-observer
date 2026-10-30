import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { MatchStatsResponse, BasketballStatsResponse } from '@shared/api.interface';

export async function getStatsOverview(): Promise<MatchStatsResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/stats/overview',
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取足球统计概览失败', error);
    throw error;
  }
}

export async function getBasketballStatsOverview(): Promise<BasketballStatsResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/basketball/stats',
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取篮球统计概览失败', error);
    throw error;
  }
}
