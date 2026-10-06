import { secUserAgent } from '../utils/secUserAgent';
import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

export interface SecFilingItem {
  accessionNumber: string;
  cik: string;
  ticker?: string;
  formType: '8-K' | '10-K' | '10-Q' | '4' | '13D' | '13G' | string;
  filingDate: string;
  reportDate?: string;
  acceptanceDateTime: string;
  description: string;
  primaryDocUrl: string;
  materialityScore: number;
}

class SecEdgarService {
  private userAgent = secUserAgent();
  private lastRequestTime = 0;
  private minIntervalMs = 110; // Capped strictly to <= 9 requests/second (SEC limit is 10/sec)
  private cikToTickerMap = new Map<string, string>();
  private tickerToCikMap = new Map<string, string>();
  private filingCache = new Map<string, SecFilingItem[]>();
  private processedAccessions = new Set<string>();
  public parserVersion = 'sec-parser-v2.1';

  constructor() {
    this.hydrateTickers();
  }

  private async rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Hydrates the authoritative CIK to ticker map from SEC EDGAR
   */
  async hydrateTickers(): Promise<void> {
    try {
      await this.rateLimit();
      const response = await axios.get('https://www.sec.gov/files/company_tickers.json', {
        headers: { 'User-Agent': this.userAgent },
        timeout: 15000,
      });

      if (response.data && typeof response.data === 'object') {
        const list = Object.values(response.data) as any[];
        for (const item of list) {
          const cik = String(item.cik_str).padStart(10, '0');
          const ticker = String(item.ticker).trim().toUpperCase();
          this.cikToTickerMap.set(cik, ticker);
          this.tickerToCikMap.set(ticker, cik);
        }
        logger.info(`🏛️ SEC EDGAR registry loaded: ${this.cikToTickerMap.size} company CIK mappings.`);
      }
    } catch (err: any) {
      logger.warn('Failed to load SEC EDGAR company tickers', { error: err.message });
    }
  }

  getCikForTicker(ticker: string): string | undefined {
    return this.tickerToCikMap.get(ticker.toUpperCase());
  }

  getTickerForCik(cik: string): string | undefined {
    return this.cikToTickerMap.get(cik.padStart(10, '0'));
  }

  /**
   * Fetch recent company submissions and material filings (8-K, Form 4, 13D)
   */
  async getRecentFilings(symbol: string): Promise<SecFilingItem[]> {
    const cleanSym = symbol.toUpperCase().trim();
    if (this.filingCache.has(cleanSym)) {
      return this.filingCache.get(cleanSym)!;
    }

    const cik = this.getCikForTicker(cleanSym);
    if (!cik) {
      logger.warn(`No SEC CIK found for symbol ${cleanSym}`);
      return [];
    }

    try {
      await this.rateLimit();
      const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': this.userAgent },
        timeout: 12000,
      });

      const data = response.data;
      const recent = data?.filings?.recent;
      if (!recent || !Array.isArray(recent.accessionNumber)) {
        return [];
      }

      const count = Math.min(recent.accessionNumber.length, 30);
      const items: SecFilingItem[] = [];

      for (let i = 0; i < count; i++) {
        const formType = recent.form[i];
        const accession = recent.accessionNumber[i];
        const filingDate = recent.filingDate[i];
        const acceptanceDateTime = recent.acceptanceDateTime[i] || filingDate;
        const primaryDoc = recent.primaryDocument[i];
        const primaryDocDesc = recent.primaryDocDescription[i] || `${formType} Filing`;

        // Calculate material impact score based on filing type
        let materialityScore = 0.5;
        if (formType === '8-K') materialityScore = 0.85; // Unscheduled material corporate event
        else if (formType === '4') materialityScore = 0.70; // Insider transaction
        else if (formType.includes('13D')) materialityScore = 0.90; // Activist stake > 5%
        else if (formType === '10-K' || formType === '10-Q') materialityScore = 0.75;

        const filingItem: SecFilingItem = {
          accessionNumber: accession,
          cik,
          ticker: cleanSym,
          formType,
          filingDate,
          acceptanceDateTime,
          description: primaryDocDesc,
          primaryDocUrl: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accession.replace(/-/g, '')}/${primaryDoc}`,
          materialityScore
        };

        items.push(filingItem);

        // Store into authentic Event Intelligence table if not already seen
        if (!this.processedAccessions.has(accession)) {
          this.processedAccessions.add(accession);
          await prisma.eventIntelligence.create({
            data: {
              provider: 'SEC_EDGAR',
              originalId: accession,
              url: filingItem.primaryDocUrl,
              publishedAt: new Date(acceptanceDateTime),
              symbols: [cleanSym],
              headline: `SEC Form ${formType} Filed by ${cleanSym}: ${primaryDocDesc}`,
              normalizedText: `Filing ${formType} for CIK ${cik} on ${filingDate}`,
              duplicateGroup: `${cleanSym}-${formType}-${filingDate}`,
              sentimentModel: 'SEC_RULE_CLASSIFIER_V1',
              modelVersion: this.parserVersion,
              sentimentScore: formType.includes('13D') ? 0.65 : 0.0,
              relevanceScore: materialityScore,
              noveltyScore: 1.0,
              eventClassification: formType === '8-K' ? 'MATERIAL_CORPORATE_EVENT' : (formType === '4' ? 'INSIDER_FILING' : 'SEC_FILING'),
              confidence: 0.95,
              isScheduled: formType === '10-K' || formType === '10-Q',
              licensingStatus: 'VERIFIED_PUBLIC',
              evidenceStatus: 'VERIFIED'
            }
          }).catch(() => {});
        }
      }

      this.filingCache.set(cleanSym, items);
      return items;
    } catch (err: any) {
      logger.warn(`Failed to fetch SEC filings for ${cleanSym}`, { error: err.message });
      return [];
    }
  }
}

export const secEdgarService = new SecEdgarService();
