export function formatPercent(value: number, decimals: number = 1): string {
  if (value == null || isNaN(value)) return '0%';
  const normalized = value > 1 ? value : value * 100;
  return `${normalized.toFixed(decimals)}%`;
}

export function normalizePercent(value: number): number {
  if (value == null || isNaN(value)) return 0;
  return value > 1 ? value : value * 100;
}

export function normalizeRatio(value: number): number {
  if (value == null || isNaN(value)) return 0;
  return value > 1 ? value / 100 : value;
}

export function formatBeijingTime(iso: string, includeDate: boolean = true): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
    const bj = new Date(utcMs + 8 * 3600 * 1000);
    const y = bj.getUTCFullYear();
    const mo = String(bj.getUTCMonth() + 1).padStart(2, '0');
    const day = String(bj.getUTCDate()).padStart(2, '0');
    const h = String(bj.getUTCHours()).padStart(2, '0');
    const mi = String(bj.getUTCMinutes()).padStart(2, '0');
    if (includeDate) return `${y}-${mo}-${day} ${h}:${mi}`;
    return `${mo}-${day} ${h}:${mi}`;
  } catch {
    return iso;
  }
}

export function formatBeijingTimeShort(iso: string): string {
  return formatBeijingTime(iso, false);
}

export function formatLocalTimeShort(iso: string): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${m}-${day} ${h}:${mi}`;
  } catch {
    return iso;
  }
}

export function formatBeijingTimeSeconds(iso: string): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
    const bj = new Date(utcMs + 8 * 3600 * 1000);
    const h = String(bj.getUTCHours()).padStart(2, '0');
    const mi = String(bj.getUTCMinutes()).padStart(2, '0');
    const s = String(bj.getUTCSeconds()).padStart(2, '0');
    return `${h}:${mi}:${s}`;
  } catch {
    return iso;
  }
}

// 足球比赛预计时长：2小时15分(135分钟)，含补时
const FOOTBALL_EXPECTED_DURATION_MIN = 135;
// 篮球比赛预计时长：2小时30分(150分钟)
const BASKETBALL_EXPECTED_DURATION_MIN = 150;

export interface EstimatedBasketballPeriod {
  period: number;
  clock: string;
  isEstimated: boolean;
}

export function estimateBasketballPeriod(kickoffIso: string): EstimatedBasketballPeriod {
  const now = Date.now();
  const kickoff = new Date(kickoffIso).getTime();
  const elapsedMin = (now - kickoff) / 60000;
  const quarterMin = 10;
  const breakShort = 2;
  const breakLong = 15;
  const q1End = quarterMin;
  const q2End = q1End + breakShort + quarterMin;
  const q3End = q2End + breakLong + quarterMin;
  const q4End = q3End + breakShort + quarterMin;
  let period = 0;
  let remainingInQ = 0;
  if (elapsedMin < 0) {
    period = 1;
    remainingInQ = quarterMin;
  } else if (elapsedMin < q1End) {
    period = 1;
    remainingInQ = q1End - elapsedMin;
  } else if (elapsedMin < q2End) {
    period = 2;
    remainingInQ = quarterMin - (elapsedMin - q1End - breakShort);
  } else if (elapsedMin < q3End) {
    period = 3;
    remainingInQ = quarterMin - (elapsedMin - q2End - breakLong);
  } else if (elapsedMin < q4End) {
    period = 4;
    remainingInQ = quarterMin - (elapsedMin - q3End - breakShort);
  } else {
    period = 4;
    remainingInQ = 0;
  }
  remainingInQ = Math.max(0, Math.min(quarterMin, remainingInQ));
  const mins = Math.floor(remainingInQ);
  const secs = Math.floor((remainingInQ - mins) * 60);
  const clock = `${mins}:${secs.toString().padStart(2, '0')}`;
  return { period, clock, isEstimated: true };
}

export type ComputedMatchStatus = 'upcoming' | 'live' | 'finished_pending' | 'finished';

/**
 * 基于开赛时间的兜底状态机
 * 数据库status优先级：finished > live > upcoming
 * 但如果数据库是 upcoming/live，且当前时间超过开赛+预计时长仍无比分→finished_pending
 * 如果数据库是 upcoming 但已过开赛时间→live
 * @param dbStatus 数据库中的状态
 * @param kickoffIso 开赛时间 ISO 字符串
 * @param hasScore 是否有真实比分（homeScore/awayScore都不为null）
 * @param sport 'football' | 'basketball'
 */
export function computeMatchStatus(
  dbStatus: string | null | undefined,
  kickoffIso: string,
  hasScore: boolean,
  sport: 'football' | 'basketball',
  hasLiveSource: boolean = true,
): ComputedMatchStatus {
  if (dbStatus === 'finished' && hasScore) return 'finished';
  if (dbStatus === 'score_pending' || dbStatus === 'result_pending') return 'finished_pending';

  const now = Date.now();
  const kickoff = new Date(kickoffIso).getTime();
  const durationMin = sport === 'basketball' ? BASKETBALL_EXPECTED_DURATION_MIN : FOOTBALL_EXPECTED_DURATION_MIN;
  const expectedEnd = kickoff + durationMin * 60 * 1000;

  if (now >= expectedEnd) {
    // 超过预计比赛时长
    if (dbStatus === 'finished' || hasScore) return 'finished';
    return 'finished_pending';
  }

  if (now >= kickoff) {
    if (!hasLiveSource && !hasScore) return 'finished_pending';
    return 'live';
  }

  return 'upcoming';
}

// 状态显示文案映射
export const MATCH_STATUS_TEXT: Record<ComputedMatchStatus, string> = {
  upcoming: '未开赛',
  live: '进行中',
  finished_pending: '已开赛·同步中',
  finished: '已完赛',
};

const STATUS_SORT_ORDER: Record<ComputedMatchStatus, number> = {
  live: 0,
  finished_pending: 1,
  upcoming: 2,
  finished: 3,
};

export function statusSortPriority(status: ComputedMatchStatus): number {
  return STATUS_SORT_ORDER[status] ?? 2;
}

export function matchStatusSortKey(
  dbStatus: string | null | undefined,
  kickoffIso: string,
  hasScore: boolean,
  sport: 'football' | 'basketball',
): number {
  const s = computeMatchStatus(dbStatus, kickoffIso, hasScore, sport);
  return statusSortPriority(s);
}
