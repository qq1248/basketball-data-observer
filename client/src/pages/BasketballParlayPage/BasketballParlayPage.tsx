import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  Target,
  TrendingUp,
  Layers,
  Zap,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Info,
  Gauge,
  AlertCircle,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { getBasketballParlay, getBasketballDateStats } from '@client/src/api/basketball';
import type {
  BasketballParlayResponse,
  BasketballParlayCombo,
  BasketballParlayMatch,
  BasketballDateStatsItem,
} from '@shared/api.interface';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { Checkbox } from '@client/src/components/ui/checkbox';
import { Skeleton } from '@client/src/components/ui/skeleton';

interface SelectedPick {
  id: string;
  matchId: string;
  matchNo: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  pickType: 'handicap' | 'total' | 'moneyline';
  pickDirection: string;
  odds: number;
  confidence: number;
}

const WEEKDAY_MAP = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

interface DateItem {
  date: string;
  day: number;
  weekday: string;
  isToday: boolean;
}

function getDateList(): DateItem[] {
  const today = dayjs();
  const list: DateItem[] = [];
  for (let i = -7; i <= 3; i += 1) {
    const d = today.add(i, 'day');
    list.push({
      date: d.format('YYYY-MM-DD'),
      day: d.date(),
      weekday: WEEKDAY_MAP[d.day()],
      isToday: i === 0,
    });
  }
  return list;
}

const COMBO_TYPE_STYLES: Record<string, { border: string; Icon: typeof Layers }> = {
  '双场精选参考': { border: 'border-nebula-crimson/30 bg-nebula-crimson/5', Icon: ShieldCheck },
  '3场组合高概率': { border: 'border-seq-2/30 bg-seq-2/5', Icon: TrendingUp },
  '三场组合参考': { border: 'border-seq-3/30 bg-seq-3/5', Icon: Layers },
  '4场组合高概率': { border: 'border-seq-4/30 bg-seq-4/5', Icon: TrendingUp },
};

function ComboCard({ combo }: { combo: BasketballParlayCombo }) {
  const getSourceLabel = (matchNo: string): string => {
    if (!matchNo) return '';
    const upper = matchNo.toUpperCase();
    if (upper.startsWith('QMB')) return '球美宝';
    if (upper.startsWith('SPORTTERY') || upper.startsWith('JC') || /^\d+$/.test(matchNo)) return '竞彩官方';
    if (upper.startsWith('BEIDAN') || upper.startsWith('BD')) return '北单';
    return '';
  };
  const style = COMBO_TYPE_STYLES[combo.type] ?? { border: 'border-border', Icon: Layers };
  const Icon = style.Icon;
  const hitPct = Math.max(0, Math.min(100, Math.round(combo.hitProbability * 100)));
  const labelMap: Record<string, string> = {
    '2x1': '2场精选',
    '3x1': '3场精选',
    '3x4': '3场组合',
    '4x1': '4场精选',
  };
  const comboLabel = labelMap[combo.type] ?? combo.type;
  const confidenceLevel = hitPct >= 60 ? '中' : '低';
  const confidenceClass =
    confidenceLevel === '中'
      ? 'text-nebula-crimson border-nebula-crimson/30 bg-nebula-crimson/10'
      : 'text-muted-foreground border-border bg-muted/40';
  const confidenceBreakdown = combo.confidenceBreakdown;
  const similarRate = combo.similarHistoricalHitRate;
  const riskNote = combo.riskNote;
  const isLowConfidenceRisk = riskNote?.includes('低信心') ?? false;

  return (
    <div className={`metric-card p-5 ${style.border}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-nebula-crimson/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-nebula-crimson" />
          </div>
          <div>
            <div className="text-base font-black tracking-tight text-foreground">{combo.name}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <span>{combo.salesDay}</span>
              <span>·</span>
              <span className="truncate max-w-[200px]">{combo.league}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-nebula-crimson border-nebula-crimson/30">
            {comboLabel}
          </Badge>
          <Badge variant="outline" className={`text-[10px] font-black uppercase tracking-widest ${confidenceClass}`}>
            信心 {confidenceLevel}
          </Badge>
        </div>
      </div>

       <div className="grid grid-cols-1 gap-2 mb-4 text-center">
         <div className="bg-muted/40 rounded-xl py-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">通过概率</div>
            <div className="text-lg font-black font-mono text-nebula-crimson">
              {hitPct}%
            </div>
         </div>
       </div>

       {/* 信心分布 */}
       {confidenceBreakdown && (confidenceBreakdown.high > 0 || confidenceBreakdown.mid > 0 || confidenceBreakdown.low > 0) && (
         <div className="flex items-center gap-3 mb-3">
           <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
             <Gauge className="w-3 h-3" />
             信心分布
           </div>
           <div className="flex items-center gap-3 flex-wrap">
             {confidenceBreakdown.high > 0 && (
               <span className="inline-flex items-center gap-1 text-[10px] font-medium">
                 <span className="w-3 h-3 rounded-full bg-amber-400" />
                 <span className="text-amber-700">高信心 {confidenceBreakdown.high} 场</span>
               </span>
             )}
             {confidenceBreakdown.mid > 0 && (
               <span className="inline-flex items-center gap-1 text-[10px] font-medium">
                 <span className="w-3 h-3 rounded-full bg-nebula-crimson" />
                 <span className="text-nebula-crimson">中信心 {confidenceBreakdown.mid} 场</span>
               </span>
             )}
             {confidenceBreakdown.low > 0 && (
               <span className="inline-flex items-center gap-1 text-[10px] font-medium">
                 <span className="w-3 h-3 rounded-full bg-gray-300" />
                 <span className="text-gray-500">低信心 {confidenceBreakdown.low} 场</span>
               </span>
             )}
           </div>
         </div>
       )}

        {/* 历史相似组合模型参考度 */}
       <div className="flex items-center gap-1.5 text-[10px] mb-2">
           <span className="text-muted-foreground">历史相似组合模型参考度：</span>
         {similarRate != null ? (
           <span className="font-mono font-black text-nebula-crimson tabular-nums">
             {Math.round(similarRate)}%
           </span>
         ) : (
           <span className="text-muted-foreground/60">暂无参考</span>
         )}
       </div>

       <div className="text-[11px] text-muted-foreground mb-3">
            组合模型准确率随精选场数下降，仅供数据分析参考
        </div>

       <div className="space-y-2.5 mb-4">
         {combo.picks.map((pick, idx) => {
          const singlePct = Math.max(0, Math.min(100, (pick.singleProb ?? 0) * 100));
          return (
            <div
              key={`${pick.matchId}-${idx}`}
              className="py-2.5 border-b border-border/50 last:border-0"
            >
              <div className="flex items-center justify-between mb-1">
               <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                   <span className="text-[10px] px-2 py-0.5 rounded bg-nebula-crimson/10 text-nebula-crimson font-black flex-shrink-0">
                     {pick.matchNo}
                   </span>
                   {(() => {
                     const source = getSourceLabel(pick.matchNo);
                     if (!source) return null;
                     return (
                       <span className="px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground text-[10px] flex-shrink-0">
                         {source}
                       </span>
                     );
                   })()}
                   <span className="px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground text-[10px] flex-shrink-0">
                     {pick.pickType === 'total' ? '总分' : pick.pickType === 'handicap' ? '让分' : pick.pickType === 'wdw' ? '胜负' : '指数参考'}
                   </span>
                   <span className="text-sm truncate font-medium">
                     {pick.homeTeam} vs {pick.awayTeam}
                   </span>
                 </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                 <span className="text-muted-foreground">
                   {pick.pickType === 'total' && pick.totalLineNum != null
                     ? `总分 ${pick.totalLineNum.toFixed(1)}分`
                     : pick.pickType === 'handicap' && pick.handicapLineNum != null
                     ? `让分 ${pick.handicapLineNum > 0 ? '+' : ''}${pick.handicapLineNum.toFixed(1)}`
                     : pick.pickDirection}
                 </span>
                <span className="text-muted-foreground">
                  {dayjs(pick.kickoffTime).format('MM-DD HH:mm')}
                  {' · '}
                  <span className="text-nebula-crimson font-semibold">单场 {singlePct.toFixed(0)}%</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        {combo.description}
      </p>
      {combo.note && (
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          {combo.note}
        </p>
      )}

      {/* 风险提示 */}
      {riskNote && (
        <div className={`mt-3 flex items-start gap-2 py-2 px-3 rounded-xl text-xs ${isLowConfidenceRisk ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
          {isLowConfidenceRisk ? (
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          ) : (
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          )}
          <span className="leading-relaxed">{riskNote}</span>
        </div>
      )}
    </div>
  );
}

function MatchSelectCard({
  match,
  selected,
  onToggle,
}: {
  match: BasketballParlayMatch;
  selected: SelectedPick | null;
  onToggle: (pick: SelectedPick | null) => void;
}) {
  const hcHomeOdds = match.handicapOddsHome ?? 1.9;
  const hcAwayOdds = match.handicapOddsAway ?? 1.9;
  const totalOverOdds = match.totalOddsOver ?? 1.9;
  const totalUnderOdds = match.totalOddsUnder ?? 1.9;
  const mlHomeOdds = match.homeWinOdds ?? 1.9;
  const mlAwayOdds = match.awayWinOdds ?? 1.9;
  const awayHandicap = match.handicap?.startsWith('-')
    ? match.handicap.replace('-', '+')
    : '-' + (match.handicap || '0');
  const handicapLineText = match.handicapLineNum != null
    ? `${match.handicapLineNum > 0 ? '+' : ''}${match.handicapLineNum.toFixed(1)}`
    : match.handicap;
  const totalLineText = (match.totalLineNum ?? 0).toFixed(1);

  const handlePick = (pickType: 'handicap' | 'total' | 'moneyline', side: string) => {
    const id = `${match.id}-${pickType}-${side}`;
    if (selected?.id === id) {
      onToggle(null);
      return;
    }
    let odds = 1.9;
    let direction = '';
    if (pickType === 'moneyline') {
      if (side === 'home') {
        odds = mlHomeOdds;
        direction = `${match.homeTeam} 胜`;
      } else {
        odds = mlAwayOdds;
        direction = `${match.awayTeam} 胜`;
      }
    } else if (pickType === 'total') {
      if (side === 'over') {
        odds = totalOverOdds;
        direction = `大分 ${totalLineText}`;
      } else {
        odds = totalUnderOdds;
        direction = `小分 ${totalLineText}`;
      }
    }
    onToggle({
      id,
      matchId: match.id,
      matchNo: match.matchNo,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      pickType,
      pickDirection: direction,
      odds,
      confidence: match.confidence,
    });
  };

  const isSelected = selected !== null;

  return (
    <div
      className={`metric-card p-4 transition-all duration-500 ${
        isSelected ? 'border-nebula-crimson/60 bg-nebula-crimson/5' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-2 py-0.5 rounded bg-nebula-crimson/10 text-nebula-crimson font-black">
            {match.matchNo}
          </span>
          <span className="text-xs text-muted-foreground">{match.league}</span>
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          信心 <span className="text-nebula-crimson font-black">{match.confidence}%</span>
        </span>
      </div>
      <div className="text-base font-semibold mb-4">
        {match.homeTeam} vs {match.awayTeam}
      </div>

       <div className="space-y-3">
         {/* 实力方向 */}
         <div>
           <div className="flex items-center justify-between mb-1.5">
             <span className="text-xs text-muted-foreground uppercase tracking-widest">实力方向</span>
             <span className="text-xs font-black text-nebula-crimson font-mono">
               {handicapLineText}
             </span>
           </div>
           <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handlePick('moneyline', 'home')}
                className={`p-3 rounded-lg text-xs border transition-all duration-300 ${
                  selected?.id === `${match.id}-moneyline-home`
                    ? 'border-nebula-crimson bg-nebula-crimson/10 text-nebula-crimson'
                    : 'border-border bg-muted/20 text-foreground hover:border-nebula-crimson/40 hover:bg-nebula-crimson/5'
                }`}
              >
                <div className="font-semibold">主胜</div>
              </button>
              <button
                onClick={() => handlePick('moneyline', 'away')}
                className={`p-3 rounded-lg text-xs border transition-all duration-300 ${
                  selected?.id === `${match.id}-moneyline-away`
                    ? 'border-nebula-crimson bg-nebula-crimson/10 text-nebula-crimson'
                    : 'border-border bg-muted/20 text-foreground hover:border-nebula-crimson/40 hover:bg-nebula-crimson/5'
                }`}
              >
                <div className="font-semibold">客胜</div>
              </button>
           </div>
         </div>

         {/* 总分指数 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground uppercase tracking-widest">总分指数</span>
            <span className="text-xs font-black text-nebula-crimson font-mono">
              {totalLineText} 分
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
             <button
               onClick={() => handlePick('total', 'over')}
               className={`p-3 rounded-lg text-xs border transition-all duration-300 ${
                 selected?.id === `${match.id}-total-over`
                   ? 'border-nebula-crimson bg-nebula-crimson/10 text-nebula-crimson'
                   : 'border-border bg-muted/20 text-foreground hover:border-nebula-crimson/40 hover:bg-nebula-crimson/5'
               }`}
             >
               <div className="font-semibold">大分</div>
             </button>
             <button
               onClick={() => handlePick('total', 'under')}
               className={`p-3 rounded-lg text-xs border transition-all duration-300 ${
                 selected?.id === `${match.id}-total-under`
                   ? 'border-nebula-crimson bg-nebula-crimson/10 text-nebula-crimson'
                   : 'border-border bg-muted/20 text-foreground hover:border-nebula-crimson/40 hover:bg-nebula-crimson/5'
               }`}
             >
               <div className="font-semibold">小分</div>
             </button>
          </div>
        </div>

        {/* 胜负盘 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground uppercase tracking-widest">胜负盘</span>
            <span className="text-xs font-black text-foreground/60 font-mono">
              独赢
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
             <button
               onClick={() => handlePick('moneyline', 'home')}
               className={`p-3 rounded-lg text-xs border transition-all duration-300 ${
                 selected?.id === `${match.id}-moneyline-home`
                   ? 'border-nebula-crimson bg-nebula-crimson/10 text-nebula-crimson'
                   : 'border-border bg-muted/20 text-foreground hover:border-nebula-crimson/40 hover:bg-nebula-crimson/5'
               }`}
             >
               <div className="font-semibold">主胜</div>
             </button>
             <button
               onClick={() => handlePick('moneyline', 'away')}
               className={`p-3 rounded-lg text-xs border transition-all duration-300 ${
                 selected?.id === `${match.id}-moneyline-away`
                   ? 'border-nebula-crimson bg-nebula-crimson/10 text-nebula-crimson'
                   : 'border-border bg-muted/20 text-foreground hover:border-nebula-crimson/40 hover:bg-nebula-crimson/5'
               }`}
             >
               <div className="font-semibold">客胜</div>
             </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BasketballParlayPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<BasketballParlayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [selectedPicks, setSelectedPicks] = useState<Map<string, SelectedPick>>(
    new Map(),
  );
  const [showGenerated, setShowGenerated] = useState(false);
  const [dateStats, setDateStats] = useState<BasketballDateStatsItem[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getBasketballParlay(date)
      .then((res) => {
        setData(res);
        // 默认预选：实力方向（胜负预测），且推荐不为"观望"的场次
        const preselected = new Map<string, SelectedPick>();
        const matches = res.availableMatches ?? [];
        for (const m of matches) {
          const rec = m.predictionDirection ?? '';
          let side: 'home' | 'away' | null = null;
          if (rec === '主胜') side = 'home';
          else if (rec === '客胜') side = 'away';
          if (!side) continue;

          const odds =
            side === 'home' ? m.homeWinOdds ?? 1.9 : m.awayWinOdds ?? 1.9;
          const direction = side === 'home' ? `${m.homeTeam} 胜` : `${m.awayTeam} 胜`;
          const pickId = `${m.id}-moneyline-${side}`;
          preselected.set(m.id, {
            id: pickId,
            matchId: m.id,
            matchNo: m.matchNo,
            league: m.league,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            pickType: 'moneyline',
            pickDirection: direction,
            odds,
            confidence: m.confidence,
          });
        }
        setSelectedPicks(preselected);
        setShowGenerated(false);
      })
      .catch((err) => {
        logger.error('加载篮球组合方案失败', String(err));
      })
      .finally(() => setLoading(false));
   }, [date]);

   useEffect(() => {
     setStatsLoading(true);
     const endDate = dayjs().format('YYYY-MM-DD');
     const startDate = dayjs().subtract(29, 'day').format('YYYY-MM-DD');
     getBasketballDateStats(startDate, endDate)
       .then((res) => {
         setDateStats(res.items || []);
       })
       .catch((err) => {
         logger.error('加载篮球日期统计失败', String(err));
         setDateStats([]);
       })
       .finally(() => setStatsLoading(false));
   }, []);

  const handlePickToggle = (matchId: string, pick: SelectedPick | null) => {
    const newMap = new Map(selectedPicks);
    if (pick === null) {
      newMap.delete(matchId);
    } else {
      if (newMap.size >= 5 && !newMap.has(matchId)) {
        return;
      }
      newMap.set(matchId, pick);
    }
    setSelectedPicks(newMap);
    setShowGenerated(false);
  };

  const picksArray = Array.from(selectedPicks.values());

  const hitProbability = useMemo(
    () => Math.max(0, Math.min(100, Math.round(picksArray.reduce((acc: number, p: SelectedPick) => acc * (p.confidence / 100), 1) * 100))),
    [picksArray],
  );

  const dateList = useMemo(() => getDateList(), []);
  const isToday = date === dayjs().format('YYYY-MM-DD');

  const trendChartOption = useMemo<EChartsOption | null>(() => {
    const validItems = dateStats.filter((d: BasketballDateStatsItem) => d.hasData && d.finishedCount > 0);
    if (validItems.length < 7) return null;

    const dates = validItems.map((d: BasketballDateStatsItem) =>
      dayjs(d.date).format('MM-DD')
    );
    const wdwData = validItems.map((d: BasketballDateStatsItem) =>
      d.hasData ? Math.round(d.wdwHitRate * 100) / 100 : null
    );
    const handicapData = validItems.map((d: BasketballDateStatsItem) =>
      d.hasData ? Math.round(d.handicapHitRate * 100) / 100 : null
    );
    const overUnderData = validItems.map((d: BasketballDateStatsItem) =>
      d.hasData ? Math.round(d.overUnderHitRate * 100) / 100 : null
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
  }, [dateStats]);

  const canGenerate = picksArray.length >= 2;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero Section */}
      <div className="bg-hero-dark text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-24 pt-12 pb-10">
          <div className="eyebrow eyebrow-line text-white/70 mb-4">
            DATA COMBINE · 多场数据参考
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white mb-3">
             篮球多场数据参考
          </h1>
           <p className="text-sm md:text-base text-white/60">
             模型概率连乘计算，仅供数据分析参考
           </p>
           {/* 免责声明条 */}
       <div className="px-4 md:px-24 py-3 bg-white/5 border-b border-white/10">
         <div className="flex items-start gap-2 text-white/70 text-xs max-w-7xl mx-auto">
           <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
           <p>
             以上为多场赛事数据统计对照，仅供数据分析与研究参考，不构成任何决策建议。请理性看待体育赛事，理性观赛。
           </p>
         </div>
       </div>
          <div className="inline-flex items-stretch rounded-lg border border-white/20 bg-white/5 overflow-hidden mt-6">
            <button
              onClick={() => navigate('/parlay', { replace: true })}
              className="px-5 h-9 text-sm font-medium transition-colors text-white/60 hover:text-white hover:bg-white/10"
            >
              足球多场参考
            </button>
            <button
              className="px-5 h-9 text-sm font-semibold transition-colors bg-nebula-crimson text-white"
            >
              篮球多场参考
            </button>
          </div>
        </div>
      </div>

       <div className="max-w-7xl mx-auto px-4 md:px-24 py-8 pb-28">
        {/* 30天模型参考度趋势 */}
        <section className="metric-card p-5 mb-6">
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

        {/* Date selector */}
        <div className="overflow-x-auto mb-6 scrollbar-hide -mx-4 px-4">
          <div className="flex gap-2 min-w-max">
            {dateList.map((d) => (
              <button
                key={d.date}
                onClick={() => setDate(d.date)}
                className={`flex flex-col items-center justify-center w-14 h-16 rounded-xl transition-all duration-300 flex-shrink-0 ${
                  date === d.date
                    ? 'bg-nebula-crimson text-white shadow-lg shadow-nebula-crimson/30'
                    : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:border-nebula-crimson/40'
                }`}
              >
                <span className="text-[10px] uppercase tracking-widest">{d.weekday}</span>
                <span className="text-lg font-black">{d.day}</span>
                {d.isToday && date !== d.date && (
                  <span className="text-[9px] text-nebula-crimson font-black -mt-1">TODAY</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Risk warning */}
         <div className="p-4 mb-4 rounded-2xl bg-nebula-crimson/5 border border-nebula-crimson/20 text-sm text-foreground/80 flex gap-3">
           <AlertTriangle className="w-5 h-5 flex-shrink-0 text-nebula-crimson mt-0.5" />
           <div>
             <strong className="text-nebula-crimson font-black">风险提示：</strong>
               模型概率不代表赛果，组合场次越多模型准确率越低。数据与模型分析仅供参考，不构成任何决策建议。请理性看待体育赛事，理性观赛。
           </div>
         </div>

         {!loading && (data?.availableMatches?.length ?? 0) < 10 && (
           <div className="bg-gray-50 text-gray-500 text-sm px-4 py-2 rounded-lg flex items-center gap-2 mb-4">
             <Info className="w-4 h-4 flex-shrink-0" />
              <span>多场数据参考积累中，样本较少仅供参考</span>
           </div>
         )}

         <p className="text-xs text-muted-foreground mb-6 px-1">
             本页组合均基于让分赛果与总分指数，不含胜负独赢数据组合。
         </p>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-36 rounded-xl bg-muted/40 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <>
            {/* Auto combos section */}
             <section className="mb-8">
               <div className="flex items-center gap-2 mb-4">
                 <Sparkles className="w-5 h-5 text-nebula-crimson" />
                 <h2 className="text-lg font-black tracking-tight text-foreground">让分胜负组合</h2>
                 <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-auto">HANDICAP</span>
               </div>
               <div className="space-y-4">
                 {data?.combos?.filter((c) => c.playType === 'handicap')?.length ? (
                   data.combos
                     .filter((c) => c.playType === 'handicap')
                     .map((c, i) => (
                       <ComboCard key={`${c.type}-${c.salesDay}-${i}`} combo={c} />
                     ))
                 ) : (
                   <div className="text-center py-10 text-muted-foreground text-sm metric-card">
                       当日符合条件的让分场次不足，暂不生成让分数据组合
                   </div>
                 )}
               </div>
             </section>

             <section className="mb-8">
               <div className="flex items-center gap-2 mb-4">
                 <TrendingUp className="w-5 h-5 text-seq-2" />
                  <h2 className="text-lg font-black tracking-tight text-foreground">总分组合</h2>
                 <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-auto">OVER/UNDER</span>
               </div>
               <div className="space-y-4">
                 {data?.combos?.filter((c) => c.playType === 'total')?.length ? (
                   data.combos
                     .filter((c) => c.playType === 'total')
                     .map((c, i) => (
                       <ComboCard key={`${c.type}-${c.salesDay}-total-${i}`} combo={c} />
                     ))
                 ) : (
                   <div className="text-center py-10 text-muted-foreground text-sm metric-card">
                       当日符合条件的总分场次不足，暂不生成总分数据组合
                   </div>
                 )}
               </div>
             </section>

            {/* Custom combo builder */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-5 h-5 text-nebula-crimson" />
                <h2 className="text-lg font-black tracking-tight text-foreground">自定义组合</h2>
                <span className="text-sm text-muted-foreground font-normal ml-2">
                  ({picksArray.length}/5 场)
                </span>
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-auto">CUSTOM</span>
              </div>

              {data?.availableMatches?.length ? (
                <div className="space-y-4">
                  {data.availableMatches.map((m) => (
                    <MatchSelectCard
                      key={m.id}
                      match={m}
                      selected={selectedPicks.get(m.id) ?? null}
                      onToggle={(pick) => handlePickToggle(m.id, pick)}
                    />
                  ))}
                </div>
              ) : (
                  <div className="text-center py-10 text-muted-foreground text-sm metric-card">
                    选择 2 场以上真实指数比赛生成组合
                 </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Bottom CTA bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card/95 backdrop-blur-sm px-4 py-4 z-40">
        <div className="max-w-7xl mx-auto">
          {picksArray.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  已选 <span className="font-black text-foreground">{picksArray.length}</span> 场 ·{' '}
                  {picksArray.length < 2 && '至少选 2 场'}
                </span>
                 <div className="flex items-center gap-4">
                   <span>
                     组合概率：
                     <span className="text-nebula-crimson font-black font-mono">
                        {hitProbability}%
                     </span>
                   </span>
                 </div>
              </div>
               {showGenerated && canGenerate && (
                 <div className="p-3 rounded-xl bg-nebula-crimson/10 border border-nebula-crimson/30 text-sm text-nebula-crimson font-medium">
                    ✅ 组合已生成：{picksArray.length} 场精选
                 </div>
               )}
              <Button
                className="w-full h-11 bg-nebula-crimson hover:bg-nebula-crimson/90 text-white font-black"
                disabled={!canGenerate}
                onClick={() => setShowGenerated(true)}
              >
                {canGenerate ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    生成方案
                  </>
                ) : (
                  '请选择至少 2 场比赛'
                )}
              </Button>
            </div>
          ) : (
            <Button className="w-full h-11" disabled>
              请选择比赛
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
