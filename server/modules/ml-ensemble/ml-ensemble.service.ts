import { Injectable } from '@nestjs/common';
import { GbdtService, GbdtModel } from './gbdt.service';
import {
  FeatureEngineeringService,
  FOOTBALL_FEATURE_NAMES,
  BASKETBALL_FEATURE_NAMES,
} from './feature-engineering.service';

// ====== 集成融合配置 ======
export interface EnsembleConfig {
  mlMaxWeight: number;                  // ML 最大权重（默认 0.25）
  mlMinConfidenceThreshold: number;     // ML 置信度低于此值不参与融合
  featureImportanceUpdateInterval: number; // 特征重要性更新间隔（场）
}

// ====== 默认配置 ======
const DEFAULT_ML_MAX_WEIGHT = 0.25;
const DEFAULT_ML_MIN_CONFIDENCE_THRESHOLD = 0.3;
const DEFAULT_FEATURE_IMPORTANCE_INTERVAL = 1000;

// ====== 规则标签 ======
const RULE_TAG = 'R-ML-ENSEMBLE';

// ====== 足球融合输入 ======
export interface FootballProbs {
  homeWin: number;
  draw: number;
  awayWin: number;
}

// ====== 篮球融合输入 ======
export interface BasketballProbs {
  homeWin: number;
  awayWin: number;
}

// ====== 足球融合输出 ======
export interface FootballEnsembleResult {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  mlWeight: number;
  modelRules: string[];
}

// ====== 篮球融合输出 ======
export interface BasketballEnsembleResult {
  homeWinProb: number;
  awayWinProb: number;
  mlWeight: number;
  modelRules: string[];
}

// ====== 特征重要性项 ======
export interface FeatureImportanceItem {
  feature: string;
  importance: number;
}

@Injectable()
export class MlEnsembleService {
  private readonly defaultConfig: EnsembleConfig;
  private readonly gbdtService: GbdtService;
  private readonly featureEngineeringService: FeatureEngineeringService;

  constructor(
    gbdtService: GbdtService,
    featureEngineeringService: FeatureEngineeringService,
  ) {
    this.gbdtService = gbdtService;
    this.featureEngineeringService = featureEngineeringService;
    this.defaultConfig = {
      mlMaxWeight: DEFAULT_ML_MAX_WEIGHT,
      mlMinConfidenceThreshold: DEFAULT_ML_MIN_CONFIDENCE_THRESHOLD,
      featureImportanceUpdateInterval: DEFAULT_FEATURE_IMPORTANCE_INTERVAL,
    };
  }

  // ====== 足球概率融合（胜平负 3 分类）======
  ensembleFootballPrediction(
    baseProbs: FootballProbs,
    mlProbs: FootballProbs,
    mlConfidence: number,
    config?: Partial<EnsembleConfig>,
  ): FootballEnsembleResult {
    const cfg: EnsembleConfig = { ...this.defaultConfig, ...config };
    const modelRules: string[] = [];

    // 计算 ML 实际权重：置信度 × 最大权重
    const effectiveConfidence: number = Math.max(0, Math.min(1, mlConfidence));
    let mlWeight: number = 0;

    if (effectiveConfidence >= cfg.mlMinConfidenceThreshold) {
      mlWeight = effectiveConfidence * cfg.mlMaxWeight;
      mlWeight = Math.min(mlWeight, cfg.mlMaxWeight);
      modelRules.push(
        `${RULE_TAG}: ML融合权重=${(mlWeight * 100).toFixed(1)}%` +
        `（置信度${(effectiveConfidence * 100).toFixed(1)}% × 最大权重${(cfg.mlMaxWeight * 100).toFixed(0)}%）`
      );
    } else {
      modelRules.push(
        `${RULE_TAG}: ML置信度${(effectiveConfidence * 100).toFixed(1)}%` +
        `低于阈值${(cfg.mlMinConfidenceThreshold * 100).toFixed(0)}%，不参与融合`
      );
    }

    const baseWeight: number = 1 - mlWeight;

    // 加权融合
    let homeWinProb: number = baseProbs.homeWin * baseWeight + mlProbs.homeWin * mlWeight;
    let drawProb: number = baseProbs.draw * baseWeight + mlProbs.draw * mlWeight;
    let awayWinProb: number = baseProbs.awayWin * baseWeight + mlProbs.awayWin * mlWeight;

    // 归一化保证和为 1
    const total: number = homeWinProb + drawProb + awayWinProb;
    if (total > 0) {
      homeWinProb = homeWinProb / total;
      drawProb = drawProb / total;
      awayWinProb = awayWinProb / total;
    } else {
      // 安全兜底：等概率
      homeWinProb = 1 / 3;
      drawProb = 1 / 3;
      awayWinProb = 1 / 3;
    }

    if (mlWeight > 0) {
      const maxShift: number = Math.max(
        Math.abs(homeWinProb - baseProbs.homeWin),
        Math.abs(drawProb - baseProbs.draw),
        Math.abs(awayWinProb - baseProbs.awayWin),
      );
      modelRules.push(
        `${RULE_TAG}: 融合后概率最大偏移=${(maxShift * 100).toFixed(2)}个百分点`
      );
    }

    return {
      homeWinProb,
      drawProb,
      awayWinProb,
      mlWeight,
      modelRules,
    };
  }

  // ====== 篮球概率融合（主胜/客胜 二分类）======
  ensembleBasketballPrediction(
    baseProbs: BasketballProbs,
    mlProbs: BasketballProbs,
    mlConfidence: number,
    config?: Partial<EnsembleConfig>,
  ): BasketballEnsembleResult {
    const cfg: EnsembleConfig = { ...this.defaultConfig, ...config };
    const modelRules: string[] = [];

    const effectiveConfidence: number = Math.max(0, Math.min(1, mlConfidence));
    let mlWeight: number = 0;

    if (effectiveConfidence >= cfg.mlMinConfidenceThreshold) {
      mlWeight = effectiveConfidence * cfg.mlMaxWeight;
      mlWeight = Math.min(mlWeight, cfg.mlMaxWeight);
      modelRules.push(
        `${RULE_TAG}: ML融合权重=${(mlWeight * 100).toFixed(1)}%` +
        `（置信度${(effectiveConfidence * 100).toFixed(1)}% × 最大权重${(cfg.mlMaxWeight * 100).toFixed(0)}%）`
      );
    } else {
      modelRules.push(
        `${RULE_TAG}: ML置信度${(effectiveConfidence * 100).toFixed(1)}%` +
        `低于阈值${(cfg.mlMinConfidenceThreshold * 100).toFixed(0)}%，不参与融合`
      );
    }

    const baseWeight: number = 1 - mlWeight;

    let homeWinProb: number = baseProbs.homeWin * baseWeight + mlProbs.homeWin * mlWeight;
    let awayWinProb: number = baseProbs.awayWin * baseWeight + mlProbs.awayWin * mlWeight;

    // 归一化
    const total: number = homeWinProb + awayWinProb;
    if (total > 0) {
      homeWinProb = homeWinProb / total;
      awayWinProb = awayWinProb / total;
    } else {
      homeWinProb = 0.5;
      awayWinProb = 0.5;
    }

    if (mlWeight > 0) {
      const maxShift: number = Math.max(
        Math.abs(homeWinProb - baseProbs.homeWin),
        Math.abs(awayWinProb - baseProbs.awayWin),
      );
      modelRules.push(
        `${RULE_TAG}: 融合后主胜概率偏移=${(maxShift * 100).toFixed(2)}个百分点`
      );
    }

    return {
      homeWinProb,
      awayWinProb,
      mlWeight,
      modelRules,
    };
  }

  // ====== 获取特征重要性排序（用于监控展示）======
  getFeatureImportance(sport: 'football' | 'basketball'): FeatureImportanceItem[] {
    const model: GbdtModel = sport === 'football'
      ? this.gbdtService.getFootballModel()
      : this.gbdtService.getBasketballModel();

    const featureNames: string[] = sport === 'football'
      ? FOOTBALL_FEATURE_NAMES
      : BASKETBALL_FEATURE_NAMES;

    const importanceValues: number[] = model.getFeatureImportance(featureNames.length);

    const result: FeatureImportanceItem[] = featureNames.map(
      (name: string, idx: number): FeatureImportanceItem => ({
        feature: name,
        importance: importanceValues[idx] ?? 0,
      })
    );

    // 按重要性降序排列
    result.sort((a: FeatureImportanceItem, b: FeatureImportanceItem): number =>
      b.importance - a.importance
    );

    return result;
  }

  // ====== 通过特征向量直接计算 ML 置信度 ======
  // 基于预测概率与 0.5 的偏离度（越极端越有信心）
  computeMlConfidence(predictedProb: number): number {
    // 0.5 附近 → 低置信度；接近 0 或 1 → 高置信度
    const deviation: number = Math.abs(predictedProb - 0.5) * 2;
    return Math.max(0, Math.min(1, deviation));
  }

  // ====== 足球多分类置信度（最高概率 - 次高概率）======
  computeFootballMlConfidence(probs: FootballProbs): number {
    const sorted: number[] = [probs.homeWin, probs.draw, probs.awayWin]
      .sort((a: number, b: number): number => b - a);
    const gap: number = sorted[0] - sorted[1];
    // 差距 0 → 置信度 0；差距 0.33+ → 置信度 1
    return Math.max(0, Math.min(1, gap * 3));
  }
}
