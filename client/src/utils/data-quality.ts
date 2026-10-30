import { logger } from '@lark-apaas/client-toolkit/logger';

export type PlaceholderType = 'score' | 'form' | 'injuries' | 'stats' | 'default';

/**
 * 判断值是否为占位/空值。
 * - null / undefined / 空字符串 → 占位
 * - 空数组 / 空对象 → 占位
 * - score 类：值为 80 → 占位
 * - form 类：值为 0.5 → 占位
 * - 数值 0 是否为占位由 zeroIsPlaceholder 控制（默认 false，因为 0 对得分类字段是合法值）
 */
export function isPlaceholder(
  value: unknown,
  type: PlaceholderType = 'default',
  zeroIsPlaceholder = false,
): boolean {
  if (value === null || value === undefined) return true;
  if (value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return true;
  if (typeof value === 'number') {
    if (zeroIsPlaceholder && value === 0) return true;
    if (type === 'score' && value === 80) return true;
    if (type === 'form' && value === 0.5) return true;
  }
  return false;
}

/**
 * 空值安全展示：占位值返回「暂无数据」className，否则返回原值的字符串形式。
 */
export function safeDisplay(
  value: unknown,
  type: PlaceholderType = 'default',
): { text: string; isPlaceholder: boolean } {
  if (isPlaceholder(value, type)) {
    return { text: '暂无数据', isPlaceholder: true };
  }
  if (typeof value === 'number') {
    return { text: String(value), isPlaceholder: false };
  }
  if (typeof value === 'string') {
    return { text: value, isPlaceholder: false };
  }
  if (Array.isArray(value)) {
    return { text: value.join(', '), isPlaceholder: false };
  }
  try {
    return { text: String(value), isPlaceholder: false };
  } catch (err) {
    logger.error('safeDisplay 序列化失败', err);
    return { text: '暂无数据', isPlaceholder: true };
  }
}

/**
 * 篮球卡片：判断是否"数据不足"（伤停 + 近期战绩 + H2H 都为空）
 */
export function isDataInsufficientBasketball(match: {
  homeInjuries?: unknown;
  awayInjuries?: unknown;
  homeRecentForm?: string | null;
  awayRecentForm?: string | null;
  h2hHistory?: unknown[] | null;
}): boolean {
  const homeInjEmpty = isPlaceholder(match.homeInjuries, 'injuries');
  const awayInjEmpty = isPlaceholder(match.awayInjuries, 'injuries');
  const homeFormEmpty = isPlaceholder(match.homeRecentForm, 'form');
  const awayFormEmpty = isPlaceholder(match.awayRecentForm, 'form');
  const h2hEmpty = isPlaceholder(match.h2hHistory, 'default');
  return homeInjEmpty && awayInjEmpty && homeFormEmpty && awayFormEmpty && h2hEmpty;
}

/**
 * 足球卡片：判断是否完全无任何预测方向（胜负/让球/进球数全观望或空）
 * 只有三项全观望时才返回 true（显示"数据收集中"大横幅）
 * 有任一预测方向时返回 false，不显示大横幅
 */
export function isDataInsufficientFootball(match: {
  injuries?: string;
  homeForm?: string[];
  awayForm?: string[];
  h2h?: string[];
  predictionDirection?: string;
  handicapRecommendation?: string;
  totalPick?: string;
}): boolean {
  const wdwWait = !match.predictionDirection || match.predictionDirection === '观望';
  const handicapWait = !match.handicapRecommendation || match.handicapRecommendation === '观望' || match.handicapRecommendation === '';
  const totalWait = !match.totalPick || match.totalPick === '观望' || match.totalPick === '';
  // 三项预测全观望/空时，才算真·数据不足
  if (!(wdwWait && handicapWait && totalWait)) return false;
  // 同时情报也全空时，显示大横幅
  const injuriesEmpty = isPlaceholder(match.injuries, 'injuries');
  const homeFormEmpty = isPlaceholder(match.homeForm, 'form');
  const awayFormEmpty = isPlaceholder(match.awayForm, 'form');
  const h2hEmpty = isPlaceholder(match.h2h, 'default');
  return injuriesEmpty && homeFormEmpty && awayFormEmpty && h2hEmpty;
}

/**
 * 足球卡片：判断是否仅情报不全但有预测方向
 * 用于卡片底部小字提示，不显示大横幅
 */
export function isIntelIncompleteOnly(match: {
  injuries?: string;
  homeForm?: string[];
  awayForm?: string[];
  h2h?: string[];
  predictionDirection?: string;
  handicapRecommendation?: string;
  totalPick?: string;
}): boolean {
  // 有任一预测方向
  const hasAnyPrediction = (
    (!!match.predictionDirection && match.predictionDirection !== '观望') ||
    (!!match.handicapRecommendation && match.handicapRecommendation !== '观望' && match.handicapRecommendation !== '') ||
    (!!match.totalPick && match.totalPick !== '观望' && match.totalPick !== '')
  );
  if (!hasAnyPrediction) return false;
  // 情报全空或近空
  const injuriesEmpty = isPlaceholder(match.injuries, 'injuries');
  const homeFormEmpty = isPlaceholder(match.homeForm, 'form');
  const awayFormEmpty = isPlaceholder(match.awayForm, 'form');
  const h2hEmpty = isPlaceholder(match.h2h, 'default');
  return injuriesEmpty && homeFormEmpty && awayFormEmpty && h2hEmpty;
}

export const NO_DATA_CLASS = 'text-gray-400 text-sm';
