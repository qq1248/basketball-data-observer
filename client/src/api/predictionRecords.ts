import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  PredictionRecordListResponse,
  PredictionRecordItem,
} from '@shared/api.interface';

export async function getPredictionRecords(
  actionType?: string,
): Promise<PredictionRecordListResponse> {
  try {
    const url = actionType
      ? `/api/prediction-records?actionType=${encodeURIComponent(actionType)}`
      : '/api/prediction-records';
    const response = await axiosForBackend({
      url,
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.warn('获取分析记录失败', error);
    return { items: [] };
  }
}

export async function addPredictionRecord(
  matchId: string,
  actionType: string,
): Promise<PredictionRecordItem> {
  try {
    const response = await axiosForBackend({
      url: `/api/prediction-records/${matchId}`,
      method: 'POST',
      data: { actionType },
    });
    return response.data;
  } catch (error) {
    logger.warn('添加分析记录失败', error);
    return { id: '', matchId, actionType, viewedAt: '', createdAt: '' } as any;
  }
}
