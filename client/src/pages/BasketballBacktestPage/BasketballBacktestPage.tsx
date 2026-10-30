import { useState, useEffect, useCallback } from 'react';
import {
  Trophy,
  Target,
  Layers,
  BarChart3,
  Calendar,
  AlertCircle,
  Download,
  RefreshCw,
  CalendarRange,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { statsApi } from '@client/src/api';
import type { BasketballBacktestResponse } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@client/src/components/ui/popover';
import { Calendar as CalendarComp } from '@client/src/components/ui/calendar';
import dayjs from 'dayjs';

type RangePreset = '7' | '14' | '30' | 'custom';

const PRESETS: { value: RangePreset; label: string; days?: number }[] = [
  { value: '7', label: '近7天', days: 7 },
  { value: '14', label: '近14天', days: 14 },
  { value: '30', label: '近30天', days: 30 },
];

const BasketballBacktestPage = () => {
  const [data, setData] = useState<BasketballBacktestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [preset, setPreset] = useState<RangePreset>('30');
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();
  const [showDatePicker, setShowDatePicker] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(false);
    const params: { days?: number; startDate?: string; endDate?: string } = {};
    if (preset === 'custom') {
      if (customStart) params.startDate = dayjs(customStart).format('YYYY-MM-DD');
      if (customEnd) params.endDate = dayjs(customEnd).format('YYYY-MM-DD');
    } else {
      const presetItem = PRESETS.find((p) => p.value === preset);
      if (presetItem?.days) params.days = presetItem.days;
    }
    statsApi
      .getBasketballBacktest(params)
      .then((res) => setData(res))
      .catch((err) => {
        logger.error('加载篮球回测数据失败', err);
        setError(true);
        toast.error('加载回测数据失败');
      })
      .finally(() => setLoading(false));
  }, [preset, customStart, customEnd]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = () => {
    if (!data) return;
    try {
      const exportData = {
        range: data.dateRange,
        totalSamples: data.totalSamples,
        byLeague: data.byLeague.map((l) => ({
          league: l.league,
          samples: l.samples,
          wdw: l.wdw,
          handicap: l.handicap,
          overUnder: l.overUnder,
        })),
        byConfidence: data.byConfidence.map((c) => ({
          level: c.level,
          hitRate: c.hitRate,
          samples: c.samples,
        })),
        byDepth: data.byDepth.map((d) => ({
          depth: d.depth,
          hitRate: d.hitRate,
          samples: d.samples,
        })),
        byMonth: data.byMonth.map((m) => ({
          month: m.month,
          handicapHit: m.handicapHit,
          overRate: m.overRate,
          samples: m.samples,
        })),
        detailList: data.detailList.slice(0, 100),
        detailCount: data.detailList.length,
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const today = dayjs().format('YYYYMMDD');
      a.download = `back-report-${today}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('报告已导出');
    } catch (err) {
      logger.error('导出报告失败', err);
      toast.error('导出失败');
    }
  };

  const handleApplyCustom = () => {
    if (!customStart || !customEnd) {
      toast.warning('请选择起止日期');
      return;
    }
    if (customStart > customEnd) {
      toast.warning('开始日期不能晚于结束日期');
      return;
    }
    setPreset('custom');
    setShowDatePicker(false);
  };

  const customRangeLabel =
    customStart && customEnd
      ? `${dayjs(customStart).format('MM/DD')} - ${dayjs(customEnd).format('MM/DD')}`
      : '自定义日期';

  if (error && !data) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 md:py-16">
          <div className="mb-10">
            <div className="eyebrow eyebrow-line mb-3">Backtest Report</div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-foreground mb-3">
              历史回测
            </h1>
            <p className="text-sm md:text-base text-gray-400 leading-relaxed max-w-xl">
              模型回测数据统计与深度分析报告
            </p>
          </div>
          <div className="mt-12 flex flex-col items-center justify-center py-20 px-6 rounded-3xl border border-gray-100 bg-white shadow-sm">
            <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center mb-5">
              <BarChart3 className="w-10 h-10 text-gray-300" />
            </div>
            <h2 className="text-lg font-bold text-foreground mb-2">暂无回测数据</h2>
            <p className="text-sm text-gray-400 text-center max-w-sm leading-relaxed">
              回测数据正在陆续补充中，后续将基于真实历史比赛结果进行统计分析
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 md:py-16">
        {/* Hero */}
        <div className="mb-8 md:mb-10">
          <div className="eyebrow eyebrow-line mb-3">Basketball Backtest</div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-foreground mb-3">
            历史回测报告
          </h1>
          <p className="text-sm md:text-base text-gray-400 leading-relaxed max-w-2xl">
            基于 <span className="font-bold text-nebula-crimson">{data?.totalSamples ?? 0}</span> 场历史比赛的全量回测，
             覆盖赛果、实力、总分三大口径，为模型迭代提供数据支撑。
          </p>
        </div>

        {/* 时间范围选择 + 导出 */}
        <div className="flex flex-wrap items-center gap-3 mb-8">
          <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1 shadow-sm">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPreset(p.value)}
                className={`px-4 h-8 text-xs font-medium rounded-lg transition-all duration-200 ${
                  preset === p.value
                    ? 'bg-nebula-crimson text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {p.label}
              </button>
            ))}
            <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
              <PopoverTrigger asChild>
                <button
                  className={`px-3 h-8 text-xs font-medium rounded-lg transition-all duration-200 flex items-center gap-1.5 ${
                    preset === 'custom'
                      ? 'bg-nebula-crimson text-white shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <CalendarRange className="w-3.5 h-3.5" />
                  {preset === 'custom' ? customRangeLabel : '自定义'}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div className="p-4 space-y-3">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">开始日期</div>
                    <CalendarComp
                      mode="single"
                      selected={customStart}
                      onSelect={(d) => setCustomStart(d ?? undefined)}
                      initialFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">结束日期</div>
                    <CalendarComp
                      mode="single"
                      selected={customEnd}
                      onSelect={(d) => setCustomEnd(d ?? undefined)}
                      initialFocus
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setShowDatePicker(false)}
                    >
                      取消
                    </Button>
                    <Button size="sm" className="flex-1" onClick={handleApplyCustom}>
                      应用
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <button
            onClick={fetchData}
            className="w-9 h-9 rounded-xl border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-nebula-crimson/40 transition-all"
            aria-label="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <Button
            onClick={handleExport}
            disabled={loading || !data}
            variant="outline"
            size="sm"
            className="ml-auto gap-1.5"
          >
            <Download className="w-4 h-4" />
            导出报告
          </Button>
        </div>

        {loading && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="h-28 bg-card border border-border rounded-2xl animate-pulse shadow-sm" />
              <div className="h-28 bg-card border border-border rounded-2xl animate-pulse shadow-sm" />
              <div className="h-28 bg-card border border-border rounded-2xl animate-pulse shadow-sm" />
            </div>
            <div className="h-64 w-full bg-card border border-border rounded-2xl animate-pulse shadow-sm" />
            <div className="h-48 w-full bg-card border border-border rounded-2xl animate-pulse shadow-sm" />
          </div>
        )}

        {!loading && (!data || !data.hasData) && (
          <div className="mt-12 flex flex-col items-center justify-center py-20 px-6 rounded-3xl border border-border bg-white shadow-sm">
            <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center mb-5">
              <BarChart3 className="w-10 h-10 text-gray-300" />
            </div>
            <h2 className="text-lg font-bold text-foreground mb-2">暂无回测数据</h2>
            <p className="text-sm text-gray-400 text-center max-w-sm leading-relaxed">
              回测数据正在陆续补充中，后续将基于真实历史比赛结果进行统计分析
            </p>
          </div>
        )}

        {!loading && data && data.hasData && (
          <>
        {/* Summary metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
          <div className="metric-card p-6">
            <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">累计样本</div>
            <div className="text-4xl font-black text-nebula-crimson tracking-tight tabular-nums">
              {data.totalSamples}
            </div>
            <div className="text-xs text-gray-400 mt-1">Total Samples</div>
            <div className="mt-4 h-1 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full progress-gradient rounded-full w-3/4" />
            </div>
          </div>
          {data.byLeague.length > 0 && (
            <div className="metric-card p-6">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">覆盖联赛</div>
              <div className="text-4xl font-black text-nebula-crimson tracking-tight tabular-nums">
                {data.byLeague.length}
              </div>
              <div className="text-xs text-gray-400 mt-1">Leagues Covered</div>
              <div className="mt-4 h-1 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full progress-gradient rounded-full w-1/2" />
              </div>
            </div>
          )}
          {data.byConfidence.length > 0 && (
            <div className="metric-card p-6">
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">信心层级</div>
              <div className="text-4xl font-black text-nebula-crimson tracking-tight tabular-nums">
                {data.byConfidence.length}
              </div>
              <div className="text-xs text-gray-400 mt-1">Confidence Tiers</div>
              <div className="mt-4 h-1 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full progress-gradient rounded-full w-2/3" />
              </div>
            </div>
          )}
        </div>

      {data.byLeague.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-nebula-crimson" />
            </div>
            <div>
               <h2 className="text-lg font-black tracking-tight text-foreground">分联赛模型准确率</h2>
              <p className="text-xs text-gray-400">League-wise Hit Rate</p>
            </div>
          </div>
          <div className="space-y-4">
            {data.byLeague.map((l) => (
              <div key={l.league} className="pb-4 border-b border-gray-100 last:border-0 last:pb-0">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-foreground">{l.league}</span>
                  <span className="text-xs text-gray-400">{l.samples} 场样本</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-2 rounded-lg bg-gray-50">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">胜负</div>
                    <div className="text-base font-bold text-nebula-crimson tabular-nums">{l.wdw}%</div>
                  </div>
                   <div className="text-center p-2 rounded-lg bg-gray-50">
                     <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">实力</div>
                     <div className="text-base font-bold text-seq-3 tabular-nums">{l.handicap}%</div>
                   </div>
                  <div className="text-center p-2 rounded-lg bg-gray-50">
                     <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">总分</div>
                    <div className="text-base font-bold text-seq-5 tabular-nums">{l.overUnder}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.byConfidence.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <Target className="w-4 h-4 text-nebula-crimson" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight text-foreground">信心度分层</h2>
              <p className="text-xs text-gray-400">Confidence Tiers</p>
            </div>
          </div>
          <div className="space-y-3">
            {data.byConfidence.map((c) => (
              <div key={c.level} className="flex items-center gap-4 py-2 border-b border-gray-100 last:border-0">
                <span className="text-sm font-semibold text-foreground w-20 shrink-0">{c.level}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full progress-gradient rounded-full transition-all"
                    style={{ width: `${Math.min(100, c.hitRate)}%` }}
                  />
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-bold text-nebula-crimson tabular-nums">{c.hitRate}%</span>
                  <span className="text-[10px] text-gray-400">{c.samples}场</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.byMonth.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-nebula-crimson" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight text-foreground">按月走势</h2>
              <p className="text-xs text-gray-400">Monthly Trend</p>
            </div>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {data.byMonth.map((m) => (
              <div key={m.month} className="p-3 rounded-xl bg-gray-50 text-center hover:bg-nebula-crimson/5 transition-colors">
                <div className="text-xs text-gray-400 font-medium">{m.month}</div>
                <div className="text-lg font-black text-nebula-crimson mt-1 tabular-nums">
                  {m.handicapHit}%
                </div>
                <div className="text-[10px] text-gray-400">{m.samples}场</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.byDepth.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
              <Layers className="w-4 h-4 text-nebula-crimson" />
            </div>
            <div>
               <h2 className="text-lg font-black tracking-tight text-foreground">预期净胜分档分布</h2>
               <p className="text-xs text-gray-400">Expected Spread Distribution</p>
            </div>
          </div>
          <div className="space-y-3">
            {data.byDepth.map((d) => (
              <div key={d.depth} className="flex items-center gap-4 py-2 border-b border-gray-100 last:border-0">
                <span className="text-sm font-semibold text-foreground w-24 shrink-0">{d.depth}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full bg-seq-3 rounded-full transition-all"
                    style={{ width: `${Math.min(100, d.hitRate)}%` }}
                  />
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-bold text-seq-3 tabular-nums">{d.hitRate}%</span>
                  <span className="text-[10px] text-gray-400">{d.samples}场</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex items-start gap-3 p-5 rounded-2xl bg-gray-50 border border-gray-100">
        <AlertCircle className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-gray-400 leading-relaxed">
          回测数据基于历史比赛结果统计，仅供模型参考，不代表未来表现
        </p>
      </div>
          </>
        )}
       </div>
     </div>
   );
};

export default BasketballBacktestPage;
