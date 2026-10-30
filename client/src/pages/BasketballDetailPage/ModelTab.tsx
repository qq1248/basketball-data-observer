import {
  ShieldCheck,
  Scale,
  Swords,
  HeartPulse,
  TrendingDown,
  Target,
  AlertTriangle,
  BarChart3,
  Activity,
  Zap,
  Gauge,
  Home,
  Dumbbell,
  Trophy,
  RotateCcw,
  Clock,
  History,
  Globe,
  Crown,
  Users,
  Medal,
  Target as TargetIcon,
  TrendingUp,
  ChevronRight,
  Flame,
  Filter,
  Shield,
  MinusCircle,
  PlusCircle,
  Equal,
  Anchor,
  Brain,
  LineChart,
  Layers,
  Lock,
  Lightbulb,
} from 'lucide-react';
import type { BasketballMatchItem, BasketballSubModelRef } from '@shared/api.interface';

interface ModelTabProps {
  match: BasketballMatchItem;
}

interface RuleInfo {
  code: string;
  name: string;
  direction: 'home' | 'away' | 'neutral';
  description: string;
  icon: typeof ShieldCheck;
}

const RULE_MAP: Record<string, Omit<RuleInfo, 'code'>> = {
  R1: {
    name: '基本面权重',
    direction: 'neutral',
    description: '综合排名/状态/进攻/防守四大维度加权计算，权重分别为0.2/0.35/0.25/0.2，是建模的核心基础。',
    icon: BarChart3,
  },
  R2: {
    name: '主客场调整',
    direction: 'home',
    description: '主队主场作战加成约2.5分，包含场地熟悉、球迷支持、旅途休整等因素；中立场则归零处理。',
    icon: Home,
  },
  R3: {
    name: '战意矩阵',
    direction: 'neutral',
    description: '根据赛事类型（常规赛/季后赛/杯赛/小组赛）调整战意权重，关键战役强队求胜欲望更高。',
    icon: Trophy,
  },
  R4: {
    name: '让分深度过滤',
    direction: 'neutral',
    description: '深指数（让10分以上）时反向降低过线概率，防范大热必死陷阱。让分越深，反向修正幅度越大。',
    icon: TrendingDown,
  },
  R5: {
     name: '总分基准',
    direction: 'neutral',
     description: '基于联赛基准分+双方进攻节奏调整总分基线，不同联赛有不同的基准总分。',
    icon: Activity,
  },
  R6: {
    name: '伤停影响',
    direction: 'away',
    description: '核心球员缺阵对球队攻防体系影响显著，主力缺阵胜率下降5%-15%不等。',
    icon: HeartPulse,
  },
  R7: {
    name: '赛程密度',
    direction: 'neutral',
    description: '背靠背或3天内2赛时，球队体能下降明显，比赛节奏变慢，小分概率上升。',
    icon: Clock,
  },
  R8: {
    name: 'H2H历史交锋',
    direction: 'neutral',
    description: '近5次交锋记录纳入模型，权重0.2并随时间衰减，近期交锋权重更高。',
    icon: History,
  },
  R9: {
    name: '大赛周期',
    direction: 'neutral',
    description: '国际比赛日/大赛年对球员状态的影响，国家队球员归队后状态存在波动期。',
    icon: Globe,
  },
  R10: {
    name: '决赛大分溢价',
    direction: 'neutral',
    description: '决赛级比赛双方进攻更积极，防守强度相对下降，大分概率有一定溢价。',
    icon: Crown,
  },
  R11: {
    name: '排位赛让分过滤',
    direction: 'neutral',
     description: '排位赛/无关痛痒比赛让分指数线参考价值下降，双方轮换幅度大，意外赛果率升高。',
    icon: Users,
  },
  R12: {
    name: '球队深度因子',
    direction: 'neutral',
    description: '板凳深度影响轮换后的战力保持，深度好的球队轮换后实力下降幅度小。',
    icon: Dumbbell,
  },
  R13: {
    name: '指数锚定',
    direction: 'neutral',
    description: '模型输出与市场指数线偏差超过10%时进行锚定调整，避免模型过度偏离。',
    icon: Target,
  },
  R14: {
    name: '阵容强度因子',
    direction: 'neutral',
    description: '基于首发阵容综合实力评估，包含球星质量、角色球员适配度等因素。',
    icon: ShieldCheck,
  },
  R15: {
    name: '出线轮换降速',
    direction: 'neutral',
    description: '小组赛已出线球队大幅轮换，比赛节奏下降，得分减少，小分概率上升。',
    icon: RotateCcw,
  },
  R16: {
    name: '胜分差区间分布',
    direction: 'neutral',
    description: '基于预期净胜分与标准差模拟胜分差正态分布，给出各分数段出现概率。',
    icon: Gauge,
  },
  R17: {
    name: 'WNBA季后赛节奏',
    direction: 'neutral',
    description: 'WNBA季后赛防守强度提升，比赛节奏变慢，得分下降，小分概率相对常规赛更高。',
    icon: Medal,
  },
  R18: {
    name: '核心球员使用率',
    direction: 'home',
    description: '核心球员使用率与球队战绩正相关，使用率过高存在疲劳风险，过低则进攻效率下降。',
    icon: TrendingUp,
  },
  R19: {
    name: '三分命中率波动',
    direction: 'neutral',
    description: '三分命中率是比赛最大变量之一，连续高/低命中率后存在回归均值倾向。',
    icon: TargetIcon,
  },
  R20: {
    name: '罚球命中率影响',
    direction: 'neutral',
    description: '罚球命中率影响总分和分差，关键时刻罚球稳定性决定比赛走向。',
    icon: ChevronRight,
  },
  R21: {
    name: '篮板球优势',
    direction: 'home',
    description: '篮板球优势转化为二次进攻机会和限制对手出手次数，篮板强队胜率显著更高。',
    icon: Scale,
  },
  R22: {
    name: '失误转化率',
    direction: 'neutral',
    description: '失误转化为快攻得分的比率，失误多的球队面对防守反击强队时失分明显增加。',
    icon: Zap,
  },
  R23: {
    name: '概率压缩校准',
    direction: 'neutral',
    description: '极端概率（>85%或<15%）使用系数0.75进行压缩校准，避免模型过度自信。',
    icon: AlertTriangle,
  },
  R24: {
    name: '大赛深指数过线律',
    direction: 'home',
    description: '亚运/世界杯等大赛深指数（让15分以上）强队过线率极高，弱队实力差距明显，慎用反向过滤。按让分线绝对值判定强队，主队让分或客队让分深指数均可正确触发。仅适用于亚运/世界杯等国际大赛，不适用于WNBA。',
    icon: Trophy,
  },
  R25: {
    name: '弱队意外赛果过滤',
    direction: 'neutral',
     description: '双方实力差距过大时（排名差>10位或让分>20），低排名意外赛果概率极低，直接采信强队让分。',
    icon: Shield,
  },
  R26: {
    name: 'WNBA浅指数强队过线加成',
    direction: 'home',
    description: 'WNBA浅指数（让分<5分）强队过线加成+8%，90场回测胜率68%。强队在浅指数下优势稳定，过线率高于深中指数。',
    icon: Home,
  },
  R27: {
    name: 'WNBA中深指数强队不过线倾向',
    direction: 'away',
    description: 'WNBA中深指数（让5-15分）强队不过线倾向-8%，90场回测中指数强队赢指数47%、深指数38%。强队领先后轮换导致赢指数不稳。',
    icon: TrendingDown,
  },
  R28: {
    name: 'WNBA超深指数强队不过线',
    direction: 'away',
    description: 'WNBA超深指数（让分>15分）强队不过线倾向-20%，90场回测过线率0%。WNBA超深指数强队领先后大幅轮换替补，赢球不赢指数是常态。',
    icon: Flame,
  },
  R29: {
    name: 'WNBA中指数小分倾向',
    direction: 'neutral',
    description: 'WNBA中指数（让分5-10分）轻微小分倾向-3%，90场回测大分率49%，接近随机。实力接近的比赛防守略强但不明显。',
    icon: MinusCircle,
  },
  R30: {
    name: 'WNBA深指数大分倾向',
    direction: 'neutral',
    description: 'WNBA深指数（让分>=10分）大分倾向+8%，90场回测大分率73%。强弱分明的比赛节奏快，得分普遍偏高。',
    icon: PlusCircle,
  },
  R31: {
    name: 'WNBA核心缺阵降分',
    direction: 'neutral',
    description: 'WNBA核心球员缺阵降低总分，每缺1名全明星预期总分-3分、大分概率-5%。90场回测显示伤病影响小于预期，角色球员有补位效应。',
    icon: HeartPulse,
  },
  R32: {
    name: 'WNBA赛季阶段调整',
    direction: 'neutral',
     description: '赛季阶段显著影响强队过线率：赛季初(5-6月)强队过线+10%（5月82%、6月76%），赛季末(8月+)强队不过线+15%（8月仅32%，强队轮休练兵）。总分也随月份波动：5月小分-8%、6月大分+5%。v5.6修正版新增战意分化：强队仍有排名压力时衰减减半(-7%)，已锁定/淘汰才完全衰减(-15%)。',
    icon: Clock,
  },
   R33: {
     name: '长间歇揭幕战',
     direction: 'neutral',
     description: '赛季揭幕战或休赛长间歇回归首战，球队防守生疏、配合默契度下降，深指数总分上调减半+3分。',
     icon: PlusCircle,
   },
   R39: {
     name: '低信心双选提示',
     direction: 'neutral',
     description: '双方胜率差距较小（<10%），比赛结果不确定性较高，标注为低信心场次，建议双选或观望。',
     icon: AlertTriangle,
   },
   R40: {
     name: '联赛基准线',
     direction: 'neutral',
       description: '基于联赛历史平均水平设定基准总分，作为总分建模的基线参考。不同联赛因节奏、防守强度差异基准分不同。',
     icon: Activity,
   },
 };

function resolveRule(code: string): (Omit<RuleInfo, 'code'> & { displayName: string }) | null {
  const info = RULE_MAP[code];
  if (info) return { ...info, displayName: info.name };
  if (code.startsWith('R39')) {
    return { ...RULE_MAP.R39, displayName: RULE_MAP.R39.name };
  }
  if (code.startsWith('R40 联赛基准：')) {
    const val = code.replace('R40 联赛基准：', '');
    return { ...RULE_MAP.R40, displayName: `联赛基准：${val}` };
  }
  if (code === 'R40a 深盘档位（≥10分）') {
    return { name: '深指数档位', direction: 'neutral', description: '让分≥10分属于深指数档位，双方实力差距较大，强队赢面高但需警惕赢球不赢指数。', icon: TrendingDown, displayName: '深指数档位（≥10分）' };
  }
  if (code === 'R40b 中盘档位（5-10分）') {
     return { name: '中指数档位', direction: 'neutral', description: '让分5-10分属于中指数档位，双方有一定实力差距但悬念尚存，是模型稳定性较高的区间。', icon: MinusCircle, displayName: '中指数档位（5-10分）' };
  }
  if (code === 'R40c 浅盘档位（<5分）') {
     return { name: '浅指数档位', direction: 'neutral', description: '让分<5分属于浅指数档位，双方实力接近，意外赛果概率相对较高，需结合伤停和战意综合判断。', icon: Equal, displayName: '浅指数档位（<5分）' };
  }
  if (code === 'R40d 强队主场加持') {
    return { ...RULE_MAP.R2, displayName: '强队主场加持' };
  }
  return null;
}

const directionLabelMap: Record<RuleInfo['direction'], { text: string; color: string; bg: string }> = {
  home: { text: '利好主队', color: 'hsl(358 78% 47%)', bg: 'hsl(358 80% 96%)' },
  away: { text: '利好客队', color: 'hsl(213 74% 48%)', bg: 'hsl(213 80% 96%)' },
  neutral: { text: '中性调整', color: 'hsl(28 85% 55%)', bg: 'hsl(28 85% 55% / 0.12)' },
};

const probSources = [
  {
    title: '胜负概率',
    icon: BarChart3,
    color: 'hsl(358 78% 47%)',
    description: '基于球队实力评级 + 主客场优势 + 伤病影响 + 战意因素加权计算，辅以近10场状态调整。',
  },
  {
    title: '让分概率',
    icon: Activity,
    color: 'hsl(28 85% 55%)',
    description: '基于胜负概率推导预期净胜分，结合指数线深度与历史指数线赢指数率调整模型输出。',
  },
  {
     title: '总分概率',
    icon: Zap,
    color: 'hsl(213 74% 48%)',
     description: '基于双方场均得分/失分 + 进攻节奏 + 伤病对得分的影响 + 历史对阵总分倾向综合判断。',
  },
  {
    title: '胜分差分布',
    icon: Gauge,
    color: 'hsl(212 15% 45%)',
    description: '基于预期净胜分与标准差进行正态分布模拟，得出各分数段出现概率。',
  },
];

function getConfidenceBreakdown(confidence: number) {
  // 根据信心度数值反推分项评分（近似展示）
  const strengthCertainty = Math.min(100, Math.round(confidence * 1.1));
  const injuryImpact = confidence >= 80 ? '低' : confidence >= 60 ? '中' : '高';
  const moraleFactor = confidence >= 75 ? '明确' : '模糊';
  const lineRationality = Math.abs(confidence - 70) < 20 ? '合理' : '偏离';

  return { strengthCertainty, injuryImpact, moraleFactor, lineRationality };
}

export default function ModelTab({ match }: ModelTabProps) {
  const triggeredRules: RuleInfo[] = Array.from(new Set(match.modelRules ?? []))
    .map((code: string) => {
      const resolved = resolveRule(code);
      if (resolved) {
        return { code, name: resolved.displayName, direction: resolved.direction, description: resolved.description, icon: resolved.icon };
      }
      return { code, name: code, direction: 'neutral' as const, description: code, icon: Brain };
    })

  const breakdown = getConfidenceBreakdown(match.confidence);

  const subModels: BasketballSubModelRef[] = match.subModels ?? [];
  const hasAnchor = match.predictionAnchor === 'spread_anchored';
  const engineVersion = match.predEngineVersion || '';

  const subModelIconMap: Record<BasketballSubModelRef['key'], typeof Anchor> = {
    spread_anchor: Anchor,
    elo: Brain,
    kalman: LineChart,
    pace_rating: Activity,
    model_reference: Lightbulb,
  };

  const subModelRoleLabel: Record<BasketballSubModelRef['role'], string> = {
    anchor: '主模型/锚定',
    reference: '参考模型',
    fallback: '兜底模型',
  };

  return (
    <div className="space-y-3">
      {/* 区块0：引擎版本与锚定方式 */}
       <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
         <div className="flex items-center gap-2 mb-3">
           <span className="w-1 h-4 rounded-full bg-orange-400 md:bg-basketball-orange" />
            <span className="text-sm font-semibold text-[var(--foreground)] md:text-foreground">模型引擎</span>
           {engineVersion && (
             <span className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded-full bg-orange-400/15 text-orange-400 md:bg-basketball-orange/10 md:text-basketball-orange">
              {engineVersion}
            </span>
          )}
        </div>
         <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] md:text-muted-foreground">
           <Anchor className="w-4 h-4 text-orange-400 md:text-basketball-orange" />
          <span>
            {hasAnchor
               ? '指数锚定模式：以市场让分线为最强模型信号，ELO、卡尔曼仅作参考不改变方向'
              : match.predictionAnchor === 'no_line_fallback'
                ? '无指数线兜底模式：ELO + 卡尔曼等权估计，最高中信心'
                : '传统启发式模式'}
          </span>
        </div>
         {match.injuryAdjustApplied != null && match.injuryAdjustApplied !== 0 && (
           <div className="mt-2 text-[11px] text-[var(--muted-foreground)] md:text-muted-foreground flex items-center gap-1.5">
            <HeartPulse className="w-3.5 h-3.5 text-amber-600" />
            <span>
              伤停修正：预期净胜分调整 {match.injuryAdjustApplied > 0 ? '+' : ''}
              {match.injuryAdjustApplied.toFixed(1)} 分，
              胜负概率修正 {match.injuryAdjustPct ?? 0 > 0 ? '+' : ''}
              {match.injuryAdjustPct ?? 0}%（上限±8%）
            </span>
          </div>
        )}
      </div>

      {/* 区块0.5：子模型参考 */}
      {subModels.length > 0 ? (
         <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
           <div className="text-sm font-semibold mb-3 flex items-center gap-2 text-[var(--foreground)] md:text-foreground">
             <span className="w-1 h-4 rounded-full bg-blue-400 md:bg-primary" />
             子模型参考
             <span className="text-[10px] font-normal text-[var(--muted-foreground)] md:text-muted-foreground ml-auto">
              仅参考 / 不改变指数线方向
            </span>
          </div>
          <div className="space-y-3">
            {subModels.map((sm) => {
              const Icon = subModelIconMap[sm.key] || Layers;
              const maxP = Math.max(sm.homeWinProb, sm.awayWinProb);
              return (
                 <div key={sm.key} className="p-3 rounded-lg border border-[var(--border)]/60 bg-[var(--secondary)] md:border-border md:bg-background/40">
                   <div className="flex items-center gap-2 mb-2">
                     <div className="w-8 h-8 rounded-md flex items-center justify-center bg-blue-500/15 md:bg-primary/10">
                       <Icon className="w-4 h-4 text-blue-400 md:text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                       <div className="text-sm font-medium text-[var(--foreground)] md:text-foreground flex items-center gap-1.5">
                         {sm.label}
                         <span className="text-[10px] px-1.5 py-px rounded bg-[var(--card)] text-slate-400 md:bg-muted md:text-muted-foreground">
                          {subModelRoleLabel[sm.role]}
                        </span>
                      </div>
                       <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground truncate">
                        {sm.note}
                      </div>
                    </div>
                     <div className="text-right flex-shrink-0">
                       <div className="text-sm font-bold font-mono text-[var(--foreground)] md:text-foreground">
                        {sm.predictionDirection}
                      </div>
                       <div className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground">
                        {maxP}%
                      </div>
                    </div>
                  </div>
                   <div className="w-full h-1.5 rounded-full bg-blue-500/10 md:bg-muted overflow-hidden flex">
                    <div
                      className="h-full bg-home-win transition-all"
                      style={{ width: `${sm.homeWinProb}%` }}
                    />
                    <div
                      className="h-full bg-away-win transition-all"
                      style={{ width: `${sm.awayWinProb}%` }}
                    />
                  </div>
                   <div className="flex justify-between text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground mt-1">
                    <span>主胜 {sm.homeWinProb}%</span>
                    <span>客胜 {sm.awayWinProb}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
         <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
           <div className="text-sm font-semibold mb-2 flex items-center gap-2 text-[var(--foreground)] md:text-foreground">
             <span className="w-1 h-4 rounded-full bg-slate-500 md:bg-muted-foreground/30" />
             子模型参考
             <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-[var(--secondary)] md:bg-muted md:text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              历史数据
            </span>
          </div>
           <p className="text-xs text-[var(--muted-foreground)] md:text-muted-foreground leading-relaxed">
             该场为历史比赛，使用 v7.x 启发式模型生成。子模型参考（指数锚定 / ELO / 卡尔曼）仅 v9.0+ 引擎下提供，当前比赛模型输出已固化不回溯重算。
          </p>
        </div>
      )}

       {/* 区块0.8：高阶数据状态 */}
       <div className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
         <div className="text-sm font-semibold mb-2 flex items-center gap-2 text-[var(--foreground)] md:text-foreground">
           <span className="w-1 h-4 rounded-full bg-slate-500 md:bg-muted-foreground/30" />
           四要素 / 效率模型
           <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-[var(--secondary)] md:bg-muted md:text-muted-foreground flex items-center gap-1">
            <Lock className="w-3 h-3" />
            待接入
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
           {match.advancedDataNotice || '高阶数据（进攻效率、防守效率、节奏、有效命中率、失误率、篮板率等四要素）需要 boxscore 高阶数据接入后启用。当前版本仅基于指数锚定 + 场均得分 + 伤停情报 建模，暂不展示假数值。'}
        </p>
      </div>

      {/* 区块1：触发的模型规则 */}
      {triggeredRules.length > 0 && (
         <div
           className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
         >
           <div className="text-sm font-semibold mb-3 flex items-center gap-2 text-[var(--foreground)] md:text-foreground">
             <span className="w-1 h-4 rounded-full bg-orange-400 md:bg-basketball-orange" />
             触发的模型规则
             <span
               className="text-xs font-normal ml-auto px-2 py-0.5 rounded-full text-orange-400 bg-orange-400/10 md:text-basketball-orange md:bg-basketball-orange/10"
             >
              共 {triggeredRules.length} 条
            </span>
             {engineVersion && (
               <span className="text-[10px] font-mono text-[var(--muted-foreground)] md:text-muted-foreground ml-1">
                {engineVersion}
              </span>
            )}
          </div>

          <div className="space-y-3">
            {triggeredRules.map((rule) => {
              const Icon = rule.icon;
              const dir = directionLabelMap[rule.direction];
              return (
                  <div
                    key={rule.code}
                    className="flex gap-3 p-3 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg flex flex-col items-center justify-center bg-orange-400/15 md:bg-basketball-orange/10">
                      <Icon className="w-4 h-4 mb-0.5 text-orange-400 md:text-basketball-orange" />
                      <span className="text-[10px] font-mono font-semibold text-orange-400 md:text-basketball-orange">
                      {rule.code}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                     <div className="flex items-center gap-2 mb-1">
                       <span className="text-sm font-medium text-[var(--foreground)] md:text-foreground">
                        {rule.name}
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: dir.bg, color: dir.color }}
                      >
                        {dir.text}
                      </span>
                    </div>
                     <p className="text-xs leading-relaxed text-[var(--muted-foreground)] md:text-muted-foreground">
                      {rule.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

       {/* 区块2：概率来源说明 */}
       <div
         className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
       >
         <div className="text-sm font-semibold mb-3 flex items-center gap-2 text-[var(--foreground)] md:text-foreground">
           <span className="w-1 h-4 rounded-full bg-blue-400 md:bg-primary" />
           概率来源说明
        </div>
        <div className="space-y-3">
          {probSources.map((source) => {
            const Icon = source.icon;
            return (
                <div
                  key={source.title}
                  className="flex gap-3 p-3 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
                >
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--secondary)] md:bg-muted">
                  <Icon className="w-4 h-4" style={{ color: source.color }} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--foreground)] md:text-foreground mb-1">
                    {source.title}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {source.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

       {/* 区块3：信心度评分依据 */}
       <div
         className="rounded-xl p-4 border border-[var(--border)] bg-[var(--card)] md:border-border md:bg-card md:shadow-sm"
       >
         <div className="text-sm font-semibold mb-4 flex items-center gap-2 text-[var(--foreground)] md:text-foreground">
           <span className="w-1 h-4 rounded-full bg-orange-400 md:bg-basketball-orange" />
           信心度评分依据
        </div>

         {/* 大数字信心度 */}
         <div className="flex items-center gap-4 mb-4 p-4 rounded-lg bg-[var(--secondary)] md:bg-muted/30">
          <div className="relative flex-shrink-0">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
              <circle
                cx="40"
                cy="40"
                r="34"
                fill="none"
                stroke="hsl(214 20% 88%)"
                strokeWidth="6"
              />
               <circle
                 cx="40"
                 cy="40"
                 r="34"
                 fill="none"
                 stroke="hsl(358 78% 47%)"
                 strokeWidth="6"
                 strokeLinecap="round"
                 strokeDasharray={`${(match.confidence / 100) * 213.6} 213.6`}
               />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
               <span className="text-xl font-bold font-mono text-[var(--foreground)] md:text-foreground">
                {match.confidence}
              </span>
               <span className="text-[10px] text-[var(--muted-foreground)] md:text-muted-foreground">
                信心度
              </span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
             <div className="text-sm text-[var(--foreground)]/80 md:text-foreground/80 mb-2">综合信心度评分</div>
             <p className="text-xs leading-relaxed text-[var(--muted-foreground)] md:text-muted-foreground">
               综合实力确定性、伤病影响、战意因素与指数线合理性四项加权得出，分数越高模型可靠性越强。
            </p>
          </div>
        </div>

        {/* 分项评分 */}
        <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
             <div className="text-xs mb-2 text-[var(--muted-foreground)] md:text-muted-foreground">
              实力确定性
            </div>
            <div className="flex items-end gap-2">
               <span className="text-xl font-bold font-mono text-home-win">
                 {breakdown.strengthCertainty}
               </span>
               <span className="text-xs mb-1 text-[var(--muted-foreground)] md:text-muted-foreground">/ 100</span>
            </div>
             <div className="mt-2 h-1 rounded-full overflow-hidden bg-blue-500/10 md:bg-muted">
              <div
                className="h-full rounded-full"
                 style={{
                   width: `${breakdown.strengthCertainty}%`,
                   backgroundColor: 'hsl(358 78% 47%)',
                 }}
              />
            </div>
          </div>

            <div className="p-3 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
             <div className="text-xs mb-2 text-[var(--muted-foreground)] md:text-muted-foreground">
              伤病影响
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-lg font-semibold"
                style={{
                   color:
                     breakdown.injuryImpact === '低'
                       ? 'hsl(358 78% 47%)'
                       : breakdown.injuryImpact === '中'
                         ? 'hsl(28 85% 55%)'
                         : 'hsl(358 70% 40%)',
                }}
              >
                {breakdown.injuryImpact}
              </span>
            </div>
             <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted-foreground)] md:text-muted-foreground">
               主力缺阵对模型的干扰程度
            </p>
          </div>

            <div className="p-3 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
             <div className="text-xs mb-2 text-[var(--muted-foreground)] md:text-muted-foreground">
              战意因素
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-lg font-semibold"
                style={{
                   color:
                     breakdown.moraleFactor === '明确'
                       ? 'hsl(358 78% 47%)'
                       : 'hsl(28 85% 55%)',
                }}
              >
                {breakdown.moraleFactor}
              </span>
            </div>
             <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted-foreground)] md:text-muted-foreground">
              双方战意是否清晰可量化
            </p>
          </div>

            <div className="p-3 rounded-lg border border-[var(--border)]/60 bg-[var(--card)] md:border-border md:bg-card md:shadow-sm">
             <div className="text-xs mb-2 text-[var(--muted-foreground)] md:text-muted-foreground">
              指数线合理性
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-lg font-semibold"
                style={{
                   color:
                     breakdown.lineRationality === '合理'
                       ? 'hsl(358 78% 47%)'
                       : 'hsl(358 70% 40%)',
                }}
              >
                {breakdown.lineRationality}
              </span>
            </div>
             <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted-foreground)] md:text-muted-foreground">
              市场指数线与模型预期吻合度
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
