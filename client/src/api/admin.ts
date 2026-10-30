import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  AdminUserListParams,
  AdminUserListResponse,
  AdminStatsResponse,
  AdminUserRoleUpdateRequest,
  AdminResetPasswordResponse,
  AdminSuccessResponse,
  AdminBasketballMatchListItem,
  AdminBasketballMatchListResponse,
  AdminBasketballMatchDetail,
  CreateBasketballMatchAdminRequest,
  UpdateBasketballMatchAdminRequest,
  AdminAuditLogListParams,
  AdminAuditLogListResponse,
  AdminSyncConfigResponse,
  DataSourceSettingsResponse,
} from '@shared/api.interface';

export async function listUsers(params: AdminUserListParams): Promise<AdminUserListResponse> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  if (params.search) query.set('search', params.search);
  if (params.role) query.set('role', params.role);
  if (params.sort) query.set('sort', params.sort);
  const { data } = await axiosForBackend.get<AdminUserListResponse>(
    `/api/admin/users?${query.toString()}`,
  );
  return data;
}

export async function getStats(): Promise<AdminStatsResponse> {
  const { data } = await axiosForBackend.get<AdminStatsResponse>('/api/admin/stats');
  return data;
}

export async function deleteUser(id: string): Promise<AdminSuccessResponse> {
  const { data } = await axiosForBackend.delete<AdminSuccessResponse>(
    `/api/admin/users/${id}`,
  );
  return data;
}

export async function updateUserRole(
  id: string,
  role: 'admin' | 'user',
): Promise<AdminSuccessResponse> {
  const body: AdminUserRoleUpdateRequest = { role };
  const { data } = await axiosForBackend.patch<AdminSuccessResponse>(
    `/api/admin/users/${id}/role`,
    body,
  );
  return data;
}

export async function resetPassword(id: string): Promise<AdminResetPasswordResponse> {
  const { data } = await axiosForBackend.post<AdminResetPasswordResponse>(
    `/api/admin/users/${id}/reset-password`,
  );
  return data;
}

// === 篮球比赛管理 ===

export async function listBasketballMatches(params: {
  date: string;
  page: number;
  pageSize: number;
}): Promise<AdminBasketballMatchListResponse> {
  const query = new URLSearchParams();
  query.set('date', params.date);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  const { data } = await axiosForBackend.get<AdminBasketballMatchListResponse>(
    `/api/admin/basketball-matches?${query.toString()}`,
  );
  return data;
}

export async function getBasketballMatch(id: string): Promise<AdminBasketballMatchDetail> {
  const { data } = await axiosForBackend.get<AdminBasketballMatchDetail>(
    `/api/admin/basketball-matches/${id}`,
  );
  return data;
}

export async function createBasketballMatch(
  data: CreateBasketballMatchAdminRequest,
): Promise<{ id: string }> {
  const res = await axiosForBackend.post<{ id: string }>(
    '/api/admin/basketball-matches',
    data,
  );
  return res.data;
}

export async function updateBasketballMatch(
  id: string,
  data: UpdateBasketballMatchAdminRequest,
): Promise<{ success: boolean }> {
  const res = await axiosForBackend.patch<{ success: boolean }>(
    `/api/admin/basketball-matches/${id}`,
    data,
  );
  return res.data;
}

export async function deleteBasketballMatch(id: string): Promise<{ success: boolean }> {
  const { data } = await axiosForBackend.delete<{ success: boolean }>(
    `/api/admin/basketball-matches/${id}`,
  );
  return data;
}

export async function updateBasketballScore(
  id: string,
  homeScore: number,
  awayScore: number,
  matchStatus: string,
): Promise<{ success: boolean }> {
  const { data } = await axiosForBackend.post<{ success: boolean }>(
    `/api/admin/basketball-matches/${id}/update-score`,
    { homeScore, awayScore, matchStatus },
  );
  return data;
}

// === 审计日志 ===

export async function listAuditLogs(
  params: AdminAuditLogListParams,
): Promise<AdminAuditLogListResponse> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  if (params.actionType) query.set('actionType', params.actionType);
  const { data } = await axiosForBackend.get<AdminAuditLogListResponse>(
    `/api/admin/audit-logs?${query.toString()}`,
  );
  return data;
}

// === 同步配置 ===

export async function getSyncConfig(): Promise<AdminSyncConfigResponse> {
  const { data } = await axiosForBackend.get<AdminSyncConfigResponse>(
    '/api/admin/sync-config',
  );
  return data;
}

export async function getDataSources(): Promise<DataSourceSettingsResponse> {
  const { data } = await axiosForBackend.get<DataSourceSettingsResponse>(
    '/api/admin/data-sources',
  );
  return data;
}

export async function updateApiSportsKey(
  apiKey: string,
): Promise<{ updated: boolean; triggered: boolean }> {
  const { data } = await axiosForBackend.patch(
    '/api/admin/data-sources/api-sports',
    { apiKey },
  );
  return data;
}

export async function updateTheRundownKey(
  apiKey: string,
): Promise<{ updated: boolean; triggered: boolean }> {
  const { data } = await axiosForBackend.patch(
    '/api/admin/data-sources/the-rundown',
    { apiKey },
  );
  return data;
}

export async function updateFootballDataOrgKey(
  apiKey: string,
): Promise<{ updated: boolean; triggered: boolean }> {
  const { data } = await axiosForBackend.patch(
    '/api/admin/data-sources/football-data-org',
    { apiKey },
  );
  return data;
}

// === 预测批量重算 ===

export async function previewRecalc(params: {
  sport: 'football' | 'basketball';
  matchStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  league?: string;
}): Promise<{
  total: number;
  sport: string;
}> {
  const query = new URLSearchParams();
  query.set('sport', params.sport);
  if (params.matchStatus) query.set('matchStatus', params.matchStatus);
  if (params.dateFrom) query.set('dateFrom', params.dateFrom);
  if (params.dateTo) query.set('dateTo', params.dateTo);
  if (params.league) query.set('league', params.league);
  const { data } = await axiosForBackend.get(
    `/api/admin/predictions/recalculate/preview?${query.toString()}`,
  );
  return data;
}

export async function recalculatePredictions(params: {
  sport: 'football' | 'basketball';
  matchStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  matchIds?: string[];
  league?: string;
}): Promise<{
  totalScanned: number;
  recalculated: number;
  skippedLocked: number;
  skippedNoData: number;
  predictionsMade: number;
  holds: number;
  durationMs: number;
}> {
  const { data } = await axiosForBackend.post(
    '/api/admin/predictions/recalculate',
    params,
  );
  return data;
}

// === 异常数据巡检 ===

export async function runInspection(
  sport?: 'football' | 'basketball' | 'all',
): Promise<{
  scanTime: string;
  totalScanned: number;
  football: {
    total: number;
    waitCount: number;
    waitRate: number;
    anomalies: Array<{
      id: string;
      matchNo: string;
      league: string;
      homeTeam: string;
      awayTeam: string;
      kickoffTime: string;
      anomalyType: string;
      anomalyDetail: string;
      severity: string;
    }>;
  };
  basketball: {
    total: number;
    waitCount: number;
    waitRate: number;
    anomalies: Array<{
      id: string;
      matchNo: string;
      league: string;
      homeTeam: string;
      awayTeam: string;
      kickoffTime: string;
      anomalyType: string;
      anomalyDetail: string;
      severity: string;
    }>;
  };
}> {
  const query = sport ? `?sport=${sport}` : '';
  const { data } = await axiosForBackend.post(
    `/api/admin/inspection/scan${query}`,
  );
  return data;
}

// === 任务失败告警 ===

export async function getFailedTasks(): Promise<{
  failedCount: number;
  items: Array<{
    id: string;
    taskName: string;
    trigger: string;
    startedAt: string;
    errorMessage: string | null;
    dataSource: string | null;
  }>;
}> {
  const { data } = await axiosForBackend.get('/api/admin/alerts/failed-tasks');
  return data;
}

// === 自动化任务管理 ===

export async function listAutomationTasks(): Promise<{
  items: Array<{
    name: string;
    description: string;
    cron: string;
    trigger: string;
    enabled: boolean;
    isRunning: boolean;
    isPlatformManaged: boolean;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastErrorMessage: string | null;
    lastRecordsUpdated: number | null;
  }>;
}> {
  const { data } = await axiosForBackend.get('/api/admin/automation/tasks');
  return data;
}

export async function toggleAutomationTask(
  taskName: string,
  enabled: boolean,
): Promise<{ taskName: string; enabled: boolean }> {
  const { data } = await axiosForBackend.post(
    `/api/admin/automation/tasks/${taskName}/toggle`,
    { enabled },
  );
  return data;
}

// === 监控大盘 ===

export async function getMonitorOverview(): Promise<{
  syncHealth: Array<{
    taskName: string;
    totalRuns: number;
    successRuns: number;
    failedRuns: number;
    successRate: number;
    lastRunAt: string | null;
    lastStatus: string | null;
  }>;
  dataAccuracy: {
    football: Array<{
      date: string;
      total: number;
      wdwHitRate: number;
      handicapHitRate: number;
      overunderHitRate: number;
    }>;
    basketball: Array<{
      date: string;
      total: number;
      wdwHitRate: number;
      handicapHitRate: number;
      overunderHitRate: number;
    }>;
  };
  dataHealth: {
    footballTotal: number;
    basketballTotal: number;
    footballUpcoming: number;
    basketballUpcoming: number;
    footballLive: number;
    basketballLive: number;
    footballFinished: number;
    basketballFinished: number;
    anomalyCount: number;
    waitRateFootball: number;
    waitRateBasketball: number;
  };
  accuracySummary: {
    football7d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
    football30d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
    basketball7d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
    basketball30d: { totalMatches: number; wdwHitRate: number; handicapHitRate: number; overunderHitRate: number };
  };
  dataSourceStatus: Array<{
    dataSource: string;
    totalRuns: number;
    successRuns: number;
    failedRuns: number;
    successRate: number;
    lastRunAt: string | null;
  }>;
  failedAlerts: Array<{
    id: string;
    taskName: string;
    trigger: string;
    startedAt: string;
    errorMessage: string | null;
    dataSource: string | null;
  }>;
  recentRuns: Array<{
    id: string;
    taskName: string;
    trigger: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    recordsUpdated: number | null;
    errorMessage: string | null;
  }>;
  engineInfo: {
    version: string;
    versionName: string;
    buildDate: string;
    football: {
      upcomingTotal: number;
      eloCount: number;
      eloCoverage: number;
      xgCount: number;
      xgCoverage: number;
      mlCount: number;
      mlCoverage: number;
    };
    basketball: {
      upcomingTotal: number;
      eloCount: number;
      eloCoverage: number;
      xgCount: number;
      xgCoverage: number;
      mlCount: number;
      mlCoverage: number;
    };
  };
  injuryHealth: {
    footballUpcomingTotal: number;
    footballInjuryCovered: number;
    footballInjuryCoverage: number;
    basketballUpcomingTotal: number;
    basketballInjuryCovered: number;
    basketballInjuryCoverage: number;
    totalReports: number;
    highImpactReports: number;
    mediumImpactReports: number;
    lowImpactReports: number;
    sourceLastSync: Array<{
      dataSource: string;
      sport: string;
      lastSyncAt: string | null;
      hoursSince: number;
      status: 'ok' | 'warn' | 'stale';
    }>;
    missingInjury24h: number;
  };
}> {
  const { data } = await axiosForBackend.get('/api/admin/monitor/overview');
  return data;
}

// === 篮球自动检查 ===

export interface AutoCheckIssue {
  category: string;
  subCategory: string;
  severity: 'low' | 'medium' | 'high';
  matchId: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  detail: string;
  autoFixable: boolean;
  fixStatus: 'pending' | 'fixed' | 'failed';
  fixDetail: string;
}

export interface AutoCheckSummary {
  integrity: { total: number; predicted: number; emptyFields: number; duplicateMatchNos: number };
  statusFlow: { finished: number; pendingHit: number; stuckLive: number; wrongFinished: number };
  periodDisplay: { reliable: number; estimated: number; misleading: number; otMislabeled: number };
  dataCorrectness: { lineValid: number; directionConsistent: number; scoreAnomalies: number };
  hitBackfill: { finishedWithHit: number; finishedMissingHit: number; hitMismatch: number };
  modelBaseline: { v11Count: number; baselineByLeague: Record<string, number>; emptyFeatures: number; injuryAdjustApplied: number };
}

export interface AutoCheckReport {
  id: string;
  checkType: string;
  triggerSource: string;
  triggerTask: string | null;
  status: string;
  totalMatches: number;
  upcomingCount: number;
  liveCount: number;
  finishedCount: number;
  totalIssues: number;
  autoFixed: number;
  needsManual: number;
  durationMs: number;
  errorMessage: string | null;
  summary: AutoCheckSummary;
  issues: AutoCheckIssue[];
  createdAt: string;
}

export async function runBasketballAutoCheck(): Promise<AutoCheckReport> {
  const { data } = await axiosForBackend.post('/api/basketball/auto-check/run');
  return data;
}

export async function getLatestAutoCheck(): Promise<AutoCheckReport | null> {
  const { data } = await axiosForBackend.get('/api/basketball/auto-check/latest');
  return data;
}

export async function getAutoCheckReports(page: number = 1, pageSize: number = 20): Promise<{
  items: AutoCheckReport[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const { data } = await axiosForBackend.get(`/api/basketball/auto-check/reports?page=${page}&pageSize=${pageSize}`);
  return data;
}

// === 竞彩覆盖巡检 ===

export interface SportteryCoverageResult {
  ok: boolean;
  football: {
    reportId: string;
    totalIssues: number;
    autoFixed: number;
    needsManual: number;
  };
  basketball: {
    reportId: string;
    totalIssues: number;
    autoFixed: number;
    needsManual: number;
  };
}

export async function runSportteryCoverageCheck(): Promise<SportteryCoverageResult> {
  const { data } = await axiosForBackend.post('/api/sporttery/coverage-check');
  return data;
}
