import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { VersionResponse } from '@shared/api.interface';

export async function getVersion(): Promise<VersionResponse> {
  const res = await axiosForBackend.get('/api/version');
  return res.data;
}
