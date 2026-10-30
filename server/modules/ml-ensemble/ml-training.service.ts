import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { matches, basketballMatches, teamsElo } from '@server/database/schema';
import { FeatureEngineeringService } from './feature-engineering.service';
import { GbdtService, GbdtModel } from './gbdt.service';
import { trainBinaryGbdt, computeAccuracy } from './gbdt-trainer';
import type { GbdtModelParams } from './gbdt.service';

interface TrainingSample {
  features: number[];
  label: number;
}

interface TrainResult {
  model: GbdtModelParams;
  trainSize: number;
  testSize: number;
  trainAccuracy: number;
  testAccuracy: number;
  trainLogLoss: number;
  testLogLoss: number;
  featureImportance: number[];
  featureNames: string[];
}

@Injectable()
export class MlTrainingService {
  private readonly logger = new Logger(MlTrainingService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly featureEngineering: FeatureEngineeringService,
    private readonly gbdtService: GbdtService,
  ) {}

  async trainAndLoadAll(nEstimators = 50, learningRate = 0.1, seed = 42): Promise<void> {
    try {
      this.logger.log('开始足球 ML 模型训练...');
      const fb = await this.trainFootballModel(nEstimators, learningRate, seed);
      this.gbdtService.setFootballModel(new GbdtModel(fb.model));
      this.logger.log(`足球 ML 训练完成：训练 ${fb.trainSize} 场，测试 ${fb.testSize} 场，测试准确率 ${(fb.testAccuracy * 100).toFixed(2)}%`);
    } catch (e) {
      this.logger.error('足球 ML 训练失败，保持基线模型', (e as Error).message);
    }
    try {
      this.logger.log('开始篮球 ML 模型训练...');
      const bb = await this.trainBasketballModel(nEstimators, learningRate, seed);
      this.gbdtService.setBasketballModel(new GbdtModel(bb.model));
      this.logger.log(`篮球 ML 训练完成：训练 ${bb.trainSize} 场，测试 ${bb.testSize} 场，测试准确率 ${(bb.testAccuracy * 100).toFixed(2)}%`);
    } catch (e) {
      this.logger.error('篮球 ML 训练失败，保持基线模型', (e as Error).message);
    }
  }

  async trainFootballModel(nEstimators: number = 50, learningRate: number = 0.1, seed: number = 42): Promise<TrainResult> {
    this.logger.log('开始准备足球ML训练数据...');

    const finishedMatches = await this.db
      .select({
        id: matches.id,
        homeTeam: matches.homeTeam,
        awayTeam: matches.awayTeam,
        league: matches.league,
        homeScore: matches.homeScore,
        awayScore: matches.awayScore,
        kickoffTime: matches.kickoffTime,
        advancedStats: matches.advancedStats,
      })
      .from(matches)
      .where(and(
        eq(matches.matchStatus, 'finished'),
        isNotNull(matches.homeScore),
        isNotNull(matches.awayScore),
      ))
      .orderBy(matches.kickoffTime);

    this.logger.log(`找到 ${finishedMatches.length} 场已完赛足球比赛`);

    const samples: TrainingSample[] = [];
    const leagueStats: Map<string, { totalGoals: number; count: number }> = new Map();
    const teamStats: Map<string, { goals: number; conceded: number; gp: number; formPts: number; formCount: number }> = new Map();

    for (const match of finishedMatches) {
      const homeTeam = match.homeTeam || '';
      const awayTeam = match.awayTeam || '';
      const league = match.league || '';
      const hs = match.homeScore ?? 0;
      const as = match.awayScore ?? 0;

      const hKey = `${league}|${homeTeam}`;
      const aKey = `${league}|${awayTeam}`;

      const h = teamStats.get(hKey) ?? { goals: 0, conceded: 0, gp: 0, formPts: 0, formCount: 0 };
      const a = teamStats.get(aKey) ?? { goals: 0, conceded: 0, gp: 0, formPts: 0, formCount: 0 };

      const leagueStat = leagueStats.get(league) ?? { totalGoals: 0, count: 0 };
      const leagueAvgGoals = leagueStat.count > 0 ? leagueStat.totalGoals / leagueStat.count : 2.6;

      const homeGoalsAvg = h.gp > 0 ? h.goals / h.gp : 1.3;
      const homeConcededAvg = h.gp > 0 ? h.conceded / h.gp : 1.3;
      const awayGoalsAvg = a.gp > 0 ? a.goals / a.gp : 1.2;
      const awayConcededAvg = a.gp > 0 ? a.conceded / a.gp : 1.2;
      const homeFormPts = h.formCount > 0 ? h.formPts / (h.formCount * 3) : 0.5;
      const awayFormPts = a.formCount > 0 ? a.formPts / (a.formCount * 3) : 0.5;

      const advStats = (match.advancedStats as Record<string, unknown> | undefined) || {};
      const homeXgAvg = typeof advStats.xgHome === 'number' && advStats.xgHome > 0
        ? advStats.xgHome
        : homeGoalsAvg;
      const awayXgAvg = typeof advStats.xgAway === 'number' && advStats.xgAway > 0
        ? advStats.xgAway
        : awayGoalsAvg;

      const { features } = this.featureEngineering.extractFootballFeatures({
        eloGap: 0,
        homeXgAvg,
        awayXgAvg,
        homeGoalsAvg,
        awayGoalsAvg,
        homeConcededAvg,
        awayConcededAvg,
        leagueAvgGoals,
        homeFormPts,
        awayFormPts,
        homeAdvantageFlag: 1,
        h2hHomeWinRate: 0.5,
        restDaysDiff: 0,
      });

      const label = hs > as ? 1 : 0;
      samples.push({ features, label });

      h.goals += hs;
      h.conceded += as;
      h.gp += 1;
      h.formPts += hs > as ? 3 : (hs === as ? 1 : 0);
      h.formCount = Math.min(h.formCount + 1, 5);

      a.goals += as;
      a.conceded += hs;
      a.gp += 1;
      a.formPts += as > hs ? 3 : (as === hs ? 1 : 0);
      a.formCount = Math.min(a.formCount + 1, 5);

      teamStats.set(hKey, h);
      teamStats.set(aKey, a);

      leagueStats.set(league, {
        totalGoals: leagueStat.totalGoals + hs + as,
        count: leagueStat.count + 1,
      });
    }

    this.logger.log(`构造了 ${samples.length} 个训练样本`);

    const splitIdx: number = Math.floor(samples.length * 0.8);
    const trainSet: TrainingSample[] = samples.slice(0, splitIdx);
    const testSet: TrainingSample[] = samples.slice(splitIdx);

    const trainX: number[][] = trainSet.map((s: TrainingSample): number[] => s.features);
    const trainY: number[] = trainSet.map((s: TrainingSample): number => s.label);
    const testX: number[][] = testSet.map((s: TrainingSample): number[] => s.features);
    const testY: number[] = testSet.map((s: TrainingSample): number => s.label);

    this.logger.log(`训练集 ${trainX.length} 场，测试集 ${testX.length} 场`);

    const model: GbdtModelParams = trainBinaryGbdt(trainX, trainY, {
      nEstimators,
      learningRate,
      seed,
    });

    const trainAcc: number = computeAccuracy(trainX, trainY, model);
    const testAcc: number = computeAccuracy(testX, testY, model);

    const featureImportance: number[] = this.calcFeatureImportance(model, 12);

    this.logger.log(`足球模型训练完成：训练集准确率 ${(trainAcc * 100).toFixed(2)}%，测试集准确率 ${(testAcc * 100).toFixed(2)}%`);

    model.modelSource = 'trained_gbdt_v1';
    model.trainedAt = new Date().toISOString();
    model.trainSamples = trainX.length;
    model.testAccuracy = testAcc;

    return {
      model,
      trainSize: trainX.length,
      testSize: testX.length,
      trainAccuracy: trainAcc,
      testAccuracy: testAcc,
      trainLogLoss: 0,
      testLogLoss: 0,
      featureImportance,
      featureNames: [],
    };
  }

  async trainBasketballModel(nEstimators: number = 50, learningRate: number = 0.1, seed: number = 42): Promise<TrainResult> {
    this.logger.log('开始准备篮球ML训练数据...');

    const finishedMatches = await this.db
      .select({
        id: basketballMatches.id,
        homeTeam: basketballMatches.homeTeam,
        awayTeam: basketballMatches.awayTeam,
        league: basketballMatches.league,
        homeScore: basketballMatches.homeScore,
        awayScore: basketballMatches.awayScore,
        kickoffTime: basketballMatches.kickoffTime,
      })
      .from(basketballMatches)
      .where(and(
        eq(basketballMatches.matchStatus, 'finished'),
        isNotNull(basketballMatches.homeScore),
        isNotNull(basketballMatches.awayScore),
      ))
      .orderBy(basketballMatches.kickoffTime);

    this.logger.log(`找到 ${finishedMatches.length} 场已完赛篮球比赛`);

    const samples: TrainingSample[] = [];
    const teamStats: Map<string, { scored: number; conceded: number; gp: number; formPts: number; formCount: number }> = new Map();
    const leagueStats: Map<string, { totalPts: number; count: number }> = new Map();

    for (const match of finishedMatches) {
      const homeTeam = match.homeTeam || '';
      const awayTeam = match.awayTeam || '';
      const league = match.league || '';
      const hs = match.homeScore ?? 0;
      const as = match.awayScore ?? 0;

      const hKey = `${league}|${homeTeam}`;
      const aKey = `${league}|${awayTeam}`;

      const h = teamStats.get(hKey) ?? { scored: 0, conceded: 0, gp: 0, formPts: 0, formCount: 0 };
      const a = teamStats.get(aKey) ?? { scored: 0, conceded: 0, gp: 0, formPts: 0, formCount: 0 };

      const leagueStat = leagueStats.get(league) ?? { totalPts: 0, count: 0 };
      const leagueAvgOrtg = leagueStat.count > 0 ? leagueStat.totalPts / leagueStat.count / 2 : 100;
      const leagueAvgPace = 95;

      const homeOrtg = h.gp > 0 ? h.scored / h.gp : 100;
      const homeDrtg = h.gp > 0 ? h.conceded / h.gp : 100;
      const awayOrtg = a.gp > 0 ? a.scored / a.gp : 100;
      const awayDrtg = a.gp > 0 ? a.conceded / a.gp : 100;
      const homeFormPts = h.formCount > 0 ? h.formPts / (h.formCount * 2) : 0.5;
      const awayFormPts = a.formCount > 0 ? a.formPts / (a.formCount * 2) : 0.5;

      const { features } = this.featureEngineering.extractBasketballFeatures({
        eloGap: 0,
        homeOrtg,
        awayOrtg,
        homeDrtg,
        awayDrtg,
        homePace: leagueAvgPace,
        awayPace: leagueAvgPace,
        leagueAvgOrtg,
        leagueAvgPace,
        homeFormPts,
        awayFormPts,
        injuryImpactDiff: 0,
      });

      const label = hs > as ? 1 : 0;
      samples.push({ features, label });

      h.scored += hs;
      h.conceded += as;
      h.gp += 1;
      h.formPts += hs > as ? 2 : 0;
      h.formCount = Math.min(h.formCount + 1, 5);

      a.scored += as;
      a.conceded += hs;
      a.gp += 1;
      a.formPts += as > hs ? 2 : 0;
      a.formCount = Math.min(a.formCount + 1, 5);

      teamStats.set(hKey, h);
      teamStats.set(aKey, a);

      leagueStats.set(league, {
        totalPts: leagueStat.totalPts + hs + as,
        count: leagueStat.count + 1,
      });
    }

    this.logger.log(`构造了 ${samples.length} 个训练样本`);

    const splitIdx: number = Math.floor(samples.length * 0.8);
    const trainSet: TrainingSample[] = samples.slice(0, splitIdx);
    const testSet: TrainingSample[] = samples.slice(splitIdx);

    const trainX: number[][] = trainSet.map((s: TrainingSample): number[] => s.features);
    const trainY: number[] = trainSet.map((s: TrainingSample): number => s.label);
    const testX: number[][] = testSet.map((s: TrainingSample): number[] => s.features);
    const testY: number[] = testSet.map((s: TrainingSample): number => s.label);

    const model: GbdtModelParams = trainBinaryGbdt(trainX, trainY, {
      nEstimators,
      learningRate,
      seed,
    });

    const trainAcc: number = computeAccuracy(trainX, trainY, model);
    const testAcc: number = computeAccuracy(testX, testY, model);

    const featureImportance: number[] = this.calcFeatureImportance(model, 10);

    this.logger.log(`篮球模型训练完成：训练集准确率 ${(trainAcc * 100).toFixed(2)}%，测试集准确率 ${(testAcc * 100).toFixed(2)}%`);

    model.modelSource = 'trained_gbdt_v1';
    model.trainedAt = new Date().toISOString();
    model.trainSamples = trainX.length;
    model.testAccuracy = testAcc;

    return {
      model,
      trainSize: trainX.length,
      testSize: testX.length,
      trainAccuracy: trainAcc,
      testAccuracy: testAcc,
      trainLogLoss: 0,
      testLogLoss: 0,
      featureImportance,
      featureNames: [],
    };
  }

  private calcFeatureImportance(model: GbdtModelParams, nFeatures: number): number[] {
    const importance: number[] = new Array(nFeatures).fill(0);
    for (const tree of model.trees) {
      const gain: number = Math.abs(tree.leftValue) + Math.abs(tree.rightValue);
      importance[tree.featureIndex] = (importance[tree.featureIndex] ?? 0) + gain;
    }
    const total: number = importance.reduce((acc, v) => acc + v, 0);
    if (total <= 0) return importance.map(() => 1 / nFeatures);
    return importance.map((v: number): number => v / total);
  }
}
