import { Injectable } from '@nestjs/common';

/**
 * Elo 评分计算服务（足球 + 篮球通用）
 *
 * 参数化配置集中声明，所有默认值均可通过方法参数覆盖。
 */

// ---- 常量配置 ----

/** 初始 Elo 评分：所有新球队默认 1500 */
const INITIAL_RATING: number = 1500;

/** 足球主场优势（Elo 分）：65 */
const FOOTBALL_HOME_ADVANTAGE: number = 65;

/** 篮球主场优势（Elo 分）：100 */
const BASKETBALL_HOME_ADVANTAGE: number = 100;

/** 默认 K 值：32（常规比赛强度） */
const DEFAULT_K_FACTOR: number = 32;

/** 赛季均值回归系数：0（默认关闭，启用后每个赛季向均值收缩） */
const REGRESSION_COEFFICIENT: number = 0;

/** Elo 基准分差（分母）：400 分差对应 10 倍胜率比 */
const ELO_DENOMINATOR: number = 400;

/** 平局概率的基础值：0.25 */
const DRAW_PROB_BASE: number = 0.25;

/** 平局概率的变化系数：0.05 */
const DRAW_PROB_WIDTH: number = 0.05;

/** 平局概率的 Elo 分差衰减范围：500（分差超出此值时平局概率取最小值） */
const DRAW_PROB_RANGE: number = 500;

/** 平局概率最小值（分差足够大时）：0.20 */
const DRAW_PROB_MIN: number = 0.20;

/** 篮球正态 CDF 标准差系数：eloGap / 200 作为 z-score */
const BASKETBALL_CDF_SCALE: number = 200;

// ---- 接口定义 ----

export interface ExpectedResult {
  homeExp: number;
  awayExp: number;
}

export interface UpdatedRatings {
  newHomeRating: number;
  newAwayRating: number;
  homeChange: number;
  awayChange: number;
}

export interface PredictResult {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  eloGap: number;
}

// ---- 工具函数 ----

/**
 * 标准正态分布 CDF（Abramowitz & Stegun 近似，误差 < 7.5e-8）
 */
function normalCdf(z: number): number {
  // 常数
  const a1: number = 0.254829592;
  const a2: number = -0.284496736;
  const a3: number = 1.421413741;
  const a4: number = -1.453152027;
  const a5: number = 1.061405429;
  const p: number = 0.3275911;

  const sign: number = z < 0 ? -1 : 1;
  const absZ: number = Math.abs(z);
  const t: number = 1.0 / (1.0 + p * absZ);
  const y: number =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ / 2);
  return 0.5 * (1.0 + sign * y);
}

/**
 * 根据比分计算实际得分（胜=1，平=0.5，负=0）
 */
function computeActualScore(homeScore: number, awayScore: number): number {
  if (homeScore > awayScore) return 1;
  if (homeScore === awayScore) return 0.5;
  return 0;
}

@Injectable()
export class EloService {
  /** 获取默认初始评分 */
  getInitialRating(): number {
    return INITIAL_RATING;
  }

  /** 获取指定运动的默认主场优势 */
  getDefaultHomeAdvantage(sport: 'football' | 'basketball'): number {
    return sport === 'football'
      ? FOOTBALL_HOME_ADVANTAGE
      : BASKETBALL_HOME_ADVANTAGE;
  }

  /** 获取默认 K 值 */
  getDefaultKFactor(): number {
    return DEFAULT_K_FACTOR;
  }

  /**
   * 计算 Elo 预期胜率
   * E_A = 1 / (1 + 10^((R_B - R_A) / 400))
   *
   * @param homeRating 主队当前 Elo 评分
   * @param awayRating 客队当前 Elo 评分
   * @param homeAdvantage 主场优势（加到主队评分上再计算）
   */
  calculateExpected(
    homeRating: number,
    awayRating: number,
    homeAdvantage: number,
  ): ExpectedResult {
    const adjustedHome: number = homeRating + homeAdvantage;
    const ratingDiff: number = awayRating - adjustedHome;
    const homeExp: number = 1 / (1 + Math.pow(10, ratingDiff / ELO_DENOMINATOR));
    const awayExp: number = 1 - homeExp;
    return { homeExp, awayExp };
  }

  /**
   * 比赛后更新 Elo 评分
   * 新评分 = 旧评分 + K × (实际得分 - 预期得分)
   *
   * @param homeRating 主队赛前 Elo 评分
   * @param awayRating 客队赛前 Elo 评分
   * @param homeScore 主队实际得分
   * @param awayScore 客队实际得分
   * @param kFactor K 值
   * @param homeAdvantage 主场优势
   * @param sport 运动类型（用于主场优势默认值，这里由参数显式传入，仅作类型标识）
   */
  updateRatings(
    homeRating: number,
    awayRating: number,
    homeScore: number,
    awayScore: number,
    kFactor: number,
    homeAdvantage: number,
    sport: 'football' | 'basketball',
  ): UpdatedRatings {
    const { homeExp, awayExp } = this.calculateExpected(
      homeRating,
      awayRating,
      homeAdvantage,
    );

    const actualHome: number = computeActualScore(homeScore, awayScore);
    const actualAway: number = computeActualScore(awayScore, homeScore);

    const homeChange: number = kFactor * (actualHome - homeExp);
    const awayChange: number = kFactor * (actualAway - awayExp);

    const newHomeRating: number = homeRating + homeChange;
    const newAwayRating: number = awayRating + awayChange;

    // 引用 sport 参数避免未使用变量警告（保留以便未来差异化逻辑）
    void sport;

    return {
      newHomeRating,
      newAwayRating,
      homeChange,
      awayChange,
    };
  }

  /**
   * 从 Elo 分差推导胜平负概率
   *
   * - 足球：Elo 差映射胜率，平局概率 = 0.25 + 0.05 × (1 - |gap|/500)，
   *   当 |gap| > 500 时取 0.20，最后归一化使三项之和为 1
   * - 篮球：直接二元概率，正态 CDF：homeWinProb = Φ(eloGap / 200)
   *
   * @param homeRating 主队 Elo 评分
   * @param awayRating 客队 Elo 评分
   * @param homeAdvantage 主场优势
   */
  predictFromElo(
    homeRating: number,
    awayRating: number,
    homeAdvantage: number,
  ): PredictResult {
    const adjustedHome: number = homeRating + homeAdvantage;
    const eloGap: number = adjustedHome - awayRating;

    const absGap: number = Math.abs(eloGap);

    // 足球：使用 Elo 预期胜率 + 平局概率模型
    const { homeExp, awayExp } = this.calculateExpected(
      homeRating,
      awayRating,
      homeAdvantage,
    );

    // 平局概率：0.25 + 0.05 × (1 - |gap|/500)，分差 > 500 时取 0.20
    let drawProb: number;
    if (absGap >= DRAW_PROB_RANGE) {
      drawProb = DRAW_PROB_MIN;
    } else {
      drawProb =
        DRAW_PROB_BASE +
        DRAW_PROB_WIDTH * (1 - absGap / DRAW_PROB_RANGE);
    }

    // 归一化：homeWin + draw + awayWin = 1
    const rawSum: number = homeExp + awayExp;
    const scaleFactor: number = (1 - drawProb) / rawSum;
    const homeWinProb: number = homeExp * scaleFactor;
    const awayWinProb: number = awayExp * scaleFactor;

    return {
      homeWinProb,
      drawProb,
      awayWinProb,
      eloGap,
    };
  }

  /**
   * 篮球二元胜/负概率（正态 CDF）
   * homeWinProb = Φ(eloGap / 200)
   *
   * @param homeRating 主队 Elo 评分
   * @param awayRating 客队 Elo 评分
   * @param homeAdvantage 主场优势
   */
  predictBasketballBinary(
    homeRating: number,
    awayRating: number,
    homeAdvantage: number,
  ): { homeWinProb: number; awayWinProb: number; eloGap: number } {
    const adjustedHome: number = homeRating + homeAdvantage;
    const eloGap: number = adjustedHome - awayRating;
    const zScore: number = eloGap / BASKETBALL_CDF_SCALE;
    const homeWinProb: number = normalCdf(zScore);
    const awayWinProb: number = 1 - homeWinProb;
    return { homeWinProb, awayWinProb, eloGap };
  }

  /**
   * 获取赛季均值回归系数
   */
  getRegressionCoefficient(): number {
    return REGRESSION_COEFFICIENT;
  }
}
