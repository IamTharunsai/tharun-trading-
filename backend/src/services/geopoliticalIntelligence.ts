/**
 * GEOPOLITICAL & MACRO INTELLIGENCE SERVICE
 * Tracks global events, policy changes, geopolitical shifts
 * Feeds real-time risk assessments to all agents
 */

import axios from 'axios';
import { logger } from '../utils/logger';
import { redis } from '../utils/redis';
import { prisma } from '../utils/prisma';

export interface GeopoliticalEvent {
  id: string;
  title: string;
  description: string;
  type: 'sanctions' | 'regulation' | 'war' | 'election' | 'trade' | 'policy' | 'natural_disaster';
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedCountries: string[];
  affectedMarkets: string[]; // 'crypto', 'stocks', 'forex', etc
  impactAssets: string[]; // 'BTC', 'NVDA', 'EUR/USD', etc
  timestamp: Date;
  investmentHorizon: 'immediate' | '1_week' | '1_month' | '3_months'; // How long this affects markets
  marketImpact: 'negative' | 'positive' | 'mixed';
}

export interface MacroIndicator {
  name: string;
  value: number;
  previousValue: number;
  forecast: number;
  unit: string;
  importance: 'low' | 'medium' | 'high' | 'critical';
  direction: 'up' | 'down' | 'neutral';
  lastUpdate: Date;
  nextUpdate: Date;
}

export interface RiskAssessment {
  timestamp: Date;
  overallRisk: number; // 0-100 (0=safest, 100=most dangerous)
  geoRisk:  number;
  policyRisk: number;
  marketRisk: number;
  activeEvents: GeopoliticalEvent[];
  recommendations: string[];
  tradingModeAdvice: 'aggressive' | 'balanced' | 'conservative' | 'hibernation';
}

const CACHE_TTL = 3600; // 1 hour for static data
const EVENT_CHECK_TTL = 600; // 10 minutes for fresh event checks

/**
 * Monitor geopolitical events from multiple sources
 */
export async function monitorGeopoliticalEvents(): Promise<GeopoliticalEvent[]> {
  try {
    const cacheKey = 'geopolitical:events';
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const events: GeopoliticalEvent[] = [];

    // Check major news sources for geopolitical events
    try {
      const newsResponse = await axios.get('https://api.example.com/news/geo', {
        params: { limit: 50, category: 'geopolitics' },
        timeout: 5000
      }).catch(() => null);

      if (newsResponse?.data?.articles) {
        newsResponse.data.articles.forEach((article: any) => {
          const event = parseGeopoliticalEvent(article);
          if (event) events.push(event);
        });
      }
    } catch (err) {
      logger.warn('Geopolitical news fetch failed', { err });
    }

    // Check economic calendar for policy changes
    try {
      const calendarResponse = await axios.get('https://api.example.com/economic-calendar/policy', {
        timeout: 5000
      }).catch(() => null);

      if (calendarResponse?.data?.events) {
        calendarResponse.data.events.forEach((evt: any) => {
          if (evt.type === 'policy_decision') {
            events.push({
              id: `policy-${evt.id}`,
              title: evt.name,
              description: evt.content,
              type: 'policy',
              severity: evt.importance === 'critical' ? 'critical' : evt.importance === 'high' ? 'high' : 'medium',
              affectedCountries: evt.countries || [],
              affectedMarkets: ['crypto', 'stocks', 'forex'],
              impactAssets: ['BTC', 'USD', 'SPX', 'VIX'],
              timestamp: new Date(evt.date),
              investmentHorizon: evt.impact_duration || '1_month',
              marketImpact: evt.expected_direction === 'up' ? 'positive' : 'negative'
            });
          }
        });
      }
    } catch (err) {
      logger.warn('Economic calendar fetch failed', { err });
    }

    // Deduplicate and sort
    const uniqueEvents = Array.from(
      new Map(events.map(e => [e.id, e])).values()
    ).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    await redis.setex(cacheKey, EVENT_CHECK_TTL, JSON.stringify(uniqueEvents)).catch(() => {});
    return uniqueEvents;
  } catch (err) {
    logger.error('Geopolitical event monitoring failed', { err });
    return [];
  }
}

/**
 * Get current macro economic indicators
 */
export async function getMacroIndicators(): Promise<MacroIndicator[]> {
  try {
    const cacheKey = 'macro:indicators';
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const indicators: MacroIndicator[] = [];

    // Get key indicators from FRED API
    try {
      const fredIndicators = ['DFF', 'CPIAUCSL', 'UNRATE', 'DEXUSEU', 'VIXCLS'];
      
      for (const indicator of fredIndicators) {
        const response = await axios.get(`https://api.stlouisfed.org/fred/series/observations`, {
          params: {
            series_id: indicator,
            api_key: process.env.FRED_API_KEY,
            limit: 2,
            sort_order: 'desc'
          },
          timeout: 5000
        }).catch(() => null);

        if (response?.data?.observations && response.data.observations.length >= 2) {
          const latest = response.data.observations[0];
          const previous = response.data.observations[1];

          indicators.push(
            mapFredIndicator(indicator, latest, previous)
          );
        }
      }
    } catch (err) {
      logger.warn('FRED data fetch failed', { err });
    }

    // Get VIX (volatility index)
    try {
      const vixResponse = await axios.get('https://api.example.com/quote/VIX', {
        timeout: 5000
      }).catch(() => null);

      if (vixResponse?.data) {
        indicators.push({
          name: 'VIX (Volatility Index)',
          value: vixResponse.data.price,
          previousValue: vixResponse.data.previousClose,
          forecast: vixResponse.data.price * 0.95, // Simple estimate
          unit: 'points',
          importance: vixResponse.data.price > 20 ? 'critical' : 'high',
          direction: vixResponse.data.price > vixResponse.data.previousClose ? 'up' : 'down',
          lastUpdate: new Date(),
          nextUpdate: new Date(Date.now() + 86400000) // Next day
        });
      }
    } catch (err) {
      logger.warn('VIX fetch failed', { err });
    }

    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(indicators)).catch(() => {});
    return indicators;
  } catch (err) {
    logger.error('Macro indicators fetch failed', { err });
    return [];
  }
}

/**
 * Build comprehensive geopolitical risk assessment
 */
export async function buildGeoRiskAssessment(): Promise<RiskAssessment> {
  try {
    const events = await monitorGeopoliticalEvents();
    const macroIndicators = await getMacroIndicators();

    // Calculate individual risk components
    const geoRisk = calculateGeoRisk(events);
    const policyRisk = calculatePolicyRisk(events, macroIndicators);
    const marketRisk = calculateMarketRisk(macroIndicators);

    const overallRisk = (geoRisk + policyRisk + marketRisk) / 3;

    const recommendations = generateRecommendations(events, overallRisk);
    const tradingMode = recommendTradingMode(overallRisk, events);

    const assessment: RiskAssessment = {
      timestamp: new Date(),
      overallRisk: Math.round(overallRisk),
      geoRisk: Math.round(geoRisk),
      policyRisk: Math.round(policyRisk),
      marketRisk: Math.round(marketRisk),
      activeEvents: events.filter(e => e.severity === 'critical' || e.severity === 'high'),
      recommendations,
      tradingModeAdvice: tradingMode
    };

    // Log assessment
    await prisma.systemLog.create({
      data: {
        level: 'INFO',
        service: 'geopolitical-assessment',
        message: 'Risk assessment completed',
        metadata: assessment as any
      }
    }).catch(() => {});

    return assessment;
  } catch (err) {
    logger.error('Risk assessment failed', { err });
    return {
      timestamp: new Date(),
      overallRisk: 50,
      geoRisk: 50,
      policyRisk: 50,
      marketRisk: 50,
      activeEvents: [],
      recommendations: ['Unable to assess risk - use caution'],
      tradingModeAdvice: 'conservative'
    };
  }
}

/**
 * Helper: Parse geopolitical event from news article
 */
function parseGeopoliticalEvent(article: any): GeopoliticalEvent | null {
  const title = article.title?.toLowerCase() || '';
  const content = article.content?.toLowerCase() || '';
  const fullText = title + ' ' + content;

  //  Detect event type
  let type: GeopoliticalEvent['type'] = 'trade';
  if (fullText.includes('sanction')) type = 'sanctions';
  else if (fullText.includes('regul')) type = 'regulation';
  else if (fullText.includes('war') || fullText.includes('conflict')) type = 'war';
  else if (fullText.includes('election')) type = 'election';
  else if (fullText.includes('policy')) type = 'policy';
  else if (fullText.includes('disaster') || fullText.includes('hurricane') || fullText.includes('earthquake')) type = 'natural_disaster';

  // Detect severity
  let severity: GeopoliticalEvent['severity'] = 'low';
  if (fullText.includes('critical') || fullText.includes('emergency')) severity = 'critical';
  else if (fullText.includes('major') || fullText.includes('significant')) severity = 'high';
  else if (fullText.includes('minor') || fullText.includes('moderate')) severity = 'medium';

  // Detect affected markets
  const affectedMarkets: string[] = [];
  if (fullText.includes('crypto') || fullText.includes('bitcoin')) affectedMarkets.push('crypto');
  if (fullText.includes('stock') || fullText.includes('market')) affectedMarkets.push('stocks');
  if (fullText.includes('dollar') || fullText.includes('forex')) affectedMarkets.push('forex');

  if (affectedMarkets.length === 0) return null; // Skip if no market impact

  return {
    id: `event-${Date.now()}`,
    title: article.title,
    description: article.description || article.content,
    type,
    severity,
    affectedCountries: extractCountries(fullText),
    affectedMarkets,
    impactAssets: extractAssets(fullText),
    timestamp: new Date(article.publishedAt),
    investmentHorizon: 'immediate',
    marketImpact: fullText.includes('negative') || fullText.includes('decline') ? 'negative' : 'positive'
  };
}

/**
 * Helper: Map FRED indicators to our format
 */
function mapFredIndicator(id: string, latest: any, previous: any): MacroIndicator {
  const names: Record<string, string> = {
    'DFF': 'Federal Funds Rate',
    'CPIAUCSL': 'CPI (Inflation)',
    'UNRATE': 'Unemployment Rate',
    'DEXUSEU': 'USD/EUR Exchange Rate',
    'VIXCLS': 'VIX'
  };

  const value = parseFloat(latest.value);
  const prevValue = parseFloat(previous.value);
  const direction = value > prevValue ? 'up' : value < prevValue ? 'down' : 'neutral';

  return {
    name: names[id] || id,
    value,
    previousValue: prevValue,
    forecast: value, // Would need real forecast data
    unit: id === 'UNRATE' ? '%' : id === 'DEXUSEU' ? 'EUR/USD' : 'bps',
    importance: id === 'DFF' || id === 'CPIAUCSL' ? 'critical' : 'high',
    direction,
    lastUpdate: new Date(latest.date),
    nextUpdate: new Date(Date.now() + 86400000)
  };
}

/**
 * Helper: Calculate geopolitical risk component
 */
function calculateGeoRisk(events: GeopoliticalEvent[]): number {
  if (events.length === 0) return 30; // Baseline

  const criticalEvents = events.filter(e => e.severity === 'critical').length;
  const highEvents = events.filter(e => e.severity === 'high').length;

  let risk = 30 + (criticalEvents * 25) + (highEvents * 10);
  return Math.min(risk, 100);
}

/**
 * Helper: Calculate policy risk component
 */
function calculatePolicyRisk(events: GeopoliticalEvent[], indicators: MacroIndicator[]): number {
  let risk = 30;

  // Policy events increase risk
  const policyEvents = events.filter(e => e.type === 'policy').length;
  risk += policyEvents * 15;

  // Rising rates increase risk
  const fedRates = indicators.find(i => i.name.includes('Federal Funds'));
  if (fedRates && fedRates.direction === 'up') risk += 10;

  // Rising inflation increases risk
  const cpi = indicators.find(i => i.name.includes('Inflation')  );
  if (cpi && cpi.value > 3) risk += 15;

  return Math.min(risk, 100);
}

/**
 * Helper: Calculate market risk from indicators
 */
function calculateMarketRisk(indicators: MacroIndicator[]): number {
  let risk = 30;

  // High VIX = market stress
  const vix = indicators.find(i => i.name === 'VIX');
  if (vix && vix.value > 20) risk += 20;

  // Unemployment changes
  const unemployment = indicators.find(i => i.name.includes('Unemployment'));
  if (unemployment && unemployment.direction === 'up') risk += 10;

  return Math.min(risk, 100);
}

/**
 * Helper: Generate recommendations based on risk
 */
function generateRecommendations(events: GeopoliticalEvent[], risk: number): string[] {
  const recommendations: string[] = [];

  if (risk > 75) {
    recommendations.push('🔴 CRITICAL: Consider hedging or reducing exposure');
    recommendations.push('🔴 Do not initiate new large positions');
  } else if (risk > 60) {
    recommendations.push('🟠 HIGH RISK: Reduce position sizes to 30% normal');
    recommendations.push('🟠 Tighten stop losses to 1-2% instead of 3%');
  } else if (risk > 45) {
    recommendations.push('🟡 MEDIUM RISK: Monitor positions closely');
    recommendations.push('🟡 Be selective - only best-conviction trades');
  } else {
    recommendations.push('🟢 LOW RISK: Normal trading conditions');
    recommendations.push('🟢 All systems operational - trade normally');
  }

  // Add event-specific recommendations
  events
    .filter(e => e.severity === 'critical')
    .forEach(e => {
      recommendations.push(`⚠️ ${e.title}: Affects ${e.impactAssets.join(', ')}`);
    });

  return recommendations;
}

/**
 * Helper: Recommend trading mode based on conditions
 */
function recommendTradingMode(
  risk: number,
  events: GeopoliticalEvent[]
): 'aggressive' | 'balanced' | 'conservative' | 'hibernation' {
  if (risk > 80 || events.some(e => e.severity === 'critical' && e.type === 'war')) {
    return 'hibernation'; // Close positions, minimal trading
  }
  if (risk > 70) {
    return 'conservative'; // Tight stops, small positions
  }
  if (risk > 50) {
    return 'balanced'; // Normal mode
  }
  return 'aggressive'; // Can take larger positions
}

/**
 * Helper: Extract affected countries from text
 */
function extractCountries(text: string): string[] {
  const countries = ['USA', 'China', 'Russia', 'UK', 'EU', 'Japan', 'India'];
  return countries.filter(c => text.includes(c.toLowerCase()));
}

/**
 * Helper: Extract affected assets from text
 */
function extractAssets(text: string): string[] {
  const assets = ['BTC', 'ETH', 'USD', 'EUR', 'GBP', 'CNY', 'SPX', 'VIX', 'GLD', 'OIL'];
  return assets.filter(a => text.includes(a.toUpperCase()));
}

export default {
  monitorGeopoliticalEvents,
  getMacroIndicators,
  buildGeoRiskAssessment
};
