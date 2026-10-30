import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Trophy,
  Target,
  TrendingUp,
  Award,
  Gauge,
  Layers,
  BarChart3,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { statsApi } from '@client/src/api';
import type {
  BasketballStatsResponse,
  BasketballStatsByLeague,
  BasketballStatsByRange,
  BasketballStatsByConfidence,
  BasketballRecentHitItem,
} from '@shared/api.interface';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { Button } from '@client/src/components/ui/button';
import { MobileReviewSection } from '@client/src/components/MobileReviewSection/MobileReviewSection';


type TabKey = 'overview' | 'league' | 'recent' | 'review';

const GOLD_SEQ = ['#E8B54A', '#F59E0B', '#FBBF24', '#D97706', '#B45309'];

const LEAGUE_FILTERS = ['全部', 'NBA', 'WNBA', '欧篮联'] as const;
type LeagueFilter = (typeof LEAGUE_FILTERS)[number];

function matchLeagueFilter(league: string, filter: LeagueFilter): boolean {
  if (filter === '全部') return true;
  const name = league || '';
  switch (filter) {
    case 'NBA':
      return name.includes('NBA') || name.includes('美职篮');
    case 'WNBA':
      return name.includes('WNBA');
    case '欧篮联':
      return name.includes('欧篮') || name.includes('Euro') || name.includes('欧冠篮') || name.includes('欧洲篮球');
    default:
      return false;
  }
}

const BasketballStatsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = (searchParams.get('tab') as TabKey) || 'overview';
  const [activeTab, setActiveTab] = useState<TabKey>(urlTab);

  const [data, setData] = useState<BasketballStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = () => {
    setLoading(true);
    setError(false);
    statsApi
      .getBasketballStats()
      .then((res) => setData(res))
      .catch((err) => {
        logger.error('加载篮球统计数据失败', err);
        setError(true);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleTabChange = (val: string) => {
    setActiveTab(val as TabKey);
    setSearchParams({ tab: val }, { replace: true });
  };

  const [dateRange, setDateRange] = useState<'7d' | '30d' | 'all'>('30d');
  const [selectedLeague, setSelectedLeague] = useState<LeagueFilter>('全部');

  // 按联赛过滤后的统计数据（前端内存过滤）
  const filteredLeagues = useMemo(() => {
    const leagues = data?.byLeague ?? [];
    if (selectedLeague === '全部') return leagues;
    return leagues.filter((l: BasketballStatsByLeague) => matchLeagueFilter(l.league, selectedLeague));
  }, [data, selectedLeague]);

  const filteredRecent = useMemo(() => {
    const items = data?.recentHits ?? [];
    if (selectedLeague === '全部') return items;
    return items.filter((m: BasketballRecentHitItem) => matchLeagueFilter(m.league, selectedLeague));
  }, [data, selectedLeague]);

  const sortedLeagues = useMemo(() => {
    return [...filteredLeagues].sort((a, b) => b.wdwHitRate - a.wdwHitRate);
  }, [filteredLeagues]);

  // 联赛筛选下，从 byLeague 数据派生出概览命中率（总场次/胜负/让分/大小分）
  const displayOverview = useMemo(() => {
    if (!data) return null;
    if (selectedLeague === '全部') return data.overview;
    const leagueRows = filteredLeagues;
    if (leagueRows.length === 0) {
      return {
        ...data.overview,
        totalMatches: 0,
        finishedMatches: 0,
        wdwHitRate: 0,
        totalWdw: 0,
        handicapHitRate: 0,
        totalHandicap: 0,
        overUnderHitRate: 0,
        totalOverUnder: 0,
      };
    }
    // 用该联赛的总场次和命中率估算各玩法命中数（近似，因为后端未拆分）
    const total = leagueRows.reduce((sum, l) => sum + l.total, 0);
    const avgWdw = leagueRows.length > 0
      ? leagueRows.reduce((s, l) => s + l.wdwHitRate * l.total, 0) / Math.max(1, total)
      : 0;
    const avgHdc = leagueRows.length > 0
      ? leagueRows.reduce((s, l) => s + l.handicapHitRate * l.total, 0) / Math.max(1, total)
      : 0;
    const avgOu = leagueRows.length > 0
      ? leagueRows.reduce((s, l) => s + l.overUnderHitRate * l.total, 0) / Math.max(1, total)
      : 0;
    return {
      totalMatches: total,
      finishedMatches: total,
      wdwHitRate: avgWdw,
      totalWdw: total,
      handicapHitRate: avgHdc,
      totalHandicap: total,
      overUnderHitRate: avgOu,
      totalOverUnder: total,
    };
  }, [data, selectedLeague, filteredLeagues]);

  return (
    <div className="min-h-full bg-[var(--background)] pb-36 md:pb-8">
      {/* Hero Section */}
      <div className="bg-gradient-to-b from-[var(--secondary)] to-[var(--background)]">
        <div className="px-4 pt-6 pb-6">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors mb-4"
          >
            <ChevronLeft className="w-4 h-4" />
            返回
          </button>
           <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--accent-primary)] mb-2">
            ANALYTICS · 数据统计
          </div>
           <h1 className="text-[var(--foreground)] font-black text-2xl mb-4">
            篮球数据统计
          </h1>
           <p className="text-sm text-[var(--muted-foreground)] mb-5">
            多维度模型准确率数据分析 · 模型表现全景透视
          </p>
          {/* 日期切换按钮组 */}
           <div className="inline-flex items-center bg-[var(--card)] rounded-full p-1 border border-[var(--border)]">
            {(['7d', '30d', 'all'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-4 h-7 text-xs font-medium rounded-full transition-all ${
                  dateRange === range
                     ? 'bg-[var(--accent-primary)] text-white shadow-lg shadow-[var(--accent-primary)]/30'
                     : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {range === '7d' ? '近7天' : range === '30d' ? '近30天' : '全部'}
              </button>
            ))}
          </div>
          {/* 联赛筛选 chips */}
          <div className="mt-4 overflow-x-auto scrollbar-hide -mx-4 px-4"
               style={{ WebkitMaskImage: 'linear-gradient(to right, black 92%, transparent 100%)', maskImage: 'linear-gradient(to right, black 92%, transparent 100%)' }}>
            <div className="flex gap-2 min-w-max">
              {LEAGUE_FILTERS.map((tab: LeagueFilter) => {
                const isActive = selectedLeague === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSelectedLeague(tab)}
                    className={`flex-shrink-0 py-1.5 px-3.5 rounded-full text-xs font-medium whitespace-nowrap transition-all active:scale-95 border ${
                      isActive
                         ? 'bg-[var(--accent-primary)] text-white border-[var(--accent-primary)]'
                         : 'bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--accent-primary)]/30'
                    }`}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-2">
         <div className="flex items-center border-b border-[var(--border)]">
          {[
            { key: 'overview', label: '总览', icon: BarChart3 },
            { key: 'league', label: '联赛', icon: Trophy },
            { key: 'recent', label: '近期', icon: Target },
            { key: 'review', label: '复盘', icon: FileText },
          ].map(({ key, label, icon: Icon }) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 relative ${
                   isActive ? 'text-[var(--accent-primary)] font-bold' : 'text-[var(--muted-foreground)] text-sm font-medium'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{label}</span>
                {isActive && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[var(--accent-primary)] rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {activeTab === 'overview' && (
          <>
            {loading && <OverviewSkeleton />}
            {error && <ErrorState onRetry={fetchData} />}
            {!loading && !error && data && displayOverview && (
              <OverviewSection
                overview={displayOverview}
                bySpreadRange={data.bySpreadRange}
                byConfidence={data.byConfidence}
                leagueFilter={selectedLeague}
              />
            )}
          </>
        )}

        {activeTab === 'league' && (
          <>
            {loading && <LeagueSkeleton />}
            {error && <ErrorState onRetry={fetchData} />}
            {!loading && !error && <LeagueSection leagues={sortedLeagues} />}
          </>
        )}

        {activeTab === 'recent' && (
          <>
            {loading && <RecentSkeleton />}
            {error && <ErrorState onRetry={fetchData} />}
             {!loading && !error && <RecentSection items={filteredRecent} />}
          </>
        )}

        {activeTab === 'review' && (
          <MobileReviewSection sport="basketball" />
        )}
      </div>
    </div>
  );
};

// ─── 总览 Tab ────────────────────────────────────────────
interface OverviewSectionProps {
  overview: BasketballStatsResponse['overview'];
  bySpreadRange: BasketballStatsByRange[];
  byConfidence: BasketballStatsByConfidence[];
  leagueFilter?: LeagueFilter;
}

const OverviewSection = ({
  overview,
  bySpreadRange,
  byConfidence,
  leagueFilter = '全部',
}: OverviewSectionProps) => {
  const upcomingMatches = Math.max(0, overview.totalMatches - overview.finishedMatches);
  const overallHitRate = overview.totalWdw > 0
    ? Math.round(((overview.wdwHitRate * overview.totalWdw) +
        (overview.handicapHitRate * overview.totalHandicap) +
        (overview.overUnderHitRate * overview.totalOverUnder)) /
      (overview.totalWdw + overview.totalHandicap + overview.totalOverUnder) * 100)
    : 0;

  return (
    <>
      {/* 命中率大数字模块 */}
      <div className="bg-[var(--card)] rounded-2xl border border-[var(--border)] p-6 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-2">
          综合命中率
        </div>
        <div className="text-6xl font-black tabular-nums bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-primary-light)] bg-clip-text text-transparent leading-none">
          {overallHitRate}%
        </div>
        <div className="text-[var(--muted-foreground)] text-sm font-medium mt-2">
          胜负 · 让分 · 大小分 综合
        </div>
        <div className="h-2 bg-[var(--secondary)] rounded-full overflow-hidden mt-4">
          <div
             className="h-full rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-primary-light)] transition-all duration-[1.5s] ease-out"
            style={{ width: `${overallHitRate}%` }}
          />
        </div>
      </div>

      {/* 三大核心命中率卡 */}
      <div className="flex flex-col gap-3" data-ai-section-type="card-stat">
        <BigHitCard
          icon={Trophy}
          label="胜负命中率"
          subLabel="WIN / LOSS"
          hitRate={overview.wdwHitRate}
          hit={Math.round(overview.wdwHitRate * overview.totalWdw)}
          total={overview.totalWdw}
           color={GOLD_SEQ[0]}
        />
        <BigHitCard
          icon={Layers}
          label="实力命中率"
          subLabel="STRENGTH"
          hitRate={overview.handicapHitRate}
          hit={Math.round(overview.handicapHitRate * overview.totalHandicap)}
          total={overview.totalHandicap}
           color={GOLD_SEQ[1]}
        />
        <BigHitCard
          icon={Gauge}
          label="大小分命中率"
          subLabel="OVER / UNDER"
          hitRate={overview.overUnderHitRate}
          hit={Math.round(overview.overUnderHitRate * overview.totalOverUnder)}
          total={overview.totalOverUnder}
          color={GOLD_SEQ[2]}
        />
      </div>

      {/* 6 项概览迷你卡 */}
      <div className="grid grid-cols-2 gap-2">
        <StatMiniCard
          label="总场次"
          subLabel="TOTAL"
          value={overview.totalMatches}
           accent="text-[var(--foreground)]"
          icon={BarChart3}
        />
        <StatMiniCard
          label="已赛"
          subLabel="FINISHED"
          value={overview.finishedMatches}
            accent="text-[var(--accent-primary)]"
          icon={CheckCircle2}
        />
        <StatMiniCard
          label="待赛"
          subLabel="UPCOMING"
          value={upcomingMatches}
           accent="text-[var(--muted-foreground)]"
          icon={Clock}
        />
        <StatMiniCard
          label="胜率"
          subLabel="WIN RATE"
          value={`${Math.round(overview.wdwHitRate * 100)}%`}
           accent="text-[var(--foreground)]"
          icon={Trophy}
          isPercent
        />
        <StatMiniCard
          label="实力命中率"
          subLabel="STRENGTH RATE"
          value={`${Math.round(overview.handicapHitRate * 100)}%`}
           accent="text-[var(--foreground)]"
          icon={TrendingUp}
          isPercent
        />
        <StatMiniCard
          label="大分率"
          subLabel="OVER RATE"
          value={`${Math.round(overview.overUnderHitRate * 100)}%`}
           accent="text-[var(--foreground)]"
          icon={Target}
          isPercent
        />
      </div>

      {/* 信心度分布 */}
       <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-4">
         <div className="flex items-center gap-2 mb-4">
            <Award className="w-5 h-5 text-[var(--accent-primary)]" />
           <h2 className="text-base font-bold tracking-tight text-[var(--foreground)]">信心度分布</h2>
           <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] ml-auto">CONFIDENCE</span>
        </div>
        {byConfidence.length === 0 ? (
          <EmptyState text="暂无信心度数据" />
        ) : (
          <div className="space-y-3">
            {byConfidence.map((item, idx) => {
               const color = GOLD_SEQ[idx % GOLD_SEQ.length];
              return (
                <div key={item.level} className="last:mb-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-[var(--foreground)]">
                      {item.level}
                    </span>
                    <span
                      className="text-sm font-black tabular-nums"
                      style={{ color }}
                    >
                      {Math.round(item.hitRate * 100)}%
                       <span className="text-xs font-normal text-[var(--muted-foreground)] ml-1">· {item.total}场</span>
                    </span>
                  </div>
                   <div className="w-full h-1.5 bg-[var(--secondary)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-[1.5s] ease-out"
                      style={{
                        width: `${Math.max(0, Math.min(100, item.hitRate * 100))}%`,
                         background: `linear-gradient(to right, ${color}, ${GOLD_SEQ[2]})`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 预期净胜分档 */}
       <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-4">
         <div className="flex items-center gap-2 mb-4">
            <Layers className="w-5 h-5 text-[var(--accent-primary)]" />
           <h2 className="text-base font-bold tracking-tight text-[var(--foreground)]">预期净胜分档</h2>
           <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] ml-auto">SPREAD RANGE</span>
        </div>
        {bySpreadRange.length === 0 ? (
          <EmptyState text="暂无净胜分数据" />
        ) : (
          <div className="space-y-3">
            {bySpreadRange.map((item, idx) => {
               const color = GOLD_SEQ[idx % GOLD_SEQ.length];
              return (
                <div key={item.range} className="last:mb-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-[var(--foreground)]">{item.range}</span>
                    <span
                      className="text-sm font-black tabular-nums"
                      style={{ color }}
                    >
                      {Math.round(item.hitRate * 100)}%
                       <span className="text-xs font-normal text-[var(--muted-foreground)] ml-1">· {item.total}场</span>
                    </span>
                  </div>
                   <div className="w-full h-1.5 bg-[var(--secondary)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-[1.5s] ease-out"
                      style={{
                        width: `${Math.max(0, Math.min(100, item.hitRate * 100))}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
};

// ─── 联赛排行 Tab ────────────────────────────────────────
const LeagueSection = ({ leagues }: { leagues: BasketballStatsByLeague[] }) => {
  if (leagues.length === 0) {
    return (
        <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-8">
         <EmptyState text="暂无联赛数据" />
      </div>
    );
  }

  return (
       <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="overflow-x-auto scrollbar-hide">
        <table className="w-full min-w-[480px]">
          <thead>
              <tr className="bg-[var(--secondary)] text-[var(--muted-foreground)] text-[11px] font-semibold uppercase">
              <th className="text-left py-3 px-3 font-semibold">#</th>
              <th className="text-left py-3 px-3 font-semibold">联赛</th>
              <th className="text-center py-3 px-3 font-semibold">场次</th>
              <th className="text-center py-3 px-3 font-semibold">胜负</th>
              <th className="text-center py-3 px-3 font-semibold">实力</th>
              <th className="text-center py-3 px-3 font-semibold">总分</th>
            </tr>
          </thead>
          <tbody>
            {leagues.map((item, idx) => (
              <tr
                key={item.league}
                  className="border-b border-[var(--border)] text-[var(--foreground)] text-sm last:border-0"
              >
                <td className="py-3 px-3">
                    <div className="w-6 h-6 rounded-full bg-[var(--accent-primary)]/15 flex items-center justify-center text-xs font-black text-[var(--accent-primary)]">
                    {idx + 1}
                  </div>
                </td>
                <td className="py-3 px-3 font-medium truncate max-w-[120px]">{item.league}</td>
                <td className="py-3 px-3 text-center text-[var(--muted-foreground)] tabular-nums">{item.total}</td>
                 <td className="py-3 px-3 text-center font-bold tabular-nums text-[var(--accent-primary)]">
                  {Math.round(item.wdwHitRate * 100)}%
                </td>
                 <td className="py-3 px-3 text-center font-bold tabular-nums text-[var(--total-over)]">
                  {Math.round(item.handicapHitRate * 100)}%
                </td>
                 <td className="py-3 px-3 text-center font-bold tabular-nums text-[var(--total-under)]">
                  {Math.round(item.overUnderHitRate * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── 近期命中 Tab ────────────────────────────────────────
const RecentSection = ({ items }: { items: BasketballRecentHitItem[] }) => {
  if (items.length === 0) {
    return (
        <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-8">
         <EmptyState text="暂无近期比赛数据" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {items.map((m) => (
        <RecentMatchRow key={m.id} item={m} />
      ))}
    </div>
  );
};

const RecentMatchRow = ({ item }: { item: BasketballRecentHitItem }) => {
  const isWdwHit = item.hitWdw;
  const isHandicapHit = item.hitHandicap;
  const isOuHit = item.hitOverunder;
  const totalHits = [isWdwHit, isHandicapHit, isOuHit].filter(Boolean).length;
      const borderColor = totalHits >= 2
    ? 'border-l-[3px] border-[var(--success)]'
    : totalHits === 0
      ? 'border-l-[3px] border-[var(--destructive)]'
      : 'border-l-[3px] border-[var(--warning)]';

  return (
     <div className={`bg-[var(--card)] rounded-xl border border-[var(--border)] p-4 mb-2 ${borderColor}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-primary)]/15 text-[var(--accent-primary)] font-black flex-shrink-0">
            {item.matchNo}
          </span>
           <span className="text-xs text-[var(--muted-foreground)] truncate">{item.league}</span>
        </div>
         <span className="text-lg font-black tabular-nums text-[var(--foreground)] flex-shrink-0">
           {item.homeScore} <span className="text-[var(--muted-foreground)]">-</span> {item.awayScore}
        </span>
      </div>
       <div className="text-sm font-medium text-[var(--foreground)] mb-3 truncate">
        {item.homeTeam} vs {item.awayTeam}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="flex items-center justify-between">
           <span className="text-[var(--muted-foreground)] truncate">
            {item.predictionDirection}
          </span>
          {item.hitWdw ? (
             <CheckCircle2 className="w-4 h-4 text-[var(--success)] flex-shrink-0 ml-1" />
          ) : (
            <XCircle className="w-4 h-4 text-[var(--destructive)] flex-shrink-0 ml-1" />
          )}
        </div>
        <div className="flex items-center justify-between">
           <span className="text-[var(--muted-foreground)] truncate">
            {item.handicapPick.includes('主') ? '主更强' : '客更强'}
          </span>
          {item.hitHandicap ? (
             <CheckCircle2 className="w-4 h-4 text-[var(--success)] flex-shrink-0 ml-1" />
          ) : (
            <XCircle className="w-4 h-4 text-[var(--destructive)] flex-shrink-0 ml-1" />
          )}
        </div>
        <div className="flex items-center justify-between">
           <span className="text-[var(--muted-foreground)] truncate">
            {item.totalPick}
          </span>
          {item.hitOverunder ? (
             <CheckCircle2 className="w-4 h-4 text-[var(--success)] flex-shrink-0 ml-1" />
          ) : (
            <XCircle className="w-4 h-4 text-[var(--destructive)] flex-shrink-0 ml-1" />
          )}
        </div>
      </div>
    </div>
  );
};

// ─── 大数字命中率卡片（移动端堆叠） ──────────────────────────
interface BigHitCardProps {
  icon: React.ElementType;
  label: string;
  subLabel: string;
  hitRate: number;
  hit: number;
  total: number;
  color: string;
}

const BigHitCard = ({
  icon: Icon,
  label,
  subLabel,
  hitRate,
  hit,
  total,
  color,
}: BigHitCardProps) => {
  const pct = Math.max(0, Math.min(100, hitRate * 100));
  return (
       <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <div className="flex flex-col">
           <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] leading-tight">{subLabel}</span>
           <span className="text-xs font-bold text-[var(--foreground)] leading-tight">{label}</span>
        </div>
      </div>
      <div className="flex items-baseline gap-2 mb-2">
         <span className="text-3xl font-black text-[var(--foreground)] tabular-nums leading-none">
          {Math.round(pct)}%
        </span>
         <span className="text-[var(--muted-foreground)] text-xs tabular-nums">
          {hit} / {total}
        </span>
      </div>
        <div className="h-1.5 bg-[var(--secondary)] rounded-full mt-2 overflow-hidden">
        <div
             className="h-full rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-primary-light)] transition-all duration-[1.5s] ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

// ─── 小统计卡 ─────────────────────────────────────────────
interface StatMiniCardProps {
  label: string;
  subLabel: string;
  value: number | string;
  accent: string;
  icon: React.ElementType;
  isPercent?: boolean;
}

const StatMiniCard = ({ label, subLabel, value, accent, icon: Icon, isPercent }: StatMiniCardProps) => (
   <div className="bg-[var(--secondary)] rounded-xl p-3 flex flex-col gap-1">
     <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
      <Icon className="w-3.5 h-3.5" />
      <span className="text-[10px] uppercase tracking-widest font-medium">{subLabel}</span>
    </div>
    <div className={`text-lg font-bold tabular-nums leading-tight ${accent}`}>
      {isPercent ? value : typeof value === 'number' ? value.toLocaleString() : value}
    </div>
     <div className="text-[10px] text-[var(--muted-foreground)]">{label}</div>
  </div>
);

// ─── 空状态 ──────────────────────────────────────────────
const EmptyState = ({ text }: { text: string }) => (
  <div className="text-center py-6">
      <Target className="w-10 h-10 text-[var(--accent-primary)]/30 mx-auto mb-2" />
     <p className="text-sm text-[var(--muted-foreground)]">{text}</p>
  </div>
);

// ─── 错误状态 ────────────────────────────────────────────
const ErrorState = ({ onRetry }: { onRetry: () => void }) => (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 flex flex-col items-center gap-3">
    <AlertCircle className="w-10 h-10 text-[var(--destructive)]/60" />
     <p className="text-sm text-[var(--muted-foreground)]">加载失败</p>
    <Button
      variant="outline"
      size="sm"
      onClick={onRetry}
        className="border-[var(--border)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 hover:text-[var(--accent-primary-light)]"
    >
      <RefreshCw className="w-3.5 h-3.5 mr-1" />
      点击重试
    </Button>
  </div>
);

// ─── Skeleton 骨架屏 ─────────────────────────────────────
const OverviewSkeleton = () => (
  <>
     <Skeleton className="h-36 rounded-2xl bg-[var(--card)]" />
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
         <Skeleton key={i} className="h-28 rounded-xl bg-[var(--card)]" />
      ))}
    </div>
    <div className="grid grid-cols-2 gap-2">
      {[0, 1, 2, 3, 4, 5].map((i) => (
         <Skeleton key={i} className="h-20 rounded-xl bg-[var(--secondary)]" />
      ))}
    </div>
      <Skeleton className="h-36 rounded-xl bg-[var(--card)]" />
      <Skeleton className="h-40 rounded-xl bg-[var(--card)]" />
  </>
);

const LeagueSkeleton = () => (
   <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] p-4 space-y-3">
    {[0, 1, 2, 3, 4, 5].map((i) => (
       <Skeleton key={i} className="h-14 w-full rounded-lg bg-[var(--secondary)]" />
    ))}
  </div>
);

const RecentSkeleton = () => (
  <div className="flex flex-col gap-2">
    {[0, 1, 2, 3, 4, 5].map((i) => (
       <Skeleton key={i} className="h-24 w-full rounded-xl bg-[var(--card)]" />
    ))}
  </div>
);

export default BasketballStatsPage;
