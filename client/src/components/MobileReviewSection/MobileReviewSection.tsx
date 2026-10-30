import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { basketballApi, matchesApi } from '@client/src/api';
import type { DailyReviewResponse, DailyReviewMatchItem } from '@shared/api.interface';
import { Skeleton } from '@client/src/components/ui/skeleton';

interface MobileReviewSectionProps {
  sport: 'basketball' | 'football';
}

const MAX_BACKTRACK_DAYS = 7;

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateDisplay(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const w = weekdays[date.getDay()];
  return `${m}月${d}日 ${w}`;
}

function shiftDate(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const MobileReviewSection = ({ sport }: MobileReviewSectionProps) => {
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [source, setSource] = useState<string>('sporttery');
  const [data, setData] = useState<DailyReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const dateStr = useMemo(() => formatDate(selectedDate), [selectedDate]);

  const fetchReview = async (targetDate: string, targetSource: string): Promise<DailyReviewResponse | null> => {
    if (sport === 'basketball') {
      return basketballApi.getBasketballDailyReview(targetDate, targetSource);
    }
    return matchesApi.getFootballDailyReview(targetDate, targetSource);
  };

  // 首次加载：自动向前回溯找最近有数据的一天（最多7天）
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(false);
      try {
        let current = new Date();
        let found: DailyReviewResponse | null = null;
        let foundDate: Date | null = null;
        for (let i = 0; i < MAX_BACKTRACK_DAYS; i += 1) {
          const ds = formatDate(current);
          const res = await fetchReview(ds, source);
          if (res && res.totalMatches > 0) {
            found = res;
            foundDate = current;
            break;
          }
          current = shiftDate(current, -1);
        }
        if (cancelled) return;
        if (found && foundDate) {
          setSelectedDate(foundDate);
          setData(found);
        } else {
          setData(null);
        }
      } catch (err) {
        logger.error('加载复盘数据失败', err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport, source]);

  // 手动切换日期时只拉当天数据
  const handleDateChange = async (delta: number) => {
    const newDate = shiftDate(selectedDate, delta);
    setSelectedDate(newDate);
    setLoading(true);
    setError(false);
    try {
      const ds = formatDate(newDate);
      const res = await fetchReview(ds, source);
      setData(res);
    } catch (err) {
      logger.error('加载复盘数据失败', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const hasData = !!(data && data.totalMatches > 0);

  // 三大命中率
  const wdwRate = data?.wdwRate ?? 0;
  const wdwHit = data?.wdwHit ?? 0;
  const wdwTotal = data?.wdwTotal ?? 0;
  const hdcRate = data?.handicapRate ?? 0;
  const hdcHit = data?.handicapHit ?? 0;
  const hdcTotal = data?.handicapTotal ?? 0;
  const ouRate = data?.overunderRate ?? 0;
  const ouHit = data?.overunderHit ?? 0;
  const ouTotal = data?.overunderTotal ?? 0;
  const totalMatches = data?.totalMatches ?? 0;
  const anomalyCount = data?.anomalyMatches?.length ?? 0;

  const isFootball = sport === 'football';

  return (
    <div className="space-y-4">
      {/* 日期切换行 - 吸顶 */}
      <div className="sticky top-0 z-10 bg-[var(--background)] -mx-4 px-4 pt-2 pb-3 border-b border-[var(--border)]">
        {isFootball && (
          <div className="flex justify-center mb-3">
            <div className="inline-flex items-center bg-[var(--card)] rounded-full p-1 border border-[var(--border)]">
              {[
                { key: 'sporttery', label: '竞彩' },
                { key: 'beidan', label: '北单' },
              ].map((item) => {
                const isActive = source === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setSource(item.key)}
                    className={`px-5 h-8 text-xs font-medium rounded-full transition-all min-w-[60px] ${
                      isActive
                        ? 'bg-[var(--accent-primary)] text-white shadow-lg shadow-[var(--accent-primary)]/30'
                        : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => handleDateChange(-1)}
            className="w-11 h-11 flex items-center justify-center rounded-full bg-[var(--card)] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors active:scale-95"
            aria-label="前一天"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-[120px] text-center">
            <div className="text-sm font-bold text-[var(--foreground)]">{formatDateDisplay(selectedDate)}</div>
            <div className="text-[11px] text-[var(--muted-foreground)] tabular-nums">{dateStr}</div>
          </div>
          <button
            onClick={() => handleDateChange(1)}
            className="w-11 h-11 flex items-center justify-center rounded-full bg-[var(--card)] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors active:scale-95"
            aria-label="后一天"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {loading && <ReviewSkeleton />}
      {error && !loading && (
        <div className="bg-[var(--card)] rounded-2xl border border-[var(--border)] p-8 text-center">
          <AlertCircle className="w-10 h-10 mx-auto text-red-500 mb-3" />
          <div className="text-sm font-medium text-[var(--foreground)] mb-1">加载失败</div>
          <div className="text-xs text-[var(--muted-foreground)]">请检查网络连接后重试</div>
        </div>
      )}
      {!loading && !error && !hasData && (
        <div className="bg-[var(--card)] rounded-2xl border border-[var(--border)] p-8 text-center">
          <div className="text-3xl mb-2">📭</div>
          <div className="text-sm font-medium text-[var(--foreground)] mb-1">暂无复盘数据</div>
          <div className="text-xs text-[var(--muted-foreground)]">
            {isFootball ? '当日赛事尚未完结或未生成复盘' : '当日赛事尚未完结或未生成复盘'}
          </div>
        </div>
      )}
      {!loading && !error && hasData && data && (
        <>
          {/* 三大命中率卡片 */}
          <div className="grid grid-cols-3 gap-2" data-ai-section-type="card-stat">
            <HitCard
              label={isFootball ? '胜负' : '胜负'}
              hitRate={wdwRate}
              hit={wdwHit}
              total={wdwTotal}
            />
            <HitCard
              label={isFootball ? '让球' : '让分'}
              hitRate={hdcRate}
              hit={hdcHit}
              total={hdcTotal}
            />
            <HitCard
              label={isFootball ? '进球数' : '大小分'}
              hitRate={ouRate}
              hit={ouHit}
              total={ouTotal}
            />
          </div>

          {/* 总场次概览 */}
          <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] px-4 py-3 flex items-center justify-between">
            <div>
              <span className="text-xs text-[var(--muted-foreground)]">总场次</span>
              <span className="ml-2 text-sm font-bold text-[var(--foreground)] tabular-nums">
                {totalMatches}
              </span>
            </div>
            {anomalyCount > 0 && (
              <div className="flex items-center gap-1.5 text-amber-500">
                <AlertCircle className="w-4 h-4" />
                <span className="text-xs font-medium tabular-nums">异常 {anomalyCount} 场</span>
              </div>
            )}
          </div>

          {/* 逐场命中明细列表 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                逐场明细
              </h3>
              <span className="text-[11px] text-[var(--muted-foreground)] tabular-nums">
                共 {data.matches.length} 场
              </span>
            </div>
            {data.matches.map((match: DailyReviewMatchItem) => (
              <MatchRow key={match.id} match={match} isFootball={isFootball} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ─── 命中率卡片 ───
interface HitCardProps {
  label: string;
  hitRate: number | null;
  hit: number | null;
  total: number | null;
}

const HitCard = ({ label, hitRate, hit, total }: HitCardProps) => {
  const rate = hitRate ?? 0;
  const pct = Math.round(rate * 100);
  const hitNum = hit ?? 0;
  const totalNum = total ?? 0;
  return (
    <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-3 text-center">
      <div className="text-[10px] font-medium text-[var(--muted-foreground)] mb-1">{label}</div>
      <div className="text-xl font-black text-[var(--foreground)] tabular-nums leading-tight">
        {totalNum > 0 ? pct : '--'}
        {totalNum > 0 && <span className="text-sm font-bold text-[var(--muted-foreground)]">%</span>}
      </div>
      <div className="text-[10px] text-[var(--muted-foreground)] mt-1 tabular-nums">
        {totalNum > 0 ? `${hitNum}/${totalNum}` : '暂无数据'}
      </div>
    </div>
  );
};

// ─── 逐场明细行 ───
interface MatchRowProps {
  match: DailyReviewMatchItem;
  isFootball: boolean;
}

const MatchRow = ({ match, isFootball }: MatchRowProps) => {
  const hdcHit = match.hitHandicap;
  const ouHit = match.hitOverunder;

  return (
    <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1 truncate">
            {match.league}
          </div>
          <div className="text-sm font-medium text-[var(--foreground)] leading-tight truncate">
            {match.homeTeam} vs {match.awayTeam}
          </div>
          <div className="text-[11px] text-[var(--muted-foreground)] mt-1 tabular-nums">
            {match.homeScore !== null && match.awayScore !== null
              ? `${match.homeScore} - ${match.awayScore}`
              : '未开赛'}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {/* 让分/让球 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--muted-foreground)] max-w-[80px] text-right truncate">
              {match.handicapRecommendation}
            </span>
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                hdcHit === true
                  ? 'bg-green-500/20 text-green-500'
                  : hdcHit === false
                    ? 'bg-red-500/20 text-red-500'
                    : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
              }`}
              aria-label={hdcHit === true ? '命中' : hdcHit === false ? '未中' : '待定'}
            >
              {hdcHit === true ? '✓' : hdcHit === false ? '✗' : '—'}
            </span>
          </div>
          {/* 大小分/进球数 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--muted-foreground)] max-w-[80px] text-right truncate">
              {match.totalDirection} {match.totalLine}
            </span>
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                ouHit === true
                  ? 'bg-green-500/20 text-green-500'
                  : ouHit === false
                    ? 'bg-red-500/20 text-red-500'
                    : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
              }`}
              aria-label={ouHit === true ? '命中' : ouHit === false ? '未中' : '待定'}
            >
              {ouHit === true ? '✓' : ouHit === false ? '✗' : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Skeleton ───
const ReviewSkeleton = () => (
  <div className="space-y-4">
    <div className="grid grid-cols-3 gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-3 text-center">
          <Skeleton className="h-3 w-10 mx-auto mb-2 rounded" />
          <Skeleton className="h-7 w-14 mx-auto mb-2 rounded" />
          <Skeleton className="h-3 w-12 mx-auto rounded" />
        </div>
      ))}
    </div>
    <Skeleton className="h-12 w-full rounded-xl" />
    <div className="space-y-2">
      <Skeleton className="h-4 w-16 rounded" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  </div>
);

export { MobileReviewSection };
