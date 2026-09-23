import fs from 'fs';
import path from 'path';
import { FEATURE_COUNT } from './featureExtractor';
import { logger } from '../utils/logger';

const MODEL_DIR = path.join(process.cwd(), 'models');
const MODEL_PATH = path.join(MODEL_DIR, 'sgd_model.json');

interface ModelState {
  weights: number[];
  bias: number;
  nTrades: number;
  mean: number[];
  m2: number[];
}

function emptyState(): ModelState {
  return {
    weights: Array(FEATURE_COUNT).fill(0),
    bias: 0,
    nTrades: 0,
    mean: Array(FEATURE_COUNT).fill(0),
    m2: Array(FEATURE_COUNT).fill(0),
  };
}

/**
 * Online logistic SGD — TypeScript stand-in for sklearn SGDClassifier(log_loss).
 * Updates on every closed trade (APEX-3: "not Claude text notes").
 */
export class ApexLearner {
  private state: ModelState;
  learningRate = 0.01;

  constructor() {
    this.state = this.load();
  }

  private load(): ModelState {
    try {
      if (fs.existsSync(MODEL_PATH)) {
        return JSON.parse(fs.readFileSync(MODEL_PATH, 'utf-8'));
      }
    } catch (err) {
      logger.warn('ApexLearner: could not load model, starting fresh', { err });
    }
    return emptyState();
  }

  save(): void {
    try {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
      fs.writeFileSync(MODEL_PATH, JSON.stringify(this.state));
    } catch (err) {
      logger.warn('ApexLearner: save failed', { err });
    }
  }

  private scale(features: number[]): number[] {
    const n = this.state.nTrades;
    return features.map((x, i) => {
      if (n < 2) return x;
      const variance = this.state.m2[i] / (n - 1);
      const std = Math.sqrt(Math.max(variance, 1e-8));
      return (x - this.state.mean[i]) / std;
    });
  }

  private updateScaler(features: number[]): void {
    this.state.nTrades += 1;
    const n = this.state.nTrades;
    for (let i = 0; i < FEATURE_COUNT; i++) {
      const x = features[i] || 0;
      const delta = x - this.state.mean[i];
      this.state.mean[i] += delta / n;
      const delta2 = x - this.state.mean[i];
      this.state.m2[i] += delta * delta2;
    }
  }

  predictWinProbability(features: number[]): number {
    const x = this.scale(features);
    let z = this.state.bias;
    for (let i = 0; i < FEATURE_COUNT; i++) z += (this.state.weights[i] || 0) * (x[i] || 0);
    const p = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
    if (this.state.nTrades < 5) return 0.5;
    return p;
  }

  learnFromTrade(features: number[], outcome: 0 | 1): number {
    this.updateScaler(features);
    const x = this.scale(features);
    const p = this.predictWinProbability(features);
    const err = p - outcome;
    for (let i = 0; i < FEATURE_COUNT; i++) {
      this.state.weights[i] -= this.learningRate * err * (x[i] || 0);
    }
    this.state.bias -= this.learningRate * err;
    if (this.state.nTrades % 10 === 0) this.save();
    return p;
  }

  get nTrades(): number {
    return this.state.nTrades;
  }
}

let singleton: ApexLearner | null = null;
export function getApexLearner(): ApexLearner {
  if (!singleton) singleton = new ApexLearner();
  return singleton;
}
