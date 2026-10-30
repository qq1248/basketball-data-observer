import { useState, useEffect, useMemo } from 'react';
import { Trophy, Target, RefreshCw, ChevronDown, ChevronUp, AlertTriangle, TrendingUp, Layers, Zap, Info, Gauge, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Skeleton } from '@client/src/components/ui/skeleton';
import { Button } from '@client/src/components/ui/button';
import { COMBO_DISPLAY_NAMES } from '@client/src/utils/combo-calculator';
import { parlaysApi, matchesApi } from '@client/src/api';
import type { ParlayItem, ParlayMatchItem, DateStatsItem } from '@shared/api.interface';

function getBeijingToday(): string {
  const now = new Date();
  const beijingMs = now.getTime() + 8 * 60 * 60 * 1000;
  return new Date(beijingMs).toISOString().slice(0, 10);
}

const WEEKDAY_MAP = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const getDateList = () => {
  const today = dayjs(getBeijingToday());
  const dates: { date: string; day: number; weekday: string; isToday: boolean }[] = [];
  for (let i = -7; i <= 3; i += 1) {
    const d = today.add(i, 'day');
    dates.push({
      date: d.format('YYYY-MM-DD'),
      day: d.date(),
      weekday: WEEKDAY_MAP[d.day()],
      isToday: i === 0,
    });
  }
  return dates;
};

const RISK_LABEL: Record<string, string> = {
  steady: '稳健',
  balanced: '均衡',
  aggressive: '激进',
  longshot: '高指数',
};

const RISK_COLOR: Record<string, string> = {
  steady: 'bg-nebula-crimson/10 text-nebula-crimson',
  balanced: 'bg-amber-50 text-amber-700',
  aggressive: 'bg-orange-50 text-orange-700',
  longshot: 'bg-purple-50 text-purple-600',
};

const getProbColor = (prob: number): string => {
  if (prob >= 50) return 'text-nebula-crimson';
  if (prob >= 30) return 'text-amber-600';
  return 'text-gray-500';
};

const getSourceLabel = (matchNo: string): string => {
  if (!matchNo) return '';
  const upper = matchNo.toUpperCase();
  if (upper.startsWith('QMB')) return '球美宝';
  if (upper.startsWith('SPORTTERY') || upper.startsWith('JC') || /^\d+$/.test(matchNo)) return '竞彩官方';
  if (upper.startsWith('BEIDAN') || upper.startsWith('BD')) return '北单';
  return '';
};

const clampProb = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

const calcHitRate = (matches: ParlayMatchItem[]): number => {
  if (matches.length === 0) return 0;
  const product = matches.reduce((acc: number, m: ParlayMatchItem) => {
    const rawProb = m.probability > 1 ? m.probability : m.probability * 100;
    const prob = Math.max(0, Math.min(100, rawProb)) / 100;
    return acc * prob;
  }, 1);
  return Math.round(product * 100);
};


const ParlayCard = ({
  parlay,
  sport,
  isRecommended,
  onNavigateMatch,
}: {
  parlay: ParlayItem;
  sport: 'football' | 'basketball';
  isRecommended: boolean;
  onNavigateMatch: (id: string) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const riskClass = RISK_COLOR[parlay.riskLevel] || RISK_COLOR.balanced;
  const riskLabel = RISK_LABEL[parlay.riskLevel] || '均衡';
  const calculatedHitRate = calcHitRate(parlay.matches);
  const rawHitRate = parlay.hitRate > 0 ? parlay.hitRate : calculatedHitRate;
  const displayHitRate = rawHitRate <= 1 ? Math.round(rawHitRate * 100) : Math.round(rawHitRate);
  const clampedHitRate = Math.max(0, Math.min(100, displayHitRate));
  const hasEstimatedOdds = parlay.note?.includes('概率估算') ?? false;
  const isInsufficient = parlay.status === 'insufficient';
  const hasTolerance = !!parlay.toleranceInfo;
  const toleranceInfo = parlay.toleranceInfo;
   const defaultTotalLabel = sport === 'football' ? '进球数' : '总分';
   const playLabel = parlay.matches[0]?.playType || (parlay.playCategory === '大小分' ? defaultTotalLabel : (parlay.playCategory === '胜平负' ? '赛果方向' : parlay.playCategory || ''));
  const firstMatch = parlay.matches[0];
   const lineDisplay = parlay.playCategory === '大小分'
    ? (firstMatch?.totalLineNum != null && Number.isFinite(firstMatch.totalLineNum) && firstMatch.totalLineNum > 0
        ? `总分${firstMatch.totalLineNum}分`
        : firstMatch?.handicapLine || '')
    : (firstMatch?.handicapLineNum != null && Number.isFinite(firstMatch.handicapLineNum)
        ? `让${firstMatch.handicapLineNum}分`
        : firstMatch?.handicapLine || '');
   const playColor = parlay.playCategory === '大小分'
    ? 'bg-purple-50 text-purple-600 border-purple-200'
     : parlay.playCategory === '胜平负'
      ? 'bg-blue-50 text-blue-600 border-blue-200'
      : 'bg-nebula-crimson/10 text-nebula-crimson border border-nebula-crimson/20';

  const confidenceBreakdown = parlay.confidenceBreakdown;
  const similarRate = parlay.similarHistoricalHitRate;
  const riskNote = parlay.riskNote;
  const isLowConfidenceRisk = riskNote?.includes('低信心') ?? false;

  if (isInsufficient) {
    return (
      <div className="metric-card p-4 opacity-80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${playColor} flex-shrink-0`}>
              {parlay.comboType}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${riskClass} flex-shrink-0 opacity-60`}>
              {riskLabel}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground text-[10px] flex-shrink-0">
              {playLabel}
            </span>
          </div>
        </div>
        <div className="mt-2 text-sm font-black tracking-tight text-foreground mb-2">
          {parlay.name}
        </div>
        <div className="flex items-center gap-2 py-2 px-3 rounded-xl bg-muted/30">
          <AlertTriangle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <p className="text-xs text-muted-foreground">{parlay.note || '当日合格场次不足'}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`metric-card overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-500 ${
        isRecommended ? 'ring-2 ring-nebula-crimson/30' : ''
      }`}
      data-ai-section-type="card-list"
    >
      {isRecommended && (
        <div className="px-4 pt-3">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-nebula-crimson text-white text-[10px] font-black uppercase tracking-widest">
            <Trophy className="w-3 h-3" />
                   核心精选
          </span>
        </div>
      )}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full text-left flex flex-col gap-2 ${isRecommended ? 'p-4 pt-2' : 'p-4'}`}
      >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${playColor} flex-shrink-0`}>
                {COMBO_DISPLAY_NAMES[parlay.comboType as keyof typeof COMBO_DISPLAY_NAMES] ?? parlay.comboType}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${riskClass} flex-shrink-0`}>
                {riskLabel}
              </span>
               <span className="px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground text-[10px] flex-shrink-0">
                 {playLabel}
                 {lineDisplay && <span className="ml-1 opacity-70">{lineDisplay}</span>}
               </span>
              {hasEstimatedOdds && (
                <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] flex-shrink-0 border border-amber-200">
                  概率估
                </span>
              )}
            </div>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
        </div>

        <div className="space-y-1">
          {parlay.matches.slice(0, 2).map((m: ParlayMatchItem) => (
            <div key={m.matchId} className="flex items-center justify-between gap-2">
              <span className="text-xs text-foreground truncate flex-1 min-w-0">
                {m.homeTeam} vs {m.awayTeam}
              </span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px] text-muted-foreground">
                       {m.betOption}
                       {(() => {
                         if (parlay.playCategory === '大小分' && m.totalLineNum != null && Number.isFinite(m.totalLineNum) && m.totalLineNum > 0) {
                           return <span className="ml-0.5">({m.totalLineNum})</span>;
                         }
                         if (parlay.playCategory === '让分' && m.handicapLineNum != null && Number.isFinite(m.handicapLineNum)) {
                           return <span className="ml-0.5">({m.handicapLineNum})</span>;
                         }
                         if (m.handicapLine !== undefined && m.handicapLine !== null && m.handicapLine !== '') {
                           return <span className="ml-0.5">({m.handicapLine})</span>;
                         }
                         return null;
                       })()}
                     </span>
                 <span className={`text-[11px] font-mono font-black tabular-nums ${getProbColor(clampProb(m.probability))}`}>
                   {clampProb(m.probability)}%
                 </span>
               </div>
            </div>
          ))}
          {parlay.matches.length > 2 && (
            <p className="text-[11px] text-muted-foreground">
              等共 {parlay.matches.length} 场比赛
            </p>
          )}
        </div>

         {/* 信心分布 */}
         {confidenceBreakdown && (confidenceBreakdown.high > 0 || confidenceBreakdown.mid > 0 || confidenceBreakdown.low > 0) && (
           <div className="flex items-center gap-3 pt-1 pb-1">
             <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
               <Gauge className="w-3 h-3" />
               信心分布
             </div>
             <div className="flex items-center gap-2 flex-wrap">
               {confidenceBreakdown.high > 0 && (
                 <span className="inline-flex items-center gap-1 text-[10px] font-medium">
                   <span className="w-3 h-3 rounded-full bg-amber-400 flex items-center justify-center" />
                   <span className="text-amber-700">高信心 {confidenceBreakdown.high} 场</span>
                 </span>
               )}
               {confidenceBreakdown.mid > 0 && (
                 <span className="inline-flex items-center gap-1 text-[10px] font-medium">
                   <span className="w-3 h-3 rounded-full bg-nebula-crimson flex items-center justify-center" />
                   <span className="text-nebula-crimson">中信心 {confidenceBreakdown.mid} 场</span>
                 </span>
               )}
               {confidenceBreakdown.low > 0 && (
                 <span className="inline-flex items-center gap-1 text-[10px] font-medium">
                   <span className="w-3 h-3 rounded-full bg-gray-300 flex items-center justify-center" />
                   <span className="text-gray-500">低信心 {confidenceBreakdown.low} 场</span>
                 </span>
               )}
             </div>
           </div>
         )}

         {/* 历史相似组合模型命中率 */}
         <div className="flex items-center gap-1.5 text-[10px]">
           <span className="text-muted-foreground">历史相似组合模型准确率：</span>
           {similarRate != null ? (
             <span className="font-mono font-black text-nebula-crimson tabular-nums">
               {Math.round(similarRate)}%
             </span>
           ) : (
             <span className="text-muted-foreground/60">暂无参考</span>
           )}
         </div>

         <div className="space-y-2 pt-1">
           <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col min-w-0">
              <span className={`text-xs font-mono font-black tabular-nums ${getProbColor(clampedHitRate)}`}>
                 组合模型准确率 {clampedHitRate}%
              </span>
              {parlay.probabilityNote && (
                <span className="text-[9px] text-muted-foreground mt-0.5">
                  {parlay.probabilityNote}
                </span>
              )}
            </div>
           </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-red-900 to-nebula-crimson transition-all duration-[1.5s] ease-out"
              style={{ width: `${clampedHitRate}%` }}
            />
          </div>
        </div>
      </button>

       {/* 风险提示 */}
       {riskNote && (
         <div className={`mx-4 mb-3 flex items-start gap-2 py-2 px-3 rounded-xl text-xs ${isLowConfidenceRisk ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
           {isLowConfidenceRisk ? (
             <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
           ) : (
             <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
           )}
           <span className="leading-relaxed">{riskNote}</span>
         </div>
       )}

       {expanded && (
         <div className="border-t border-border/60 p-4 space-y-3 bg-muted/20 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="space-y-1.5">
            {parlay.matches.map((m: ParlayMatchItem) => (
              <button
                key={m.matchId}
                onClick={() => onNavigateMatch(m.matchId)}
                className="w-full text-left hover:bg-white -mx-1 px-2 py-2 rounded-xl transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                     <span className="px-1.5 py-0.5 rounded-lg bg-nebula-crimson/10 text-nebula-crimson font-mono text-[10px] font-black flex-shrink-0">
                       {m.matchNo}
                     </span>
                     {(() => {
                       const source = getSourceLabel(m.matchNo);
                       if (!source) return null;
                       return (
                         <span className="px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground text-[10px] flex-shrink-0">
                           {source}
                         </span>
                       );
                     })()}
                     <span className="px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground text-[10px] flex-shrink-0">
                       {m.playType || parlay.playCategory || '指数参考'}
                     </span>
                     <span className="text-xs text-foreground truncate">
                       {m.homeTeam} vs {m.awayTeam}
                     </span>
                   </div>
                   <div className="flex items-center gap-2 flex-shrink-0">
                     <span className="text-[10px] text-muted-foreground">
                       {m.betOption}
                       {m.handicapLine !== undefined && m.handicapLine !== null && m.handicapLine !== '' && (
                         <span className="ml-0.5">({m.handicapLine})</span>
                       )}
                     </span>
                      <span className={`text-[11px] font-mono font-black tabular-nums ${getProbColor(clampProb(m.probability))}`}>
                         {clampProb(m.probability)}%
                       </span>
                    </div>
                </div>
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-4 space-y-2 break-words border border-border/60">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="text-foreground font-black">选择方向：</span>
              <span className="break-all">
                {parlay.matches.map((m: ParlayMatchItem) => m.betOption).join('、')}
              </span>
            </p>
             <p className="text-xs text-muted-foreground leading-relaxed break-all">
               <span className="text-foreground font-black">概率计算：</span>
               {parlay.matches
                  .map((m: ParlayMatchItem) => `${clampProb(m.probability)}%`)
                 .join(' × ')}
               {' ≈ '}
               <span className={`font-mono font-black tabular-nums ${getProbColor(clampedHitRate)}`}>
                 {clampedHitRate}%
               </span>
             </p>
          </div>
          {parlay.note && (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <span className="text-foreground font-medium">备注：</span>
              {parlay.note}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

const ParlayPage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'football' | 'basketball'>('football');
  const [activeDate, setActiveDate] = useState<string>(getBeijingToday());
  const [parlays, setParlays] = useState<ParlayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateStats, setDateStats] = useState<DateStatsItem[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  const dateList = getDateList();

  const fetchParlays = async (date: string, sport: 'football' | 'basketball') => {
    setLoading(true);
    setError(null);
    try {
      const res = await parlaysApi.getParlayList(sport, date);
      setParlays(res.items);
    } catch (err) {
       logger.error(`加载${sport === 'football' ? '足球' : '篮球'}数据组合失败`, err);
      setError('加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const fetchDateStats = async () => {
    setStatsLoading(true);
    try {
      const endDate = dayjs().format('YYYY-MM-DD');
      const startDate = dayjs().subtract(29, 'day').format('YYYY-MM-DD');
      const res = await matchesApi.getDateStats(startDate, endDate);
      setDateStats(res.items || []);
    } catch (err) {
      logger.error('加载日期统计失败', err);
      setDateStats([]);
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    fetchParlays(activeDate, activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDate, activeTab]);

  useEffect(() => {
    if (activeTab === 'football') {
      fetchDateStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleRefresh = () => {
    fetchParlays(activeDate, activeTab);
  };

  const handleNavigateMatch = (matchId: string, sport: 'football' | 'basketball') => {
    if (sport === 'football') {
      navigate(`/match/${matchId}`);
    } else {
      navigate(`/basketball/detail/${matchId}`);
    }
  };

  const trendChartOption = useMemo<EChartsOption | null>(() => {
    if (activeTab !== 'football') return null;
    const validItems = dateStats.filter((d: DateStatsItem) =>
      (d.wdwValidTotal ?? 0) > 0 || (d.handicapValidTotal ?? 0) > 0 || (d.overUnderValidTotal ?? 0) > 0
    );
    if (validItems.length < 7) return null;

    const dates = validItems.map((d: DateStatsItem) =>
      dayjs(d.date).format('MM-DD')
    );
    const wdwData = validItems.map((d: DateStatsItem) =>
      (d.wdwValidTotal ?? 0) > 0 ? Math.round(d.wdwHitRate * 100) / 100 : null
    );
    const handicapData = validItems.map((d: DateStatsItem) =>
      (d.handicapValidTotal ?? 0) > 0 ? Math.round(d.handicapHitRate * 100) / 100 : null
    );
    const overUnderData = validItems.map((d: DateStatsItem) =>
      (d.overUnderValidTotal ?? 0) > 0 ? Math.round(d.overUnderHitRate * 100) / 100 : null
    );

    return {
      tooltip: { trigger: 'axis' },
      legend: {
        type: 'scroll',
        bottom: 0,
        data: ['胜负参考度', '让分参考度', '大小分参考度'],
      },
      grid: { left: '3%', right: '4%', bottom: '20%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { formatter: (value: number) => `${value}%` },
      },
      series: [
        {
          name: '胜负参考度',
          type: 'line',
          data: wdwData,
          smooth: true,
          connectNulls: false,
          lineStyle: { color: '#8B0000', width: 2 },
          itemStyle: { color: '#8B0000' },
          symbol: 'circle',
          symbolSize: 4,
        },
        {
          name: '让分参考度',
          type: 'line',
          data: handicapData,
          smooth: true,
          connectNulls: false,
          lineStyle: { color: '#A52A2A', width: 2 },
          itemStyle: { color: '#A52A2A' },
          symbol: 'circle',
          symbolSize: 4,
        },
        {
          name: '大小分参考度',
          type: 'line',
          data: overUnderData,
          smooth: true,
          connectNulls: false,
          lineStyle: { color: '#CD5C5C', width: 2 },
          itemStyle: { color: '#CD5C5C' },
          symbol: 'circle',
          symbolSize: 4,
        },
      ],
    };
  }, [dateStats, activeTab]);

  const recommendedItems = parlays.filter((p: ParlayItem) => p.status === 'active' && p.name?.includes('推荐'));
   const regularItems = parlays.filter((p: ParlayItem) => p.status === 'active' && !p.name?.includes('推荐') && p.playCategory === '胜平负');
  const asianItems = parlays.filter((p: ParlayItem) => p.status === 'active' && p.playCategory === '让分');
   const totalItems = parlays.filter((p: ParlayItem) => p.status === 'active' && p.playCategory === '大小分');
  const insufficientItems = parlays.filter((p: ParlayItem) => p.status === 'insufficient');

  const ParlaySkeleton = () => (
    <div className="metric-card p-4 space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-4 w-4 rounded-full" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-1.5 w-full rounded-full" />
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Hero 区 */}
       <div className="bg-gradient-to-b from-white to-background px-4 pt-6 pb-4 md:px-6 md:pt-8 md:pb-6">
           <div className="eyebrow eyebrow-line mb-3">DATA COMBINE · 多场参考</div>
           <h1 className="text-4xl font-black tracking-tight text-foreground mb-2">
              足球多场数据参考
           </h1>
          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            多场比赛智能组合，风险分级，数据参考精选
          </p>
       </div>
       {/* 免责声明条 */}
       <div className="px-4 md:px-6 mb-4">
         <div className="flex items-start gap-2 py-2.5 px-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs">
           <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
           <p>
             以上为多场赛事数据统计对照，仅供数据分析与研究参考，不构成任何决策建议。请理性看待体育赛事，理性观赛。
           </p>
         </div>
       </div>

       <div className="px-4 md:px-6 space-y-4">
         {/* 30天模型参考度趋势 */}
         {activeTab === 'football' && (
           <section className="metric-card p-5">
             <div className="eyebrow eyebrow-line mb-2">
               MODEL REFERENCE TREND · 近 30 天模型参考度趋势
             </div>
             {statsLoading ? (
               <div className="h-[300px] flex items-center justify-center">
                 <Skeleton className="h-full w-full rounded-xl" />
               </div>
             ) : trendChartOption ? (
               <ReactECharts
                 option={trendChartOption}
                 theme="ud"
                 className="h-[300px] w-full"
               />
             ) : (
               <div className="h-[300px] flex flex-col items-center justify-center text-center">
                 <AlertCircle className="w-10 h-10 text-muted-foreground/40 mb-3" />
                 <p className="text-sm text-muted-foreground">数据积累中，暂无趋势参考</p>
                 <p className="text-xs text-muted-foreground/60 mt-1">
                   需至少 7 天有效已完赛数据
                 </p>
               </div>
             )}
           </section>
         )}

         {/* 足篮切换 */}
        <div className="inline-flex items-stretch rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
          <button
            onClick={() => setActiveTab('football')}
            className={`px-6 h-11 text-sm font-medium transition-all duration-300 ${
              activeTab === 'football'
                ? 'bg-nebula-crimson text-white'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4" />
               足球精选
            </div>
          </button>
          <button
            onClick={() => setActiveTab('basketball')}
            className={`px-6 h-11 text-sm font-medium transition-all duration-300 ${
              activeTab === 'basketball'
                ? 'bg-nebula-crimson text-white'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4" />
               篮球精选
            </div>
          </button>
        </div>

        {/* 日期选择器 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {dateList.map((d) => (
            <button
              key={d.date}
              onClick={() => setActiveDate(d.date)}
              className={`flex flex-col items-center justify-center px-3 py-2 rounded-2xl flex-shrink-0 min-w-[3.5rem] transition-all duration-300 ${
                activeDate === d.date
                  ? 'bg-nebula-crimson text-white shadow-lg shadow-nebula-crimson/30'
                  : 'bg-card border border-border text-foreground hover:border-nebula-crimson/30'
              }`}
            >
              <span className="text-[10px] font-medium opacity-80">{d.weekday}</span>
              <span className="text-sm font-black tabular-nums">{d.day}</span>
              {d.isToday && (
                <span className="text-[9px] uppercase tracking-wider opacity-70">今日</span>
              )}
            </button>
          ))}
        </div>

        {/* 刷新按钮 */}
         <div className="flex items-center justify-between">
           <span className="text-xs text-muted-foreground">
               共 {parlays.length} 组数据组合
           </span>
           <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={loading}>
             <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
             刷新
           </Button>
         </div>

         {!loading && !error && parlays.length < 10 && (
           <div className="bg-gray-50 text-gray-500 text-sm px-4 py-2 rounded-lg flex items-center gap-2">
             <Info className="w-4 h-4 flex-shrink-0" />
              <span>多场数据参考积累中，样本较少仅供参考</span>
           </div>
         )}

        {loading && (
          <div className="space-y-3">
            <ParlaySkeleton />
            <ParlaySkeleton />
            <ParlaySkeleton />
          </div>
        )}

        {error && !loading && (
          <div className="metric-card p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button onClick={handleRefresh}>
              <RefreshCw className="w-4 h-4 mr-1" />
              重新加载
            </Button>
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-6">
            {/* 核心推荐 */}
            {recommendedItems.length > 0 && (
              <section>
                <h2 className="text-sm font-black tracking-tight text-foreground mb-3 flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-nebula-crimson" />
                  核心精选
                </h2>
                <div className="space-y-3" data-ai-section-type="card-list">
                  {recommendedItems.map((p: ParlayItem) => (
                    <ParlayCard
                      key={p.id}
                      parlay={p}
                      sport={activeTab}
                      isRecommended={true}
                      onNavigateMatch={(id) => handleNavigateMatch(id, activeTab)}
                    />
                  ))}
                </div>
              </section>
            )}

              {/* 赛果方向精选 */}
             {regularItems.length > 0 && (
               <section>
                 <h2 className="text-sm font-black tracking-tight text-foreground mb-3 flex items-center gap-1.5">
                   <Target className="w-4 h-4 text-nebula-crimson" />
                    赛果方向精选
                </h2>
                <div className="space-y-3" data-ai-section-type="card-list">
                  {regularItems.map((p: ParlayItem) => (
                    <ParlayCard
                      key={p.id}
                      parlay={p}
                      sport={activeTab}
                      isRecommended={false}
                      onNavigateMatch={(id) => handleNavigateMatch(id, activeTab)}
                    />
                  ))}
                </div>
              </section>
            )}

              {/* 让分精选 */}
            {asianItems.length > 0 && (
              <section>
                <h2 className="text-sm font-black tracking-tight text-foreground mb-3 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-nebula-crimson" />
                   让分
                </h2>
                <div className="space-y-3" data-ai-section-type="card-list">
                  {asianItems.map((p: ParlayItem) => (
                    <ParlayCard
                      key={p.id}
                      parlay={p}
                      sport={activeTab}
                      isRecommended={false}
                      onNavigateMatch={(id) => handleNavigateMatch(id, activeTab)}
                    />
                  ))}
                </div>
              </section>
            )}

             {totalItems.length > 0 && (
               <section>
                 <h2 className="text-sm font-black tracking-tight text-foreground mb-3 flex items-center gap-1.5">
                   <TrendingUp className="w-4 h-4 text-nebula-crimson" />
                     {activeTab === 'football' ? '进球数' : '总分'}
                 </h2>
                 <div className="space-y-3" data-ai-section-type="card-list">
                   {totalItems.filter((p: ParlayItem) => p.status === 'active').map((p: ParlayItem, idx: number) => (
                     <ParlayCard
                       key={p.id}
                       parlay={p}
                       sport={activeTab}
                       isRecommended={false}
                       onNavigateMatch={(id) => handleNavigateMatch(id, activeTab)}
                     />
                   ))}
                 </div>
                 {totalItems.filter((p: ParlayItem) => p.status === 'insufficient').length > 0 && (
                   <div className="mt-3 space-y-2">
                      {totalItems.filter((p: ParlayItem) => p.status === 'insufficient').map((p: ParlayItem) => (
                        <ParlayCard
                         key={p.id}
                        parlay={p}
                        sport={activeTab}
                        isRecommended={false}
                        onNavigateMatch={(id) => handleNavigateMatch(id, activeTab)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* 不足场次提示 */}
            {insufficientItems.length > 0 && totalItems.length === 0 && (
              <div className="mt-4 space-y-2">
                {insufficientItems.map((p: ParlayItem) => (
                  <ParlayCard
                    key={p.id}
                    parlay={p}
                    sport={activeTab}
                    isRecommended={false}
                    onNavigateMatch={() => {}}
                  />
                ))}
              </div>
            )}

            {parlays.length === 0 && (
              <div className="metric-card p-10 text-center">
                <Zap className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                    当日暂无数据组合
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  比赛数据可能正在更新中，请稍后再试
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-4 py-3 bg-white/90 backdrop-blur-md border-t border-border z-10">
        <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
          <AlertTriangle className="w-3 h-3 inline mr-1 text-amber-500 -mt-0.5" />
              数据组合基于让分/进球数指数，组合场次越多模型准确率越低，以上为模型概率数据，不构成任何决策建议。请理性看待体育赛事，理性观赛。
        </p>
      </div>
    </div>
  );
};

export default ParlayPage;
