import { logger } from '@lark-apaas/client-toolkit/logger';
import type { BasketballMatchItem } from '@shared/api.interface';

type ConsistencyField = 'wdw' | 'handicap' | 'total' | 'total_vs_predicted';

function logSentinel(
  matchNo: string,
  field: ConsistencyField,
  directionWas: string,
  correctedTo: string,
  reason: string,
): void {
  logger.warn(
    `[consistency-guard] matchNo=${matchNo} field=${field} direction_was=${directionWas} corrected_to=${correctedTo} reason=${reason}`,
  );
}

/**
 * 四一致守卫：确保方向卡文字、概率、高亮侧、推荐方向四者完全自洽。
 * 以推荐方向 + 推荐概率为权威基准，校正不一致的字段。
 * 纯函数，不修改原对象，返回新对象。
 */
export function guardConsistency(match: BasketballMatchItem): BasketballMatchItem {
  const result: BasketballMatchItem = { ...match };
  const matchNo = match.matchNo || 'unknown';

  // ========== 1. 胜负四一致（WDW）==========
  const predictionDirection = match.predictionDirection || '观望';
  let homeWinProb = match.homeWinProb ?? 0;
  let awayWinProb = match.awayWinProb ?? 0;

  if (predictionDirection === '主胜') {
    if (homeWinProb < awayWinProb) {
      logSentinel(
        matchNo,
        'wdw',
        `主胜(主${homeWinProb}%/客${awayWinProb}%)`,
        `主胜(主${awayWinProb}%/客${homeWinProb}%)`,
        '方向为主胜但客胜概率更高，已交换',
      );
      [homeWinProb, awayWinProb] = [awayWinProb, homeWinProb];
    }
  } else if (predictionDirection === '客胜') {
    if (awayWinProb < homeWinProb) {
      logSentinel(
        matchNo,
        'wdw',
        `客胜(主${homeWinProb}%/客${awayWinProb}%)`,
        `客胜(主${awayWinProb}%/客${homeWinProb}%)`,
        '方向为客胜但主胜概率更高，已交换',
      );
      [homeWinProb, awayWinProb] = [awayWinProb, homeWinProb];
    }
  } else {
    // 观望 → 概率均为50%
    if (homeWinProb !== 50 || awayWinProb !== 50) {
      logSentinel(
        matchNo,
        'wdw',
        `观望(主${homeWinProb}%/客${awayWinProb}%)`,
        '观望(主50%/客50%)',
        '观望方向概率重置为50/50',
      );
      homeWinProb = 50;
      awayWinProb = 50;
    }
  }
  result.homeWinProb = homeWinProb;
  result.awayWinProb = awayWinProb;

  // ========== 2. 让分四一致（Handicap）==========
  const handicapPickRaw = match.handicapPick || '';
  let handicapPickProbRaw = match.handicapPickProb ?? match.handicapCoverProb ?? 0;
  let handicapCoverProbRaw = match.handicapCoverProb ?? match.handicapPickProb ?? 0;

  const isHandicapHome = handicapPickRaw.includes('主胜');
  const isHandicapAway = handicapPickRaw.includes('客胜');
  const handicapIsWait = !handicapPickRaw || handicapPickRaw.includes('观望');

  if (!handicapIsWait && (isHandicapHome || isHandicapAway)) {
    // 方向翻转判定：推荐方为主胜但市场更看好客胜（让分客胜方向的覆盖概率更高）→ 同步翻转概率
    // 判定依据：handicapCoverProb 表示主队让分赢盘概率，若推荐主胜但 coverProb<50 则方向矛盾需要翻转
    const marketFavorsHome = handicapCoverProbRaw >= 50;
    const pickIsHomeWin = isHandicapHome;

    if (pickIsHomeWin !== marketFavorsHome) {
      // 方向不一致：同步翻转 handicapCoverProb 和 handicapPickProb
      const flippedCover = 100 - handicapCoverProbRaw;
      const flippedPick = 100 - handicapPickProbRaw;
      logSentinel(
        matchNo,
        'handicap',
        `${handicapPickRaw}(cover=${handicapCoverProbRaw}%,pick=${handicapPickProbRaw}%)`,
        `${handicapPickRaw}(cover=${flippedCover}%,pick=${flippedPick}%)`,
        '推荐方向与市场概率方向相反，已同步翻转概率值',
      );
      handicapCoverProbRaw = flippedCover;
      handicapPickProbRaw = flippedPick;
    }

    // 确保推荐方概率 >= 50%（低概率异常兜底）
    if (handicapPickProbRaw < 50) {
      const corrected = 100 - handicapPickProbRaw;
      logSentinel(
        matchNo,
        'handicap',
        `${handicapPickRaw}(${handicapPickProbRaw}%)`,
        `${isHandicapHome ? '让分主胜' : '让分客胜'}(${corrected}%)`,
        '推荐方概率低于50%，已反转概率',
      );
      handicapPickProbRaw = corrected;
      handicapCoverProbRaw = isHandicapHome ? corrected : 100 - corrected;
    }

    result.handicapPickProb = handicapPickProbRaw;
    // handicapCoverProb：主队让分赢盘概率 = 主胜推荐时等于 pickProb，客胜推荐时等于 100 - pickProb
    if (isHandicapHome) {
      result.handicapCoverProb = handicapPickProbRaw;
    } else {
      result.handicapCoverProb = 100 - handicapPickProbRaw;
    }
  }

  // ========== 3. 大小分四一致（Total/O-U）==========
  // 基准：totalDirection > totalPick（totalPick是历史字段，可能不准）
  const totalDirection = match.totalDirection || match.totalPick || '观望';
  const totalPickProb = match.totalPickProb ?? 0;
  let overProb = match.overProb ?? 0;
  let underProb = match.underProb ?? 0;
  const originalTotalPick: string = match.totalPick || '-';
  let totalPickDisplay: string = originalTotalPick;

  // 用 totalDirection 校正方向卡文字
  if (totalDirection === '大分') {
    totalPickDisplay = '大分';
    // 大分概率 = totalPickProb，小分概率 = 100 - totalPickProb
    const correctedOver = totalPickProb;
    const correctedUnder = 100 - totalPickProb;
    if (overProb !== correctedOver || underProb !== correctedUnder || originalTotalPick !== '大分') {
      logSentinel(
        matchNo,
        'total',
        `${originalTotalPick}(大${overProb}%/小${underProb}%)`,
        `大分(大${correctedOver}%/小${correctedUnder}%)`,
        'totalDirection=大分，以totalPickProb为基准校正大小分概率',
      );
    }
    overProb = correctedOver;
    underProb = correctedUnder;
  } else if (totalDirection === '小分') {
    totalPickDisplay = '小分';
    // 小分概率 = totalPickProb，大分概率 = 100 - totalPickProb
    const correctedOver = 100 - totalPickProb;
    const correctedUnder = totalPickProb;
    if (overProb !== correctedOver || underProb !== correctedUnder || originalTotalPick !== '小分') {
      logSentinel(
        matchNo,
        'total',
        `${originalTotalPick}(大${overProb}%/小${underProb}%)`,
        `小分(大${correctedOver}%/小${correctedUnder}%)`,
        'totalDirection=小分，以totalPickProb为基准校正大小分概率',
      );
    }
    overProb = correctedOver;
    underProb = correctedUnder;
  } else {
    // 观望 → 各50%
    totalPickDisplay = '观望';
    if (overProb !== 50 || underProb !== 50) {
      logSentinel(
        matchNo,
        'total',
        `${match.totalPick || '观望'}(大${overProb}%/小${underProb}%)`,
        '观望(大50%/小50%)',
        '观望方向概率重置为50/50',
      );
    }
    overProb = 50;
    underProb = 50;
  }

  result.totalDirection = totalDirection === '观望' ? '观望' : totalDirection;
  result.totalPick = totalPickDisplay;
  result.overProb = overProb;
  result.underProb = underProb;

  // ========== 4. 预期比分自洽 ==========
  const totalLineNum = match.totalLineNum ?? 0;
  const predictedHomeScore = match.predictedHomeScore ?? 0;
  const predictedAwayScore = match.predictedAwayScore ?? 0;
  const predictedTotal = typeof match.predictedTotal === 'number' && match.predictedTotal > 0
    ? match.predictedTotal
    : predictedHomeScore + predictedAwayScore;

  if (totalLineNum > 0 && predictedTotal > 0 && totalDirection !== '观望') {
    if (totalDirection === '大分' && predictedTotal < totalLineNum) {
      logSentinel(
        matchNo,
        'total_vs_predicted',
        `大分(predictedTotal=${predictedTotal} < totalLine=${totalLineNum})`,
        '小分',
        'predictedTotal < totalLine，方向以数值为准改为小分',
      );
      result.totalDirection = '小分';
      result.totalPick = '小分';
      // 同步翻转概率
      const newOver = 100 - totalPickProb;
      const newUnder = totalPickProb;
      result.overProb = newOver;
      result.underProb = newUnder;
    } else if (totalDirection === '小分' && predictedTotal > totalLineNum) {
      logSentinel(
        matchNo,
        'total_vs_predicted',
        `小分(predictedTotal=${predictedTotal} > totalLine=${totalLineNum})`,
        '大分',
        'predictedTotal > totalLine，方向以数值为准改为大分',
      );
      result.totalDirection = '大分';
      result.totalPick = '大分';
      const newOver = totalPickProb;
      const newUnder = 100 - totalPickProb;
      result.overProb = newOver;
      result.underProb = newUnder;
    }
  }

  return result;
}
