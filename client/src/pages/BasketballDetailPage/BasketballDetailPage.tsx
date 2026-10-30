import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Loader2, AlertTriangle, RefreshCw, Clock, Timer } from 'lucide-react';
import { LiveStatusBar } from '@client/src/components/LiveStatusBar';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { getBasketballMatchDetail } from '@client/src/api/basketball';
import { useMatchDetailCache } from '@client/src/hooks/useMatchDetailCache';
import ErrorBoundary from '@client/src/components/ErrorBoundary';
import { computeMatchStatus, MATCH_STATUS_TEXT } from '@client/src/utils/format';
import type { ComputedMatchStatus } from '@client/src/utils/format';
import {
  formatBeijingTime,
  formatRelativeSeconds,
  formatLiveScoreSource,
} from '@client/src/utils/format-beijing-time';
import type { BasketballMatchItem, InjuryReport } from '@shared/api.interface';
import { formatStrengthDisplay, calcStrengthHit } from '@client/src/utils/strength-display';
import OverviewTab from './OverviewTab';
import TeamStatsTab from './TeamStatsTab';
import InjuriesTab from './InjuriesTab';
import H2HTab from './H2HTab';
import IntelTab from './IntelTab';
import ModelTab from './ModelTab';
import DeepAnalysisTab from './DeepAnalysisTab';
import OddsTrendTab from './OddsTrendTab';

const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'stats', label: '球队数据' },
  { key: 'injuries', label: '伤病阵容' },
  { key: 'h2h', label: '历史交锋' },
  { key: 'oddstrend', label: '指数走势' },
  { key: 'deep', label: '深度分析' },
  { key: 'intel', label: '情报' },
  { key: 'model', label: '模型' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const statusLabelMap: Record<string, { text: string; className: string }> = {
  upcoming: { text: '未开始', className: 'bg-away-win-bg text-away-win' },
  live: { text: '进行中', className: 'bg-basketball-orange/15 text-basketball-orange animate-pulse' },
  finished: { text: '已结束', className: 'bg-draw-bg text-draw-text' },
  result_pending: { text: '待核果', className: 'bg-draw-bg text-draw-text' },
  finished_pending: { text: '比分待补', className: 'bg-draw-bg text-draw-text' },
};

/**
 * 核心预测三列卡片（概览Tab顶部）
 * 仅展示样式，不涉及任何数据计算
 */
const CorePredictionCard = ({ match }: { match: BasketballMatchItem }) => {
  const homeWinProb = match.homeWinProb ?? 50;
  const awayWinProb = match.awayWinProb ?? 50;
  const totalPick = match.totalPick || '';
  const totalPickProb = match.totalPickProb ?? 0;
  const confidence = match.confidence ?? 0;

  // 胜负方向颜色：主胜红 / 客胜蓝
  const wdwIsHome = match.predictionDirection === '主胜';
  const wdwLabel = wdwIsHome ? '主胜' : match.predictionDirection === '客胜' ? '客胜' : match.predictionDirection || '-';
  const wdwProb = wdwIsHome ? homeWinProb : awayWinProb;

  // 实力对比展示
  const strengthDisplay = formatStrengthDisplay(
    match.homeTeam ?? '',
    match.awayTeam ?? '',
    match.predictedHomeScore ?? null,
    match.predictedAwayScore ?? null,
    match.confidence ?? null,
  );

  // 大小方向颜色：大分橙 / 小分蓝
  const totalIsOver = totalPick.includes('大分') || match.totalDirection === '大分';
  const totalLabel = match.totalLineNum != null ? String(match.totalLineNum) : (match.totalLine || '-');

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {/* 胜负 */}
        <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-3 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
            胜负
          </div>
          <div
            className={`font-black text-2xl tabular-nums ${
              wdwIsHome ? 'text-red-400' : 'text-blue-400'
            }`}
          >
            {wdwLabel}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] mt-1 tabular-nums">
            {wdwProb}%
          </div>
        </div>

        {/* 让分 / 实力 */}
        <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-3 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
            让分
          </div>
          <div
            className={`font-black text-2xl tabular-nums ${
              strengthDisplay.strongerSide === 'home'
                ? 'text-red-400'
                : strengthDisplay.strongerSide === 'away'
                  ? 'text-blue-400'
                  : 'text-[var(--muted-foreground)]'
            }`}
          >
            {strengthDisplay.strongerSide === 'home' || strengthDisplay.strongerSide === 'away'
              ? strengthDisplay.spreadText
              : '—'}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] mt-1 leading-tight">
            {strengthDisplay.strongerSide === 'even' && !strengthDisplay.strongerTeam
              ? '数据收集中'
              : strengthDisplay.strongerTeam}
          </div>
        </div>

        {/* 大小 */}
        <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-3 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
            大小分
          </div>
          <div
            className={`font-black text-2xl tabular-nums ${
              totalIsOver ? 'text-orange-400' : 'text-cyan-400'
            }`}
          >
            {totalLabel}
          </div>
          <div className="text-xs text-[var(--muted-foreground)] mt-1">
            {totalPick || match.totalDirection || '-'}
          </div>
          <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5 tabular-nums">
            {totalPickProb}%
          </div>
        </div>
      </div>

      {/* 信心度条 */}
      <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            模型信心度
          </span>
          <span className="text-sm font-bold text-[var(--accent-primary)] tabular-nums">
            {confidence}%
          </span>
        </div>
        <div className="w-full h-1 bg-[var(--accent-primary)]/20 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--accent-primary)] transition-all duration-700 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, confidence))}%` }}
          />
        </div>
      </div>
    </div>
  );
};

/**
 * 修正联赛名显示：根据赛事时间判断季后赛/总决赛阶段
 * （数据库 league 字段可能只写了"常规赛"，展示层补正）
 */
function formatLeagueDisplay(league: string, _matchNo: string, kickoffTime: string): string {
  if (!league) return '';
  // 已经含"总决赛"则原样输出
  if (league.includes('总决赛')) return league;

  const date = new Date(kickoffTime);
  const month = date.getMonth() + 1; // 1-indexed
  const day = date.getDate();

  // WNBA + 10月中下旬 → WNBA总决赛
  if (league.includes('WNBA') && month === 10 && day >= 15) {
    return 'WNBA总决赛';
  }
  // WNBA + 9月中下旬 → WNBA季后赛
  if (league.includes('WNBA') && month === 9 && day >= 15) {
    return 'WNBA季后赛';
  }
  // NBA + 4月中下旬-6月 → NBA季后赛
  if (league.includes('NBA') && !league.includes('WNBA') &&
      ((month === 4 && day >= 15) || month === 5 || month === 6)) {
    return 'NBA季后赛';
  }

  return league;
}

const BasketballDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [match, setMatch] = useState<BasketballMatchItem | null>(null);
  const [injuryReports, setInjuryReports] = useState<InjuryReport[]>([]);
  const [injurySummary, setInjurySummary] = useState<{homeHigh: number; homeMedium: number; awayHigh: number; awayMedium: number} | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const hasDeepAnalysis = (() => {
    if (!match) return true;
    const hasKeyPlayers = (match.homeKeyPlayers?.length ?? 0) > 0 || (match.awayKeyPlayers?.length ?? 0) > 0;
    const hasTeamProfile = !!(match.homeTeamProfile?.winRate || match.homeTeamProfile?.homeRecord ||
      match.homeTeamProfile?.awayRecord || match.homeTeamProfile?.pointsPerGame ||
      match.awayTeamProfile?.winRate || match.awayTeamProfile?.homeRecord ||
      match.awayTeamProfile?.awayRecord || match.awayTeamProfile?.pointsPerGame);
    const hasRadar = !!match.homeRadar || !!match.awayRadar;
    const hasForm = !!(match.homeRecentForm && match.homeRecentForm.length > 0) ||
      !!(match.awayRecentForm && match.awayRecentForm.length > 0);
    const hasH2H = (match.h2hHistory?.filter((g) => g.homeScore && g.awayScore)?.length ?? 0) > 0;
    return hasKeyPlayers || hasTeamProfile || hasRadar || hasForm || hasH2H;
  })();

  const hasTeamStats = (() => {
    if (!match) return true;
    return !!match.homeStats || !!match.awayStats;
  })();

  const hasIntel = (() => {
    if (!match) return true;
    const PLACEHOLDER_PATTERNS = /(采集中|待采集|暂无数据|数据收集中|情报收集中|采集中...|加载中|等待中|暂无情报|ESPN 数据源|ESPN数据源)/i;
    const isEmpty = (v: string | null | undefined): boolean => {
      if (!v) return true;
      if (PLACEHOLDER_PATTERNS.test(v.trim())) return true;
      return v.trim().length === 0;
    };
    return !isEmpty(match.intelSummary) ||
      !isEmpty(match.intel) ||
      !isEmpty(match.riskWarning) ||
      !isEmpty(match.teamNews) ||
      !isEmpty(match.mediaConsensus) ||
      !isEmpty(match.expertPicks);
  })();

  const visibleTabs = TABS.filter((t) => {
    if (t.key === 'deep') return hasDeepAnalysis;
    if (t.key === 'stats') return hasTeamStats;
    if (t.key === 'intel') return hasIntel;
    return true;
  });
  const validTabs = visibleTabs.map((t) => t.key);
  const urlTab = searchParams.get('tab');
  const activeTab: TabKey = validTabs.includes(urlTab as TabKey) ? (urlTab as TabKey) : (visibleTabs[0]?.key ?? 'overview');

  const handleTabChange = (tab: TabKey) => {
    setSearchParams({ tab }, { replace: true });
  };

  const [lastUpdateIso, setLastUpdateIso] = useState<string>(new Date().toISOString());
  const [nowTs, setNowTs] = useState<number>(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishedPollCountRef = useRef<number>(0);
  const isLiveRaw = match?.matchStatus === 'live' || match?.matchStatus.includes('in');
  const hasScore = match ? (match.homeScore != null && match.awayScore != null) : false;
  const computedStatus: ComputedMatchStatus | null = match
    ? computeMatchStatus(match.matchStatus, match.kickoffTime, hasScore, 'basketball')
    : null;
  const isLive = computedStatus === 'live';
  const isFinished = computedStatus === 'finished';
  const isFinishedPending = computedStatus === 'finished_pending';
  const isUpcoming = computedStatus === 'upcoming';
  // 给 LiveStatusBar 展示用的基础间隔秒数（实际轮询由 getNextPollDelayMs 控制随机抖动）
  const refreshInterval = isLive ? 30 : isUpcoming ? 60 : 60;

  const detailCache = useMatchDetailCache<BasketballMatchItem>('basketball');

  const fetchDetail = async (showLoading = false) => {
    if (!id) return;
    // 缓存命中快速展示（仅首次加载用缓存）
    if (showLoading) {
      const cached = detailCache.getDetail(id);
      if (cached) {
        setMatch(cached);
        setLoading(false);
        setLastUpdateIso(new Date().toISOString());
        setNowTs(Date.now());
        // 缓存命中仍静默刷新一次
        void fetchDetailSilent();
        return;
      }
    }
    if (showLoading) setLoading(true);
    setIsRefreshing(true);
    try {
      const res = await getBasketballMatchDetail(id);
      if (typeof res !== 'object' || !res || typeof res.match !== 'object') {
        throw new Error('比赛详情数据格式异常');
      }
      setMatch(res.match);
      setInjuryReports(res.injuryReports || []);
      setInjurySummary(res.injurySummary || null);
      detailCache.setDetail(id, res.match);
      setLastUpdateIso(new Date().toISOString());
      setNowTs(Date.now());
    } catch (err: unknown) {
      logger.error('加载篮球比赛详情失败', err);
    } finally {
      if (showLoading) setLoading(false);
      setIsRefreshing(false);
    }
  };

  const fetchDetailSilent = async () => {
    if (!id) return;
    setIsRefreshing(true);
    try {
      const res = await getBasketballMatchDetail(id);
      if (typeof res !== 'object' || !res || typeof res.match !== 'object') {
        throw new Error('比赛详情数据格式异常');
      }
      setMatch(res.match);
      setInjuryReports(res.injuryReports || []);
      setInjurySummary(res.injurySummary || null);
      detailCache.setDetail(id, res.match);
      setLastUpdateIso(new Date().toISOString());
      setNowTs(Date.now());
    } catch (err: unknown) {
      logger.error('静默刷新篮球比赛详情失败', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    void fetchDetail(true);
  }, [id]);

  // 每秒 tick 用于相对时间和倒计时显示（不请求接口）
  useEffect(() => {
    tickTimerRef.current = setInterval(() => {
      setNowTs((prev) => prev + 1000);
    }, 1000);
    return () => {
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    };
  }, []);

  // 计算下一次轮询间隔（毫秒）
  const getNextPollDelayMs = useCallback((): number | null => {
    if (!match) return 60000;
    const status = computedStatus;
    const kickoffTimeMs = new Date(match.kickoffTime).getTime();
    const now = Date.now();

    if (status === 'live') {
      // LIVE: 25~40 秒随机（base 32s ± 7.5s）
      const base = 32000;
      const jitter = (Math.random() * 15000) - 7500;
      return Math.max(24500, Math.min(39500, base + jitter));
    }

    if (status === 'upcoming') {
      const minutesToKickoff = (kickoffTimeMs - now) / 60000;
      if (minutesToKickoff <= 60 && minutesToKickoff > 0) {
        // 距开赛 60 分钟内：60~120 秒随机（与列表页一致）
        const base = 90000;
        const jitter = (Math.random() * 60000) - 30000;
        return Math.max(60000, Math.min(120000, base + jitter));
      }
      // 距开赛 > 60min：5 分钟低频
      return 300000;
    }

    if (status === 'finished' || status === 'finished_pending') {
      // 完赛后 5 分钟内再轮询 2 次（间隔 30s）确认终场，之后停止
      if (finishedPollCountRef.current < 2) {
        finishedPollCountRef.current += 1;
        return 30000;
      }
      return null; // 停止轮询
    }

    return null;
  }, [match, computedStatus]);

  // 自调度轮询（setTimeout 递归）
  useEffect(() => {
    if (!id || !match) return;

    const scheduleNext = () => {
      const delay = getNextPollDelayMs();
      if (delay === null) {
        pollTimerRef.current = null;
        return;
      }
      pollTimerRef.current = setTimeout(() => {
        void fetchDetail(false).then(() => {
          scheduleNext();
        });
      }, delay);
    };

    // 初始延迟调度（首次已由 mount fetchDetail 拉过）
    scheduleNext();

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [id, match, getNextPollDelayMs]);

  // 状态变更时重置完赛轮询计数
  useEffect(() => {
    if (isLive || isUpcoming) {
      finishedPollCountRef.current = 0;
    }
  }, [isLive, isUpcoming]);

  // 页面切回前台时立即刷新一次
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchDetail(false);
      }
    };
    const handleFocus = () => {
      void fetchDetail(false);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualRefresh = () => {
    if (isRefreshing) return;
    void fetchDetail(false);
  };

  // 计算数据更新相对时间（upcoming 用 lastDataSyncAt，live/finished 用 lastScoreAt）
  const dataUpdateInfo = (() => {
    if (!match) return null;
    const useScore = isLive || isFinished;
    const timeStr = useScore ? match.lastScoreAt : match.lastDataSyncAt || match.dataUpdatedAt;
    if (!timeStr) return null;
    const diffMs = nowTs - new Date(timeStr).getTime();
    const diffSec = Math.max(0, diffMs / 1000);
    return {
      ...formatRelativeSeconds(diffSec),
      bjTime: formatBeijingTime(timeStr, 'datetime'),
      source: useScore ? formatLiveScoreSource(match.liveScoreSource) : null,
      useScore,
    };
  })();

  // 计算比分更新相对时间
  const scoreUpdateInfo = (() => {
    if (!match?.lastScoreAt) return null;
    const diffMs = nowTs - new Date(match.lastScoreAt).getTime();
    const diffSec = Math.max(0, diffMs / 1000);
    return {
      ...formatRelativeSeconds(diffSec),
      bjTime: formatBeijingTime(match.lastScoreAt, 'datetime'),
      source: formatLiveScoreSource(match.liveScoreSource),
    };
  })();

  // 开赛倒计时（upcoming）
  const kickoffCountdown = (() => {
    if (!isUpcoming || !match?.kickoffTime) return null;
    const diffMs = new Date(match.kickoffTime).getTime() - nowTs;
    if (diffMs <= 0) return '00:00:00';
    const totalSec = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const hh = String(hours).padStart(2, '0');
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    return days > 0 ? `${days}天 ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
  })();

  // 完赛确认时间
  const finishedConfirmTime = (() => {
    if (!isFinished || !match?.lastScoreAt) return null;
    return formatBeijingTime(match.lastScoreAt, 'time-seconds');
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!match) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-muted-foreground/60" />
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            比赛数据加载失败，请返回重试
          </p>
          <button
             onClick={() => navigate('/')}
             className="inline-flex items-center gap-1 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
           >
             <ChevronLeft className="w-4 h-4" />
             返回
          </button>
        </div>
      </div>
    );
  }

  const hasWdwPick = !!(match.predictionDirection && match.predictionDirection !== '观望' && match.predictionDirection !== '-' && match.predictionDirection !== '未出手');
  const hasTotalPick = !!(match.totalPick && match.totalPick !== '观望' && !match.totalPick.includes('观望') && match.totalPick !== '-');
  const strengthDisplay = formatStrengthDisplay(
    match.homeTeam ?? '',
    match.awayTeam ?? '',
    match.predictedHomeScore ?? null,
    match.predictedAwayScore ?? null,
    match.confidence ?? null,
  );
  const hasStrengthPick = strengthDisplay.strongerSide !== 'even' && !!strengthDisplay.strongerTeam;
  const strengthHitResult = calcStrengthHit(
    match.homeScore,
    match.awayScore,
    match.predictedHomeScore,
    match.predictedAwayScore,
  );

  const renderResultChip = (label: string, hit: boolean | null | undefined, hasPick: boolean) => {
    if (!hasPick) {
      return (
        <span className="text-xs px-2.5 py-1 rounded-md font-medium text-muted-foreground bg-muted/50">
          {label} 未出手
        </span>
      );
    }
    if (hit === true) {
      return (
        <span className="text-xs px-2.5 py-1 rounded-md font-medium text-success bg-hit-bg">
          {label} 通过
        </span>
      );
    }
    return (
      <span className="text-xs px-2.5 py-1 rounded-md font-medium text-miss-text bg-miss-bg">
        {label} 未通过
      </span>
    );
  };

  const statusInfo = statusLabelMap[match.matchStatus];



  // 实时同步中状态（live + estimated）
  const isLiveSyncing = isLive && match.livePeriodEstimated === true;

  // 大小分 显示文本（用于横幅 live 态下方）
  const totalDisplay = match.totalLineNum != null ? String(match.totalLineNum) : (match.totalLine || '-');
  const overProbDisplay = match.overProb ?? 50;
  const underProbDisplay = match.underProb ?? 50;

  return (
    <div className="min-h-0 bg-[var(--background)] md:min-h-screen md:bg-gray-50">
      {/* ========== 移动端深色比分横幅 ========== */}
      {/* 桌面端保留传统hero布局，移动端重写为App样式 */}
      <div className="hidden md:block bg-hero-dark text-white">
        <div className="max-w-7xl mx-auto px-24 pt-12 pb-10">
          <div className="eyebrow eyebrow-line text-white/70 mb-4">
            MATCH DETAIL · 比赛详情
          </div>
          <button
            onClick={() => navigate(-1)}
             className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors mb-6"
           >
             <ChevronLeft className="w-4 h-4" />
             返回列表
           </button>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs px-2.5 py-1 rounded-full bg-white/10 text-white/70 font-mono">
              {match.matchNo}
            </span>
            <div className="flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-nebula-crimson" />
              <span className="text-sm font-medium text-white/90">
                {formatLeagueDisplay(match.league, match.matchNo, match.kickoffTime)}
              </span>
            </div>
            {match.isNeutral && (
              <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/60">
                中立场
              </span>
            )}
          </div>
          <h1 className="text-5xl font-black tracking-tight text-white mb-2">
            {match.awayTeam} <span className="text-white/40">VS</span> {match.homeTeam}
          </h1>
          <p className="text-sm text-white/50">
            {formatBeijingTime(match.kickoffTime, 'datetime')}
            {match.venue && <span className="ml-2">· {match.venue}</span>}
          </p>
        </div>
      </div>

      {/* 移动端比分横幅 — Arena Night 竞技暗夜风格 */}
      <div className="md:hidden bg-gradient-to-b from-[var(--secondary)] to-[var(--background)] text-[var(--foreground)] relative overflow-hidden border-b border-[var(--border)]">
        <div className="relative px-4 py-8">
          {/* 顶部栏：返回 + 联赛/编号 + 占位 */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => navigate(-1)}
              className="w-9 h-9 rounded-full bg-[var(--accent-primary)]/10 flex items-center justify-center hover:bg-[var(--accent-primary)]/20 transition-colors active:scale-95"
              aria-label="返回"
            >
              <ChevronLeft className="w-5 h-5 text-[var(--accent-primary)]" />
            </button>
            <div className="text-center flex-1 px-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-primary)]/70">
                {formatLeagueDisplay(match.league, match.matchNo, match.kickoffTime)} · {match.matchNo}
              </div>
            </div>
            <div className="w-9 h-9" aria-hidden />
          </div>

          {/* ===== 态A：未开赛 — 大倒计时 ===== */}
          {isUpcoming && (
            <div className="text-center">
              {/* 大倒计时数字 */}
              {kickoffCountdown && (
                <div className="text-[var(--accent-primary)] font-black text-5xl tabular-nums mb-2 tracking-tight">
                  {kickoffCountdown}
                </div>
              )}
              {/* 开赛时间 */}
              <div className="text-[var(--muted-foreground)] text-sm flex items-center justify-center gap-1 mb-6">
                <Clock className="w-3.5 h-3.5" />
                {formatBeijingTime(match.kickoffTime, 'datetime')} 开赛
              </div>
              {/* 对阵 — 左客右主（竞彩官方口径：客队 VS 主队） */}
              <div className="flex items-center justify-between px-2">
                <div className="flex-1 text-center">
                  <div className="text-[var(--foreground)] font-bold text-xl leading-tight">
                    {match.awayTeam}
                  </div>
                  <div className="text-[11px] mt-1 text-blue-400/80 font-medium">
                    客胜 {match.awayWinProb ?? 0}%
                  </div>
                </div>
                <div className="px-4 flex-shrink-0">
                  <div className="text-[var(--muted-foreground)] text-xs font-bold uppercase tracking-widest">
                    VS
                  </div>
                </div>
                <div className="flex-1 text-center">
                  <div className="text-[var(--foreground)] font-bold text-xl leading-tight">
                    {match.homeTeam}
                  </div>
                  <div className="text-[11px] mt-1 text-red-400/80 font-medium">
                    主胜 {match.homeWinProb ?? 0}%
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== 态C：同步中 ===== */}
          {isLiveSyncing && (
            <div className="text-center py-4">
              {/* 节次位置：同步中 */}
              <div className="text-amber-400 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 mb-4">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>同步中</span>
              </div>
              {/* 大比分占位 — 左客右主 */}
              <div className="flex items-center justify-between px-2">
                <div className="flex-1 text-center">
                  <div className="text-[var(--foreground)] font-bold text-lg mb-1">
                    {match.awayTeam}
                  </div>
                  <div className="text-sky-400 font-black text-6xl tabular-nums leading-none opacity-40">
                    —
                  </div>
                </div>
                <div className="px-2 flex-shrink-0 text-[var(--muted-foreground)] text-xs font-bold uppercase tracking-widest">
                  VS
                </div>
                <div className="flex-1 text-center">
                  <div className="text-[var(--foreground)] font-bold text-lg mb-1">
                    {match.homeTeam}
                  </div>
                  <div className="text-rose-400 font-black text-6xl tabular-nums leading-none opacity-40">
                    —
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs text-amber-400/70">
                数据正在对齐，请稍候…
              </div>
            </div>
          )}

          {/* ===== 态B：进行中 / 态D：终场 ===== */}
          {(isLive || isFinished) && !isLiveSyncing && (
            <div className="text-center">
              {/* 节次 + 时间（live） / FT（finished） */}
              {isLive && match.livePeriod != null && match.livePeriod > 0 && (
                <div className="text-rose-400 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 mb-4">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-400" />
                  </span>
                  <span>
                    {match.livePeriod > 4 ? `加时赛${match.livePeriod - 4}` : `第${match.livePeriod}节`}
                  </span>
                  <span className="text-[var(--foreground)] font-bold text-sm">
                    {match.liveClock && match.liveClock !== '0:00' && match.liveClock !== '00:00'
                      ? `· ${match.liveClock}`
                      : ''}
                  </span>
                </div>
              )}
              {isFinished && (
                <div className="mb-4">
                  <span className="text-green-400 text-xs font-bold uppercase tracking-widest">
                    FT · 终场
                  </span>
                  <span className="text-[var(--muted-foreground)] text-xs ml-2">
                    已结束
                  </span>
                </div>
              )}

              {/* 大比分 + 队名 — 左客右主 */}
              <div className="flex items-center justify-between px-1">
                <div className="flex-1 text-center">
                  <div className="text-[var(--foreground)] font-bold text-lg mb-2">
                    {match.awayTeam}
                  </div>
                  <div className={`font-black text-6xl md:text-7xl tabular-nums leading-none ${
                    isFinished ? 'text-blue-400/80' : 'text-sky-400'
                  }`}>
                    {isFinished ? (match.awayScore ?? '-') : (match.awayScore ?? 0)}
                  </div>
                </div>
                <div className="px-3 flex-shrink-0 text-[var(--foreground)] text-2xl font-black tabular-nums">
                  :
                </div>
                <div className="flex-1 text-center">
                  <div className="text-[var(--foreground)] font-bold text-lg mb-2">
                    {match.homeTeam}
                  </div>
                  <div className={`font-black text-6xl md:text-7xl tabular-nums leading-none ${
                    isFinished ? 'text-red-400/80' : 'text-rose-400'
                  }`}>
                    {isFinished ? (match.homeScore ?? '-') : (match.homeScore ?? 0)}
                  </div>
                </div>
              </div>

              {/* 下方信息 */}
              <div className="mt-4">
                {isLive && (
                  <div className="space-y-1">
                    <div className="text-xs text-[var(--muted-foreground)]">
                      大小 {totalDisplay}
                    </div>
                    <div className="text-xs">
                      <span className={match.totalDirection === '大分' ? 'text-orange-400 font-medium' : 'text-cyan-400 font-medium'}>
                        {match.totalDirection || '-'}{match.totalPickProb ? ` ${match.totalPickProb}%` : ''}
                      </span>
                    </div>
                    {scoreUpdateInfo && (
                      <div className="text-[11px] text-[var(--muted-foreground)] flex items-center justify-center gap-1 mt-1">
                        <span>比分更新 {scoreUpdateInfo.text}</span>
                      </div>
                    )}
                  </div>
                )}
                {isFinished && (
                  <div className="space-y-2">
                    <div className="text-xs text-[var(--muted-foreground)]">
                      完赛于 {finishedConfirmTime || formatBeijingTime(match.lastScoreAt || match.kickoffTime, 'time')}
                    </div>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      {hasWdwPick && (
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                          match.hitWdw === true ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          胜负 {match.hitWdw === true ? '✓' : '✗'}
                        </span>
                      )}
                      {hasStrengthPick && (
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                          strengthHitResult === true ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          实力 {strengthHitResult === true ? '✓' : '✗'}
                        </span>
                      )}
                      {hasTotalPick && (
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                          match.hitOverunder === true ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          大小 {match.hitOverunder === true ? '✓' : '✗'}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 逐节比分时间轴（非同步中态） */}
          {!isLiveSyncing && (
            <div className="mt-5">
              <QuarterTimeline
                matchStatus={match.matchStatus}
                livePeriod={match.livePeriod}
                liveClock={match.liveClock}
              />
            </div>
          )}
        </div>
      </div>

      {/* ========== 桌面端：原有 Sticky 比分卡 + Tab ========== */}
      <div className="hidden md:block sticky top-0 z-20 bg-background/90 backdrop-blur-md border-b border-border">
        <LiveStatusBar
          lastUpdateIso={lastUpdateIso}
          refreshInterval={refreshInterval}
          onRefresh={handleManualRefresh}
        />
        <div className="max-w-7xl mx-auto px-24 pt-4 pb-3">
          <div className="metric-card p-6">
            <div className="flex items-center gap-2 mb-6">
              <div className="eyebrow eyebrow-line">
                LIVE STATUS
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex-1 text-center">
                <div className="text-2xl font-black tracking-tight text-foreground">
                  {match.awayTeam}
                </div>
                <div className="text-xs mt-1 text-muted-foreground uppercase tracking-widest">
                  AWAY · 客队
                </div>
              </div>

              <div className="px-8 text-center flex-shrink-0">
                {isFinished ? (
                  <div className="text-6xl font-black tracking-tighter font-mono">
                    <span className="text-muted-foreground">
                      {match.awayScore ?? '-'}
                    </span>
                    <span className="mx-2 text-muted-foreground/20">:</span>
                    <span className="text-nebula-crimson">
                      {match.homeScore ?? '-'}
                    </span>
                  </div>
                ) : isLive ? (
                  <>
                    <div className="text-6xl font-black tracking-tighter font-mono text-nebula-crimson">
                      <span>{match.awayScore ?? 0}</span>
                      <span className="mx-2 text-muted-foreground/20">:</span>
                      <span>{match.homeScore ?? 0}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-center gap-3 flex-wrap">
                      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-nebula-crimson text-white text-xs font-black uppercase tracking-widest">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                        </span>
                        LIVE
                      </div>
                      {match.livePeriodEstimated ? (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-50 text-orange-600 text-xs font-medium">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          实时同步中
                        </div>
                      ) : match.livePeriod != null && match.livePeriod > 0 ? (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-nebula-crimson/10 text-nebula-crimson text-xs font-bold">
                          <Timer className="w-3 h-3" />
                          {match.livePeriod > 4 ? `加时赛${match.livePeriod - 4}` : `第${match.livePeriod}节`}
                          {match.liveClock && match.liveClock !== '0:00' && match.liveClock !== '00:00' && (
                            <span className="text-muted-foreground ml-1">· {match.liveClock}</span>
                          )}
                        </div>
                      ) : match.liveClock && (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
                          <Timer className="w-3 h-3" />
                          {match.liveClock}
                        </div>
                      )}
                    </div>
                    {scoreUpdateInfo && (
                      <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>比分更新 {scoreUpdateInfo.bjTime}</span>
                        <span className={scoreUpdateInfo.level === 'delayed' ? 'text-nebula-crimson font-semibold' : ''}>
                          · {scoreUpdateInfo.text}
                        </span>
                        {scoreUpdateInfo.source && (
                          <span className="text-muted-foreground/70 ml-1">来源：{scoreUpdateInfo.source}</span>
                        )}
                      </div>
                    )}
                  </>
                 ) : isFinishedPending ? (
                   <div className="text-5xl font-black tracking-tighter text-muted-foreground/50">
                     <span>—</span>
                     <span className="mx-2 text-muted-foreground/20">:</span>
                     <span>—</span>
                   </div>
                  ) : isUpcoming ? (
                    <div className="flex flex-col items-center">
                      <div className="text-4xl font-black tracking-tighter text-muted-foreground/30">VS</div>
                      {kickoffCountdown && (
                        <div className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-nebula-crimson/10 text-nebula-crimson text-xs font-mono font-semibold">
                          <Timer className="w-3.5 h-3.5" />
                          开赛倒计时 {kickoffCountdown}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-4xl font-black tracking-tighter text-muted-foreground/30">VS</div>
                  )}
                  {!isLive && !isUpcoming && (
                    <div
                      className={`text-xs mt-3 px-3 py-1 rounded-full inline-block font-medium ${
                        isFinished || isFinishedPending
                          ? 'bg-muted text-muted-foreground'
                          : statusInfo.className
                      }`}
                    >
                      {computedStatus ? MATCH_STATUS_TEXT[computedStatus] : statusInfo.text}
                    </div>
                  )}
                   {isUpcoming && kickoffCountdown && (
                     <div className="text-xs mt-2 text-muted-foreground">
                       {computedStatus ? MATCH_STATUS_TEXT[computedStatus] : statusInfo.text}
                     </div>
                   )}
                   {isUpcoming && dataUpdateInfo && (
                     <div className="mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground/80">
                       <RefreshCw className="w-3 h-3" />
                       <span>数据更新 · {dataUpdateInfo.text}</span>
                     </div>
                   )}
                   {isFinished && dataUpdateInfo && (
                     <div className="mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground/80">
                       <Clock className="w-3 h-3" />
                       <span>完赛时间 {dataUpdateInfo.bjTime}</span>
                     </div>
                   )}
               </div>

              <div className="flex-1 text-center">
                <div className="text-2xl font-black tracking-tight text-foreground">
                  {match.homeTeam}
                </div>
                <div className="text-xs mt-1 text-muted-foreground uppercase tracking-widest">
                  HOME · 主队
                </div>
              </div>
            </div>

            {isFinished && finishedConfirmTime && (
              <div className="text-center text-xs mt-4 text-muted-foreground flex items-center justify-center gap-1">
                <Clock className="w-3 h-3" />
                完赛确认于 {finishedConfirmTime}
              </div>
            )}

             {/* 逐节比分时间轴 */}
             <div className="mt-6">
               <QuarterTimeline
                 matchStatus={match.matchStatus}
                 livePeriod={match.livePeriod}
                 liveClock={match.liveClock}
               />
             </div>

             {isFinished && (
               <div className="flex items-center justify-center gap-3 mt-6 pt-5 border-t border-border">
                 {renderResultChip('胜负', match.hitWdw, hasWdwPick)}
                 {renderResultChip('实力', strengthHitResult, hasStrengthPick)}
                 {renderResultChip('大小', match.hitOverunder, hasTotalPick)}
               </div>
             )}
           </div>
         </div>

        {/* Desktop Tab Navigation */}
        <div
          className="max-w-7xl mx-auto flex border-t border-border overflow-x-auto px-24 bg-background/50"
          style={{ scrollbarWidth: 'none' }}
        >
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`relative flex-1 min-w-max px-4 py-3.5 text-sm whitespace-nowrap transition-colors font-medium ${
                activeTab === tab.key
                  ? 'font-black text-nebula-crimson'
                  : 'text-muted-foreground hover:text-foreground/70'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-nebula-crimson" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ========== 移动端：Sticky Tab 栏 ========== */}
      <div className="md:hidden sticky top-0 z-30 bg-[var(--background)]/95 backdrop-blur-xl border-b border-[var(--border)]">
        <div
          className="flex overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`relative flex-shrink-0 px-4 py-3 text-sm whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'text-[var(--accent-primary)] font-semibold'
                  : 'text-[var(--muted-foreground)]'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--accent-primary)]" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ========== Tab 内容区 ========== */}
      <div className="max-w-7xl mx-auto px-4 md:px-24 py-4 md:py-6 pb-36 md:pb-6 md:bg-transparent">
        {/* 概览Tab顶部核心预测卡（仅移动端展示，桌面端概览页已有相关内容） */}
        {activeTab === 'overview' && (
          <div className="md:hidden mb-4">
            <CorePredictionCard match={match} />
          </div>
        )}

        <ErrorBoundary
          key={activeTab}
          fallbackTitle="该场情报加载失败"
          fallbackMessage="数据格式异常，请稍后重试。"
        >
          {activeTab === 'overview' && (
            <OverviewTab
              match={match}
              dataUpdateInfo={dataUpdateInfo}
              isLive={isLive}
              isFinished={isFinished}
              isUpcoming={isUpcoming}
            />
          )}
          {activeTab === 'stats' && <TeamStatsTab match={match} />}
          {activeTab === 'injuries' && match && (
            <InjuriesTab match={match} injuryReports={injuryReports} injurySummary={injurySummary} />
          )}
          {activeTab === 'h2h' && <H2HTab match={match} />}
          {activeTab === 'oddstrend' && (
            <OddsTrendTab
              matchId={match.id}
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
            />
          )}
          {activeTab === 'deep' && <DeepAnalysisTab match={match} />}
          {activeTab === 'intel' && <IntelTab match={match} />}
          {activeTab === 'model' && <ModelTab match={match} />}
        </ErrorBoundary>
      </div>
    </div>
  );
};

/**
 * 逐节比分时间轴组件
 * 展示节次进度/状态（不展示每节得分，源数据无逐节明细）
 */
interface QuarterTimelineProps {
  matchStatus: string;
  livePeriod: number | null | undefined;
  liveClock: string | null | undefined;
}

const QuarterTimeline = ({ matchStatus, livePeriod, liveClock }: QuarterTimelineProps) => {
  // 当前节次（null/0 视为未开始）
  const currentPeriod: number = livePeriod && livePeriod > 0 ? livePeriod : 0;

  // 构建节列表：始终 4 节常规赛 + 可选 OT
  const quarters: Array<{ label: string; period: number; isOvertime: boolean }> = [];
  for (let i = 1; i <= 4; i++) {
    quarters.push({ label: `Q${i}`, period: i, isOvertime: false });
  }

  // 判断是否需要显示 OT 节点
  const hasOvertime = currentPeriod > 4;
  if (hasOvertime) {
    // 显示到当前加时赛节次
    const otCount = currentPeriod - 4;
    for (let i = 1; i <= otCount; i++) {
      quarters.push({
        label: otCount > 1 ? `OT${i}` : 'OT',
        period: 4 + i,
        isOvertime: true,
      });
    }
  }

  // 状态判断
  const isFinishedStatus = matchStatus === 'finished' || matchStatus === 'finished_pending' || matchStatus === 'result_pending';
  const isLiveStatus = matchStatus === 'live';
  const isUpcomingStatus = matchStatus === 'upcoming' || matchStatus === 'pending_sale';

  return (
    <div className="bg-[var(--card)]/60 rounded-xl px-3 py-3 border border-[var(--border)]">
      <div className="flex items-center">
        <div className="flex-1 flex items-center">
          {quarters.map((q, index) => {
            const isFinished = isFinishedStatus || (isLiveStatus && currentPeriod > q.period);
            const isCurrent = isLiveStatus && currentPeriod === q.period;
            const isLast = index === quarters.length - 1;

            // 节点样式 — Arena Night 深色
            let nodeClass = '';
            let textClass = '';
            if (isFinished) {
              nodeClass = 'bg-[var(--secondary)] border border-[var(--border)]';
              textClass = 'text-[var(--muted-foreground)]';
            } else if (isCurrent) {
              nodeClass = 'bg-[var(--accent-primary)]/20 border border-[var(--accent-primary)]/50 relative';
              textClass = 'text-[var(--accent-primary)] font-bold';
            } else {
              nodeClass = 'bg-[var(--background)] border border-[var(--border)]';
              textClass = 'text-[var(--muted-foreground)]';
            }

            return (
              <div key={q.period} className="flex-1 flex items-center relative">
                {/* 节点 */}
                <div className="relative flex flex-col items-center z-10 mx-auto">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${nodeClass} ${textClass}`}
                  >
                    {isCurrent && (
                      <span className="absolute inset-0 rounded-full bg-[var(--accent-primary)]/30 animate-ping opacity-50" />
                    )}
                    <span className="relative z-10">{q.label}</span>
                  </div>
                  {/* 当前节下方标签 */}
                  {isCurrent && (
                    <div className="mt-1 text-center whitespace-nowrap">
                      <div className="text-[10px] text-[var(--accent-primary)] font-semibold leading-tight">
                        进行中
                      </div>
                      {liveClock && liveClock !== '0:00' && liveClock !== '00:00' && (
                        <div className="text-[10px] text-[var(--accent-primary)]/80 font-medium tabular-nums leading-tight mt-0.5">
                          {liveClock}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 连接线 */}
                {!isLast && (
                  <div className="flex-1 h-0.5 -mx-2 relative z-0">
                    {isFinished ? (
                      <div className="w-full h-full bg-[rgba(232_181_74_0.15)]" />
                    ) : isCurrent ? (
                       <div className="w-full h-full bg-gradient-to-r from-[var(--accent-primary)]/40 to-[var(--accent-primary)]/10" />
                    ) : (
                       <div className="w-full h-full bg-[var(--accent-primary)]/10" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 终场标签 */}
        {isFinishedStatus && (
          <div className="ml-3 flex-shrink-0">
            <span className="bg-green-500/15 text-green-400 text-[11px] px-2 py-0.5 rounded-full font-semibold">
              终场
            </span>
          </div>
        )}
      </div>

      {/* 为当前节标签预留底部空间 */}
      {isLiveStatus && currentPeriod > 0 && currentPeriod <= quarters.length && (
        <div className="h-6" />
      )}
    </div>
  );
};

export default BasketballDetailPage;
