import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { ParlayListResponse } from '@shared/api.interface';

export async function getParlayList(
  sport: 'football' | 'basketball' = 'football',
  date?: string,
): Promise<ParlayListResponse> {
  try {
    const params = new URLSearchParams();
    params.set('sport', sport);
    if (date) params.set('date', date);
    const response = await axiosForBackend({
      url: `/api/parlays?${params.toString()}`,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取组合方案失败', error);
    throw error;
  }
}
