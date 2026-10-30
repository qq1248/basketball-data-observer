import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { OddsAlertsResponse } from '@shared/api.interface';

export interface OddsAlertsParams {
  date?: string;
  threshold?: number;
  league?: string;
}

export async function getOddsAlerts(
  params: OddsAlertsParams = {},
): Promise<OddsAlertsResponse> {
  try {
    const queryParams = new URLSearchParams();
    if (params.date) queryParams.set('date', params.date);
    if (params.threshold !== undefined)
      queryParams.set('threshold', String(params.threshold));
    if (params.league) queryParams.set('league', params.league);
    const url = `/api/odds-alerts${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
     logger.error('获取指数异动失败', error);
    throw error;
  }
}
