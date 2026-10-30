export interface ComboSelection {
  id: string;
  matchNo: string;
  homeTeam: string;
  awayTeam: string;
  playType: string;
  betOption: string;
  probability: number;
  referenceIndex: number;
}

export type ComboType = '2串1' | '3串1' | '3串4' | '4串1' | '4串11';

export const COMBO_DISPLAY_NAMES: Record<ComboType, string> = {
  '2串1': '双场精选',
  '3串1': '三场精选',
  '3串4': '三场组合',
  '4串1': '四场精选',
  '4串11': '四场组合',
};

export const COMBO_TYPES: ComboType[] = ['2串1', '3串1', '3串4', '4串1', '4串11'];

export interface ComboResult {
  comboType: ComboType;
  hitRate: number;
  totalReferenceIndex: number;
  returnPer100: number;
  riskLevel: 'steady' | 'balanced' | 'aggressive' | 'longshot';
  breakdown: {
    description: string;
    count: number;
    hitRate: number;
    referenceIndex: number;
  }[];
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function calcHitRateOfGroup(group: ComboSelection[]): number {
  return group.reduce((acc, m) => acc * (m.probability / 100), 1) * 100;
}

function calcIndexOfGroup(group: ComboSelection[]): number {
  return group.reduce((acc, m) => acc * m.referenceIndex, 1);
}

function getRiskLevel(hitRate: number): ComboResult['riskLevel'] {
  if (hitRate >= 70) return 'steady';
  if (hitRate >= 55) return 'balanced';
  if (hitRate >= 40) return 'aggressive';
  return 'longshot';
}

export function calculateCombo(selections: ComboSelection[], comboType: ComboType): ComboResult | null {
  const n = selections.length;
  if (n < 2 && comboType !== '单场' as unknown as ComboType) return null;

  let breakdown: ComboResult['breakdown'] = [];
  let totalIndex = 1;
  let overallHitRate = 0;

  switch (comboType) {
    case '2串1': {
      if (n < 2) return null;
      const groups = combinations(selections, 2);
      const count = groups.length;
      totalIndex = calcIndexOfGroup(selections);
      overallHitRate = calcHitRateOfGroup(selections);
      breakdown = [{
        description: COMBO_DISPLAY_NAMES['2串1'],
        count,
        hitRate: overallHitRate,
        referenceIndex: totalIndex,
      }];
      break;
    }
    case '3串1': {
      if (n < 3) return null;
      totalIndex = calcIndexOfGroup(selections);
      overallHitRate = calcHitRateOfGroup(selections);
      breakdown = [{
        description: COMBO_DISPLAY_NAMES['3串1'],
        count: 1,
        hitRate: overallHitRate,
        referenceIndex: totalIndex,
      }];
      break;
    }
    case '3串4': {
      if (n !== 3) return null;
      const twoGroups = combinations(selections, 2);
      const threeGroup = selections;
      const twoHitRate = twoGroups.reduce((sum, g) => sum + calcHitRateOfGroup(g), 0) / twoGroups.length;
      const threeHitRate = calcHitRateOfGroup(threeGroup);
      overallHitRate = threeHitRate;
      totalIndex = calcIndexOfGroup(threeGroup);
      breakdown = [
        { description: `${COMBO_DISPLAY_NAMES['2串1']}（共3组）`, count: 3, hitRate: twoHitRate, referenceIndex: calcIndexOfGroup(twoGroups[0]) },
        { description: `${COMBO_DISPLAY_NAMES['3串1']}（共1组）`, count: 1, hitRate: threeHitRate, referenceIndex: totalIndex },
      ];
      break;
    }
    case '4串1': {
      if (n < 4) return null;
      totalIndex = calcIndexOfGroup(selections);
      overallHitRate = calcHitRateOfGroup(selections);
      breakdown = [{
        description: COMBO_DISPLAY_NAMES['4串1'],
        count: 1,
        hitRate: overallHitRate,
        referenceIndex: totalIndex,
      }];
      break;
    }
    case '4串11': {
      if (n !== 4) return null;
      const twoGroups = combinations(selections, 2);
      const threeGroups = combinations(selections, 3);
      const fourGroup = selections;
      const twoHitRate = twoGroups.reduce((sum, g) => sum + calcHitRateOfGroup(g), 0) / twoGroups.length;
      const threeHitRate = threeGroups.reduce((sum, g) => sum + calcHitRateOfGroup(g), 0) / threeGroups.length;
      const fourHitRate = calcHitRateOfGroup(fourGroup);
      overallHitRate = fourHitRate;
      totalIndex = calcIndexOfGroup(fourGroup);
      breakdown = [
        { description: `${COMBO_DISPLAY_NAMES['2串1']}（共6组）`, count: 6, hitRate: twoHitRate, referenceIndex: calcIndexOfGroup(twoGroups[0]) },
        { description: `${COMBO_DISPLAY_NAMES['3串1']}（共4组）`, count: 4, hitRate: threeHitRate, referenceIndex: calcIndexOfGroup(threeGroups[0]) },
        { description: `${COMBO_DISPLAY_NAMES['4串1']}（共1组）`, count: 1, hitRate: fourHitRate, referenceIndex: totalIndex },
      ];
      break;
    }
  }

  return {
    comboType,
    hitRate: Math.round(overallHitRate * 10) / 10,
    totalReferenceIndex: Math.round(totalIndex * 100) / 100,
    returnPer100: Math.round(100 * totalIndex * 100) / 100,
    riskLevel: getRiskLevel(overallHitRate),
    breakdown,
  };
}

export const RISK_LABEL: Record<ComboResult['riskLevel'], { label: string; color: string }> = {
  steady: { label: '稳健', color: 'text-green-400 bg-green-500/15 border-green-500/30' },
  balanced: { label: '均衡', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30' },
  aggressive: { label: '激进', color: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
  longshot: { label: '高指数', color: 'text-red-400 bg-red-500/15 border-red-500/30' },
};
