import { Injectable } from '@nestjs/common';

// ====== 足球特征输入 ======
export interface FootballFeatureInput {
  eloGap: number;
  homeXgAvg: number;
  awayXgAvg: number;
  homeGoalsAvg: number;
  awayGoalsAvg: number;
  homeConcededAvg: number;
  awayConcededAvg: number;
  leagueAvgGoals: number;
  homeFormPts: number;
  awayFormPts: number;
  homeAdvantageFlag: number;
  h2hHomeWinRate: number;
  restDaysDiff: number;
}

// ====== 篮球特征输入 ======
export interface BasketballFeatureInput {
  eloGap: number;
  homeOrtg: number;
  awayOrtg: number;
  homeDrtg: number;
  awayDrtg: number;
  homePace: number;
  awayPace: number;
  leagueAvgOrtg: number;
  leagueAvgPace: number;
  homeFormPts: number;
  awayFormPts: number;
  injuryImpactDiff: number;
}

// ====== 足球特征名（12维，顺序严格对应特征向量） ======
export const FOOTBALL_FEATURE_NAMES: string[] = [
  'elo_gap_normalized',
  'home_xg_avg',
  'away_xg_avg',
  'home_attack_strength',
  'away_attack_strength',
  'home_defense_strength',
  'away_defense_strength',
  'home_form_pts',
  'away_form_pts',
  'home_advantage_flag',
  'h2h_home_win_rate',
  'rest_days_diff',
];

// ====== 篮球特征名（10维，顺序严格对应特征向量） ======
export const BASKETBALL_FEATURE_NAMES: string[] = [
  'elo_gap_normalized',
  'home_ortg_ratio',
  'away_ortg_ratio',
  'home_drtg_ratio_inv',
  'away_drtg_ratio_inv',
  'home_pace_ratio',
  'away_pace_ratio',
  'home_form_pts',
  'away_form_pts',
  'injury_impact_diff',
];

// ====== 足球 z-score 标准化基线参数（mean, std）======
// 基于历史数据统计的先验值，后续可通过训练脚本校准
const FOOTBALL_FEATURE_STATS: Array<{ mean: number; std: number }> = [
  { mean: 0.0, std: 1.0 },    // 0: elo_gap_normalized (已除以200)
  { mean: 1.35, std: 0.45 },  // 1: home_xg_avg
  { mean: 1.25, std: 0.42 },  // 2: away_xg_avg
  { mean: 1.05, std: 0.25 },  // 3: home_attack_strength
  { mean: 0.98, std: 0.24 },  // 4: away_attack_strength
  { mean: 1.02, std: 0.23 },  // 5: home_defense_strength
  { mean: 1.00, std: 0.22 },  // 6: away_defense_strength
  { mean: 0.50, std: 0.20 },  // 7: home_form_pts
  { mean: 0.48, std: 0.20 },  // 8: away_form_pts
  { mean: 0.50, std: 0.50 },  // 9: home_advantage_flag
  { mean: 0.42, std: 0.22 },  // 10: h2h_home_win_rate
  { mean: 0.0, std: 0.35 },   // 11: rest_days_diff (已归一化到[-1,1])
];

// ====== 篮球 z-score 标准化基线参数 ======
const BASKETBALL_FEATURE_STATS: Array<{ mean: number; std: number }> = [
  { mean: 0.0, std: 1.0 },    // 0: elo_gap_normalized
  { mean: 1.02, std: 0.08 },  // 1: home_ortg_ratio
  { mean: 0.99, std: 0.08 },  // 2: away_ortg_ratio
  { mean: 1.00, std: 0.08 },  // 3: home_drtg_ratio_inv (倒数)
  { mean: 1.02, std: 0.08 },  // 4: away_drtg_ratio_inv
  { mean: 1.01, std: 0.06 },  // 5: home_pace_ratio
  { mean: 0.99, std: 0.06 },  // 6: away_pace_ratio
  { mean: 0.52, std: 0.18 },  // 7: home_form_pts
  { mean: 0.48, std: 0.18 },  // 8: away_form_pts
  { mean: 0.0, std: 0.30 },   // 9: injury_impact_diff
];

// ====== 归一化常量 ======
const ELO_SCALE_FACTOR = 200;       // Elo 分差缩放因子
const REST_DAYS_MAX_DIFF = 7;       // 休息天数差归一化最大值（天）
const INJURY_IMPACT_WEIGHT = 0.15;  // 每缺阵1名核心球员的影响权重
const LEAGUE_AVG_FOOTBALL_GOALS = 2.6; // 足球联赛场均进球基准
const MIN_SAFE_RATIO_DIVISOR = 0.01;   // 比率计算时的最小分母保护

@Injectable()
export class FeatureEngineeringService {
  // ====== 足球特征提取（12维）======
  extractFootballFeatures(input: FootballFeatureInput): {
    features: number[];
    featureNames: string[];
  } {
    const leagueAvgPerTeam: number =
      (input.leagueAvgGoals || LEAGUE_AVG_FOOTBALL_GOALS) / 2;

    const rawFeatures: number[] = [
      // 1. Elo 分差归一化
      input.eloGap / ELO_SCALE_FACTOR,
      // 2. 主队场均 xG 代理值
      input.homeXgAvg,
      // 3. 客队场均 xG 代理值
      input.awayXgAvg,
      // 4. 主队进攻强度（相对于联赛均值）
      input.homeGoalsAvg /
        Math.max(leagueAvgPerTeam, MIN_SAFE_RATIO_DIVISOR),
      // 5. 客队进攻强度
      input.awayGoalsAvg /
        Math.max(leagueAvgPerTeam, MIN_SAFE_RATIO_DIVISOR),
      // 6. 主队防守强度（失球/联赛均值，越低越好→但保留原值，后续模型学到方向）
      input.homeConcededAvg /
        Math.max(leagueAvgPerTeam, MIN_SAFE_RATIO_DIVISOR),
      // 7. 客队防守强度
      input.awayConcededAvg /
        Math.max(leagueAvgPerTeam, MIN_SAFE_RATIO_DIVISOR),
      // 8. 主队近5场积分率
      this.clamp(input.homeFormPts, 0, 1),
      // 9. 客队近5场积分率
      this.clamp(input.awayFormPts, 0, 1),
      // 10. 主客场标记
      input.homeAdvantageFlag,
      // 11. 交锋主队胜率
      this.clamp(input.h2hHomeWinRate, 0, 1),
      // 12. 休息天数差（归一化到 [-1, 1]）
      this.clamp(input.restDaysDiff / REST_DAYS_MAX_DIFF, -1, 1),
    ];

    const features: number[] = rawFeatures.map((val: number, idx: number) =>
      this.normalize(val, FOOTBALL_FEATURE_STATS[idx].mean, FOOTBALL_FEATURE_STATS[idx].std)
    );

    return { features, featureNames: [...FOOTBALL_FEATURE_NAMES] };
  }

  // ====== 篮球特征提取（10维）======
  extractBasketballFeatures(input: BasketballFeatureInput): {
    features: number[];
    featureNames: string[];
  } {
    const safeAvgOrtg: number = Math.max(input.leagueAvgOrtg, MIN_SAFE_RATIO_DIVISOR);
    const safeAvgPace: number = Math.max(input.leagueAvgPace, MIN_SAFE_RATIO_DIVISOR);

    const rawFeatures: number[] = [
      // 1. Elo 分差归一化
      input.eloGap / ELO_SCALE_FACTOR,
      // 2. 主队进攻效率比
      input.homeOrtg / safeAvgOrtg,
      // 3. 客队进攻效率比
      input.awayOrtg / safeAvgOrtg,
      // 4. 主队防守效率（越低越好→取倒数，使值越大防守越好）
      safeAvgOrtg / Math.max(input.homeDrtg, MIN_SAFE_RATIO_DIVISOR),
      // 5. 客队防守效率倒数
      safeAvgOrtg / Math.max(input.awayDrtg, MIN_SAFE_RATIO_DIVISOR),
      // 6. 主队节奏比
      input.homePace / safeAvgPace,
      // 7. 客队节奏比
      input.awayPace / safeAvgPace,
      // 8. 主队近况胜率
      this.clamp(input.homeFormPts, 0, 1),
      // 9. 客队近况胜率
      this.clamp(input.awayFormPts, 0, 1),
      // 10. 伤停影响差（核心缺阵人数差×权重，正值=主队缺阵更多→不利）
      input.injuryImpactDiff * INJURY_IMPACT_WEIGHT,
    ];

    const features: number[] = rawFeatures.map((val: number, idx: number) =>
      this.normalize(val, BASKETBALL_FEATURE_STATS[idx].mean, BASKETBALL_FEATURE_STATS[idx].std)
    );

    return { features, featureNames: [...BASKETBALL_FEATURE_NAMES] };
  }

  // ====== z-score 标准化 ======
  normalize(value: number, mean: number, std: number): number {
    if (std <= 0 || !Number.isFinite(std)) {
      return value - mean;
    }
    return (value - mean) / std;
  }

  // ====== 工具：数值截断 ======
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
