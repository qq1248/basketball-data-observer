import { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, AlertTriangle, Heart, ChevronDown, ChevronUp, TrendingUp, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { BasketballMatchItem } from '@shared/api.interface';
import { formatStrengthDisplay } from '@client/src/utils/strength-display';
import { computeMatchStatus } from '@client/src/utils/format';
import type { ComputedMatchStatus } from '@client/src/utils/format';
import { useFollowStore, type SportType } from '@client/src/hooks/useFollowStore';
import { formatMatchNoBadge, getCountdownState } from '@client/src/utils/match-card-enhance';
import { isDataInsufficientBasketball } from '@client/src/utils/data-quality';
import { guardConsistency } from '@client/src/utils/basketball-consistency-guard';
import ActionSheet from '@client/src/components/ui/action-sheet';
import type { ActionSheetItem } from '@client/src/components/ui/action-sheet';

function clampIntPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

const HIGH_IMPACT_KEYWORDS = ['核心', '主力', '头号', '赛季报销', '确定缺阵', '缺阵', '伤缺', 'out', 'doubtful', 'indefinitely', 'out for season', '赛季'];

function parseInjuryList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item: unknown) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const name = typeof obj.name === 'string' ? obj.name : '';
          const injuryType = typeof obj.injuryType === 'string' ? obj.injuryType : '';
          const status = typeof obj.status === 'string' ? obj.status : '';
          if (!name && !injuryType) return '';
          return `${name}（${injuryType || status || '伤缺'}${injuryType && status && injuryType !== status ? '，' + status : ''}）`;
        }
        return '';
      })
      .filter((s: string) => s.length > 0);
  }
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    return raw.split(/\n|,|，/).map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  }
  return [];
}

function hasHighImpactInjury(injuries: string[] | null | undefined): boolean {
  if (!injuries || injuries.length === 0) return false;
  return injuries.some((inj: string) =>
    HIGH_IMPACT_KEYWORDS.some((kw: string) => inj.includes(kw)),
  );
}

interface BasketballCardProps {
  match: BasketballMatchItem;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  computedStatus?: ComputedMatchStatus;
  nowTimestamp?: number;
}

export default function BasketballCard({
  match,
  isFavorite,
  onToggleFavorite,
  computedStatus: computedStatusProp,
  nowTimestamp,
}: BasketballCardProps) {
  const effectiveNow = nowTimestamp ?? Date.now();
  const safeMatch = guardConsistency(match);
  const matchNoBadge = formatMatchNoBadge(match.matchNo, match.source);
  const countdownState = getCountdownState(match.kickoffTime, match.matchStatus, effectiveNow);

  const navigate = useNavigate();
  const hasScore = match.homeScore != null && match.awayScore != null;
  const hasLiveSource = !!match.liveScoreSource && match.liveScoreSource !== '';
  const computedStatus: ComputedMatchStatus = computedStatusProp
    ?? computeMatchStatus(match.matchStatus, match.kickoffTime, hasScore, 'basketball', hasLiveSource);
  const isFinished = computedStatus === 'finished';
  const isLive = computedStatus === 'live';
  const isUpcoming = computedStatus === 'upcoming';

  const periodDisplay = (() => {
    if (!isLive) return null;
    if (match.livePeriod != null && match.livePeriod > 0 && !match.livePeriodEstimated) {
      return {
        period: match.livePeriod,
        clock: match.liveClock ?? '',
        estimated: false,
        hasOvertimeNode: match.livePeriod > 4,
      };
    }
    return { period: 0, clock: '', estimated: true, hasOvertimeNode: false };
  })();

  const hcNumVal = match.handicapLineNum ?? 0;
  const totalNumVal = match.totalLineNum ?? 0;
  const hasHandicapLine = !!(hcNumVal !== 0 && Math.abs(hcNumVal) > 0 && Math.abs(hcNumVal) <= 50);
  const hasTotalLine = !!(totalNumVal > 0 && totalNumVal > 80 && totalNumVal < 300);
  const hasModelTotalRef = !!match.totalPick && match.totalPick.includes('模型参考');
  const showTotalPick = hasTotalLine || hasModelTotalRef;

  const lineMovements = (() => {
    const arr = match.oddsMovements;
    if (!arr || !Array.isArray(arr) || arr.length === 0) return [];
    const lineTypes = new Set(['handicap_line', 'handicap', 'total_line', 'total']);
    return arr.filter((m: { type: string; newValue: string; oldValue: string }) => {
      if (!lineTypes.has(m.type)) return false;
      const nv = parseFloat(m.newValue);
      const ov = parseFloat(m.oldValue);
      if (isNaN(nv) || isNaN(ov)) return false;
      return Math.abs(nv - ov) > 0.01;
    });
  })();
  const lineMovementCount = lineMovements.length;

  const getMovementTypeLabel = (type: string): string => {
    if (type === 'handicap_line' || type === 'handicap') return '让分线';
    if (type === 'total_line' || type === 'total') return '大小分线';
    return type;
  };

  const handleLineMovementBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLineMovementsOpen(v => !v);
  };

  const totalLineNum = match.totalLineNum ?? 0;
  const wdwConfidence = Math.max(safeMatch.homeWinProb ?? 0, safeMatch.awayWinProb ?? 0);

  const strengthInfo = formatStrengthDisplay(
    match.homeTeam,
    match.awayTeam,
    safeMatch.predictedHomeScore,
    safeMatch.predictedAwayScore,
    match.confidence,
  );

  const wdwIsWait = !safeMatch.predictionDirection || safeMatch.predictionDirection === '观望' || safeMatch.predictionDirection === '-';
  const noOddsAtAll = isUpcoming && !hasHandicapLine && !hasTotalLine;
  const isLowDataQuality = (
    match.isModelAnalyzed === false ||
    match.wdwAnalyzed === false ||
    (match.confidence ?? 0) < 20 ||
    (safeMatch.predictionDirection === '观望' && (match.confidence ?? 0) === 0)
  );

  const totalIsOver = safeMatch.totalPick === '大分';
  const totalIsUnder = safeMatch.totalPick === '小分';
  const totalLineDisplay = hasTotalLine ? totalLineNum.toFixed(1) : '—';

  const { checkTeamFollowed, toggleTeam } = useFollowStore();
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [lineMovementsOpen, setLineMovementsOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const sport: SportType = 'basketball';
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

  const handleCardClick = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    navigate(`/basketball/detail/${match.id}`);
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite(match.id);
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
      icon: <AlertTriangle className="w-5 h-5 text-[var(--accent-primary)]" />,
      onClick: () => {
        navigate(`/basketball/detail/${match.id}#injuries`);
      },
    },
    {
      key: 'toggle-home-follow',
      label: homeFollowed ? `取消关注 ${match.homeTeam}` : `关注 ${match.homeTeam}（主队）`,
      icon: <Heart className={`w-5 h-5 ${homeFollowed ? 'text-[var(--accent-primary)] fill-[var(--accent-primary)]' : 'text-[var(--muted-foreground)]'}`} />,
      onClick: () => {
        toggleTeam(sport, match.homeTeam);
      },
    },
  ];

  const kickoffBeijingTime = (() => {
    const d = new Date(match.kickoffTime);
    const beijingMs = d.getTime() + 8 * 60 * 60 * 1000;
    const bj = new Date(beijingMs);
    const hh = String(bj.getUTCHours()).padStart(2, '0');
    const mi = String(bj.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mi}`;
  })();

  const wdwIsHomeWin = safeMatch.predictionDirection === '主胜';
  const wdwIsAwayWin = safeMatch.predictionDirection === '客胜';

  const confValue = clampIntPercent(match.confidence ?? 0);
  const confLevel = confValue >= 65 ? 'high' : confValue >= 58 ? 'mid' : 'low';

  const homeInjuryList = parseInjuryList(match.homeInjuries);
  const awayInjuryList = parseInjuryList(match.awayInjuries);
  const injuryCount = homeInjuryList.length + awayInjuryList.length;

  const getStatusBarClass = (): string => {
    if (isLive && periodDisplay && !periodDisplay.estimated) {
      return 'border-l-[3px] border-l-[var(--destructive)]';
    }
    if (isLive) {
      return 'border-l-[3px] border-l-[var(--warning)]';
    }
    if (isFinished) {
      return 'border-l-[3px] border-l-[var(--success)]/50';
    }
    return 'border-l-[3px] border-l-[var(--border)]';
  };

  return (
    <div
      onClick={handleCardClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      className={`relative bg-[var(--card)] rounded-xl border border-[var(--border)] shadow-sm p-3 cursor-pointer active:scale-[0.98] transition-all duration-150 select-none overflow-hidden ${getStatusBarClass()}`}
    >
      {/* 顶部：联赛+编号+状态+收藏 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {matchNoBadge && (
            <span className="bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] text-[10px] font-bold rounded px-1.5 py-0.5 flex-shrink-0">
              {matchNoBadge}
            </span>
          )}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] truncate">{match.league}</span>
          {isLowDataQuality && (
            <span className="text-[9px] px-1 py-px rounded-full bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] flex-shrink-0">
              数据不足
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0 ml-2">
          <span className={`text-[10px] font-medium tabular-nums flex items-center gap-1 ${
            isLive ? 'text-[var(--destructive)] font-bold'
              : isFinished ? 'text-[var(--success)] font-bold'
              : 'text-[var(--muted-foreground)]'
          }`}>
            {isLive ? (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--destructive)] opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--destructive)]" />
              </span>
            ) : null}
            {isLive ? 'LIVE' : isFinished ? 'FT' : kickoffBeijingTime}
          </span>
          <button
            onClick={handleFavoriteClick}
            className="w-8 h-8 -mr-1.5 -my-1.5 flex items-center justify-center rounded-full hover:text-[var(--accent-primary)] active:scale-95 transition-colors flex-shrink-0"
            aria-label={isFavorite ? '取消收藏' : '收藏'}
          >
            <Heart
              className={`w-3.5 h-3.5 ${
                isFavorite
                  ? 'fill-[var(--accent-primary)] text-[var(--accent-primary)]'
                  : 'text-[var(--muted-foreground)]'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 对阵区 — 左客右主（竞彩官方口径：客队 VS 主队） */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-1">
            <button
              onClick={handleToggleAwayFollow}
              className="w-5 h-5 -ml-0.5 flex items-center justify-center rounded hover:bg-white/5 active:scale-95 transition-colors flex-shrink-0"
              aria-label={awayFollowed ? '取消关注客队' : '关注客队'}
            >
                <Heart
                  className={`w-3 h-3 ${awayFollowed ? 'fill-[var(--accent-primary)] text-[var(--accent-primary)]' : 'text-[var(--muted-foreground)]'}`}
                />
            </button>
            <span className="text-[var(--foreground)] font-bold text-sm truncate">{match.awayTeam}</span>
          </div>
          {(isLive || isFinished) && match.awayScore !== null && match.awayScore !== undefined && (
            <div className="font-black text-xl tabular-nums mt-0.5 text-[var(--away-win)]">
              {match.awayScore}
            </div>
          )}
        </div>

        <div className="px-2 text-center flex-shrink-0 flex flex-col items-center">
          {isLive ? (
            <div className="text-[var(--destructive)] text-[9px] font-black uppercase tracking-widest">LIVE</div>
          ) : isFinished ? (
            <div className="text-[var(--success)] text-[9px] font-black uppercase tracking-widest">FT</div>
          ) : (
            <div className="text-[var(--muted-foreground)] text-[9px] font-bold uppercase tracking-wider">VS</div>
          )}
          {isLive && periodDisplay && !periodDisplay.estimated && (
            <div className="text-[var(--muted-foreground)] text-[9px] mt-0.5">
              Q{periodDisplay.period}
            </div>
          )}
        </div>

        <div className="flex-1 text-right min-w-0">
          <div className="flex items-center justify-end gap-1">
            <span className="text-[var(--foreground)] font-bold text-sm truncate">{match.homeTeam}</span>
            <button
              onClick={handleToggleHomeFollow}
              className="w-5 h-5 -mr-0.5 flex items-center justify-center rounded hover:bg-white/5 active:scale-95 transition-colors flex-shrink-0"
              aria-label={homeFollowed ? '取消关注主队' : '关注主队'}
            >
                <Heart
                  className={`w-3 h-3 ${homeFollowed ? 'fill-[var(--accent-primary)] text-[var(--accent-primary)]' : 'text-[var(--muted-foreground)]'}`}
                />
            </button>
          </div>
          {(isLive || isFinished) && match.homeScore !== null && match.homeScore !== undefined && (
            <div className="font-black text-xl tabular-nums mt-0.5 text-[var(--home-win)] text-right">
              {match.homeScore}
            </div>
          )}
        </div>
      </div>

      {/* 核心预测区：让分 + 大小分 并排两列 */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        {/* 让分列 */}
        <div className="bg-[var(--secondary)] rounded-lg p-2.5 text-center">
          <div className="text-[9px] text-[var(--muted-foreground)] uppercase tracking-widest mb-1">让分</div>
          {strengthInfo.strongerSide === 'even' && !safeMatch.predictedHomeScore ? (
            <div className="text-[var(--muted-foreground)] font-bold text-sm">
              {isUpcoming && noOddsAtAll ? '指数待开' : '观望'}
            </div>
          ) : (
            <>
              <div className={`font-black text-base tabular-nums leading-tight ${
                strengthInfo.strongerSide === 'home'
                  ? 'text-[var(--home-win)]'
                  : strengthInfo.strongerSide === 'away'
                    ? 'text-[var(--away-win)]'
                    : 'text-[var(--muted-foreground)]'
              }`}>
                {strengthInfo.strongerSide === 'even' ? '势均力敌' : `${strengthInfo.strongerTeam}`}
              </div>
              <div className="text-[var(--muted-foreground)] text-[10px] mt-0.5">
                {strengthInfo.strongerSide === 'even' ? '—' : `预期净胜 ${strengthInfo.spreadText}`}
              </div>
              {hasHandicapLine && match.handicapLineNum != null && (
                <div className="text-[var(--muted-foreground)] text-[9px] mt-0.5">
                  盘 {match.handicapLineNum > 0 ? '+' : ''}{match.handicapLineNum.toFixed(1)}
                </div>
              )}
            </>
          )}
        </div>

        {/* 大小分列 */}
        <div className="bg-[var(--secondary)] rounded-lg p-2.5 text-center">
          <div className="text-[9px] text-[var(--muted-foreground)] uppercase tracking-widest mb-1">大小分</div>
          {safeMatch.totalPick === '观望' || !safeMatch.totalPick ? (
            <div className="text-[var(--muted-foreground)] font-bold text-sm">观望</div>
          ) : (
            <>
              <div className={`font-black text-base tabular-nums leading-tight ${
                totalIsOver ? 'text-[var(--total-over)]' : 'text-[var(--total-under)]'
              }`}>
                {safeMatch.totalPick}
              </div>
              <div className="text-[var(--muted-foreground)] text-[10px] mt-0.5">
                盘 {totalLineDisplay}
              </div>
              <div className="text-[var(--muted-foreground)] text-[9px] mt-0.5">
                {safeMatch.totalPickProb && safeMatch.totalPickProb > 0
                  ? `${clampIntPercent(safeMatch.totalPickProb)}%`
                  : safeMatch.overProb > 0 && safeMatch.underProb > 0
                    ? `${clampIntPercent(totalIsOver ? safeMatch.overProb : safeMatch.underProb)}%`
                    : '—'
                }
              </div>
            </>
          )}
        </div>
      </div>

      {/* 信心条 + 底部信息 */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-[var(--muted-foreground)] font-medium">信心度</span>
            <span className={`text-[9px] font-bold tabular-nums ${
              confLevel === 'high' ? 'text-[var(--accent-primary)]'
                : confLevel === 'mid' ? 'text-[var(--warning)]'
                : 'text-[var(--muted-foreground)]'
            }`}>
              {confValue}%
            </span>
          </div>
          <div className="h-1 bg-[var(--secondary)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                confLevel === 'high'
                  ? 'bg-gradient-to-r from-[var(--accent-primary)] to-[var(--warning)]'
                  : confLevel === 'mid'
                    ? 'bg-gradient-to-r from-[var(--accent-primary)] to-[var(--warning)] opacity-70'
                    : 'bg-[var(--muted-foreground)]/40'
              }`}
              style={{ width: `${confValue}%` }}
            />
          </div>
        </div>
      </div>

      {/* 底部补充条：伤停 + 线动 */}
      {(injuryCount > 0 || lineMovementCount > 0) && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[var(--border)]">
          {injuryCount > 0 && (
            <div className="flex items-center gap-1 text-[var(--accent-primary)] flex-shrink-0">
              <AlertTriangle className="w-3 h-3" />
              <span className="text-[10px]">伤停{injuryCount}人</span>
            </div>
          )}
          {lineMovementCount > 0 && (
            <button
              onClick={handleLineMovementBadgeClick}
              className="flex items-center gap-1 text-[10px] text-[var(--accent-primary)] flex-shrink-0 hover:text-[var(--accent-primary-light)] transition-colors"
              aria-label={`线值变动${lineMovementCount}次`}
            >
              <TrendingUp className="w-3 h-3" />
              <span>线动{lineMovementCount}次</span>
              {lineMovementsOpen ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
            </button>
          )}
          <div className="flex-1 text-right text-[var(--muted-foreground)] text-[10px] truncate">
            点击查看详情 →
          </div>
        </div>
      )}

      {/* 完赛命中标记 */}
      {isFinished && (match.hitWdw !== null || match.hitHandicap !== null || match.hitOverunder !== null) && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--border)] text-[10px]">
          {match.hitWdw !== null && (
            <span className={match.hitWdw ? 'text-[var(--success)] font-medium' : 'text-[var(--muted-foreground)]'}>
              {match.hitWdw ? '✓ 胜负' : '✗ 胜负'}
            </span>
          )}
          {hasHandicapLine && match.hitHandicap !== null && (
            <span className={match.hitHandicap ? 'text-[var(--success)] font-medium' : 'text-[var(--muted-foreground)]'}>
              {match.hitHandicap ? '✓ 让分' : '✗ 让分'}
            </span>
          )}
          {showTotalPick && match.hitOverunder !== null && (
            <span className={match.hitOverunder ? 'text-[var(--success)] font-medium' : 'text-[var(--muted-foreground)]'}>
              {match.hitOverunder ? '✓ 大小分' : '✗ 大小分'}
            </span>
          )}
        </div>
      )}

      {/* live estimated：同步中 */}
      {isLive && periodDisplay && periodDisplay.estimated && (
        <div className="absolute top-2 right-2 flex items-center gap-1 text-[9px] text-[var(--accent-primary)]">
          <Loader2 className="w-3 h-3 animate-spin" />
          同步中
        </div>
      )}

      {/* 线值变动展开 */}
      {lineMovementCount > 0 && lineMovementsOpen && (
        <div className="mt-2 px-2.5 py-2 rounded-lg bg-[var(--secondary)] border border-[var(--accent-primary)]/20">
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {lineMovements.map((m: { time: string; type: string; oldValue: string; newValue: string }, idx: number) => (
              <div key={idx} className="flex items-center justify-between text-[9px] gap-2">
                <span className="text-[var(--muted-foreground)] font-mono flex-shrink-0">
                  {dayjs(m.time).format('MM-DD HH:mm')}
                </span>
                <span className="text-[var(--accent-primary)] font-medium flex-shrink-0 w-12 text-center">
                  {getMovementTypeLabel(m.type)}
                </span>
                <span className="text-[var(--muted-foreground)] font-mono flex-1 text-right truncate">
                  {m.oldValue} → {m.newValue}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ActionSheet
        open={actionSheetOpen}
        onClose={() => setActionSheetOpen(false)}
        items={actionSheetItems}
        title={`${match.awayTeam} vs ${match.homeTeam}`}
      />
    </div>
  );
}
