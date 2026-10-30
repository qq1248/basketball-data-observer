import { Injectable } from '@nestjs/common';

// ===== 参数化常量（可审计） =====
/** 基准射门转化率 */
const BASE_SHOT_CONVERSION = 0.11;
/** 射正率基准 */
const SHOT_ON_TARGET_RATIO = 0.35;
/** 联赛场均射门基准 */
const LEAGUE_AVG_SHOTS = 12.0;
/** 高置信度最少样本场次 */
const XG_CONFIDENCE_THRESHOLD_HIGH = 10;
/** 中置信度最少样本场次 */
const XG_CONFIDENCE_THRESHOLD_MEDIUM = 5;
/** 对手防守强度调整系数 */
const OPPONENT_STRENGTH_ADJUST = 0.15;
/** 默认 xG 融合权重 */
const DEFAULT_XG_WEIGHT = 0.3;
/** 低置信度下 xG 融合权重 */
const LOW_CONFIDENCE_XG_WEIGHT = 0.1;

// ===== 类型定义 =====
export type XgQuality = 'high' | 'medium' | 'low' | 'none';

export interface TeamXgResult {
  xg: number;
  xgQuality: XgQuality;
}

export interface MatchXgInput {
  homeShotsPerGame: number;
  awayShotsPerGame: number;
  homeDefenseStrength: number;
  awayDefenseStrength: number;
  leagueAvgShots?: number;
  homeAdvantage?: number;
  sampleSize?: number;
}

export interface MatchXgResult {
  homeXg: number;
  awayXg: number;
  /** 主队预期被进球（对手xG vs 主队防守） */
  homeXga: number;
  /** 客队预期被进球（对手xG vs 客队防守） */
  awayXga: number;
  quality: XgQuality;
  dataSource: 'proxy_shots_based';
}

@Injectable()
export class XgProxyService {
  /**
   * 计算单支球队的代理 xG
   * @param shotsPerGame 球队场均射门数
   * @param opponentDefenseStrength 对手防守强度（失球率/联赛均值，>1=防守弱，<1=防守强）
   * @param leagueAvgShots 联赛场均射门基准
   * @param homeAdvantage 主场优势系数（默认 1.0）
   */
  calculateTeamXg(
    shotsPerGame: number,
    opponentDefenseStrength: number,
    leagueAvgShots: number,
    homeAdvantage: number = 1.0,
  ): { xg: number; xgQuality: 'high' | 'medium' | 'low' } {
    const safeShots: number = Math.max(0, shotsPerGame);
    const safeLeague: number = Math.max(1, leagueAvgShots);
    const safeOpponent: number = Math.max(0.1, Math.min(3, opponentDefenseStrength));
    const safeHomeAdv: number = Math.max(0.5, Math.min(2, homeAdvantage));

    // 对手防守调整：对手越强（值越小），xG 越低
    const opponentAdjustment: number =
      1 - (safeOpponent - 1) * OPPONENT_STRENGTH_ADJUST;

    const xg: number =
      (safeShots / safeLeague) *
      LEAGUE_AVG_SHOTS *
      BASE_SHOT_CONVERSION *
      (1 + (safeHomeAdv - 1) * 0.05) *
      opponentAdjustment;

    // quality 由调用方按样本量判断，这里默认 high
    return { xg: Math.max(0, xg), xgQuality: 'high' };
  }

  /**
   * 计算一场比赛双方的代理 xG 和 xGA
   */
  calculateMatchXg(input: MatchXgInput): MatchXgResult {
    const {
      homeShotsPerGame,
      awayShotsPerGame,
      homeDefenseStrength,
      awayDefenseStrength,
      leagueAvgShots = LEAGUE_AVG_SHOTS,
      homeAdvantage = 1.15,
      sampleSize = 0,
    } = input;

    const hasShotsData: boolean =
      Number.isFinite(homeShotsPerGame) &&
      homeShotsPerGame > 0 &&
      Number.isFinite(awayShotsPerGame) &&
      awayShotsPerGame > 0;

    if (!hasShotsData) {
      return {
        homeXg: 0,
        awayXg: 0,
        homeXga: 0,
        awayXga: 0,
        quality: 'none',
        dataSource: 'proxy_shots_based',
      };
    }

    // 主队 xG：主队射门 vs 客队防守
    const homeXgResult = this.calculateTeamXg(
      homeShotsPerGame,
      awayDefenseStrength,
      leagueAvgShots,
      homeAdvantage,
    );

    // 客队 xG：客队射门 vs 主队防守
    const awayXgResult = this.calculateTeamXg(
      awayShotsPerGame,
      homeDefenseStrength,
      leagueAvgShots,
      1 / homeAdvantage, // 客场劣势
    );

    // xGA：本方被预期进球 = 对手进攻 xG
    // homeXga = 客队进攻 vs 主队防守 的 xG（即 awayXg）
    // awayXga = 主队进攻 vs 客队防守 的 xG（即 homeXg）
    const quality: XgQuality = this.resolveQuality(sampleSize);

    return {
      homeXg: Math.round(homeXgResult.xg * 100) / 100,
      awayXg: Math.round(awayXgResult.xg * 100) / 100,
      homeXga: Math.round(awayXgResult.xg * 100) / 100,
      awayXga: Math.round(homeXgResult.xg * 100) / 100,
      quality,
      dataSource: 'proxy_shots_based',
    };
  }

  /**
   * 将 xG 信息融合进泊松 λ 值
   * @param baseLambda 原始泊松 λ
   * @param xgValue xG 代理值
   * @param weight 融合权重（默认 0.3，低置信度自动降为 0.1）
   */
  adjustPoissonLambda(
    baseLambda: number,
    xgValue: number,
    weight: number = DEFAULT_XG_WEIGHT,
  ): number {
    if (!Number.isFinite(baseLambda) || baseLambda <= 0) return baseLambda;
    if (!Number.isFinite(xgValue) || xgValue <= 0) return baseLambda;

    const safeWeight: number = Math.max(0, Math.min(1, weight));
    const adjusted: number = baseLambda * (1 - safeWeight) + xgValue * safeWeight;
    return Math.round(adjusted * 100) / 100;
  }

  /**
   * 根据样本量返回置信度权重
   */
  getWeightByQuality(quality: XgQuality): number {
    if (quality === 'low' || quality === 'none') return LOW_CONFIDENCE_XG_WEIGHT;
    return DEFAULT_XG_WEIGHT;
  }

  private resolveQuality(sampleSize: number): XgQuality {
    if (!sampleSize || sampleSize < XG_CONFIDENCE_THRESHOLD_MEDIUM) return 'low';
    if (sampleSize < XG_CONFIDENCE_THRESHOLD_HIGH) return 'medium';
    return 'high';
  }
}
