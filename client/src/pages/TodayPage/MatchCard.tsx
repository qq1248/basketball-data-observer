import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Star, StarOff, Zap, Flame, Shield, AlertTriangle, Trophy, Clock, ChevronRight, Sparkles, Minus, Heart, Users, AlertCircle, Scale } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import dayjs from 'dayjs';
import type { MatchItem } from '@shared/api.interface';
import { computeMatchStatus, MATCH_STATUS_TEXT } from '@client/src/utils/format';
import type { ComputedMatchStatus } from '@client/src/utils/format';
import { formatKickoffDisplay, isNextDayEarlyMorning } from '@client/src/utils/format-beijing-time';
import { useFollowStore, type SportType } from '@client/src/hooks/useFollowStore';
import { formatMatchNoBadge, getLeagueColor, getCountdownState } from '@client/src/utils/match-card-enhance';
import { getStarRating, renderStarChars } from '@client/src/utils/star-rating';
import { isDataInsufficientFootball, isIntelIncompleteOnly } from '@client/src/utils/data-quality';
import { normalizeHandicapPick } from '@client/src/utils/handicap-format';
import ActionSheet from '@client/src/components/ui/action-sheet';
import type { ActionSheetItem } from '@client/src/components/ui/action-sheet';

interface MatchCardProps {
  match: MatchItem;
  onToggleFavorite: (matchId: string, isFavorited: boolean) => void;
  onViewDetail: (matchId: string) => void;
  computedStatus?: ComputedMatchStatus;
  /** 父级统一刷新的时间戳（每 60 秒），避免每卡片单独 setInterval */
  nowTimestamp?: number;
  sport?: 'football' | 'basketball';
}

const STATUS_STYLES: Record<string, { label: string; className: string; pulse?: boolean }> = {
  upcoming: { label: '未开赛', className: 'bg-muted text-muted-foreground' },
  live: { label: '进行中', className: 'bg-accent/20 text-accent border border-accent/40', pulse: true },
  finished: { label: '已完赛', className: 'bg-info/20 text-info border border-info/40' },
  cancelled: { label: '已取消', className: 'bg-destructive/20 text-destructive border border-destructive/40' },
};

const DIRECTION_STYLES: Record<string, string> = {
   主胜: 'bg-home-win/10 text-home-win',
  平: 'bg-draw-text/10 text-draw-text',
  客胜: 'bg-away-win/10 text-away-win',
  观望: 'bg-muted text-muted-foreground',
};

function renderLivePeriodText(match: MatchItem): string {
  const clock = match.liveClock || '';
  if (/加时|OT|overtime/i.test(clock)) return clock;
  const period = match.livePeriod;
  if (period !== null && period > 4) {
    const otNum = period - 4;
    if (clock && clock !== '0:00' && clock !== '00:00') return `加时${otNum} ${clock}`;
    return `加时赛${otNum} 进行中`;
  }
  if (clock && clock !== '0:00' && clock !== '00:00') return clock;
  if (period && period > 0 && period <= 4) {
    if (clock === '0:00' || clock === '00:00') {
      if (match.livePeriodEstimated && period === 4) return '进行中';
      return `第${period}节 进行中`;
    }
    return `第${period}节 ${clock}`;
  }
  return '进行中';
}

const getConfidenceLabel = (confidence: number): { label: string; color: string; barColor: string; isHigh: boolean; isLow: boolean } => {
  if (confidence >= 65) return { label: '高', color: 'text-amber-600', barColor: 'bg-amber-500', isHigh: true, isLow: false };
  if (confidence >= 58) return { label: '中', color: 'text-primary', barColor: 'progress-gradient', isHigh: false, isLow: false };
  return { label: '低', color: 'text-muted-foreground', barColor: 'bg-muted', isHigh: false, isLow: true };
};

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * 模型规则过滤：
 * - 过滤 R57+ 的两位/三位数规则（内部基线规则不对外展示）
 * - 过滤含 test/manual/baseline/调试/测试 关键词的规则
 * - 过滤空字符串规则
 */
const MODEL_RULE_HIDE_KEYWORDS = /test|manual|baseline|调试|测试|基线规则/i;
function filterModelRulesForDisplay(rules: string[]): string[] {
  return rules.filter((r: string) => {
    if (!r || r.trim() === '') return false;
    if (MODEL_RULE_HIDE_KEYWORDS.test(r)) return false;
    // 过滤 R57+ 纯数字编号（两位或三位数的内部基线规则）
    if (/^R\d+$/.test(r)) {
      const num = parseInt(r.slice(1), 10);
      if (num >= 57) return false;
    }
    return true;
  });
}

const HIGH_IMPACT_KEYWORDS = ['核心', '主力', '头号', '赛季报销', '确定缺阵', '缺阵', '伤缺', ' indefinitely', 'out for season', '赛季'];

function parseInjuryText(raw: string): string[] {
  if (!raw || raw === '暂无' || raw === '暂无可靠情报' || raw.trim() === '') return [];
  // 先尝试 JSON 数组
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item: unknown) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const name = obj.name || obj.playerName || '';
          const injuryType = obj.injuryType || obj.injury || '';
          const status = obj.status || '';
          if (!name && !injuryType) return '';
          return `${name}${injuryType ? `（${injuryType}` : ''}${status ? `，${status}）` : injuryType ? '）' : ''}`;
        }
        return String(item);
      }).filter(Boolean);
    }
  } catch {
    // 不是 JSON，按文本处理
  }
  // 按换行分割
  const lines = raw.split(/\n+/).map((l: string) => l.trim()).filter(Boolean);
  return lines;
}

function hasHighImpactInjury(injuries: string[]): boolean {
  return injuries.some((inj: string) =>
    HIGH_IMPACT_KEYWORDS.some((kw: string) => inj.includes(kw)),
  );
}

function extractPlayerName(injuryLine: string): string {
  // 去掉括号内的伤情，提取球员名（取「（」之前的部分）
  const parenIdx = injuryLine.indexOf('（');
  if (parenIdx > 0) return injuryLine.slice(0, parenIdx).trim();
  const parenIdx2 = injuryLine.indexOf('(');
  if (parenIdx2 > 0) return injuryLine.slice(0, parenIdx2).trim();
  // 只有名字的情况
  return injuryLine.slice(0, 12);
}

function normalizeWdw(home: number, draw: number, away: number): { home: number; draw: number; away: number } {
  const h = clampPercent(home);
  const d = clampPercent(draw);
  const a = clampPercent(away);
  const total = h + d + a;
  if (total === 0) return { home: 33.33, draw: 33.33, away: 33.34 };
  if (total === 100) return { home: h, draw: d, away: a };
  const scale = 100 / total;
  return {
    home: Math.round(h * scale * 100) / 100,
    draw: Math.round(d * scale * 100) / 100,
    away: Math.round((100 - Math.round(h * scale * 100) / 100 - Math.round(d * scale * 100) / 100) * 100) / 100,
  };
}

function formatLastScoreTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffSec = Math.floor((now - t) / 1000);
  if (diffSec < 5) return '刚刚更新';
  if (diffSec < 60) return `${diffSec}秒前更新`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分钟前更新`;
  return `${Math.floor(diffMin / 60)}小时前更新`;
}

const MatchCard = ({ match, onToggleFavorite, onViewDetail, computedStatus: computedStatusProp, nowTimestamp, sport: sportProp }: MatchCardProps) => {
  const effectiveNow = nowTimestamp ?? Date.now();
  const matchNoBadge = formatMatchNoBadge(match.matchNo, match.source);
  const leagueColor = getLeagueColor(match.league);
  const countdownState = getCountdownState(match.kickoffTime, match.matchStatus, effectiveNow);
  const navigate = useNavigate();
  const { checkTeamFollowed, toggleTeam } = useFollowStore();
  const hasScore = match.homeScore != null && match.awayScore != null;
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const sport: SportType = sportProp ?? 'football';
  const homeFollowed = checkTeamFollowed(sport, match.homeTeam);
  const awayFollowed = checkTeamFollowed(sport, match.awayTeam);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = () => {
    longPressTriggeredRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setActionSheetOpen(true);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(10); } catch { /* ignore */ }
      }
    }, 500);
  };

  const handleTouchEnd = () => {
    clearLongPressTimer();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setActionSheetOpen(true);
  };

  const detailPath = sport === 'basketball'
    ? `/basketball/detail/${match.id}`
    : `/match/${match.id}`;

  const handleCardClick = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    navigate(detailPath);
  };

  const handleToggleHomeFollow = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    toggleTeam(sport, match.homeTeam);
  };

  const handleToggleAwayFollow = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    toggleTeam(sport, match.awayTeam);
  };

  const actionSheetItems: ActionSheetItem[] = [
    {
      key: 'view-injuries',
      label: '查看伤停',
      icon: <AlertTriangle className="w-5 h-5 text-amber-500" />,
      onClick: () => {
        const detailPath = sport === 'basketball'
          ? `/basketball/detail/${match.id}#injuries`
          : `/match/${match.id}#injuries`;
        navigate(detailPath);
      },
    },
    {
      key: 'view-team',
      label: '查看球队档案',
      icon: <Users className="w-5 h-5 text-info" />,
      onClick: () => {
        const detailPath = sport === 'basketball'
          ? `/basketball/detail/${match.id}`
          : `/match/${match.id}`;
        navigate(detailPath);
      },
    },
    {
      key: 'toggle-home-follow',
      label: homeFollowed ? `取消关注 ${match.homeTeam}` : `关注 ${match.homeTeam}（主队）`,
      icon: <Heart className={`w-5 h-5 ${homeFollowed ? 'text-nebula-crimson fill-nebula-crimson' : 'text-muted-foreground'}`} />,
      onClick: () => {
        toggleTeam(sport, match.homeTeam);
      },
    },
  ];
  const hasLiveSource = !!match.liveScoreSource && match.liveScoreSource !== '';
  const computedStatus: ComputedMatchStatus = computedStatusProp
    ?? computeMatchStatus(match.matchStatus, match.kickoffTime, hasScore, 'football', hasLiveSource);
  const isLive = computedStatus === 'live';
  const isFinished = computedStatus === 'finished';
  const isUpcoming = computedStatus === 'upcoming';
  const isFinishedPending = computedStatus === 'finished_pending';

  // 比分变化高亮
  const prevHomeScoreRef = useRef<number | undefined>(match.homeScore);
  const prevAwayScoreRef = useRef<number | undefined>(match.awayScore);
  const [homeScoreHighlight, setHomeScoreHighlight] = useState(false);
  const [awayScoreHighlight, setAwayScoreHighlight] = useState(false);

  useEffect(() => {
    const cur = match.homeScore;
    const prev = prevHomeScoreRef.current;
    if (isLive && cur !== undefined && prev !== undefined && cur !== prev) {
      setHomeScoreHighlight(true);
      const t = window.setTimeout(() => setHomeScoreHighlight(false), 2000);
      prevHomeScoreRef.current = cur;
      return () => window.clearTimeout(t);
    }
    prevHomeScoreRef.current = cur;
  }, [match.homeScore, isLive]);

  useEffect(() => {
    const cur = match.awayScore;
    const prev = prevAwayScoreRef.current;
    if (isLive && cur !== undefined && prev !== undefined && cur !== prev) {
      setAwayScoreHighlight(true);
      const t = window.setTimeout(() => setAwayScoreHighlight(false), 2000);
      prevAwayScoreRef.current = cur;
      return () => window.clearTimeout(t);
    }
    prevAwayScoreRef.current = cur;
  }, [match.awayScore, isLive]);

  const notAnalyzed = !match.isModelAnalyzed;
  const normalizedHandicapRecommendation = sport === 'basketball'
    ? normalizeHandicapPick(match.handicapRecommendation)
    : match.handicapRecommendation;
  const handicapIsWait = normalizedHandicapRecommendation === '观望' || normalizedHandicapRecommendation === '待线值';
  const handicapPendingLine = normalizedHandicapRecommendation === '待线值' || !!(match as any).handicapPendingLine;
  const handicapNotAnalyzed = !match.handicapAnalyzed;
  const hasHandicap = match.handicap !== undefined && match.handicap !== null && match.handicap !== '';
  const isDrawHandicap = hasHandicap && match.handicap === '0';
  const totalIsWait = !match.totalPick || match.totalPick === '观望' || match.totalPick === '待线值';
  const totalPendingLine = match.totalPick === '待线值' || !!(match as any).totalPendingLine;
  const isBasketballModelTotalRef = sport === 'basketball'
    && (!match.overUnder || Number(match.overUnder) <= 0)
    && match.totalPick
    && !totalIsWait
    && (match.totalPick.includes('模型参考') || match.totalPick.includes('大分') || match.totalPick.includes('小分'));
  const status = STATUS_STYLES[match.matchStatus] ?? STATUS_STYLES.upcoming;

   const now = dayjs();
   const kickoff = dayjs(match.kickoffTime);
   const hasKickedOff = kickoff.isBefore(now);
   const displayStatus = (() => {
      if (computedStatus === 'live') {
        if (match.matchStatus === 'upcoming' && !(hasScore)) {
          return { label: '已开赛·采集中', className: 'bg-accent/20 text-accent border border-accent/40', pulse: true };
        }
        return STATUS_STYLES.live;
      }
      if (computedStatus === 'finished_pending') {
        return { label: '已完赛·核实中', className: 'bg-info/20 text-info border border-info/40', pulse: false };
      }
      return STATUS_STYLES[match.matchStatus] ?? STATUS_STYLES.upcoming;
    })();

   const directionStyle = DIRECTION_STYLES[match.predictionDirection] ?? DIRECTION_STYLES['观望'];
   const wdwWidths = normalizeWdw(match.homeWinProb, match.drawProb, match.awayWinProb);
   const overProbClamped = clampPercent(match.overProb ?? 0);
   const underProbClamped = clampPercent(match.underProb ?? 0);
    const wdwIsWait = match.predictionDirection === '观望' || !match.predictionDirection;

     const isLowDataQuality = (
       match.lowConfidence ||
       match.isModelAnalyzed === false ||
       (match.confidence ?? 0) < 20
     );

  const directionProb: number = match.predictionDirection === '主胜'
    ? wdwWidths.home
    : match.predictionDirection === '客胜'
      ? wdwWidths.away
      : match.predictionDirection === '平'
        ? wdwWidths.draw
        : 0;
  const displayConfidence = wdwIsWait
    ? 0
    : clampPercent(directionProb || match.confidence);
  const confidenceInfo = wdwIsWait
    ? { label: '观望', color: 'text-muted-foreground', barColor: 'bg-muted', isHigh: false, isLow: true }
    : getConfidenceLabel(displayConfidence);

  // WDW低信心判定：直接使用后端lowConfidence标记
  const wdwIsLowConfidence = !wdwIsWait && match.lowConfidence === true;

  // 让分低信心判定：有方向但概率/指数值低（非观望）
  const handicapPickProbRaw = ((): number => {
    if (!normalizedHandicapRecommendation || handicapIsWait) return 0;
    const hw = match.handicapWinProb ?? 0;
    const hd = match.handicapDrawProb ?? 0;
    const hl = match.handicapLoseProb ?? 0;
    if (normalizedHandicapRecommendation.includes('主') || normalizedHandicapRecommendation.includes('让胜')) return hw;
    if (normalizedHandicapRecommendation.includes('客') || normalizedHandicapRecommendation.includes('让负')) return hl;
    if (normalizedHandicapRecommendation.includes('平')) return hd;
    return 0;
  })();
  const handicapIsLowConfidence = !handicapIsWait && handicapPickProbRaw > 0 && handicapPickProbRaw < 50;

  // P0-3: 让分观望但有赔率时，取赔率低的一方作为方向（低信心）
  const handicapOddsFallbackDirection = ((): string | null => {
    if (!handicapIsWait) return null;
    const ho = Number(match.handicapOddsHome ?? 0);
    const ao = Number(match.handicapOddsAway ?? 0);
    if (ho <= 0 || ao <= 0) return null;
    if (ho < ao) return '让分主胜';
    if (ao < ho) return '让分客胜';
    return null;
  })();

  // 进球数信心：按偏离50%计算
  const totalPickProbNum = Number(match.totalPickProb ?? 0);
  const totalDeviation = Math.abs(totalPickProbNum - 50);
  const totalConfidenceLevel = totalDeviation >= 15
    ? { label: '高', className: 'text-home-win' }
    : totalDeviation >= 8
      ? { label: '中', className: 'text-draw-text' }
      : { label: '低', className: 'text-muted-foreground' };
  const totalIsLowConfidence = !totalIsWait && totalDeviation < 8;

  // 赔率分层判断
  const hasWdwOdds = (match.oddsOpenHome ?? 0) > 0 && (match.oddsOpenDraw ?? 0) > 0 && (match.oddsOpenAway ?? 0) > 0;
  const hasHandicapOdds = (match.handicapOddsHome ?? 0) > 0 && (match.handicapOddsAway ?? 0) > 0;
  const hasTotalOdds = (match.totalOddsOver ?? 0) > 0 && (match.totalOddsUnder ?? 0) > 0;
  const hasTotalProb = (match.overProb ?? 0) > 0 && (match.underProb ?? 0) > 0 && (match.overProb ?? 0) + (match.underProb ?? 0) > 0;
  const hasWdwProb = (match.homeWinProb ?? 0) > 0 || (match.drawProb ?? 0) > 0 || (match.awayWinProb ?? 0) > 0;
  const hasAnyOdds = hasWdwOdds || hasHandicapOdds || hasTotalOdds;
  const wdwNotAnalyzed = !match.wdwAnalyzed && !hasWdwOdds && !hasWdwProb;
  const totalNotAnalyzed = !match.totalAnalyzed && !hasTotalOdds && !hasTotalProb;
  // wdwNotAnalyzed：模型层面胜负平未分析 ≠ 暂无官方指数
  const wdwModelNotAnalyzed = wdwNotAnalyzed;
  const isDefaultMostLikelyScore = match.mostLikelyScore 
    ? ['3-0','0-3','2-0','0-2','1-0','0-1','2-1','1-2','1-1'].includes(match.mostLikelyScore) && wdwNotAnalyzed
    : false;

   // 前端兜底计算让分/进球数命中（接口未返回时自行计算）
  const computedHitHandicap = (): boolean | null => {
    if (!isFinished) return null;
    if (match.hitHandicap !== undefined && match.hitHandicap !== null) return match.hitHandicap;
    if (handicapIsWait || handicapNotAnalyzed || !hasHandicap) return null;
    if (match.homeScore == null || match.awayScore == null) return null;
    const h = match.homeScore;
    const a = match.awayScore;
    const handicapNum = Number(String(match.handicap).replace(/[^0-9.-]/g, ''));
    if (Number.isNaN(handicapNum)) return null;
     // handicap 为正时是主队让分，为负时是主队受让
    const adjustedHome = h + handicapNum;
    const rec = normalizedHandicapRecommendation ?? '';
    let actual: string;
    if (adjustedHome > a) actual = '让胜';
    else if (adjustedHome < a) actual = '让负';
    else actual = '让平';
    if (rec.includes('让胜') || rec.includes('主')) return actual === '让胜';
    if (rec.includes('让负') || rec.includes('客')) return actual === '让负';
    if (rec.includes('平')) return actual === '让平';
    return null;
  };

  const computedHitOverunder = (): boolean | null => {
    if (!isFinished) return null;
    if (match.hitOverunder !== undefined && match.hitOverunder !== null) return match.hitOverunder;
    if (totalIsWait || totalNotAnalyzed) return null;
    if (match.homeScore == null || match.awayScore == null) return null;
    const total = match.homeScore + match.awayScore;
    const ouLine = Number(match.overUnder);
    if (!match.totalPick || match.totalPick === '观望') return null;
    const pick = match.totalPick;
    // 进球区间类参考方向
    if (pick === '0-1球') return total <= 1;
    if (pick === '2-3球') return total >= 2 && total <= 3;
    if (pick === '4-6球') return total >= 4 && total <= 6;
    if (pick === '7+球') return total >= 7;
     // 总分类参考方向（以 overUnder 指数线为准）
    if (Number.isFinite(ouLine) && ouLine > 0) {
      if (pick.includes('大') || pick.includes('大球') || pick.includes('大分')) return total > ouLine;
      if (pick.includes('小') || pick.includes('小球') || pick.includes('小分')) return total < ouLine;
    }
    return null;
  };

  const hitHandicapDisplay = computedHitHandicap();
  const hitOverunderDisplay = computedHitOverunder();

  const showHitBadge = isFinished && match.hitWdw !== undefined && match.hitWdw !== null;

  const shorterTeamIsHome = match.homeTeam.length <= match.awayTeam.length;
  void shorterTeamIsHome;

    const matchDateDay = dayjs(match.matchDate).startOf('day');
   const today = dayjs().startOf('day');
   const isFutureDate = matchDateDay.isAfter(today);
   const showOddsPending = isFutureDate && !hasAnyOdds;

  const highlightTags = [];
  if (match.intel?.includes('赛前2小时更新') && match.matchStatus === 'upcoming') {
    const isMajor = match.intel.includes('⚠️重大调整');
    highlightTags.push({
      key: 'update',
       label: isMajor ? '模型调整' : '赛前更新',
      icon: Zap,
      className: isMajor
        ? 'bg-home-win-bg text-home-win border-home-win/30'
         : 'bg-away-win-bg text-away-win border-away-win/30',
    });
  }
  if (match.errorReason?.includes('v5.19强平局预警')) {
    highlightTags.push({
      key: 'v519-draw',
      label: 'v5.19强平局预警',
      icon: Sparkles,
      className: 'bg-draw-bg text-draw-text border-draw-text/30',
    });
  }
  if (displayConfidence >= 72) highlightTags.push({ key: 'top', label: '高信心场次', icon: Flame, className: 'bg-home-win-bg text-home-win border-home-win/30' });
  if (!notAnalyzed && match.modelRules?.some((r: string) => /^R4(?![0-9])/.test(r))) highlightTags.push({ key: 'deep', label: '深指数保护', icon: Shield, className: 'bg-draw-bg text-draw-text border-draw-text/30' });
  if (match.lowConfidence) highlightTags.push({ key: 'low', label: '低信心', icon: AlertTriangle, className: 'bg-away-win-bg text-away-win border-away-win/30' });
  if (match.drawWarning) highlightTags.push({ key: 'draw-warn', label: '防平', icon: Minus, className: 'bg-draw-bg text-draw-text border-draw-text/30' });

  const isGlueHandicap = (
    sport !== 'basketball' &&
    hasHandicap &&
    !handicapIsWait &&
    !handicapNotAnalyzed &&
    match.handicapDrawProb !== undefined &&
    match.handicapDrawProb >= 30 &&
    normalizedHandicapRecommendation &&
    !normalizedHandicapRecommendation.includes('平')
  );
  if (isGlueHandicap) {
    highlightTags.push({
      key: 'glue-handicap',
      label: `胶着 让平${Math.round(match.handicapDrawProb)}%`,
      icon: Scale,
      className: 'bg-amber-50 text-amber-600 border border-amber-200',
    });
  }
  if (!notAnalyzed && match.modelRules?.includes('R51')) highlightTags.push({ key: 'upset', label: '杯赛冷门', icon: Trophy, className: 'bg-draw-bg text-draw-text border-draw-text/30' });

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite(match.id, !!match.isFavorited);
  };

  const isNextDayMorning = isNextDayEarlyMorning(match.kickoffTime);
  const kickoffTimeStr = formatKickoffDisplay(match.kickoffTime);

  if (showOddsPending) {
    return (
      <div
        onClick={handleCardClick}
         className="metric-card p-4 md:p-5 cursor-pointer group opacity-80 hover:opacity-100 border-b-2 border-transparent hover:border-b-nebula-crimson bg-[var(--card)] md:bg-card rounded-2xl md:rounded-none border border-[var(--border)] md:border-border overflow-hidden relative
         ${isLive ? 'border-l-[3px] md:border-l border-l-[var(--destructive)] md:border-l-transparent' : ''}
         ${isFinishedPending ? 'border-l-[3px] md:border-l border-l-[var(--warning)] md:border-l-transparent' : ''}
         ${isFinished && !isFinishedPending ? 'border-l-[3px] md:border-l border-l-[var(--success)]/50 md:border-l-transparent' : ''}
         ${isUpcoming ? 'border-l-[3px] md:border-l border-l-[var(--info)]/50 md:border-l-transparent' : ''}"
        data-ai-section-type="card-list"
      >
        {/* 顶部行：赛事编号 + 倒计时 */}
        <div className="flex items-center justify-between mb-2">
           <div className="flex items-center gap-2 min-w-0 flex-wrap">
             {matchNoBadge && (
               <span className="px-2 py-0.5 rounded bg-[var(--info)] md:bg-nebula-crimson text-white text-[10px] font-bold uppercase tracking-wider flex-shrink-0">
                 {matchNoBadge}
               </span>
             )}
             <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-draw-bg text-draw-text border border-draw-text/30 flex items-center gap-0.5 flex-shrink-0">
               <Clock className="w-2.5 h-2.5" />
                赛果分析未开售
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {match.predictionDirection !== '观望' && match.confidence >= 55 && (
                <span
                  className="text-[12px] font-bold tracking-[1px] tabular-nums flex items-center text-[var(--info)] md:!text-nebula-crimson"
                  style={{ color: '#8B0000' }}
                  aria-label={`${getStarRating(match.confidence, match.predictionDirection === '观望').stars}星`}
                >
                  {renderStarChars(getStarRating(match.confidence, match.predictionDirection === '观望').stars)}
                </span>
              )}
              {countdownState.status === 'upcoming' && (
                 <span className={`text-[10px] font-mono font-medium flex items-center gap-1 ${countdownState.isUrgent ? 'text-[var(--destructive)] md:text-nebula-crimson font-bold' : 'text-[var(--muted-foreground)] md:text-muted-foreground'}`}>
                  <Clock className="w-3 h-3" />
                  {countdownState.text}
                </span>
              )}
              {countdownState.status === 'suspended' && (
               <span className="text-[10px] font-medium text-[var(--muted-foreground)] md:text-muted-foreground bg-[var(--secondary)] md:bg-muted/60 px-1.5 py-0.5 rounded">
                 {countdownState.text}
               </span>
             )}
             <button
               onClick={handleFavoriteClick}
               className="p-1 rounded-md transition-colors hover:bg-muted flex-shrink-0"
               aria-label={match.isFavorited ? '取消收藏' : '收藏'}
             >
               {match.isFavorited ? (
                 <Star className="w-4 h-4 text-accent fill-accent" />
               ) : (
                 <StarOff className="w-4 h-4 text-[var(--muted-foreground)]/70 md:text-muted-foreground" />
               )}
             </button>
           </div>
         </div>

         {/* 联赛标识 */}
         <div className="flex items-center gap-1.5 mb-3 min-w-0">
           <span
             className="w-2 h-2 rounded-full flex-shrink-0"
             style={{ backgroundColor: leagueColor }}
           />
           <span className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground truncate">
             {match.league}
           </span>
         </div>

        <div className="flex items-center justify-between">
           <div className="flex-1 text-left min-w-0">
              <div className="flex items-center gap-1">
                <button
                  onClick={handleToggleHomeFollow}
                  className="p-1.5 -m-1 rounded transition-colors hover:bg-muted/60 flex-shrink-0"
                  title={homeFollowed ? '取消关注主队' : '关注主队'}
                  aria-label={homeFollowed ? '取消关注主队' : '关注主队'}
                >
                  <Heart
                    className={`w-3.5 h-3.5 ${homeFollowed ? 'fill-[var(--info)] text-[var(--info)] md:fill-nebula-crimson md:text-nebula-crimson' : 'text-[var(--muted-foreground)]/50 md:text-muted-foreground/40'}`}
                  />
                </button>
                <span className="text-base font-semibold text-[var(--foreground)] md:text-foreground/80 truncate">
                  {match.homeTeam}
                </span>
              </div>
           </div>
            <div className="px-3 text-center flex-shrink-0">
             <div className="text-xs text-[var(--muted-foreground)]/70 md:text-muted-foreground font-medium">VS</div>
              <div className="text-[10px] text-[var(--muted-foreground)]/70 md:text-muted-foreground font-mono mt-0.5 flex items-center justify-center gap-0.5">
                {kickoffTimeStr}
                {isNextDayMorning && (
                  <span className="text-[var(--info)] md:text-accent">次日</span>
                )}
              </div>
           </div>
            <div className="flex-1 text-right min-w-0">
               <div className="flex items-center justify-end gap-1">
                 <span className="text-base font-semibold text-[var(--foreground)] md:text-foreground/80 truncate">
                    {match.awayTeam}
                  </span>
                 <button
                   onClick={handleToggleAwayFollow}
                   className="p-1.5 -m-1 rounded transition-colors hover:bg-muted/60 flex-shrink-0"
                   title={awayFollowed ? '取消关注客队' : '关注客队'}
                   aria-label={awayFollowed ? '取消关注客队' : '关注客队'}
                 >
                   <Heart
                     className={`w-3.5 h-3.5 ${awayFollowed ? 'fill-[var(--info)] text-[var(--info)] md:fill-nebula-crimson md:text-nebula-crimson' : 'text-[var(--muted-foreground)]/50 md:text-muted-foreground/40'}`}
                   />
                 </button>
               </div>
              </div>
            </div>

         {match.modelRules && filterModelRulesForDisplay(match.modelRules).length > 0 && (
            <div className="pt-2 mt-2 border-t border-[var(--border)] md:border-border/30 flex items-center justify-between">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                {filterModelRulesForDisplay(match.modelRules).slice(0, 3).map((rule: string, idx: number) => (
                 <span
                   key={idx}
                   className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[var(--secondary)] md:bg-muted/60 text-[var(--muted-foreground)] md:text-muted-foreground"
                 >
                   {rule}
                 </span>
               ))}
             </div>
            <button
              className="flex items-center gap-0.5 text-xs text-[var(--info)]/70 md:text-primary/70 hover:text-[var(--info)] md:hover:text-primary transition-colors flex-shrink-0 ml-2"
               onClick={(e) => {
                 e.stopPropagation();
                 navigate(detailPath);
               }}
             >
               赛程
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
       onClick={handleCardClick}
       onContextMenu={handleContextMenu}
       onTouchStart={handleTouchStart}
       onTouchEnd={handleTouchEnd}
       onTouchMove={handleTouchEnd}
       onTouchCancel={handleTouchEnd}
       className={`metric-card p-4 md:p-5 cursor-pointer group border-b-2 border-transparent hover:border-b-nebula-crimson hover:-translate-y-1 hover:shadow-md transition-all duration-300 select-none relative rounded-2xl md:rounded-none bg-[var(--card)] md:bg-transparent border border-[var(--border)] md:border-0 overflow-hidden
                   ${match.lowConfidence ? 'border-destructive/20' : ''}
                   ${isLive ? 'border-l-[3px] md:border-l border-l-rose-500 md:border-l-transparent' : ''}
                   ${isFinishedPending ? 'border-l-[3px] md:border-l border-l-amber-500 md:border-l-transparent' : ''}
                   ${isFinished && !isFinishedPending ? 'border-l-[3px] md:border-l border-l-green-500/50 md:border-l-transparent' : ''}
                   ${isUpcoming ? 'border-l-[3px] md:border-l border-l-blue-500/50 md:border-l-transparent' : ''}`}
       data-ai-section-type="card-list"
     >
        {/* LIVE 标识 + 进行中 */}
        {isLive && (
          <div className="absolute -top-2 -left-1.5 z-10 flex flex-col items-center gap-0.5">
            <span className="px-2 py-0.5 bg-destructive text-white text-[10px] font-bold rounded shadow-md flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
              </span>
              LIVE
            </span>
             <span className="text-[10px] text-[var(--destructive)] md:text-red-600 font-medium bg-[var(--card)]/90 px-1 rounded shadow-sm">进行中</span>
          </div>
        )}
       {/* 顶部行：赛事编号徽章（左） + 停售倒计时（右） */}
         <div className="flex items-center justify-between mb-2">
           <div className="flex items-center gap-2 min-w-0 flex-wrap">
             {matchNoBadge && (
               <span className="px-2 py-0.5 rounded bg-[var(--info)] md:bg-nebula-crimson text-white text-[10px] font-bold uppercase tracking-wider flex-shrink-0">
                 {matchNoBadge}
               </span>
             )}
             {showOddsPending && (
               <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--warning)]/20 md:bg-accent/20 text-[var(--warning)] md:text-accent border border-[var(--warning)]/40 md:border-accent/40 flex items-center gap-0.5">
                 <Clock className="w-2.5 h-2.5" />
                 指数待开售
               </span>
             )}
           </div>
           <div className="flex items-center gap-2 flex-shrink-0">
             {match.predictionDirection !== '观望' && match.confidence >= 55 && (
               <span
                 className="text-[12px] font-bold tracking-[1px] tabular-nums flex items-center text-[var(--info)] md:!text-nebula-crimson"
                 style={{ color: '#8B0000' }}
                 aria-label={`${getStarRating(match.confidence, match.predictionDirection === '观望').stars}星`}
               >
                 {renderStarChars(getStarRating(match.confidence, match.predictionDirection === '观望').stars)}
               </span>
             )}
             {countdownState.status === 'upcoming' && (
                 <span className={`text-[10px] font-mono font-medium flex items-center gap-1 ${countdownState.isUrgent ? 'text-[var(--destructive)] md:text-nebula-crimson font-bold' : 'text-[var(--muted-foreground)] md:text-muted-foreground'}`}>
                 <Clock className="w-3 h-3" />
                 {countdownState.text}
               </span>
             )}
             {countdownState.status === 'live' && (
               <span className="text-[10px] font-bold text-[var(--destructive)] md:text-nebula-crimson flex items-center gap-1">
                 <span className="relative flex h-1.5 w-1.5">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--destructive)] md:bg-nebula-crimson opacity-75" />
                   <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--destructive)] md:bg-nebula-crimson" />
                 </span>
                 {countdownState.text}
               </span>
             )}
             {countdownState.status === 'finished' && (
               <span className="text-[10px] font-medium text-[var(--muted-foreground)] md:text-muted-foreground flex items-center gap-1">
                 {countdownState.text}
                 {match.homeScore !== undefined && match.awayScore !== undefined && (
                   <span className="font-mono font-bold text-[var(--foreground)] md:text-foreground">
                     {match.homeScore}-{match.awayScore}
                   </span>
                 )}
               </span>
             )}
             {countdownState.status === 'suspended' && (
               <span className="text-[10px] font-medium text-[var(--muted-foreground)] md:text-muted-foreground bg-[var(--secondary)] md:bg-muted/60 px-1.5 py-0.5 rounded">
                 {countdownState.text}
               </span>
             )}
             <button
               onClick={handleFavoriteClick}
               className="p-1 rounded-md transition-colors hover:bg-muted flex-shrink-0"
               aria-label={match.isFavorited ? '取消收藏' : '收藏'}
             >
               {match.isFavorited ? (
                 <Star className="w-4 h-4 text-accent fill-accent" />
               ) : (
                 <StarOff className="w-4 h-4 text-[var(--muted-foreground)]/70 md:text-muted-foreground" />
               )}
             </button>
           </div>
         </div>

          {/* 联赛标识 + 状态 */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: leagueColor }}
              />
              <span className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground truncate">
                {match.league}
              </span>
               {isLowDataQuality && !isLive && (
                 <span
                   className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[var(--warning)]/20 md:bg-amber-50 text-[var(--warning)] md:text-amber-600 border border-[var(--warning)]/40 md:border-amber-200 flex-shrink-0"
                   title="该联赛样本量较少，模型参考度有限，仅供参考"
                 >
                   <AlertCircle className="w-3 h-3 flex-shrink-0" />
                   数据不足
                 </span>
               )}
              {isFinishedPending && (
               <span className="text-[10px] font-medium bg-[var(--secondary)] md:bg-muted/70 text-[var(--muted-foreground)] md:text-muted-foreground px-1.5 py-0.5 rounded">
                  核实中
                </span>
              )}
              {isNextDayMorning && isUpcoming && (
                <span className="text-[9px] text-[var(--info)] md:text-accent font-medium">次日凌晨</span>
              )}
            </div>
           {match.matchStatus !== 'upcoming' && match.matchStatus !== 'finished' && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 ${displayStatus.className}`}>
               {displayStatus.pulse && (
                 <span className="relative flex h-1.5 w-1.5">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
                   <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
                 </span>
               )}
               {displayStatus.label}
             </span>
           )}
         </div>

       {/* 重点场次标签 */}
       {highlightTags.length > 0 && (
         <div className="flex items-center gap-1.5 mb-2 flex-wrap">
           {highlightTags.map((tag) => {
             const IconComp = tag.icon;
             return (
               <span
                 key={tag.key}
                 className={`px-1.5 py-0.5 rounded text-[10px] font-medium border flex items-center gap-0.5 ${tag.className}`}
               >
                 <IconComp className="w-2.5 h-2.5" />
                 {tag.label}
               </span>
             );
           })}
         </div>
       )}

      {/* 对阵行 — 篮球：左客右主；足球：左主右客 */}
      <div className="flex items-center justify-between mb-3">
         <div className="flex-1 text-left min-w-0">
           <div className="flex items-center gap-1.5">
             <button
               onClick={sport === 'basketball' ? handleToggleAwayFollow : handleToggleHomeFollow}
               className="p-1.5 -m-1 rounded-md transition-colors hover:bg-muted flex-shrink-0"
               title={sport === 'basketball'
                 ? (awayFollowed ? '取消关注客队' : '关注客队')
                 : (homeFollowed ? '取消关注主队' : '关注主队')}
               aria-label={sport === 'basketball'
                 ? (awayFollowed ? '取消关注客队' : '关注客队')
                 : (homeFollowed ? '取消关注主队' : '关注主队')}
            >
               <Heart
                 className={`w-3.5 h-3.5 ${(sport === 'basketball' ? awayFollowed : homeFollowed) ? 'fill-[var(--info)] text-[var(--info)] md:fill-nebula-crimson md:text-nebula-crimson' : 'text-[var(--muted-foreground)]/50 md:text-muted-foreground/40'}`}
               />
             </button>
             <div
               className="text-base font-black tracking-tight text-[var(--foreground)] md:text-foreground truncate"
               title={sport === 'basketball' ? match.awayTeam : match.homeTeam}
             >
               {sport === 'basketball' ? match.awayTeam : match.homeTeam}
             </div>
           </div>
           <div className="text-[11px] text-[var(--muted-foreground)]/70 md:text-gray-400 mt-0.5 ml-6">
             {sport === 'basketball' ? '客场' : '主场'}
           </div>
          </div>
            <div className="px-2 text-center flex-shrink-0">
             {(isFinished || isLive || isFinishedPending) && match.homeScore !== undefined && match.awayScore !== undefined ? (
                <div className="flex flex-col items-center">
                  <div className={`text-lg font-bold font-mono tabular-nums transition-colors duration-300 ${isLive ? 'text-[var(--info)] md:text-primary' : 'text-[var(--foreground)] md:text-foreground'}`}>
                    <span className={(sport === 'basketball' ? awayScoreHighlight : homeScoreHighlight) && isLive ? 'bg-[var(--warning)]/30 md:bg-accent/30 text-[var(--warning)] md:text-accent px-1 rounded' : ''}>
                      {sport === 'basketball' ? match.awayScore : match.homeScore}
                    </span>
                     {' - '}
                    <span className={(sport === 'basketball' ? homeScoreHighlight : awayScoreHighlight) && isLive ? 'bg-[var(--warning)]/30 md:bg-accent/30 text-[var(--warning)] md:text-accent px-1 rounded' : ''}>
                      {sport === 'basketball' ? match.homeScore : match.awayScore}
                    </span>
                  </div>
                  {isFinished && match.homeHalfScore !== undefined && match.awayHalfScore !== undefined && (
                     <div className="text-[11px] text-[var(--muted-foreground)] md:text-muted-foreground font-mono mt-0.5">
                       半场 {sport === 'basketball'
                         ? `${match.awayHalfScore}-${match.homeHalfScore}`
                         : `${match.homeHalfScore}-${match.awayHalfScore}`}
                     </div>
                    )}
                  {isLive && (match.livePeriod !== null || match.liveClock) && (
                     <div className="text-[11px] text-[var(--destructive)] md:text-accent font-mono mt-0.5 font-medium">
                       {renderLivePeriodText(match)}
                     </div>
                   )}
                  {isLive && match.liveScoreSource && (
                     <div className="text-[10px] text-[var(--muted-foreground)]/70 md:text-muted-foreground/70 mt-0.5 flex items-center justify-center gap-1">
                       <span className="uppercase">{match.liveScoreSource}</span>
                       <span>·</span>
                       <span>{match.lastScoreAt ? formatLastScoreTime(match.lastScoreAt) : '实时更新中'}</span>
                     </div>
                   )}
               </div>
            ) : isLive && !hasScore ? (
               <div className="text-sm font-bold text-[var(--destructive)] md:text-accent/70 flex items-center gap-1">
                 <span className="relative flex h-2 w-2">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--destructive)] md:bg-accent opacity-75" />
                   <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--destructive)] md:bg-accent" />
                 </span>
                 进行中
               </div>
             ) : isFinishedPending ? (
              <div className="text-sm font-bold text-[var(--muted-foreground)]/70 md:text-muted-foreground/60">— : —</div>
            ) : (
              <div className="text-sm font-bold text-[var(--muted-foreground)]/50 md:text-muted-foreground/40">VS</div>
            )}
           <div className="text-[11px] text-[var(--muted-foreground)] md:text-muted-foreground font-mono mt-1 flex items-center justify-center gap-1">
             {kickoffTimeStr}
             {isNextDayMorning && match.matchStatus === 'upcoming' && (
               <span className="text-[var(--success)] md:text-football-green">· 次日</span>
             )}
           </div>
         </div>
         <div className="flex-1 text-right min-w-0">
           <div className="flex items-center justify-end gap-1.5">
             <div
               className="text-base font-black tracking-tight text-[var(--foreground)] md:text-foreground truncate"
               title={sport === 'basketball' ? match.homeTeam : match.awayTeam}
             >
                {sport === 'basketball' ? match.homeTeam : match.awayTeam}
             </div>
             <button
               onClick={sport === 'basketball' ? handleToggleHomeFollow : handleToggleAwayFollow}
               className="p-1.5 -m-1 rounded-md transition-colors hover:bg-muted flex-shrink-0"
               title={sport === 'basketball'
                 ? (homeFollowed ? '取消关注主队' : '关注主队')
                 : (awayFollowed ? '取消关注客队' : '关注客队')}
               aria-label={sport === 'basketball'
                 ? (homeFollowed ? '取消关注主队' : '关注主队')
                 : (awayFollowed ? '取消关注客队' : '关注客队')}
             >
               <Heart
                 className={`w-3.5 h-3.5 ${(sport === 'basketball' ? homeFollowed : awayFollowed) ? 'fill-[var(--info)] text-[var(--info)] md:fill-nebula-crimson md:text-nebula-crimson' : 'text-[var(--muted-foreground)]/50 md:text-muted-foreground/40'}`}
               />
             </button>
           </div>
           <div className="text-[11px] text-[var(--muted-foreground)]/70 md:text-gray-400 mt-0.5 mr-6">
             {sport === 'basketball' ? '主场' : '客场'}
           </div>
         </div>
       </div>

       {/* 伤停信息行 */}
       {(() => {
         const homeList = parseInjuryText(match.homeInjuries || '');
         const awayList = parseInjuryText(match.awayInjuries || '');
         if (homeList.length === 0 && awayList.length === 0) return null;
         const maxShow = 3;
         const displayHome = homeList.slice(0, maxShow);
         const homeExtra = Math.max(0, homeList.length - maxShow);
         const displayAway = awayList.slice(0, maxShow);
         const awayExtra = Math.max(0, awayList.length - maxShow);
         return (
           <div className="flex items-center gap-2 mb-3 flex-wrap">
             <div className="flex items-center gap-1 flex-shrink-0">
               <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
               <span className="text-[10px] text-muted-foreground/70">伤停</span>
             </div>
             <div className="flex items-center gap-1 flex-wrap min-w-0 flex-1">
               {displayHome.map((item: string, idx: number) => (
                 <span
                   key={`h-${idx}`}
                   className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] bg-home-win/10 text-home-win border border-home-win/20 max-w-[40%]"
                   title={item}
                 >
                   <span className="truncate">{extractPlayerName(item)}</span>
                 </span>
               ))}
               {homeExtra > 0 && (
                 <span
                   className="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] bg-home-win/10 text-home-win/70 border border-home-win/20"
                   title={homeList.join('\n')}
                 >
                   +{homeExtra}
                 </span>
               )}
               {displayHome.length > 0 && displayAway.length > 0 && (
                 <span className="text-[10px] text-muted-foreground/40 mx-0.5">vs</span>
               )}
               {displayAway.map((item: string, idx: number) => (
                 <span
                   key={`a-${idx}`}
                   className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] bg-away-win/10 text-away-win border border-away-win/20 max-w-[40%]"
                   title={item}
                 >
                   <span className="truncate">{extractPlayerName(item)}</span>
                 </span>
               ))}
               {awayExtra > 0 && (
                 <span
                   className="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] bg-away-win/10 text-away-win/70 border border-away-win/20"
                   title={awayList.join('\n')}
                 >
                   +{awayExtra}
                 </span>
               )}
             </div>
           </div>
         );
       })()}

         {/* 比赛进行中·比分源采集中（仅开赛初期且无比分时显示） */}
        {isLive && match.matchStatus === 'upcoming' && !hasScore && (
           <div className="mb-3 flex items-center justify-center gap-1.5 text-accent text-xs font-medium">
             <Clock className="w-3.5 h-3.5" />
             <span className="font-mono">比赛进行中·比分采集中</span>
           </div>
         )}
         {isUpcoming && !match.liveScoreSource && match.kickoffTime && new Date(match.kickoffTime).getTime() - Date.now() < 1000 * 60 * 60 * 3 && (
           <div className="mb-2 flex items-center justify-center gap-1 text-[10px] text-muted-foreground/70">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-muted-foreground/50 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-muted-foreground/50" />
              </span>
              比分源采集中
            </div>
          )}
         {isUpcoming && match.liveScoreSource && (
           <div className="mb-2 flex items-center justify-center gap-1 text-[10px] text-[var(--success)]/80">
             <span className="relative flex h-1.5 w-1.5">
               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-60" />
               <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--success)]" />
             </span>
             <span className="uppercase font-medium">{match.liveScoreSource}</span> 已接入，开赛自动刷新
           </div>
         )}

        {/* 三项栏：赛果 / 让分 / 总分 */}
       <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3 min-w-0">
            {/* 赛果方向 */}
           <div className="bg-[var(--secondary)] md:bg-muted/40 rounded-xl md:rounded-lg p-3 md:p-2.5 text-center border border-[var(--border)] md:border-0">
               <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mb-1">赛果方向</div>
                  {wdwModelNotAnalyzed && !hasWdwOdds ? (
                    <div className="text-xs font-medium text-[var(--muted-foreground)] md:text-muted-foreground py-2">
                      {isFinished ? '无赛前数据' : '暂无胜平负赔率'}
                    </div>
                  ) : wdwIsWait ? (
                    <div className="py-2">
                      <div className="text-sm text-[var(--muted-foreground)]/70 md:text-[var(--muted-foreground)] font-medium">
                        {isLive ? '赛前未出方向' : '观望'}
                      </div>
                       {isFinished && match.hitWdw === null && (
                        <div className="mt-1 text-[10px] font-medium inline-block px-1.5 py-0.5 rounded text-[var(--muted-foreground)] md:text-muted-foreground bg-[var(--card)] md:bg-muted/60">
                          未计
                        </div>
                      )}
                    </div>
                ) : (
                <>
                   <div className="flex items-center justify-center gap-1 mb-1 flex-wrap">
                     <div className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${directionStyle}`}>
                       {match.predictionDirection}
                     </div>
                     {wdwIsLowConfidence && (
                       <span className="text-[10px] text-muted-foreground font-medium">·低</span>
                     )}
                   </div>
                   <div className="flex items-center justify-center gap-1.5 text-[11px] font-mono tabular-nums font-bold">
                      <span className={match.predictionDirection === '主胜' ? 'text-home-win' : 'text-foreground/70'}>
                        主{wdwWidths.home.toFixed(0)}%
                      </span>
                      <span className={match.predictionDirection === '平' ? 'text-draw-text' : 'text-foreground/50'}>
                        平{wdwWidths.draw.toFixed(0)}%
                      </span>
                      <span className={match.predictionDirection === '客胜' ? 'text-away-win' : 'text-foreground/70'}>
                        客{wdwWidths.away.toFixed(0)}%
                      </span>
                   </div>
                   {/* 命中徽章（已完赛） */}
                     {isFinished && match.hitWdw !== undefined && match.hitWdw !== null && (
                      <div className={`mt-1 text-[10px] font-medium inline-block px-1.5 py-0.5 rounded ${
                        match.hitWdw ? 'text-success' : 'text-destructive'
                      }`}>
                         {match.hitWdw ? '✅ 验证通过' : '❌ 未通过'}
                      </div>
                    )}
                </>
              )}
           </div>
            {/* 让分 */}
            <div className="bg-[var(--secondary)] md:bg-muted/40 rounded-xl md:rounded-lg p-3 md:p-2.5 text-center border border-[var(--border)] md:border-0">
              <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mb-1 flex items-center justify-center gap-1 flex-wrap">
                <span className="text-[var(--foreground)]/70 md:text-foreground/70 font-medium">
                   {!hasHandicap ? '让分' : isDrawHandicap ? '平手指数' : `让分 ${match.handicap}`}
                </span>

              </div>
               {!hasHandicap ? (
                   <div className="text-xs font-medium text-[var(--muted-foreground)] md:text-muted-foreground py-2">暂无让分</div>
                  ) : !hasHandicap ? (
                    <div className="text-xs font-medium text-[var(--muted-foreground)] md:text-muted-foreground py-2">暂无让分数据</div>
                  ) : handicapIsWait && !handicapOddsFallbackDirection ? (
                 <>
                   <div className="text-xs font-semibold text-muted-foreground py-0.5">
                     {isLive ? '赛前未出方向' : (handicapPendingLine ? '待线值' : '观望')}
                   </div>
                   <div className="text-[10px] text-muted-foreground/70">
                      {isLive ? '赛前模型未给出方向' : (handicapPendingLine ? '开售后自动更新' : (Math.abs(Number(match.handicap)) >= 2 ? '深指数edge不足' : '暂无方向'))}
                   </div>
                 </>
                 ) : (handicapIsWait && handicapOddsFallbackDirection) ? (
                  <>
                    <div className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-1 ${
                      handicapOddsFallbackDirection.includes('主') || handicapOddsFallbackDirection.includes('让胜')
                        ? 'bg-home-win-bg text-home-win'
                        : 'bg-away-win-bg text-away-win'
                    }`}>
                      {handicapOddsFallbackDirection}
                      <span className="text-[10px] text-muted-foreground font-normal ml-0.5">·低</span>
                    </div>
                  </>
               ) : (
                   <>
                    <div className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-1.5 ${
                      normalizedHandicapRecommendation?.includes('主') || normalizedHandicapRecommendation?.includes('让胜') ? 'bg-home-win-bg text-home-win' :
                     normalizedHandicapRecommendation?.includes('客') || normalizedHandicapRecommendation?.includes('让负') ? 'bg-away-win-bg text-away-win' :
                     'bg-draw-bg text-draw-text'
                    }`}>
                       {normalizedHandicapRecommendation ?? '观望'}
                       {handicapIsLowConfidence && (
                         <span className="text-[10px] text-muted-foreground font-normal ml-0.5">·低</span>
                       )}
                    </div>
                       {normalizedHandicapRecommendation && normalizedHandicapRecommendation !== '观望' ? (
                        <div className="flex items-center justify-center gap-1 text-[11px] font-mono tabular-nums font-bold">
                          <span className={normalizedHandicapRecommendation?.includes('主') || normalizedHandicapRecommendation?.includes('让胜') ? 'text-home-win' : 'text-foreground/70'}>
                            让胜{Math.round(clampPercent(match.handicapWinProb))}%
                          </span>
                          <span className={normalizedHandicapRecommendation?.includes('平') || normalizedHandicapRecommendation?.includes('让平') ? 'text-draw-text' : 'text-foreground/50'}>
                            让平{Math.round(clampPercent(match.handicapDrawProb))}%
                          </span>
                          <span className={normalizedHandicapRecommendation?.includes('客') || normalizedHandicapRecommendation?.includes('让负') ? 'text-away-win' : 'text-foreground/70'}>
                            让负{Math.round(clampPercent(match.handicapLoseProb))}%
                          </span>
                        </div>
                     ) : null}
                   {/* 命中徽章（已完赛） */}
                    {isFinished && hitHandicapDisplay !== null && (
                      <div className={`mt-1 text-[10px] font-medium inline-block px-1.5 py-0.5 rounded ${
                        hitHandicapDisplay ? 'text-success' : 'text-destructive'
                      }`}>
                         {hitHandicapDisplay ? '✅ 验证通过' : '❌ 未通过'}
                      </div>
                    )}
                    {isFinished && hitHandicapDisplay === null && handicapIsWait && hasHandicap && (
                      <div className="mt-1 text-[10px] font-medium inline-block px-1.5 py-0.5 rounded text-muted-foreground bg-muted/60">
                        观望·未计
                      </div>
                    )}
               </>
             )}
           </div>
             {/* 进球数 / 大小分 */}
             <div className="bg-[var(--secondary)] md:bg-muted/40 rounded-xl md:rounded-lg p-3 md:p-2.5 text-center border border-[var(--border)] md:border-0">
                <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mb-1 flex items-center justify-center gap-1">
                  {sport === 'basketball' ? '大小分' : '进球数'}
                  {isBasketballModelTotalRef && (
                    <span
                      className="text-[9px] px-1 py-px rounded border border-[var(--border)] md:border-gray-300 bg-[var(--card)] md:bg-gray-100 text-[var(--muted-foreground)] md:text-gray-500 font-normal"
                      title="竞彩未开大小分盘，此为模型预估值，仅供参考"
                    >
                      模型参考
                    </span>
                  )}
                </div>
                   {!match.overUnder && !isBasketballModelTotalRef ? (
                      <div className="text-xs font-medium text-[var(--muted-foreground)] md:text-muted-foreground py-2">
                         {isFinished ? '—' : '暂无大小盘数据'}
                      </div>
                   ) : isBasketballModelTotalRef ? (
                     <div className="py-1">
                       <div className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-1 bg-[var(--card)] md:bg-gray-100 text-[var(--muted-foreground)] md:text-gray-500 border border-[var(--border)] md:border-gray-200`}>
                         {match.totalPick}
                       </div>
                       <div className="text-sm font-mono tabular-nums font-bold text-[var(--muted-foreground)] md:text-gray-500 flex items-center justify-center gap-1">
                          {match.totalPickProb ?? 0}%
                       </div>
                       <div className="text-[10px] text-[var(--muted-foreground)]/70 md:text-gray-500 mt-0.5">
                        预期 {match.totalGoals?.toFixed(1) ?? '-'}
                      </div>
                     </div>
                   ) : totalIsWait || totalNotAnalyzed ? (
                    <div className="py-2">
                      <div className="text-xs font-medium text-[var(--muted-foreground)]">
                        {isFinished ? '— / 无方向参考' : isLive ? '赛前未出方向' : (totalPendingLine ? '待线值' : '观望')}
                      </div>
                       {totalPendingLine && (
                        <div className="text-[10px] text-muted-foreground/70 mt-1">开售后自动更新</div>
                      )}
                    </div>
                 ) : (
                <>
                  <div className={`inline-block px-2 py-0.5 rounded text-xs font-semibold mb-1 ${
                    match.totalPick === '4-6球' || match.totalPick === '7+球'
                      ? 'bg-home-win-bg text-home-win'
                      : match.totalPick === '0-1球'
                        ? 'bg-away-win-bg text-away-win'
                        : 'bg-draw-bg text-draw-text'
                  }`}>
                    {match.totalPick}
                  </div>
                   <div className="text-sm font-mono tabular-nums font-bold text-foreground flex items-center justify-center gap-1">
                       {match.totalPickProb ?? 0}%
                       <span className={`text-[10px] font-normal ${totalConfidenceLevel.className}`}>
                         {totalConfidenceLevel.label}信心
                       </span>
                     </div>
                     {/* 命中徽章（已完赛） */}
                      {isFinished && hitOverunderDisplay !== null && (
                        <div className={`mt-1 text-[10px] font-medium inline-block px-1.5 py-0.5 rounded ${
                          hitOverunderDisplay ? 'text-success' : 'text-destructive'
                        }`}>
                           {hitOverunderDisplay ? '✅ 验证通过' : '❌ 未通过'}
                        </div>
                      )}
                      {isFinished && hitOverunderDisplay === null && totalIsWait && !totalNotAnalyzed && (
                        <div className="mt-1 text-[10px] font-medium inline-block px-1.5 py-0.5 rounded text-muted-foreground bg-muted/60">
                          观望·未计
                        </div>
                      )}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                     预期 {match.totalGoals?.toFixed(1) ?? '-'}
                   </div>
                </>
              )}
            </div>
        </div>

        {/* 最可能比分 */}
           {!totalIsWait && !isDefaultMostLikelyScore && match.mostLikelyScore && (
             <div className="flex items-center justify-end text-xs mb-3 px-3 py-2 rounded-lg bg-muted/30">
               <div className="flex items-center gap-2">
                 <span className="text-muted-foreground">最可能比分</span>
                 <span className="font-mono font-medium text-foreground">
                   {match.mostLikelyScore}
                 </span>
               </div>
             </div>
          )}

         {/* 高影响伤停提示 */}
         {(() => {
           const homeList = parseInjuryText(match.homeInjuries || '');
           const awayList = parseInjuryText(match.awayInjuries || '');
           const homeHigh = hasHighImpactInjury(homeList);
           const awayHigh = hasHighImpactInjury(awayList);
           if (!homeHigh && !awayHigh) return null;
           const hint = homeHigh && awayHigh
             ? '双方核心缺阵，信心下调'
             : homeHigh
               ? '主队核心缺阵，信心下调'
               : '客队核心缺阵，信心下调';
           return (
             <div className="flex items-center gap-1 mb-2 text-[10px] text-amber-600 font-medium">
               <AlertTriangle className="w-3 h-3 flex-shrink-0" />
               <span>{hint}</span>
             </div>
           );
         })()}


         {/* 让分 / 进球数 完整信息行 */}
        <div className="space-y-1.5 mb-3">
          {hasHandicap && normalizedHandicapRecommendation && !handicapNotAnalyzed && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground flex-shrink-0">
                 {isDrawHandicap ? '平手指数' : '让分'}
              </span>
              {!isDrawHandicap && (
                <span className="font-mono font-medium text-foreground">{match.handicap}</span>
              )}
              <span className="text-muted-foreground/60">·</span>
              <span className={`font-medium ${
                 normalizedHandicapRecommendation.includes('主') || normalizedHandicapRecommendation.includes('让胜')
                   ? 'text-home-win'
                   : normalizedHandicapRecommendation.includes('客') || normalizedHandicapRecommendation.includes('让负')
                    ? 'text-away-win'
                    : 'text-draw-text'
              }`}>
                 {normalizedHandicapRecommendation}
              </span>
            </div>
          )}
         {(match.overUnder || isBasketballModelTotalRef) && match.totalPick && !totalNotAnalyzed && match.totalPick !== '观望' && (
           <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground flex-shrink-0">{sport === 'basketball' ? '大小分' : '进球数'}</span>
             {!isBasketballModelTotalRef && (
               <span className="font-mono font-medium text-foreground">{match.overUnder}</span>
             )}
             {isBasketballModelTotalRef && (
               <span
                 className="text-[9px] px-1 py-px rounded border border-[var(--border)] bg-[var(--secondary)] text-[var(--muted-foreground)] font-normal"
                 title="竞彩未开大小分盘，此为模型预估值，仅供参考"
               >
                 模型参考
               </span>
             )}
             {match.overUnder && !isBasketballModelTotalRef && (
               <span className="text-muted-foreground/60">·</span>
             )}
             {!match.overUnder && isBasketballModelTotalRef && (
               <span className="text-[var(--muted-foreground)]">·</span>
             )}
             <span className={`font-medium ${
               isBasketballModelTotalRef
                 ? 'text-[var(--muted-foreground)]'
                 : match.totalPick === '4-6球' || match.totalPick === '7+球'
                   ? 'text-home-win'
                   : match.totalPick === '0-1球'
                     ? 'text-away-win'
                     : 'text-draw-text'
             }`}>
               {match.totalPick}
             </span>
           </div>
         )}
       </div>

        {/* 标签行 */}
         <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {match.lowConfidence && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-away-win-bg text-away-win border border-away-win/30">
              低信心
            </span>
          )}
         </div>

       {/* 情报摘要行 */}
       {(() => {
         const hasInjuries = match.injuries && match.injuries !== '暂无' && match.injuries !== '暂无可靠情报';
         const hasTeamNews = !!match.teamNews;
         const hasUpsetWarning = !!match.upsetWarning;
         const insufficient = isDataInsufficientFootball({
           injuries: match.injuries,
           homeForm: match.homeForm,
           awayForm: match.awayForm,
           h2h: match.h2h,
           predictionDirection: match.predictionDirection,
           handicapRecommendation: match.handicapRecommendation,
           totalPick: match.totalPick,
         });
         const intelOnly = isIntelIncompleteOnly({
           injuries: match.injuries,
           homeForm: match.homeForm,
           awayForm: match.awayForm,
           h2h: match.h2h,
           predictionDirection: match.predictionDirection,
           handicapRecommendation: match.handicapRecommendation,
           totalPick: match.totalPick,
         });
         if (!hasInjuries && !hasTeamNews && !hasUpsetWarning && !insufficient && !intelOnly) return null;
         if (insufficient && !hasInjuries && !hasTeamNews && !hasUpsetWarning) {
           return (
             <div className="flex items-center gap-2 flex-wrap mb-2 text-xs">
               <span className="inline-flex items-center gap-1 text-[var(--muted-foreground)] font-medium">
                 <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                 <span className="text-[11px]">数据收集中</span>
               </span>
             </div>
           );
         }
         return (
           <div className="flex items-center gap-2 flex-wrap mb-2 text-xs">
             {hasInjuries && (
               <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                 <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                 <span className="text-[11px]">伤病情报</span>
               </span>
             )}
             {hasTeamNews && (
               <span className="inline-flex items-center gap-1 text-muted-foreground">
                 <Zap className="w-3 h-3 text-football-green flex-shrink-0" />
                 <span className="text-[11px] truncate max-w-[120px]">
                   {match.teamNews!.length > 20 ? match.teamNews!.slice(0, 20) + '…' : match.teamNews}
                 </span>
               </span>
             )}
             {hasUpsetWarning && (
               <span className="inline-flex items-center gap-1 px-1.5 py-px rounded bg-draw-bg text-draw-text border border-draw-text/30">
                 <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  <span className="text-[10px] font-medium">意外赛果预警</span>
               </span>
             )}
             {intelOnly && !hasInjuries && !hasTeamNews && !hasUpsetWarning && (
               <span className="inline-flex items-center gap-1 text-[var(--muted-foreground)]">
                 <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
                 <span className="text-[10px]">基础情报采集中</span>
               </span>
             )}
           </div>
         );
       })()}

        {/* 底部行：模型规则标签 + 查看详情 */}
        <div className="pt-3 border-t border-[var(--border)] md:border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {match.modelRules && filterModelRulesForDisplay(match.modelRules).length > 0 ? (
              filterModelRulesForDisplay(match.modelRules).slice(0, 4).map((rule: string, idx: number) => (
                 <span
                   key={idx}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[var(--secondary)] md:bg-muted text-[var(--muted-foreground)] md:text-muted-foreground`}
                 >
                   {rule}
                 </span>
             ))
           ) : (
             <span className="text-[10px] text-[var(--muted-foreground)]/70 md:text-muted-foreground/60">暂无规则标签</span>
           )}
         </div>
        <button
          className="flex items-center gap-0.5 text-xs text-[var(--info)] md:text-primary hover:text-[var(--info)]/80 md:hover:text-primary/80 transition-colors flex-shrink-0 ml-2"
           onClick={(e) => {
             e.stopPropagation();
             navigate(detailPath);
           }}
         >
           详情
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
       </div>
       <ActionSheet
         open={actionSheetOpen}
         onClose={() => setActionSheetOpen(false)}
         items={actionSheetItems}
         title={`${match.homeTeam} vs ${match.awayTeam}`}
       />
     </div>
   );
};

export default memo(MatchCard);
