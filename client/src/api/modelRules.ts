import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { ModelRulesResponse } from '@shared/api.interface';

export async function getModelRules(): Promise<ModelRulesResponse> {
  try {
    const response = await axiosForBackend({
      url: '/api/model-rules',
      method: 'GET',
    });
    return response.data;
  } catch (error) {
    logger.error('获取模型规则失败', error);
    throw error;
  }
}
