export function riskDeltaFromTexts(currentRisks: string[], previousRisks: string[]): {
  newRiskCount: number;
  newRisks: string[];
  riskDeltaSignal: 'SHORT' | 'NEUTRAL';
} {
  const prev = previousRisks.map(s => s.toLowerCase().slice(0, 80));
  const isSimilar = (r: string) => prev.some(p => r.toLowerCase().includes(p.slice(0, 40)) || p.includes(r.toLowerCase().slice(0, 40)));
  const newRisks = currentRisks.filter(r => r.trim().length > 20 && !isSimilar(r));
  return {
    newRiskCount: newRisks.length,
    newRisks: newRisks.slice(0, 5),
    riskDeltaSignal: newRisks.length > 3 ? 'SHORT' : 'NEUTRAL',
  };
}

export function parseRiskFactorBullets(text: string): string[] {
  return text
    .split(/\n+/)
    .map(s => s.replace(/^[\d.\-*\s]+/, '').trim())
    .filter(s => s.length > 40);
}
