import { Injectable } from '@nestjs/common';

export interface ExtendedAdvancedStats {
  shotsPerGame?: number;
  possessionPercentage?: number;
  passCompletionPercentage?: number;
  cornersPerGame?: number;
  foulsPerGame?: number;
  shotAccuracy?: number;
  yellowCards?: number;
  redCards?: number;
  savesPerGame?: number;
}

/** ESPN stats 键名映射表（规范化后小写无空格 → 字段名） */
const KEY_MAP: Record<string, keyof ExtendedAdvancedStats> = {
  'shotspergame': 'shotsPerGame',
  'shots/game': 'shotsPerGame',
  'shotspg': 'shotsPerGame',
  'possessionpercentage': 'possessionPercentage',
  'possession%': 'possessionPercentage',
  'ballpossession': 'possessionPercentage',
  'passcompletionpercentage': 'passCompletionPercentage',
  'passcompletion%': 'passCompletionPercentage',
  'passaccuracypct': 'passCompletionPercentage',
  'cornerspergame': 'cornersPerGame',
  'corners/game': 'cornersPerGame',
  'cornerstaken': 'cornersPerGame',
  'foulspergame': 'foulsPerGame',
  'fouls/game': 'foulsPerGame',
  'foulscommitted': 'foulsPerGame',
  'shotaccuracy': 'shotAccuracy',
  'shotsontargetpct': 'shotAccuracy',
  'shotson target%': 'shotAccuracy',
  'shotsontarget%': 'shotAccuracy',
  'yellowcards': 'yellowCards',
  'yellowcard': 'yellowCards',
  'yc': 'yellowCards',
  'redcards': 'redCards',
  'redcard': 'redCards',
  'rc': 'redCards',
  'savespergame': 'savesPerGame',
  'saves/game': 'savesPerGame',
  'totalsaves': 'savesPerGame',
};

@Injectable()
export class XgEspnExtractorService {
  /**
   * 从 ESPN stats 返回的扁平 Record 中提取扩展进阶统计字段
   * 键名大小写/空格不敏感，取不到的字段保持 undefined，不填假值
   */
  extractAdvancedStats(statsData: Record<string, string>): ExtendedAdvancedStats {
    const result: ExtendedAdvancedStats = {};

    if (!statsData || typeof statsData !== 'object') {
      return result;
    }

    const keys: string[] = Object.keys(statsData);
    const matched: Set<keyof ExtendedAdvancedStats> = new Set();

    for (const rawKey of keys) {
      const normalized: string = this.normalizeKey(rawKey);
      const field: keyof ExtendedAdvancedStats | undefined = KEY_MAP[normalized];

      if (!field) continue;
      if (matched.has(field)) continue; // 已匹配过，避免重复覆盖

      const rawValue: string = statsData[rawKey];
      const parsed: number | undefined = this.parseNumber(rawValue);

      if (parsed !== undefined && Number.isFinite(parsed)) {
        result[field] = parsed;
        matched.add(field);
      }
    }

    return result;
  }

  /**
   * 规范化键名：去空格、去标点、转小写
   */
  private normalizeKey(key: string): string {
    return key
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[._-]/g, '')
      .replace(/%/g, 'pct')
      .replace(/\//g, 'per');
  }

  /**
   * 解析数值，支持 "58.2%"、"12.5"、"3" 等格式
   */
  private parseNumber(value: string): number | undefined {
    if (value === null || value === undefined) return undefined;
    const str: string = String(value).trim();
    if (str.length === 0) return undefined;

    // 去除尾部的 %、单位等
    const cleaned: string = str.replace(/%$/g, '').replace(/,/g, '');
    const num: number = Number(cleaned);

    if (Number.isNaN(num)) return undefined;
    return num;
  }
}
