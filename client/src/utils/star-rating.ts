/**
 * 星级评级工具
 * 规则：
 * - 0星：观望/无方向/无数据（<55% 或 观望）
 * - 1星：55-59%
 * - 2星：60-69%
 * - 3星：70-79%
 * - 4星：80-89%
 * - 5星：90%+
 */

export interface StarRatingResult {
  stars: number;
  isWatch: boolean;
}

export function getStarRating(
  confidence: number | null | undefined,
  isWatch: boolean = false,
): StarRatingResult {
  if (isWatch || confidence == null || confidence < 55) {
    return { stars: 0, isWatch: true };
  }
  if (confidence >= 90) return { stars: 5, isWatch: false };
  if (confidence >= 80) return { stars: 4, isWatch: false };
  if (confidence >= 70) return { stars: 3, isWatch: false };
  if (confidence >= 60) return { stars: 2, isWatch: false };
  return { stars: 1, isWatch: false };
}

/**
 * 渲染星级字符（★/☆）
 */
export function renderStarChars(stars: number): string {
  const filled = '★'.repeat(stars);
  const empty = '☆'.repeat(5 - stars);
  return filled + empty;
}
