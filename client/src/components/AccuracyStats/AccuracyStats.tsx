import { useEffect, useMemo, useState } from 'react';
import { Trophy, Target, Gauge, AlertCircle, RefreshCw } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { PredictionAccuracyResponse } from '@shared/api.interface';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@client/src/components/ui/tabs';
import * as matchesApi from '@client/src/api/matches';
import * as basketballApi from '@client/src/api/basketball';

interface AccuracyStatsProps {
  sport: 'football' | 'basketball';
}

const CRIMSON_SEQ = ['#8B0000', '#A52A2A', '#CD5C5C', '#E9967A', '#FFA07A'];
const WDW_COLOR = CRIMSON_SEQ[0];
const HANDICAP_COLOR = CRIMSON_SEQ[1];
const OU_COLOR = CRIMSON_SEQ[2];

const DAYS_OPTIONS = [
  { value: '7', label: '7天' },
  { value: '14', label: '14天' },
  { value: '30', label: '30天' },
] as const;

const AccuracyStats = ({ sport }: AccuracyStatsProps) => {
  const [days, setDays] = useState<'7' | '14' | '30'>('30');
  const [data, setData] = useState<PredictionAccuracyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = () => {
    setLoading(true);
    setError(false);
    const daysNum = Number(days);
    const promise = sport === 'football'
      ? matchesApi.getPredictionAccuracy(daysNum)
      : basketballApi.getPredictionAccuracy(daysNum);
    promise
      .then((res) => setData(res))
      .catch((err) => {
        logger.error(`获取${sport === 'football' ? '足球' : '篮球'}准确率统计失败`, err);
        setError(true);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, sport]);

  const wdw = data?.wdw;
  const handicap = data?.handicap;
  const overUnder = data?.overUnder;
  const dailyTrend = data?.dailyTrend ?? [];

  const chartOption = useMemo<EChartsOption>(() => {
    if (dailyTrend.length === 0) {
      return {};
    }
    const dates = dailyTrend.map((d) => (d.date ?? '').slice(5));
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1e293b',
        borderColor: '#334155',
        textStyle: { color: '#e5e7eb', fontSize: 12 },
        axisPointer: { type: 'line', lineStyle: { color: '#8B0000', opacity: 0.3 } },
      },
      legend: {
        data: ['赛果', '让分', '总分'],
        top: 0,
        right: 0,
        textStyle: { color: '#6b7280', fontSize: 11 },
        itemWidth: 12,
        itemHeight: 8,
      },
      grid: {
        left: 8,
        right: 8,
        top: 36,
        bottom: 8,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#f3f4f6' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#9ca3af',
          fontSize: 10,
          interval: Math.floor(dates.length / 6),
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' } },
        axisLabel: {
          color: '#9ca3af',
          fontSize: 10,
          formatter: '{value}%',
        },
      },
       series: [
         {
           name: '胜负',
           type: 'line',
           smooth: true,
           symbol: 'circle',
           symbolSize: 5,
           showSymbol: false,
           lineStyle: { width: 2, color: WDW_COLOR },
           itemStyle: { color: WDW_COLOR },
           data: dailyTrend.map((d) => Math.round((d.wdwRate ?? 0) * 1000) / 10),
         },
         {
           name: '让分',
           type: 'line',
           smooth: true,
           symbol: 'circle',
           symbolSize: 5,
           showSymbol: false,
           lineStyle: { width: 2, color: HANDICAP_COLOR },
           itemStyle: { color: HANDICAP_COLOR },
           data: dailyTrend.map((d) => Math.round((d.handicapRate ?? 0) * 1000) / 10),
         },
         {
           name: '总分',
           type: 'line',
           smooth: true,
           symbol: 'circle',
           symbolSize: 5,
           showSymbol: false,
           lineStyle: { width: 2, color: OU_COLOR },
           itemStyle: { color: OU_COLOR },
           data: dailyTrend.map((d) => Math.round((d.overUnderRate ?? 0) * 1000) / 10),
         },
       ],
     };
   }, [dailyTrend]);

  const lastUpdateTime = useMemo(() => {
    if (!data?.updatedAt) return '';
    const d = new Date(data.updatedAt);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }, [data]);

  const wdwLabel = sport === 'football' ? '赛果方向' : '赛果';
  const handicapLabel = sport === 'football' ? '让分' : '让分';
  const ouLabel = sport === 'football' ? '进球数' : '总分';

  return (
    <div className="space-y-5">
      {/* 顶部：天数切换 + 更新时间 */}
      <div className="flex items-center justify-between">
        <Tabs value={days} onValueChange={(v) => setDays(v as typeof days)}>
          <TabsList className="bg-card border border-border">
            {DAYS_OPTIONS.map((opt) => (
              <TabsTrigger key={opt.value} value={opt.value} className="text-xs px-3 h-8">
                {opt.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {data && !loading && (
            <>
              <span>最后更新：{lastUpdateTime}</span>
              <button
                onClick={fetchData}
                className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="刷新"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Loading 骨架屏 */}
      {loading && <StatsSkeleton />}

      {/* 错误状态 */}
      {error && !loading && (
        <div className="metric-card p-6 flex flex-col items-center justify-center text-center">
          <AlertCircle className="w-10 h-10 text-destructive mb-2" />
          <p className="text-sm text-foreground font-medium">加载失败</p>
          <p className="text-xs text-muted-foreground mt-1 mb-3">请稍后重试</p>
          <button
            onClick={fetchData}
            className="text-xs text-nebula-crimson font-medium hover:underline"
          >
            重新加载
          </button>
        </div>
      )}

      {/* 数据展示 */}
      {!loading && !error && data && (
        <>
          {/* 口径说明 */}
          <div className="space-y-2">
            <div className="text-xs text-gray-500 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
               <span>模型准确率按有明确模型倾向的场次计算，其余场次因数据不足未出方向</span>
            </div>
             <div className="text-xs text-gray-400">
               有方向场次 {data.directionalCount ?? 0} 场 / 总完赛场次 {data.totalFinished ?? 0} 场
               （出方向比例 {Math.round((data.directionRate ?? 0) * 1000) / 10}%）
             </div>
          </div>

          {/* 三大核心模型命中率 */}
           <div className="grid grid-cols-3 gap-3" data-ai-section-type="card-stat">
             <MetricCard
               icon={Trophy}
               label={wdwLabel}
               hitRate={wdw?.hitRate ?? 0}
               total={wdw?.total ?? 0}
               hits={wdw?.hits ?? 0}
               color={WDW_COLOR}
             />
             <MetricCard
               icon={Target}
               label={handicapLabel}
               hitRate={handicap?.hitRate ?? 0}
               total={handicap?.total ?? 0}
               hits={handicap?.hits ?? 0}
               color={HANDICAP_COLOR}
             />
             <MetricCard
               icon={Gauge}
               label={ouLabel}
               hitRate={overUnder?.hitRate ?? 0}
               total={overUnder?.total ?? 0}
               hits={overUnder?.hits ?? 0}
               color={OU_COLOR}
             />
           </div>

          {/* 样本不足提示 */}
           {(wdw?.total ?? 0) < 30 && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>样本不足（有方向场次＜30），数据仅供参考</span>
            </div>
          )}

          {/* 趋势图 */}
          <div className="metric-card p-5 hover:shadow-lg">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-black tracking-tight text-foreground">
                每日走势
              </h2>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                DAILY TREND
              </span>
            </div>
             {dailyTrend.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                暂无走势数据
              </div>
            ) : (
              <ReactECharts
                option={chartOption}
                style={{ height: 240 }}
                opts={{ renderer: 'svg' }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Metric Card ─────────────────────────────────────────
interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  hitRate: number;
  total: number;
  hits: number;
  color: string;
}

const MetricCard = ({ icon: Icon, label, hitRate, total, hits, color }: MetricCardProps) => {
  const percent = Math.round(hitRate * 1000) / 10;
  const lowSample = total < 30;
  return (
    <div className="metric-card p-4 hover:shadow-lg transition-all duration-500">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2.5" style={{ backgroundColor: `${color}15` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {lowSample && (
          <span className="bg-amber-50 text-amber-600 text-[10px] px-1.5 py-0.5 rounded font-medium">
            样本不足
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-black tracking-tight font-mono tabular-nums" style={{ color }}>
          {percent.toFixed(1)}
        </span>
        <span className="text-xs font-medium" style={{ color }}>%</span>
      </div>
      <div className="text-[11px] text-gray-400 mt-1.5 leading-tight">
         样本 {total} 场 · 验证通过 {hits} 场
      </div>
    </div>
  );
};

// ─── Skeleton ────────────────────────────────────────────
const StatsSkeleton = () => (
  <>
    <div className="grid grid-cols-3 gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="metric-card p-4">
          <Skeleton className="w-8 h-8 rounded-lg mb-2.5" />
          <Skeleton className="w-12 h-3 rounded mb-2" />
          <Skeleton className="w-16 h-7 rounded mb-1" />
          <Skeleton className="w-14 h-2.5 rounded" />
        </div>
      ))}
    </div>
    <div className="metric-card p-5">
      <Skeleton className="w-20 h-4 rounded mb-4" />
      <Skeleton className="w-full h-60 rounded-lg" />
    </div>
  </>
);

export default AccuracyStats;
