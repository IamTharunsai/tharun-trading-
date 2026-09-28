import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { secEdgarService } from './secEdgarService';

export interface AuthenticNewsItem {
  id: string;
  provider: string;
  originalId: string;
  url: string;
  publishedAt: string;
  receivedAt: string;
  symbols: string[];
  headline: string;
  normalizedText: string;
  duplicateGroup: string;
  language: string;
  sentimentModel: string;
  modelVersion: string;
  sentimentScore: number;     // -1.0 to +1.0
  relevanceScore: number;     // 0.0 to 1.0
  noveltyScore: number;       // 0.0 to 1.0
  eventClassification: 'MATERIAL_8K' | 'INSIDER_FORM4' | 'ACTIVIST_13D' | 'EARNINGS' | 'CORPORATE_ACTION' | 'HALT' | 'ECONOMIC_CALENDAR' | 'POLYMARKET_EVIDENCE' | 'GENERAL_NEWS';
  confidence: number;
  isScheduled: boolean;
  expiration?: string;
  licensingStatus: string;
  evidenceStatus: 'VERIFIED' | 'INSUFFICIENT_EVIDENCE' | 'CONFLICTING_REPORTS';
}

export class EventIntelligenceService {
  private deduplicationCache = new Map<string, AuthenticNewsItem>();

  /**
   * Ingest an authentic news or filing event with strict deduplication and provenance
   */
  async ingestEvent(event: Omit<AuthenticNewsItem, 'id' | 'receivedAt'>): Promise<AuthenticNewsItem | null> {
    const receivedAt = new Date().toISOString();
    const publishedTime = new Date(event.publishedAt).getTime();
    const ageHours = (Date.now() - publishedTime) / (1000 * 60 * 60);

    // Prevent old news from masquerading as breaking news
    if (ageHours > 72 && event.eventClassification !== 'EARNINGS') {
      logger.info(`Ignored stale news event (> 72 hours old): ${event.headline}`);
      return null;
    }

    // Deduplication key: Normalized headline hash
    const normalizedHeadline = event.headline.toLowerCase().replace(/[^a-z0-9]/g, '');
    const duplicateKey = `${event.duplicateGroup || event.symbols[0] || 'GEN'}-${normalizedHeadline.slice(0, 40)}`;

    if (this.deduplicationCache.has(duplicateKey)) {
      logger.info(`Deduplicated syndicated event: ${event.headline.slice(0, 50)}...`);
      return null;
    }

    const id = `ev-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const fullItem: AuthenticNewsItem = {
      id,
      ...event,
      duplicateGroup: duplicateKey,
      receivedAt
    };

    this.deduplicationCache.set(duplicateKey, fullItem);

    // Persist to SQLite event_intelligence table
    await prisma.eventIntelligence.create({
      data: {
        id,
        provider: event.provider,
        originalId: event.originalId,
        url: event.url,
        publishedAt: new Date(event.publishedAt),
        symbols: event.symbols,
        headline: event.headline,
        normalizedText: event.normalizedText,
        duplicateGroup: duplicateKey,
        language: event.language || 'en',
        sentimentModel: event.sentimentModel || 'RULE_BASED_FINBERT',
        modelVersion: event.modelVersion || '2.0.0',
        sentimentScore: event.sentimentScore,
        relevanceScore: event.relevanceScore,
        noveltyScore: event.noveltyScore,
        eventClassification: event.eventClassification,
        confidence: event.confidence,
        isScheduled: Boolean(event.isScheduled),
        expiration: event.expiration ? new Date(event.expiration) : null,
        licensingStatus: event.licensingStatus || 'VERIFIED_PUBLIC',
        evidenceStatus: event.evidenceStatus
      }
    }).catch((err: any) => {
      logger.warn('Failed to persist event intelligence record', { error: err.message });
    });

    return fullItem;
  }

  /**
   * Ingest recent SEC EDGAR filings for a symbol and convert them to verified intelligence
   */
  async syncSecFilingsForSymbol(symbol: string): Promise<AuthenticNewsItem[]> {
    const filings = await secEdgarService.getRecentFilings(symbol);
    const results: AuthenticNewsItem[] = [];

    for (const f of filings) {
      let classification: AuthenticNewsItem['eventClassification'] = 'GENERAL_NEWS';
      if (f.formType === '8-K') classification = 'MATERIAL_8K';
      else if (f.formType === '4') classification = 'INSIDER_FORM4';
      else if (f.formType.includes('13D')) classification = 'ACTIVIST_13D';

      const item = await this.ingestEvent({
        provider: 'SEC_EDGAR',
        originalId: f.accessionNumber,
        url: f.primaryDocUrl,
        publishedAt: f.acceptanceDateTime,
        symbols: [symbol.toUpperCase()],
        headline: `SEC Form ${f.formType} Submitted by ${symbol}: ${f.description}`,
        normalizedText: f.description,
        duplicateGroup: `${symbol}-${f.formType}-${f.filingDate}`,
        language: 'en',
        sentimentModel: 'SEC_MATERIALITY_V2',
        modelVersion: secEdgarService.parserVersion,
        sentimentScore: f.formType.includes('13D') ? 0.70 : 0.0,
        relevanceScore: f.materialityScore,
        noveltyScore: 1.0,
        eventClassification: classification,
        confidence: 0.95,
        isScheduled: f.formType === '10-K' || f.formType === '10-Q',
        licensingStatus: 'SEC_PUBLIC_RECORDS',
        evidenceStatus: 'VERIFIED'
      });

      if (item) results.push(item);
    }

    return results;
  }

  /**
   * Retrieves verified intelligence for a symbol or returns INSUFFICIENT_EVIDENCE
   */
  async getIntelligenceForSymbol(symbol: string): Promise<{
    status: 'VERIFIED' | 'INSUFFICIENT_EVIDENCE';
    events: AuthenticNewsItem[];
  }> {
    const cleanSym = symbol.toUpperCase().trim();
    const records = await prisma.eventIntelligence.findMany({
      where: { provider: 'SEC_EDGAR' },
      take: 20
    });

    const matching = records.filter((r: any) => {
      const syms = typeof r.symbols === 'string' ? JSON.parse(r.symbols) : r.symbols;
      return Array.isArray(syms) && syms.includes(cleanSym);
    });

    if (matching.length === 0) {
      return {
        status: 'INSUFFICIENT_EVIDENCE',
        events: []
      };
    }

    return {
      status: 'VERIFIED',
      events: matching.map((r: any) => ({
        id: r.id,
        provider: r.provider,
        originalId: r.originalId,
        url: r.url,
        publishedAt: r.publishedAt,
        receivedAt: r.receivedAt,
        symbols: typeof r.symbols === 'string' ? JSON.parse(r.symbols) : r.symbols,
        headline: r.headline,
        normalizedText: r.normalizedText,
        duplicateGroup: r.duplicateGroup,
        language: r.language,
        sentimentModel: r.sentimentModel,
        modelVersion: r.modelVersion,
        sentimentScore: r.sentimentScore,
        relevanceScore: r.relevanceScore,
        noveltyScore: r.noveltyScore,
        eventClassification: r.eventClassification,
        confidence: r.confidence,
        isScheduled: Boolean(r.isScheduled),
        licensingStatus: r.licensingStatus,
        evidenceStatus: r.evidenceStatus
      }))
    };
  }
}

export const eventIntelligenceService = new EventIntelligenceService();
