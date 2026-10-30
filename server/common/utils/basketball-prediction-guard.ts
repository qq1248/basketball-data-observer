/**
 * 篮球预测字段写入守卫（data-driven 保护）
 *
 * 用途：防止旧引擎 / ingest 路径覆盖 data-driven 引擎产出的高质量预测。
 * 规则：仅保护 upcoming 未开赛 + pred_engine_version 以 'data-driven' 开头的场次。
 *      live/finished 场次不拦；INSERT 不拦；data-driven 引擎自己不拦。
 */

/**
 * 判断是否是高质量预测引擎版本（受保护，不允许低质量写入覆盖）
 * V11.0 统一引擎 >= data-driven > v10 锚定 > v8/v9 旧版
 */
export function isProtectedPredictionEngine(version: string | null | undefined): boolean {
  if (!version) return false;
  return version.startsWith('data-driven') || version.startsWith('v11.');
}

/** @deprecated 使用 isProtectedPredictionEngine */
export function isDataDrivenEngine(version: string | null | undefined): boolean {
  return isProtectedPredictionEngine(version);
}

/**
 * 篮球预测字段名集合（camelCase，对应 Drizzle schema 列名）
 * 这些字段在 data-driven + upcoming 场景下应由 data-driven 引擎唯一负责写入。
 * 注意：handicapLineNum / totalLineNum 是盘口线值，不属于"预测方向"，
 *       允许随赔率同步更新，因此不在此列表中。
 */
export const BASKETBALL_PREDICTION_FIELDS: string[] = [
  // 胜负方向
  'homeWinProb',
  'awayWinProb',
  'predictionDirection',
  'confidence',
  // 让分预测
  'handicapRecommendation',
  'handicapCoverProb',
  'handicapPick',
  'handicapPickProb',
  'handicapConfidence',
  // 大小分预测
  'totalDirection',
  'overProb',
  'underProb',
  'totalPick',
  'totalPickProb',
  'ouConfidence',
  'ouDiffVsLine',
  // 预期比分
  'predictedHomeScore',
  'predictedAwayScore',
  'predictedTotal',
  // 引擎版本与锚点
  'predEngineVersion',
  'predictionAnchor',
  'subModels',
  // 模型规则
  'modelRules',
  'rulesTriggered',
  // 分位概率
  'spreadProb15',
  'spreadProb610',
  'spreadProb1115',
  'spreadProb1620',
  'spreadProb21Plus',
  'spreadTopRange',
  // 进阶数据标记
  'advancedDataReady',
  'advancedDataNotice',
  // 伤停调整
  'injuryAdjustApplied',
  'injuryAdjustPct',
  'intelAdjustments',
];

const PREDICTION_FIELD_SET: Set<string> = new Set(BASKETBALL_PREDICTION_FIELDS);

/**
 * 检查是否应该跳过预测字段写入（高质量预测守卫）
 *
 * 规则：
 * 1. 若本次调用方产生 V11.0 统一引擎 → 永远不跳过（可以覆盖任何旧版本，属于升级）
 * 2. 若当前场次已经 finished/live（已开赛/已结束）
 *    → 返回 false（不保护，比赛中或结束后的更新不拦）
 * 3. 若当前场次 pred_engine_version 是高质量版本（data-driven 或 v11.0-unified）
 *    且本次写入方也不是高质量引擎调用方 → 返回 true（跳过写入）
 * 4. 其余情况 → 返回 false（正常写入）
 *
 * @param existingPredEngineVersion 库中现有 pred_engine_version
 * @param matchStatus 比赛状态 upcoming/live/finished
 * @param caller 调用方标识
 * @param newEngineVersion 本次写入的引擎版本（可选，用于升级路径判断）
 */
export function shouldSkipPredictionWrite(
  existingPredEngineVersion: string | null | undefined,
  matchStatus: string | null | undefined,
  caller: string,
  newEngineVersion?: string,
  isPredictionFrozen?: boolean,
): boolean {
  // 开赛冻结：比赛已开赛（live/finished 等非 upcoming）后，预测字段一律不可写入
  // 唯一例外：freeze-snapshot 调用方（开赛瞬间的快照写入）
  if (caller !== 'freeze-snapshot' && matchStatus && matchStatus !== 'upcoming') {
    return true;
  }
  // 显式冻结标记也拦住（双保险）
  if (caller !== 'freeze-snapshot' && isPredictionFrozen) {
    return true;
  }

  // V11.0 统一引擎永远可以写（升级路径：覆盖 data-driven 和旧版本）
  if (newEngineVersion?.startsWith('v11.')) return false;

  // 高质量引擎的直接调用方永远可以写
  if (caller === 'data-driven') return false;
  if (caller === 'v11-unified') return false;

  // 只有 upcoming 状态才做引擎降级保护；live/finished/canceled/postponed 已由上方开赛冻结拦住
  if (matchStatus !== 'upcoming') return false;

  // 只有当前已是高质量引擎的场次才保护
  if (!isProtectedPredictionEngine(existingPredEngineVersion)) return false;

  return true;
}

/**
 * 从 patch 对象中移除所有预测字段，返回被移除的字段名列表
 * 直接修改传入的 patch 对象。
 */
export function stripPredictionFieldsFromPatch(
  patch: Record<string, unknown>,
): string[] {
  const removed: string[] = [];
  for (const key of Object.keys(patch)) {
    if (PREDICTION_FIELD_SET.has(key)) {
      delete patch[key];
      removed.push(key);
    }
  }
  return removed;
}

/**
 * 检查 patch 中是否包含任意预测字段
 */
export function hasPredictionFields(patch: Record<string, unknown>): boolean {
  for (const key of Object.keys(patch)) {
    if (PREDICTION_FIELD_SET.has(key)) return true;
  }
  return false;
}

// --- 线值变动追踪 ---

export interface OddsMovementEntry {
  time: string;
  type: 'handicap_line' | 'total_line' | 'handicap_open' | 'total_open' | 'schedule';
  oldValue: string;
  newValue: string;
}

const MAX_ODDS_MOVEMENTS = 20;

/**
 * 构建线值变动追踪 patch（仅当 handicapLineNum 或 totalLineNum 发生变化时）
 *
 * 使用方式：
 *   const linePatch = buildLineMovementPatch(existing, newValues, now)
 *   然后把 linePatch 合并到 updateSet 中（Object.assign(updateSet, linePatch) 或逐个赋值）
 *
 * 返回值是一个 patch 对象，可能包含：
 * - oddsMovements: 追加后的新数组（jsonb 数组，直接赋值即可）
 * - lastOddsUpdateAt: 当前时间（Date 对象）
 * - oddsOpenHandicapLine: 若初盘为空则设置
 * - oddsOpenTotalLine: 若初盘为空则设置
 *
 * 若没有任何线值变化，返回空对象 {}
 */
export function buildLineMovementPatch(options: {
  existingHandicapLineNum: string | number | null | undefined;
  existingTotalLineNum: string | number | null | undefined;
  newHandicapLineNum: string | number | null | undefined;
  newTotalLineNum: string | number | null | undefined;
  existingOddsMovements: unknown[] | null | undefined;
  existingOddsOpenHandicapLine: string | null | undefined;
  existingOddsOpenTotalLine: string | null | undefined;
  now?: Date;
}): Record<string, unknown> {
  const {
    existingHandicapLineNum,
    existingTotalLineNum,
    newHandicapLineNum,
    newTotalLineNum,
    existingOddsMovements,
    existingOddsOpenHandicapLine,
    existingOddsOpenTotalLine,
    now = new Date(),
  } = options;

  const patch: Record<string, unknown> = {};
  const newEntries: OddsMovementEntry[] = [];
  const nowIso: string = now.toISOString();

  // --- handicap line 比较 ---
  const oldHcpNum = toNumberOrNull(existingHandicapLineNum);
  const newHcpNum = toNumberOrNull(newHandicapLineNum);
  if (oldHcpNum !== null && newHcpNum !== null && Math.abs(oldHcpNum - newHcpNum) > 1e-9) {
    newEntries.push({
      time: nowIso,
      type: 'handicap_line',
      oldValue: String(oldHcpNum),
      newValue: String(newHcpNum),
    });
    // 若初盘为空，用旧值作为初盘（第一次变动前的值就是初盘）
    if (!existingOddsOpenHandicapLine) {
      patch.oddsOpenHandicapLine = String(oldHcpNum);
    }
  }

  // --- total line 比较 ---
  const oldTotalNum = toNumberOrNull(existingTotalLineNum);
  const newTotalNum = toNumberOrNull(newTotalLineNum);
  if (oldTotalNum !== null && newTotalNum !== null && Math.abs(oldTotalNum - newTotalNum) > 1e-9) {
    newEntries.push({
      time: nowIso,
      type: 'total_line',
      oldValue: String(oldTotalNum),
      newValue: String(newTotalNum),
    });
    if (!existingOddsOpenTotalLine) {
      patch.oddsOpenTotalLine = String(oldTotalNum);
    }
  }

  if (newEntries.length === 0) {
    return patch;
  }

  // 合并已有记录 + 新记录，保持最新在前，最多保留 20 条
  const baseArr: OddsMovementEntry[] = Array.isArray(existingOddsMovements)
    ? (existingOddsMovements as OddsMovementEntry[])
    : [];
  const merged: OddsMovementEntry[] = [...newEntries, ...baseArr].slice(0, MAX_ODDS_MOVEMENTS);
  patch.oddsMovements = merged;
  patch.lastOddsUpdateAt = now;

  return patch;
}

/**
 * 构建初始赔率变动记录（开盘基线）
 * 新比赛首次写入时，把当前让分线/大小分线作为 open 基准记录，
 * 确保后续变动追踪有起点可对比。
 */
export function buildInitialOddsMovements(
  handicapLine: string | number | null | undefined,
  totalLine: string | number | null | undefined,
  now?: Date,
): OddsMovementEntry[] {
  const entries: OddsMovementEntry[] = [];
  const nowIso: string = (now ?? new Date()).toISOString();
  const hcpNum = toNumberOrNull(handicapLine);
  if (hcpNum !== null) {
    entries.push({
      time: nowIso,
      type: 'handicap_open',
      oldValue: '',
      newValue: String(hcpNum),
    });
  }
  const totalNum = toNumberOrNull(totalLine);
  if (totalNum !== null) {
    entries.push({
      time: nowIso,
      type: 'total_open',
      oldValue: '',
      newValue: String(totalNum),
    });
  }
  return entries;
}

// --- 线值变动重算触发阈值 ---

export const HANDICAP_RECALC_THRESHOLD = 1.5;
export const TOTAL_RECALC_THRESHOLD = 1;

/**
 * 让分线变动是否触发重算
 * 阈值：|Δ|≥1.5 分 或 整数部分发生变化（跨整数档）
 * 例：3.5→4.5 跨整数档 → 触发；3.5→4.0 仅0.5 → 不触发；4.5→6.0 跨两档 → 触发
 */
export function shouldRecalcHandicapByLine(
  oldLine: string | number | null | undefined,
  newLine: string | number | null | undefined,
): boolean {
  const oldNum = toNumberOrNull(oldLine);
  const newNum = toNumberOrNull(newLine);
  if (newNum === null || newNum === 0) return false;
  if (oldNum === null || oldNum === 0) return true;
  const delta = Math.abs(newNum - oldNum);
  if (delta >= HANDICAP_RECALC_THRESHOLD) return true;
  if (Math.floor(Math.abs(oldNum)) !== Math.floor(Math.abs(newNum))) return true;
  return false;
}

/**
 * 大小分线变动是否触发重算
 * 阈值：|Δ|≥1 分（贴线场次0.5分变动也可能翻方向，保持敏感）
 */
export function shouldRecalcTotalByLine(
  oldLine: string | number | null | undefined,
  newLine: string | number | null | undefined,
): boolean {
  const oldNum = toNumberOrNull(oldLine);
  const newNum = toNumberOrNull(newLine);
  if (newNum === null || newNum === 0) return false;
  if (oldNum === null || oldNum === 0) return true;
  return Math.abs(newNum - oldNum) >= TOTAL_RECALC_THRESHOLD;
}

/**
 * 从 oddsMovements 数组中提取初始开盘线（open baseline）
 */
export function extractOpenLineFromMovements(
  movements: unknown[] | null | undefined,
  type: 'handicap' | 'total',
): number | null {
  if (!Array.isArray(movements)) return null;
  const targetType = type === 'handicap' ? 'handicap_open' : 'total_open';
  const entry = movements.find((m: unknown): m is OddsMovementEntry =>
    typeof m === 'object' && m !== null && (m as OddsMovementEntry).type === targetType,
  );
  if (!entry) return null;
  return toNumberOrNull(entry.newValue);
}

/**
 * 把各种输入转成 number 或 null；0 也视为有效数值
 */
function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}
