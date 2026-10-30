import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

export interface SchedulerTaskStatus {
  taskName: string;
  description: string;
  cron: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastErrorMessage: string | null;
  lastRecordsUpdated: number;
  nextRunAt: string | null;
}

export interface SchedulerLogItem {
  id: string;
  taskName: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  recordsUpdated: number;
  dataSource: string | null;
  errorMessage: string | null;
}

export async function getSchedulerStatus(): Promise<{ tasks: SchedulerTaskStatus[] }> {
  const { data } = await axiosForBackend.get('/api/sync/scheduler/status');
  return data;
}

export async function getSchedulerLogs(limit = 30): Promise<{ logs: SchedulerLogItem[] }> {
  const { data } = await axiosForBackend.get(`/api/sync/scheduler/logs?limit=${limit}`);
  return data;
}

export async function triggerSchedulerTask(taskName: string): Promise<{ ok: boolean; message: string }> {
  const { data } = await axiosForBackend.post(`/api/sync/scheduler/run/${taskName}`);
  return data;
}
