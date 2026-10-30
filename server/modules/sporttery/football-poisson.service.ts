import { Injectable } from '@nestjs/common';

export interface FootballPredictionInput {
  homeGoalsFor: number;
  homeGoalsAgainst: number;
  awayGoalsFor: number;
  awayGoalsAgainst: number;
  leagueAvgGoals?: number;
  homeAdvantage?: number;
  homeForm?: string;
  awayForm?: string;
  h2hHomeWins?: number;
  h2hAwayWins?: number;
  h2hDraws?: number;
  homeShotsPerGame?: number;
  awayShotsPerGame?: number;
  homeHomeRecord?: string;
  awayAwayRecord?: string;
}

export interface FootballPoissonResult {
  lambdaHome: number;
  lambdaAway: number;
  expectedTotal: number;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  overProb: number;
  underProb: number;
  mostLikelyScore: string;
  mostLikelyGoals: number;
  scoreMatrix: Array<{ home: number; away: number; prob: number }>;
  totalGoalsDist: Array<{ goals: number; prob: number }>;
  modelRules: string[];
}

const SCORE_MAX = 7;
const DEFAULT_LEAGUE_AVG = 2.5;
const DEFAULT_HOME_ADVANTAGE = 1.15;

function poissonProb(lambda: number, k: number): number {
  if (lambda <= 0 || !Number.isFinite(lambda)) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  const clampedLambda = Math.min(lambda, 20);
  let result = Math.exp(-clampedLambda);
  for (let i = 1; i <= k; i++) {
    result = (result * clampedLambda) / i;
  }
  return result;
}

function calcFormPoints(wdl: string | undefined): number {
  if (!wdl) return -1;
  let pts = 0;
  let count = 0;
  for (const ch of wdl.toUpperCase()) {
    if (ch === 'W') { pts += 3; count += 1; }
    else if (ch === 'D') { pts += 1; count += 1; }
    else if (ch === 'L') { count += 1; }
  }
  if (count === 0) return -1;
  return pts / (count * 3);
}

function buildBivariatePoisson(
  lambdaH: number,
  lambdaA: number,
  totalLine: number,
): {
  matrix: number[][];
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  overProb: number;
  totalDist: number[];
} {
  const matrix: number[][] = [];
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over = 0;
  let totalSum = 0;
  const totalDist: number[] = new Array(SCORE_MAX * 2 + 1).fill(0);
  const lineFloor = Math.floor(totalLine - 0.001);

  for (let h = 0; h <= SCORE_MAX; h++) {
    matrix[h] = [];
    const pH = poissonProb(lambdaH, h);
    for (let a = 0; a <= SCORE_MAX; a++) {
      const p = pH * poissonProb(lambdaA, a);
      matrix[h][a] = p;
      totalSum += p;
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h + a > lineFloor) over += p;
      if (h + a <= SCORE_MAX * 2) totalDist[h + a] += p;
    }
  }

  if (totalSum <= 0) {
    return { matrix, homeWinProb: 0, drawProb: 0, awayWinProb: 0, overProb: 0, totalDist };
  }

  for (let h = 0; h <= SCORE_MAX; h++) {
    for (let a = 0; a <= SCORE_MAX; a++) {
      matrix[h][a] = matrix[h][a] / totalSum;
    }
  }
  for (let i = 0; i < totalDist.length; i++) {
    totalDist[i] = totalDist[i] / totalSum;
  }

  return {
    matrix,
    homeWinProb: homeWin / totalSum,
    drawProb: draw / totalSum,
    awayWinProb: awayWin / totalSum,
    overProb: over / totalSum,
    totalDist,
  };
}

@Injectable()
export class FootballPoissonService {
  predict(input: FootballPredictionInput): FootballPoissonResult | null {
    const {
      homeGoalsFor,
      homeGoalsAgainst,
      awayGoalsFor,
      awayGoalsAgainst,
    } = input;

    if (
      !Number.isFinite(homeGoalsFor) || homeGoalsFor <= 0 ||
      !Number.isFinite(homeGoalsAgainst) || homeGoalsAgainst <= 0 ||
      !Number.isFinite(awayGoalsFor) || awayGoalsFor <= 0 ||
      !Number.isFinite(awayGoalsAgainst) || awayGoalsAgainst <= 0
    ) {
      return null;
    }

    const leagueAvgGoals = input.leagueAvgGoals ?? DEFAULT_LEAGUE_AVG;
    const homeAdvantage = input.homeAdvantage ?? DEFAULT_HOME_ADVANTAGE;
    const leagueAvgPerTeam = leagueAvgGoals / 2;

    const homeAttackStrength = homeGoalsFor / leagueAvgPerTeam;
    const awayAttackStrength = awayGoalsFor / leagueAvgPerTeam;
    const homeDefenseStrength = homeGoalsAgainst / leagueAvgPerTeam;
    const awayDefenseStrength = awayGoalsAgainst / leagueAvgPerTeam;

    let lambdaHome = homeAttackStrength * awayDefenseStrength * leagueAvgPerTeam * homeAdvantage;
    let lambdaAway = awayAttackStrength * homeDefenseStrength * leagueAvgPerTeam / homeAdvantage;

    const modelRules: string[] = [];
    modelRules.push(
      `xG泊松：主队λ=${lambdaHome.toFixed(2)}，客队λ=${lambdaAway.toFixed(2)}`,
    );
    modelRules.push(
      `攻防强度模型：主进攻${homeAttackStrength.toFixed(2)} × 客防守${awayDefenseStrength.toFixed(2)}`,
    );
    modelRules.push(
      `主客场修正：主场加成${Math.round((homeAdvantage - 1) * 100)}%`,
    );

    const homeFormRate = calcFormPoints(input.homeForm);
    const awayFormRate = calcFormPoints(input.awayForm);
    if (homeFormRate >= 0 && awayFormRate >= 0) {
      if (homeFormRate > 0.6) {
        lambdaHome *= 1.05;
        modelRules.push('近期状态修正：主队拿分率>60%，进攻+5%');
      } else if (homeFormRate < 0.3) {
        lambdaHome *= 0.95;
        modelRules.push('近期状态修正：主队拿分率<30%，进攻-5%');
      }
      if (awayFormRate > 0.6) {
        lambdaAway *= 1.05;
        modelRules.push('近期状态修正：客队拿分率>60%，进攻+5%');
      } else if (awayFormRate < 0.3) {
        lambdaAway *= 0.95;
        modelRules.push('近期状态修正：客队拿分率<30%，进攻-5%');
      }
    }

    const homeHomeRate = calcFormPoints(input.homeHomeRecord);
    const awayAwayRate = calcFormPoints(input.awayAwayRecord);
    if (homeHomeRate >= 0) {
      const homeHomeAdj = 1 + (homeHomeRate - 0.5) * 0.1;
      lambdaHome *= Math.max(0.9, Math.min(1.1, homeHomeAdj));
      modelRules.push(
        `主场战绩修正：主場胜率${Math.round(homeHomeRate * 100)}%，系数${homeHomeAdj.toFixed(3)}`,
      );
    }
    if (awayAwayRate >= 0) {
      const awayAwayAdj = 1 + (awayAwayRate - 0.5) * 0.1;
      lambdaAway *= Math.max(0.9, Math.min(1.1, awayAwayAdj));
      modelRules.push(
        `客场战绩修正：客场胜率${Math.round(awayAwayRate * 100)}%，系数${awayAwayAdj.toFixed(3)}`,
      );
    }

    const homeShots = input.homeShotsPerGame ?? 0;
    const awayShots = input.awayShotsPerGame ?? 0;
    if (homeShots > 0 && awayShots > 0) {
      const xGConversionRate = 0.11;
      const xGHome = homeShots * xGConversionRate;
      const xGAway = awayShots * xGConversionRate;
      const xGHomeWeight = 0.3;
      const xGAwayWeight = 0.3;
      lambdaHome = lambdaHome * (1 - xGHomeWeight) + xGHome * xGHomeWeight;
      lambdaAway = lambdaAway * (1 - xGAwayWeight) + xGAway * xGAwayWeight;
      modelRules.push(
        `射门xG校准：主射门${homeShots.toFixed(1)}→xG${xGHome.toFixed(2)}，客射门${awayShots.toFixed(1)}→xG${xGAway.toFixed(2)}（权重30%）`,
      );
    }

    const h2hTotal = (input.h2hHomeWins ?? 0) + (input.h2hAwayWins ?? 0) + (input.h2hDraws ?? 0);
    if (h2hTotal >= 3) {
      const h2hHomeWinRate = (input.h2hHomeWins ?? 0) / h2hTotal;
      const h2hAwayWinRate = (input.h2hAwayWins ?? 0) / h2hTotal;
      const h2hDiff = h2hHomeWinRate - h2hAwayWinRate;
      const h2hAdj = 1 + h2hDiff * 0.15;
      if (Math.abs(h2hDiff) >= 0.2) {
        if (h2hDiff > 0) {
          lambdaHome *= h2hAdj;
        } else {
          lambdaAway *= (2 - h2hAdj);
        }
        modelRules.push(
          `H2H修正：历史交锋${h2hDiff > 0 ? '主队' : '客队'}占优（${Math.round(Math.abs(h2hDiff) * 100)}%胜率差）`,
        );
      }
    }

    lambdaHome = Math.max(0.1, Math.min(8, lambdaHome));
    lambdaAway = Math.max(0.1, Math.min(8, lambdaAway));
    const expectedTotal = lambdaHome + lambdaAway;

    const bp = buildBivariatePoisson(lambdaHome, lambdaAway, 2.5);

    const allScores: Array<{ home: number; away: number; prob: number }> = [];
    for (let h = 0; h <= SCORE_MAX; h++) {
      for (let a = 0; a <= SCORE_MAX; a++) {
        allScores.push({ home: h, away: a, prob: bp.matrix[h][a] });
      }
    }
    allScores.sort((a, b) => b.prob - a.prob);

    const topScores = allScores.slice(0, 12).map((s) => ({
      home: s.home,
      away: s.away,
      prob: Math.round(s.prob * 1000) / 10,
    }));

    const totalGoalsDist: Array<{ goals: number; prob: number }> = [];
    for (let g = 0; g <= 7; g++) {
      totalGoalsDist.push({
        goals: g,
        prob: Math.round(bp.totalDist[g] * 1000) / 10,
      });
    }

    let mostLikelyGoals = 0;
    let maxGoalProb = 0;
    for (let g = 0; g <= 7; g++) {
      if (bp.totalDist[g] > maxGoalProb) {
        maxGoalProb = bp.totalDist[g];
        mostLikelyGoals = g;
      }
    }

    return {
      lambdaHome: Math.round(lambdaHome * 100) / 100,
      lambdaAway: Math.round(lambdaAway * 100) / 100,
      expectedTotal: Math.round(expectedTotal * 100) / 100,
      homeWinProb: Math.round(bp.homeWinProb * 100),
      drawProb: Math.round(bp.drawProb * 100),
      awayWinProb: Math.round(bp.awayWinProb * 100),
      overProb: Math.round(bp.overProb * 100),
      underProb: Math.round((1 - bp.overProb) * 100),
      mostLikelyScore: `${topScores[0].home}-${topScores[0].away}`,
      mostLikelyGoals,
      scoreMatrix: topScores,
      totalGoalsDist,
      modelRules,
    };
  }

  getOverUnderProb(
    lambdaHome: number,
    lambdaAway: number,
    line: number,
  ): { overProb: number; underProb: number } {
    const totalLambda = lambdaHome + lambdaAway;
    const lineFloor = Math.floor(line - 0.001);
    let underP = 0;
    for (let k = 0; k <= lineFloor; k++) {
      underP += poissonProb(totalLambda, k);
    }
    underP = Math.min(1, Math.max(0, underP));
    return {
      overProb: Math.round((1 - underP) * 100),
      underProb: Math.round(underP * 100),
    };
  }
}
