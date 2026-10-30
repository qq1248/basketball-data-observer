import { Injectable, Logger } from '@nestjs/common';

export interface TeamEfficiencyInput {
  pointsPerGame: number;
  fieldGoalsAttemptedPerGame: number;
  freeThrowsAttemptedPerGame: number;
  turnoversPerGame: number;
  offensiveReboundsPerGame: number;
  defensiveReboundsPerGame: number;
  stealsPerGame: number;
  blocksPerGame: number;
  freeThrowPct: number;
  fieldGoalPct: number;
  threePointPct: number;
  assistsPerGame: number;
  reboundsPerGame: number;
  winRate: number;
}

export interface EfficiencyPredictionResult {
  expectedHomeScore: number;
  expectedAwayScore: number;
  expectedTotal: number;
  expectedSpread: number;
  pace: number;
  homeORtg: number;
  awayORtg: number;
  homeDRtg: number;
  awayDRtg: number;
  homeAdvantage: number;
  modelRules: string[];
}

export interface TeamStatsRaw {
  pointsPerGame?: string | number;
  fieldGoalsAttemptedPerGame?: string | number;
  freeThrowsAttemptedPerGame?: string | number;
  turnoversPerGame?: string | number;
  offensiveReboundsPerGame?: string | number;
  defensiveReboundsPerGame?: string | number;
  stealsPerGame?: string | number;
  blocksPerGame?: string | number;
  freeThrowPct?: string | number;
  fieldGoalPct?: string | number;
  threePointPct?: string | number;
  assistsPerGame?: string | number;
  reboundsPerGame?: string | number;
  winRate?: string | number;
  [key: string]: unknown;
}

function toNum(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function leagueKey(league: string): string {
  const name = league || '';
  if (name.includes('WNBA')) return 'WNBA';
  if (name.includes('NBA')) return 'NBA';
  if (name.includes('CBA')) return 'CBA';
  if (name.includes('澳NBL') || name.includes('澳大利亚')) return 'NBL';
  if (name.includes('德篮') || name.includes('BBL')) return 'BBL';
  if (name.includes('欧冠篮') || name.includes('欧篮联')) return 'EuroLeague';
  if (name.includes('FIBA') || name.includes('亚运') || name.includes('世界杯'))
    return 'FIBA';
  return 'default';
}

function getLeagueHomeAdvantage(league: string): number {
  const k = leagueKey(league);
  if (k === 'WNBA') return 3.0;
  if (k === 'NBA') return 2.5;
  if (k === 'EuroLeague') return 4.0;
  return 3.0;
}

function getLeagueBaselineOrtg(league: string): number {
  const k = leagueKey(league);
  switch (k) {
    case 'NBA':
      return 114;
    case 'WNBA':
      return 104;
    case 'CBA':
      return 110;
    case 'NBL':
      return 105;
    case 'BBL':
      return 102;
    case 'EuroLeague':
      return 100;
    case 'FIBA':
      return 98;
    default:
      return 105;
  }
}

function getLeagueBaselinePace(league: string): number {
  const k = leagueKey(league);
  switch (k) {
    case 'NBA':
      return 100;
    case 'WNBA':
      return 78;
    case 'CBA':
      return 90;
    case 'NBL':
      return 85;
    case 'BBL':
      return 82;
    case 'EuroLeague':
      return 78;
    case 'FIBA':
      return 75;
    default:
      return 82;
  }
}

function getLeaguePossessionCoefficient(_league: string): number {
  return 1.0;
}

function normalizeTeamStats(raw: TeamStatsRaw): TeamEfficiencyInput {
  return {
    pointsPerGame: toNum(raw.pointsPerGame),
    fieldGoalsAttemptedPerGame: toNum(raw.fieldGoalsAttemptedPerGame),
    freeThrowsAttemptedPerGame: toNum(raw.freeThrowsAttemptedPerGame),
    turnoversPerGame: toNum(raw.turnoversPerGame),
    offensiveReboundsPerGame: toNum(raw.offensiveReboundsPerGame),
    defensiveReboundsPerGame: toNum(raw.defensiveReboundsPerGame),
    stealsPerGame: toNum(raw.stealsPerGame),
    blocksPerGame: toNum(raw.blocksPerGame),
    freeThrowPct: toNum(raw.freeThrowPct),
    fieldGoalPct: toNum(raw.fieldGoalPct),
    threePointPct: toNum(raw.threePointPct),
    assistsPerGame: toNum(raw.assistsPerGame),
    reboundsPerGame: toNum(raw.reboundsPerGame),
    winRate: toNum(raw.winRate),
  };
}

@Injectable()
export class BasketballEfficiencyService {
  private readonly logger = new Logger(BasketballEfficiencyService.name);

  calculatePossessions(ts: TeamEfficiencyInput, league: string = 'default'): number {
    const fga = ts.fieldGoalsAttemptedPerGame;
    const fta = ts.freeThrowsAttemptedPerGame;
    const orb = ts.offensiveReboundsPerGame;
    const tov = ts.turnoversPerGame;
    if (fga <= 0) return 0;
    const coef = getLeaguePossessionCoefficient(league);
    return coef * (fga + 0.475 * fta - orb + tov);
  }

  calculatePace(homeStats: TeamEfficiencyInput, awayStats: TeamEfficiencyInput): number {
    const homePoss = this.calculatePossessions(homeStats);
    const awayPoss = this.calculatePossessions(awayStats);
    if (homePoss <= 0 && awayPoss <= 0) return 0;
    if (homePoss <= 0) return awayPoss;
    if (awayPoss <= 0) return homePoss;
    return (homePoss + awayPoss) / 2;
  }

  calculateORtg(ts: TeamEfficiencyInput, gamePace: number): number {
    if (gamePace <= 0 || ts.pointsPerGame <= 0) return 0;
    return (ts.pointsPerGame / gamePace) * 100;
  }

  calculateDefensiveRating(
    ts: TeamEfficiencyInput,
    leagueAvgOrtg: number,
    leagueBaselinePace: number,
    teamPace: number,
  ): number {
    const stl = ts.stealsPerGame;
    const blk = ts.blocksPerGame;
    const drb = ts.defensiveReboundsPerGame;

    const paceFactor = teamPace > 0 && leagueBaselinePace > 0
      ? leagueBaselinePace / teamPace
      : 1;

    const defensiveStopsPerGame = stl + blk * 1.5 + drb * 0.08;
    const leagueAvgStops = 12 + 0.08 * 32;
    const stopsDiff = defensiveStopsPerGame - leagueAvgStops;
    const rtgAdjustment = stopsDiff * 0.85 * paceFactor;

    return leagueAvgOrtg - rtgAdjustment;
  }

  hasSufficientData(homeRaw: TeamStatsRaw, awayRaw: TeamStatsRaw): boolean {
    const home = normalizeTeamStats(homeRaw);
    const away = normalizeTeamStats(awayRaw);
    const hasHome = home.pointsPerGame > 0 && home.fieldGoalsAttemptedPerGame > 0;
    const hasAway = away.pointsPerGame > 0 && away.fieldGoalsAttemptedPerGame > 0;
    return hasHome && hasAway;
  }

  predictGame(
    homeRaw: TeamStatsRaw,
    awayRaw: TeamStatsRaw,
    league: string,
  ): EfficiencyPredictionResult | null {
    if (!this.hasSufficientData(homeRaw, awayRaw)) return null;

    const homeStats = normalizeTeamStats(homeRaw);
    const awayStats = normalizeTeamStats(awayRaw);

    const leagueAvgOrtg = getLeagueBaselineOrtg(league);
    const leagueBaselinePace = getLeagueBaselinePace(league);

    const homePoss = this.calculatePossessions(homeStats, league);
    const awayPoss = this.calculatePossessions(awayStats, league);
    const rawPace = this.calculatePace(homeStats, awayStats);

    const paceMin = leagueBaselinePace * 0.7;
    const paceMax = leagueBaselinePace * 1.3;
    const pace = Math.max(paceMin, Math.min(paceMax, rawPace > 0 ? rawPace : leagueBaselinePace));

    const homeORtgRaw = this.calculateORtg(homeStats, homePoss > 0 ? homePoss : pace);
    const awayORtgRaw = this.calculateORtg(awayStats, awayPoss > 0 ? awayPoss : pace);

    const ortgMin = leagueAvgOrtg * 0.75;
    const ortgMax = leagueAvgOrtg * 1.25;
    const homeORtg = Math.max(ortgMin, Math.min(ortgMax, homeORtgRaw || leagueAvgOrtg));
    const awayORtg = Math.max(ortgMin, Math.min(ortgMax, awayORtgRaw || leagueAvgOrtg));

    const homeDRtg = this.calculateDefensiveRating(homeStats, leagueAvgOrtg, leagueBaselinePace, homePoss);
    const awayDRtg = this.calculateDefensiveRating(awayStats, leagueAvgOrtg, leagueBaselinePace, awayPoss);

    const homeOffEff = (homeORtg + awayDRtg) / 2;
    const awayOffEff = (awayORtg + homeDRtg) / 2;

    const homeAdv = getLeagueHomeAdvantage(league);

    let expectedHomeScore = (homeOffEff / 100) * pace + homeAdv / 2;
    let expectedAwayScore = (awayOffEff / 100) * pace - homeAdv / 2;

    expectedHomeScore = Math.round(expectedHomeScore * 10) / 10;
    expectedAwayScore = Math.round(expectedAwayScore * 10) / 10;

    const expectedTotal = Math.round((expectedHomeScore + expectedAwayScore) * 10) / 10;
    const expectedSpread = Math.round((expectedHomeScore - expectedAwayScore) * 10) / 10;

    const modelRules: string[] = [
      `R83 效率模型融合（ORtg/DRtg 预期净胜分）`,
      `效率模型：预期净胜${expectedSpread > 0 ? '+' : ''}${expectedSpread.toFixed(1)}分（ORtg差推导）`,
      `R84 Pace+效率大小分（预期总分）`,
      `Pace量化：预期回合数${pace.toFixed(1)}，预期总分${expectedTotal.toFixed(1)}分（全场口径）`,
      `ORtg对比：主队${homeORtg.toFixed(1)} vs 客队${awayORtg.toFixed(1)}`,
      `DRtg估算：主队${homeDRtg.toFixed(1)} vs 客队${awayDRtg.toFixed(1)}（防守数据代理）`,
    ];

    return {
      expectedHomeScore,
      expectedAwayScore,
      expectedTotal,
      expectedSpread,
      pace: Math.round(pace * 10) / 10,
      homeORtg: Math.round(homeORtg * 10) / 10,
      awayORtg: Math.round(awayORtg * 10) / 10,
      homeDRtg: Math.round(homeDRtg * 10) / 10,
      awayDRtg: Math.round(awayDRtg * 10) / 10,
      homeAdvantage: homeAdv,
      modelRules,
    };
  }
}
