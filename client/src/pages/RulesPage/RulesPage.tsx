import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Target,
  AlertCircle,
  BarChart3,
  ChevronDown,
  ChevronUp,
  TrendingUp,
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { modelRulesApi } from '@client/src/api';
import type { ModelRulesResponse, ModelRuleDetail } from '@shared/api.interface';
import { ErrorState } from '@client/src/components/ui/error-state';
import { normalizeRatio } from '@client/src/utils/format';

const CATEGORIES = [
  '全部',
  '基础规则',
  'v5升级',
  '平局优化',
  '让分优化',
  'v5.17',
  'v5.18',
  'v5.19',
  'v5.20',
  '联赛专项',
  '杯赛与洲际',
] as const;

type CategoryKey = (typeof CATEGORIES)[number];

const getCategory = (ruleCode: string, category: string): CategoryKey => {
  // 优先使用后端返回的 category 字段（如果已存在对应中文名）
  if (category) {
    const mapped = CATEGORIES.find((c) => c === category);
    if (mapped) return mapped;
  }
  const match = ruleCode.match(/^R(\d+)$/);
  if (!match) return '基础规则';
  const num = parseInt(match[1], 10);
  if (num >= 1 && num <= 9) return '基础规则';
  if (num >= 10 && num <= 20) return 'v5升级';
  if (num >= 21 && num <= 30) return '平局优化';
   if (num >= 31 && num <= 39) return '让分优化';
  if (num >= 40 && num <= 42) return 'v5.17';
  if (num >= 43 && num <= 46) return 'v5.18';
  if (num >= 47 && num <= 50) return 'v5.19';
  if (num >= 51 && num <= 56) return 'v5.20';
  return '基础规则';
};

const RulesPage = () => {
  const [data, setData] = useState<ModelRulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('全部');
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({});

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await modelRulesApi.getModelRules();
      setData(response);
    } catch (err) {
      logger.warn('获取模型规则失败', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const toggleRuleExpand = (ruleId: string) => {
    setExpandedRules((prev) => ({ ...prev, [ruleId]: !prev[ruleId] }));
  };

  const filteredRules = useMemo(() => {
    if (!data) return [];
    if (activeCategory === '全部') return data.rules;
    return data.rules.filter((rule: ModelRuleDetail) =>
      getCategory(rule.ruleCode, rule.category) === activeCategory,
    );
  }, [data, activeCategory]);

  const triggerChartData = useMemo(() => {
    if (!data) return { codes: [], counts: [], names: [] };
    const sorted = [...data.rules]
      .sort((a: ModelRuleDetail, b: ModelRuleDetail) => b.sampleSize - a.sampleSize)
      .slice(0, 15);
    return {
      codes: sorted.map((r: ModelRuleDetail) => r.ruleCode),
      counts: sorted.map((r: ModelRuleDetail) => r.sampleSize),
      names: sorted.map((r: ModelRuleDetail) => r.ruleName),
    };
  }, [data]);

  const triggerChartOption: EChartsOption = {
    color: ['#8B0000', '#A52A2A', '#CD5C5C', '#E9967A', '#FFA07A'],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#FFFFFF',
      borderColor: '#F3F4F6',
      borderWidth: 1,
      textStyle: { color: '#111827', fontSize: 12 },
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params];
        const idx = list[0].dataIndex as number;
        const name = triggerChartData.names[idx];
        const code = triggerChartData.codes[idx];
        const value = triggerChartData.counts[idx];
        return `${code} ${name}<br/>触发次数: <b>${value}</b> 次`;
      },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: triggerChartData.codes,
      axisLabel: {
        rotate: 45,
        fontSize: 10,
        color: '#9CA3AF',
      },
      axisLine: { lineStyle: { color: '#F3F4F6' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '触发次数',
      nameTextStyle: { fontSize: 10, color: '#9CA3AF' },
      axisLabel: { fontSize: 10, color: '#9CA3AF' },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#F3F4F6', type: 'dashed' } },
    },
    series: [
      {
        type: 'bar',
        data: triggerChartData.counts,
        barMaxWidth: 24,
        itemStyle: {
          borderRadius: [6, 6, 0, 0],
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#8B0000' },
              { offset: 1, color: '#CD5C5C' },
            ],
          },
        },
      },
    ],
  };

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <ErrorState
            size="lg"
            message="加载失败"
            description="规则数据加载失败，请稍后重试"
            onRetry={fetchRules}
          />
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 md:py-16 space-y-8">
          <div className="space-y-3 animate-pulse">
            <div className="h-3 w-28 bg-muted rounded" />
            <div className="h-10 w-52 bg-muted rounded" />
            <div className="h-4 w-80 bg-muted rounded" />
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-6 space-y-4 animate-pulse shadow-sm">
            <div className="h-5 w-32 bg-muted rounded" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="h-20 bg-muted/50 rounded-xl" />
              <div className="h-20 bg-muted/50 rounded-xl" />
              <div className="h-20 bg-muted/50 rounded-xl" />
              <div className="h-20 bg-muted/50 rounded-xl" />
            </div>
          </div>
          <div className="h-10 w-full bg-muted/50 rounded-full animate-pulse" />
          <div className="h-[280px] bg-white border border-gray-100 rounded-2xl animate-pulse shadow-sm" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-2xl p-5 space-y-2 animate-pulse shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="h-5 w-14 bg-muted rounded" />
                  <div className="h-5 w-32 bg-muted rounded" />
                </div>
                <div className="h-4 w-full bg-muted rounded" />
                <div className="h-4 w-3/4 bg-muted rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const { rules, disclaimer, hitRate } = data;

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-12 md:py-16">
        {/* Hero */}
        <div className="mb-12 md:mb-16">
          <div className="eyebrow eyebrow-line mb-3">Model Rules Center</div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-foreground mb-3">
            模型规则中心
          </h1>
          <p className="text-sm md:text-base text-gray-400 leading-relaxed max-w-2xl">
            {rules.length} 条核心规则 · 累计 {hitRate.sampleSize} 场回测样本 · 持续迭代优化的模型引擎
          </p>
        </div>

        {/* Overview metric card */}
        <div className="metric-card p-6 md:p-8 mb-8" data-ai-section-type="card-stat">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-10 h-10 rounded-xl bg-nebula-crimson/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-nebula-crimson" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight text-foreground">模型概览</h2>
              <p className="text-xs text-gray-400">Model Overview</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-gray-50">
              <div className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">规则总数</div>
              <div className="text-3xl font-black text-nebula-crimson tracking-tight tabular-nums">
                {rules.length}
              </div>
              <div className="text-[10px] text-gray-400 mt-1">Total Rules</div>
            </div>
            <div className="p-4 rounded-xl bg-gray-50">
              <div className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">累计样本</div>
              <div className="text-3xl font-black text-nebula-crimson tracking-tight tabular-nums">
                {hitRate.sampleSize}
              </div>
              <div className="text-[10px] text-gray-400 mt-1">Total Samples</div>
            </div>
            <div className="p-4 rounded-xl bg-gray-50">
               <div className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">胜负模型准确率</div>
              <div className="text-3xl font-black text-nebula-crimson tracking-tight tabular-nums">
                {Math.round(hitRate.winDrawWin * 100)}%
              </div>
              <div className="text-[10px] text-gray-400 mt-1">WDW Hit</div>
            </div>
            <div className="p-4 rounded-xl bg-gray-50">
                <div className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">总分模型准确率</div>
              <div className="text-3xl font-black text-seq-3 tracking-tight tabular-nums">
                {Math.round(hitRate.overUnder * 100)}%
              </div>
              <div className="text-[10px] text-gray-400 mt-1">OU Hit</div>
            </div>
          </div>
        </div>

        {/* Notice */}
        <div className="mb-8 flex items-start gap-3 p-5 rounded-2xl bg-gray-50 border border-gray-100">
          <AlertCircle className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-gray-400 leading-relaxed">
            回测统计接入中，当前仅展示规则列表与触发逻辑。真实回测数据将在后续版本上线。
          </p>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide mb-8 -mx-4 px-4 md:mx-0 md:px-0">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${  activeCategory === cat
                  ? 'bg-nebula-crimson text-white shadow-lg shadow-nebula-crimson/20'
                  : 'bg-white text-gray-400 border border-gray-100 hover:border-nebula-crimson/30 hover:text-foreground'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Trigger chart */}
        {rules.length > 0 && (
          <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 mb-8">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-nebula-crimson" />
              </div>
              <div>
                <h2 className="text-lg font-black tracking-tight text-foreground">规则触发统计</h2>
                <p className="text-xs text-gray-400">Top 15 Rule Triggers</p>
              </div>
            </div>
            <ReactECharts option={triggerChartOption} className="w-full h-[300px]" />
          </div>
        )}

        {/* Rule list */}
        <div>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-nebula-crimson/10 flex items-center justify-center">
                <Target className="w-4 h-4 text-nebula-crimson" />
              </div>
              <h2 className="text-xl font-black tracking-tight text-foreground">规则列表</h2>
            </div>
            <span className="text-xs text-gray-400">共 {filteredRules.length} 条</span>
          </div>

          <div className="space-y-4" data-ai-section-type="card-list">
            {filteredRules.length > 0 ? (
              filteredRules.map((rule: ModelRuleDetail) => {
                const isExpanded = expandedRules[rule.id];
                const hitRatePercent = normalizeRatio(rule.hitRate) * 100;
                return (
                  <div
                    key={rule.id}
                    className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-nebula-crimson/5 hover:-translate-y-0.5 group"
                  >
                    <button
                      onClick={() => toggleRuleExpand(rule.id)}
                      className="w-full p-5 flex flex-col gap-3 text-left hover:bg-gray-50/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="px-2.5 py-1 rounded-lg bg-nebula-crimson/10 text-nebula-crimson text-xs font-mono font-bold flex-shrink-0">
                            {rule.ruleCode}
                          </span>
                          <span className="text-base font-bold text-foreground truncate tracking-tight">
                            {rule.ruleName}
                          </span>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0 group-hover:text-nebula-crimson transition-colors" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0 group-hover:text-nebula-crimson transition-colors" />
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-nebula-crimson/10 text-nebula-crimson border border-nebula-crimson/20">
                            {rule.category}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                           <span className="text-[10px] text-gray-400">模型准确率</span>
                          <span className="text-sm font-mono font-bold text-nebula-crimson tabular-nums">
                            {hitRatePercent.toFixed(1)}%
                          </span>
                        </div>
                      </div>

                      <p className="text-sm text-gray-400 line-clamp-2 leading-relaxed">
                        {rule.triggerCondition}
                      </p>

                      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full progress-gradient rounded-full transition-all duration-700 ease-out"
                          style={{ width: `${Math.min(100, hitRatePercent)}%` }}
                        />
                      </div>

                      <div className="text-[10px] text-gray-400">
                        样本数：{rule.sampleSize} 场
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-5 pb-5 border-t border-gray-100 bg-gray-50/50">
                        <div className="pt-4 space-y-4">
                          <div>
                            <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">触发条件</div>
                            <p className="text-sm text-foreground leading-relaxed">
                              {rule.triggerCondition}
                            </p>
                          </div>
                          {rule.impactFormula && (
                            <div>
                              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">影响公式</div>
                              <code className="block text-xs text-nebula-crimson bg-nebula-crimson/5 p-3 rounded-lg font-mono border border-nebula-crimson/10">
                                {rule.impactFormula}
                              </code>
                            </div>
                          )}
                          {rule.params && rule.params.length > 0 && (
                            <div>
                              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">参数说明</div>
                              <div className="flex flex-wrap gap-1.5">
                                {rule.params.map((p, idx) => (
                                  <span
                                    key={idx}
                                    className="px-2.5 py-1 rounded-lg text-[11px] bg-white text-gray-500 font-mono border border-gray-100"
                                  >
                                    {p}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {rule.description && (
                            <div>
                              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1.5">详细描述</div>
                              <p className="text-sm text-foreground/80 leading-relaxed">
                                {rule.description}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-10 text-center">
                <Target className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                <p className="text-base font-semibold text-foreground mb-1">暂无规则</p>
                <p className="text-sm text-gray-400">该分类下暂无匹配规则</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-gray-100">
          <div className="flex items-start gap-3 p-5 rounded-2xl bg-gray-50 border border-gray-100">
            <AlertCircle className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-400 leading-relaxed">{disclaimer}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RulesPage;
