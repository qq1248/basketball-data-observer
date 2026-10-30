import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  BasketballEfficiencyService,
  type EfficiencyPredictionResult,
  type TeamStatsRaw as EfficiencyTeamStatsRaw,
} from './basketball-efficiency.service';
import { EloService } from '../elo/elo.service';
import {
  MlEnsembleService,
  type BasketballProbs,
} from '../ml-ensemble/ml-ensemble.service';
import {
  FeatureEngineeringService,
  type BasketballFeatureInput,
} from '../ml-ensemble/feature-engineering.service';
import { GbdtService } from '../ml-ensemble/gbdt.service';

export interface SubModelResult {
  key: 'spread_anchor' | 'elo' | 'kalman' | 'model_reference';
  label: string;
  role: 'anchor' | 'reference' | 'fallback';
  homeWinProb: number;
  awayWinProb: number;
  predictionDirection: '主胜' | '客胜' | '观望';
  note?: string;
}

export interface AnchorPredictionResult {
  homeWinProb: number;
  awayWinProb: number;
  predictionDirection: string;
  confidence: number;
  handicapRecommendation: string;
  handicapPick: string;
  handicapCoverProb: number;
  handicapPickProb: number;
  totalDirection: string;
  totalPick: string;
  overProb: number;
  underProb: number;
  totalPickProb: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedTotal: number;
  modelRules: string[];
  handicapConfidence: '高' | '中' | '低';
  ouConfidence: '高' | '中' | '低';
  ouDiffVsLine: number;
  adjustBreakdown: Record<string, number>;
  anchor: 'spread_anchored' | 'no_line_fallback' | 'model_reference' | 'legacy';
  subModels: SubModelResult[];
  injuryAdjustApplied: number;
  injuryAdjustPct: number;
  advancedDataReady: boolean;
  advancedDataNotice: string;
  lowConfidence: boolean;
  eloHome?: number;
  eloAway?: number;
  eloGap?: number;
  predEngineVersion: string;
  modelSpread: number;
}

export interface AnchorPredictionInput {
  handicapLineNum: number | null;
  totalLineNum: number | null;
  league: string;
  kickoffMonth?: number;
  homePpg?: number;
  awayPpg?: number;
  homeOppg?: number;
  awayOppg?: number;
  leagueAvgPpg?: number;
  coreInjuriesHome?: number;
  coreInjuriesAway?: number;
  weightedInjuriesHome?: number;
  weightedInjuriesAway?: number;
  freshCoreInjuriesHome?: number;
  freshCoreInjuriesAway?: number;
  freshWeightedInjuriesHome?: number;
  freshWeightedInjuriesAway?: number;
  favoriteTeamSide?: 'home' | 'away' | null;
  favoriteCoreInjuries?: number;
  homeWinOdds?: number;
  awayWinOdds?: number;
  stage?: string;
  homeRecentForm?: string[];
  awayRecentForm?: string[];
  homeTeam?: string;
  awayTeam?: string;
  teamStats?: {
    home?: EfficiencyTeamStatsRaw;
    away?: EfficiencyTeamStatsRaw;
  };
  eloHome?: number;
  eloAway?: number;
  eloGap?: number;
  restDaysDiff?: number;
  h2hRecent?: number;
  h2hHistorical?: number;
  h2hRecentCount?: number;
  h2hHistoricalCount?: number;
  recent10HomePpg?: number;
  recent10AwayPpg?: number;
  recent10HomeOppg?: number;
  recent10AwayOppg?: number;
  recent20HomePpg?: number;
  recent20AwayPpg?: number;
  recent20HomeOppg?: number;
  recent20AwayOppg?: number;
  recent10HomePd?: number;
  recent10AwayPd?: number;
  recent20HomePd?: number;
  recent20AwayPd?: number;
  recentSampleCount?: number;
  eloSampleCount?: number;
  historicalBaselineTotal?: number;
  historicalSampleSize?: number;
  playoffSeriesGames?: Array<{
    totalScore: number;
    totalLine: number;
    gameNumber: number;
  }>;
  openTotalLineNum?: number;
}

import { BASKETBALL_MODEL_CONFIG } from '@server/common/model-config';

const SPREAD_TO_WDW_SIGMA = BASKETBALL_MODEL_CONFIG.spreadToWdwSigma;
const HANDICAP_SIGMA = BASKETBALL_MODEL_CONFIG.handicapSigma;
const TOTAL_SIGMA = BASKETBALL_MODEL_CONFIG.totalSigma;
const MAX_INJURY_ADJUST_PCT = 8;

function erfApprox(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erfApprox(z / Math.SQRT2));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const NBA_TEAM_NAMES = ['凯尔特人','热火','公牛','奇才','雄鹿','76人','篮网','骑士','马刺','独行侠','火箭','老鹰','鹈鹕','掘金','勇士','太阳','湖人','快船','灰熊','雷霆','开拓者','爵士','国王','森林狼','黄蜂','活塞','步行者','魔术','猛龙','尼克斯','小牛','步行者','活塞','火箭','灰熊','马刺','鹈鹕','森林狼','掘金','爵士','开拓者','雷霆','太阳','勇士','快船','国王','湖人'];

function isNbaTeamName(homeTeam: string | undefined, awayTeam: string | undefined): boolean {
  return NBA_TEAM_NAMES.some((t: string) => homeTeam?.includes(t) || awayTeam?.includes(t));
}

function leagueKey(league: string): string {
  const name = league || '';
  if (name.includes('WNBA')) return 'WNBA';
  if (name.includes('NBA') || name.includes('美职篮') || name.includes('美国职业篮球')) return 'NBA';
  if (name.includes('澳NBL') || name.includes('澳大利亚') || name.includes('澳篮联') || name.includes('NBL'))
    return 'NBL';
  if (
    name.includes('德篮') ||
    name.includes('德国篮球') ||
    name.includes('BBL') ||
    name.includes('德甲篮')
  )
    return 'BBL';
  if (
    name.includes('欧冠篮') ||
    name.includes('欧篮联') ||
    name.includes('欧洲篮球') ||
    name.includes('篮球常规赛') ||
    name.includes('欧篮')
  )
    return 'EuroLeague';
  if (
    name.includes('西篮') ||
    name.includes('西班牙') ||
    name.includes('ACB') ||
    name.includes('西甲篮')
  )
    return 'ACB';
  if (name.includes('日篮') || name.includes('日本篮球') || name.includes('B联赛') || name.includes('B.LEAGUE'))
    return 'BLeague';
  if (name.includes('FIBA') || name.includes('亚运') || name.includes('世界杯'))
    return 'FIBA';
  return 'default';
}

function isWnbaLeague(league: string): boolean {
  return leagueKey(league) === 'WNBA';
}

function isNbaLeague(league: string): boolean {
  return leagueKey(league) === 'NBA';
}

function isFibaLeague(league: string): boolean {
  const k = leagueKey(league);
  return k === 'FIBA';
}

function getLeagueBaselineTotal(league: string): number {
  const k = leagueKey(league);
  switch (k) {
    case 'NBA':
      return 232;
    case 'WNBA':
      return 166;
    case 'CBA':
      return 195;
    case 'NBL':
      return 192;
    case 'BBL':
      return 173;
    case 'EuroLeague':
      return 173;
    case 'ACB':
      return 186;
    case 'FIBA':
      return 150;
    default:
      return 170;
  }
}

function getHandicapSigma(league: string): number {
  const k = leagueKey(league);
  if (k === 'WNBA') return 10;
  if (k === 'FIBA') return 9;
  return HANDICAP_SIGMA;
}

function getTotalSigma(league: string): number {
  return getHandicapSigma(league) * 1.8;
}

function getLeagueBaselineOrtg(league: string): number {
  const k = leagueKey(league);
  switch (k) {
    case 'NBA': return 114;
    case 'WNBA': return 104;
    case 'CBA': return 110;
    case 'NBL': return 105;
    case 'BBL': return 102;
    case 'EuroLeague': return 100;
    case 'ACB': return 107;
    case 'FIBA': return 98;
    default: return 105;
  }
}

function getLeagueBaselinePace(league: string): number {
  const k = leagueKey(league);
  switch (k) {
    case 'NBA': return 100;
    case 'WNBA': return 78;
    case 'CBA': return 90;
    case 'NBL': return 85;
    case 'BBL': return 82;
    case 'EuroLeague': return 78;
    case 'ACB': return 84;
    case 'FIBA': return 75;
    default: return 82;
  }
}

@Injectable()
export class BasketballAnchorPredictionService {
  private readonly logger = new Logger(BasketballAnchorPredictionService.name);
  private readonly efficiencyService: BasketballEfficiencyService;
  private readonly eloService: EloService;
  private readonly mlEnsembleService: MlEnsembleService;
  private readonly featureEngineeringService: FeatureEngineeringService;
  private readonly gbdtService: GbdtService;

  constructor(
    @Optional() efficiencyService?: BasketballEfficiencyService,
    @Optional() eloService?: EloService,
    @Optional() mlEnsembleService?: MlEnsembleService,
    @Optional() featureEngineeringService?: FeatureEngineeringService,
    @Optional() gbdtService?: GbdtService,
  ) {
    this.efficiencyService = efficiencyService ?? new BasketballEfficiencyService();
    this.eloService = eloService ?? new EloService();
    this.mlEnsembleService =
      mlEnsembleService ??
      new MlEnsembleService(
        gbdtService ?? new GbdtService(),
        featureEngineeringService ?? new FeatureEngineeringService(),
      );
    this.featureEngineeringService =
      featureEngineeringService ?? new FeatureEngineeringService();
    this.gbdtService = gbdtService ?? new GbdtService();
  }

  predict(input: AnchorPredictionInput): AnchorPredictionResult | null {
    const {
      handicapLineNum,
      totalLineNum,
      league,
      kickoffMonth,
      homePpg,
      awayPpg,
      leagueAvgPpg,
      coreInjuriesHome = 0,
      coreInjuriesAway = 0,
      favoriteTeamSide,
      favoriteCoreInjuries = 0,
      homeWinOdds,
      awayWinOdds,
      stage = '',
      historicalBaselineTotal,
      historicalSampleSize = 0,
    } = input;

    const modelRules: string[] = [];
    const leagueName = leagueKey(input.league);
    const baselineTotal = getLeagueBaselineTotal(input.league);
    modelRules.push(`V11.1 统一引擎（${leagueName}联赛基线${baselineTotal}分，指数锚定+多源融合校准）`);
    const adjustBreakdown: Record<string, number> = {};
    let shallowFormApplied = false;

    const teamStatsRaw = input.teamStats;
    let resolvedHomePpg = homePpg;
    let resolvedAwayPpg = awayPpg;
    let resolvedLeagueAvgPpg = leagueAvgPpg;
    let resolvedHomeOppg = input.homeOppg;
    let resolvedAwayOppg = input.awayOppg;
    if (teamStatsRaw?.home && (resolvedHomePpg == null || resolvedHomePpg <= 0)) {
      const hPpg = Number((teamStatsRaw.home as Record<string, unknown>).pointsPerGame ?? (teamStatsRaw.home as Record<string, unknown>).ppg ?? 0);
      if (hPpg > 0) resolvedHomePpg = hPpg;
    }
    if (teamStatsRaw?.away && (resolvedAwayPpg == null || resolvedAwayPpg <= 0)) {
      const aPpg = Number((teamStatsRaw.away as Record<string, unknown>).pointsPerGame ?? (teamStatsRaw.away as Record<string, unknown>).ppg ?? 0);
      if (aPpg > 0) resolvedAwayPpg = aPpg;
    }
    if (teamStatsRaw?.home && (resolvedLeagueAvgPpg == null || resolvedLeagueAvgPpg <= 0)) {
      const lAvg = Number((teamStatsRaw.home as Record<string, unknown>).leaguePpg ?? (teamStatsRaw.home as Record<string, unknown>).league_ppg ?? 0);
      if (lAvg > 0 && lAvg < 120) {
        resolvedLeagueAvgPpg = lAvg * 2;
      } else if (lAvg >= 120) {
        resolvedLeagueAvgPpg = lAvg;
      }
    }
    if (teamStatsRaw?.home && (resolvedHomeOppg == null || resolvedHomeOppg <= 0)) {
      const hOppg = Number((teamStatsRaw.home as Record<string, unknown>).oppg ?? (teamStatsRaw.home as Record<string, unknown>).pointsAllowedPerGame ?? 0);
      if (hOppg > 0) resolvedHomeOppg = hOppg;
    }
    if (teamStatsRaw?.away && (resolvedAwayOppg == null || resolvedAwayOppg <= 0)) {
      const aOppg = Number((teamStatsRaw.away as Record<string, unknown>).oppg ?? (teamStatsRaw.away as Record<string, unknown>).pointsAllowedPerGame ?? 0);
      if (aOppg > 0) resolvedAwayOppg = aOppg;
    }
    // 兜底：无teamStats但有近期场均时，用近10场场均作为ppg/oppg估计
    // 使V11回测在纯历史战绩数据下也能产出独立模型预期，而非退化为纯指数线
    if ((resolvedHomePpg == null || resolvedHomePpg <= 0) && input.recent10HomePpg != null && input.recent10HomePpg > 0) {
      resolvedHomePpg = input.recent10HomePpg;
      modelRules.push(`V11.3 数据兜底：用近10场主场场均(${resolvedHomePpg.toFixed(1)}分)作为进攻基线`);
    }
    if ((resolvedAwayPpg == null || resolvedAwayPpg <= 0) && input.recent10AwayPpg != null && input.recent10AwayPpg > 0) {
      resolvedAwayPpg = input.recent10AwayPpg;
      modelRules.push(`V11.3 数据兜底：用近10场客场场均(${resolvedAwayPpg.toFixed(1)}分)作为进攻基线`);
    }
    if ((resolvedHomeOppg == null || resolvedHomeOppg <= 0) && input.recent10HomeOppg != null && input.recent10HomeOppg > 0) {
      resolvedHomeOppg = input.recent10HomeOppg;
    }
    if ((resolvedAwayOppg == null || resolvedAwayOppg <= 0) && input.recent10AwayOppg != null && input.recent10AwayOppg > 0) {
      resolvedAwayOppg = input.recent10AwayOppg;
    }
    const effectiveHomePpg = resolvedHomePpg ?? 0;
    const effectiveAwayPpg = resolvedAwayPpg ?? 0;
    let effectiveLeagueAvgPpg = resolvedLeagueAvgPpg ?? 0;

    if (historicalBaselineTotal != null && historicalBaselineTotal > 0 && historicalSampleSize > 0) {
      const histWeight = clamp(historicalSampleSize / 100, 0.2, 0.85);
      const baseDefault = getLeagueBaselineTotal(league);
      const histFused = historicalBaselineTotal * histWeight + baseDefault * (1 - histWeight);
      if (effectiveLeagueAvgPpg > 0) {
        effectiveLeagueAvgPpg = effectiveLeagueAvgPpg * 0.5 + histFused * 0.5;
      } else {
        effectiveLeagueAvgPpg = histFused;
      }
      modelRules.push(
        `V11.2 全历史基线融合：历史${historicalSampleSize}场均值${historicalBaselineTotal.toFixed(1)}分` +
        `，融合权重${Math.round(histWeight * 100)}% → 联赛基准${effectiveLeagueAvgPpg.toFixed(1)}分`,
      );
    }
    const effectiveHomeOppg = resolvedHomeOppg ?? 0;
    const effectiveAwayOppg = resolvedAwayOppg ?? 0;

    const hasValidSpread =
      handicapLineNum != null &&
      !Number.isNaN(handicapLineNum) &&
      handicapLineNum !== 0 &&
      Math.abs(handicapLineNum) <= 40;
    const hasValidTotal =
      totalLineNum != null &&
      !Number.isNaN(totalLineNum) &&
      totalLineNum > 60 &&
      totalLineNum < 300;

    const hasAnyWinOdds = (homeWinOdds != null && homeWinOdds > 0) || (awayWinOdds != null && awayWinOdds > 0);

    const hasEfficiencyData =
      !!teamStatsRaw?.home &&
      !!teamStatsRaw.away &&
      this.efficiencyService.hasSufficientData(teamStatsRaw.home, teamStatsRaw.away);

    let efficiencyResult: EfficiencyPredictionResult | null = null;
    if (hasEfficiencyData && teamStatsRaw?.home && teamStatsRaw?.away) {
      efficiencyResult = this.efficiencyService.predictGame(
        teamStatsRaw.home,
        teamStatsRaw.away,
        league,
      );
      if (efficiencyResult) {
        modelRules.push(...efficiencyResult.modelRules);
      }
    }

    const hasTeamData = (effectiveHomePpg > 0) || (effectiveAwayPpg > 0) || hasEfficiencyData;
    const isWeakBaseline = !hasValidSpread && !hasAnyWinOdds && !hasTeamData;

    let finalModelSpread = 0;
    let homeWinProb: number;
    let awayWinProb: number;
    let anchor: 'spread_anchored' | 'no_line_fallback' | 'model_reference' | 'legacy' =
      'spread_anchored';

    const subModels: SubModelResult[] = [];

    if (hasValidSpread) {
      const impliedHomeWin = normalCdf(-handicapLineNum / SPREAD_TO_WDW_SIGMA);
      const impliedHomeWinPct = Math.round(impliedHomeWin * 100);
      modelRules.push(
        `V8 指数线锚定胜负：Phi(-line/12)=${impliedHomeWinPct}%（line=${handicapLineNum}）`,
      );
      subModels.push({
        key: 'spread_anchor',
        label: '指数线锚定',
        role: 'anchor',
        homeWinProb: impliedHomeWinPct,
        awayWinProb: 100 - impliedHomeWinPct,
        predictionDirection: impliedHomeWinPct >= 50 ? '主胜' : '客胜',
        note: '市场让分线→正态CDF(SIG=12)→胜负概率',
      });
    } else if (homeWinOdds && awayWinOdds && homeWinOdds > 0 && awayWinOdds > 0) {
      const invH = 1 / homeWinOdds;
      const invA = 1 / awayWinOdds;
      const vig = invH + invA - 1;
      const fairHome = invH - vig / 2;
      homeWinProb = Math.round(clamp(fairHome * 100, 3, 97));
      awayWinProb = 100 - homeWinProb;
      anchor = 'no_line_fallback';
      modelRules.push('V8 无指数线：指数反推胜负概率（兜底）');
    } else if (hasTeamData) {
      const eloResult = this.computeEloFallback(input);
      const kalmanResult = this.computeKalmanFallback(input);
      const eloWeight = 0.4;
      const kalWeight = 0.6;
      const blendedHome = eloResult.homeWinProb * eloWeight + kalmanResult.homeWinProb * kalWeight;
      homeWinProb = Math.round(clamp(blendedHome, 5, 95));
      awayWinProb = 100 - homeWinProb;
      anchor = 'model_reference';
      modelRules.push('V9 无指数线实力模型：ELO+卡尔曼综合胜负概率');
      subModels.push(eloResult, kalmanResult);
      subModels.push({
        key: 'model_reference',
        label: '模型参考',
        role: 'anchor',
        homeWinProb,
        awayWinProb,
        predictionDirection: homeWinProb >= 50 ? '主胜' : '客胜',
        note: '基于球队攻防实力与近期状态的独立预测，无指数线锚定',
      });
    } else {
      homeWinProb = 50;
      awayWinProb = 50;
      anchor = 'model_reference';
      modelRules.push('V9 弱基线模式：联赛基准+主场优势，数据不足仅观望');
      subModels.push({
        key: 'model_reference',
        label: '弱基线参考',
        role: 'anchor',
        homeWinProb,
        awayWinProb,
        predictionDirection: '观望',
        note: '无指数线无球队数据，实力对比不可靠，不给出明确方向',
      });
    }

    let predictionDirection = anchor === 'model_reference' && !hasTeamData
      ? '观望'
      : homeWinProb >= awayWinProb ? '主胜' : '客胜';
    let wdwConfidence = Math.max(homeWinProb, awayWinProb);

    if (anchor !== 'model_reference') {
      const eloResult = this.computeEloFallback(input);
      const kalmanResult = this.computeKalmanFallback(input);
      subModels.push(eloResult, kalmanResult);
    }

    const confirmedFavoriteStarOut =
      favoriteTeamSide !== null && favoriteCoreInjuries >= 1;

    const injuryAdjust = this.computeInjuryAdjustment(
      hasValidSpread,
      handicapLineNum ?? 0,
      favoriteTeamSide,
      favoriteCoreInjuries,
      coreInjuriesHome ?? 0,
      coreInjuriesAway ?? 0,
      league,
      modelRules,
      input.freshCoreInjuriesHome ?? 0,
      input.freshCoreInjuriesAway ?? 0,
      input.freshWeightedInjuriesHome ?? 0,
      input.freshWeightedInjuriesAway ?? 0,
      input.recent10HomePd ?? 0,
      input.recent10AwayPd ?? 0,
    );

    if (injuryAdjust.wdwShiftPct !== 0) {
      const newHomeProb = clamp(homeWinProb + injuryAdjust.wdwShiftPct, 5, 95);
      homeWinProb = Math.round(newHomeProb);
      awayWinProb = 100 - homeWinProb;
      adjustBreakdown.injuryWdw = injuryAdjust.wdwShiftPct;
    }

    let handicapRecommendation = '观望';
    let handicapCoverProb = 50;
    let handicapPickProb = 0;
    let handicapConfidence: '高' | '中' | '低' = '低';
    let handicapPick = '观望';

    if (hasValidSpread) {
      const hcSigma = getHandicapSigma(league);
      const impliedSpread = -handicapLineNum;
      const adjustedSpread = impliedSpread + injuryAdjust.marginShift;
      const z = adjustedSpread / hcSigma;
      const rawCoverProb = normalCdf(z);

      // V10.2 对称±2双向判定：用热门方视角的模型预期净胜分 vs 指数让分线对比
      // 模型预期净胜分优先级：效率模型(ORtg推导) > ELO+卡尔曼综合
      // 指数让分线 impliedSpread = -handicapLineNum（正值=主队让球/主队热门）
      // 热门方视角穿盘差 favoriteSpreadDiff：热门方=主队时=modelSpread-impliedSpread；热门方=客队时取反
      //   - favoriteSpreadDiff ≥ +2 → 模型显著强于热门方线 → 押热门方（中/高信心）
      //   - favoriteSpreadDiff ≤ -2 → 模型显著弱于热门方线 → 反向押受让方（低信心）
      //   - 介于 ±2 之间 → 跟指数线热门方方向，低信心
      let modelSpread = efficiencyResult
        ? efficiencyResult.expectedSpread
        : hasTeamData
          ? this.computeModelExpectedSpread(input)
          : impliedSpread;

      // Elo 预期净胜分融合
      const eloHomeVal: number | undefined = input.eloHome;
      const eloAwayVal: number | undefined = input.eloAway;
      const eloGapVal: number =
        input.eloGap ??
        (eloHomeVal != null && eloAwayVal != null ? eloHomeVal - eloAwayVal : 0);
      if (
        eloHomeVal != null &&
        eloAwayVal != null &&
        eloHomeVal > 0 &&
        eloAwayVal > 0
      ) {
        const eloExpectedSpread: number = eloGapVal / 25;
        const eloWeight: number = 0.25;
        modelSpread = modelSpread * (1 - eloWeight) + eloExpectedSpread * eloWeight;
        modelRules.push(
          `R-ELO-ADJ Elo评分融合(权重0.25, Elo差${eloGapVal.toFixed(0)})`,
        );
      }

      // 小样本收缩：近期战绩样本量<5场时，模型预期净胜分向指数线收缩
      // 防止季前赛/开季初期极少数比赛的极端比分拉偏方向
      const recentSample = input.recentSampleCount ?? 0;
      if (recentSample < 5 && !efficiencyResult && hasTeamData) {
        const shrinkFactor = Math.max(0, 1 - (5 - recentSample) * 0.2);
        modelSpread = impliedSpread + (modelSpread - impliedSpread) * shrinkFactor;
        modelRules.push(
          `R-SMALL-SAMPLE 小样本收缩（${recentSample}场<5场，向指数线收缩${Math.round((1 - shrinkFactor) * 100)}%）`,
        );
      }

      // V11.4 让分端赛季初效率模型降权：样本<5且效率模型方向与指数线相反、差>3分时
      // 向指数线收缩，效率模型权重降至25%，指数线锚定75%
      // 修复：揭幕战单场PPG极端值导致让分方向完全反转
      if (
        recentSample < 5 &&
        efficiencyResult &&
        handicapLineNum != null &&
        !Number.isNaN(handicapLineNum) &&
        handicapLineNum !== 0
      ) {
        const directionOpposite =
          (modelSpread > 0 && handicapLineNum > 0) ||
          (modelSpread < 0 && handicapLineNum < 0);
        const spreadDiff = Math.abs(modelSpread - impliedSpread);
        if (directionOpposite && spreadDiff > 3) {
          const originalSpread = modelSpread;
          modelSpread = impliedSpread + (modelSpread - impliedSpread) * 0.25;
          modelRules.push(
            `V11.4 让分端赛季初降权：效率模型权重降至25%，以指数线锚定为主(75%)` +
            `（原预期净胜${originalSpread > 0 ? '+' : ''}${originalSpread.toFixed(1)}分 vs 线${handicapLineNum.toFixed(1)}）`,
          );
        }
      }

      // V11.7 欧篮联赛季初同向超差降权：样本<6场+效率模型方向与指数线相同+差>3分时
      // 效率模型权重降至40%，指数线锚定60%
      // 修复：赛季初小样本进攻极端值（如某队开局3场场均105+）推高让分信心，实际会向均值回归
      // 仅欧篮联生效：NBA/WNBA样本获取快，2-3周后数据充足，无需额外保护
      if (
        recentSample < 6 &&
        efficiencyResult &&
        handicapLineNum != null &&
        !Number.isNaN(handicapLineNum) &&
        handicapLineNum !== 0 &&
        leagueKey(league) === 'EuroLeague'
      ) {
        const directionSame =
          (modelSpread < 0 && handicapLineNum < 0) ||
          (modelSpread > 0 && handicapLineNum > 0);
        const spreadDiff = Math.abs(modelSpread - impliedSpread);
        if (directionSame && spreadDiff > 3) {
          const originalSpread = modelSpread;
          modelSpread = impliedSpread + (modelSpread - impliedSpread) * 0.4;
          modelRules.push(
            `V11.7 欧篮联赛季初同向超差降权：效率模型权重降至40%，指数线锚定60%` +
            `（原预期净胜${originalSpread > 0 ? '+' : ''}${originalSpread.toFixed(1)}分 vs 线${handicapLineNum.toFixed(1)}，差${spreadDiff.toFixed(1)}分）`,
          );
        }
      }

      // V11.7 NBA赛季初稳定化：主客两队样本均<5场时，三层保守措施
      // ① modelSpread 向指数线收缩50%（效率模型权重减半，防止揭幕战极端PPG导致方向漂移）
      // ② 穿盘差<2分时强制低信心+跟随指数线热门方（不硬翻转）
      // ③ 大小分PPG融合权重减半（同路径下独立实现）
      // 仅NBA生效：赛季初仅2-3场数据，攻防效率样本代表性不足
      const v117NbaStabilizer = isNbaLeague(league)
        && recentSample < 10
        && efficiencyResult
        && handicapLineNum != null
        && !Number.isNaN(handicapLineNum)
        && handicapLineNum !== 0;
      if (v117NbaStabilizer) {
        const originalSpread = modelSpread;
        modelSpread = impliedSpread + (modelSpread - impliedSpread) * 0.5;
        modelRules.push(
          `V11.7 NBA赛季初稳定化：效率模型权重减半（50%收缩），以指数线锚定为主` +
            `（原预期净胜${originalSpread > 0 ? '+' : ''}${originalSpread.toFixed(1)}分 → ${modelSpread > 0 ? '+' : ''}${modelSpread.toFixed(1)}分）`,
        );
      }

      const spreadVsLine = modelSpread - impliedSpread; // 正=模型认为主队更强→主队穿盘
      const lineAbs = Math.abs(handicapLineNum);

      // 客队热门降权按联赛差异化：
      // WNBA：保留全量降权（客队热门穿盘率系统性偏低，历史回测验证有效）
      // NBA及其他男联赛：不应用客队热门降权（该类联赛客队热门无系统性穿盘劣势，降权会反向误伤）
      const favoriteSide: 'home' | 'away' = handicapLineNum < 0 ? 'home' : 'away';
      const isAwayFavorite = favoriteSide === 'away';
      const isWnba = leagueKey(league) === 'WNBA';
      if (isAwayFavorite && handicapLineNum !== 0 && isWnba) {
        let awayAdj = 1.5;
        if (lineAbs >= 3.5 && lineAbs <= 6) awayAdj += 0.8;
        else if (lineAbs >= 10.5 && lineAbs <= 15) awayAdj += 0.6;
        const month = input.kickoffMonth ?? 0;
        const isPlayoffLike = month >= 9 || (month >= 1 && month <= 5);
        if (isPlayoffLike) awayAdj += 1.0;
        modelSpread += awayAdj;
        modelRules.push(
          `R-AWAY-FAV WNBA客队热门降权（线${handicapLineNum.toFixed(1)}，向主队调${awayAdj.toFixed(1)}分）`,
        );
      } else if (isAwayFavorite && handicapLineNum !== 0) {
        modelRules.push(
          `R-AWAY-FAV 客队热门（${leagueKey(league)}联赛不应用降权）`,
        );
      }

      // 热门方伤停融合：热门方≥4人high+medium伤停 → 强制转向受让方（低信心）
      // V11.3 已启用时跳过旧版强制转向，改用平滑的双向伤停加权调整
      const favoriteInjuries = favoriteSide === 'home' ? (coreInjuriesHome ?? 0) : (coreInjuriesAway ?? 0);
      const forcedUnderdogSide = !injuryAdjust.isV113 && favoriteInjuries >= 4;

      // V11.3 伤停调整融入让分判定：将 marginShift 加到 modelSpread
      if (injuryAdjust.isV113 && injuryAdjust.marginShift !== 0) {
        modelSpread += injuryAdjust.marginShift;
        const hW = input.freshWeightedInjuriesHome ?? (input.coreInjuriesHome ?? 0) * 0.8;
        const aW = input.freshWeightedInjuriesAway ?? (input.coreInjuriesAway ?? 0) * 0.8;
        modelRules.push(
          `V11.3 伤停加权调整（主${hW.toFixed(1)} vs 客${aW.toFixed(1)}，净调整${injuryAdjust.marginShift > 0 ? '+' : ''}${injuryAdjust.marginShift.toFixed(1)}分）`,
        );
      }

      const shallowAdjust = this.applyShallowLineFormAdjustment(
        handicapLineNum ?? 0,
        input.recent10HomePd ?? 0,
        input.recent10AwayPd ?? 0,
        coreInjuriesHome ?? 0,
        coreInjuriesAway ?? 0,
        modelRules,
      );
      if (shallowAdjust.applied && shallowAdjust.spreadAdjust !== 0) {
        modelSpread += shallowAdjust.spreadAdjust;
        shallowFormApplied = true;
      }

      const coverProb = Math.round(rawCoverProb * 100);
      // 深盘放宽：让分线≥25分且赢盘概率47%-53%才观望；12-24分一律给方向（低信心）
      const isDeepLine = lineAbs >= 25;
      const isMidDeepLine = lineAbs >= 12 && lineAbs < 25;

      let pickSide: 'home' | 'away' | null = null; // 让分推荐的赢家（穿盘方）
      let pickConfidence: '高' | '中' | '低' = '低';

       if (forcedUnderdogSide) {
         // 伤停强制转向：热门方缺阵严重→押受让方
         const underdogSide: 'home' | 'away' = favoriteSide === 'home' ? 'away' : 'home';
         pickSide = underdogSide;
         pickConfidence = '低';
         handicapCoverProb = underdogSide === 'home' ? 55 : 45; // 主队赢盘率
         modelRules.push(
            `R-INJURY-V10 伤停转向：热门方${Math.round(favoriteInjuries)}人伤停→押受让方（低信心）`,
         );
       } else if (isDeepLine) {
         // 超深盘（≥25分）：原47%-53%观望→改为严格按穿盘差公式出方向，低信心
         if (coverProb >= 50) {
           pickSide = 'home';
           pickConfidence = coverProb >= 60 ? '中' : '低';
         } else {
           pickSide = 'away';
           pickConfidence = coverProb <= 40 ? '中' : '低';
         }
         modelRules.push(
           `V10.2 深盘强制出方向：赢盘概率${coverProb}% → ${pickSide === 'home' ? '让分主胜' : '让分客胜'}（${pickConfidence}信心）`,
         );
        } else {
          // V10.2 严格自洽让分：用模型预期净胜分 vs 指数让分线的穿盘差判定方向
          // 结算公式：预期净胜分(主-客) + handicap_line_num > 0 → 让分主胜
          // 双向判定规则（对称±2）：
          //   - 穿盘差 ≥ +2分（模型显著强于热门方线）→ 押热门方（中/高信心）
          //   - 穿盘差 ≤ -2分（模型显著弱于热门方线）→ 押受让方（反向，低信心）
          //   - 介于两者之间 → 跟指数线热门方方向，低信心
           const favoriteSpreadDiff = favoriteSide === 'home'
             ? modelSpread - impliedSpread
             : -modelSpread + impliedSpread;
           const zSpread = favoriteSide === 'home'
             ? favoriteSpreadDiff / hcSigma
             : -favoriteSpreadDiff / hcSigma;
           const coverFromModelRaw = normalCdf(zSpread);
           const coverShrinkage = 0.85;
           const coverFromModel = 0.5 + (coverFromModelRaw - 0.5) * coverShrinkage;
           const modelCoverProb = Math.round(clamp(coverFromModel * 100, 10, 90));

           if (favoriteSpreadDiff >= 2) {
             // 模型显著强于热门方线 → 押热门方
             pickSide = favoriteSide;
             const probGap = Math.abs(modelCoverProb - 50);
             if (probGap >= 15) pickConfidence = '高';
             else if (probGap >= 8) pickConfidence = '中';
             else pickConfidence = '低';
             handicapCoverProb = modelCoverProb;
             modelRules.push(
               `V10.2 双向判定：模型预期比让分线强${favoriteSpreadDiff.toFixed(1)}分 → 押热门方（${pickConfidence}信心）`,
             );
          } else if (favoriteSpreadDiff <= -2) {
              // 模型显著弱于热门方线 → 反向押受让方
              pickSide = favoriteSide === 'home' ? 'away' : 'home';
              const probGap = Math.abs(50 - modelCoverProb);
              if (probGap >= 15) pickConfidence = '高';
              else if (probGap >= 8) pickConfidence = '中';
              else pickConfidence = '低';
              handicapCoverProb = modelCoverProb;
              modelRules.push(
                `V10.2 反向判定：模型预期比让分线弱${Math.abs(favoriteSpreadDiff).toFixed(1)}分 → 押受让方（${pickConfidence}信心）`,
              );
            } else {
              // 边缘区间（-2 < 穿盘差 < +2）→ 跟热门方低信心
             pickSide = favoriteSide;
             pickConfidence = '低';
             handicapCoverProb = favoriteSide === 'home' ? 51 : 49;
             modelRules.push(
               `V10.2 边缘判定：穿盘差${favoriteSpreadDiff >= 0 ? '+' : ''}${favoriteSpreadDiff.toFixed(1)}分 → 跟热门方低信心`,
             );
           }
       }

       if (pickSide !== null) {
         handicapRecommendation = pickSide === 'home' ? '让分主胜' : '让分客胜';
         handicapPick = handicapRecommendation;
         handicapConfidence = pickConfidence;
         // handicapCoverProb 始终为主队赢盘率（与 finalize 语义一致）
         // 超深盘(≥25分)纯指数线场景：赢盘概率保持原值，不用 47-55 clamp（V10.2 已强制出方向）
         if (isDeepLine) {
           const clamped = clamp(coverProb, 45, 55);
           handicapCoverProb = pickSide === 'home' ? clamped : 100 - clamped;
         }
         // handicapPickProb = 推荐方向赢盘率
         handicapPickProb = pickSide === 'home' ? handicapCoverProb : 100 - handicapCoverProb;
       }
       // V10.2 移除 pickSide===null 观望分支：所有合法让分线均强制出方向，不再观望

        // V11.4 让客深盘降信心：近30天6-10分深盘让客0/5全输，强制降为低信心
        // 例外：V11.3引擎且伤停净修正≥1分（伤停证据充分不降权）
        if (pickSide === 'away' && lineAbs >= 6 && lineAbs < 10 && pickConfidence !== '低') {
          const hasStrongInjuryEvidence = injuryAdjust.isV113 && Math.abs(injuryAdjust.marginShift) >= 1;
          if (!hasStrongInjuryEvidence) {
            pickConfidence = '低';
            modelRules.push(
              `V11.4 让客深盘降权：|线|=${lineAbs.toFixed(1)}分深盘让客→降为低信心（近30天深盘让客0胜）`,
            );
          }
        }

        // V11.8 让客信心整体收缩：近60天让客高信心(>=65%)命中率仅57.9%，比让主70.4%低12.5pp
        // V11.3伤停加权版让客也只有44.4%，系统性高估约10pp，无例外
        // 将让客方向高/中信心档各降一级（高→中，中→低）
        if (pickSide === 'away' && pickConfidence !== '低') {
          if (pickConfidence === '高') pickConfidence = '中';
          else if (pickConfidence === '中') pickConfidence = '低';
          modelRules.push(
            `V11.8 让客信心收缩：让客方向${pickConfidence === '中' ? '高→中' : '中→低'}信心（近60天让客高信心57.9% vs 让主70.4%）`,
          );
        }

      // V10.1 胜负概率与方向由最终预期净胜分推导，与预期比分、让分方向三者严格自洽
      // 最终预期净胜 = modelSpread（V11.3时已含伤停调整）或 modelSpread + 伤停净胜调整
      let finalWdwSpread = injuryAdjust.isV113
        ? modelSpread
        : modelSpread + injuryAdjust.marginShift;
      const wdwZ = finalWdwSpread / SPREAD_TO_WDW_SIGMA;
      const rawHomeWin = normalCdf(wdwZ);
      let homeWinFromSpread = Math.round(clamp(rawHomeWin * 100, 3, 97));
      // V10.3 恰50/50临界：按预期净胜分方向做1%倾斜，避免两端相等被判未分析
      if (homeWinFromSpread === 50) {
        homeWinFromSpread = finalWdwSpread >= 0 ? 51 : 49;
      }
      homeWinProb = homeWinFromSpread;
      awayWinProb = 100 - homeWinProb;
      // 同步更新胜负方向和信心
      predictionDirection = homeWinProb >= awayWinProb ? '主胜' : '客胜';
      wdwConfidence = Math.max(homeWinProb, awayWinProb);
      modelRules.push(
        `V10.1 自洽胜负：预期净胜${finalWdwSpread > 0 ? '+' : ''}${finalWdwSpread.toFixed(1)}分 → ` +
        `主胜概率${homeWinProb}%（σ=${SPREAD_TO_WDW_SIGMA}）`,
      );

      // ML 集成融合：当所有篮球ML特征可用时
      const hasEloForMl =
        eloHomeVal != null && eloAwayVal != null && eloHomeVal > 0 && eloAwayVal > 0;
      const hasEfficiencyForMl = hasEfficiencyData && !!efficiencyResult;
      const hasFormForMl =
        (input.homeRecentForm?.length ?? 0) > 0 &&
        (input.awayRecentForm?.length ?? 0) > 0;
      if (hasEloForMl && hasEfficiencyForMl && hasFormForMl) {
        const eff: EfficiencyPredictionResult = efficiencyResult as EfficiencyPredictionResult;
        const homeOrtg: number = eff.homeORtg;
        const awayOrtg: number = eff.awayORtg;
        const homeDrtg: number = eff.homeDRtg;
        const awayDrtg: number = eff.awayDRtg;
        const gamePace: number = eff.pace;
        // 效率模型输出整体 pace，主客两队 pace 近似为同一值
        const homePace: number = gamePace;
        const awayPace: number = gamePace;
        // 联赛基线 ORtg 和 Pace：根据联赛推导（与 efficiency service 基线一致）
        const leagueAvgOrtg: number = getLeagueBaselineOrtg(league);
        const leagueAvgPace: number = getLeagueBaselinePace(league);

        const calcFormPts = (form: string[] | undefined): number => {
          if (!form || form.length === 0) return 0.5;
          let wins = 0;
          for (const r of form) {
            if (r === 'W' || r === '胜') wins += 1;
          }
          return wins / form.length;
        };
        const homeFormPts: number = calcFormPts(input.homeRecentForm);
        const awayFormPts: number = calcFormPts(input.awayRecentForm);
        const injuryImpactDiff: number = (coreInjuriesHome ?? 0) - (coreInjuriesAway ?? 0);

        const featureInput: BasketballFeatureInput = {
          eloGap: eloGapVal,
          homeOrtg,
          awayOrtg,
          homeDrtg,
          awayDrtg,
          homePace,
          awayPace,
          leagueAvgOrtg,
          leagueAvgPace,
          homeFormPts,
          awayFormPts,
          injuryImpactDiff,
        };
        const { features } = this.featureEngineeringService.extractBasketballFeatures(featureInput);
        const mlHomeWinProb: number = this.gbdtService.getBasketballModel().predict(features);
        const mlProbs: BasketballProbs = {
          homeWin: mlHomeWinProb,
          awayWin: 1 - mlHomeWinProb,
        };
        const mlConfidence: number = this.mlEnsembleService.computeMlConfidence(mlHomeWinProb);
        const baseProbs: BasketballProbs = {
          homeWin: homeWinProb / 100,
          awayWin: awayWinProb / 100,
        };
        const ensembleResult = this.mlEnsembleService.ensembleBasketballPrediction(
          baseProbs,
          mlProbs,
          mlConfidence,
        );
        const mlWeight: number = ensembleResult.mlWeight;
        if (mlWeight > 0) {
          homeWinProb = Math.round(clamp(ensembleResult.homeWinProb * 100, 3, 97));
          awayWinProb = 100 - homeWinProb;
          predictionDirection = homeWinProb >= awayWinProb ? '主胜' : '客胜';
          wdwConfidence = Math.max(homeWinProb, awayWinProb);
          modelRules.push(
            `R-ML-ENSEMBLE ML融合修正(权重${mlWeight.toFixed(2)})`,
          );
          modelRules.push(...ensembleResult.modelRules);
        }
      }
      finalModelSpread = modelSpread;
    } else if (hasTeamData) {
      const modelSpread = efficiencyResult
        ? efficiencyResult.expectedSpread
        : this.computeModelExpectedSpread(input);
      const hcSigma = getHandicapSigma(league);
      const spreadZ = modelSpread / hcSigma;
      const coverProbRaw = normalCdf(spreadZ);
       const coverProb = Math.round(clamp(coverProbRaw * 100, 10, 90));
       handicapCoverProb = coverProb;
       if (coverProb >= 50) {
         handicapRecommendation = '模型参考·让分主胜';
         handicapPick = '模型参考·让分主胜';
         handicapPickProb = coverProb;
       } else {
handicapRecommendation = '让分客胜';
          handicapPick = '让分客胜';
         handicapPickProb = 100 - coverProb;
       }
       const modelLabel = efficiencyResult ? '效率模型' : 'V9';
       modelRules.push(
         `${modelLabel} 无指数线模型参考让分：预期净胜${modelSpread > 0 ? '+' : ''}${modelSpread.toFixed(1)}分，` +
         `过线概率${coverProb}%（σ=${hcSigma.toFixed(1)}），V10.2消除中性观望`,
       );
    } else {
      handicapRecommendation = '观望';
      handicapPick = '观望';
      handicapCoverProb = 50;
      handicapPickProb = 50;
      modelRules.push('V9 弱基线模式：球队数据不足，让分方向观望');
    }

    let totalDirection = '观望';
    let totalPick = '观望';
    let overProb = 50;
    let underProb = 50;
    let totalPickProb = 50;
    let ouConfidence: '高' | '中' | '低' = '低';
    let ouDiffVsLine = 0;
    let predictedTotal = getLeagueBaselineTotal(league);

    const efficiencyTotal = efficiencyResult?.expectedTotal ?? 0;
    const hasEfficiencyTotal = efficiencyTotal > 0;

    if (hasValidTotal && totalLineNum) {
      predictedTotal = totalLineNum;
      modelRules.push('V8 大小分以指数线为锚（默认50/50弱信心）');

      const month = kickoffMonth ?? 0;
      let stageAdjust = 0;
      if (isWnbaLeague(league) && month >= 1 && month <= 12) {
        if (month === 6) stageAdjust = 4;
        else if (month === 7) stageAdjust = 3;
        else if (month === 8) stageAdjust = -2.5;
        else if (month === 9) stageAdjust = -1.5;
        if (stageAdjust !== 0) {
          adjustBreakdown.wnbaMonth = stageAdjust;
          modelRules.push(`V8 WNBA月份调整${stageAdjust > 0 ? '+' : ''}${stageAdjust}分（${month}月）`);
        }
      }

       const hasFullOdData =
         effectiveHomePpg > 0 && effectiveAwayPpg > 0 &&
         effectiveHomeOppg > 0 && effectiveAwayOppg > 0;
       if (effectiveHomeOppg <= 0 || effectiveAwayOppg <= 0) {
         this.logger.warn(`[V11-OD-DEBUG] league=${league}, hasFullOd=${hasFullOdData}, homePpg=${effectiveHomePpg.toFixed(1)}, awayPpg=${effectiveAwayPpg.toFixed(1)}, homeOppg=${effectiveHomeOppg.toFixed(1)}, awayOppg=${effectiveAwayOppg.toFixed(1)}, inputHomeOppg=${input.homeOppg?.toFixed(1) ?? 'null'}, inputAwayOppg=${input.awayOppg?.toFixed(1) ?? 'null'}, recent10HomeOppg=${input.recent10HomeOppg?.toFixed(1) ?? 'null'}, recent10AwayOppg=${input.recent10AwayOppg?.toFixed(1) ?? 'null'}`);
       }
       const hasSufficientSample = (input.recentSampleCount ?? 0) >= 5;

       // ========== V11.2 攻防效率均值模型（优先路径） ==========
       // 有完整攻防数据时，以攻防效率均值为基底，取代纯指数线锚定
       let useV112Model = false;
       let efficiencyMeanTotal = 0;
       let asymmetryAdjust = 0;
       let v112InjuryOuAdjust = 0;
       let finalExpectedTotal = 0;
       let netDiff = 0;
       let baseProb = 0;

        if (hasFullOdData) {
          useV112Model = true;
         // V11.2 有独立判断依据（攻防数据），不卡阈值闸门，直接出方向

         // 1. 攻防效率均值总分基底
         efficiencyMeanTotal =
           (effectiveHomePpg + effectiveAwayPpg +
            effectiveHomeOppg + effectiveAwayOppg) / 2;
         adjustBreakdown.v112efficiencyMean =
           Math.round(efficiencyMeanTotal * 10) / 10;

         // 2. 攻防不对称修正：进攻强队碰防守弱队 → 总分略升，幅度 ≤ 1.5 分
         const offDefProduct =
           effectiveHomePpg * effectiveAwayOppg +
           effectiveAwayPpg * effectiveHomeOppg;
         const balancedProduct =
           effectiveHomePpg * effectiveHomeOppg +
           effectiveAwayPpg * effectiveAwayOppg;
         if (balancedProduct > 0) {
           const ratio = offDefProduct / balancedProduct;
           asymmetryAdjust = clamp((ratio - 1) * 30, -1.5, 1.5);
           adjustBreakdown.v112asymmetry =
             Math.round(asymmetryAdjust * 10) / 10;
         }

          // 3. 伤停压小（V11.3：按加权缺阵值 + 长期缺阵适应）
          //    优先级：freshWeighted(V11.3) > weighted(V11.2) > core人数(V11降级)
          const hasV113Injury = injuryAdjust.isV113 &&
            ((input.freshWeightedInjuriesHome ?? 0) + (input.freshWeightedInjuriesAway ?? 0) > 0);
          if (hasV113Injury) {
             v112InjuryOuAdjust = injuryAdjust.ouAdjust;
             adjustBreakdown.v112injuryOu = v112InjuryOuAdjust;
             adjustBreakdown.v113injuryOu = v112InjuryOuAdjust;
            } else {
              const totalInjuriesV112 = coreInjuriesHome + coreInjuriesAway;
              const maxInjuryAdjustV112 = totalInjuriesV112 >= 4 ? 2.0 : 3.0;
              const hasWeightedV112 =
               input.weightedInjuriesHome != null &&
               input.weightedInjuriesAway != null &&
               (input.weightedInjuriesHome + input.weightedInjuriesAway) > 0;
            const injuryMeasureV112 = hasWeightedV112
              ? input.weightedInjuriesHome + input.weightedInjuriesAway
              : coreInjuriesHome + coreInjuriesAway;
            const v112OuInjuryPerPerson = isWnbaLeague(league) ? 1.2 : 0.4;
            if (injuryMeasureV112 > 0) {
              v112InjuryOuAdjust =
                -Math.min(
                  maxInjuryAdjustV112,
                  Math.round(injuryMeasureV112 * v112OuInjuryPerPerson * 10) / 10,
                );
              adjustBreakdown.v112injuryOu = v112InjuryOuAdjust;
            }
            }

           modelRules.push(
             `V11.2 攻防效率均值模型：预期总分基底${efficiencyMeanTotal.toFixed(1)}分` +
             `（主场攻${effectiveHomePpg.toFixed(1)}/防${effectiveHomeOppg.toFixed(1)}，` +
             `客场攻${effectiveAwayPpg.toFixed(1)}/防${effectiveAwayOppg.toFixed(1)}）` +
             `，攻防不对称修正${asymmetryAdjust >= 0 ? '+' : ''}${asymmetryAdjust.toFixed(1)}分` +
             `，伤停压小${v112InjuryOuAdjust}分`,
            );

            const sampleCount = input.recentSampleCount ?? 0;

            // V11.7 NBA赛季初稳定化：样本<5场时PPG融合权重减半（攻防效率模型50% + 指数线50%）
            // 防止揭幕战/赛季初极端单场PPG导致大小分方向大幅偏离市场共识
             if (
               isNbaLeague(league) &&
               sampleCount < 10 &&
               totalLineNum != null &&
               totalLineNum > 0
             ) {
              const originalBase = efficiencyMeanTotal;
              efficiencyMeanTotal = originalBase * 0.5 + totalLineNum * 0.5;
              efficiencyMeanTotal = Math.round(efficiencyMeanTotal * 10) / 10;
              adjustBreakdown.v117NbaStabilizerOu =
                Math.round((efficiencyMeanTotal - originalBase) * 10) / 10;
              modelRules.push(
                'V11.7 NBA赛季初稳定化（大小分）：攻防效率模型权重减半（50%收缩），与指数线等权混合' +
                  `（原${originalBase.toFixed(1)}分 → ${efficiencyMeanTotal.toFixed(1)}分）`,
              );
            }

            if (
             sampleCount < 5 &&
             handicapLineNum != null &&
             !Number.isNaN(handicapLineNum) &&
             handicapLineNum !== 0 &&
             totalLineNum != null &&
             totalLineNum > 0
           ) {
             const ppgNetSpread =
               (effectiveHomePpg + effectiveAwayOppg) / 2 -
               (effectiveAwayPpg + effectiveHomeOppg) / 2;
             const lineImpliedSpread = -handicapLineNum;
             const directionOpposite =
               (ppgNetSpread > 0 && handicapLineNum > 0) ||
               (ppgNetSpread < 0 && handicapLineNum < 0);
             const spreadDiff = Math.abs(ppgNetSpread - lineImpliedSpread);

             if (directionOpposite && spreadDiff > 3) {
               const originalBase = efficiencyMeanTotal;
               efficiencyMeanTotal = originalBase * 0.15 + totalLineNum * 0.85;
               efficiencyMeanTotal = Math.round(efficiencyMeanTotal * 10) / 10;
               adjustBreakdown.v114seasonOpening =
                 Math.round((efficiencyMeanTotal - originalBase) * 10) / 10;
               modelRules.push(
                 'V11.4 赛季初PPG低信任：攻防效率模型权重降至15%，以指数线锚定为主(85%)',
               );
             }
           }
        }

       let paceAdjust = 0;
       if (useV112Model) {
         // V11.2 路径：不使用 paceAdjust（总分基底由攻防效率均值独立给出）
         paceAdjust = 0;
       } else if (hasEfficiencyTotal) {
         paceAdjust = efficiencyTotal - totalLineNum;
         paceAdjust = clamp(paceAdjust * 0.7, -8, 8);
         adjustBreakdown.efficiencyPace = Math.round(paceAdjust * 10) / 10;
         modelRules.push(
           `效率模型总分修正${paceAdjust >= 0 ? '+' : ''}${paceAdjust.toFixed(1)}分（模型${efficiencyTotal.toFixed(1)} vs 指数线${totalLineNum}）`,
         );
        } else if (!hasSufficientSample) {
          paceAdjust = 0;
          adjustBreakdown.v11oddsInfer = 0;
          modelRules.push(
            `V10 样本量不足（${input.recentSampleCount ?? 0}场<5场）：攻防效率修正暂不启用，以盘口线为基准`,
          );
         } else {
         const leagueAvg = effectiveLeagueAvgPpg > 0 ? effectiveLeagueAvgPpg : getLeagueBaselineTotal(league);
           if (hasFullOdData && effectiveHomePpg > 0 && effectiveAwayPpg > 0) {
             const expectedHomeScore = (effectiveHomePpg + effectiveAwayOppg) / 2;
             const expectedAwayScore = (effectiveAwayPpg + effectiveHomeOppg) / 2;
             const expectedTotal = expectedHomeScore + expectedAwayScore;
             const efficiencyGap = expectedTotal - totalLineNum;
             const odWeight = isNbaLeague(league) ? 1.1 : 0.9;
             paceAdjust = clamp(efficiencyGap * odWeight, -12, 12);
             adjustBreakdown.offensiveDefensive = Math.round(paceAdjust * 10) / 10;
            modelRules.push(
              `V10 攻防效率总分修正${paceAdjust >= 0 ? '+' : ''}${paceAdjust.toFixed(1)}分` +
              `（预期总分${expectedTotal.toFixed(1)} vs 指数线${totalLineNum}，权重${odWeight}）`,
            );
          } else if (effectiveHomePpg > 0 && effectiveAwayPpg > 0 && leagueAvg > 0) {
             const totalPpg = effectiveHomePpg + effectiveAwayPpg;
             const paceGap = totalPpg - leagueAvg;
             paceAdjust = clamp(paceGap * 0.35, -6, 6);
             adjustBreakdown.pace = Math.round(paceAdjust * 10) / 10;
             modelRules.push(
               `V8 节奏调整${paceAdjust >= 0 ? '+' : ''}${paceAdjust.toFixed(1)}分（两队场均${Math.round(totalPpg)} vs 联赛${Math.round(leagueAvg)}）`,
             );
           } else if (hasValidSpread && totalLineNum > 0) {
             paceAdjust = 0;
             adjustBreakdown.v11oddsInfer = 0;
             modelRules.push(
               'V11.1 指数锚定：以盘口线为基准，不做方向偏移',
             );
           }
        }

       // V11 近期战绩 + H2H 交锋总分融合
       const recent10Hp = input.recent10HomePpg;
       const recent10Ap = input.recent10AwayPpg;
       const recent10Ho = input.recent10HomeOppg;
       const recent10Ao = input.recent10AwayOppg;
       const recent20Hp = input.recent20HomePpg;
       const recent20Ap = input.recent20AwayPpg;
       const recent20Ho = input.recent20HomeOppg;
       const recent20Ao = input.recent20AwayOppg;
       const hasRecent10Data =
         recent10Hp != null && recent10Hp > 0 &&
         recent10Ap != null && recent10Ap > 0 &&
         recent10Ho != null && recent10Ho > 0 &&
         recent10Ao != null && recent10Ao > 0;
       const hasRecent20Data =
         recent20Hp != null && recent20Hp > 0 &&
         recent20Ap != null && recent20Ap > 0 &&
         recent20Ho != null && recent20Ho > 0 &&
         recent20Ao != null && recent20Ao > 0;

       let recentTotalAdjust = 0;
       if ((hasRecent10Data || hasRecent20Data) && (input.recentSampleCount ?? 0) >= 5) {
         let recent10Total = 0;
         let recent20Total = 0;
         let w10 = 0;
         let w20 = 0;
         if (hasRecent10Data) {
           recent10Total = (recent10Hp! + recent10Ao! + recent10Ap! + recent10Ho!) / 2;
           w10 = 0.6;
         }
         if (hasRecent20Data) {
           recent20Total = (recent20Hp! + recent20Ao! + recent20Ap! + recent20Ho!) / 2;
           w20 = 0.4;
         }
         const totalW = w10 + w20;
         if (totalW > 0) {
           const recentTotal = (recent10Total * w10 + recent20Total * w20) / totalW;
           const modelExpectedTotal = totalLineNum + paceAdjust;
           const recentGap = recentTotal - modelExpectedTotal;
            const recentWeight = clamp((input.recentSampleCount ?? 0) / 50, 0.1, 0.25);
           recentTotalAdjust = recentGap * recentWeight;
           recentTotalAdjust = clamp(recentTotalAdjust, -8, 8);
           adjustBreakdown.v11recent = Math.round(recentTotalAdjust * 10) / 10;
           const pct10 = Math.round((w10 / totalW) * 100);
           const pct20 = Math.round((w20 / totalW) * 100);
           modelRules.push(
             `V11 近期战绩总分校准（近10场${pct10}%/近20场${pct20}%，融合权重${Math.round(recentWeight * 100)}%，` +
             `预期${recentTotal.toFixed(1)} vs 基准${modelExpectedTotal.toFixed(1)}，调整${recentTotalAdjust >= 0 ? '+' : ''}${recentTotalAdjust.toFixed(1)}分）`,
           );
         }
       } else {
         modelRules.push('V11 近期战绩数据不足，未做融合校准');
       }

       // V11 H2H 交锋总分校准
       const h2hRecentVal = input.h2hRecent;
       const h2hHistoricalVal = input.h2hHistorical;
       const h2hRecentCnt = input.h2hRecentCount ?? 0;
       const h2hHistoricalCnt = input.h2hHistoricalCount ?? 0;
       let h2hTotalAdjust = 0;
       if (
         h2hRecentVal != null && h2hHistoricalVal != null &&
         (h2hRecentCnt >= 2 || h2hHistoricalCnt >= 5)
       ) {
         const baselineTotal = getLeagueBaselineTotal(league);
         const modelExpectedTotal = totalLineNum + paceAdjust + recentTotalAdjust;
         // 净胜分偏差对总分的间接效应：强队赢多分→节奏可能更快→总分略升，反之亦然
         const h2hPdWeight = h2hRecentCnt >= 2 ? 0.6 : 0.3;
         const h2hPd = (h2hRecentVal * h2hPdWeight + h2hHistoricalVal * (1 - h2hPdWeight));
         // 净胜分与总分的关联系数取 0.3（净胜分每差10分，总分约差3分）
         const h2hTotalFromPd = h2hPd * 0.3;
         const h2hSampleWeight = clamp((h2hRecentCnt + h2hHistoricalCnt) / 15, 0.1, 0.25);
         h2hTotalAdjust = h2hTotalFromPd * h2hSampleWeight;
         h2hTotalAdjust = clamp(h2hTotalAdjust, -5, 5);
         adjustBreakdown.v11h2h = Math.round(h2hTotalAdjust * 10) / 10;
         modelRules.push(
           `V11 H2H交锋总分校准（近${h2hRecentCnt}场/历史${h2hHistoricalCnt}场，` +
           `净胜分效应${h2hTotalFromPd >= 0 ? '+' : ''}${h2hTotalFromPd.toFixed(1)}，` +
           `权重${Math.round(h2hSampleWeight * 100)}%，调整${h2hTotalAdjust >= 0 ? '+' : ''}${h2hTotalAdjust.toFixed(1)}分）`,
         );
       } else if (h2hRecentVal != null || h2hHistoricalVal != null) {
         modelRules.push('V11 H2H交锋样本不足，未做总分校准');
       }

      let injuryOuAdjust = 0;
       if (useV112Model) {
         // V11.2 路径：伤停压小已在上方 V11.2 段内独立计算（v112InjuryOuAdjust）
         injuryOuAdjust = v112InjuryOuAdjust;
       } else {
         // 降级路径：保留原 V8 + V11 伤停压小逻辑
         const hasWeighted =
           input.weightedInjuriesHome != null && input.weightedInjuriesAway != null &&
           (input.weightedInjuriesHome + input.weightedInjuriesAway) > 0;
         const injuryMeasure = hasWeighted
           ? input.weightedInjuriesHome + input.weightedInjuriesAway
           : coreInjuriesHome + coreInjuriesAway;
         const totalInjuries = coreInjuriesHome + coreInjuriesAway;
         if (injuryMeasure > 0) {
            const ouInjuryBase = isNbaLeague(league) ? 0.4 : 1.2;
            injuryOuAdjust = -Math.min(3, Math.round(injuryMeasure * ouInjuryBase * 10) / 10);
            adjustBreakdown.injuryOu = injuryOuAdjust;
            const unitLabel = hasWeighted ? '加权分' : '人';
            modelRules.push(`V8 伤停压小${injuryOuAdjust}分（${injuryMeasure.toFixed(1)}${unitLabel}×${ouInjuryBase}）`);
         }

         // V11 伤停压小增强（参考 data-driven totalInjuryAdjust）
         if (injuryMeasure >= 0.5) {
           const v11OuMultiplier = isNbaLeague(league) ? 0 : 1.5;
           const v11InjuryAdj = -injuryMeasure * v11OuMultiplier;
           injuryOuAdjust += v11InjuryAdj;
           adjustBreakdown.v11injuryOu = v11InjuryAdj;
           const unitLabel = hasWeighted ? '加权分' : '人';
            if (v11OuMultiplier > 0) {
               modelRules.push(`V11 伤停压小增强${v11InjuryAdj}分（${injuryMeasure.toFixed(1)}${unitLabel}×${v11OuMultiplier}）`);
          }
        }
       }

      const isPlayoff =
        stage.includes('淘汰') ||
        stage.includes('季后') ||
        stage.includes('季後') ||
        stage.includes('决赛') ||
        stage.includes('金牌');
      if (isPlayoff && isFibaLeague(league)) {
        stageAdjust -= 3;
        adjustBreakdown.playoff = -3;
        modelRules.push('V8 FIBA淘汰赛-3分');
      }

       if (useV112Model) {
         // ========== V11.2 独立概率计算 ==========
         // 最终预期总分 = 攻防效率均值 + 攻防不对称 + 伤停压小 + 近期战绩融合 + H2H融合 + 月份调整
         finalExpectedTotal =
           efficiencyMeanTotal +
           asymmetryAdjust +
           v112InjuryOuAdjust +
           recentTotalAdjust +
           h2hTotalAdjust +
           stageAdjust;
         netDiff = finalExpectedTotal - totalLineNum;
         predictedTotal = Math.round(finalExpectedTotal * 10) / 10;
         ouDiffVsLine = Math.round(netDiff * 10) / 10;

         const absNetDiff = Math.abs(netDiff);
         let rawProb = 0.5 + absNetDiff * 0.02;  // 每差1分 → +2%
         if (absNetDiff >= 3) {
           rawProb = clamp(rawProb, 0.5, 0.7);   // 方向明确，上限 70%
         } else {
           rawProb = clamp(rawProb, 0.5, 0.55);  // 贴线，封顶 55%
         }
         baseProb = rawProb;

         if (netDiff >= 0) {
           overProb = Math.round(baseProb * 100);
         } else {
           overProb = Math.round((1 - baseProb) * 100);
         }
         underProb = 100 - overProb;
         totalPickProb = Math.max(overProb, underProb);

         // 方向（必须在信心分级之前计算，V11.12 需要根据方向做小分降级判断）
          totalDirection = overProb >= 50 ? '大分' : '小分';
          totalPick = totalDirection;

           // V11.2 信心分级
           // V11.12 小分方向校准：回测显示小分中信心(58-64%)命中率仅37.5%，方向系统性偏弱
           // 因此小分方向只有概率≥65%才给中/高信心，低于65%一律降为低信心
           if (totalPickProb >= 65) {
             ouConfidence = '高';
           } else if (totalPickProb >= 58 && totalDirection === '大分') {
             ouConfidence = '中';
           } else if (totalPickProb >= 62 && totalDirection === '小分') {
             ouConfidence = '中';
           } else {
             ouConfidence = '低';
             if (totalDirection === '小分' && totalPickProb >= 58) {
               modelRules.push('V11.12 小分中信心降级：小分中信心回测命中率偏低，降为低信心');
             }
           }

          // 样本量标注
         const sampleCount = input.recentSampleCount ?? 0;
         const sampleNote = hasSufficientSample
           ? `本赛季${sampleCount}场样本`
           : `样本不足${sampleCount}场，参考历史基线`;

          modelRules.push(
            `V11.2 概率计算：预期总分${finalExpectedTotal.toFixed(1)}分 ` +
            `vs 指数线${totalLineNum}分 → 净差${netDiff >= 0 ? '+' : ''}${netDiff.toFixed(1)}分 ` +
            `→ ${totalDirection}${totalPickProb}%（${ouConfidence}信心，${sampleNote}）`,
          );

          // ========== V11.6 澳NBL联赛校准 ==========
          const nblCalib = this.applyV116NblCalibration(
            input.league || '',
            totalDirection,
            totalPickProb,
            ouConfidence,
            modelRules,
          );
          totalPickProb = nblCalib.totalPickProb;
          ouConfidence = nblCalib.ouConfidence;
          // 同步更新 overProb/underProb（保持 totalPickProb = max(over, under)）
          if (totalDirection === '大分') {
            overProb = totalPickProb;
            underProb = 100 - overProb;
          } else {
            underProb = totalPickProb;
            overProb = 100 - underProb;
          }

          // ========== V11.3 季后赛实证修正 ==========
          // 系列赛实际场均总分直接加权融合 + 盘口趋势因子
          // 权重随系列赛场次递增：G1-G2 50%、G3-G4 65%、G5+ 75%
          // 季后赛/总决赛样本质量远高于常规赛（同一对手、同轮次、真实防守强度）
          const seriesGames = input.playoffSeriesGames ?? [];
          const hasPlayoffSeries = seriesGames.length >= 2;
          if (hasPlayoffSeries) {
            const seriesCount = seriesGames.length;
            let seriesWeight = 0;
            if (seriesCount <= 2) seriesWeight = 0.55;
            else if (seriesCount <= 4) seriesWeight = 0.65;
            else seriesWeight = 0.75;

            const seriesTotals: number[] = [];
            for (const g of seriesGames) {
              if (g.totalScore > 0) seriesTotals.push(g.totalScore);
            }

            let seriesAdj = 0;
            if (seriesTotals.length >= 2) {
              const seriesAvgTotal = seriesTotals.reduce((s: number, t: number) => s + t, 0) / seriesTotals.length;
              const blendedTotal = finalExpectedTotal * (1 - seriesWeight) + seriesAvgTotal * seriesWeight;
              seriesAdj = blendedTotal - finalExpectedTotal;
              adjustBreakdown.playoffSeriesTotal = seriesAdj;
            }

            let lineTrendAdjust = 0;
            if (input.openTotalLineNum != null && input.openTotalLineNum > 0) {
              const lineMove = totalLineNum - input.openTotalLineNum;
              lineTrendAdjust = lineMove * 0.3;
              adjustBreakdown.playoffLineTrend = lineTrendAdjust;
            }

            if (lineTrendAdjust === 0 && seriesGames.length >= 2) {
              const firstGameLine = seriesGames[0].totalLine;
              const lastGameLine = seriesGames[seriesGames.length - 1].totalLine;
              if (firstGameLine > 0 && lastGameLine > 0 && firstGameLine !== lastGameLine) {
                const seriesLineMove = totalLineNum - firstGameLine;
                lineTrendAdjust = seriesLineMove * 0.4;
                adjustBreakdown.playoffLineTrend = lineTrendAdjust;
              }
            }

            const v113Adjust = seriesAdj + lineTrendAdjust;
            if (Math.abs(v113Adjust) >= 0.5) {
              finalExpectedTotal += v113Adjust;
              netDiff = finalExpectedTotal - totalLineNum;
              predictedTotal = Math.round(finalExpectedTotal * 10) / 10;
              ouDiffVsLine = Math.round(netDiff * 10) / 10;

              const absNetDiffV113 = Math.abs(netDiff);
              let rawProbV113 = 0.5 + absNetDiffV113 * 0.02;
              if (absNetDiffV113 >= 3) {
                rawProbV113 = clamp(rawProbV113, 0.5, 0.7);
              } else {
                rawProbV113 = clamp(rawProbV113, 0.5, 0.55);
              }
              if (netDiff >= 0) {
                overProb = Math.round(rawProbV113 * 100);
              } else {
                overProb = Math.round((1 - rawProbV113) * 100);
              }
              underProb = 100 - overProb;
              totalPickProb = Math.max(overProb, underProb);

              if (totalPickProb >= 65) {
                ouConfidence = '高';
              } else if (totalPickProb >= 58) {
                ouConfidence = '中';
              } else {
                ouConfidence = '低';
              }

              totalDirection = overProb >= 50 ? '大分' : '小分';
              totalPick = totalDirection;

              const seriesNote = seriesTotals.length >= 2
                ? `系列赛${seriesTotals.length}场实际场均${Math.round(seriesTotals.reduce((s: number, t: number) => s + t, 0) / seriesTotals.length)}分（融合权重${Math.round(seriesWeight * 100)}%，调整${seriesAdj >= 0 ? '+' : ''}${seriesAdj.toFixed(1)}分）`
                : '';
              const trendNote = input.openTotalLineNum != null && input.openTotalLineNum > 0
                ? `盘口趋势${lineTrendAdjust >= 0 ? '+' : ''}${lineTrendAdjust.toFixed(1)}分（开${input.openTotalLineNum}→现${totalLineNum}）`
                : '';
              const detailNote = [seriesNote, trendNote].filter(Boolean).join('，');
              modelRules.push(
                `V11.3 季后赛实证修正：${detailNote} → 预期总分${finalExpectedTotal.toFixed(1)}分 ` +
                `vs 线${totalLineNum} → 净差${netDiff >= 0 ? '+' : ''}${netDiff.toFixed(1)}分 ` +
                `→ ${totalDirection}${totalPickProb}%（${ouConfidence}信心）`,
              );
            }
          }
        } else {
         // ========== 降级路径（原有 V10/V11 锚定 + clamp[40,60%]） ==========
         const totalAdjust = stageAdjust + paceAdjust + recentTotalAdjust + h2hTotalAdjust + injuryOuAdjust;
         predictedTotal = totalLineNum + totalAdjust;
         ouDiffVsLine = Math.round(totalAdjust * 10) / 10;

         const ouSigma = getTotalSigma(league);
         const ouZ = totalAdjust / ouSigma;
         const rawOverProb = normalCdf(ouZ);
         overProb = Math.round(clamp(rawOverProb, 0.4, 0.6) * 100);
         underProb = 100 - overProb;
         totalPickProb = Math.max(overProb, underProb);

         // v10 大小分闸门分层放宽（按总分盘口深浅）：
         //   - 浅/中盘（|totalAdjust|<8分）：|模型-指数线| ≥ 4分 出方向
         //   - 深盘（8-15分）：≥ 2分 出方向
         //   - 超深盘（≥15分）：≥ 3分 出方向
         // 核心伤停压小因子保留，有任一调整因子（节奏/伤停/月份/季后赛）即视为有依据
         const absAdjust = Math.abs(totalAdjust);
         const hasAdjustmentBasis = stageAdjust !== 0 || paceAdjust !== 0 || injuryOuAdjust !== 0;
         let threshold = 4;
         if (absAdjust >= 15) {
           threshold = 3;
         } else if (absAdjust >= 8) {
           threshold = 2;
         }

         const meetsOuThreshold = absAdjust >= threshold && hasAdjustmentBasis;
         const isCritical = !meetsOuThreshold && totalPickProb >= 45 && totalPickProb <= 55;

         if (overProb >= 50) {
           totalDirection = '大分';
           totalPick = '大分';
         } else {
           totalDirection = '小分';
           totalPick = '小分';
         }

         if (isCritical) {
           ouConfidence = '低';
           modelRules.push(
             `V10.3 临界场次出方向：总分调整${totalAdjust >= 0 ? '+' : ''}${totalAdjust.toFixed(1)}分 ` +
             `vs 阈值${threshold}分 → ${totalDirection}${totalPickProb}%（低信心·临界）`,
           );
         } else if (meetsOuThreshold) {
           modelRules.push(
             `V10 大小分过线：调整${totalAdjust >= 0 ? '+' : ''}${totalAdjust.toFixed(1)}分 ` +
             `≥ 阈值${threshold}分 → ${totalDirection}${totalPickProb}%`,
           );
         } else {
           modelRules.push(
             `V10 大小分弱倾向：调整${totalAdjust >= 0 ? '+' : ''}${totalAdjust.toFixed(1)}分 ` +
             `< 阈值${threshold}分 → ${totalDirection}${totalPickProb}%（低信心）`,
           );
         }

         const ouDeviation = Math.abs(overProb / 100 - 0.5);
         if (meetsOuThreshold && ouDeviation >= 0.08) {
           ouConfidence = '中';
         } else if (meetsOuThreshold && ouDeviation >= 0.06) {
           ouConfidence = '低';
         } else {
           ouConfidence = '低';
         }

         modelRules.push(
           `V10 大小分概率约束在[40%, 60%]区间，σ=${ouSigma.toFixed(1)}，阈值${threshold}分`,
         );
       }
    } else if (hasTeamData) {
      const baselineTotal = getLeagueBaselineTotal(league);
      let modelTotal = baselineTotal;

      if (hasEfficiencyTotal) {
        modelTotal = efficiencyTotal;
        adjustBreakdown.efficiencyTotal = Math.round(efficiencyTotal * 10) / 10;
        modelRules.push(`效率模型无指数线基准：预期总分${efficiencyTotal.toFixed(1)}分（Pace+ORtg推导）`);
      } else {
        const leagueAvg = effectiveLeagueAvgPpg > 0 ? effectiveLeagueAvgPpg : baselineTotal;
        if (effectiveHomePpg > 0 && effectiveAwayPpg > 0 && leagueAvg > 0) {
          const avgPpg = (effectiveHomePpg + effectiveAwayPpg) / 2;
          const paceGap = avgPpg - leagueAvg / 2 * 2;
          modelTotal = baselineTotal + paceGap * 0.6;
          adjustBreakdown.modelPace = Math.round(paceGap * 6) / 10;
        }
      }

      const month = kickoffMonth ?? 0;
      if (isWnbaLeague(league) && month >= 1 && month <= 12) {
        let monthAdj = 0;
        if (month === 6) monthAdj = 4;
        else if (month === 7) monthAdj = 3;
        else if (month === 8) monthAdj = -2.5;
        else if (month === 9) monthAdj = -1.5;
        if (monthAdj !== 0) {
          modelTotal += monthAdj;
          adjustBreakdown.wnbaMonth = monthAdj;
          modelRules.push(`V9 WNBA月份调整${monthAdj > 0 ? '+' : ''}${monthAdj}分（${month}月）`);
        }
      }

      const noLineHasWeighted =
        input.weightedInjuriesHome != null && input.weightedInjuriesAway != null &&
        (input.weightedInjuriesHome + input.weightedInjuriesAway) > 0;
      const injuryMeasure = noLineHasWeighted
        ? input.weightedInjuriesHome + input.weightedInjuriesAway
        : (coreInjuriesHome ?? 0) + (coreInjuriesAway ?? 0);
      if (injuryMeasure > 0) {
        const injuryAdj = -Math.min(3, injuryMeasure * 1.2);
        modelTotal += injuryAdj;
        adjustBreakdown.injuryOu = injuryAdj;
        const unitLabel = noLineHasWeighted ? '加权分' : '人';
        modelRules.push(`V9 伤停压小${injuryAdj}分（${injuryMeasure.toFixed(1)}${unitLabel}）`);
      }

      predictedTotal = Math.round(modelTotal * 10) / 10;
      const ouSigma = getTotalSigma(league);
      const diffFromBaseline = modelTotal - baselineTotal;
      const ouZ = diffFromBaseline / ouSigma;
      overProb = Math.round(clamp(normalCdf(ouZ), 0.15, 0.85) * 100);
      underProb = 100 - overProb;
      totalPickProb = Math.max(overProb, underProb);

      if (overProb >= 58) {
        totalDirection = '模型参考·大分';
        totalPick = '模型参考·大分';
      } else if (underProb >= 58) {
        totalDirection = '模型参考·小分';
        totalPick = '模型参考·小分';
      } else {
        totalDirection = '模型参考·中性';
        totalPick = '模型参考·中性';
      }
      ouConfidence = totalPickProb >= 65 ? '中' : '低';
      modelRules.push(
        `V9 无指数线模型参考大小分：预期总分${predictedTotal.toFixed(1)}，` +
        `大分概率${overProb}%（σ=${ouSigma.toFixed(1)}）`,
      );
     } else {
       totalDirection = overProb >= 50 ? '大分' : '小分';
       totalPick = totalDirection;
       ouConfidence = '低';
       modelRules.push('V9 弱基线模式：球队数据不足，大小分低信心参考方向');
     }

    // 预期比分用 modelSpread 计算（模型修正后的预期净胜），与让分方向严格自洽
    // 有指数线时，modelSpread = 效率模型预期 / ELO+卡尔曼综合 / 指数隐含（三选一，按优先级）
    // 无指数线时保持原逻辑（效率模型 / 模型独立推导）
    let scoreSpread: number;
    if (hasValidSpread) {
      const impliedSpread = -handicapLineNum!;
      if (efficiencyResult) {
        scoreSpread = efficiencyResult.expectedSpread;
      } else if (hasTeamData) {
        scoreSpread = this.computeModelExpectedSpread(input);
      } else {
        scoreSpread = impliedSpread;
      }
      // 加上伤停净胜分调整（与让分模型输入一致）
      scoreSpread += injuryAdjust.marginShift;
    } else if (!hasValidSpread && anchor === 'model_reference') {
      scoreSpread = efficiencyResult
        ? efficiencyResult.expectedSpread
        : this.computeModelExpectedSpread(input);
    } else {
      scoreSpread = -1 * (handicapLineNum ?? 0);
    }
    const homePredicted = Math.round(predictedTotal / 2 + scoreSpread / 2);
    const awayPredicted = Math.round(predictedTotal / 2 - scoreSpread / 2);
    let predictedHomeScore = Math.max(40, homePredicted);
    let predictedAwayScore = Math.max(40, awayPredicted);

    let lowConfidence = false;
    if (handicapConfidence === '低' && ouConfidence === '低') {
      lowConfidence = true;
    }

    if (anchor === 'no_line_fallback' || anchor === 'model_reference') {
      lowConfidence = true;
      modelRules.push('V9 无指数线模式→低信心（仅作实力参考，不构成决策建议）');
    }

    const lKey = leagueKey(input.league);
    const sampleCount = input.recentSampleCount ?? input.eloSampleCount ?? 0;
    const isNbaByTeam = lKey === 'EuroLeague' && isNbaTeamName(input.homeTeam, input.awayTeam);
    const isNbaEarlySeason = (lKey === 'NBA' || isNbaByTeam) && sampleCount < 5;
    if ((anchor === 'no_line_fallback' || anchor === 'model_reference') && isNbaEarlySeason) {
      const spread = predictedHomeScore - predictedAwayScore;
      if (Math.abs(spread) > 15) {
        const clampedSpread = spread > 0 ? 15 : -15;
        const total = predictedHomeScore + predictedAwayScore;
        predictedHomeScore = Math.round(total / 2 + clampedSpread / 2);
        predictedAwayScore = Math.round(total / 2 - clampedSpread / 2);
        modelRules.push(`V11.9 NBA赛季初无盘口保护：净胜分${spread > 0 ? '+' : ''}${spread}→${spread > 0 ? '+' : ''}${clampedSpread}（clamp ±15）`);
      } else {
        modelRules.push('V11.9 NBA赛季初无盘口保护：样本不足，信心上限55%');
      }
    }

    let confidence = wdwConfidence;

    if ((anchor === 'no_line_fallback' || anchor === 'model_reference') && isNbaEarlySeason) {
      if (confidence > 55) {
        confidence = 55;
        if (!modelRules.some((r: string) => r.startsWith('V11.9 NBA赛季初无盘口保护'))) {
          modelRules.push('V11.9 NBA赛季初无盘口保护：样本不足，信心上限55%');
        }
      }
    }

    // V11.4 让客深盘：最终信心上限55（精选组合排除）
    const hLineAbs = Math.abs(handicapLineNum ?? 0);
    const letAwayDeepLine = handicapRecommendation === '让分客胜' && hLineAbs >= 6 && hLineAbs < 10;
    const hasStrongInjuryEvidence = injuryAdjust.isV113 && Math.abs(injuryAdjust.marginShift) >= 1;
    if (letAwayDeepLine && !hasStrongInjuryEvidence && confidence > 55) {
      confidence = 55;
    }

    // V11.8 让客信心整体收缩：最终信心上限70%（解决让客系统性高估10pp问题，无例外）
    // V11.4深盘55%仍优先（6-10分让客专项降权）
    const isAwayPick = handicapRecommendation === '让分客胜';
    if (isAwayPick && hLineAbs < 6 && confidence > 70) {
      confidence = 70;
      if (!modelRules.some((r: string) => r.startsWith('V11.8 让客信心收缩：最终信心'))) {
        modelRules.push('V11.8 让客信心收缩：最终信心上限70%');
      }
    }

    const eloHomeOut: number | undefined =
      input.eloHome != null && input.eloHome > 0 ? input.eloHome : undefined;
    const eloAwayOut: number | undefined =
      input.eloAway != null && input.eloAway > 0 ? input.eloAway : undefined;
    const eloGapOut: number | undefined =
      eloHomeOut != null && eloAwayOut != null
        ? (input.eloGap ?? eloHomeOut - eloAwayOut)
        : undefined;

    if (totalLineNum && totalLineNum > 0 && totalDirection !== '观望') {
      const expectedDiff = predictedTotal - totalLineNum;
      const directionSign = totalDirection === '大分' ? 1 : -1;
      if (expectedDiff * directionSign < 0) {
        const lineDelta = 0.1;
        predictedTotal = Math.round((totalLineNum + directionSign * lineDelta) * 10) / 10;
        ouDiffVsLine = Math.round(directionSign * lineDelta * 10) / 10;
        const scoreSpread = predictedHomeScore - predictedAwayScore;
        const newHome = Math.round(predictedTotal / 2 + scoreSpread / 2);
        const newAway = Math.round(predictedTotal / 2 - scoreSpread / 2);
        predictedHomeScore = Math.max(40, newHome);
        predictedAwayScore = Math.max(40, newAway);
        modelRules.push(`自洽校准：预期总分与方向对齐至${predictedTotal.toFixed(1)}分（贴线临界）`);
      }
    }

    if (hasValidSpread && handicapRecommendation && handicapRecommendation !== '观望') {
      const currentSpread = predictedHomeScore - predictedAwayScore;
      const spreadPlusLine = currentSpread + (handicapLineNum ?? 0);
      const hcDirectionSign = handicapRecommendation === '让分主胜' ? 1 : -1;
      if (spreadPlusLine * hcDirectionSign <= 0) {
        const targetSpread = -(handicapLineNum ?? 0) + hcDirectionSign * 0.5;
        const newHome = Math.round(predictedTotal / 2 + targetSpread / 2);
        const newAway = Math.round(predictedTotal / 2 - targetSpread / 2);
        predictedHomeScore = Math.max(40, newHome);
        predictedAwayScore = Math.max(40, newAway);
        modelRules.push(`自洽校准：预期净胜与让分方向对齐至${predictedHomeScore - predictedAwayScore > 0 ? '+' : ''}${predictedHomeScore - predictedAwayScore}分（贴线临界）`);
      }
    }

    const result = {
      homeWinProb,
      awayWinProb,
      predictionDirection,
      confidence,
      handicapRecommendation,
      handicapPick,
      handicapCoverProb,
      handicapPickProb,
      totalDirection,
      totalPick,
      overProb,
      underProb,
      totalPickProb,
      predictedHomeScore,
      predictedAwayScore,
      predictedTotal,
      modelRules,
      handicapConfidence,
      ouConfidence,
      ouDiffVsLine,
      adjustBreakdown,
      anchor,
      subModels,
      injuryAdjustApplied: injuryAdjust.marginShift,
      injuryAdjustPct: injuryAdjust.wdwShiftPct,
      advancedDataReady: hasEfficiencyData,
      advancedDataNotice: hasEfficiencyData
        ? '高阶数据：ORtg/DRtg效率模型 + Pace节奏量化已接入'
        : '高阶数据（四要素/效率模型）待接入',
      lowConfidence,
      eloHome: eloHomeOut,
      eloAway: eloAwayOut,
      eloGap: eloGapOut,
      modelSpread: finalModelSpread,
      predEngineVersion: (() => {
        let baseVersion: string;
        if (injuryAdjust.isV113) {
          baseVersion = shallowFormApplied ? 'v11.5-full' : 'v11.3-injury-weighted';
        } else {
          baseVersion = shallowFormApplied ? 'v11.5-shallow-form' : 'v11.1-unified';
        }
        if (leagueKey(input.league) === 'NBL') {
          if (baseVersion === 'v11.1-unified') return 'v11.6-nbl-calibrated';
          if (baseVersion === 'v11.5-shallow-form') return 'v11.6-nbl-shallow-form';
          if (baseVersion === 'v11.5-full') return 'v11.6-nbl-full';
          if (baseVersion === 'v11.3-injury-weighted') return 'v11.6-nbl-injury-weighted';
          return `${baseVersion}-nbl-v116`;
        }
        return baseVersion;
      })(),
    };
    if (input.league && (input.league.includes('欧洲篮球') || input.league.includes('欧篮联') || input.league.includes('EuroLeague'))) {
      this.logger.error(`[V113-RESULT] league=${input.league}, isV113=${injuryAdjust.isV113}, version=${result.predEngineVersion}, injuryShift=${injuryAdjust.marginShift}, freshH=${input.freshWeightedInjuriesHome}, freshA=${input.freshWeightedInjuriesAway}, coreH=${input.coreInjuriesHome}, coreA=${input.coreInjuriesAway}`);
    }
    return result;
  }

  private computeModelExpectedSpread(input: AnchorPredictionInput): number {
    const { homePpg, awayPpg, league, homeRecentForm, awayRecentForm, coreInjuriesHome = 0, coreInjuriesAway = 0 } = input;

    const baseline = getLeagueBaselineTotal(league);
    let homeOff = baseline / 2;
    let awayOff = baseline / 2;

    if (homePpg && homePpg > 0) homeOff = 0.65 * homePpg + 0.35 * (baseline / 2);
    if (awayPpg && awayPpg > 0) awayOff = 0.65 * awayPpg + 0.35 * (baseline / 2);

    const formFactor = (form: string[] | undefined): number => {
      if (!form || form.length === 0) return 0;
      let momentum = 0;
      for (let i = 0; i < form.length; i += 1) {
        const w = form.length - i;
        const r = form[i];
        if (r === 'W' || r === '胜') momentum += w * 0.6;
        else if (r === 'L' || r === '负') momentum -= w * 0.6;
      }
      return clamp(momentum, -5, 5);
    };

    homeOff += formFactor(homeRecentForm);
    awayOff += formFactor(awayRecentForm);

    const isNba = leagueKey(league) === 'NBA';
    const homeAdv = isNba ? 2.5 : 3.0;
    const expectedSpread = homeOff - awayOff + homeAdv;

    const totalInjuries = coreInjuriesHome + coreInjuriesAway;
    if (totalInjuries > 0) {
      const injuryDamp = 1 - Math.min(0.2, totalInjuries * 0.05);
      return Math.round(expectedSpread * injuryDamp * 10) / 10;
    }

    return Math.round(expectedSpread * 10) / 10;
  }

  private applyShallowLineFormAdjustment(
    handicapLineNum: number,
    recent10HomePd: number,
    recent10AwayPd: number,
    coreInjuriesHome: number,
    coreInjuriesAway: number,
    modelRules: string[],
  ): { spreadAdjust: number; applied: boolean } {
    const lineAbs = Math.abs(handicapLineNum);
    const isShallowLine = lineAbs < 5.5;
    const isHomeFavorite = handicapLineNum < 0;

    if (!isShallowLine) return { spreadAdjust: 0, applied: false };
    if (recent10HomePd === 0 && recent10AwayPd === 0) return { spreadAdjust: 0, applied: false };

    const formDiff = recent10HomePd - recent10AwayPd;
    const maxFormAdj = 1.5;
    const formAdj = clamp(formDiff * 0.08, -maxFormAdj, maxFormAdj);

    let spreadAdjust = formAdj;
    const notes: string[] = [];
    notes.push(`近期状态${formAdj > 0 ? '+' : ''}${formAdj.toFixed(1)}分`);

    if (lineAbs <= 3.5) {
      if (isHomeFavorite && coreInjuriesAway <= 1 && recent10AwayPd > 5) {
        spreadAdjust -= 0.8;
        notes.push('客队爆冷抑制(-0.8)');
      } else if (!isHomeFavorite && coreInjuriesHome <= 1 && recent10HomePd > 5) {
        spreadAdjust += 0.8;
        notes.push('主队爆冷抑制(+0.8)');
      }
    }

    spreadAdjust = Math.round(spreadAdjust * 10) / 10;

    modelRules.push(
      `V11.5 浅盘近期状态修正：${notes.join('，')}（净调整${spreadAdjust > 0 ? '+' : ''}${spreadAdjust.toFixed(1)}分）`,
    );

    return { spreadAdjust, applied: true };
  }

  private applyV116NblCalibration(
    league: string,
    totalDirection: string,
    totalPickProb: number,
    ouConfidence: '高' | '中' | '低',
    modelRules: string[],
  ): { totalPickProb: number; ouConfidence: '高' | '中' | '低'; modelRules: string[]; nblCalibrated: boolean } {
    if (leagueKey(league) !== 'NBL') {
      return { totalPickProb, ouConfidence, modelRules, nblCalibrated: false };
    }

    let calibratedProb = totalPickProb;
    let ruleDesc = '';

    if (totalDirection === '小分') {
      calibratedProb = Math.min(totalPickProb, 55);
      ruleDesc = '小分降权至55%上限';
    } else if (totalDirection === '大分' && ouConfidence === '高') {
      calibratedProb = Math.min(totalPickProb, 62);
      ruleDesc = '大分高信心上限62%';
    }

    // 重新计算信心分级
    let newConfidence: '高' | '中' | '低' = ouConfidence;
    if (calibratedProb !== totalPickProb || ruleDesc) {
      if (calibratedProb >= 65) {
        newConfidence = '高';
      } else if (calibratedProb >= 58) {
        newConfidence = '中';
      } else {
        newConfidence = '低';
      }
      if (!ruleDesc) {
        ruleDesc = '校准后信心重分级';
      }
      modelRules.push(
        `V11.6 澳NBL联赛校准：${ruleDesc}，校准后${calibratedProb}%（${newConfidence}信心）`,
      );
    }

    return {
      totalPickProb: calibratedProb,
      ouConfidence: newConfidence,
      modelRules,
      nblCalibrated: true,
    };
  }

  private computeInjuryAdjustment(
    hasValidSpread: boolean,
    handicapLineNum: number,
    favoriteTeamSide: 'home' | 'away' | null | undefined,
    favoriteCoreInjuries: number,
    coreInjuriesHome: number,
    coreInjuriesAway: number,
    league: string,
    modelRules: string[],
    freshCoreHome: number = 0,
    freshCoreAway: number = 0,
    freshWeightedHome: number = 0,
    freshWeightedAway: number = 0,
    recent10HomePd: number = 0,
    recent10AwayPd: number = 0,
  ): { marginShift: number; wdwShiftPct: number; ouAdjust: number; isV113: boolean } {
    if (league && (league.includes('EuroLeague') || league.includes('欧洲篮球') || league.includes('欧篮联'))) {
      this.logger.error(`[V113-CIA] league=${league}, hasValidSpread=${hasValidSpread}, freshH=${freshWeightedHome}, freshA=${freshWeightedAway}, coreH=${coreInjuriesHome}, coreA=${coreInjuriesAway}, hc=${handicapLineNum}`);
    }
    if (!hasValidSpread) return { marginShift: 0, wdwShiftPct: 0, ouAdjust: 0, isV113: false };

    const hasFreshData = freshWeightedHome > 0 || freshWeightedAway > 0;
    const weightedHome = hasFreshData ? freshWeightedHome : (coreInjuriesHome * 0.8);
    const weightedAway = hasFreshData ? freshWeightedAway : (coreInjuriesAway * 0.8);
    const lineAbs = Math.abs(handicapLineNum);
    const isHomeFavorite = handicapLineNum < 0;
    const hcSigma = getHandicapSigma(league);
    const isShallowLine = lineAbs < 5.5;
    const isNba = isNbaLeague(league);
    const isWnba = isWnbaLeague(league);

    const netWeightedDiff = weightedHome - weightedAway;
    let shiftPoints = 0;
    let ouAdjust = 0;

    if (weightedHome === 0 && weightedAway === 0) {
      return { marginShift: 0, wdwShiftPct: 0, ouAdjust: 0, isV113: false };
    }

    const perUnitShift = isShallowLine ? 0.15 * hcSigma : 0.10 * hcSigma;
    const maxShift = isShallowLine ? 4.0 : 3.0;
    shiftPoints = clamp(netWeightedDiff * perUnitShift, -maxShift, maxShift);

    const freshCoreTotal = freshCoreHome + freshCoreAway;
    const totalWeighted = weightedHome + weightedAway;
    const isLongTermAdapted = hasFreshData && freshCoreTotal < (coreInjuriesHome + coreInjuriesAway) * 0.5;
    if (isLongTermAdapted) {
      shiftPoints *= 0.4;
    }

    shiftPoints = Math.round(shiftPoints * 10) / 10;

    const marginShift = -shiftPoints;

    const wdwZ = marginShift / SPREAD_TO_WDW_SIGMA;
    const wdwShiftProb = normalCdf(wdwZ) - 0.5;
    const wdwShiftPct = Math.round(wdwShiftProb * 100);
    const maxPctShift = MAX_INJURY_ADJUST_PCT;
    const clampedPct = clamp(wdwShiftPct, -maxPctShift, maxPctShift);

    const ouPerUnit = isWnba ? 1.5 : (isNba ? 0.5 : 1.0);
    const maxOu = isWnba ? 6 : (isNba ? 2.5 : 4);
    ouAdjust = -Math.min(maxOu, Math.round(totalWeighted * ouPerUnit * 10) / 10);

    if (isLongTermAdapted) {
      ouAdjust *= 0.4;
      ouAdjust = Math.round(ouAdjust * 10) / 10;
    }

    modelRules.push(
      `V11.3 伤停加权融合：主队加权${weightedHome.toFixed(1)}/客队加权${weightedAway.toFixed(1)}` +
      `→净差${netWeightedDiff > 0 ? '+' : ''}${netWeightedDiff.toFixed(1)}` +
      `，让分修正${marginShift > 0 ? '+' : ''}${marginShift.toFixed(1)}分` +
      `（${isShallowLine ? '浅盘' : '常规'}系数${perUnitShift.toFixed(2)}σ/单位，上限±${maxShift}分）` +
      (isLongTermAdapted ? '，含长期缺阵×0.4衰减' : ''),
    );

    if (Math.abs(clampedPct) > 0) {
      modelRules.push(`V11.3 胜负概率修正${clampedPct > 0 ? '+' : ''}${clampedPct}%（上限±${maxPctShift}%）`);
    }

    return { marginShift, wdwShiftPct: clampedPct, ouAdjust, isV113: true };
  }

  generateStructuralFields(input: AnchorPredictionInput): {
    predEngineVersion: string;
    predictionAnchor: string | null;
    subModels: SubModelResult[];
  } {
    const { handicapLineNum, league, homePpg, awayPpg, homeTeam, awayTeam, homeRecentForm, awayRecentForm } = input;

    const hasValidSpread =
      handicapLineNum != null &&
      !Number.isNaN(handicapLineNum) &&
      handicapLineNum !== 0 &&
      Math.abs(handicapLineNum) <= 40;

    const subModels: SubModelResult[] = [];

    if (hasValidSpread) {
      const impliedHomeWin = normalCdf(-handicapLineNum / SPREAD_TO_WDW_SIGMA);
      const homeWinProb = Math.round(impliedHomeWin * 100);
      subModels.push({
        key: 'spread_anchor',
        label: '指数线锚定',
        role: 'anchor',
        homeWinProb,
        awayWinProb: 100 - homeWinProb,
        predictionDirection: homeWinProb >= 50 ? '主胜' : '客胜',
        note: '市场让分线→正态CDF(SIG=12)→胜负概率',
      });
    }

    const eloResult = this.computeEloFallback({
      ...input,
      stage: '',
      favoriteTeamSide: null,
      coreInjuriesHome: 0,
      coreInjuriesAway: 0,
      favoriteCoreInjuries: 0,
      kickoffMonth: 0,
      homeWinOdds: undefined,
      awayWinOdds: undefined,
    });
    const kalmanResult = this.computeKalmanFallback({
      ...input,
      stage: '',
      favoriteTeamSide: null,
      coreInjuriesHome: 0,
      coreInjuriesAway: 0,
      favoriteCoreInjuries: 0,
      kickoffMonth: 0,
      homeWinOdds: undefined,
      awayWinOdds: undefined,
    });
    subModels.push(eloResult, kalmanResult);

    return {
      predEngineVersion: hasValidSpread ? 'v8.0-anchor' : 'v8.0-fallback',
      predictionAnchor: hasValidSpread ? 'spread_anchored' : null,
      subModels,
    };
  }

  private computeEloFallback(input: AnchorPredictionInput): SubModelResult {
    const {
      homePpg,
      awayPpg,
      homeTeam,
      awayTeam,
      league,
      homeRecentForm,
      awayRecentForm,
    } = input;

    let homeRating = 1500;
    let awayRating = 1500;

    const baseline = getLeagueBaselineTotal(league);
    if (homePpg && homePpg > 0) {
      homeRating = 1500 + (homePpg - baseline / 2) * 8;
    }
    if (awayPpg && awayPpg > 0) {
      awayRating = 1500 + (awayPpg - baseline / 2) * 8;
    }

    const formBoost = (form: string[] | undefined, side: number): number => {
      if (!form || form.length === 0) return 0;
      let wins = 0;
      for (const r of form) {
        if (r === 'W' || r === '胜') wins += 1;
        else if (r === 'L' || r === '负') wins -= 1;
      }
      return wins * 15 * side;
    };

    homeRating += formBoost(homeRecentForm, 1);
    awayRating += formBoost(awayRecentForm, 1);

    const homeAdvantage = 50;
    const expectedHomeWin = 1 / (1 + Math.pow(10, (awayRating - homeRating - homeAdvantage) / 400));
    const homeProb = Math.round(clamp(expectedHomeWin * 100, 5, 95));

    return {
      key: 'elo',
      label: 'ELO迭代',
      role: 'reference',
      homeWinProb: homeProb,
      awayWinProb: 100 - homeProb,
      predictionDirection: homeProb >= 50 ? '主胜' : '客胜',
      note: homeTeam && awayTeam ? '基于场均得分+近期状态的ELO评分' : '缺球队数据→默认50/50',
    };
  }

  private computeKalmanFallback(input: AnchorPredictionInput): SubModelResult {
    const { homePpg, awayPpg, league, homeRecentForm, awayRecentForm } = input;

    const baseline = getLeagueBaselineTotal(league);
    let homeTrueSkill = baseline / 2;
    let awayTrueSkill = baseline / 2;

    if (homePpg && homePpg > 0) {
      homeTrueSkill = 0.7 * homePpg + 0.3 * (baseline / 2);
    }
    if (awayPpg && awayPpg > 0) {
      awayTrueSkill = 0.7 * awayPpg + 0.3 * (baseline / 2);
    }

    const formFactor = (form: string[] | undefined): number => {
      if (!form || form.length === 0) return 0;
      let momentum = 0;
      for (let i = 0; i < form.length; i += 1) {
        const w = form.length - i;
        const r = form[i];
        if (r === 'W' || r === '胜') momentum += w * 0.8;
        else if (r === 'L' || r === '负') momentum -= w * 0.8;
      }
        return clamp(momentum, -5, 5);
      };

    const homeMomentum = formFactor(homeRecentForm);
    const awayMomentum = formFactor(awayRecentForm);
    homeTrueSkill += homeMomentum;
    awayTrueSkill += awayMomentum;

    const homeAdv = isNbaLeague(league) ? 2.5 : 3.0;
    const expectedMargin = homeTrueSkill - awayTrueSkill + homeAdv;
    const homeWinProb = Math.round(
      clamp(normalCdf(expectedMargin / SPREAD_TO_WDW_SIGMA) * 100, 5, 95),
    );

    return {
      key: 'kalman',
      label: '卡尔曼状态空间',
      role: 'reference',
      homeWinProb: homeWinProb,
      awayWinProb: 100 - homeWinProb,
      predictionDirection: homeWinProb >= 50 ? '主胜' : '客胜',
      note: '基于场均得分的状态空间估计（缺boxscore时为简化版）',
    };
  }
}
