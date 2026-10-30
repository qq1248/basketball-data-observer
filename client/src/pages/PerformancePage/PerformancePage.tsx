import { useState, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import dayjs from 'dayjs';
import { Calendar as CalendarIcon, TrendingUp } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { useDateStats, type SportType } from '@client/src/hooks/useDateStats';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@client/src/components/ui/popover';
import { Calendar } from '@client/src/components/ui/calendar';
import { Button } from '@client/src/components/ui/button';
import { ErrorState } from '@client/src/components/ui/error-state';
import type { BasketballDateStatsItem } from '@shared/api.interface';
import type { DateStatsItem as FootballDateStatsItem } from '@shared/api.interface';

const TABS: { sport: SportType; label: string; to: string }[] = [
  { sport: 'basketball', label: '篮球战绩', to: '/performance' },
  { sport: 'football', label: '足球战绩', to: '/performance/football' },
];

function formatPct(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 10) / 10}%`;
}

function isFootballItem(
  item: BasketballDateStatsItem | FootballDateStatsItem,
  sport: SportType,
): item is FootballDateStatsItem {
  return sport === 'football';
}

interface TodayOverview {
  totalMatches: number;
  finishedCount: number;
  wdwHitRate: number;
  handicapHitRate: number;
  overUnderHitRate: number;
  wdwValidTotal?: number;
  handicapValidTotal?: number;
  overUnderValidTotal?: number;
}

function computeTodayOverview(
  items: BasketballDateStatsItem[] | FootballDateStatsItem[],
  sport: SportType,
  today: string,
): TodayOverview | null {
  const todayItem: BasketballDateStatsItem | FootballDateStatsItem | undefined = items.find(
    (item: BasketballDateStatsItem | FootballDateStatsItem) => item.date === today,
  );
  if (!todayItem) return null;
  const base: TodayOverview = {
    totalMatches: todayItem.totalMatches,
    finishedCount: todayItem.finishedCount,
    wdwHitRate: todayItem.wdwHitRate,
    handicapHitRate: todayItem.handicapHitRate,
    overUnderHitRate: todayItem.overUnderHitRate,
  };
  if (isFootballItem(todayItem, sport)) {
    base.wdwValidTotal = todayItem.wdwValidTotal;
    base.handicapValidTotal = todayItem.handicapValidTotal;
    base.overUnderValidTotal = todayItem.overUnderValidTotal;
  }
  return base;
}

export default function PerformancePage() {
  const location = useLocation();
  const sport: SportType = location.pathname.includes('/performance/football')
    ? 'football'
    : 'basketball';

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [calendarOpen, setCalendarOpen] = useState<boolean>(false);

  const endDate: string = dayjs(selectedDate).format('YYYY-MM-DD');
  const startDate: string = dayjs(selectedDate).subtract(6, 'day').format('YYYY-MM-DD');

  const { items, loading, error, refetch } = useDateStats(sport, startDate, endDate);

  const todayKey: string = dayjs(selectedDate).format('YYYY-MM-DD');
  const todayOverview: TodayOverview | null = useMemo(
    () => computeTodayOverview(items, sport, todayKey),
    [items, sport, todayKey],
  );

  // 近7日趋势数据（按日期排序）
  const trendData: (BasketballDateStatsItem | FootballDateStatsItem)[] = useMemo(() => {
    const sorted: (BasketballDateStatsItem | FootballDateStatsItem)[] = [...items].sort(
      (a: BasketballDateStatsItem | FootballDateStatsItem, b: BasketballDateStatsItem | FootballDateStatsItem) =>
        a.date.localeCompare(b.date),
    );
    return sorted;
  }, [items]);

  const handleDateSelect = (date: Date | undefined): void => {
    if (date) {
      logger.debug('选择日期', date);
      setSelectedDate(date);
      setCalendarOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#111827]">
      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* 顶部标题区 */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#8B0000] font-semibold mb-1">
              PERFORMANCE DAILY
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight">
              战绩日报
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* 足篮切换 Tab */}
            <div className="flex bg-white rounded-lg border border-[#F3F4F6] p-1">
              {TABS.map((tab: { sport: SportType; label: string; to: string }) => (
                <NavLink
                  key={tab.sport}
                  to={tab.to}
                  end={tab.sport === 'basketball'}
                  className={({ isActive }: { isActive: boolean }) =>
                    `px-4 py-1.5 rounded-md text-sm font-semibold transition-all duration-300 ${
                      isActive
                        ? 'bg-[#8B0000] text-white shadow-sm'
                        : 'text-gray-500 hover:text-[#111827]'
                    }`
                  }
                >
                  {tab.label}
                </NavLink>
              ))}
            </div>
            {/* 日期选择器 */}
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2 bg-white border-[#F3F4F6] hover:border-[#8B0000]/30 hover:text-[#8B0000] transition-colors"
                >
                  <CalendarIcon className="w-4 h-4" />
                  <span className="font-medium tabular-nums">
                    {dayjs(selectedDate).format('YYYY年MM月DD日')}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-white border border-[#F3F4F6] rounded-lg shadow-lg">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* 近7日正确率趋势图（占位） */}
        <div className="bg-white rounded-lg border border-[#F3F4F6] p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-[#8B0000]" />
            <h2 className="text-lg font-black tracking-tight">近7日正确率趋势</h2>
          </div>
          {trendData.length > 0 && !loading ? (
            <div className="bg-[#FAFAFA] rounded-lg border border-[#F3F4F6] p-4">
              <div className="grid grid-cols-7 gap-2 text-center">
                {trendData.map((item: BasketballDateStatsItem | FootballDateStatsItem) => {
                  const hit = item.handicapHit ?? 0;
                  const totalNum = 'handicapValidTotal' in item ? item.handicapValidTotal : item.handicapTotal ?? 0;
                  const hitRate = totalNum > 0 ? Math.round((hit / totalNum) * 100) : 0;
                  return (
                    <div key={item.date} className="flex flex-col gap-1.5">
                      <span className="text-[10px] text-gray-400 font-mono">{dayjs(item.date).format('MM/DD')}</span>
                      <div className="relative h-16 bg-gray-100 rounded flex items-end overflow-hidden">
                        <div
                          className="w-full bg-gradient-to-t from-[#8B0000] to-[#CD5C5C] rounded-t transition-all duration-500"
                          style={{ height: `${Math.max(hitRate, 5)}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-[#8B0000]">{hitRate}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : loading ? (
            <div
              className="flex items-center justify-center bg-[#FAFAFA] rounded-lg border border-dashed border-[#F3F4F6] text-gray-400 text-sm"
              style={{ height: '180px' }}
            >
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-[#8B0000]/20 border-t-[#8B0000] rounded-full animate-spin" />
                数据加载中...
              </span>
            </div>
          ) : error ? (
            <div style={{ height: '180px' }}>
              <ErrorState
                size="sm"
                message="图表数据加载失败"
                onRetry={refetch}
                className="h-full"
              />
            </div>
          ) : (
            <div
              className="flex items-center justify-center bg-[#FAFAFA] rounded-lg border border-dashed border-[#F3F4F6] text-gray-400 text-sm"
              style={{ height: '180px' }}
            >
              暂无数据
            </div>
          )}
          {trendData.length > 0 && !loading && (
            <div className="mt-3 grid grid-cols-7 gap-2 text-center text-[10px] text-gray-400">
              {trendData.map((item: BasketballDateStatsItem | FootballDateStatsItem) => (
                <div key={item.date} className="flex flex-col gap-1">
                  <span className="font-mono">{dayjs(item.date).format('MM/DD')}</span>
                  <span
                    className="font-bold"
                    style={{ color: item.wdwHitRate >= 60 ? '#8B0000' : '#9CA3AF' }}
                  >
                    {formatPct(item.wdwHitRate)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 今日战绩概览卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MetricCard
            label="总场次"
            value={todayOverview ? String(todayOverview.totalMatches) : '—'}
            subValue={todayOverview ? `已完赛 ${todayOverview.finishedCount}` : ''}
            loading={loading}
          />
          <MetricCard
            label="胜负命中率"
            value={todayOverview ? formatPct(todayOverview.wdwHitRate) : '—'}
            subValue={
              todayOverview?.wdwValidTotal != null
                ? `有效 ${todayOverview.wdwValidTotal} 场`
                : todayOverview
                  ? `已完赛 ${todayOverview.finishedCount} 场`
                  : ''
            }
            loading={loading}
            highlight={!!todayOverview && todayOverview.wdwHitRate >= 60}
          />
          <MetricCard
            label="实力命中率"
            value={todayOverview ? formatPct(todayOverview.handicapHitRate) : '—'}
            subValue={
              todayOverview?.handicapValidTotal != null
                ? `有效 ${todayOverview.handicapValidTotal} 场`
                : ''
            }
            loading={loading}
            highlight={!!todayOverview && todayOverview.handicapHitRate >= 60}
          />
          <MetricCard
            label="大小分命中率"
            value={todayOverview ? formatPct(todayOverview.overUnderHitRate) : '—'}
            subValue={
              todayOverview?.overUnderValidTotal != null
                ? `有效 ${todayOverview.overUnderValidTotal} 场`
                : ''
            }
            loading={loading}
            highlight={!!todayOverview && todayOverview.overUnderHitRate >= 60}
          />
        </div>

        {/* 历史战绩表格 */}
        <div className="bg-white rounded-lg border border-[#F3F4F6] p-6">
          <h2 className="text-lg font-black tracking-tight mb-4">历史战绩</h2>
          {loading ? (
            <div className="py-12 text-center text-gray-400 text-sm">加载中...</div>
          ) : error ? (
            <ErrorState
              size="md"
              message="数据加载失败"
              description={error}
              onRetry={refetch}
            />
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">暂无数据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#F3F4F6]">
                    <th className="text-left py-3 px-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">
                      日期
                    </th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">
                      总场次
                    </th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">
                      胜负命中
                    </th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">
                      胜负命中率
                    </th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">
                       实力命中
                     </th>
                     <th className="text-center py-3 px-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">
                       实力命中率
                     </th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">
                      大小分命中
                    </th>
                    <th className="text-center py-3 px-3 font-semibold text-gray-500 text-[11px] uppercase tracking-wider">
                      大小分命中率
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...items]
                    .sort(
                      (a: BasketballDateStatsItem | FootballDateStatsItem, b: BasketballDateStatsItem | FootballDateStatsItem) =>
                        b.date.localeCompare(a.date),
                    )
                    .map((item: BasketballDateStatsItem | FootballDateStatsItem) => {
                      const fbItem: FootballDateStatsItem | null =
                        isFootballItem(item, sport) ? item : null;
                      const wdwHitCount: number = fbItem
                        ? Math.round(fbItem.wdwValidTotal * (fbItem.wdwHitRate / 100))
                        : 0;
                      const hcpHitCount: number = fbItem
                        ? Math.round(fbItem.handicapValidTotal * (fbItem.handicapHitRate / 100))
                        : 0;
                      const ouHitCount: number = fbItem
                        ? Math.round(fbItem.overUnderValidTotal * (fbItem.overUnderHitRate / 100))
                        : 0;
                      return (
                        <tr
                          key={item.date}
                          className="border-b border-[#F3F4F6] hover:bg-[#FAFAFA] transition-colors"
                        >
                          <td className="py-3 px-3 font-mono font-medium">
                            {dayjs(item.date).format('YYYY-MM-DD')}
                          </td>
                          <td className="py-3 px-3 text-center font-mono tabular-nums">
                            {item.totalMatches}
                          </td>
                          <td className="py-3 px-3 text-center font-mono tabular-nums">
                            {fbItem ? wdwHitCount : '—'}
                          </td>
                          <td className="py-3 px-3 text-center font-mono tabular-nums font-bold">
                            <span
                              style={{
                                color: item.wdwHitRate >= 60 ? '#8B0000' : '#9CA3AF',
                              }}
                            >
                              {formatPct(item.wdwHitRate)}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center font-mono tabular-nums">
                            {fbItem ? hcpHitCount : '—'}
                          </td>
                          <td className="py-3 px-3 text-center font-mono tabular-nums font-bold">
                            <span
                              style={{
                                color: item.handicapHitRate >= 60 ? '#8B0000' : '#9CA3AF',
                              }}
                            >
                              {formatPct(item.handicapHitRate)}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center font-mono tabular-nums">
                            {fbItem ? ouHitCount : '—'}
                          </td>
                          <td className="py-3 px-3 text-center font-mono tabular-nums font-bold">
                            <span
                              style={{
                                color: item.overUnderHitRate >= 60 ? '#8B0000' : '#9CA3AF',
                              }}
                            >
                              {formatPct(item.overUnderHitRate)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  subValue?: string;
  loading?: boolean;
  highlight?: boolean;
}

function MetricCard({ label, value, subValue, loading, highlight }: MetricCardProps) {
  return (
    <div className="bg-white rounded-lg border border-[#F3F4F6] p-4 hover:shadow-md hover:border-[#8B0000]/20 transition-all duration-300">
      <div className="text-[11px] text-gray-500 uppercase tracking-wider font-semibold mb-2">
        {label}
      </div>
      {loading ? (
        <div className="h-8 w-16 bg-[#F3F4F6] rounded animate-pulse" />
      ) : (
        <div
          className={`text-2xl md:text-3xl font-black tracking-tight tabular-nums ${
            highlight ? 'text-[#8B0000]' : 'text-[#111827]'
          }`}
        >
          {value}
        </div>
      )}
      {subValue && (
        <div className="text-xs text-gray-400 mt-1">{subValue}</div>
      )}
    </div>
  );
}
