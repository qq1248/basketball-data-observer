import { Injectable, Logger } from '@nestjs/common';
import {
  FOOTBALL_FEATURE_NAMES,
  BASKETBALL_FEATURE_NAMES,
} from './feature-engineering.service';

// ====== 固定随机种子 ======
const RANDOM_SEED = 42;

// ====== 足球 GBDT 基线模型参数 ======
const FOOTBALL_N_ESTIMATORS = 50;
const FOOTBALL_LEARNING_RATE = 0.1;
const FOOTBALL_BASELINE_ODDS = 0.5; // 初始正例概率（胜平负第一类）
const FOOTBALL_N_FEATURES = 12;

// ====== 篮球 GBDT 基线模型参数 ======
const BASKETBALL_N_ESTIMATORS = 50;
const BASKETBALL_LEARNING_RATE = 0.1;
const BASKETBALL_BASELINE_ODDS = 0.5;
const BASKETBALL_N_FEATURES = 10;

// ====== 单棵决策树桩参数 ======
export interface TreeStumpParams {
  featureIndex: number;
  threshold: number;
  leftValue: number;  // x[feature] < threshold 时的输出（对数几率增量）
  rightValue: number; // x[feature] >= threshold 时的输出
}

// ====== GBDT 模型完整参数 ======
export interface GbdtModelParams {
  nEstimators: number;
  learningRate: number;
  baselineLogOdds: number;  // F_0 = log(positive/negative)
  trees: TreeStumpParams[];
  nClasses?: number;        // 多分类时类别数（默认 2，二分类）
  modelSource?: 'baseline_stump' | 'trained_gbdt_v1';
  trainedAt?: string;
  trainSamples?: number;
  testAccuracy?: number;
}

// ====== 可重现伪随机数生成器（Mulberry32，种子 42）======
function createSeededRandom(seed: number): () => number {
  let state: number = seed >>> 0;
  return function (): number {
    state = (state + 0x6D2B79F5) >>> 0;
    let t: number = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ====== sigmoid 函数 ======
function sigmoid(x: number): number {
  if (x >= 0) {
    const z: number = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z: number = Math.exp(x);
  return z / (1 + z);
}

// ====== softmax 函数 ======
function softmax(logits: number[]): number[] {
  if (logits.length === 0) return [];
  const maxLogit: number = Math.max(...logits);
  const exps: number[] = logits.map((l: number): number => Math.exp(l - maxLogit));
  const sumExp: number = exps.reduce((acc: number, e: number): number => acc + e, 0);
  if (sumExp <= 0) return logits.map((): number => 1 / logits.length);
  return exps.map((e: number): number => e / sumExp);
}

// ====== 生成基线模型（等权重随机特征分裂的树桩集合）======
function generateBaselineTrees(
  nEstimators: number,
  nFeatures: number,
  seed: number,
): TreeStumpParams[] {
  const rand: () => number = createSeededRandom(seed);
  const trees: TreeStumpParams[] = [];

  for (let i: number = 0; i < nEstimators; i++) {
    const featureIndex: number = Math.floor(rand() * nFeatures);
    // 阈值在 [-1, 1] 之间均匀分布（特征已 z-score 标准化）
    const threshold: number = rand() * 2 - 1;
    // 左右叶输出：初始等权重，每棵树贡献很小（近似均匀特征重要性）
    const leafMagnitude: number = 0.02;
    // 随机方向，确保正负样本覆盖
    const direction: number = rand() > 0.5 ? 1 : -1;
    const leftValue: number = -leafMagnitude * direction;
    const rightValue: number = leafMagnitude * direction;

    trees.push({ featureIndex, threshold, leftValue, rightValue });
  }

  return trees;
}

// ====== GbdtModel 类 ======
export class GbdtModel {
  private readonly nEstimators: number;
  private readonly learningRate: number;
  private readonly baselineLogOdds: number;
  private readonly trees: TreeStumpParams[];
  private readonly nClasses: number;
  private readonly modelSource: string;
  private readonly trainedAt?: string;
  private readonly trainSamples?: number;
  private readonly testAccuracy?: number;

  constructor(params: GbdtModelParams) {
    this.nEstimators = params.nEstimators;
    this.learningRate = params.learningRate;
    this.baselineLogOdds = params.baselineLogOdds;
    this.trees = params.trees;
    this.nClasses = params.nClasses ?? 2;
    this.modelSource = params.modelSource ?? 'unknown';
    this.trainedAt = params.trainedAt;
    this.trainSamples = params.trainSamples;
    this.testAccuracy = params.testAccuracy;
  }

  // ====== 训练接口（声明占位，运行时只加载预训练参数）======
  // 实际训练由离线训练脚本完成，运行时不执行
  fit(_X: number[][], _y: number[], _sampleWeights?: number[]): void {
    throw new Error(
      'GbdtModel.fit() 仅用于离线训练脚本，运行时禁止调用。请通过 load*Model 加载预训练参数。'
    );
  }

  // ====== 单样本预测概率（二分类，sigmoid 输出 0-1）======
  predict(X: number[]): number {
    let logOdds: number = this.baselineLogOdds;

    for (let i: number = 0; i < this.trees.length; i++) {
      const tree: TreeStumpParams = this.trees[i];
      const featureVal: number = X[tree.featureIndex] ?? 0;
      const leafValue: number =
        featureVal < tree.threshold ? tree.leftValue : tree.rightValue;
      logOdds += this.learningRate * leafValue;
    }

    return sigmoid(logOdds);
  }

  getInfo(): {
    modelSource: string;
    nEstimators: number;
    nClasses: number;
    trainedAt?: string;
    trainSamples?: number;
    testAccuracy?: number;
  } {
    return {
      modelSource: this.modelSource,
      nEstimators: this.nEstimators,
      nClasses: this.nClasses,
      trainedAt: this.trainedAt,
      trainSamples: this.trainSamples,
      testAccuracy: this.testAccuracy,
    };
  }

  // ====== 多分类预测（softmax 输出）======
  predictMulti(X: number[]): number[] {
    if (this.nClasses <= 2) {
      const prob: number = this.predict(X);
      return [1 - prob, prob];
    }

    const logits: number[] = new Array(this.nClasses).fill(0);
    const treesPerClass: number = Math.floor(this.trees.length / this.nClasses);

    for (let c: number = 0; c < this.nClasses; c++) {
      let logit: number = this.baselineLogOdds;
      const startIdx: number = c * treesPerClass;
      const endIdx: number = Math.min(startIdx + treesPerClass, this.trees.length);

      for (let i: number = startIdx; i < endIdx; i++) {
        const tree: TreeStumpParams = this.trees[i];
        const featureVal: number = X[tree.featureIndex] ?? 0;
        const leafValue: number =
          featureVal < tree.threshold ? tree.leftValue : tree.rightValue;
        logit += this.learningRate * leafValue;
      }
      logits[c] = logit;
    }

    return softmax(logits);
  }

  // ====== 获取特征重要性（基于每棵树的分裂次数 + 叶输出绝对值）======
  getFeatureImportance(nFeatures: number): number[] {
    const importance: number[] = new Array(nFeatures).fill(0);

    for (const tree of this.trees) {
      const gain: number = Math.abs(tree.leftValue) + Math.abs(tree.rightValue);
      importance[tree.featureIndex] = (importance[tree.featureIndex] ?? 0) + gain;
    }

    const total: number = importance.reduce(
      (acc: number, v: number): number => acc + v,
      0
    );
    if (total <= 0) return importance.map((): number => 1 / nFeatures);
    return importance.map((v: number): number => v / total);
  }
}

@Injectable()
export class GbdtService {
  private readonly logger = new Logger(GbdtService.name);
  private footballModel: GbdtModel;
  private basketballModel: GbdtModel;

  constructor() {
    this.footballModel = this.createFootballBaselineModel();
    this.basketballModel = this.createBasketballBaselineModel();
  }

  // ====== 加载足球模型（可替换为训练后的真实参数）======
  loadFootballModel(params: GbdtModelParams): GbdtModel {
    return new GbdtModel(params);
  }

  // ====== 加载篮球模型 ======
  loadBasketballModel(params: GbdtModelParams): GbdtModel {
    return new GbdtModel(params);
  }

  // ====== 获取默认足球模型实例 ======
  getFootballModel(): GbdtModel {
    return this.footballModel;
  }

  // ====== 替换足球模型（训练后调用）======
  setFootballModel(model: GbdtModel): void {
    this.footballModel = model;
  }

  // ====== 获取默认篮球模型实例 ======
  getBasketballModel(): GbdtModel {
    return this.basketballModel;
  }

  // ====== 替换篮球模型（训练后调用）======
  setBasketballModel(model: GbdtModel): void {
    this.basketballModel = model;
  }

  // ====== 获取足球模型元信息 ======
  getFootballModelInfo(): ReturnType<GbdtModel['getInfo']> {
    return this.footballModel.getInfo();
  }

  // ====== 获取篮球模型元信息 ======
  getBasketballModelInfo(): ReturnType<GbdtModel['getInfo']> {
    return this.basketballModel.getInfo();
  }

  // ====== 足球特征名 ======
  getFootballFeatureNames(): string[] {
    return [...FOOTBALL_FEATURE_NAMES];
  }

  // ====== 篮球特征名 ======
  getBasketballFeatureNames(): string[] {
    return [...BASKETBALL_FEATURE_NAMES];
  }

  // ====== 创建足球基线模型（种子 42 的等权重树桩）======
  private createFootballBaselineModel(): GbdtModel {
    const trees: TreeStumpParams[] = generateBaselineTrees(
      FOOTBALL_N_ESTIMATORS,
      FOOTBALL_N_FEATURES,
      RANDOM_SEED,
    );
    const baselineLogOdds: number = Math.log(
      FOOTBALL_BASELINE_ODDS / Math.max(1 - FOOTBALL_BASELINE_ODDS, 1e-10)
    );
    return new GbdtModel({
      nEstimators: FOOTBALL_N_ESTIMATORS,
      learningRate: FOOTBALL_LEARNING_RATE,
      baselineLogOdds,
      trees,
      nClasses: 3, // 胜平负 3 分类
      modelSource: 'baseline_stump',
    });
  }

  // ====== 创建篮球基线模型（种子 42 的等权重树桩）======
  private createBasketballBaselineModel(): GbdtModel {
    // 用不同子种子区分足球和篮球的树结构
    const trees: TreeStumpParams[] = generateBaselineTrees(
      BASKETBALL_N_ESTIMATORS,
      BASKETBALL_N_FEATURES,
      RANDOM_SEED + 1,
    );
    const baselineLogOdds: number = Math.log(
      BASKETBALL_BASELINE_ODDS / Math.max(1 - BASKETBALL_BASELINE_ODDS, 1e-10)
    );
    return new GbdtModel({
      nEstimators: BASKETBALL_N_ESTIMATORS,
      learningRate: BASKETBALL_LEARNING_RATE,
      baselineLogOdds,
      trees,
      modelSource: 'baseline_stump',
      nClasses: 2,
    });
  }
}
