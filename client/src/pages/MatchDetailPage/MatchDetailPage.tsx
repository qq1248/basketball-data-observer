import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { LiveStatusBar } from '@client/src/components/LiveStatusBar';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Star,
  StarOff,
  TrendingUp,
  Target,
  AlertTriangle,
  Info,
  Clock,
  Timer,
  ChevronDown,
  ChevronUp,
  Activity,
  Swords,
  History,
  TrendingDown,
  Zap,
  Users,
  Lightbulb,
  User,
  ShieldCheck,
  BarChart3,
  CloudSun,
  RefreshCw,
  Crosshair,
  Trophy,
  Minus as MinusIcon,
  ArrowUpRight,
  ArrowDownRight,
  Newspaper,
  Database,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import ErrorBoundary from '@client/src/components/ErrorBoundary';
import DeepAnalysisTab from './DeepAnalysisTab';
import IntelSections from './IntelSections';
import { matchesApi, predictionRecordsApi, injuriesApi } from '@client/src/api';
import { useSyncStore } from '@client/src/hooks/useSyncStore';
import { useMatchDetailCache } from '@client/src/hooks/useMatchDetailCache';
import type {
  MatchItem,
  InjuryItem,
  MatchInjuriesResponse,
  MatchOddsResponse,
  TotalGoalsProbItem,
  HalfFullProbItem,
  OddsTrendResponse,
  MatchMultiSourceResponse,
  MatchSourceOdds,
} from '@shared/api.interface';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { computeMatchStatus, MATCH_STATUS_TEXT } from '@client/src/utils/format';
import type { ComputedMatchStatus } from '@client/src/utils/format';
import {
  formatBeijingTime,
  isNextDayEarlyMorning,
  formatRelativeSeconds,
  formatLiveScoreSource,
  formatCountdown,
} from '@client/src/utils/format-beijing-time';
import MatchTimestamps from './MatchTimestamps';
import { isPlaceholder } from '@client/src/utils/data-quality';

function safeText(value: unknown): string {
   if (value == null) return '';
   if (typeof value === 'string') return value;
   if (typeof value === 'number' || typeof value === 'boolean') return String(value);
   if (typeof value === 'object') {
     try {
       return JSON.stringify(value, null, 2);
     } catch {
       return String(value);
     }
   }
   return String(value);
 }

function hasValue(v: unknown): boolean {
  return v != null && typeof v === 'string' && v.trim().length > 0;
}

function normalizeIntelValue(v: string): string {
  if (PLACEHOLDER_PATTERNS.test(v.trim())) return '暂无可靠数据';
  return v;
}

interface ParsedKeyPlayer {
  name: string;
  position?: string;
  goals?: number;
  assists?: number;
  rating?: number;
  note?: string;
  [key: string]: unknown;
}

const PLACEHOLDER_PATTERNS = /(采集中|待采集|暂无数据|数据收集中|情报收集中|采集中...|加载中|等待中|暂无情报|ESPN 数据源|ESPN数据源)/i;

const CLICHE_KEYWORDS = [
  '整体实力碾压',
  '主场攻击力强劲',
  '深指数下仍具备过线能力',
  '客场作战能力不俗',
  '近期状态火热',
  '防守端表现出色',
  '两队实力相当',
  '主场优势明显',
  '客场表现一般',
];

function getDataSourceLabel(match: MatchItem): string | null {
  const src = match.source;
  if (src && typeof src === 'string' && src.trim()) {
    const upper = src.trim().toUpperCase();
    if (upper.includes('ESPN')) return 'ESPN';
    if (upper.includes('SPORTTERY')) return '竞彩官方';
    if (upper.includes('QIUMIBAO')) return '球美宝';
    return src.trim();
  }
  return null;
}

function isUnreliableIntel(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_PATTERNS.test(trimmed)) return true;
  if (trimmed.length < 60) return true;
  return CLICHE_KEYWORDS.some((kw) => trimmed.includes(kw));
}

function parseKeyPlayers(raw: string | undefined | null): ParsedKeyPlayer[] | string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (PLACEHOLDER_PATTERNS.test(trimmed)) return null;
  if (trimmed.length < 4) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((p: Record<string, unknown>) => ({
        name: String(p.name ?? p.playerName ?? p.player_name ?? '未知球员'),
        position: p.position != null ? String(p.position) : undefined,
        goals: p.goals != null ? Number(p.goals) : undefined,
        assists: p.assists != null ? Number(p.assists) : undefined,
        rating: p.rating != null ? Number(p.rating) : undefined,
        note: p.note != null ? String(p.note) : undefined,
      }));
    }
    if (typeof parsed === 'object' && parsed !== null) {
      return raw;
    }
  } catch {
  }
  return raw;
}

function getPlayerBadges(player: ParsedKeyPlayer, allPlayers: ParsedKeyPlayer[]): string[] {
  const badges: string[] = [];
  const goalsValues = allPlayers.map((p) => p.goals ?? 0).filter((v) => v > 0);
  const assistsValues = allPlayers.map((p) => p.assists ?? 0).filter((v) => v > 0);
  const ratingValues = allPlayers.map((p) => p.rating ?? 0).filter((v) => v > 0);
  const maxGoals = goalsValues.length > 0 ? Math.max(...goalsValues) : 0;
  const maxAssists = assistsValues.length > 0 ? Math.max(...assistsValues) : 0;
  const maxRating = ratingValues.length > 0 ? Math.max(...ratingValues) : 0;
  if (maxGoals > 0 && (player.goals ?? 0) === maxGoals) badges.push('射手王');
  if (maxAssists > 0 && (player.assists ?? 0) === maxAssists) badges.push('助攻王');
  if (maxRating > 0 && (player.rating ?? 0) === maxRating) badges.push('评分王');
  return badges;
}

/**
 * 归一化概率值为 0-1 的小数，兼容两种输入：
 * - 0-100 整数（如 15、55）：v > 1 → 除以 100
 * - 0-1 小数（如 0.15、0.55）：v <= 1 → 保持原值
 * undefined / null / NaN → 0
 */
function toProbFloat(v: number | undefined | null): number {
  if (v == null || isNaN(v)) return 0;
  return v > 1 ? v / 100 : v;
}

/** 格式化为整数百分数字符串，如 15%、55% */
function formatProb(v: number | undefined | null): string {
  return `${Math.round(toProbFloat(v) * 100)}%`;
}

/** 格式化为带一位小数的百分数字符串，如 15.0%、55.2% */
function formatProbFixed(v: number | undefined | null, digits: number = 1): string {
  return `${(toProbFloat(v) * 100).toFixed(digits)}%`;
}

/**
 * 防御式概率百分比解析：NaN / null / undefined / 非正数 → null
 * 用于半全场等可能缺失数据的概率展示
 */
function toProbPct(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const DIRECTION_STYLES: Record<string, string> = {
  主胜: 'bg-nebula-crimson text-white',
  平: 'bg-nebula-crimson/80 text-white',
  客胜: 'bg-red-900 text-white',
  观望: 'bg-gray-200 text-gray-500',
};

const IMPACT_COLORS: Record<string, string> = {
  low: 'text-home-win bg-home-win/10 border-home-win/30',
  medium: 'text-draw bg-draw/10 border-draw/30',
  high: 'text-warning bg-warning/10 border-warning/30',
  critical: 'text-away-win bg-away-win/10 border-away-win/30',
};

const IMPACT_LABELS: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
};

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  upcoming: { label: '未开赛', className: 'bg-muted text-muted-foreground' },
  live: { label: '进行中', className: 'bg-home-win/20 text-home-win border border-home-win/40' },
  finished: { label: '已完赛', className: 'bg-info/20 text-info border border-info/40' },
  cancelled: { label: '已取消', className: 'bg-destructive/20 text-destructive border border-destructive/40' },
};

interface RuleInfo {
  name: string;
  direction: string;
  desc: string;
  category: string;
  directionType: 'home' | 'away' | 'draw' | 'over' | 'under' | 'upset' | 'neutral';
}

const MODEL_RULE_MAP: Record<string, RuleInfo> = {
  R1: { name: '主场优势', direction: '主胜', directionType: 'home', category: '主客场', desc: '主队主场作战，天然具备场地熟悉、球迷支持、旅途休整等优势，赢球基础值+8%。' },
  R2: { name: '近期状态', direction: '主胜', directionType: 'home', category: '基本面分析', desc: '主队近5场赢球率超过60%，球队状态正佳，士气和战术磨合度高，主胜概率+5%。' },
  R3: { name: '客场虫', direction: '主胜/平', directionType: 'home', category: '主客场', desc: '客队近5个客场未尝胜绩，客场作战能力堪忧，客胜概率-8%，更看好主队不败。' },
  R4: { name: '平局大师', direction: '平', directionType: 'draw', category: '基本面分析', desc: '双方近5场平局率均超过40%，球队风格偏保守或攻防均衡，平局概率+10%。' },
  R5: { name: '攻防失衡', direction: '主胜', directionType: 'home', category: '基本面分析', desc: '主队场均进球超过2球且失球低于1球，攻防两端表现俱佳，主胜概率+7%。' },
  R6: { name: '锋无力', direction: '小', directionType: 'under', category: '进球数', desc: '双方近5场场均进球均不足1球，进攻端效率低下，低进球概率+15%。' },
  R7: { name: '对攻大战', direction: '大', directionType: 'over', category: '进球数', desc: '双方近5场场均进球均超过2.5球，进攻火力旺盛，比赛节奏快，高进球概率+15%。' },
  R8: { name: '实力差修正', direction: '强队胜', directionType: 'home', category: '基本面分析', desc: '两队联赛排名相差8位及以上，实力差距明显，强队赢球概率+10%。' },
  R9: { name: '欧战首回合', direction: '平', directionType: 'draw', category: '杯赛特性', desc: '欧战首回合双方较为谨慎，试探性进攻多，平局率+12%。' },
  R10: { name: '欧战后遗症', direction: '冷门', directionType: 'upset', category: '杯赛特性', desc: '球队3天内刚踢完欧战，体能消耗巨大，联赛赢球率-10%，易出冷门。' },
  R11: { name: '平局联赛权重', direction: '平', directionType: 'draw', category: '基本面分析', desc: '法甲/意甲联赛整体平局率偏高，联赛属性加成，平局概率+5%。' },
   R12: { name: '欧联弱队主场', direction: '主胜/平', directionType: 'home', category: '杯赛特性', desc: '欧联赛事中弱队主场意外赛果率较高，主场球迷支持+战术收缩，主胜/平概率+15%。' },
  R13: { name: '身价差距', direction: '强队胜', directionType: 'home', category: '基本面分析', desc: '两队全队身价差距超过3倍，纸面实力悬殊，强队赢球概率+10%。' },
  R14: { name: '升班马适应期', direction: '反向', directionType: 'upset', category: '基本面分析', desc: '升班马赛季前10轮处于联赛适应期，对比赛强度和节奏不适应，赢球率-8%。' },
  R15: { name: '冬窗补强', direction: '强队胜', directionType: 'home', category: '基本面分析', desc: '球队冬窗引入关键位置强援，阵容实力提升明显，赢球率+7%。' },
  R16: { name: '核心伤愈复出', direction: '强队胜', directionType: 'home', category: '阵容', desc: '球队核心球员伤愈复出，攻防体系恢复完整，赢球率+8%。' },
  R17: { name: '主力停赛', direction: '反向', directionType: 'upset', category: '阵容', desc: '主力球员累积黄牌停赛，阵容轮换影响战术执行，球队赢球率-7%。' },
  R18: { name: '克星球队', direction: '主队负', directionType: 'away', category: '历史交锋', desc: '一方近6次交锋未尝胜绩，心理劣势明显，对阵赢球率-10%。' },
   R19: { name: '欧冠后客场意外', direction: '主胜', directionType: 'home', category: '杯赛特性', desc: '刚参加完欧冠的球队客场作战，旅途疲劳+轮换，客赢球率-12%，主队有机会拿分。' },
  R20: { name: '杯赛轮换', direction: '冷门', directionType: 'upset', category: '杯赛特性', desc: '联赛杯/足总杯等杯赛强队大幅轮换主力，阵容深度受考验，赢球率-15%，易出冷门。' },
  R21: { name: '杯赛主场', direction: '主胜', directionType: 'home', category: '主客场', desc: '杯赛主场优势被放大，主队球迷氛围更热烈，主胜概率+10%。' },
  R22: { name: '德比战', direction: '平/大', directionType: 'over', category: '特殊因素', desc: '同城德比战双方拼抢激烈，节奏快，平局率+8%，进球率上升+10%。' },
  R23: { name: '初始指数下调', direction: '冷门', directionType: 'upset', category: '指数分析', desc: '初始指数到临场指数持续指数下调，数据提供方对强队信心下降，上方打出难度增大，冷门概率上升。' },
  R24: { name: '初始指数上调', direction: '强队胜', directionType: 'home', category: '指数分析', desc: '初始指数到临场指数持续指数上调，数据提供方强化强队优势，上方打出概率+8%。' },
  R25: { name: '国内杯赛轮换效应', direction: '冷门', directionType: 'upset', category: '杯赛特性', desc: '英联杯/国王杯等国内杯赛强队轮换幅度大，让分指数难以打穿。' },
  R26: { name: '半球中指数值诱上', direction: '冷门', directionType: 'upset', category: '指数分析', desc: '半球指数搭配中指数值，上方指数值持续下降，存在诱上嫌疑，需防下方打出。' },
  R27: { name: '平手指数分胜负', direction: '分胜负', directionType: 'home', category: '指数分析', desc: '平手指数双方实力接近且主场优势未体现，分胜负概率高于平局。' },
  R28: { name: '一球指数走指风险', direction: '反向', directionType: 'upset', category: '指数分析', desc: '一球指数强队仅赢一球概率高，让分指数走指/输指数风险大，让分模型准确率下降。' },
  R29: { name: '指数值反诱', direction: '强队胜', directionType: 'home', category: '指数分析', desc: '热门方指数值异常偏高，数据提供方利用高指数值设置阻力，实则热门方打出概率大。' },
  R30: { name: '进球数指数值异动', direction: '大', directionType: 'over', category: '进球数', desc: '进球数指数指数值剧烈波动，表明市场预期变化明显，进球数方向需调整。' },
  R31: { name: '天气影响', direction: '小', directionType: 'under', category: '特殊因素', desc: '比赛日有雨/雪天气，场地湿滑影响传控和射门质量，进球数-15%，倾向进球少。' },
  R32: { name: '裁判出牌率', direction: '小', directionType: 'under', category: '特殊因素', desc: '主裁判场均出牌数较高，比赛中断多、犯规频繁，进攻节奏被打断，进球少概率上升。' },
  R33: { name: '赛程密集', direction: '小', directionType: 'under', category: '战意', desc: '球队7天内3赛，体能严重下降，比赛节奏变慢，进球率下降+10%。' },
  R34: { name: '保级战意', direction: '主胜', directionType: 'home', category: '战意', desc: '主队处于保级关键期，主场抢分战意强烈，球员拼劲足，主胜概率+8%。' },
  R35: { name: '争冠战意', direction: '客胜', directionType: 'away', category: '战意', desc: '客队处于争冠/争欧战资格关键阶段，客场全取三分战意强，客赢球率+10%。' },
   R36: { name: '升班马主场', direction: '主胜/平', directionType: 'home', category: '主客场', desc: '升班马主场球迷支持度高，且对手对其不够了解，主场意外赛果率+12%。' },
  R37: { name: '降级队客场', direction: '主胜', directionType: 'home', category: '主客场', desc: '降级区球队客场作战信心不足，抗压能力差，客场赢球率-15%。' },
  R38: { name: '教练下课', direction: '主胜/平', directionType: 'home', category: '阵容', desc: '新帅上任首战，球员为证明自己全力拼搏，新帅首战不败率+20%。' },
  R39: { name: '核心缺阵', direction: '反向', directionType: 'upset', category: '阵容', desc: '球队核心球员（最佳射手/中场核心）缺阵，攻防体系受损，球队赢球率-12%。' },
  R40: { name: '门将缺阵', direction: '大', directionType: 'over', category: '阵容', desc: '主力门将缺阵，替补门将经验不足或状态存疑，球队失球率+25%，进球多概率上升。' },
  R41: { name: '主场龙客场虫', direction: '主胜', directionType: 'home', category: '主客场', desc: '主队主场赢球率超过70%且客队客场赢球率不足30%，主客场表现差距悬殊，主胜概率+10%。' },
  R42: { name: '客场龙', direction: '客胜', directionType: 'away', category: '主客场', desc: '客队客场赢球率超过60%，客场作战能力极强，客胜概率+8%。' },
  R43: { name: '近期大胜', direction: '强队胜', directionType: 'home', category: '基本面分析', desc: '球队近3场连续净胜2球以上，状态火热，士气高涨，赢球率+8%。' },
  R44: { name: '近期大败', direction: '弱队负', directionType: 'away', category: '基本面分析', desc: '球队近3场连续净负2球以上，状态低迷，士气低落，赢球率-10%。' },
  R45: { name: '交锋优势', direction: '主队胜', directionType: 'home', category: '历史交锋', desc: '双方近5次交锋主队赢下4场以上，心理优势明显，赢球率+8%。' },
  R46: { name: '交锋劣势', direction: '主队负', directionType: 'away', category: '历史交锋', desc: '双方近5次交锋主队输掉4场以上，心理劣势明显，赢球率-8%。' },
  R47: { name: '洲际首轮进球', direction: '大', directionType: 'over', category: '杯赛特性', desc: '亚冠/解放者杯等洲际赛事首轮，双方不够熟悉防守强度，进球率上升+12%。' },
  R48: { name: '让分一致性', direction: '强队胜', directionType: 'home', category: '指数分析', desc: '让分指数与实力差评估完全一致，模型信心提升，让分模型准确率+8%。' },
  R49: { name: '洲际首轮平局共振', direction: '平', directionType: 'draw', category: '杯赛特性', desc: '洲际赛事首轮双方较为保守，试探性踢法多，平局率+10%。' },
  R50: { name: '半场全场规律', direction: '胜胜', directionType: 'home', category: '指数分析', desc: '强队主场作战半场领先率高，顺势拿下比赛概率大，半场领先+全场赢球率+15%。' },
  R51: { name: '英联杯轮换效应', direction: '冷门', directionType: 'upset', category: '杯赛特性', desc: '英联杯第三轮及以后，英超强队轮换幅度大，年轻球员+替补出战，赛果不确定性高。' },
  R52: { name: '南美解放者杯', direction: '主胜', directionType: 'home', category: '主客场', desc: '南美解放者杯主场优势极大，高原/长途奔波/球迷氛围加成，主赢球率+15%。' },
  R53: { name: '亚冠东亚区', direction: '主胜', directionType: 'home', category: '主客场', desc: '亚冠东亚区客场赢球率普遍偏低，旅途+时差+环境适应问题，主胜概率+8%。' },
  R54: { name: '亚运赛事', direction: '冷门', directionType: 'upset', category: '杯赛特性', desc: '亚运会等赛事以年轻球员为主，经验不足，不确定性高，易出冷门。' },
  R55: { name: '中游主场防冷', direction: '平', directionType: 'draw', category: '主客场', desc: '中游球队主场面对强队时战术务实，铁桶阵+反击，平局概率高，防平。' },
   R56: { name: '两回合次回合', direction: '小', directionType: 'under', category: '杯赛特性', desc: '两回合制比赛次回合，领先方战术保守，落后方也不敢贸然压上，进球率下降+12%。' },
};

function resolveFootballRule(code: string): (typeof MODEL_RULE_MAP)[string] & { displayName: string } | null {
  const info = MODEL_RULE_MAP[code];
  if (info) return { ...info, displayName: info.name };
  if (code === 'R20 胜负平基线模型') {
    return { name: '赛果方向基线', direction: '主胜', directionType: 'home', category: '模型基础', desc: '基于球队基本面、主客场因素、历史交锋等加权计算的赛果方向概率基线模型，是预测的核心基础。', displayName: '赛果方向基线模型' };
  }
  if (code === 'R20a 深盘档位（≥2球）') {
     return { name: '深指数档位', direction: '强队胜', directionType: 'home', category: '指数分析', desc: '让分≥2球属于深指数档位，双方实力差距悬殊，强队赢面极大但需警惕赢球不赢指数。', displayName: '深指数档位（≥2球）' };
  }
  if (code === 'R20b 中盘档位（1球）') {
     return { name: '中指数档位', direction: '主胜', directionType: 'home', category: '指数分析', desc: '让分1球属于中指数档位，双方有一定实力差距但仍有悬念，是模型预测相对稳定的区间。', displayName: '中指数档位（1球）' };
  }
   if (code === 'R20c 浅盘档位（<1球）') {
      return { name: '浅指数档位', direction: '分胜负', directionType: 'home', category: '指数分析', desc: '让分<1球属于浅指数档位，双方实力接近，平局和意外赛果概率相对较高，需结合战意和伤停综合判断。', displayName: '浅指数档位（<1球）' };
   }
  if (code === 'R20d 主队优势倾向') {
    return { ...MODEL_RULE_MAP.R1, displayName: '主队优势倾向' };
  }
  if (code === 'R20d 客队优势倾向') {
    return { name: '客队优势倾向', direction: '客胜', directionType: 'away', category: '主客场', desc: '基于实力评估，客队占据优势，客胜概率更高。', displayName: '客队优势倾向' };
  }
  if (code === 'R20d 势均力敌') {
    return { name: '势均力敌', direction: '平', directionType: 'draw', category: '基本面分析', desc: '双方实力相当，胜负难料，平局概率相对较高。', displayName: '势均力敌' };
  }
  if (code === 'R39 低信心双选') {
    return { name: '低信心提示', direction: '冷门', directionType: 'upset', category: '模型输出', desc: '模型最高与次高概率差距小于5%，比赛不确定性较高，建议双选或观望。', displayName: '低信心双选提示' };
  }
  if (code.startsWith('R65 让球三向判定（v9.0）')) {
    return { name: '让球三向判定', direction: '让胜', directionType: 'home', category: '让球分析', desc: 'v9.0 版本让球三向口径：让胜/让负最高项即方向；让平为最高项且≥25% 时推荐让平；低信心阈值 50%，低于 40% 进入观望。', displayName: '让球三向判定（v9.0）' };
  }
  if (code === 'R65 v7.0 让球热门方p值推荐+收紧至60%门槛（1088场回测校准）') {
    return { name: '让球三向判定', direction: '让胜', directionType: 'home', category: '让球分析', desc: 'v9.0 版本让球三向口径：让胜/让负最高项即方向；让平为最高项且≥25% 时推荐让平；低信心阈值 50%，低于 40% 进入观望。', displayName: '让球三向判定（v9.0）' };
  }
  if (code === 'R66 大小球系统性看小修正（λ×1.08）') {
    return { name: '大小球系统性看小修正', direction: '小分', directionType: 'under', category: '大小球分析', desc: '历史数据显示模型存在系统性看大偏差，通过 λ×1.08 系数向下修正预期总进球数，提升大小球预测准确率。', displayName: '大小球系统性看小修正' };
  }
  if (code === 'R80 v8.0 大小球基准上修10%（纠正系统性看小偏差）') {
    return { name: '大小球基准上修', direction: '大分', directionType: 'over', category: '大小球分析', desc: 'v8.0 版本基于新一轮回测，发现模型存在系统性看小偏差，将大小球基准线上修 10% 予以纠正。', displayName: '大小球基准上修 10%（v8.0）' };
  }
  if (code.startsWith('R25a v9.0 大小球中信心')) {
    return { name: '大小球中信心门槛', direction: '大分', directionType: 'over', category: '大小球分析', desc: 'v9.0 版本放宽大小球中信心门槛：差值 ≥ 0.4 且概率 ≥ 55% 即可输出中信心方向，降低观望占比。', displayName: '大小球中信心门槛（v9.0）' };
  }
  if (code.startsWith('R82 v9.0 杯赛')) {
    return { name: '杯赛降权', direction: '观望', directionType: 'neutral', category: '杯赛特性', desc: 'v9.0 版本对杯赛场次整体降权：胜率差 < 25% 时谨慎出方向，25-40% 区间信心 -8，降低杯赛不确定场景的误判率。', displayName: '杯赛降权（v9.0）' };
  }
  return null;
}

function getDirectionColor(type: string): string {
  switch (type) {
    case 'home': return 'text-home-win';
    case 'away': return 'text-away-win';
    case 'draw': return 'text-draw';
    case 'over': return 'text-accent';
    case 'under': return 'text-blue-400';
    case 'upset': return 'text-purple-400';
    default: return 'text-muted-foreground';
  }
}

function getDirectionBg(type: string): string {
  switch (type) {
    case 'home': return 'bg-home-win/15 text-home-win border-home-win/30';
    case 'away': return 'bg-away-win/15 text-away-win border-away-win/30';
    case 'draw': return 'bg-draw/15 text-draw border-draw/30';
    case 'over': return 'bg-accent/15 text-accent border-accent/30';
    case 'under': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    case 'upset': return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

// 从 intel 文本解析近期战绩（如 "W-D-W-L-W"）
function parseFormString(form: string[]): string[] {
  if (form && form.length > 0) return form.slice(0, 5);
  return [];
}

function getFormColor(result: string): string {
  const r = result.toUpperCase();
  if (r === 'W' || r === '胜') return 'bg-home-win';
  if (r === 'D' || r === '平') return 'bg-draw';
  if (r === 'L' || r === '负') return 'bg-away-win';
  return 'bg-muted';
}

function getFormLabel(result: string): string {
  const r = result.toUpperCase();
  if (r === 'W' || r === '胜') return '胜';
  if (r === 'D' || r === '平') return '平';
  if (r === 'L' || r === '负') return '负';
  return r;
}

interface FormDetail {
  result: string;
  opponent: string;
  score: string;
  isSimple: boolean;
}

function parseFormDetail(formStr: string): FormDetail {
  const trimmed = formStr.trim();
  if (trimmed.length === 0) return { result: '', opponent: '', score: '', isSimple: true };
  if (trimmed.length === 1) {
    return { result: trimmed, opponent: '', score: '', isSimple: true };
  }
  // Extract result from the beginning (胜/平/负 or W/D/L)
  let result = '';
  let rest = trimmed;
  const firstChar = trimmed.charAt(0);
  if (['胜', '平', '负'].includes(firstChar)) {
    result = firstChar;
    rest = trimmed.slice(1).trim();
  } else {
    const upper = trimmed.toUpperCase();
    if (upper.startsWith('W') || upper.startsWith('D') || upper.startsWith('L')) {
      result = upper.charAt(0);
      rest = trimmed.slice(1).trim();
    }
  }
  const scoreMatch = rest.match(/(\d+-\d+)/);
  let score = '';
  let opponent = '';
  if (scoreMatch) {
    score = scoreMatch[1];
    const beforeScore = rest.slice(0, scoreMatch.index).trim();
    opponent = beforeScore.replace(/^vs/i, '').trim();
  } else {
    opponent = rest.replace(/^vs/i, '').trim();
  }
  return { result, opponent, score, isSimple: !result };
}

// ============================================================
// 近期战绩趋势图解析
// ============================================================

interface FormTrendItem {
  result: 'win' | 'draw' | 'loss' | 'unknown';
  goalDiff: number;
  scoreFor: number;
  scoreAgainst: number;
  raw: string;
}

function parseFormForTrend(formArr: string[]): FormTrendItem[] {
  if (!formArr || formArr.length === 0) return [];
  return formArr.map((s) => {
    const detail = parseFormDetail(s);
    const r = detail.result.toUpperCase();
    let result: FormTrendItem['result'] = 'unknown';
    if (r === 'W' || r === '胜') result = 'win';
    else if (r === 'D' || r === '平') result = 'draw';
    else if (r === 'L' || r === '负') result = 'loss';

    let goalDiff = 0;
    let scoreFor = 0;
    let scoreAgainst = 0;
    if (detail.score && detail.score.includes('-')) {
      const parts = detail.score.split('-').map((p) => parseInt(p.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        scoreFor = parts[0];
        scoreAgainst = parts[1];
        goalDiff = scoreFor - scoreAgainst;
      }
    }
    return { result, goalDiff, scoreFor, scoreAgainst, raw: s };
  });
}

function countFormResults(items: FormTrendItem[]): { win: number; draw: number; loss: number } {
  let win = 0;
  let draw = 0;
  let loss = 0;
  for (const it of items) {
    if (it.result === 'win') win += 1;
    else if (it.result === 'draw') draw += 1;
    else if (it.result === 'loss') loss += 1;
  }
  return { win, draw, loss };
}

// ============================================================
// H2H 历史交锋解析
// ============================================================

interface H2HParsedRecord {
  raw: string;
  homeWin: boolean;
  draw: boolean;
  awayWin: boolean;
}

function parseH2HRecord(line: string): H2HParsedRecord | null {
  if (!line || !line.trim()) return null;
  const trimmed = line.trim();
  // 尝试匹配形如 "主队 2-1 客队" 的比分模式
  const scoreMatch = trimmed.match(/(\d+)\s*[-：:]\s*(\d+)/);
  let homeWin = false;
  let draw = false;
  let awayWin = false;
  if (scoreMatch) {
    const h = parseInt(scoreMatch[1], 10);
    const a = parseInt(scoreMatch[2], 10);
    if (h > a) homeWin = true;
    else if (h === a) draw = true;
    else awayWin = true;
  } else {
    // 关键词兜底
    if (/主胜|主队胜|主赢/.test(trimmed)) homeWin = true;
    else if (/客胜|客队胜|客赢/.test(trimmed)) awayWin = true;
    else if (/平局|战平|平/.test(trimmed)) draw = true;
  }
  return { raw: trimmed, homeWin, draw, awayWin };
}

function parseH2HStats(
  h2h: string[],
  limit?: number
): { homeWin: number; draw: number; awayWin: number; total: number } {
  if (!h2h || h2h.length === 0) return { homeWin: 0, draw: 0, awayWin: 0, total: 0 };
  const list = limit ? h2h.slice(0, limit) : h2h;
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  for (const line of list) {
    const parsed = parseH2HRecord(line);
    if (!parsed) continue;
    if (parsed.homeWin) homeWin += 1;
    else if (parsed.draw) draw += 1;
    else if (parsed.awayWin) awayWin += 1;
  }
  return { homeWin, draw, awayWin, total: homeWin + draw + awayWin };
}

// ============================================================
// 伤停阵容完整度计算
// ============================================================

interface ParsedInjuryLine {
  name: string;
  position: string;
  impact: 'high' | 'medium' | 'low';
  raw: string;
}

const INJURY_IMPACT_PENALTY: Record<'high' | 'medium' | 'low', number> = {
  high: 15,
  medium: 8,
  low: 3,
};

function detectImpact(text: string): 'high' | 'medium' | 'low' {
  const t = text.toLowerCase();
  if (/高影响|核心|主力门将|主力前锋|核心球员|队长|关键|严重|赛季报销|out|critical|key|star/.test(t)) {
    return 'high';
  }
  if (/中影响|轮换|替补|中等|questionable|doubtful|mid|轮换球员/.test(t)) {
    return 'medium';
  }
  if (/低影响|轻伤|小伤|probable|minor|轻微/.test(t)) {
    return 'low';
  }
  // 默认中影响
  return 'medium';
}

function parseInjuryLines(raw: string | undefined | null): ParsedInjuryLine[] {
  if (!raw || !raw.trim()) return [];
  const lines = raw
    .split(/[\n；;。]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const result: ParsedInjuryLine[] = [];
  for (const line of lines) {
    // 尝试提取球员名 + 位置
    const posMatch = line.match(/(前锋|后卫|中场|门将|守门员|左后卫|右后卫|中卫|后腰|前腰|边锋|中锋|GK|DF|MF|FW)/i);
    const position = posMatch ? posMatch[1] : '';
    // 名字取行首，到第一个分隔符为止
    const nameMatch = line.match(/^([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z\s·.\-]{1,20})/);
    const name = nameMatch ? nameMatch[1].trim() : line.slice(0, 10);
    result.push({
      name,
      position: position || '球员',
      impact: detectImpact(line),
      raw: line,
    });
  }
  return result;
}

function calcSquadCompleteness(injuries: ParsedInjuryLine[]): number | null {
  if (injuries.length === 0) return null;
  let penalty = 0;
  for (const inj of injuries) {
    penalty += INJURY_IMPACT_PENALTY[inj.impact];
  }
  return Math.max(100 - penalty, 40);
}

// ============================================================
// 多源对照：找差异最大字段
// ============================================================

function parseScoreProb(probStr: string): { score: string; prob: number } {
  const formats = [
    /^(.+?)\s*[（(](\d+(?:\.\d+)?)%[)）]$/,
    /^(.+?)[:：]\s*(\d+(?:\.\d+)?)%$/,
    /^(\d+-\d+)\s*(\d+(?:\.\d+)?)%$/,
  ];
  for (const re of formats) {
    const m = probStr.match(re);
    if (m) return { score: m[1].trim(), prob: Number(m[2]) };
  }
  return { score: probStr, prob: 0 };
}

function getRatingColor(rating: number): string {
  if (rating >= 8) return 'text-home-win';
  if (rating >= 7) return 'text-draw';
  return 'text-muted-foreground';
}

function getInjuryBadge(status: string): { label: string; className: string } | null {
  const s = status?.toLowerCase() || '';
  if (s === 'out' || s === '伤停' || s.includes('out')) {
    return { label: '伤停', className: 'bg-away-win/20 text-away-win border border-away-win/40' };
  }
  if (s === 'doubt' || s === '存疑' || s.includes('doubt')) {
    return { label: '存疑', className: 'bg-draw/20 text-draw border border-draw/40' };
  }
  return null;
}

const MatchDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [match, setMatch] = useState<MatchItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 篮球联赛关键词集合（用于判断是否跳转到篮球详情页）
  const BASKETBALL_LEAGUE_KEYWORDS = [
    'NBA', 'WNBA', 'CBA', '欧篮联', '西篮联', '德篮联', '日篮联',
    '澳NBL', '亚运男篮', '亚运女篮', 'NCAA', 'NBL', '男篮亚洲杯',
    '女篮亚洲杯', '男篮世界杯', '女篮世界杯', '奥运男篮', '奥运女篮',
    'B联赛', 'KBL', 'FIBA', '欧洲杯篮球', '美洲杯男篮',
  ];

  const isBasketballLeague = (league: string): boolean => {
    if (!league) return false;
    return BASKETBALL_LEAGUE_KEYWORDS.some((kw: string) => league.includes(kw));
  };
  const syncStore = useSyncStore();
  const detailCache = useMatchDetailCache<MatchItem>('football');
  const isFavorited = id ? syncStore.isFavorite(id) : false;
  const [viewedRecorded, setViewedRecorded] = useState(false);
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const MAIN_TABS: readonly ('overview' | 'deep' | 'h2h' | 'intel')[] = ['overview', 'deep', 'h2h', 'intel'];
  const INTEL_TABS: readonly ('form' | 'attack' | 'homeAway' | 'injuries')[] = ['form', 'attack', 'homeAway', 'injuries'];
  const urlTab = searchParams.get('tab');
  const activeTab: 'overview' | 'deep' | 'h2h' | 'intel' = MAIN_TABS.includes(urlTab as typeof MAIN_TABS[number])
    ? (urlTab as typeof MAIN_TABS[number])
    : 'overview';
  const urlSubTab = searchParams.get('sub');
  const intelTab: 'form' | 'attack' | 'homeAway' | 'injuries' = INTEL_TABS.includes(urlSubTab as typeof INTEL_TABS[number])
    ? (urlSubTab as typeof INTEL_TABS[number])
    : 'form';

  const handleActiveTabChange = (tab: 'overview' | 'deep' | 'h2h' | 'intel') => {
    const next: Record<string, string> = { tab };
    if (tab === 'intel' && INTEL_TABS.includes(intelTab)) {
      next.sub = intelTab;
    }
    setSearchParams(next, { replace: true });
  };

  const handleIntelTabChange = (sub: 'form' | 'attack' | 'homeAway' | 'injuries') => {
    setSearchParams({ tab: 'intel', sub }, { replace: true });
  };

  // 伤停数据
  const [injuries, setInjuries] = useState<MatchInjuriesResponse | null>(null);
  const [injuriesLoading, setInjuriesLoading] = useState(false);

  const [playerDialogOpen, setPlayerDialogOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<ParsedKeyPlayer | null>(null);

  // 指数数据
  const [oddsData, setOddsData] = useState<MatchOddsResponse | null>(null);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [lastOddsUpdate, setLastOddsUpdate] = useState<string>('');
  const [isRefreshingOdds, setIsRefreshingOdds] = useState(false);
  const oddsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 历史交锋口径：全部/近10次/近5次
  const [h2hScope, setH2hScope] = useState<'all' | 'last10' | 'last5'>('all');

  // 指数走势数据
  const [oddsTrendData, setOddsTrendData] = useState<OddsTrendResponse | null>(null);
  const [oddsTrendLoading, setOddsTrendLoading] = useState(false);
  const [oddsTrendType, setOddsTrendType] = useState<'1x2' | 'handicap' | 'total'>('1x2');

  // 多源对照数据
  const [multiSourceData, setMultiSourceData] = useState<MatchMultiSourceResponse | null>(null);
  const [multiSourceLoading, setMultiSourceLoading] = useState(false);

  const [lastUpdateIso, setLastUpdateIso] = useState<string>(new Date().toISOString());
  const [nowTs, setNowTs] = useState<number>(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishedPollCountRef = useRef<number>(0);
  const hasScore = match ? (match.homeScore != null && match.awayScore != null) : false;
  const computedStatus: ComputedMatchStatus | null = match
    ? computeMatchStatus(match.matchStatus, match.kickoffTime, hasScore, 'football')
    : null;
  const isLive = computedStatus === 'live';
  const isFinished = computedStatus === 'finished';
  const isUpcoming = computedStatus === 'upcoming';
  const isFinishedPending = computedStatus === 'finished_pending';
  // 给 LiveStatusBar 展示用的基础间隔秒数（实际轮询由 getNextPollDelayMs 控制随机抖动）
  const refreshInterval = isLive ? 30 : isUpcoming ? 60 : 60;

  const fetchMatch = async (showLoading = false) => {
    if (!id) return;
    // 优先读缓存（仅首次加载且非强制刷新时用缓存快速展示）
    if (showLoading) {
      const cached = detailCache.getDetail(id);
      if (cached) {
        setMatch(cached);
        setLoading(false);
        setLastUpdateIso(new Date().toISOString());
        setNowTs(Date.now());
        // 缓存命中仍静默拉取最新数据，保持数据新鲜
        fetchMatchSilent();
        return;
      }
    }
    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    setIsRefreshing(true);
    try {
      const response = await matchesApi.getMatch(id);
      if (typeof response !== 'object' || !response || typeof response.match !== 'object') {
        throw new Error('比赛详情数据格式异常');
      }
      setMatch(response.match);
      detailCache.setDetail(id, response.match);
      setLastUpdateIso(new Date().toISOString());
      setNowTs(Date.now());
    } catch (err) {
      logger.error('获取比赛详情失败', err);
      if (showLoading) setError('加载比赛详情失败，请稍后重试');
    } finally {
      if (showLoading) setLoading(false);
      setIsRefreshing(false);
    }
  };

  // 篮球比赛重定向：A套（足球详情页）加载到篮球赛事时，跳转到B套（篮球详情页）
  useEffect(() => {
    if (!match || !id) return;
    if (isBasketballLeague(match.league)) {
      navigate(`/basketball/detail/${id}`, { replace: true });
    }
  }, [match, id, navigate]);

  const fetchMatchSilent = async () => {
    if (!id) return;
    setIsRefreshing(true);
    try {
      const response = await matchesApi.getMatch(id);
      if (typeof response !== 'object' || !response || typeof response.match !== 'object') {
        throw new Error('比赛详情数据格式异常');
      }
      setMatch(response.match);
      detailCache.setDetail(id, response.match);
      setLastUpdateIso(new Date().toISOString());
      setNowTs(Date.now());
    } catch (err) {
      logger.error('静默刷新比赛详情失败', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // 获取比赛详情
  useEffect(() => {
    if (!id) return;
    void fetchMatch(true);
  }, [id]);

  // 每秒 tick 用于相对时间和倒计时显示（不请求接口）
  useEffect(() => {
    tickTimerRef.current = setInterval(() => {
      setNowTs((prev) => prev + 1000);
    }, 1000);
    return () => {
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
    };
  }, []);

  // 计算下一次轮询间隔（毫秒）
  const getNextPollDelayMs = useCallback((): number | null => {
    if (!match) return 60000;
    const status = computedStatus;
    const kickoffTimeMs = new Date(match.kickoffTime).getTime();
    const now = Date.now();

    if (status === 'live') {
      // LIVE: 25~40 秒随机（base 32s ± 7.5s）
      const base = 32000;
      const jitter = (Math.random() * 15000) - 7500;
      return Math.max(24500, Math.min(39500, base + jitter));
    }

    if (status === 'upcoming') {
      const minutesToKickoff = (kickoffTimeMs - now) / 60000;
      if (minutesToKickoff <= 60 && minutesToKickoff > 0) {
        // 距开赛 60 分钟内：2~5 分钟随机
        const base = 210000; // 3.5 min
        const jitter = (Math.random() * 180000) - 90000; // ±1.5 min
        return Math.max(120000, Math.min(300000, base + jitter));
      }
      // 距开赛 > 60min：10 分钟低频
      return 600000;
    }

    if (status === 'finished' || status === 'finished_pending') {
      // 完赛后 5 分钟内再轮询 2 次（间隔 30s）确认终场，之后停止
      if (finishedPollCountRef.current < 2) {
        finishedPollCountRef.current += 1;
        return 30000;
      }
      return null; // 停止轮询
    }

    return null;
  }, [match, computedStatus]);

  // 自调度轮询（setTimeout 递归）
  useEffect(() => {
    if (!id || !match) return;

    const scheduleNext = () => {
      const delay = getNextPollDelayMs();
      if (delay === null) {
        pollTimerRef.current = null;
        return;
      }
      pollTimerRef.current = setTimeout(() => {
        void fetchMatch(false).then(() => {
          scheduleNext();
        });
      }, delay);
    };

    // 初始延迟调度（首次已由 mount fetchMatch 拉过）
    scheduleNext();

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [id, match, getNextPollDelayMs]);

  // 状态变更时重置完赛轮询计数
  useEffect(() => {
    if (isLive || isUpcoming) {
      finishedPollCountRef.current = 0;
    }
  }, [isLive, isUpcoming]);

  // 页面切回前台时立即刷新一次
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchMatch(false);
      }
    };
    const handleFocus = () => {
      void fetchMatch(false);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualRefresh = () => {
    if (isRefreshing) return;
    void fetchMatch(false);
  };

  // 计算数据更新相对时间（upcoming 用 lastDataSyncAt，live/finished 用 lastScoreAt）
  const dataUpdateInfo = (() => {
    if (!match) return null;
    const useScore = isLive || isFinished;
    const timeStr = useScore ? match.lastScoreAt : match.lastDataSyncAt || match.intelUpdatedAt;
    if (!timeStr) return null;
    const diffMs = nowTs - new Date(timeStr).getTime();
    const diffSec = Math.max(0, diffMs / 1000);
    return {
      ...formatRelativeSeconds(diffSec),
      bjTime: formatBeijingTime(timeStr, 'datetime'),
      source: useScore ? formatLiveScoreSource(match.liveScoreSource) : null,
      useScore,
    };
  })();

  // 计算比分更新相对时间
  const scoreUpdateInfo = (() => {
    if (!match?.lastScoreAt) return null;
    const diffMs = nowTs - new Date(match.lastScoreAt).getTime();
    const diffSec = Math.max(0, diffMs / 1000);
    return {
      ...formatRelativeSeconds(diffSec),
      bjTime: formatBeijingTime(match.lastScoreAt, 'datetime'),
      source: formatLiveScoreSource(match.liveScoreSource),
    };
  })();

  // 开赛倒计时（upcoming）
  const kickoffCountdown = (() => {
    if (!isUpcoming || !match?.kickoffTime) return null;
    const diffMs = new Date(match.kickoffTime).getTime() - nowTs;
    if (diffMs <= 0) return '00:00:00';
    return formatCountdown(diffMs / 1000);
  })();

  // 完赛确认时间
  const finishedConfirmTime = (() => {
    if (!isFinished || !match?.lastScoreAt) return null;
    return formatBeijingTime(match.lastScoreAt, 'time-seconds');
  })();

  // 获取伤停信息
  useEffect(() => {
    if (!id || !match) return;
    const fetchInjuries = async () => {
      setInjuriesLoading(true);
      try {
        const data = await injuriesApi.getMatchInjuries(id);
        setInjuries(data);
      } catch (err) {
        logger.warn('获取伤停信息失败', err);
        setInjuries({ home: [], away: [] });
      } finally {
        setInjuriesLoading(false);
      }
    };
    fetchInjuries();
  }, [id, match]);



  // 获取指数数据
  const fetchOdds = async (showLoading = true) => {
    if (!id) return;
    if (showLoading) setOddsLoading(true);
    setIsRefreshingOdds(true);
    try {
      const data = await matchesApi.getMatchOdds(id);
      setOddsData(data);
      const nowIso = new Date().toISOString();
      setLastOddsUpdate(nowIso);
    } catch (err) {
      logger.warn('获取指数数据失败', err);
      setOddsData(null);
    } finally {
      if (showLoading) setOddsLoading(false);
      setIsRefreshingOdds(false);
    }
  };

  useEffect(() => {
    if (!id || !match) return;
    fetchOdds();
  }, [id, match]);

  useEffect(() => {
    if (!id || !match) return;
    oddsTimerRef.current = setInterval(() => {
      fetchOdds(false);
    }, 60000);
    return () => {
      if (oddsTimerRef.current) {
        clearInterval(oddsTimerRef.current);
      }
    };
  }, [id, match]);

  // 获取指数走势
  useEffect(() => {
    if (!id || !match) return;
    const fetchTrend = async () => {
      setOddsTrendLoading(true);
      try {
        const data = await matchesApi.getOddsTrend(id);
        setOddsTrendData(data);
        // 默认选中第一个有数据的类型
        if (data.types && data.types.length > 0) {
          const firstType = data.types[0] as '1x2' | 'handicap' | 'total';
          setOddsTrendType(firstType);
        }
      } catch (err) {
        logger.warn('获取指数走势失败', err);
        setOddsTrendData(null);
      } finally {
        setOddsTrendLoading(false);
      }
    };
    fetchTrend();
  }, [id, match]);

  // 获取多源对照
  useEffect(() => {
    if (!id || !match) return;
    const fetchMulti = async () => {
      setMultiSourceLoading(true);
      try {
        const data = await matchesApi.getMultiSource(id);
        setMultiSourceData(data);
      } catch (err) {
        logger.warn('获取多源对照失败', err);
        setMultiSourceData(null);
      } finally {
        setMultiSourceLoading(false);
      }
    };
    fetchMulti();
  }, [id, match]);

  useEffect(() => {
    if (!id || !match || viewedRecorded) return;
    const recordView = async () => {
      try {
        await predictionRecordsApi.addPredictionRecord(id, 'viewed');
        setViewedRecorded(true);
      } catch (err) {
        logger.warn('记录浏览记录失败', err);
      }
    };
    recordView();
  }, [id, match, viewedRecorded]);

  const handleBack = () => navigate(-1);

  const handleToggleFavorite = () => {
    if (!id) return;
    syncStore.toggleFavorite(id);
  };

  const toggleRuleExpand = (ruleCode: string) => {
    setExpandedRules((prev) => ({ ...prev, [ruleCode]: !prev[ruleCode] }));
  };

  // 骨架屏
  if (loading) {
    return (
      <div className="min-h-full bg-background">
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="w-8 h-8 bg-muted rounded-full animate-pulse" />
          <div className="h-5 w-24 bg-muted rounded animate-pulse" />
          <div className="w-8 h-8 bg-muted rounded-full animate-pulse" />
        </div>
        <div className="px-4 md:px-6 py-5 space-y-5 max-w-2xl mx-auto">
           {[1, 2, 3, 4, 5].map((i) => (
             <div key={i} className="bg-card border border-border rounded-xl shadow-sm p-4 space-y-3 animate-pulse">
               <div className="h-5 w-28 bg-muted/40 rounded" />
               <div className="h-16 bg-muted/40 rounded-lg" />
             </div>
           ))}
        </div>
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="min-h-full bg-background text-foreground">
        <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center">
          <button onClick={handleBack} className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors" aria-label="返回">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="flex-1 text-center text-lg font-semibold text-foreground pr-10">比赛详情</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="w-16 h-16 rounded-full bg-muted/40 flex items-center justify-center mb-4">
            <Clock className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-foreground font-medium mb-2">{error ? '暂无比赛数据' : '比赛数据加载中...'}</p>
          <p className="text-muted-foreground text-sm text-center mb-4">{error || '请稍候，正在获取比赛详情'}</p>
          <button onClick={handleBack} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium">
            返回上一页
          </button>
        </div>
      </div>
    );
  }

  const status = STATUS_STYLES[match.matchStatus] ?? STATUS_STYLES.upcoming;
  const directionStyle = DIRECTION_STYLES[match.predictionDirection] ?? DIRECTION_STYLES['观望'];
  const homeForm = parseFormString(match.homeForm || []);
  const awayForm = parseFormString(match.awayForm || []);
  const scoreProbsRaw = (match.scoreProbs || []).map(parseScoreProb);
  const scoreProbs = scoreProbsRaw
    .filter((s) => s.prob > 0)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 5);
  const maxScoreProb = Math.max(...scoreProbs.map((s) => s.prob), 1);

  const totalGoalsProb: TotalGoalsProbItem[] = match.totalGoalsProb || [];
  const maxTotalGoalsProb = Math.max(...totalGoalsProb.map((g) => g.prob), 0);
  const topTotalGoals = totalGoalsProb.length > 0
    ? totalGoalsProb.reduce((max, cur) => (cur.prob > max.prob ? cur : max), totalGoalsProb[0])
    : null;
  const totalAnalyzed = !!match.totalAnalyzed || totalGoalsProb.length > 0;
  const wdwAnalyzed = !!match.wdwAnalyzed;
  const isDefaultMostLikelyScore = match.mostLikelyScore
    ? ['3-0','0-3','2-0','0-2','1-0','0-1','2-1','1-2','1-1'].includes(match.mostLikelyScore) && !wdwAnalyzed
    : false;

  const halfFullProb: HalfFullProbItem[] = match.halfFullProb || [];
  const halfFullMap = new Map<string, number | null>();
  for (const item of halfFullProb) halfFullMap.set(item.code, toProbPct(item.prob));
  const topHalfFull = halfFullProb.length > 0
    ? halfFullProb.reduce((max, cur) => {
        const maxP = toProbPct(max.prob);
        const curP = toProbPct(cur.prob);
        if (curP === null) return max;
        if (maxP === null) return cur;
        return curP > maxP ? cur : max;
      }, halfFullProb[0])
    : null;

  const wdwNotAnalyzed = !wdwAnalyzed || (
    toProbPct(match.homeWinProb) === null &&
    toProbPct(match.drawProb) === null &&
    toProbPct(match.awayWinProb) === null
  );

  const wdwIsWait = match.predictionDirection === '观望' || !match.predictionDirection;
  const hasHandicapOdds = match.handicapOddsHome != null && match.handicapOddsHome > 0
    && match.handicapOddsAway != null && match.handicapOddsAway > 0;
  const hasTotalOdds = match.totalOddsOver != null && match.totalOddsOver > 0
    && match.totalOddsUnder != null && match.totalOddsUnder > 0;

  const confidenceLevel =
    match.confidence >= 65 ? { label: '高', color: 'text-home-win', barColor: 'bg-home-win' }
    : match.confidence >= 58 ? { label: '中', color: 'text-draw', barColor: 'bg-draw' }
    : { label: '低', color: 'text-away-win', barColor: 'bg-away-win' };

  // 真·数据不足：观望状态才算；有方向但信心低不算
  const isLowConfidenceData = wdwIsWait;
  const wdwIsLowConfidence = !wdwIsWait && (match.confidence ?? 0) < 58;

  // 大小球信心按偏离50%计算
  const totalPickProbNum = Number(match.totalPickProb ?? 0);
  const totalDeviation = Math.abs(totalPickProbNum - 50);
  const totalConfidenceLevel = totalDeviation >= 15
    ? { label: '高', className: 'text-home-win' }
    : totalDeviation >= 8
      ? { label: '中', className: 'text-draw-text' }
      : { label: '低', className: 'text-muted-foreground' };

  const confidenceCircumference = 2 * Math.PI * 40;
  const confidenceOffset = confidenceCircumference - (match.confidence / 100) * confidenceCircumference;

  // 指数变动
  const oddsChanges = oddsData?.changes;
  const hasMajorMove = oddsChanges?.hasMajorMove;

  return (
    <div className="min-h-full bg-background">
      {/* 顶部粘性区域：状态条 + 导航 */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border">
        {/* 实时状态条 */}
        <LiveStatusBar
          lastUpdateIso={lastUpdateIso}
          refreshInterval={refreshInterval}
          onRefresh={handleManualRefresh}
        />
        {/* 1. 头部信息 */}
        <div className="px-4 py-3 flex items-center">
        <button onClick={handleBack} className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors" aria-label="返回">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div className="flex-1 text-center">
           <div className="flex items-center justify-center gap-2">
             <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono text-xs font-medium">
               {match.matchNo}
             </span>
             <span className="text-xs text-muted-foreground truncate max-w-[120px]">{match.league}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${computedStatus && computedStatus !== 'live' ? (computedStatus === 'finished_pending' ? 'bg-info/20 text-info border border-info/40' : STATUS_STYLES[computedStatus]?.className || status.className) : status.className}`}>
                {computedStatus ? MATCH_STATUS_TEXT[computedStatus] : status.label}
              </span>
           </div>
         </div>
          <div className="flex items-center gap-0.5">
            <button
             onClick={handleToggleFavorite}
             disabled={false}
             className="p-2 -mr-2 rounded-full hover:bg-muted transition-colors disabled:opacity-50"
             aria-label={isFavorited ? '取消收藏' : '收藏'}
           >
             {isFavorited ? (
               <Star className="w-5 h-5 text-accent fill-accent" />
             ) : (
               <StarOff className="w-5 h-5 text-muted-foreground" />
             )}
           </button>
          </div>
        </div>
      </div>

       <ErrorBoundary fallbackTitle="页面出错了" fallbackMessage="详情页加载出现异常，请返回列表重试。">

         {/* 深红品牌 Hero 区块 */}
         <section className="relative overflow-hidden bg-nebula-crimson text-white">
           <div className="absolute inset-0 opacity-20 crimson-dots" />
           <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
           <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-red-900/50 blur-3xl" />
           <div className="relative px-4 md:px-6 pt-8 pb-10 max-w-2xl mx-auto">
             <div className="eyebrow eyebrow-line text-white/80 mb-6">MATCHDAY · {match.league}</div>
             {/* 对阵双方 + 比分 */}
             <div className="glass-card p-5 md:p-6">
               <div className="flex items-center justify-between mb-5">
                 <div className="flex-1 text-left min-w-0">
                   <div className="text-xs text-white/50 uppercase tracking-widest mb-1">HOME</div>
                   <div className="text-2xl md:text-3xl font-black tracking-tight text-white truncate">{match.homeTeam}</div>
                 </div>
                 <div className="px-3 text-center flex-shrink-0">
                   {(isFinished || isLive) && match.homeScore !== undefined && match.awayScore !== undefined ? (
                     <div className="flex flex-col items-center">
                       <div className={`text-4xl md:text-5xl font-black tracking-tighter font-mono ${isLive ? 'text-white' : 'text-white'}`}>
                         {match.homeScore} <span className="text-white/40 mx-1">-</span> {match.awayScore}
                       </div>
                       {isLive && (
                         <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-white/20 text-white text-xs font-bold backdrop-blur-sm">
                           <span className="relative flex h-1.5 w-1.5">
                             <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                             <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                           </span>
                           LIVE
                         </div>
                       )}
                       {isLive && scoreUpdateInfo && (
                         <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-white/60 flex-wrap">
                           <Clock className="w-3 h-3 flex-shrink-0" />
                           <span>比分更新 {scoreUpdateInfo.bjTime}</span>
                           <span className={scoreUpdateInfo.level === 'delayed' ? 'text-amber-300 font-medium' : ''}>
                             · {scoreUpdateInfo.text}
                           </span>
                         </div>
                       )}
                       {isFinished && match.homeHalfScore !== undefined && match.awayHalfScore !== undefined && (
                         <div className="text-xs text-white/60 font-mono mt-2">
                           半场 {match.homeHalfScore}-{match.awayHalfScore}
                         </div>
                       )}
                     </div>
                   ) : isFinishedPending ? (
                     <div className="text-lg text-white/50 font-medium">— : —</div>
                   ) : isUpcoming ? (
                     <div className="flex flex-col items-center">
                       <div className="text-3xl md:text-4xl font-black tracking-tighter text-white/90">VS</div>
                       {kickoffCountdown && (
                         <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-white text-xs font-mono font-bold backdrop-blur-sm border border-white/20">
                           <Timer className="w-3 h-3" />
                           开赛倒计时 {kickoffCountdown}
                         </div>
                       )}
                       {dataUpdateInfo && (
                         <div className="mt-2 flex items-center gap-1 text-xs text-white/50">
                           <RefreshCw className="w-3 h-3" />
                           <span>数据更新 · {dataUpdateInfo.text}</span>
                         </div>
                       )}
                     </div>
                   ) : (
                     <div className="text-2xl font-black text-white/70">VS</div>
                   )}
                 </div>
                 <div className="flex-1 text-right min-w-0">
                   <div className="text-xs text-white/50 uppercase tracking-widest mb-1 text-right">AWAY</div>
                   <div className="text-2xl md:text-3xl font-black tracking-tight text-white truncate">{match.awayTeam}</div>
                 </div>
               </div>
               {/* 完赛确认时间 */}
               {isFinished && finishedConfirmTime && (
                 <div className="text-center text-xs text-white/60 flex items-center justify-center gap-1 mb-3">
                   <Clock className="w-3 h-3" />
                   完赛确认于 {finishedConfirmTime}
                 </div>
               )}
               <div className="flex items-center justify-center gap-2 pt-4 border-t border-white/10">
                 <Clock className="w-4 h-4 text-white/50" />
                 <span className="text-white/60 text-sm">开赛时间（北京）</span>
                 <span className="text-white font-mono font-semibold flex items-center gap-1">
                   {formatBeijingTime(match.kickoffTime, 'datetime')}
                   {isNextDayEarlyMorning(match.kickoffTime) && isUpcoming && (
                     <span className="text-xs px-1.5 py-0.5 rounded bg-white/20 text-white font-bold ml-1">次日凌晨</span>
                   )}
                 </span>
               </div>
             </div>
             {/* 比赛编号 + 状态 */}
             <div className="flex items-center justify-center gap-3 mt-5">
               <span className="px-2 py-0.5 rounded bg-white/10 text-white/70 font-mono text-xs font-medium border border-white/10">
                 {match.matchNo}
               </span>
               <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${computedStatus && computedStatus !== 'live' ? (computedStatus === 'finished_pending' ? 'bg-blue-400/20 text-blue-200 border border-blue-400/30' : STATUS_STYLES[computedStatus]?.className || 'bg-white/10 text-white/70') : 'bg-white/10 text-white/80 border border-white/20'}`}>
                 {computedStatus ? MATCH_STATUS_TEXT[computedStatus] : status.label}
               </span>
             </div>
           </div>
         </section>

          <div className="px-4 md:px-6 py-6 space-y-6 max-w-2xl mx-auto">

          {/* 时间戳区块 */}
          <MatchTimestamps
            match={match}
            lastOddsUpdateAt={lastOddsUpdate || null}
            lastDataSyncAt={lastUpdateIso}
            sport="football"
          />

          {/* Tab 导航 */}
           <div className="sticky top-[60px] z-10 bg-background/95 backdrop-blur-md -mx-4 md:-mx-6 px-4 md:px-6 border-b border-gray-100">
            <div className="flex overflow-x-auto scrollbar-hide gap-6">
              {(['overview', 'deep', 'h2h', 'intel'] as const).map((tab) => (
                <button
                  key={tab}
                   onClick={() => handleActiveTabChange(tab)}
                  className={`flex-shrink-0 py-4 text-sm transition-all duration-300 border-b-2 ${
                     activeTab === tab
                       ? 'font-black tracking-tight text-nebula-crimson border-nebula-crimson'
                       : 'text-gray-400 hover:text-gray-600 border-transparent'
                  }`}
                >
                 {tab === 'overview'
                   ? '概览'
                   : tab === 'deep'
                   ? '深度分析'
                   : tab === 'h2h'
                   ? '历史交锋'
                   : '情报'}
               </button>
             ))}
           </div>
         </div>

         {/* 概览 Tab */}
         {activeTab === 'overview' && (
           <div className="space-y-6">

            {/* 1.5 模型预测速览四卡 */}
              <div className="metric-card p-6" data-ai-section-type="card-list">
               <div className="eyebrow eyebrow-line mb-3">PREDICTION OVERVIEW</div>
               <h2 className="text-2xl font-black tracking-tight text-foreground mb-5">模型输出速览<span className="ml-2 text-xs font-normal text-gray-400">仅供参考</span></h2>
               <div className="grid grid-cols-2 gap-3">
                 {/* 胜负走势 */}
                   <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                     <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">
                        胜负走势
                      {isLowConfidenceData && !wdwNotAnalyzed && (
                        <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded text-[9px] normal-case tracking-normal">数据不足</span>
                      )}
                    </div>
                     {isLowConfidenceData && !wdwNotAnalyzed ? (
                       <div className="text-sm text-gray-400 mt-1 leading-relaxed">
                         本场比赛数据样本不足，模型暂未给出明确模型倾向，建议谨慎参考
                       </div>
                     ) : (
                       <>
                         <div className={`text-lg font-black tracking-tight mb-1.5 ${
                           match.predictionDirection?.includes('主胜')
                             ? 'text-nebula-crimson'
                             : match.predictionDirection?.includes('客胜')
                             ? 'text-gray-700'
                             : match.predictionDirection?.includes('平')
                             ? 'text-gray-600'
                             : 'text-foreground'
                         }`}>
                           {match.predictionDirection || '--'}
                         </div>
                         <div className="flex items-center justify-between text-[11px] font-mono tabular-nums gap-1">
                           <span className={`font-bold ${match.predictionDirection?.includes('主胜') ? 'text-nebula-crimson' : 'text-gray-500'}`}>
                             主{Math.round(toProbPct(match.homeWinProb) ?? 0)}%
                           </span>
                           <span className={`font-bold ${match.predictionDirection?.includes('平') ? 'text-nebula-crimson' : 'text-gray-500'}`}>
                             平{Math.round(toProbPct(match.drawProb) ?? 0)}%
                           </span>
                           <span className={`font-bold ${match.predictionDirection?.includes('客胜') ? 'text-nebula-crimson' : 'text-gray-500'}`}>
                             客{Math.round(toProbPct(match.awayWinProb) ?? 0)}%
                           </span>
                         </div>
                       </>
                     )}
                  </div>
                 {/* 让分胜负走势 */}
                 <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">让分胜负走势</div>
                   {match.handicapRecommendation ? (
                     <>
                       <div className={`text-base font-black tracking-tight mb-1.5 ${
                         match.handicapRecommendation.includes('胜') || match.handicapRecommendation.includes('让胜')
                           ? 'text-nebula-crimson'
                           : match.handicapRecommendation.includes('负') || match.handicapRecommendation.includes('让负')
                           ? 'text-gray-700'
                           : match.handicapRecommendation.includes('平') || match.handicapRecommendation.includes('让平')
                           ? 'text-gray-600'
                           : 'text-foreground'
                       }`}>
                         {match.handicapRecommendation}（让{match.handicap}）
                       </div>
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums gap-1">
                      <span className={`font-bold ${
                        match.handicapRecommendation?.includes('主') || match.handicapRecommendation?.includes('让胜')
                          ? 'text-nebula-crimson' : 'text-gray-500'
                      }`}>
                         让胜{Math.round(match.handicapWinProb) + '%'}
                      </span>
                      <span className={`font-bold ${
                        match.handicapRecommendation?.includes('平') || match.handicapRecommendation?.includes('让平')
                          ? 'text-nebula-crimson' : 'text-gray-500'
                      }`}>
                         让平{Math.round(match.handicapDrawProb) + '%'}
                      </span>
                      <span className={`font-bold ${
                        match.handicapRecommendation?.includes('客') || match.handicapRecommendation?.includes('让负')
                          ? 'text-nebula-crimson' : 'text-gray-500'
                      }`}>
                         让负{Math.round(match.handicapLoseProb) + '%'}
                      </span>
                    </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">暂无可靠数据</div>
                  )}
                </div>
                 {/* 进球数 */}
                 <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">进球数</div>
                   {topTotalGoals ? (
                     <>
                       <div className="text-lg font-black tracking-tight text-nebula-crimson tabular-nums mb-1">
                         {topTotalGoals.goals}球
                       </div>
                       <div className="flex items-center justify-between text-[11px] font-mono tabular-nums gap-1">
                         <span className={`font-bold ${(toProbPct(match.overProb) ?? 0) >= (toProbPct(match.underProb) ?? 0) ? 'text-nebula-crimson' : 'text-gray-500'}`}>
                           大{Math.round(toProbPct(match.overProb) ?? 0)}%
                         </span>
                         <span className={`font-bold ${(toProbPct(match.underProb) ?? 0) > (toProbPct(match.overProb) ?? 0) ? 'text-nebula-crimson' : 'text-gray-500'}`}>
                           小{Math.round(toProbPct(match.underProb) ?? 0)}%
                         </span>
                       </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">暂无可靠数据</div>
                  )}
                </div>
                {/* 半全场 */}
                 <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mb-1">半全场数据参考</div>
                   {topHalfFull && toProbPct(topHalfFull.prob) !== null ? (
                     <>
                       <div className="text-lg font-black tracking-tight text-nebula-crimson tabular-nums">
                         {topHalfFull.code}
                       </div>
                       <div className="text-sm text-nebula-crimson font-black tabular-nums mt-1">
                         {Math.round(toProbPct(topHalfFull.prob) ?? 0)}%
                       </div>
                     </>
                   ) : (
                     <div className="text-xs text-gray-400">暂无可靠数据</div>
                   )}
                 </div>
              </div>
            </div>

         {/* 2. 赛果概率分析区块 */}
         <div className="metric-card p-6">
           <div className="eyebrow eyebrow-line mb-3">WIN PROBABILITY</div>
           <h2 className="text-2xl font-black tracking-tight text-foreground mb-5">赛果概率分析</h2>

             {wdwNotAnalyzed ? (
               <div className="py-6 text-center">
                 <p className="text-sm text-muted-foreground">
                   无赛前预测·不计入
                 </p>
               </div>
             ) : (
               <>
                 {/* 三段式大号概率条 */}
                 <div className="mb-5">
                   <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                     <div className="progress-gradient transition-all duration-[1.5s] ease-out" style={{ width: `${toProbPct(match.homeWinProb) ?? 0}%` }} />
                     <div className="bg-gray-300 transition-all duration-[1.5s] ease-out" style={{ width: `${toProbPct(match.drawProb) ?? 0}%` }} />
                     <div className="bg-gray-400 transition-all duration-[1.5s] ease-out" style={{ width: `${toProbPct(match.awayWinProb) ?? 0}%` }} />
                   </div>
                 </div>

                 {/* 概率数字大字号 */}
                 <div className="grid grid-cols-3 text-center mb-5">
                   <div>
                     <div className="text-4xl font-black text-nebula-crimson tabular-nums">{toProbPct(match.homeWinProb) ?? 0}%</div>
                     <div className="text-xs text-gray-400 mt-2">主胜</div>
                   </div>
                   <div>
                     <div className="text-4xl font-black text-gray-500 tabular-nums">{toProbPct(match.drawProb) ?? 0}%</div>
                     <div className="text-xs text-gray-400 mt-2">平局</div>
                   </div>
                   <div>
                     <div className="text-4xl font-black text-gray-500 tabular-nums">{toProbPct(match.awayWinProb) ?? 0}%</div>
                     <div className="text-xs text-gray-400 mt-2">客胜</div>
                   </div>
                 </div>
               </>
             )}

           {/* 分析方向标签 */}
           <div className="flex items-center justify-center pt-4 border-t border-gray-100">
             <span className={`inline-flex items-center px-6 py-2.5 rounded-xl text-lg font-black tracking-tight ${directionStyle}`}>
               {match.predictionDirection}
             </span>
           </div>
         </div>

         {/* 3. 让分指数分析区块 */}
           <div className="metric-card p-6 emphasis-bar pl-5">
             <div className="eyebrow eyebrow-line mb-3">HANDICAP ANALYSIS</div>
              <h2 className="text-2xl font-black tracking-tight text-foreground mb-4">让分指数分析</h2>
             <div className="flex items-center justify-between mb-4">
               <div className="flex items-center gap-3">
                  <span className="px-3 py-1.5 rounded-lg bg-muted text-foreground font-mono font-semibold text-lg">
                    {match.handicap}
                  </span>
                  <span className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary font-medium border border-primary/30 flex items-center gap-2">
                    {match.handicapRecommendation}

                  </span>
                </div>
             </div>
             <div className="grid grid-cols-3 gap-3 mb-4">
               <div className={`text-center py-3 rounded-xl ${
                 match.handicapRecommendation?.includes('主') || match.handicapRecommendation?.includes('让胜')
                   ? 'bg-primary/15 border border-primary/30'
                   : 'bg-muted/40 border border-transparent'
               }`}>
                 <div className="text-xs text-muted-foreground mb-1">让胜</div>
                 <div className={`text-xl font-mono font-bold tabular-nums ${
                   match.handicapRecommendation?.includes('主') || match.handicapRecommendation?.includes('让胜')
                     ? 'text-primary' : 'text-foreground'
                 }`}>
                   {match.handicapValueType === 'none'
                     ? '--'
                     : `${Math.round(match.handicapWinProb)}%`}
                 </div>
               </div>
               <div className={`text-center py-3 rounded-xl ${
                 match.handicapRecommendation?.includes('平') || match.handicapRecommendation?.includes('让平')
                   ? 'bg-primary/15 border border-primary/30'
                   : 'bg-muted/40 border border-transparent'
               }`}>
                 <div className="text-xs text-muted-foreground mb-1">让平</div>
                 <div className={`text-xl font-mono font-bold tabular-nums ${
                   match.handicapRecommendation?.includes('平') || match.handicapRecommendation?.includes('让平')
                     ? 'text-primary' : 'text-foreground'
                 }`}>
                   {match.handicapValueType === 'none'
                     ? '--'
                     : `${Math.round(match.handicapDrawProb)}%`}
                 </div>
               </div>
               <div className={`text-center py-3 rounded-xl ${
                 match.handicapRecommendation?.includes('客') || match.handicapRecommendation?.includes('让负')
                   ? 'bg-primary/15 border border-primary/30'
                   : 'bg-muted/40 border border-transparent'
               }`}>
                 <div className="text-xs text-muted-foreground mb-1">让负</div>
                 <div className={`text-xl font-mono font-bold tabular-nums ${
                   match.handicapRecommendation?.includes('客') || match.handicapRecommendation?.includes('让负')
                     ? 'text-primary' : 'text-foreground'
                 }`}>
                   {match.handicapValueType === 'none'
                     ? '--'
                     : `${Math.round(match.handicapLoseProb)}%`}
                 </div>
               </div>
             </div>
             <p className="text-sm text-muted-foreground mt-3">
               {match.handicapRecommendation.includes('胜')
                 ? '主队让出对应球数后仍可获胜，实力差距明显'
                 : match.handicapRecommendation.includes('平')
                 ? '让出球数后双方实力接近，平局可能性大'
                 : '客队受让后实力占优，看好客队方向'}
             </p>
             {match.handicapDrawProb >= 30 && !match.handicapRecommendation?.includes('平') && !match.handicapRecommendation?.includes('让平') && (
               <div className="mt-3 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
                 <span className="text-amber-600 font-semibold text-xs flex-shrink-0 mt-0.5">⚠ 胶着盘·让平风险</span>
                 <p className="text-xs text-amber-700/90 leading-relaxed">
                   本场让平概率达 <span className="font-bold">{Math.round(match.handicapDrawProb)}%</span>，三态分布接近，推荐方向与让平的差距有限。
                   建议关注让平赛果的可能性，谨慎参考模型方向。
                 </p>
               </div>
             )}
          </div>

         {/* 4. 进球数分析 */}
         {(totalAnalyzed || (!isDefaultMostLikelyScore && match.mostLikelyScore)) && (
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="metric-card p-6 emphasis-bar pl-5">
              <div className="eyebrow eyebrow-line mb-3">GOALS ANALYSIS</div>
              <h3 className="text-xl font-black tracking-tight text-foreground mb-4">进球数分析</h3>
              <div className="text-xs text-muted-foreground mb-2">
                预期进球 <span className="text-foreground font-mono font-medium">{match.totalGoals?.toFixed(1) ?? '-'}</span>
              </div>
              <div className="space-y-2">
                {(match.totalGoalsProb ?? []).map((item: TotalGoalsProbItem) => (
                  <div key={item.goals}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-foreground">{item.goals}</span>
                      <span className="font-mono text-muted-foreground">{Math.round(item.prob)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full progress-gradient rounded-full transition-all duration-[1.5s] ease-out" style={{ width: `${Math.min(Math.round(item.prob), 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="metric-card p-6 emphasis-bar pl-5">
              <div className="eyebrow eyebrow-line mb-3">xG & SCORELINE</div>
              <h3 className="text-xl font-black tracking-tight text-foreground mb-4">预期进球与比分</h3>
              <div className="mb-3">
                 <div className="text-xs text-muted-foreground mb-1">预期进球数</div>
                  <div className="text-3xl font-black text-nebula-crimson tabular-nums">
                    {totalAnalyzed ? match.totalGoals?.toFixed(1) ?? '-' : '数据待补'}
                  </div>
              </div>
              <div className="pt-4 border-t border-gray-100 mt-4">
                <div className="text-xs text-gray-400 mb-1">最可能比分</div>
                <div className="text-xl font-black text-foreground tabular-nums">
                  {isDefaultMostLikelyScore ? '数据待补' : (match.mostLikelyScore ?? '-')}
                </div>
              </div>
            </div>
           </div>
         )}

         {/* 4.5 预期进球数分布 */}
        {totalAnalyzed && totalGoalsProb.length > 0 ? (
            <div className="metric-card p-6 emphasis-bar pl-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div>
                    <div className="eyebrow eyebrow-line mb-2">GOALS DISTRIBUTION</div>
                    <h2 className="text-2xl font-black tracking-tight text-foreground">预期进球数分布</h2>
                  </div>
                  {isFinished && match.hitGoals !== undefined && (
                    <span className={`text-sm ${match.hitGoals ? 'text-home-win' : 'text-away-win'}`}>
                      {match.hitGoals ? '✅' : '❌'}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-gray-400">预期进球数</div>
                  <div className="text-lg font-black text-nebula-crimson tabular-nums">
                    {match.totalGoals?.toFixed(1) ?? '-'} 球
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                {totalGoalsProb.map((item) => {
                  const isTop = topTotalGoals?.goals === item.goals;
                  const widthPct = maxTotalGoalsProb > 0 ? (item.prob / maxTotalGoalsProb) * 100 : 0;
                  return (
                    <div key={item.goals} className="flex items-center gap-3">
                      <span
                        className={`w-10 text-left text-sm font-medium flex-shrink-0 ${isTop ? 'text-accent' : 'text-foreground'}`}
                      >
                        {item.goals}球
                      </span>
                       <div className="flex-1 h-3 rounded-full bg-gray-100 overflow-hidden">
                         <div
                           className={`h-full rounded-full transition-all duration-[1.5s] ease-out ${isTop ? 'progress-gradient' : 'bg-nebula-crimson/40'}`}
                           style={{ width: `${Math.min(widthPct, 100)}%` }}
                         />
                      </div>
                      <span
                        className={`w-12 text-right text-xs font-mono flex-shrink-0 ${isTop ? 'text-accent font-semibold' : 'text-muted-foreground'}`}
                      >
                         {Math.round(item.prob)}%
                      </span>
                    </div>
                  );
                })}
              </div>
              {topTotalGoals && (
                 <div className="mt-4 pt-4 border-t border-gray-100 text-center">
                  <span className="text-xs text-muted-foreground">最可能进球数：</span>
                  <span className="text-sm font-semibold text-accent">{topTotalGoals.goals}球</span>
                </div>
              )}
            </div>
         ) : null}

         {/* 4.8 关键球员 */}
         {(() => {
           const homeParsed = parseKeyPlayers(match.keyPlayersHome);
           const awayParsed = parseKeyPlayers(match.keyPlayersAway);
           if (!homeParsed && !awayParsed) return null;
           const homeArr = Array.isArray(homeParsed) ? homeParsed : null;
           const awayArr = Array.isArray(awayParsed) ? awayParsed : null;
           const homeText = typeof homeParsed === 'string' ? homeParsed : null;
           const awayText = typeof awayParsed === 'string' ? awayParsed : null;
           return (
           <div className="metric-card p-6 emphasis-bar pl-5">
             <div className="eyebrow eyebrow-line mb-3">KEY PLAYERS</div>
             <h2 className="text-2xl font-black tracking-tight text-foreground mb-5">关键球员</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-xs text-home-win font-medium mb-2">{match.homeTeam}</div>
                  {homeArr ? (
                    homeArr.length > 0 ? (
                      homeArr.map((player, idx) => {
                        const badges = getPlayerBadges(player, homeArr);
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              setSelectedPlayer(player);
                              setPlayerDialogOpen(true);
                            }}
                            className="w-full p-3 rounded-lg bg-muted/40 border border-border/60 hover:bg-muted/60 hover:border-border transition-all text-left"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                <User className="w-5 h-5 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-medium text-foreground truncate">{player.name}</span>
                                  {badges.map((b) => (
                                    <span key={b} className="px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0 bg-accent/20 text-accent border border-accent/30">
                                      {b}
                                    </span>
                                  ))}
                                </div>
                                <div className="text-xs text-muted-foreground">{player.position || '-'}</div>
                                <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                                  {player.goals && player.goals > 0 ? `${player.goals}球 ` : ''}
                                  {player.assists && player.assists > 0 ? `${player.assists}助` : ''}
                                </div>
                              </div>
                              {player.rating && player.rating > 0 ? (
                                <div className={`text-xl font-mono font-bold flex-shrink-0 ${getRatingColor(player.rating)}`}>
                                  {player.rating.toFixed(1)}
                                </div>
                               ) : null}
                       {(!injuries?.home?.length && !match.homeInjuries) && (
                         <div className="py-4 text-center text-xs text-muted-foreground rounded-lg bg-muted/30">
                           暂无可靠数据
                         </div>
                       )}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="text-xs text-muted-foreground">暂无可靠数据</div>
                    )
                  ) : homeText ? (
                    <div className="p-3 rounded-lg bg-muted/40 border border-border/60">
                      <p className="text-xs text-foreground/80 leading-relaxed">{homeText}</p>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">暂无可靠数据</div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-away-win font-medium mb-2">{match.awayTeam}</div>
                  {awayArr ? (
                    awayArr.length > 0 ? (
                      awayArr.map((player, idx) => {
                        const badges = getPlayerBadges(player, awayArr);
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              setSelectedPlayer(player);
                              setPlayerDialogOpen(true);
                            }}
                            className="w-full p-3 rounded-lg bg-muted/40 border border-border/60 hover:bg-muted/60 hover:border-border transition-all text-left"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                <User className="w-5 h-5 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-medium text-foreground truncate">{player.name}</span>
                                  {badges.map((b) => (
                                    <span key={b} className="px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0 bg-accent/20 text-accent border border-accent/30">
                                      {b}
                                    </span>
                                  ))}
                                </div>
                                <div className="text-xs text-muted-foreground">{player.position || '-'}</div>
                                <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                                  {player.goals && player.goals > 0 ? `${player.goals}球 ` : ''}
                                  {player.assists && player.assists > 0 ? `${player.assists}助` : ''}
                                </div>
                              </div>
                              {player.rating && player.rating > 0 ? (
                                <div className={`text-xl font-mono font-bold flex-shrink-0 ${getRatingColor(player.rating)}`}>
                                  {player.rating.toFixed(1)}
                                </div>
                               ) : null}
                       {(!injuries?.home?.length && !match.homeInjuries) && (
                         <div className="py-4 text-center text-xs text-muted-foreground rounded-lg bg-muted/30">
                           暂无可靠数据
                         </div>
                       )}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="text-xs text-muted-foreground">暂无可靠数据</div>
                    )
                  ) : awayText ? (
                    <div className="p-3 rounded-lg bg-muted/40 border border-border/60">
                      <p className="text-xs text-foreground/80 leading-relaxed">{awayText}</p>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">暂无可靠数据</div>
                  )}
                </div>
              </div>
          </div>
           );
         })()}

        {/* 4.9 战术分析 */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="w-5 h-5 text-cyan-400" />
              <h2 className="text-lg font-semibold text-foreground">战术分析</h2>
            </div>
            {match.tacticsHome || match.tacticsAway ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {match.tacticsHome && (
                <div className="p-3 rounded-lg bg-home-win/5 border border-home-win/20">
                  <div className="text-xs font-medium text-home-win mb-1.5">{match.homeTeam}</div>
                  <p className="text-xs text-foreground/80 leading-relaxed">{match.tacticsHome}</p>
                </div>
              )}
              {match.tacticsAway && (
                <div className="p-3 rounded-lg bg-away-win/5 border border-away-win/20">
                  <div className="text-xs font-medium text-away-win mb-1.5">{match.awayTeam}</div>
                  <p className="text-xs text-foreground/80 leading-relaxed">{match.tacticsAway}</p>
                </div>
              )}
            </div>
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">
                暂无可靠数据
              </div>
            )}
          </div>

        {/* 4.10 关键球员概述 */}
        {(() => {
          const hasHome = !!match.keyPlayersHome && !PLACEHOLDER_PATTERNS.test(match.keyPlayersHome.trim()) && match.keyPlayersHome.trim().length >= 4;
          const hasAway = !!match.keyPlayersAway && !PLACEHOLDER_PATTERNS.test(match.keyPlayersAway.trim()) && match.keyPlayersAway.trim().length >= 4;
          if (!hasHome && !hasAway) return null;
          return (
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Crosshair className="w-5 h-5 text-orange-400" />
                <h2 className="text-lg font-semibold text-foreground">关键球员</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {hasHome && (
                  <div className="p-3 rounded-lg bg-home-win/5 border border-home-win/20">
                    <div className="text-xs font-medium text-home-win mb-1.5">{match.homeTeam}</div>
                    <p className="text-xs text-foreground/80 leading-relaxed">{match.keyPlayersHome}</p>
                  </div>
                )}
                {hasAway && (
                  <div className="p-3 rounded-lg bg-away-win/5 border border-away-win/20">
                    <div className="text-xs font-medium text-away-win mb-1.5">{match.awayTeam}</div>
                    <p className="text-xs text-foreground/80 leading-relaxed">{match.keyPlayersAway}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* 4.11 冷门预警 */}
        {match.upsetWarning && (
          <div className="bg-gradient-to-r from-warning/10 to-away-win/10 border border-warning/40 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-warning" />
              <h2 className="text-lg font-semibold text-foreground">冷门预警</h2>
            </div>
            <p className="text-sm text-foreground/85 leading-relaxed">{match.upsetWarning}</p>
          </div>
        )}

        {/* 5. 比分概率 Top5 */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">比分概率分布 Top 5</h2>
            </div>
            {scoreProbs.length > 0 ? (
              <div className="space-y-2.5">
              {scoreProbs.map((item, idx) => {
                const isTop = idx === 0;
                const barColor = item.prob >= 12
                  ? 'bg-gradient-to-r from-home-win to-home-win/70'
                  : item.prob >= 7
                    ? 'bg-gradient-to-r from-accent to-accent/70'
                    : 'bg-gradient-to-r from-muted-foreground/40 to-muted-foreground/20';
                return (
                  <div key={idx} className="flex items-center gap-3">
                    <span
                      className={`w-14 text-left text-sm font-mono font-semibold flex-shrink-0 whitespace-nowrap ${
                        isTop ? 'text-accent' : 'text-foreground'
                      }`}
                    >
                      {item.score}
                    </span>
                    <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${Math.min(item.prob, 100)}%` }}
                      />
                    </div>
                    <span
                      className={`w-12 text-right text-xs font-mono flex-shrink-0 whitespace-nowrap ${
                        isTop ? 'text-accent font-semibold' : 'text-muted-foreground'
                      }`}
                    >
                       {Math.round(item.prob)}%
                    </span>
                  </div>
                );
               })}
             </div>
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">
                暂无可靠数据
              </div>
            )}
          </div>

        {/* 5.5 半场全场分析 */}
            <div className="metric-card p-6 emphasis-bar pl-5">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="eyebrow eyebrow-line mb-2">HALF / FULL TIME</div>
                  <h2 className="text-2xl font-black tracking-tight text-foreground">半场全场分析</h2>
                </div>
                {isFinished && match.hitHalffull !== undefined && (
                  <span className={`text-sm ${match.hitHalffull ? 'text-home-win' : 'text-away-win'}`}>
                    {match.hitHalffull ? '✅' : '❌'}
                  </span>
                )}
              </div>
               {halfFullProb.length > 0 ? (
                 <>
               <div className="grid grid-cols-3 gap-2">
                {['胜胜', '胜平', '胜负', '平胜', '平平', '平负', '负胜', '负平', '负负'].map((code) => {
                  const prob = halfFullMap.get(code);
                  const isTop = topHalfFull?.code === code;
                  return (
                    <div
                      key={code}
                      className={`rounded-lg border p-2.5 text-center transition-colors ${
                        isTop
                          ? 'bg-accent/20 border-accent/50 text-accent'
                          : 'bg-muted/40 border-border/60 text-foreground'
                      }`}
                    >
                      <div className="text-xs font-medium mb-1">{code}</div>
                       <div className="text-sm font-mono font-semibold">
                         {prob !== null && prob !== undefined ? `${Math.round(prob)}%` : '—'}
                       </div>
                    </div>
                  );
                })}
               </div>
                 </>
               ) : (
                 <div className="py-6 text-center text-sm text-muted-foreground">
                   暂无可靠数据
                 </div>
               )}
           </div>

           </div>
         )}

         {/* 深度分析 Tab */}
         {activeTab === 'deep' && (
             <DeepAnalysisTab match={match} />
         )}

          {/* 情报 Tab */}
          {activeTab === 'intel' && (
             <div className="space-y-6">
        {/* 7. 球队情报 Tab */}
           <div className="metric-card p-6 emphasis-bar pl-5">
             <div className="eyebrow eyebrow-line mb-3">TEAM INTEL</div>
             <h2 className="text-2xl font-black tracking-tight text-foreground mb-5">球队情报</h2>

            {/* Tab 切换 */}
            <div className="flex gap-1 mb-4 bg-muted/50 rounded-lg p-1">
              {(['form', 'attack', 'homeAway', 'injuries'] as const).map((tab) => (
                <button
                  key={tab}
                   onClick={() => handleIntelTabChange(tab)}
                  className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    intelTab === tab ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab === 'form' ? '近期战绩' : tab === 'attack' ? '攻防数据' : tab === 'homeAway' ? '主客场' : '伤停'}
                </button>
              ))}
            </div>

              {intelTab === 'form' && (
                <div className="space-y-5">
                  {/* 近期战绩趋势图 */}
                  {(() => {
                    const homeTrend = parseFormForTrend(match.homeForm || []).slice(0, 10);
                    const awayTrend = parseFormForTrend(match.awayForm || []).slice(0, 10);
                    const hasTrendData = homeTrend.length > 0 || awayTrend.length > 0;
                    const maxLen = Math.max(homeTrend.length, awayTrend.length);
                    if (!hasTrendData) {
                      return (
                        <div className="py-8 text-center rounded-lg bg-muted/30 border border-border/40">
                          <TrendingUp className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">暂无近期战绩数据</p>
                        </div>
                      );
                    }
                    const xLabels = Array.from({ length: maxLen }, (_, i) => `第${i + 1}场`);
                    const homeDiffs = homeTrend.map((t) => t.goalDiff);
                    const awayDiffs = awayTrend.map((t) => -t.goalDiff); // 客队用负值朝下表示
                    const homeStats = countFormResults(homeTrend);
                    const awayStats = countFormResults(awayTrend);

                    const trendOption: EChartsOption = {
                      tooltip: {
                        trigger: 'axis',
                        backgroundColor: '#fff',
                        borderColor: '#F3F4F6',
                        textStyle: { color: '#111827', fontSize: 12 },
                      },
                      legend: {
                        bottom: 0,
                        textStyle: { fontSize: 12, color: '#6B7280' },
                        icon: 'rect',
                        itemWidth: 12,
                        itemHeight: 3,
                      },
                      grid: {
                        left: 40,
                        right: 20,
                        top: 20,
                        bottom: 40,
                        containLabel: true,
                      },
                      xAxis: {
                        type: 'category',
                        data: xLabels,
                        axisLabel: { fontSize: 10, color: '#9CA3AF', interval: 0 },
                        axisLine: { lineStyle: { color: '#F3F4F6' } },
                        axisTick: { show: false },
                      },
                      yAxis: {
                        type: 'value',
                        name: '进失球差',
                        nameTextStyle: { fontSize: 10, color: '#9CA3AF' },
                        axisLabel: { fontSize: 10, color: '#9CA3AF' },
                        splitLine: { lineStyle: { color: '#F3F4F6', type: 'dashed' } },
                        axisLine: { show: false },
                        axisTick: { show: false },
                      },
                      series: [
                        {
                          name: `${match.homeTeam} 进球差`,
                          type: 'bar',
                          data: homeDiffs,
                          itemStyle: { color: '#8B0000', borderRadius: [3, 3, 0, 0] },
                          barWidth: 10,
                        },
                        {
                          name: `${match.awayTeam} 进球差`,
                          type: 'bar',
                          data: awayDiffs,
                          itemStyle: { color: '#CD5C5C', borderRadius: [3, 3, 0, 0] },
                          barWidth: 10,
                        },
                      ],
                    };

                    return (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="eyebrow eyebrow-line mb-1.5">FORM TREND</div>
                            <h3 className="text-base font-black tracking-tight text-foreground">近期战绩趋势</h3>
                          </div>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">近{maxLen}场</span>
                        </div>
                        <div className="h-[280px] bg-muted/20 rounded-lg border border-border/40 p-2">
                          <ReactECharts option={trendOption} style={{ height: '100%', width: '100%' }} notMerge lazyUpdate />
                        </div>
                        {/* 胜负分布指标卡 */}
                        <div className="grid grid-cols-3 gap-3 mt-4">
                          <div className="p-3 rounded-lg bg-home-win/5 border border-home-win/20 text-center">
                            <div className="text-[10px] uppercase tracking-wider text-home-win/70 mb-1">胜</div>
                            <div className="flex justify-center gap-3">
                              <div>
                                <div className="text-xl font-black text-home-win tabular-nums">{homeStats.win}</div>
                                <div className="text-[9px] text-muted-foreground mt-0.5">主队</div>
                              </div>
                              <div className="w-px bg-border/40" />
                              <div>
                                <div className="text-xl font-black text-away-win tabular-nums">{awayStats.win}</div>
                                <div className="text-[9px] text-muted-foreground mt-0.5">客队</div>
                              </div>
                            </div>
                          </div>
                          <div className="p-3 rounded-lg bg-draw/5 border border-draw/20 text-center">
                            <div className="text-[10px] uppercase tracking-wider text-draw/70 mb-1">平</div>
                            <div className="flex justify-center gap-3">
                              <div>
                                <div className="text-xl font-black text-draw tabular-nums">{homeStats.draw}</div>
                                <div className="text-[9px] text-muted-foreground mt-0.5">主队</div>
                              </div>
                              <div className="w-px bg-border/40" />
                              <div>
                                <div className="text-xl font-black text-draw tabular-nums">{awayStats.draw}</div>
                                <div className="text-[9px] text-muted-foreground mt-0.5">客队</div>
                              </div>
                            </div>
                          </div>
                          <div className="p-3 rounded-lg bg-away-win/5 border border-away-win/20 text-center">
                            <div className="text-[10px] uppercase tracking-wider text-away-win/70 mb-1">负</div>
                            <div className="flex justify-center gap-3">
                              <div>
                                <div className="text-xl font-black text-away-win tabular-nums">{homeStats.loss}</div>
                                <div className="text-[9px] text-muted-foreground mt-0.5">主队</div>
                              </div>
                              <div className="w-px bg-border/40" />
                              <div>
                                <div className="text-xl font-black text-home-win tabular-nums">{awayStats.loss}</div>
                                <div className="text-[9px] text-muted-foreground mt-0.5">客队</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                   <div className="text-sm font-medium text-home-win mb-2">{match.homeTeam}（主）近期战绩</div>
                   {homeForm.length > 0 ? (
                     <div className="space-y-1.5">
                       {homeForm.map((r, i) => {
                         const detail = parseFormDetail(r);
                         return (
                           <div
                             key={i}
                             className="flex items-center gap-2 py-2 px-3 rounded-lg bg-muted/30 border border-border/40"
                           >
                             <div
                               className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold text-white shrink-0 ${getFormColor(detail.result)}`}
                             >
                               {getFormLabel(detail.result)}
                             </div>
                             {detail.isSimple ? (
                               <div className="text-xs text-muted-foreground">—</div>
                             ) : (
                               <>
                                 <span className="text-sm text-foreground flex-1 truncate">
                                   vs {detail.opponent}
                                 </span>
                                 <span className="text-sm font-mono font-medium text-foreground/90">
                                   {detail.score}
                                 </span>
                               </>
                             )}
                           </div>
                         );
                       })}
                     </div>
                    ) : (
                      <div className="py-4 text-center text-xs text-gray-400 rounded-lg bg-muted/30">
                        暂无数据
                      </div>
                    )}
                  </div>
                  <div className="pt-3 border-t border-border/60">
                    <div className="text-sm font-medium text-away-win mb-2">{match.awayTeam}（客）近期战绩</div>
                    {awayForm.length > 0 ? (
                     <div className="space-y-1.5">
                       {awayForm.map((r, i) => {
                         const detail = parseFormDetail(r);
                         return (
                           <div
                             key={i}
                             className="flex items-center gap-2 py-2 px-3 rounded-lg bg-muted/30 border border-border/40"
                           >
                             <div
                               className={`w-7 h-7 rounded flex items-center justify-center text-xs font-bold text-white shrink-0 ${getFormColor(detail.result)}`}
                             >
                               {getFormLabel(detail.result)}
                             </div>
                             {detail.isSimple ? (
                               <div className="text-xs text-muted-foreground">—</div>
                             ) : (
                               <>
                                 <span className="text-sm text-foreground flex-1 truncate">
                                   vs {detail.opponent}
                                 </span>
                                 <span className="text-sm font-mono font-medium text-foreground/90">
                                   {detail.score}
                                 </span>
                               </>
                             )}
                           </div>
                         );
                       })}
                     </div>
                     ) : (
                       <div className="py-4 text-center text-xs text-gray-400 rounded-lg bg-muted/30">
                         暂无数据
                       </div>
                     )}
                   </div>
                 </div>
               )}

             {intelTab === 'attack' && (
              <div className="space-y-3">
                {[
                  {
                    label: '场均进球',
                    homeVal: match.homeGoalsAvg,
                    awayVal: match.awayGoalsAvg,
                    unit: '球/场',
                    max: 4.0,
                    homeColor: 'bg-green-500',
                    awayColor: 'bg-red-500',
                    hasData: match.homeGoalsAvg > 0 || match.awayGoalsAvg > 0,
                  },
                  {
                    label: '场均失球',
                    homeVal: match.homeConcededAvg,
                    awayVal: match.awayConcededAvg,
                    unit: '球/场',
                    max: 3.0,
                    homeColor: 'bg-red-500',
                    awayColor: 'bg-green-500',
                    hasData: match.homeConcededAvg > 0 || match.awayConcededAvg > 0,
                  },
                  {
                    label: '场均射门',
                    homeVal: match.advancedStats?.shotsHome ?? 0,
                    awayVal: match.advancedStats?.shotsAway ?? 0,
                    unit: '次',
                    max: 20,
                    homeColor: 'bg-home-win',
                    awayColor: 'bg-away-win',
                    hasData: (match.advancedStats?.shotsHome ?? 0) > 0 || (match.advancedStats?.shotsAway ?? 0) > 0,
                  },
                  {
                    label: '场均射正',
                    homeVal: match.advancedStats?.shotsOnTargetHome ?? 0,
                    awayVal: match.advancedStats?.shotsOnTargetAway ?? 0,
                    unit: '次',
                    max: 8,
                    homeColor: 'bg-home-win',
                    awayColor: 'bg-away-win',
                    hasData: (match.advancedStats?.shotsOnTargetHome ?? 0) > 0 || (match.advancedStats?.shotsOnTargetAway ?? 0) > 0,
                  },
                  {
                    label: '控球率',
                    homeVal: match.advancedStats?.possessionHome ?? 50,
                    awayVal: match.advancedStats?.possessionAway ?? 50,
                    unit: '%',
                    max: 100,
                    homeColor: 'bg-home-win',
                    awayColor: 'bg-away-win',
                    isPercent: true,
                    hasData: (match.advancedStats?.possessionHome ?? 0) > 0 || (match.advancedStats?.possessionAway ?? 0) > 0,
                  },
                  {
                    label: '传球成功率',
                    homeVal: match.advancedStats?.passAccuracyHome ?? 0,
                    awayVal: match.advancedStats?.passAccuracyAway ?? 0,
                    unit: '%',
                    max: 100,
                    homeColor: 'bg-home-win',
                    awayColor: 'bg-away-win',
                    isPercent: true,
                    hasData: (match.advancedStats?.passAccuracyHome ?? 0) > 0 || (match.advancedStats?.passAccuracyAway ?? 0) > 0,
                  },
                ].map((stat) => (
                  <div key={stat.label}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-home-win font-mono w-12 text-right">
                        {stat.hasData
                          ? stat.isPercent
                            ? `${stat.homeVal}${stat.unit}`
                            : `${Number(stat.homeVal).toFixed(2)} ${stat.unit}`
                          : '—'}
                      </span>
                      <span className="text-muted-foreground flex-1 text-center">{stat.label}</span>
                      <span className="text-away-win font-mono w-12 text-left">
                        {stat.hasData
                          ? stat.isPercent
                            ? `${stat.awayVal}${stat.unit}`
                            : `${Number(stat.awayVal).toFixed(2)} ${stat.unit}`
                          : '—'}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <div className="flex-1 h-2 rounded-sm bg-card border border-border/60 overflow-hidden flex justify-end">
                        <div
                          className={`h-full ${stat.homeColor} transition-all`}
                          style={{ width: stat.hasData ? `${Math.min((stat.homeVal / stat.max) * 100, 100)}%` : '0%' }}
                        />
                      </div>
                      <div className="flex-1 h-2 rounded-sm bg-card border border-border/60 overflow-hidden">
                        <div
                          className={`h-full ${stat.awayColor} transition-all`}
                          style={{ width: stat.hasData ? `${Math.min((stat.awayVal / stat.max) * 100, 100)}%` : '0%' }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {intelTab === 'homeAway' && (
                  (match.homeHomeRecord || match.awayAwayRecord) ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {match.homeHomeRecord && (
                      <div className="p-3.5 rounded-lg bg-muted/40 border border-border/60">
                        <div className="text-sm text-home-win font-medium mb-2">{match.homeTeam}（主场）</div>
                        <p className="text-sm text-foreground/80 leading-relaxed">
                          {match.homeHomeRecord}
                        </p>
                      </div>
                    )}
                    {match.awayAwayRecord && (
                      <div className="p-3.5 rounded-lg bg-muted/40 border border-border/60">
                        <div className="text-sm text-away-win font-medium mb-2">{match.awayTeam}（客场）</div>
                        <p className="text-sm text-foreground/80 leading-relaxed">
                          {match.awayAwayRecord}
                        </p>
                      </div>
                    )}
                  </div>
                  ) : (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      暂无可靠数据
                    </div>
                  )
             )}

            {intelTab === 'injuries' && (
               <div className="space-y-5">
                  {/* 数据来源 */}
                  {injuries?.dataSources && injuries.dataSources.length > 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Database className="w-3.5 h-3.5" />
                      <span>数据来源：{injuries.dataSources.map((s) => {
                        if (s === 'sina') return '新浪足彩伤停';
                        if (s === 'espn') return 'ESPN';
                        return s;
                      }).join('、')}</span>
                    </div>
                  )}

                  {/* 伤停调整参考 */}
                  {(() => {
                    const r80 = match.intelAdjustments?.r80Injury;
                    const hasR80 = !!r80 && (
                      (r80.spread !== undefined && r80.spread !== 0) ||
                      (r80.total !== undefined && r80.total !== 0) ||
                      r80.homeCoreMissing > 0 ||
                      r80.awayCoreMissing > 0
                    );
                    const rInjuryRules = (match.modelRules || []).filter((r: string) => r.startsWith('R-INJURY'));
                    const hasAny = hasR80 || rInjuryRules.length > 0;
                    if (!hasAny) return null;

                    return (
                      <div className="p-4 rounded-xl border border-home-win/30 bg-home-win/[0.03] shadow-sm">
                        <div className="text-sm font-semibold mb-3 text-foreground flex items-center gap-2">
                          <span className="w-1 h-4 rounded-full bg-home-win" />
                          伤停调整参考
                          {match.isOfficialLocked && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 border border-yellow-500/20 ml-auto font-medium">
                              参考值·不改变锁定预测
                            </span>
                          )}
                        </div>

                        {hasR80 && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="p-3 rounded-lg bg-card border border-border">
                                <div className="text-[10px] text-muted-foreground mb-1">让球调整</div>
                                <div className={`text-xl font-black font-mono ${r80.spread > 0 ? 'text-home-win' : r80.spread < 0 ? 'text-away-win' : 'text-muted-foreground'}`}>
                                  {r80.spread > 0 ? '+' : ''}{r80.spread.toFixed(1)} 球
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  {r80.spread > 0 ? '主强方向上调' : r80.spread < 0 ? '客强方向下调' : '无调整'}
                                </div>
                              </div>
                              <div className="p-3 rounded-lg bg-card border border-border">
                                <div className="text-[10px] text-muted-foreground mb-1">大小球调整</div>
                                <div className={`text-xl font-black font-mono ${r80.total > 0 ? 'text-basketball-orange' : r80.total < 0 ? 'text-away-win' : 'text-muted-foreground'}`}>
                                  {r80.total > 0 ? '+' : ''}{r80.total.toFixed(1)} 球
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  {r80.total > 0 ? '偏大上调' : r80.total < 0 ? '偏小下调' : '无调整'}
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div className="p-3 rounded-lg bg-home-win/5 border border-home-win/20">
                                <div className="text-[10px] text-muted-foreground mb-1">{match.homeTeam} 核心缺阵</div>
                                <div className="text-xl font-black font-mono text-home-win">
                                  {r80.homeCoreMissing} 人
                                </div>
                              </div>
                              <div className="p-3 rounded-lg bg-away-win/5 border border-away-win/20">
                                <div className="text-[10px] text-muted-foreground mb-1">{match.awayTeam} 核心缺阵</div>
                                <div className="text-xl font-black font-mono text-away-win">
                                  {r80.awayCoreMissing} 人
                                </div>
                              </div>
                            </div>

                            {r80.detail && (
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                <span className="text-muted-foreground/60">详情：</span>{r80.detail}
                              </p>
                            )}

                            {r80.injuryRules && r80.injuryRules.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {r80.injuryRules.map((rule: string) => (
                                  <span
                                    key={rule}
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-home-win/10 text-home-win font-medium border border-home-win/20"
                                  >
                                    {rule}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {!hasR80 && rInjuryRules.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              模型触发伤停相关规则，但未达到独立调整阈值
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {rInjuryRules.map((rule: string) => (
                                <span
                                  key={rule}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-home-win/10 text-home-win font-medium border border-home-win/20"
                                >
                                  {rule}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {('injuryAdjustApplied' in match) && (match as { injuryAdjustApplied?: number }).injuryAdjustApplied !== undefined && (match as { injuryAdjustApplied?: number }).injuryAdjustApplied !== 0 && (
                          <p className="text-[10px] text-muted-foreground/60 mt-3 pt-2 border-t border-border/60 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            融合调整让球 {(match as { injuryAdjustApplied?: number }).injuryAdjustApplied! > 0 ? '+' : ''}{Number((match as { injuryAdjustApplied?: number }).injuryAdjustApplied).toFixed(2)}
                            {match.isOfficialLocked ? '（冻结场仅参考，未写入预测）' : ''}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* 阵容完整度评分 */}
                  {(() => {
                   const hasStructuredHome = injuries?.home && injuries.home.length > 0;
                   const hasStructuredAway = injuries?.away && injuries.away.length > 0;
                   const hasTextHome = !!match.homeInjuries && match.homeInjuries.trim().length > 0;
                   const hasTextAway = !!match.awayInjuries && match.awayInjuries.trim().length > 0;
                   const hasAnyData = hasStructuredHome || hasTextHome || hasStructuredAway || hasTextAway;

                   if (!hasAnyData) {
                     return (
                       <div className="py-8 text-center rounded-lg bg-muted/30 border border-border/40">
                         <AlertTriangle className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                         <p className="text-sm text-muted-foreground">暂无伤停数据</p>
                       </div>
                     );
                   }

                   // 计算阵容完整度
                   const computeScore = (structured: InjuryItem[] | undefined, text: string | undefined): { score: number | null; count: number } => {
                     if (structured && structured.length > 0) {
                       const penalty = structured.reduce((acc, item) => {
                         const level = item.impactLevel;
                         if (level === 'critical' || level === 'high') return acc + 15;
                         if (level === 'medium') return acc + 8;
                         return acc + 3;
                       }, 0);
                       return { score: Math.max(100 - penalty, 40), count: structured.length };
                     }
                     if (text && text.trim()) {
                       const parsed = parseInjuryLines(text);
                       const score = calcSquadCompleteness(parsed);
                       return { score, count: parsed.length };
                     }
                     return { score: null, count: 0 };
                   };

                   const homeScore = computeScore(injuries?.home, match.homeInjuries);
                   const awayScore = computeScore(injuries?.away, match.awayInjuries);

                   return (
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div className="p-4 rounded-lg bg-home-win/5 border border-home-win/20">
                         <div className="flex items-center justify-between mb-2">
                           <div className="text-sm font-medium text-home-win">{match.homeTeam} 阵容完整度</div>
                           <span className="text-[10px] text-muted-foreground">{homeScore.count}人伤停</span>
                         </div>
                         <div className="text-3xl font-black tabular-nums text-home-win mb-2">
                           {homeScore.score !== null ? `${homeScore.score}%` : '数据不足'}
                         </div>
                         <div className="h-2 rounded-full bg-white/60 overflow-hidden">
                           <div
                             className="h-full rounded-full progress-gradient transition-all duration-[1.5s] ease-out"
                             style={{ width: homeScore.score !== null ? `${homeScore.score}%` : '0%' }}
                           />
                         </div>
                       </div>
                       <div className="p-4 rounded-lg bg-away-win/5 border border-away-win/20">
                         <div className="flex items-center justify-between mb-2">
                           <div className="text-sm font-medium text-away-win">{match.awayTeam} 阵容完整度</div>
                           <span className="text-[10px] text-muted-foreground">{awayScore.count}人伤停</span>
                         </div>
                         <div className="text-3xl font-black tabular-nums text-away-win mb-2">
                           {awayScore.score !== null ? `${awayScore.score}%` : '数据不足'}
                         </div>
                         <div className="h-2 rounded-full bg-white/60 overflow-hidden">
                           <div
                             className="h-full rounded-full bg-away-win transition-all duration-[1.5s] ease-out"
                             style={{ width: awayScore.score !== null ? `${awayScore.score}%` : '0%' }}
                           />
                         </div>
                       </div>
                     </div>
                   );
                 })()}

                 {/* 伤停名单 */}
                 {injuriesLoading ? (
                   <div className="space-y-3 animate-pulse">
                     <div className="h-4 w-20 bg-muted rounded" />
                     <div className="h-16 bg-muted/40 rounded-lg" />
                     <div className="h-4 w-20 bg-muted rounded" />
                     <div className="h-16 bg-muted/40 rounded-lg" />
                   </div>
                 ) : (
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div>
                       <div className="text-sm text-home-win font-medium mb-2">主队伤停</div>
                       {injuries?.home && injuries.home.length > 0 ? (
                         <div className="space-y-2">
                           {injuries.home.map((item) => (
                             <div key={item.id} className="p-2.5 rounded-lg bg-muted/40 border border-border/60">
                               <div className="flex items-center justify-between mb-1">
                                 <span className="text-sm font-medium text-foreground">{item.playerName}</span>
                                 <span
                                   className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${IMPACT_COLORS[item.impactLevel] || IMPACT_COLORS.low}`}
                                 >
                                   {IMPACT_LABELS[item.impactLevel] || '低'}
                                 </span>
                               </div>
                               <div className="text-xs text-muted-foreground">
                                 {item.position} · {item.injuryType}
                               </div>
                             </div>
                           ))}
                         </div>
                        ) : match.homeInjuries ? (
                          <div className="space-y-2">
                            {parseInjuryLines(match.homeInjuries).map((item, idx) => (
                              <div key={idx} className="p-2.5 rounded-lg bg-muted/40 border border-border/60">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-medium text-foreground">{item.name}</span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                      item.impact === 'high'
                                        ? IMPACT_COLORS.high
                                        : item.impact === 'medium'
                                          ? IMPACT_COLORS.medium
                                          : IMPACT_COLORS.low
                                    }`}
                                  >
                                    {item.impact === 'high' ? '高' : item.impact === 'medium' ? '中' : '低'}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {item.position} · {item.raw.length > 30 ? item.raw.slice(0, 30) + '…' : item.raw}
                                </div>
                              </div>
                            ))}
                          </div>
                         ) : null}
                        {(!injuries?.home?.length && !match.homeInjuries) && (
                          <div className="py-4 text-center text-xs text-muted-foreground rounded-lg bg-muted/30">
                            暂无伤停数据
                          </div>
                        )}
                     </div>

                     <div>
                       <div className="text-sm text-away-win font-medium mb-2">客队伤停</div>
                       {injuries?.away && injuries.away.length > 0 ? (
                         <div className="space-y-2">
                           {injuries.away.map((item) => (
                             <div key={item.id} className="p-2.5 rounded-lg bg-muted/40 border border-border/60">
                               <div className="flex items-center justify-between mb-1">
                                 <span className="text-sm font-medium text-foreground">{item.playerName}</span>
                                 <span
                                   className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${IMPACT_COLORS[item.impactLevel] || IMPACT_COLORS.low}`}
                                 >
                                   {IMPACT_LABELS[item.impactLevel] || '低'}
                                 </span>
                               </div>
                               <div className="text-xs text-muted-foreground">
                                 {item.position} · {item.injuryType}
                               </div>
                             </div>
                           ))}
                         </div>
                        ) : match.awayInjuries ? (
                          <div className="space-y-2">
                            {parseInjuryLines(match.awayInjuries).map((item, idx) => (
                              <div key={idx} className="p-2.5 rounded-lg bg-muted/40 border border-border/60">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-sm font-medium text-foreground">{item.name}</span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                      item.impact === 'high'
                                        ? IMPACT_COLORS.high
                                        : item.impact === 'medium'
                                          ? IMPACT_COLORS.medium
                                          : IMPACT_COLORS.low
                                    }`}
                                  >
                                    {item.impact === 'high' ? '高' : item.impact === 'medium' ? '中' : '低'}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {item.position} · {item.raw.length > 30 ? item.raw.slice(0, 30) + '…' : item.raw}
                                </div>
                              </div>
                            ))}
                          </div>
                         ) : null}
                        {(!injuries?.away?.length && !match.awayInjuries) && (
                          <div className="py-4 text-center text-xs text-muted-foreground rounded-lg bg-muted/30">
                            暂无伤停数据
                          </div>
                        )}
                     </div>
                   </div>
                 )}
               </div>
             )}
          </div>

           </div>
         )}

          {/* 历史交锋 Tab */}
          {activeTab === 'h2h' && (
             <div className="space-y-6">
           {/* 9. H2H 历史交锋 */}
            <div className="metric-card p-6 emphasis-bar pl-5">
                <div className="eyebrow eyebrow-line mb-3">HEAD TO HEAD</div>
                <h2 className="text-2xl font-black tracking-tight text-foreground mb-5">历史交锋</h2>
                {match.h2h && match.h2h.length > 0 ? (
                  <div className="space-y-5">
                    {/* 口径切换 */}
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
                        {(['all', 'last10', 'last5'] as const).map((scope) => (
                          <button
                            key={scope}
                            onClick={() => setH2hScope(scope)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                              h2hScope === scope
                                ? 'bg-card text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {scope === 'all' ? '全部' : scope === 'last10' ? '近10次' : '近5次'}
                          </button>
                        ))}
                      </div>
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        共{match.h2h.length}场
                      </span>
                    </div>

                    {/* 胜负分布统计 */}
                    {(() => {
                      const limit = h2hScope === 'all' ? undefined : h2hScope === 'last10' ? 10 : 5;
                      const stats = parseH2HStats(match.h2h, limit);
                      const displayTotal = stats.total || Math.min(match.h2h.length, limit ?? match.h2h.length);
                      return (
                        <div className="grid grid-cols-3 gap-3">
                          <div className="p-4 rounded-lg bg-home-win/5 border border-home-win/20 text-center">
                            <div className="text-[10px] uppercase tracking-wider text-home-win/70 mb-1">主胜</div>
                            <div className="text-3xl font-black text-home-win tabular-nums">{stats.homeWin}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">
                              {displayTotal > 0 ? `${((stats.homeWin / displayTotal) * 100).toFixed(0)}%` : '-'} 
                            </div>
                          </div>
                          <div className="p-4 rounded-lg bg-draw/5 border border-draw/20 text-center">
                            <div className="text-[10px] uppercase tracking-wider text-draw/70 mb-1">平</div>
                            <div className="text-3xl font-black text-draw tabular-nums">{stats.draw}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">
                              {displayTotal > 0 ? `${((stats.draw / displayTotal) * 100).toFixed(0)}%` : '-'}
                            </div>
                          </div>
                          <div className="p-4 rounded-lg bg-away-win/5 border border-away-win/20 text-center">
                            <div className="text-[10px] uppercase tracking-wider text-away-win/70 mb-1">客胜</div>
                            <div className="text-3xl font-black text-away-win tabular-nums">{stats.awayWin}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">
                              {displayTotal > 0 ? `${((stats.awayWin / displayTotal) * 100).toFixed(0)}%` : '-'}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 对阵记录列表 */}
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">交锋记录</div>
                      {(() => {
                        const limit = h2hScope === 'all' ? undefined : h2hScope === 'last10' ? 10 : 5;
                        const list = limit ? match.h2h.slice(0, limit) : match.h2h;
                        return list.map((item: string, idx: number) => (
                          <div
                            key={idx}
                            className="p-3.5 rounded-lg bg-gray-50 border border-gray-100"
                          >
                            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                              {item}
                            </p>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center text-sm text-gray-400">
                    <History className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p>暂无数据</p>
                  </div>
               )}
            </div>

              </div>
            )}

         {/* 概览 Tab (下半部分) */}
         {activeTab === 'overview' && (
           <div className="space-y-5">
        {/* 9.5 进阶数据 */}
        {(() => {
          const stats = match.advancedStats;
          const hasRealStats = stats && (
            (stats.shotsHome ?? 0) > 0 ||
            (stats.shotsAway ?? 0) > 0 ||
            (stats.shotsOnTargetHome ?? 0) > 0 ||
            (stats.shotsOnTargetAway ?? 0) > 0 ||
            (stats.cornersHome ?? 0) > 0 ||
            (stats.cornersAway ?? 0) > 0 ||
            (stats.foulsHome ?? 0) > 0 ||
            (stats.foulsAway ?? 0) > 0 ||
            ((stats.possessionHome ?? 0) > 0 && (stats.possessionHome ?? 50) !== 50) ||
            (stats.passAccuracyHome ?? 0) > 0 ||
            (stats.passAccuracyAway ?? 0) > 0
          );
          const hasXg = (stats.xgHome ?? 0) > 0 || (stats.xgAway ?? 0) > 0;
          const hasStats = hasRealStats || hasXg;
          if (!hasStats) return null;

          const StatRow = ({ label, home, away, isDecimal, suffix }: { label: string; home: number; away: number; isDecimal?: boolean; suffix?: string }) => {
            if (home <= 0 && away <= 0) return null;
            const total = Math.max(home + away, 1);
            const format = (v: number) => isDecimal ? v.toFixed(2) : `${v}${suffix || ''}`;
            return (
              <div>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="font-mono font-semibold text-home-win">{format(home)}</span>
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="font-mono font-semibold text-away-win">{format(away)}</span>
                </div>
                <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                  <div className="bg-home-win transition-all" style={{ width: `${Math.max((home / total) * 100, 2)}%` }} />
                  <div className="bg-away-win transition-all ml-auto" style={{ width: `${Math.max((away / total) * 100, 2)}%` }} />
                </div>
              </div>
            );
          };

          const pHome = stats.possessionHome ?? 0;
          const pAway = stats.possessionAway ?? 0;
          const hasPossession = pHome > 0 || pAway > 0;

          return (
            <div className="bg-card border border-border rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  <h2 className="text-lg font-semibold text-foreground">进阶数据</h2>
                </div>
                <div className="space-y-4">
                  {hasXg && (
                    <StatRow
                      label="预期进球 xG"
                      home={stats.xgHome ?? 0}
                      away={stats.xgAway ?? 0}
                      isDecimal
                    />
                  )}
                  <StatRow label="预期助攻 xA" home={stats.xaHome ?? 0} away={stats.xaAway ?? 0} isDecimal />
                  <StatRow label="射门" home={stats.shotsHome ?? 0} away={stats.shotsAway ?? 0} />
                  <StatRow label="射正" home={stats.shotsOnTargetHome ?? 0} away={stats.shotsOnTargetAway ?? 0} />
                  <StatRow label="角球" home={stats.cornersHome ?? 0} away={stats.cornersAway ?? 0} />
                  {hasPossession && (
                    <div className="flex items-center justify-center gap-6 py-2">
                      <div className="text-right">
                        <div className="text-2xl font-mono font-bold text-home-win">{pHome}%</div>
                        <div className="text-[10px] text-muted-foreground">主队控球</div>
                      </div>
                      <div
                        className="relative w-20 h-20 rounded-full flex items-center justify-center"
                        style={{ background: `conic-gradient(hsl(142 70% 50%) 0%, hsl(142 70% 50%) ${pHome}%, hsl(2 75% 60%) ${pHome}%, hsl(2 75% 60%) 100%)` }}
                      >
                        <div className="absolute inset-1.5 bg-card rounded-full flex items-center justify-center">
                          <span className="text-xs font-mono text-muted-foreground">控球率</span>
                        </div>
                      </div>
                      <div className="text-left">
                        <div className="text-2xl font-mono font-bold text-away-win">{pAway}%</div>
                        <div className="text-[10px] text-muted-foreground">客队控球</div>
                      </div>
                    </div>
                  )}
                  <StatRow label="犯规" home={stats.foulsHome ?? 0} away={stats.foulsAway ?? 0} />
                  <StatRow label="传球成功率" home={stats.passAccuracyHome ?? 0} away={stats.passAccuracyAway ?? 0} suffix="%" />
                </div>
            </div>
          );
        })()}

        {/* 9.6 比赛环境 */}
        {match.environment &&
        (match.environment.weather?.temp !== undefined ||
          match.environment.weather?.condition ||
          match.environment.stadium?.name ||
          match.environment.referee?.name) ? (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <CloudSun className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">比赛环境</h2>
          </div>

          {match.environment &&
          (match.environment.weather?.temp !== undefined ||
            match.environment.stadium?.name ||
            match.environment.referee?.name) ? (
            <div className="space-y-4">
              {/* 天气影响提示 */}
              {match.environment.weather?.condition?.includes('雨') && (
                <div className="p-3 rounded-lg bg-info/10 border border-info/30 flex items-start gap-2">
                  <span className="text-base">🌧️</span>
                  <p className="text-xs text-info/90 leading-relaxed">
                    雨天可能降低进球数，进球少概率+5%
                  </p>
                </div>
              )}
              {match.environment.weather?.temp !== undefined &&
                match.environment.weather.temp >= 30 && (
                  <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 flex items-start gap-2">
                    <span className="text-base">🔥</span>
                    <p className="text-xs text-warning/90 leading-relaxed">
                      高温可能影响体能，下半场进球数可能上升
                    </p>
                  </div>
                )}
              {match.environment.referee?.avgYellow !== undefined &&
                match.environment.referee.avgYellow >= 4.5 && (
                  <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 flex items-start gap-2">
                    <span className="text-base">🟨</span>
                    <p className="text-xs text-warning/90 leading-relaxed">
                      裁判出牌率高，本场黄牌数可能偏多
                    </p>
                  </div>
                )}

              {/* 天气 */}
              {match.environment.weather &&
              (match.environment.weather.condition || match.environment.weather.temp !== undefined) ? (
                <div>
                  <div className="text-sm font-medium text-foreground mb-3">天气</div>
                  <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/40">
                    <div className="text-4xl">
                      {match.environment.weather.condition?.includes('雨')
                        ? '🌧️'
                        : match.environment.weather.condition?.includes('云') ||
                            match.environment.weather.condition?.includes('阴')
                          ? '⛅'
                          : '☀️'}
                    </div>
                    <div className="flex-1 grid grid-cols-2 gap-y-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">温度：</span>
                        <span className="text-foreground font-mono">{match.environment.weather.temp ?? '-'}°C</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">天气：</span>
                        <span className="text-foreground">{match.environment.weather.condition ?? '-'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">湿度：</span>
                        <span className="text-foreground font-mono">{match.environment.weather.humidity ?? '-'}%</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">风速：</span>
                        <span className="text-foreground font-mono">{match.environment.weather.wind ?? '-'} km/h</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* 球场 */}
              {match.environment.stadium?.name ? (
                <div className="pt-3 border-t border-border/60">
                  <div className="text-sm font-medium text-foreground mb-3">球场</div>
                  <div className="p-3 rounded-lg bg-muted/40 space-y-2">
                    <div className="text-sm text-foreground font-medium">{match.environment.stadium.name}</div>
                    <div className="flex gap-4 text-xs">
                      <div>
                        <span className="text-muted-foreground">容量：</span>
                        <span className="text-foreground font-mono">
                          {match.environment.stadium.capacity?.toLocaleString() ?? '-'}人
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">草皮：</span>
                        <span className="text-foreground">{match.environment.stadium.grass ?? '-'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* 裁判 */}
              {match.environment.referee?.name ? (
                <div className="pt-3 border-t border-border/60">
                  <div className="text-sm font-medium text-foreground mb-3">裁判</div>
                  <div className="p-3 rounded-lg bg-muted/40 space-y-2">
                    <div className="text-sm text-foreground font-medium">{match.environment.referee.name}</div>
                    <div className="grid grid-cols-2 gap-y-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">执法场次：</span>
                        <span className="text-foreground font-mono">{match.environment.referee.matches ?? '-'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">点球倾向：</span>
                        <span className="text-foreground font-mono">
                          {match.environment.referee.penaltyRate !== undefined
                            ? `${match.environment.referee.penaltyRate}%`
                            : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">场均黄牌：</span>
                        <span className="text-draw font-mono">{match.environment.referee.avgYellow?.toFixed(1) ?? '-'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">场均红牌：</span>
                        <span className="text-away-win font-mono">{match.environment.referee.avgRed?.toFixed(2) ?? '-'}</span>
                      </div>
                    </div>
                  </div>
                </div>
               ) : null}
             </div>
           ) : null}
        </div>
        ) : null}



        {/* 11. 分析模型规则 */}
        {(() => {
          const MODEL_RULE_HIDE_KEYWORDS = /test|manual|baseline|调试|测试|基线规则|数据不足.*硬拦截/i;
          const rawRules = (match.modelRules || []).filter((r: string) => {
            if (!r || r.trim() === '') return false;
            if (MODEL_RULE_HIDE_KEYWORDS.test(r)) return false;
            if (/^R\d+$/.test(r)) {
              const num = parseInt(r.slice(1), 10);
              if (num >= 57) return false;
            }
            return true;
          });
          if (rawRules.length === 0) return null;
          const displayRules = rawRules.map((r: string) => {
            const resolved = resolveFootballRule(r);
            if (resolved) return resolved;
            return {
              name: r,
              direction: '模型规则',
              directionType: 'neutral' as const,
              category: '模型规则',
              desc: r,
              displayName: r,
            };
          });
          return (
               <div className="metric-card p-6 emphasis-bar pl-5">
                 <div className="eyebrow eyebrow-line mb-3">MODEL RULES</div>
                 <h2 className="text-2xl font-black tracking-tight text-foreground mb-5">
                   分析模型规则
                   {match.predEngineVersion && (
                     <span className="ml-2 text-sm font-medium text-muted-foreground">
                       v{match.predEngineVersion}
                     </span>
                   )}
                 </h2>
                  <div className="space-y-3">
                    {displayRules.map((rule) => {
                     const isExpanded = expandedRules[rule.displayName];
                     return (
                        <div
                         key={rule.displayName}
                         className="rounded-xl bg-gray-50 border border-gray-100 overflow-hidden transition-all hover:border-nebula-crimson/30"
                       >
                         <button
                           onClick={() => toggleRuleExpand(rule.displayName)}
                           className="w-full p-4 flex items-center justify-between hover:bg-gray-100/70 transition-colors text-left"
                         >
                           <div className="flex items-center gap-3 min-w-0">
                             <span className="px-2.5 py-1 rounded-lg bg-nebula-crimson text-white text-xs font-black tabular-nums flex-shrink-0">
                               {rule.displayName.split(' ')[0]}
                             </span>
                             <span className="text-base font-semibold text-foreground truncate">{rule.displayName}</span>
                           </div>
                           <div className="flex items-center gap-2 flex-shrink-0">
                             <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${getDirectionBg(rule.directionType)}`}>
                               {rule.direction}
                             </span>
                             {isExpanded ? (
                               <ChevronUp className="w-4 h-4 text-gray-400" />
                             ) : (
                               <ChevronDown className="w-4 h-4 text-gray-400" />
                             )}
                           </div>
                         </button>
                         {isExpanded && (
                           <div className="px-4 pb-4 pt-0 border-t border-gray-200">
                             <p className="text-sm text-gray-500 mt-3 leading-relaxed">{rule.desc}</p>
                             <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between">
                               <span className="text-xs text-gray-400 uppercase tracking-wider font-medium">影响方向</span>
                               <span className={`text-sm font-black ${getDirectionColor(rule.directionType)}`}>{rule.direction}</span>
                             </div>
                           </div>
                         )}
                       </div>
                     );
                   })}
                 </div>
               </div>
           );
        })()}

             </div>
         )}

         {/* 情报 Tab (下半部分) */}
         {activeTab === 'intel' && (
           <div className="space-y-5">
          {/* 12. 情报分析 - 结构化模块 */}
               <div className="metric-card p-6 emphasis-bar pl-5">
                 <div className="eyebrow eyebrow-line mb-3">INTEL BRIEFING</div>
                 <h2 className="text-2xl font-black tracking-tight text-foreground mb-5">情报分析</h2>
                 {match.intel && !isUnreliableIntel(match.intel) ? (
                  <IntelSections
                    intel={match.intel}
                    homeTeam={match.homeTeam}
                    awayTeam={match.awayTeam}
                  />
                  ) : (
                    <div className="py-8 text-center">
                      <p className="text-sm text-gray-400">暂无可靠情报</p>
                    </div>
                  )}
               </div>

           {(() => {
              const newsItems = [
                { title: '球队新闻', value: match.teamNews, accent: 'bg-accent' },
                { title: '伤停名单', value: match.injuries, accent: 'bg-away-win' },
                { title: '媒体观点', value: match.mediaConsensus, accent: 'bg-primary' },
                { title: '模型参考', value: match.expertPicks, accent: 'bg-draw' },
               ].map((item) => {
                 const raw = safeText(item.value);
                 const textFields = ['球队新闻', '媒体观点', '模型参考'];
                 const useIntelCheck = textFields.includes(item.title);
                 const hasContent = useIntelCheck
                   ? hasValue(raw) && !isUnreliableIntel(raw)
                   : hasValue(raw) && !PLACEHOLDER_PATTERNS.test(raw.trim());
                 return {
                   ...item,
                   displayText: hasContent ? normalizeIntelValue(raw) : '',
                   empty: !hasContent,
                 };
               });
              return (
                       <div className="metric-card p-6 emphasis-bar pl-5">
                     <div className="eyebrow eyebrow-line mb-3">NEWS FLASH</div>
                     <h2 className="text-2xl font-black tracking-tight text-foreground mb-5">情报快讯</h2>
                     <div className="space-y-4">
                       {newsItems.map((item) => (
                         <div key={item.title} className="rounded-xl border border-gray-100 overflow-hidden bg-gray-50/50">
                           <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white/60">
                             <span className={`w-1.5 h-5 rounded-full ${item.accent}`} />
                             <span className="text-base font-black text-foreground">{item.title}</span>
                           </div>
                           <div className="px-4 py-4">
                             {item.empty ? (
                               <p className="text-sm text-gray-400">暂无可靠数据</p>
                             ) : (
                               <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                                 {item.displayText}
                               </p>
                             )}
                           </div>
                         </div>
                       ))}
                     </div>
                     {match.intelUpdatedAt && (
                       <div className="mt-5 pt-4 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-400">
                         <Clock className="w-4 h-4" />
                         <span>情报更新于 {formatBeijingTime(match.intelUpdatedAt, 'datetime')}</span>
                       </div>
                     )}
                   </div>
                  );
            })()}

           </div>
         )}
       </div>

        <div className="mt-8 py-4 px-5 rounded-2xl bg-nebula-crimson/5 border border-nebula-crimson/10">
         <p className="text-xs text-gray-500 text-center leading-relaxed">
            数据与模型分析仅供参考，不构成任何决策建议。请理性看待体育赛事，理性观赛
         </p>
       </div>

      {/* 球员详情弹窗 */}
      <Dialog open={playerDialogOpen} onOpenChange={setPlayerDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">球员详情</DialogTitle>
          </DialogHeader>
          {selectedPlayer && (
            <div className="space-y-4">
               <div className="flex items-center gap-4">
                 <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                   <User className="w-8 h-8 text-muted-foreground" />
                 </div>
                 <div className="flex-1 min-w-0">
                   <div className="text-lg font-semibold text-foreground">{selectedPlayer.name}</div>
                   <div className="text-sm text-muted-foreground">{selectedPlayer.position || '-'}</div>
                   {selectedPlayer.rating ? (
                     <div className={`text-2xl font-mono font-bold mt-1 ${getRatingColor(selectedPlayer.rating)}`}>
                       {selectedPlayer.rating.toFixed(1)}
                     </div>
                   ) : null}
                 </div>
               </div>

               <div className="grid grid-cols-3 gap-3 text-center">
                 <div className="p-2.5 rounded-lg bg-muted/40">
                   <div className="text-xs text-muted-foreground mb-1">进球</div>
                   <div className="text-lg font-mono font-bold text-home-win">{selectedPlayer.goals ?? '-'}</div>
                 </div>
                 <div className="p-2.5 rounded-lg bg-muted/40">
                   <div className="text-xs text-muted-foreground mb-1">助攻</div>
                   <div className="text-lg font-mono font-bold text-draw">{selectedPlayer.assists ?? '-'}</div>
                 </div>
                 <div className="p-2.5 rounded-lg bg-muted/40">
                   <div className="text-xs text-muted-foreground mb-1">备注</div>
                   <div className="text-sm font-medium text-foreground truncate" title={selectedPlayer.note}>
                     {selectedPlayer.note || '-'}
                   </div>
                 </div>
               </div>

               {selectedPlayer.note && (
                 <div className="pt-3 border-t border-border/60">
                   <div className="text-sm font-medium text-foreground mb-2">球员说明</div>
                   <p className="text-xs text-muted-foreground leading-relaxed">{selectedPlayer.note}</p>
                 </div>
               )}
            </div>
          )}
        </DialogContent>
        </Dialog>
       </ErrorBoundary>
     </div>
  );
};

export default MatchDetailPage;
