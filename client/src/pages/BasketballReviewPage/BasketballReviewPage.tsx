import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Trophy,
  Target,
  Layers,
  AlertTriangle,
  Clock,
  BarChart3,
  CheckCircle2,
  XCircle,
  Sparkles,
  FileText,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { basketballApi, matchesApi } from '@client/src/api';
import type {
  DailyReviewResponse,
  DailyReviewByLeagueItem,
  DailyReviewAnomalyMatch,
  DailyReviewMatchItem,
} from '@shared/api.interface';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@client/src/components/ui/popover';
import { Calendar } from '@client/src/components/ui/calendar';
import dayjs from 'dayjs';

type SportTab = 'basketball' | 'football';

const CRIMSON_SEQ = ['#8B0000', '#A52A2A', '#CD5C5C', '#E9967A', '#FFA07A'];

const formatDate = (d: Date): string => dayjs(d).format('YYYY-MM-DD');

const BasketballReviewPage = () => {
  const navigate = useNavigate();
  const [sport, setSport] = useState<SportTab>('basketball');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [data, setData] = useState<DailyReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const dateStr = useMemo(() => formatDate(selectedDate), [selectedDate]);

  const fetchReview = useCallback(async (sportVal: SportTab, date: string, autoBacktrack = false) => {
    setLoading(true);
    setError(false);
    try {
      const fn = sportVal === 'basketball'
        ? basketballApi.getBasketballDailyReview
        : matchesApi.getFootballDailyReview;
      const res = await fn(date);
      if (res) {
        setData(res);
      } else if (autoBacktrack) {
        // 自动向前找最近有数据的一天，最多找 14 天
        let found: DailyReviewResponse | null = null;
        let foundDate = date;
        for (let i = 1; i <= 14; i += 1) {
          const prevDate = dayjs(date).subtract(i, 'day').format('YYYY-MM-DD');
          // eslint-disable-next-line no-await-in-loop
          const prevRes = await fn(prevDate);
          if (prevRes) {
            found = prevRes;
            foundDate = prevDate;
            break;
          }
        }
        if (found) {
          setData(found);
          setSelectedDate(dayjs(foundDate).toDate());
        } else {
          setData(null);
        }
      } else {
        setData(null);
      }
    } catch (err) {
      logger.error('加载每日复盘失败', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初次加载：今天，若无数据自动向前找
  useEffect(() => {
    fetchReview(sport, dateStr, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  const handleDateChange = (d: Date) => {
    setSelectedDate(d);
    fetchReview(sport, formatDate(d), false);
  };

  const handlePrevDay = () => {
    const d = dayjs(selectedDate).subtract(1, 'day').toDate();
    handleDateChange(d);
  };

  const handleNextDay = () => {
    const d = dayjs(selectedDate).add(1, 'day').toDate();
    const today = dayjs().startOf('day');
    if (dayjs(d).isAfter(today)) return;
    handleDateChange(d);
  };

  const handleSportChange = (s: SportTab) => {
    if (s === sport) return;
    setSport(s);
  };

  const sortedByLeague = useMemo(() => {
    const list = data?.byLeague ?? [];
    return [...list].sort((a, b) => b.hdcRate - a.hdcRate);
  }, [data]);

  const displayDate = dayjs(selectedDate).format('YYYY年M月D日 dddd');
  const isToday = dayjs(selectedDate).isSame(dayjs(), 'day');

  return (
    <div className="min-h-full bg-background">
      {/* Hero */}
      <div className="bg-hero-dark text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-24 pt-12 pb-10">
          <div className="eyebrow eyebrow-line text-white/70 mb-4">
            DAILY REVIEW · 每日复盘
          </div>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors mb-6"
          >
            <ChevronLeft className="w-4 h-4" />
            返回
          </button>
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white mb-3">
            每日复盘
          </h1>
          <p className="text-sm md:text-base text-white/60">
            模型命中率全景透视 · 异常场次深度拆解
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-24 py-8">
        <div className="flex flex-col md:flex-row gap-6">
          {/* 左栏：日期 + 运动切换 */}
          <aside className="w-full md:w-1/4 md:flex-shrink-0 space-y-4">
            {/* 运动类型 Tab */}
            <div className="metric-card p-1.5 rounded-2xl">
              <div className="flex rounded-xl bg-muted/30 p-0.5">
                <button
                  onClick={() => handleSportChange('basketball')}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                    sport === 'basketball'
                      ? 'bg-nebula-crimson text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  篮球
                </button>
                <button
                  onClick={() => handleSportChange('football')}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                    sport === 'football'
                      ? 'bg-nebula-crimson text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  足球
                </button>
              </div>
            </div>

            {/* 日期选择器卡片 */}
            <div className="metric-card p-4 rounded-2xl space-y-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-nebula-crimson" />
                <span className="text-sm font-black tracking-tight text-foreground">
                  选择日期
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handlePrevDay}
                  aria-label="前一天"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="flex-1 h-8 justify-between text-xs font-medium"
                    >
                      <span>{displayDate}</span>
                      <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="center">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(d) => d && handleDateChange(d)}
                      disabled={{ after: new Date() }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleNextDay}
                  disabled={isToday}
                  aria-label="后一天"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="text-[11px] text-muted-foreground leading-relaxed">
                每日 22:00 自动生成当日复盘，复盘内容包含当日完赛场次的命中率统计与异常场次拆解。
              </div>
            </div>

            {/* 快速信息卡 */}
            {!loading && !error && data && (
              <div className="metric-card p-4 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-nebula-crimson" />
                  <span className="text-sm font-black tracking-tight text-foreground">
                    复盘概览
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">运动类型</span>
                  <span className="font-medium text-foreground">
                    {sport === 'basketball' ? '篮球' : '足球'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">完赛场次</span>
                  <span className="font-black text-nebula-crimson tabular-nums">
                    {data.totalMatches}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">异常场次</span>
                  <span className="font-medium text-foreground">
                    {(data.anomalyMatches ?? []).length} 场
                  </span>
                </div>
              </div>
            )}
          </aside>

          {/* 右栏：数据详情 */}
          <main className="flex-1 min-w-0 space-y-6">
            {loading && <ReviewSkeleton />}
            {error && <ErrorState onRetry={() => fetchReview(sport, dateStr, false)} />}
            {!loading && !error && !data && <EmptyState dateStr={dateStr} />}
            {!loading && !error && data && (
              <>
                {/* 顶部 4 个指标卡 */}
                <div
                  className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4"
                  data-ai-section-type="card-stat"
                >
                  <MetricCard
                    icon={BarChart3}
                    label="总场次"
                    subLabel="TOTAL"
                    value={data.totalMatches}
                    suffix="场"
                    color={CRIMSON_SEQ[0]}
                    progress={null}
                  />
                  <MetricCard
                    icon={Trophy}
                    label="胜负命中率"
                    subLabel="WIN / LOSS"
                    value={data.wdwRate != null ? `${Math.round(data.wdwRate)}%` : '—'}
                    suffix={data.wdwHit != null && data.wdwTotal != null
                      ? `${data.wdwHit}/${data.wdwTotal}`
                      : '暂无'}
                    color={CRIMSON_SEQ[0]}
                    progress={data.wdwRate}
                  />
                  <MetricCard
                    icon={Layers}
                    label="实力命中率"
                    subLabel="STRENGTH"
                    value={data.handicapRate != null ? `${Math.round(data.handicapRate)}%` : '—'}
                    suffix={data.handicapHit != null && data.handicapTotal != null
                      ? `${data.handicapHit}/${data.handicapTotal}`
                      : '暂无'}
                    color={CRIMSON_SEQ[1]}
                    progress={data.handicapRate}
                  />
                  <MetricCard
                    icon={Target}
                    label="大小分命中率"
                    subLabel="OVER / UNDER"
                    value={data.overunderRate != null ? `${Math.round(data.overunderRate)}%` : '—'}
                    suffix={data.overunderHit != null && data.overunderTotal != null
                      ? `${data.overunderHit}/${data.overunderTotal}`
                      : '暂无'}
                    color={CRIMSON_SEQ[2]}
                    progress={data.overunderRate}
                  />
                </div>

                {/* 逐场命中明细 */}
                <MatchListSection matches={data.matches ?? []} />

                {/* 分联赛命中率 */}
                <LeagueTable leagues={sortedByLeague ?? []} />

                {/* 异常场次 */}
                <AnomalySection matches={data.anomalyMatches ?? []} />

                {/* 复盘总结 */}
                {data.summary && <SummaryCard summary={data.summary} />}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

// ─── 指标卡 ────────────────────────────────────────────────
interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  subLabel: string;
  value: number | string;
  suffix: string;
  color: string;
  progress: number | null;
}

const MetricCard = ({
  icon: Icon,
  label,
  subLabel,
  value,
  suffix,
  color,
  progress,
}: MetricCardProps) => {
  const pct = progress !== null ? Math.max(0, Math.min(100, progress)) : 0;
  return (
    <div className="metric-card p-4 md:p-5 rounded-2xl">
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold text-foreground leading-tight truncate">
            {label}
          </span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest leading-tight">
            {subLabel}
          </span>
        </div>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
        <span
          className="text-2xl md:text-3xl font-black tabular-nums leading-none"
          style={{ color }}
        >
          {value}
        </span>
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
      {progress !== null ? (
        <div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full progress-gradient transition-all duration-[1.5s] ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <div className="w-full h-2 bg-muted/20 rounded-full" />
      )}
    </div>
  );
};

// ─── 逐场命中明细 ──────────────────────────────────────────
const MatchListSection = ({ matches }: { matches: DailyReviewMatchItem[] }) => {
  if (matches.length === 0) {
    return (
      <div className="metric-card p-8 rounded-2xl">
        <MiniEmpty text="暂无完赛场次明细" />
      </div>
    );
  }

  return (
    <div className="metric-card p-4 md:p-6 rounded-2xl overflow-x-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-nebula-crimson" />
          <h2 className="text-lg font-black tracking-tight text-foreground">
            逐场命中明细
          </h2>
        </div>
        <Badge variant="outline" className="text-[10px] font-black uppercase tracking-widest">
          {matches.length} MATCHES
        </Badge>
      </div>

      {/* 表头 */}
      <div className="hidden md:grid grid-cols-12 gap-2 text-[10px] uppercase tracking-widest text-muted-foreground font-black pb-2 border-b border-border/50">
        <div className="col-span-4">对阵</div>
        <div className="col-span-2 text-center">胜负</div>
        <div className="col-span-2 text-center">实力</div>
        <div className="col-span-2 text-center">大小分</div>
        <div className="col-span-2 text-right">比分</div>
      </div>

      <div className="space-y-0 min-w-[360px]">
        {matches.map((m) => (
          <MatchRow key={m.id} match={m} />
        ))}
      </div>
    </div>
  );
};

const MatchRow = ({ match }: { match: DailyReviewMatchItem }) => {
  const time = dayjs(match.kickoffTime).format('HH:mm');
  return (
    <div className="py-3 md:py-3.5 border-b border-border/50 last:border-0">
      {/* 移动端：卡片式堆叠 */}
      <div className="md:hidden space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-nebula-crimson/10 text-nebula-crimson font-black">
              {match.matchNo}
            </span>
            <span className="text-xs text-muted-foreground">{match.league}</span>
          </div>
          <span className="text-xs text-muted-foreground font-mono">{time}</span>
        </div>
        <div className="text-sm font-semibold text-foreground truncate">
          {match.homeTeam} <span className="text-muted-foreground/40 mx-1">vs</span> {match.awayTeam}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <HitBadge label="胜负" hit={match.hitWdw} direction={match.predictionDirection} />
          <StrengthBadge
            match={match}
          />
          <HitBadge
            label="大小分"
            hit={match.hitOverunder}
            direction={match.totalDirection}
            line={match.totalLine}
          />
        </div>
        <div className="text-right text-sm font-mono font-bold text-foreground">
          {match.homeScore ?? '-'} : {match.awayScore ?? '-'}
        </div>
      </div>

      {/* 桌面端：一行 */}
      <div className="hidden md:grid grid-cols-12 gap-2 items-center">
        <div className="col-span-4 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-nebula-crimson/10 text-nebula-crimson font-black">
              {match.matchNo}
            </span>
            <span className="text-xs text-muted-foreground">{match.league}</span>
            <span className="text-xs text-muted-foreground/60 font-mono ml-auto">{time}</span>
          </div>
          <div className="text-sm font-semibold text-foreground truncate">
            {match.homeTeam} <span className="text-muted-foreground/40 mx-1">vs</span> {match.awayTeam}
          </div>
        </div>
        <div className="col-span-2 flex justify-center">
          <HitBadge label="胜负" hit={match.hitWdw} direction={match.predictionDirection} inline />
        </div>
        <div className="col-span-2 flex justify-center">
          <StrengthBadge
            match={match}
            inline
          />
        </div>
        <div className="col-span-2 flex justify-center">
          <HitBadge
            label="大小分"
            hit={match.hitOverunder}
            direction={match.totalDirection}
            line={match.totalLine}
            inline
          />
        </div>
        <div className="col-span-2 text-right text-sm font-mono font-bold text-foreground tabular-nums">
          {match.homeScore ?? '-'} : {match.awayScore ?? '-'}
        </div>
      </div>
    </div>
  );
};

const HitBadge = ({
  label,
  hit,
  direction,
  line,
  inline = false,
}: {
  label: string;
  hit: boolean | null;
  direction: string;
  line?: number;
  inline?: boolean;
}) => {
  if (hit === null) {
    return (
      <span
        className={`${inline ? 'inline-flex' : 'flex flex-col'} items-center justify-center text-[10px] text-muted-foreground/60 bg-muted/30 rounded-md px-2 py-1`}
      >
        <span className="uppercase tracking-widest font-black">{label}</span>
        <span className="font-medium">未结算</span>
      </span>
    );
  }

  const lineStr = line !== undefined ? (line > 0 ? `+${line}` : `${line}`) : '';

  if (hit) {
    return (
      <span
        className={`${inline ? 'inline-flex' : 'flex flex-col'} items-center justify-center text-[10px] bg-success/10 text-success rounded-md px-2 py-1`}
      >
        <span className="uppercase tracking-widest font-black">{label}</span>
        <span className="font-semibold">
          {direction} {lineStr}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`${inline ? 'inline-flex' : 'flex flex-col'} items-center justify-center text-[10px] bg-miss-text/10 text-miss-text rounded-md px-2 py-1 line-through decoration-[1.5px]`}
    >
      <span className="uppercase tracking-widest font-black">{label}</span>
      <span className="font-semibold">
        {direction} {lineStr}
      </span>
    </span>
  );
};

const StrengthBadge = ({ match, inline = false }: { match: DailyReviewMatchItem; inline?: boolean }) => {
  const hit = match.hitHandicap;
  const isHomeStronger = match.handicapRecommendation.includes('主');
  const strongerTeam = isHomeStronger ? match.homeTeam : match.awayTeam;
  const expectedSpread = Math.abs(match.handicapLine);

  if (hit === null) {
    return (
      <span
        className={`${inline ? 'inline-flex' : 'flex flex-col'} items-center justify-center text-[10px] text-muted-foreground/60 bg-muted/30 rounded-md px-2 py-1`}
      >
        <span className="uppercase tracking-widest font-black">实力</span>
        <span className="font-medium">未结算</span>
      </span>
    );
  }

  const directionText = `${strongerTeam}更强`;
  const spreadText = `净胜${expectedSpread.toFixed(1)}分`;

  if (hit) {
    return (
      <span
        className={`${inline ? 'inline-flex' : 'flex flex-col'} items-center justify-center text-[10px] bg-success/10 text-success rounded-md px-2 py-1`}
      >
        <span className="uppercase tracking-widest font-black">实力</span>
        <span className="font-semibold">{directionText}</span>
        <span className="text-[9px] opacity-70">{spreadText}</span>
      </span>
    );
  }

  return (
    <span
      className={`${inline ? 'inline-flex' : 'flex flex-col'} items-center justify-center text-[10px] bg-miss-text/10 text-miss-text rounded-md px-2 py-1 line-through decoration-[1.5px]`}
    >
      <span className="uppercase tracking-widest font-black">实力</span>
      <span className="font-semibold">{directionText}</span>
      <span className="text-[9px] opacity-70">{spreadText}</span>
    </span>
  );
};

// ─── 分联赛表格 ────────────────────────────────────────────
const LeagueTable = ({ leagues }: { leagues: DailyReviewByLeagueItem[] }) => {
  if (leagues.length === 0) {
    return (
      <div className="metric-card p-8 rounded-2xl">
        <MiniEmpty text="暂无联赛数据" />
      </div>
    );
  }

  return (
    <div className="metric-card p-4 md:p-6 rounded-2xl overflow-x-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-nebula-crimson" />
          <h2 className="text-lg font-black tracking-tight text-foreground">
            分联赛命中率
          </h2>
        </div>
        <Badge variant="outline" className="text-[10px] font-black uppercase tracking-widest">
          {leagues.length} LEAGUES
        </Badge>
      </div>

      {/* 表头 */}
      <div className="hidden md:grid grid-cols-12 gap-2 text-[10px] uppercase tracking-widest text-muted-foreground font-black pb-2 border-b border-border/50">
        <div className="col-span-4">联赛</div>
        <div className="col-span-1 text-right">场次</div>
        <div className="col-span-3 text-right">实力命中</div>
        <div className="col-span-4 text-right">大小分命中</div>
      </div>

      <div className="space-y-0 min-w-[320px]">
        {leagues.map((item, idx) => (
          <div
            key={item.league}
            className="py-3 md:py-4 border-b border-border/50 last:border-0 emphasis-bar pl-3 md:pl-4"
          >
            {/* 移动端：上下堆叠 */}
            <div className="md:hidden space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 flex-shrink-0 rounded-full bg-nebula-crimson/10 flex items-center justify-center text-xs font-black text-nebula-crimson">
                    {idx + 1}
                  </div>
                  <span className="text-sm font-semibold text-foreground truncate">
                    {item.league}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground font-medium">
                  {item.total} 场
                </span>
              </div>
              <LeagueBarRow
                label="实力"
                hit={item.hdcHit}
                total={item.total}
                rate={item.hdcRate}
                color={CRIMSON_SEQ[1]}
              />
              <LeagueBarRow
                label="大小分"
                hit={item.ouHit}
                total={item.total}
                rate={item.ouRate}
                color={CRIMSON_SEQ[2]}
              />
            </div>

            {/* 桌面端：一行 */}
            <div className="hidden md:grid grid-cols-12 gap-2 items-center">
              <div className="col-span-4 flex items-center gap-3 min-w-0">
                <div className="w-7 h-7 flex-shrink-0 rounded-full bg-nebula-crimson/10 flex items-center justify-center text-xs font-black text-nebula-crimson">
                  {idx + 1}
                </div>
                <span className="text-sm font-semibold text-foreground truncate">
                  {item.league}
                </span>
              </div>
              <div className="col-span-1 text-right text-sm font-medium tabular-nums">
                {item.total}
              </div>
              <div className="col-span-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-[1.5s] ease-out"
                      style={{
                        width: `${Math.max(0, Math.min(100, item.hdcRate))}%`,
                        backgroundColor: CRIMSON_SEQ[1],
                      }}
                    />
                  </div>
                  <span
                    className="text-xs font-black font-mono w-14 text-right"
                    style={{ color: CRIMSON_SEQ[1] }}
                  >
                    {Math.round(item.hdcRate)}%
                    <span className="text-[10px] font-normal text-muted-foreground ml-0.5">
                      · {item.hdcHit}
                    </span>
                  </span>
                </div>
              </div>
              <div className="col-span-4">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-[1.5s] ease-out"
                      style={{
                        width: `${Math.max(0, Math.min(100, item.ouRate))}%`,
                        backgroundColor: CRIMSON_SEQ[2],
                      }}
                    />
                  </div>
                  <span
                    className="text-xs font-black font-mono w-14 text-right"
                    style={{ color: CRIMSON_SEQ[2] }}
                  >
                    {Math.round(item.ouRate)}%
                    <span className="text-[10px] font-normal text-muted-foreground ml-0.5">
                      · {item.ouHit}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const LeagueBarRow = ({
  label,
  hit,
  total,
  rate,
  color,
}: {
  label: string;
  hit: number;
  total: number;
  rate: number;
  color: string;
}) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-muted-foreground w-12 font-medium">{label}</span>
    <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-[1.5s] ease-out"
        style={{ width: `${Math.max(0, Math.min(100, rate))}%`, backgroundColor: color }}
      />
    </div>
    <span className="text-xs font-black font-mono w-16 text-right" style={{ color }}>
      {Math.round(rate)}%
      <span className="text-[10px] font-normal text-muted-foreground ml-0.5">
        · {hit}/{total}
      </span>
    </span>
  </div>
);

// ─── 异常场次 ──────────────────────────────────────────────
const AnomalySection = ({ matches }: { matches: DailyReviewAnomalyMatch[] }) => {
  if (matches.length === 0) {
    return (
      <div className="metric-card p-8 rounded-2xl">
        <div className="text-center">
          <CheckCircle2 className="w-10 h-10 text-success/60 mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground mb-1">今日无异常场次</p>
          <p className="text-xs text-muted-foreground">
            所有比赛预测方向与实际结果偏差均在正常范围内
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="metric-card p-4 md:p-6 rounded-2xl">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-nebula-crimson" />
          <h2 className="text-lg font-black tracking-tight text-foreground">
            异常场次（预测反向 / 大偏差）
          </h2>
        </div>
        <Badge variant="destructive" className="text-[10px] font-black uppercase tracking-widest">
          {matches.length} ANOMALIES
        </Badge>
      </div>

      <div className="space-y-3">
        {matches.map((m) => (
          <AnomalyCard key={m.matchNo} match={m} />
        ))}
      </div>
    </div>
  );
};

const AnomalyCard = ({ match }: { match: DailyReviewAnomalyMatch }) => {
  const tags = parseDeviationTags(match.deviationNote);

  return (
    <div className="rounded-xl border border-border/60 bg-white p-4 transition-all hover:border-nebula-crimson/30 hover:shadow-md">
      {/* 顶部：联赛 + 对阵 + 比分 */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] px-2 py-0.5 rounded bg-nebula-crimson/10 text-nebula-crimson font-black">
              {match.matchNo}
            </span>
            <span className="text-xs text-muted-foreground">{match.league}</span>
          </div>
          <div className="text-sm md:text-base font-semibold text-foreground truncate">
            {match.homeTeam} <span className="text-muted-foreground/40 mx-1">vs</span> {match.awayTeam}
          </div>
        </div>
        <div className="flex flex-wrap gap-1 justify-end flex-shrink-0">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="destructive"
              className="text-[10px] font-bold"
            >
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      {/* 实力 + 大小分 两栏对比 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-black mb-0.5">
              实力
            </span>
            <span className="text-sm font-medium text-foreground">
              {match.handicapDir}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground">实际净胜</div>
              <div className="text-sm font-mono font-semibold">
                {match.actualSpread > 0 ? '+' : ''}{match.actualSpread}
              </div>
            </div>
            {match.hit ? (
              <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-miss-text flex-shrink-0" />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-black mb-0.5">
              大小分
            </span>
            <span className="text-sm font-medium text-foreground">
              {match.totalDir} {match.totalLine}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground">实际总分</div>
              <div className="text-sm font-mono font-semibold">
                {match.actualTotal}
              </div>
            </div>
            {match.totalHit ? (
              <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-miss-text flex-shrink-0" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const parseDeviationTags = (note: string): string[] => {
  if (!note) return [];
  // 用逗号、顿号、分号分割
  return note
    .split(/[，,；;、]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3);
};

// ─── 复盘总结 ──────────────────────────────────────────────
const SummaryCard = ({ summary }: { summary: string }) => (
  <div className="metric-card p-5 md:p-6 rounded-2xl">
    <div className="flex items-center gap-2 mb-3">
      <FileText className="w-5 h-5 text-nebula-crimson" />
      <h2 className="text-lg font-black tracking-tight text-foreground">复盘总结</h2>
      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-auto">
        SUMMARY
      </span>
    </div>
    <div className="rounded-xl bg-nebula-crimson/[0.03] border border-nebula-crimson/10 p-4">
      <p className="text-sm md:text-base leading-relaxed text-foreground whitespace-pre-wrap">
        {summary}
      </p>
    </div>
  </div>
);

// ─── 空状态 ────────────────────────────────────────────────
const EmptyState = ({ dateStr }: { dateStr: string }) => (
  <div className="metric-card p-10 md:p-16 rounded-2xl">
    <div className="text-center max-w-sm mx-auto">
      <div className="w-16 h-16 rounded-full bg-nebula-crimson/10 flex items-center justify-center mx-auto mb-4">
        <Clock className="w-8 h-8 text-nebula-crimson" />
      </div>
      <h3 className="text-lg font-black tracking-tight text-foreground mb-2">
        等待 22:00 复盘生成
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-1">
        {dateStr} 的比赛数据正在收集中
      </p>
      <p className="text-sm text-muted-foreground leading-relaxed">
        每日 22:00 自动生成当日完整复盘，包含命中率统计、异常场次拆解与模型表现总结。
      </p>
    </div>
  </div>
);

const MiniEmpty = ({ text }: { text: string }) => (
  <div className="text-center py-4">
    <Target className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
    <p className="text-sm text-muted-foreground">{text}</p>
  </div>
);

// ─── 错误状态 ──────────────────────────────────────────────
const ErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <div className="metric-card p-8 flex flex-col items-center gap-3 rounded-2xl">
    <AlertTriangle className="w-10 h-10 text-miss-text/60" />
    <p className="text-sm text-muted-foreground">加载失败</p>
    <Button variant="outline" size="sm" onClick={onRetry}>
      点击重试
    </Button>
  </div>
);

// ─── Skeleton ─────────────────────────────────────────────
const ReviewSkeleton = () => (
  <div className="space-y-6">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-28 rounded-2xl" />
      ))}
    </div>
    <Skeleton className="h-64 rounded-2xl" />
    <Skeleton className="h-80 rounded-2xl" />
    <Skeleton className="h-32 rounded-2xl" />
  </div>
);

export default BasketballReviewPage;
