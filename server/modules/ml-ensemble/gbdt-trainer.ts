import { TreeStumpParams, GbdtModelParams } from './gbdt.service';

function sigmoid(x: number): number {
  if (x >= 0) {
    const z: number = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z: number = Math.exp(x);
  return z / (1 + z);
}

export interface TrainOptions {
  nEstimators: number;
  learningRate: number;
  seed?: number;
  nClasses?: number;
  subsample?: number;
}

function computeBaselineLogOdds(y: number[]): number {
  const pos: number = y.reduce((s: number, v: number): number => s + v, 0);
  const neg: number = y.length - pos;
  const p: number = (pos + 1) / (pos + neg + 2);
  return Math.log(p / (1 - p));
}

function computeGradientsAndHessians(
  preds: number[],
  y: number[],
): { grad: number[]; hess: number[] } {
  const n: number = y.length;
  const grad: number[] = new Array(n);
  const hess: number[] = new Array(n);
  for (let i: number = 0; i < n; i++) {
    const p: number = sigmoid(preds[i]);
    grad[i] = p - y[i];
    hess[i] = Math.max(p * (1 - p), 1e-16);
  }
  return { grad, hess };
}

function fitStump(
  X: number[][],
  grad: number[],
  hess: number[],
  sampleIdx: number[],
): TreeStumpParams {
  const nSamples: number = sampleIdx.length;
  const nFeatures: number = X[0]?.length ?? 0;
  if (nSamples === 0 || nFeatures === 0) {
    return { featureIndex: 0, threshold: 0, leftValue: 0, rightValue: 0 };
  }

  let bestGain: number = 0;
  let bestFeature: number = 0;
  let bestThreshold: number = 0;
  let bestLeftVal: number = 0;
  let bestRightVal: number = 0;

  const totalGrad: number = sampleIdx.reduce((s: number, i: number): number => s + grad[i], 0);
  const totalHess: number = sampleIdx.reduce((s: number, i: number): number => s + hess[i], 0);

  for (let f: number = 0; f < nFeatures; f++) {
    const indices: number[] = [...sampleIdx].sort(
      (a: number, b: number): number => X[a][f] - X[b][f]
    );

    let leftGrad: number = 0;
    let leftHess: number = 0;

    for (let j: number = 0; j < indices.length - 1; j++) {
      const idx: number = indices[j];
      leftGrad += grad[idx];
      leftHess += hess[idx];
      const rightGrad: number = totalGrad - leftGrad;
      const rightHess: number = totalHess - leftHess;

      if (leftHess < 1e-6 || rightHess < 1e-6) continue;

      const leftVal: number = -leftGrad / leftHess;
      const rightVal: number = -rightGrad / rightHess;
      const gain: number =
        leftGrad * leftVal + rightGrad * rightVal + 0.5 * (leftGrad + rightGrad) * 0;

      const threshold: number = (X[idx][f] + X[indices[j + 1]][f]) / 2;
      if (X[idx][f] === X[indices[j + 1]][f]) continue;

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = threshold;
        bestLeftVal = leftVal;
        bestRightVal = rightVal;
      }
    }
  }

  if (bestGain <= 0) {
    const leafVal: number = totalHess > 0 ? -totalGrad / totalHess : 0;
    return { featureIndex: 0, threshold: 0, leftValue: leafVal, rightValue: leafVal };
  }

  return {
    featureIndex: bestFeature,
    threshold: bestThreshold,
    leftValue: bestLeftVal,
    rightValue: bestRightVal,
  };
}

function applyStump(
  preds: number[],
  tree: TreeStumpParams,
  X: number[][],
  lr: number,
): void {
  for (let i: number = 0; i < preds.length; i++) {
    const val: number =
      X[i][tree.featureIndex] < tree.threshold ? tree.leftValue : tree.rightValue;
    preds[i] += lr * val;
  }
}

export function trainBinaryGbdt(
  X: number[][],
  y: number[],
  options: TrainOptions,
): GbdtModelParams {
  const nEstimators: number = options.nEstimators;
  const lr: number = options.learningRate;
  const subsample: number = options.subsample ?? 1.0;
  const n: number = X.length;
  const baselineLogOdds: number = computeBaselineLogOdds(y);

  const preds: number[] = new Array(n).fill(baselineLogOdds);
  const trees: TreeStumpParams[] = [];

  let sampleIdx: number[] = [];
  const allIdx: number[] = Array.from({ length: n }, (_: unknown, i: number): number => i);

  for (let t: number = 0; t < nEstimators; t++) {
    if (subsample < 1.0) {
      sampleIdx = allIdx.filter(() => Math.random() < subsample);
      if (sampleIdx.length < 5) sampleIdx = allIdx;
    } else {
      sampleIdx = allIdx;
    }

    const { grad, hess } = computeGradientsAndHessians(preds, y);
    const tree: TreeStumpParams = fitStump(X, grad, hess, sampleIdx);
    trees.push(tree);
    applyStump(preds, tree, X, lr);
  }

  return {
    nEstimators,
    learningRate: lr,
    baselineLogOdds,
    trees,
    nClasses: 2,
  };
}

export function computeLogLoss(X: number[][], y: number[], model: GbdtModelParams): number {
  const gbdt: { predict: (x: number[]) => number } = {
    predict(x: number[]): number {
      let logOdds: number = model.baselineLogOdds;
      for (const tree of model.trees) {
        const v: number = x[tree.featureIndex] < tree.threshold ? tree.leftValue : tree.rightValue;
        logOdds += model.learningRate * v;
      }
      return sigmoid(logOdds);
    }
  };
  let loss: number = 0;
  for (let i: number = 0; i < X.length; i++) {
    const p: number = gbdt.predict(X[i]);
    const yt: number = y[i];
    loss += -(yt * Math.log(Math.max(p, 1e-15)) + (1 - yt) * Math.log(Math.max(1 - p, 1e-15)));
  }
  return loss / X.length;
}

export function computeAccuracy(X: number[][], y: number[], model: GbdtModelParams): number {
  const gbdt: { predict: (x: number[]) => number } = {
    predict(x: number[]): number {
      let logOdds: number = model.baselineLogOdds;
      for (const tree of model.trees) {
        const v: number = x[tree.featureIndex] < tree.threshold ? tree.leftValue : tree.rightValue;
        logOdds += model.learningRate * v;
      }
      return sigmoid(logOdds);
    }
  };
  let correct: number = 0;
  for (let i: number = 0; i < X.length; i++) {
    const p: number = gbdt.predict(X[i]);
    const pred: number = p >= 0.5 ? 1 : 0;
    if (pred === y[i]) correct++;
  }
  return correct / X.length;
}
