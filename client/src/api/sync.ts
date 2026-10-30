import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  SyncHealthResponse,
  SyncRefreshResponse,
  SyncTriggerResponse,
} from '@shared/api.interface';

export interface DeepBackfillResult {
  accepted: boolean;
  message: string;
}

export interface DeepBackfillStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  footballChecked: number;
  footballUpdated: number;
  footballErrors: number;
  basketballChecked: number;
  basketballUpdated: number;
  basketballErrors: number;
  errorMessage?: string;
}

export async function getSyncHealth(): Promise<SyncHealthResponse> {
  const { data } = await axiosForBackend.get<SyncHealthResponse>(
    '/api/health/sync',
  );
  return data;
}

export async function refreshLiveScores(): Promise<SyncRefreshResponse> {
  const { data } = await axiosForBackend.post<SyncRefreshResponse>(
    '/api/sync/refresh-live',
  );
  return data;
}

export async function refreshLiveScoresUser(): Promise<SyncRefreshResponse> {
  const { data } = await axiosForBackend.post<SyncRefreshResponse>(
    '/api/sync/refresh-live-user',
  );
  return data;
}

export async function triggerDeepBackfill(): Promise<DeepBackfillResult> {
  const { data } = await axiosForBackend.post<DeepBackfillResult>(
    '/api/admin/sporttery/backfill-deep',
  );
  return data;
}

export async function getDeepBackfillStatus(): Promise<DeepBackfillStatus> {
  const { data } = await axiosForBackend.get<DeepBackfillStatus>(
    '/api/admin/sporttery/backfill-deep/status',
  );
  return data;
}

export async function triggerSync(): Promise<SyncTriggerResponse> {
  const { data } = await axiosForBackend.post<SyncTriggerResponse>(
    '/api/admin/sporttery/trigger-sync',
  );
  return data;
}

