// 篮球预测模型核心配置常量
// 所有硬编码的模型参数集中在此维护，数值保持与历史版本一致

export const BASKETBALL_MODEL_CONFIG = {
  spreadToWdwSigma: 12,
  handicapSigma: 7,
  totalSigma: 12,
  shrinkage: 0.85,

  homeCourtAdvantage: 2.5,
  baselineTotal: 165,

  confidence: {
    highThreshold: 65,
    mediumThreshold: 58,
    highGroupBy: 60,
    mediumGroupBy: 40,
  },

  wnbaMonthAdjust: {
    5: 0,
    6: 4,
    7: 3,
    8: -2.5,
    9: -1.5,
    10: 0,
  } as Record<number, number>,

  injuryWeight: {
    high: 1.0,
    medium: 0.5,
    low: 0.2,
  },

  elo: {
    weight: 0.25,
    homeAdvantage: 50,
    kFactor: 400,
  },

  h2h: {
    coefficient: 0.3,
  },

  recentForm: {
    last10Weight: 0.6,
    last20Weight: 0.4,
  },

  sampleSize: {
    minLeagueSamples: 30,
  },

  deepSpread: {
    superDeepThreshold: 25,
    deepLow: 47,
    deepHigh: 53,
  },
} as const;

export const FOOTBALL_MODEL_CONFIG = {
  confidence: {
    highGroupBy: 60,
    mediumGroupBy: 40,
  },
} as const;

export const STATS_CONFIG = {
  recentDays: 7,
  beijingOffsetHours: 8,
} as const;
