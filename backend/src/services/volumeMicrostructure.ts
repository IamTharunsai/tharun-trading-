export type VolumeRegime = 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';

export function classifyVolumeMicrostructure(input: {
  price: number;
  vwap: number;
  volumeRatio: number;
  priceChangePct: number;
  obvSlope: number;
  makingNewHighs: boolean;
}): { regime: VolumeRegime; score: number; reason: string } {
  const aboveVwap = input.price > input.vwap;
  if (aboveVwap && input.volumeRatio > 1.2 && input.priceChangePct > 0) {
    return { regime: 'ACCUMULATION', score: 0.75, reason: 'Price above VWAP on above-average volume' };
  }
  if (input.makingNewHighs && input.obvSlope <= 0) {
    return { regime: 'DISTRIBUTION', score: 0.8, reason: 'Price new highs, OBV not confirming' };
  }
  if (input.priceChangePct > 0 && input.volumeRatio < 0.3) {
    return { regime: 'DISTRIBUTION', score: 0.65, reason: 'Up-move on 0.3× volume — head fake' };
  }
  if (input.priceChangePct < 0 && input.obvSlope > 0) {
    return { regime: 'ACCUMULATION', score: 0.7, reason: 'Price down, OBV up — quiet buying' };
  }
  return { regime: 'NEUTRAL', score: 0.5, reason: 'No volume edge' };
}
