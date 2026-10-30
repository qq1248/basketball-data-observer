import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  TrendingUp,
  Activity,
  Zap,
  ListChecks,
  BarChart3,
  History,
} from 'lucide-react';
import type { MatchItem, TotalGoalsProbItem, HalfFullProbItem, AdvancedStats } from '@shared/api.interface';

interface DeepAnalysisTabProps {
  match: MatchItem;
}

const HALF_FULL_ORDER = ['胜胜', '胜平', '胜负', '平胜', '平平', '平负', '负胜', '负平', '负负'];

const DeepAnalysisTab = ({ match }: DeepAnalysisTabProps) => {
  const resultProbChartOption: EChartsOption = useMemo(() => ({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number }[];
        if (!p || p.length === 0) return '';
        return `${p[0].name}: ${p[0].value}%`;
      },
    },
    grid: { left: 60, right: 20, top: 10, bottom: 10, containLabel: false },
    xAxis: {
      type: 'value',
      max: 100,
      axisLabel: { show: false },
      splitLine: { lineStyle: { color: 'hsl(214 20% 88%)' } },
    },
    yAxis: {
      type: 'category',
      data: ['客胜', '平', '主胜'],
      axisLabel: {
        color: 'hsl(215 28% 17%)',
        fontSize: 12,
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        data: [
          { value: match.awayWinProb, itemStyle: { color: 'hsl(0 72% 51%)', borderRadius: [0, 4, 4, 0] } },
          { value: match.drawProb, itemStyle: { color: 'hsl(40 80% 57%)', borderRadius: [0, 4, 4, 0] } },
          { value: match.homeWinProb, itemStyle: { color: 'hsl(210 100% 25%)', borderRadius: [0, 4, 4, 0] } },
        ],
        barWidth: 20,
        label: {
          show: true,
          position: 'right',
          color: 'hsl(215 28% 17%)',
          fontSize: 12,
          fontFamily: 'monospace',
          formatter: '{c}%',
        },
      },
    ],
  }), [match.homeWinProb, match.drawProb, match.awayWinProb]);

  const totalGoalsProb: TotalGoalsProbItem[] = match.totalGoalsProb || [];
  const toProbPct = (v: number): number => {
    if (v == null || isNaN(v)) return 0;
    return v >= 1 ? v : v * 100;
  };

  const top3Goals = useMemo(() => {
    return [...totalGoalsProb]
      .sort((a, b) => toProbPct(b.prob) - toProbPct(a.prob))
      .slice(0, 3)
      .map((item) => ({ ...item, displayProb: Math.round(toProbPct(item.prob)) }));
  }, [totalGoalsProb]);

  const totalGoalsChartOption: EChartsOption = useMemo(() => {
    const sorted = [...totalGoalsProb].sort((a, b) => {
      const na = parseInt(String(a.goals), 10);
      const nb = parseInt(String(b.goals), 10);
      return na - nb;
    });
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const p = params as { name: string; value: number }[];
          if (!p || p.length === 0) return '';
          return `${p[0].name}球: ${Math.round(toProbPct(p[0].value))}%`;
        },
      },
      grid: { left: 20, right: 20, top: 20, bottom: 30, containLabel: true },
      xAxis: {
        type: 'category',
        data: sorted.map((i) => i.goals),
        axisLabel: { color: 'hsl(215 28% 17%)', fontSize: 11 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: 'hsl(214 20% 88%)' } },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((item, idx) => ({
            value: toProbPct(item.prob),
            itemStyle: {
              color: idx === top3Goals.findIndex((t) => t.goals === item.goals)
                ? 'hsl(40 80% 57%)'
                : 'hsl(210 100% 25%)',
              borderRadius: [4, 4, 0, 0],
            },
          })),
          barWidth: 24,
          label: {
            show: true,
            position: 'top',
            color: 'hsl(215 28% 17%)',
            fontSize: 10,
            fontFamily: 'monospace',
            formatter: '{c}%',
          },
        },
      ],
    };
  }, [totalGoalsProb, top3Goals]);

  const halfFullProb: HalfFullProbItem[] = match.halfFullProb || [];
  const halfFullData = useMemo(() => {
    return HALF_FULL_ORDER.map((code) => {
      const found = halfFullProb.find((item) => item.code === code);
      const prob = found ? toProbPct(found.prob) / 100 : 0;
      return { code, label: code, prob };
    });
  }, [halfFullProb]);

  const top3HalfFull = useMemo(() => {
    return [...halfFullData]
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 3)
      .map((d) => d.code);
  }, [halfFullData]);

  const maxHalfFullProb = Math.max(...halfFullData.map((d) => d.prob), 0.01);

  const modelRules = match.modelRules || [];

  const advancedStats: Partial<AdvancedStats> = match.advancedStats || {};
  const hasAdvancedStats =
    (advancedStats.possessionHome ?? 0) > 0 ||
    (advancedStats.possessionAway ?? 0) > 0 ||
    (advancedStats.shotsHome ?? 0) > 0 ||
    (advancedStats.shotsAway ?? 0) > 0 ||
    (advancedStats.shotsOnTargetHome ?? 0) > 0 ||
    (advancedStats.shotsOnTargetAway ?? 0) > 0 ||
    (advancedStats.cornersHome ?? 0) > 0 ||
    (advancedStats.cornersAway ?? 0) > 0 ||
    (advancedStats.foulsHome ?? 0) > 0 ||
    (advancedStats.foulsAway ?? 0) > 0 ||
    (advancedStats.passAccuracyHome ?? 0) > 0 ||
    (advancedStats.passAccuracyAway ?? 0) > 0;

  const homeForm = match.homeForm || [];
  const awayForm = match.awayForm || [];
  const hasForm = homeForm.length > 0 || awayForm.length > 0;

  const formBadge = (result: string) => {
    const r = String(result).charAt(0).toUpperCase();
    if (r === 'W') return 'bg-home-win/15 text-home-win border-home-win/30';
    if (r === 'L') return 'bg-away-win/15 text-away-win border-away-win/30';
    if (r === 'D') return 'bg-draw/15 text-draw border-draw/30';
    return 'bg-muted/60 text-muted-foreground border-border/60';
  };

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">赛果概率分析</h2>
          </div>
          <span className="px-2 py-1 rounded text-[10px] font-medium bg-primary/15 text-primary border border-primary/30">
            模型置信度 {Math.round(match.confidence)}%
          </span>
        </div>
        <ReactECharts
          option={resultProbChartOption}
          style={{ height: 200 }}
          opts={{ renderer: 'svg' }}
        />
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-primary" />
           <h2 className="text-lg font-semibold text-foreground">进球数分布</h2>
        </div>
        {totalGoalsProb.length > 0 ? (
          <>
            <div className="flex gap-1.5 flex-wrap justify-end mb-3">
              {totalGoalsProb.map((item) => {
                const isTop = item.goals === top3Goals[0]?.goals;
                return (
                  <span
                    key={item.goals}
                    className={`px-2 py-1 rounded text-[10px] border ${
                      isTop
                        ? 'bg-accent/20 text-accent border-accent/40 font-semibold'
                        : 'bg-muted/60 text-muted-foreground border-border/60'
                    }`}
                  >
                    {item.goals} {Math.round(toProbPct(item.prob))}%
                  </span>
                );
              })}
            </div>
            <ReactECharts
              option={totalGoalsChartOption}
              style={{ height: 240 }}
              opts={{ renderer: 'svg' }}
            />
            {top3Goals.length > 0 && (
              <div className="pt-3 border-t border-border/60">
                <div className="text-xs text-muted-foreground mb-2">Top 3 最可能进球数</div>
                <div className="flex gap-2">
                  {top3Goals.map((item, idx) => (
                    <div
                      key={item.goals}
                      className={`px-3 py-1.5 rounded-lg text-sm font-mono font-semibold ${
                        idx === 0
                          ? 'bg-accent/20 text-accent border border-accent/40'
                          : 'bg-muted/60 text-foreground border border-border/60'
                      }`}
                    >
                      {idx + 1}. {item.goals}球 ({item.displayProb}%)
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            暂无可靠数据
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">球队统计</h2>
        </div>
        {hasAdvancedStats ? (
          <div className="space-y-3">
            {advancedStats.possessionHome != null && advancedStats.possessionAway != null && (advancedStats.possessionHome > 0 || advancedStats.possessionAway > 0) && (
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>{advancedStats.possessionHome}%</span>
                  <span>控球率</span>
                  <span>{advancedStats.possessionAway}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted/60 flex overflow-hidden">
                  <div className="h-full bg-home-win" style={{ width: `${advancedStats.possessionHome}%` }} />
                  <div className="h-full bg-away-win" style={{ width: `${advancedStats.possessionAway}%` }} />
                </div>
              </div>
            )}
             <div className="grid grid-cols-2 gap-3 text-sm">
               {((advancedStats.shotsHome ?? 0) > 0 || (advancedStats.shotsAway ?? 0) > 0) && (
                 <div className="text-center p-2 rounded-lg bg-muted/30">
                   <div className="text-xs text-muted-foreground">射门(主/客)</div>
                   <div className="font-mono font-semibold text-foreground">
                     {advancedStats.shotsHome ?? 0} / {advancedStats.shotsAway ?? 0}
                   </div>
                 </div>
               )}
               {((advancedStats.shotsOnTargetHome ?? 0) > 0 || (advancedStats.shotsOnTargetAway ?? 0) > 0) && (
                 <div className="text-center p-2 rounded-lg bg-muted/30">
                   <div className="text-xs text-muted-foreground">射正(主/客)</div>
                   <div className="font-mono font-semibold text-foreground">
                     {advancedStats.shotsOnTargetHome ?? 0} / {advancedStats.shotsOnTargetAway ?? 0}
                   </div>
                 </div>
               )}
               {((advancedStats.cornersHome ?? 0) > 0 || (advancedStats.cornersAway ?? 0) > 0) && (
                 <div className="text-center p-2 rounded-lg bg-muted/30">
                   <div className="text-xs text-muted-foreground">角球(主/客)</div>
                   <div className="font-mono font-semibold text-foreground">
                     {advancedStats.cornersHome ?? 0} / {advancedStats.cornersAway ?? 0}
                   </div>
                 </div>
               )}
               {((advancedStats.passAccuracyHome ?? 0) > 0 || (advancedStats.passAccuracyAway ?? 0) > 0) && (
                 <div className="text-center p-2 rounded-lg bg-muted/30">
                   <div className="text-xs text-muted-foreground">传球成功率</div>
                   <div className="font-mono font-semibold text-foreground">
                     {advancedStats.passAccuracyHome ?? 0}% / {advancedStats.passAccuracyAway ?? 0}%
                   </div>
                 </div>
               )}
               {(advancedStats.xgHome ?? 0) > 0 || (advancedStats.xgAway ?? 0) > 0 ? (
                 <div className="text-center p-2 rounded-lg bg-muted/30 col-span-2">
                   <div className="text-xs text-muted-foreground">预期进球 xG (主/客) <span className="text-[10px] text-muted-foreground/70">（估算）</span></div>
                   <div className="font-mono font-semibold text-foreground">
                     {advancedStats.xgHome ?? 0} / {advancedStats.xgAway ?? 0}
                   </div>
                 </div>
               ) : null}
             </div>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            暂无可靠数据
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-semibold text-foreground">近期战绩</h2>
        </div>
        {hasForm ? (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-2">{match.homeTeam} (近{homeForm.length}场)</div>
              <div className="flex gap-1.5 flex-wrap">
                {homeForm.map((item: string | { result: string; opponent: string; score: string }, idx: number) => {
                  const result = typeof item === 'string' ? item.charAt(0).toUpperCase() : (item.result || '').charAt(0).toUpperCase();
                  const label = typeof item === 'string' ? item : `${item.result} ${item.opponent}`;
                  return (
                    <span key={idx} className={`px-2.5 py-1 rounded text-xs font-semibold border ${formBadge(result)}`}>
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-2">{match.awayTeam} (近{awayForm.length}场)</div>
              <div className="flex gap-1.5 flex-wrap">
                {awayForm.map((item: string | { result: string; opponent: string; score: string }, idx: number) => {
                  const result = typeof item === 'string' ? item.charAt(0).toUpperCase() : (item.result || '').charAt(0).toUpperCase();
                  const label = typeof item === 'string' ? item : `${item.result} ${item.opponent}`;
                  return (
                    <span key={idx} className={`px-2.5 py-1 rounded text-xs font-semibold border ${formBadge(result)}`}>
                      {label}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            暂无可靠数据
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-semibold text-foreground">半场全场数据模型参考</h2>
        </div>
        {halfFullProb.length > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {halfFullData.map((item) => {
                const isTop = top3HalfFull.includes(item.code);
                const widthPct = (item.prob / maxHalfFullProb) * 100;
                const barColor = isTop ? 'bg-accent' : 'bg-home-win/50';
                return (
                  <div
                    key={item.code}
                    className={`rounded-lg border p-3 transition-colors ${
                      isTop
                        ? 'bg-accent/10 border-accent/40'
                        : 'bg-muted/40 border-border/60'
                    }`}
                  >
                    <div className={`text-sm font-semibold mb-2 ${isTop ? 'text-accent' : 'text-foreground'}`}>
                      {item.label}
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/80 overflow-hidden mb-1.5">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <div className={`text-xs font-mono ${isTop ? 'text-accent font-semibold' : 'text-muted-foreground'}`}>
                      {Math.round(item.prob * 100)}%
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="pt-3 border-t border-border/60">
              <div className="text-xs text-muted-foreground mb-2">Top 3 高频结果</div>
              <div className="flex flex-wrap gap-2">
                {top3HalfFull.map((code, idx) => {
                  const item = halfFullData.find((d) => d.code === code);
                  if (!item) return null;
                  return (
                    <span
                      key={code}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                        idx === 0
                          ? 'bg-accent/20 text-accent border border-accent/40'
                          : 'bg-muted/60 text-foreground border border-border/60'
                      }`}
                    >
                      {item.label} ({Math.round(item.prob * 100)}%)
                    </span>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            暂无可靠数据
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <ListChecks className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">模型规则</h2>
        </div>
        {modelRules.length > 0 ? (
          <div className="space-y-2">
            {modelRules.map((rule, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg bg-muted/40 border border-border/60"
              >
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-primary/15 text-primary text-xs font-mono font-bold border border-primary/30 flex-shrink-0">
                    R{idx + 1}
                  </span>
                  <span className="text-sm font-medium text-foreground">{rule}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            暂无可靠数据
          </div>
        )}
      </div>
    </div>
  );
};

export default DeepAnalysisTab;
