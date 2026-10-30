import { useState, useMemo } from 'react';
import { Calendar, TrendingUp, Target, Zap } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { DateStatsItem } from '@shared/api.interface';

const WEEKDAY_MAP = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const COLORS = {
  primary: '#22c55e',
  accent: '#f59e0b',
  homeWin: '#22c55e',
  draw: '#eab308',
  awayWin: '#ef4444',
  foreground: '#e5e7eb',
  muted: '#9ca3af',
  gridLine: '#334155',
  tooltipBg: '#1e293b',
  tooltipBorder: '#334155',
};

interface DailyTrendCardProps {
  items: DateStatsItem[];
}

const formatDateLabel = (dateStr: string): string => {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = WEEKDAY_MAP[d.getDay()];
  return `${month}月${day}日 ${weekday}`;
};

const DailyTrendCard = ({ items }: DailyTrendCardProps) => {
  const finishedItems = useMemo(
    () => items.filter((item) => item.finishedCount > 0),
    [items],
  );

  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    const finished = items.filter((item) => item.finishedCount > 0);
    return finished.length > 0 ? finished[finished.length - 1].date : null;
  });

  const selectedItem = useMemo(() => {
    if (!selectedDate) return null;
    return items.find((item) => item.date === selectedDate) || null;
  }, [selectedDate, items]);

  const chartOption: EChartsOption = useMemo(() => ({
    tooltip: {
      trigger: 'axis',
      backgroundColor: COLORS.tooltipBg,
      borderColor: COLORS.tooltipBorder,
      textStyle: { color: COLORS.foreground },
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params;
        if (!p || typeof p !== 'object') return '';
        const datum = finishedItems[p.dataIndex as number];
        if (!datum) return '';
        return (
          `${datum.date}<br/>` +
          `完赛场次: ${datum.finishedCount}<br/>` +
            `赛果方向准确率: ${Math.max(0, Math.min(100, Math.round(datum.wdwHitRate)))}%<br/>` +
          `让分准确率: ${Math.max(0, Math.min(100, Math.round(datum.handicapHitRate)))}%<br/>` +
          `进球数准确率: ${Math.max(0, Math.min(100, Math.round(datum.overUnderHitRate)))}%`
        );
      },
    },
    grid: {
      left: 0,
      right: 20,
      top: 20,
      bottom: 0,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: finishedItems.map((d) => d.date.slice(5)),
      axisLine: { lineStyle: { color: COLORS.gridLine } },
      axisLabel: { color: COLORS.muted, fontSize: 11 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      max: 100,
      axisLine: { show: false },
      axisLabel: {
        color: COLORS.muted,
        fontSize: 11,
        formatter: '{value}%',
      },
      splitLine: { lineStyle: { color: COLORS.gridLine, type: 'dashed' } },
    },
    series: [
      {
          name: '赛果方向准确率',
        type: 'line',
        data: finishedItems.map((d) => Math.max(0, Math.min(100, Math.round(d.wdwHitRate)))),
        smooth: true,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { color: COLORS.primary, width: 2 },
        itemStyle: { color: COLORS.primary },
        label: {
          show: true,
          position: 'top',
          color: COLORS.foreground,
          fontSize: 10,
          formatter: '{c}%',
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(34, 197, 94, 0.3)' },
              { offset: 1, color: 'rgba(34, 197, 94, 0.02)' },
            ],
          },
        },
      },
    ],
  }), [finishedItems]);

  const handleChartClick = (params: unknown) => {
    if (!params || typeof params !== 'object') return;
    const p = params as { dataIndex?: number };
    if (typeof p.dataIndex !== 'number') return;
    const item = finishedItems[p.dataIndex];
    if (item) {
      setSelectedDate(item.date);
    }
  };

  if (finishedItems.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-10">
         暂无历史验证数据
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 折线图 */}
      <div className="h-[280px]">
        <ReactECharts
          option={chartOption}
          theme="ud"
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
          onEvents={{ click: handleChartClick }}
        />
      </div>

      {/* 下钻详情 */}
      {selectedItem && (
        <div className="bg-muted/30 border border-border/60 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">
                {formatDateLabel(selectedItem.date)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              共 {selectedItem.totalMatches} 场 · 已完赛 {selectedItem.finishedCount} 场
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="bg-card/80 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-home-win" />
                <span className="text-[11px] text-muted-foreground">
                   赛果方向
                </span>
              </div>
              <div className="text-lg font-bold text-home-win font-mono">
                {Math.max(0, Math.min(100, Math.round(selectedItem.wdwHitRate)))}%
              </div>
            </div>
            <div className="bg-card/80 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1.5">
                <Target className="w-3.5 h-3.5 text-accent" />
                <span className="text-[11px] text-muted-foreground">
                   让分
                </span>
              </div>
              <div className="text-lg font-bold text-accent font-mono">
                {Math.max(0, Math.min(100, Math.round(selectedItem.handicapHitRate)))}%
              </div>
            </div>
            <div className="bg-card/80 rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1.5">
                <Zap className="w-3.5 h-3.5 text-draw" />
                <span className="text-[11px] text-muted-foreground">
                   进球数
                </span>
              </div>
              <div className="text-lg font-bold text-draw font-mono">
                {Math.max(0, Math.min(100, Math.round(selectedItem.overUnderHitRate)))}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyTrendCard;
