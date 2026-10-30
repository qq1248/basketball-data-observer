import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Trophy,
  Target,
  Zap,
  TrendingUp,
  Award,
  Layers,
  BarChart3,
  FileText,
  CalendarDays,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { statsApi } from '@client/src/api';
import type { MatchStatsResponse } from '@shared/api.interface';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@client/src/components/ui/tabs';
import { Button } from '@client/src/components/ui/button';
import AccuracyStats from '@client/src/components/AccuracyStats/AccuracyStats';
import { MobileReviewSection } from '@client/src/components/MobileReviewSection/MobileReviewSection';

type TabKey = 'overview' | 'league' | 'trend' | 'review';

const FootballStatsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = (searchParams.get('tab') as TabKey) || 'overview';
  const [activeTab, setActiveTab] = useState<TabKey>(urlTab);

  const [data, setData] = useState<MatchStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = () => {
    setLoading(true);
    setError(false);
    statsApi
      .getFootballStats()
      .then((res) => setData(res))
      .catch((err) => {
        logger.error('加载足球统计数据失败', err);
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

  const sortedLeagues = useMemo(() => {
    const leagues = data?.byLeague;
    const arr = Array.isArray(leagues) ? leagues : [];
    return [...arr].sort((a, b) => (b.hitRate ?? 0) - (a.hitRate ?? 0));
  }, [data]);

  const dailyData = useMemo(() => {
    const byDate = data?.byDate;
    const arr = Array.isArray(byDate) ? byDate : [];
    return [...arr].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  }, [data]);

  const maxHitRate = useMemo(() => {
    const max = Math.max(...dailyData.map((d) => d.hitRate ?? 0), 0);
    return Math.max(max, 50);
  }, [dailyData]);

  return (
    <div className="min-h-full bg-background pb-24">
      {/* Hero 区 */}
      <div className="bg-gradient-to-b from-white to-background px-4 pt-6 pb-8 md:px-6 md:pt-8 md:pb-10">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 -ml-1.5 mb-4 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="返回"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="eyebrow eyebrow-line mb-3">FOOTBALL ANALYTICS</div>
        <h1 className="text-4xl font-black tracking-tight text-foreground mb-2">
          足球数据统计
        </h1>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
           赛果方向、让分、进球数多维度模型准确率分析，按联赛与日期深度洞察模型表现
        </p>
      </div>

      <div className="px-4 md:px-6 space-y-5">
        {/* Tab 切换 */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1">
              <BarChart3 className="w-3.5 h-3.5 mr-1" />
              总览
            </TabsTrigger>
            <TabsTrigger value="league" className="flex-1">
              <Trophy className="w-3.5 h-3.5 mr-1" />
              联赛排行
            </TabsTrigger>
            <TabsTrigger value="trend" className="flex-1">
              <TrendingUp className="w-3.5 h-3.5 mr-1" />
              每日走势
            </TabsTrigger>
            <TabsTrigger value="review" className="flex-1">
              <FileText className="w-3.5 h-3.5 mr-1" />
              复盘
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-5 pt-2">
             {/* 近N天模型命中率统计（独立模块） */}
            <AccuracyStats sport="football" />

            {loading && <OverviewSkeleton />}
            {error && <ErrorState onRetry={fetchData} />}
            {!loading && !error && data && <OverviewSection data={data} />}
          </TabsContent>

          <TabsContent value="league" className="space-y-5 pt-2">
            {loading && <LeagueSkeleton />}
            {error && <ErrorState onRetry={fetchData} />}
            {!loading && !error && (
              <LeagueSection leagues={sortedLeagues} />
            )}
          </TabsContent>

          <TabsContent value="trend" className="space-y-5 pt-2">
            {loading && <TrendSkeleton />}
            {error && <ErrorState onRetry={fetchData} />}
            {!loading && !error && (
              <TrendSection items={dailyData} maxHitRate={maxHitRate} />
            )}
          </TabsContent>

          <TabsContent value="review" className="space-y-5 pt-2">
            <MobileReviewSection sport="football" />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

// ─── 总览 Tab ────────────────────────────────────────────
const OverviewSection = ({ data }: { data: MatchStatsResponse }) => {
  const confidenceItems = Array.isArray(data.byConfidence) ? data.byConfidence : [];
  const handicapItems = Array.isArray(data.byHandicap) ? data.byHandicap : [];
  const total = data.totalMatches ?? 0;

  return (
    <>
       {/* 三大核心模型命中率 */}
       <div className="grid grid-cols-3 gap-3" data-ai-section-type="card-stat">
         <HitCard icon={Trophy} label="赛果方向" hitRate={data.winDrawWinHitRate ?? 0} total={total} />
         <HitCard icon={Target} label="让分" hitRate={data.handicapHitRate ?? 0} total={total} />
         <HitCard icon={Zap} label="进球数" hitRate={data.overUnderHitRate ?? 0} total={total} />
       </div>

       {/* 信心度分布模型命中率 */}
      <div className="metric-card p-5 hover:shadow-lg">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
            <Award className="w-4 h-4 text-nebula-crimson" />
          </div>
          <h2 className="text-base font-black tracking-tight text-foreground">信心度分布</h2>
        </div>
        {confidenceItems.length === 0 ? (
          <EmptyState text="暂无信心度数据" />
        ) : (
          <div className="space-y-3">
             {confidenceItems.map((item, idx) => {
               const level = item.level ?? '';
               const hitRate = item.hitRate ?? 0;
               const count = item.count ?? 0;
               return (
                 <div key={level || idx}>
                   <div className="flex items-center justify-between mb-1.5">
                     <span className="text-sm font-medium text-foreground">
                       {level}
                     </span>
                     <span className="text-xs font-black font-mono text-nebula-crimson tabular-nums">
                       {Math.round(hitRate * 100)}%
                       <span className="text-muted-foreground font-normal ml-1">· {count}场</span>
                     </span>
                   </div>
                   <div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden">
                     <div
                       className="h-full rounded-full transition-all duration-[1.5s] ease-out bg-gradient-to-r from-red-900 to-nebula-crimson"
                       style={{
                         width: `${Math.max(0, Math.min(100, hitRate * 100))}%`,
                       }}
                     />
                   </div>
                 </div>
               );
             })}
          </div>
        )}
      </div>

        {/* 让分深度分档模型命中率 */}
      <div className="metric-card p-5 hover:shadow-lg">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
            <Layers className="w-4 h-4 text-nebula-crimson" />
          </div>
          <h2 className="text-base font-black tracking-tight text-foreground">让分深度分档</h2>
        </div>
        {handicapItems.length === 0 ? (
          <EmptyState text="暂无让分数据" />
        ) : (
          <div className="space-y-3">
             {handicapItems.map((item, idx) => {
               const type = item.type ?? '';
               const hitRate = item.hitRate ?? 0;
               const count = item.count ?? 0;
               return (
                 <div key={type || idx}>
                   <div className="flex items-center justify-between mb-1.5">
                     <span className="text-sm font-medium text-foreground">{type}</span>
                     <span className="text-xs font-black font-mono text-nebula-crimson tabular-nums">
                       {Math.round(hitRate * 100)}%
                       <span className="text-muted-foreground font-normal ml-1">· {count}场</span>
                     </span>
                   </div>
                   <div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden">
                     <div
                       className="h-full rounded-full transition-all duration-[1.5s] ease-out bg-gradient-to-r from-red-900 to-nebula-crimson"
                       style={{
                         width: `${Math.max(0, Math.min(100, hitRate * 100))}%`,
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
const LeagueSection = ({
  leagues,
}: {
  leagues: { league: string; count: number; hitRate: number }[];
}) => {
  if (leagues.length === 0) {
    return (
      <div className="metric-card p-6">
        <EmptyState text="暂无联赛数据" />
      </div>
    );
  }

  return (
    <div className="metric-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-nebula-crimson" />
          </div>
           <h2 className="text-base font-black tracking-tight text-foreground">联赛模型准确率排行</h2>
        </div>
        <span className="text-[11px] text-muted-foreground">
          共 {leagues.length} 个联赛
        </span>
      </div>
       <div className="space-y-0">
         {leagues.map((item, idx) => {
           const league = item.league ?? '';
           const hitRate = item.hitRate ?? 0;
           const count = item.count ?? 0;
           return (
           <div
             key={league || idx}
             className="flex items-center gap-3 py-3 border-b border-border/50 last:border-0 hover:bg-muted/30 -mx-2 px-2 rounded-lg transition-colors"
           >
             <div className={`w-7 h-7 flex-shrink-0 rounded-lg flex items-center justify-center text-[11px] font-black ${idx < 3 ? 'bg-nebula-crimson text-white' : 'bg-muted/50 text-muted-foreground'}`}>
               {idx + 1}
             </div>
             <div className="flex-1 min-w-0">
               <div className="flex items-center justify-between mb-1">
                 <span className="text-sm font-medium text-foreground truncate">
                   {league}
                 </span>
                 <span className="text-xs font-black font-mono text-nebula-crimson flex-shrink-0 ml-2 tabular-nums">
                   {Math.round(hitRate * 100)}%
                 </span>
               </div>
               <div className="flex items-center gap-2">
                 <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                   <div
                     className="h-full rounded-full transition-all duration-[1.5s] ease-out bg-gradient-to-r from-red-900 to-nebula-crimson"
                     style={{
                       width: `${Math.max(0, Math.min(100, hitRate * 100))}%`,
                     }}
                   />
                 </div>
                 <span className="text-[11px] text-muted-foreground flex-shrink-0">
                   {count}场
                 </span>
               </div>
             </div>
           </div>
         );
         })}
       </div>
    </div>
  );
};

// ─── 每日走势 Tab ────────────────────────────────────────
const TrendSection = ({
  items,
  maxHitRate,
}: {
  items: { date: string; count: number; hitRate: number }[];
  maxHitRate: number;
}) => {
  if (items.length === 0) {
    return (
      <div className="metric-card p-6">
        <EmptyState text="暂无每日数据" />
      </div>
    );
  }

  return (
    <div className="metric-card p-5">
      <div className="flex items-center gap-2 mb-5">
        <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
          <CalendarDays className="w-4 h-4 text-nebula-crimson" />
        </div>
         <h2 className="text-base font-black tracking-tight text-foreground">每日模型准确率走势</h2>
      </div>

       {/* 柱状图 */}
       <div className="flex items-end justify-between gap-1 h-48">
         {items.map((item) => {
           const hitRate = item.hitRate ?? 0;
           const heightPct = maxHitRate > 0 ? (hitRate / maxHitRate) * 100 : 0;
           const dateLabel = (item.date ?? '').slice(5);
          return (
            <div key={item.date} className="flex flex-col items-center flex-1">
               <div className="text-[10px] font-mono font-black text-nebula-crimson mb-1 tabular-nums">
                 {Math.round(hitRate * 100)}%
               </div>
              <div className="w-full flex-1 flex items-end">
                <div
                  className="w-full bg-gradient-to-t from-red-900 to-nebula-crimson rounded-t-sm transition-all duration-700 ease-out"
                  style={{ height: `${heightPct}%`, minHeight: '4px' }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground mt-1.5">
                {dateLabel}
              </div>
            </div>
          );
        })}
      </div>

       {/* 数据列表 */}
       <div className="mt-5 pt-4 border-t border-border/50 space-y-2">
         {items.map((item) => (
           <div
             key={item.date ?? ''}
             className="flex items-center justify-between py-1.5"
           >
             <span className="text-sm font-medium text-foreground">{item.date ?? ''}</span>
             <div className="flex items-center gap-3">
               <span className="text-[11px] text-muted-foreground">
                 {item.count ?? 0} 场
               </span>
               <span className="text-xs font-black font-mono text-nebula-crimson w-12 text-right tabular-nums">
                 {Math.round((item.hitRate ?? 0) * 100)}%
               </span>
             </div>
           </div>
         ))}
       </div>
    </div>
  );
};

// ─── 命中卡片 ────────────────────────────────────────────
interface HitCardProps {
  icon: React.ElementType;
  label: string;
  hitRate: number;
  total: number;
}

const HitCard = ({ icon: Icon, label, hitRate, total }: HitCardProps) => {
  const pct = Math.max(0, Math.min(100, hitRate * 100));
  return (
    <div className="metric-card p-4 flex flex-col items-center hover:shadow-lg hover:-translate-y-0.5 duration-500">
      <div className="w-14 h-14 relative mb-2">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-muted/30"
          />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            stroke="#8B0000"
            strokeWidth="3"
            strokeDasharray={`${pct} 100`}
            strokeLinecap="round"
            className="transition-all duration-[1.5s] ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-black font-mono text-nebula-crimson tabular-nums">
            {Math.round(pct)}%
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className="w-3.5 h-3.5 text-nebula-crimson" />
        <span className="text-[11px] font-medium text-foreground">{label}</span>
      </div>
      <span className="text-[10px] text-muted-foreground">共 {total} 场</span>
    </div>
  );
};

// ─── 空状态 ──────────────────────────────────────────────
const EmptyState = ({ text }: { text: string }) => (
  <div className="text-center py-6">
    <BarChart3 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
    <p className="text-sm text-muted-foreground">{text}</p>
  </div>
);

// ─── 错误状态 ────────────────────────────────────────────
const ErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <div className="metric-card p-8 flex flex-col items-center gap-3">
    <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
      <AlertCircle className="w-6 h-6 text-destructive" />
    </div>
    <p className="text-sm text-muted-foreground">加载失败</p>
    <Button variant="outline" size="sm" onClick={onRetry}>
      <RefreshCw className="w-3.5 h-3.5 mr-1" />
      点击重试
    </Button>
  </div>
);

// ─── Skeleton 骨架屏 ─────────────────────────────────────
const OverviewSkeleton = () => (
  <>
    <div className="grid grid-cols-3 gap-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 rounded-3xl" />
      ))}
    </div>
    <div className="grid grid-cols-2 gap-3">
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-28 rounded-3xl" />
      ))}
    </div>
    <Skeleton className="h-44 rounded-3xl" />
    <Skeleton className="h-48 rounded-3xl" />
  </>
);

const LeagueSkeleton = () => (
  <div className="metric-card p-5 space-y-3">
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <Skeleton key={i} className="h-10 w-full rounded-md" />
    ))}
  </div>
);

const TrendSkeleton = () => (
  <div className="metric-card p-5">
    <Skeleton className="h-48 w-full rounded-lg mb-4" />
    <div className="space-y-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-5 w-full rounded-md" />
      ))}
    </div>
  </div>
);

export default FootballStatsPage;
