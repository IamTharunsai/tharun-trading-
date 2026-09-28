import { secUserAgent } from '../utils/secUserAgent';
import axios from 'axios';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import { appConfig } from '../utils/config';

export interface SecurityMasterAsset {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  assetClass: string;
  sector?: string;
  industry?: string;
  price?: number;
  status: 'active' | 'inactive' | 'sec_registered';
  tradable: boolean;
  isSecRegistrant: boolean;
  isAlpacaTradable: boolean;
  executionEligible: boolean;
  marginable: boolean;
  shortable: boolean;
  fractionable: boolean;
  cik?: string;
  lastUpdated: string;
}

export function inferSectorAndIndustry(symbol: string, companyName: string): { sector: string; industry: string } {
  const sym = symbol.toUpperCase();
  const KNOWN_MAP: Record<string, { sector: string; industry: string }> = {
    AAPL: { sector: 'Technology', industry: 'Consumer Electronics' },
    MSFT: { sector: 'Technology', industry: 'Software - Infrastructure' },
    NVDA: { sector: 'Technology', industry: 'Semiconductors' },
    GOOGL: { sector: 'Communication Services', industry: 'Internet Content & Information' },
    GOOG: { sector: 'Communication Services', industry: 'Internet Content & Information' },
    AMZN: { sector: 'Consumer Cyclical', industry: 'Internet Retail' },
    META: { sector: 'Communication Services', industry: 'Internet Content & Information' },
    TSLA: { sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' },
    AMD: { sector: 'Technology', industry: 'Semiconductors' },
    PLTR: { sector: 'Technology', industry: 'Software - Infrastructure' },
    LLY: { sector: 'Healthcare', industry: 'Drug Manufacturers' },
    NVO: { sector: 'Healthcare', industry: 'Drug Manufacturers' },
    JNJ: { sector: 'Healthcare', industry: 'Pharmaceuticals' },
    PFE: { sector: 'Healthcare', industry: 'Pharmaceuticals' },
    XOM: { sector: 'Energy', industry: 'Oil & Gas Integrated' },
    CVX: { sector: 'Energy', industry: 'Oil & Gas Integrated' },
    OXY: { sector: 'Energy', industry: 'Oil & Gas E&P' },
    SLB: { sector: 'Energy', industry: 'Oilfield Services' },
    JPM: { sector: 'Financial Services', industry: 'Banks - Diversified' },
    BAC: { sector: 'Financial Services', industry: 'Banks - Diversified' },
    GS: { sector: 'Financial Services', industry: 'Capital Markets' },
    MS: { sector: 'Financial Services', industry: 'Capital Markets' },
    V: { sector: 'Financial Services', industry: 'Credit Services' },
    MA: { sector: 'Financial Services', industry: 'Credit Services' },
    CEG: { sector: 'Utilities', industry: 'Nuclear & Clean Power' },
    VST: { sector: 'Utilities', industry: 'Electric Utilities' },
    OKLO: { sector: 'Utilities', industry: 'Nuclear Baseload' },
    CCJ: { sector: 'Energy', industry: 'Uranium Mining' },
    ETN: { sector: 'Industrials', industry: 'Electrical Equipment' },
    PWR: { sector: 'Industrials', industry: 'Engineering & Construction' },
    VRT: { sector: 'Industrials', industry: 'Data Center Liquid Cooling' },
    CAT: { sector: 'Industrials', industry: 'Heavy Machinery' },
    DE: { sector: 'Industrials', industry: 'Farm & Heavy Construction' },
    LMT: { sector: 'Industrials', industry: 'Aerospace & Defense' },
    RTX: { sector: 'Industrials', industry: 'Aerospace & Defense' },
    NOC: { sector: 'Industrials', industry: 'Aerospace & Defense' },
    AVAV: { sector: 'Industrials', industry: 'Tactical Drones & Munitions' },
    CRWD: { sector: 'Technology', industry: 'Software - Cybersecurity' },
    PANW: { sector: 'Technology', industry: 'Software - Cybersecurity' },
    FCX: { sector: 'Basic Materials', industry: 'Copper Mining' },
    NUE: { sector: 'Basic Materials', industry: 'Steel' },
    EQIX: { sector: 'Real Estate', industry: 'REIT - Data Center' },
    DLR: { sector: 'Real Estate', industry: 'REIT - Data Center' },
    O: { sector: 'Real Estate', industry: 'REIT - Retail' },
    SPY: { sector: 'Broad Market ETF', industry: 'S&P 500 Index' },
    QQQ: { sector: 'Technology ETF', industry: 'Nasdaq-100 Index' },
    IWM: { sector: 'Small Cap ETF', industry: 'Russell 2000 Index' },
    XBI: { sector: 'Healthcare ETF', industry: 'Biotechnology' },
    KRE: { sector: 'Financial ETF', industry: 'Regional Banking' },
  };

  if (KNOWN_MAP[sym]) return KNOWN_MAP[sym];

  const nameUpper = companyName.toUpperCase();
  if (nameUpper.includes('BANK') || nameUpper.includes('BANCORP') || nameUpper.includes('FINANCIAL') || nameUpper.includes('CAPITAL') || nameUpper.includes('INSURANCE') || nameUpper.includes('INVESTMENT') || nameUpper.includes('ASSET MANAGEMENT') || nameUpper.includes('TRUST')) {
    return { sector: 'Financial Services', industry: nameUpper.includes('INSURANCE') ? 'Insurance' : nameUpper.includes('BANK') ? 'Banks' : 'Capital Markets' };
  }
  if (nameUpper.includes('PHARMA') || nameUpper.includes('THERAPEUTIC') || nameUpper.includes('BIOTECH') || nameUpper.includes('HEALTH') || nameUpper.includes('MEDICAL') || nameUpper.includes('BIOSCIENCE') || nameUpper.includes('CLINICAL') || nameUpper.includes('SURGICAL') || nameUpper.includes('GENOMIC')) {
    return { sector: 'Healthcare', industry: nameUpper.includes('THERAPEUTIC') || nameUpper.includes('BIOTECH') ? 'Biotechnology' : 'Medical Devices & Services' };
  }
  if (nameUpper.includes('TECH') || nameUpper.includes('SOFTWARE') || nameUpper.includes('SEMICONDUCTOR') || nameUpper.includes('CYBER') || nameUpper.includes('SYSTEMS') || nameUpper.includes('DIGITAL') || nameUpper.includes('CLOUD') || nameUpper.includes('MICRO') || nameUpper.includes('AI ') || nameUpper.includes('ELECTRONIC')) {
    return { sector: 'Technology', industry: nameUpper.includes('SEMICONDUCTOR') ? 'Semiconductors' : 'Software & IT Services' };
  }
  if (nameUpper.includes('ENERGY') || nameUpper.includes('OIL') || nameUpper.includes('GAS') || nameUpper.includes('PETROLEUM') || nameUpper.includes('DRILLING') || nameUpper.includes('SOLAR') || nameUpper.includes('RENEWABLE')) {
    return { sector: 'Energy', industry: nameUpper.includes('SOLAR') || nameUpper.includes('RENEWABLE') ? 'Clean Energy' : 'Oil & Gas' };
  }
  if (nameUpper.includes('POWER') || nameUpper.includes('UTILITY') || nameUpper.includes('ELECTRIC') || nameUpper.includes('WATER') || nameUpper.includes('NUCLEAR')) {
    return { sector: 'Utilities', industry: 'Electric & Gas Utilities' };
  }
  if (nameUpper.includes('REALTY') || nameUpper.includes('REAL ESTATE') || nameUpper.includes('REIT') || nameUpper.includes('PROPERTIES')) {
    return { sector: 'Real Estate', industry: 'REITs & Real Estate' };
  }
  if (nameUpper.includes('MINING') || nameUpper.includes('GOLD') || nameUpper.includes('SILVER') || nameUpper.includes('COPPER') || nameUpper.includes('STEEL') || nameUpper.includes('CHEMICAL') || nameUpper.includes('MATERIALS')) {
    return { sector: 'Basic Materials', industry: nameUpper.includes('MINING') ? 'Metals & Mining' : 'Chemicals & Materials' };
  }
  if (nameUpper.includes('AIRLINE') || nameUpper.includes('LOGISTIC') || nameUpper.includes('TRANSPORT') || nameUpper.includes('FREIGHT') || nameUpper.includes('MACHINERY') || nameUpper.includes('ENGINEERING') || nameUpper.includes('DEFENSE') || nameUpper.includes('AEROSPACE') || nameUpper.includes('CONSTRUCTION')) {
    return { sector: 'Industrials', industry: nameUpper.includes('DEFENSE') || nameUpper.includes('AEROSPACE') ? 'Aerospace & Defense' : 'Industrial Goods & Transport' };
  }
  if (nameUpper.includes('RETAIL') || nameUpper.includes('AUTO') || nameUpper.includes('MOTORS') || nameUpper.includes('HOTEL') || nameUpper.includes('RESORT') || nameUpper.includes('ENTERTAINMENT') || nameUpper.includes('APPAREL') || nameUpper.includes('CASINO')) {
    return { sector: 'Consumer Cyclical', industry: 'Consumer Discretionary' };
  }
  if (nameUpper.includes('FOOD') || nameUpper.includes('BEVERAGE') || nameUpper.includes('BREWING') || nameUpper.includes('TOBACCO') || nameUpper.includes('HOUSEHOLD') || nameUpper.includes('GROCERY')) {
    return { sector: 'Consumer Defensive', industry: 'Consumer Staples' };
  }
  if (nameUpper.includes('TELECOM') || nameUpper.includes('COMMUNICATION') || nameUpper.includes('MEDIA') || nameUpper.includes('WIRELESS')) {
    return { sector: 'Communication Services', industry: 'Telecom & Media' };
  }

  return { sector: 'Diversified / Commercial', industry: 'Corporate General' };
}

export interface SecurityMasterSyncStats {
  provider: string;
  totalSynchronized: number;
  totalEligible: number;
  totalSkipped: number;
  totalStale: number;
  totalFailed: number;
  latencyMs: number;
  lastSyncAt: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
}

class SecurityMasterService {
  private universeCache: Map<string, SecurityMasterAsset> = new Map();
  private lastSyncStats: SecurityMasterSyncStats | null = null;
  private isSyncing = false;
  private syncIntervalTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Load last sync record from database if available
    this.hydrateFromDb().catch(() => {});
  }

  private async hydrateFromDb() {
    try {
      const record = await prisma.providerSyncRecord.findFirst({
        where: { provider: 'ALPACA_US_EQUITY' },
        orderBy: { lastSyncAt: 'desc' }
      });
      if (record) {
        this.lastSyncStats = {
          provider: record.provider,
          totalSynchronized: record.totalSynchronized,
          totalEligible: record.totalEligible,
          totalSkipped: record.totalSkipped,
          totalStale: record.totalStale,
          totalFailed: record.totalFailed,
          latencyMs: record.latencyMs,
          lastSyncAt: new Date(record.lastSyncAt).toISOString(),
          status: record.status as any,
        };
      }
    } catch {}
  }

  /**
   * Synchronize the complete US Equity Universe from Alpaca API and SEC EDGAR
   */
  async syncUniverse(): Promise<SecurityMasterSyncStats> {
    if (this.isSyncing) {
      if (this.lastSyncStats) return this.lastSyncStats;
    }

    this.isSyncing = true;
    const startTime = Date.now();
    logger.info('🔄 Initiating dynamic US Equity Security Master synchronization...');

    const apiKey = appConfig.ALPACA.paperApiKey;
    const apiSecret = appConfig.ALPACA.paperSecretKey;
    const baseUrl = appConfig.ALPACA.paperBaseUrl;

    let alpacaAssetsMap = new Map<string, any>();
    let secRegistrantsMap = new Map<string, any>();
    let providerName = 'ALPACA_SEC_JOINED_MASTER';

    try {
      // 1. Fetch Alpaca active asset universe if credentials available
      if (appConfig.ALPACA.isPaperConfigured && apiKey && apiSecret) {
        try {
          const resp = await axios.get(`${baseUrl}/v2/assets`, {
            params: { status: 'active', asset_class: 'us_equity' },
            headers: {
              'APCA-API-KEY-ID': apiKey,
              'APCA-API-SECRET-KEY': apiSecret,
            },
            timeout: 25000,
          });
          const rawAlpaca = Array.isArray(resp.data) ? resp.data : [];
          for (const a of rawAlpaca) {
            const sym = String(a.symbol || '').trim().toUpperCase();
            if (sym && !sym.includes('.') && !sym.includes('/')) {
              alpacaAssetsMap.set(sym, a);
            }
          }
          logger.info(`✅ Authoritative Alpaca assets response: ${alpacaAssetsMap.size} active US equities.`);
        } catch (err: any) {
          logger.warn('Alpaca assets fetch failed; continuing with SEC directory check', { error: err.message });
        }
      }

      // 2. Fetch authoritative SEC EDGAR directory of 10,000+ US publicly traded equities
      const secFeedResp = await axios.get('https://www.sec.gov/files/company_tickers.json', {
        headers: { 'User-Agent': secUserAgent() },
        timeout: 20000
      }).catch((err) => {
        logger.warn('SEC directory fetch warning', { error: err.message });
        return null;
      });

      if (secFeedResp && secFeedResp.data && typeof secFeedResp.data === 'object') {
        const secList = Object.values(secFeedResp.data) as any[];
        for (const item of secList) {
          const sym = String(item.ticker || '').trim().toUpperCase();
          if (sym && !sym.includes('.') && !sym.includes('/')) {
            secRegistrantsMap.set(sym, {
              cik: String(item.cik_str),
              symbol: sym,
              title: item.title
            });
          }
        }
        logger.info(`✅ Retrieved ${secRegistrantsMap.size} corporate registrants from official SEC EDGAR registry.`);
      }

      const now = new Date().toISOString();
      const newCache = new Map<string, SecurityMasterAsset>();
      let eligible = 0;
      let skipped = 0;

      // Union of all known symbols
      const allSymbols = new Set([...alpacaAssetsMap.keys(), ...secRegistrantsMap.keys()]);

      for (const symbol of allSymbols) {
        const alpacaAsset = alpacaAssetsMap.get(symbol);
        const secAsset = secRegistrantsMap.get(symbol);

        const isAlpacaTradable = Boolean(alpacaAsset && alpacaAsset.tradable && alpacaAsset.status === 'active');
        const isSecRegistrant = Boolean(secAsset);
        // Requirement 7: The SEC company directory is NOT itself a tradable stock universe.
        // A symbol is execution-eligible ONLY when verified active & tradable on Alpaca.
        const executionEligible = isAlpacaTradable;

        if (executionEligible) {
          eligible++;
        } else {
          skipped++;
        }

        const name = alpacaAsset?.name || secAsset?.title || symbol;
        const { sector, industry } = inferSectorAndIndustry(symbol, name);

        newCache.set(symbol, {
          id: alpacaAsset?.id || (secAsset ? `sec-cik-${secAsset.cik}` : `asset-${symbol}`),
          symbol,
          name,
          exchange: alpacaAsset?.exchange || (isSecRegistrant ? 'SEC_REGISTRANT' : 'US'),
          assetClass: alpacaAsset?.class || 'us_equity',
          sector,
          industry,
          status: isAlpacaTradable ? 'active' : (isSecRegistrant ? 'sec_registered' : 'inactive'),
          tradable: isAlpacaTradable,
          isSecRegistrant,
          isAlpacaTradable,
          executionEligible,
          marginable: Boolean(alpacaAsset?.marginable ?? false),
          shortable: Boolean(alpacaAsset?.shortable ?? false),
          fractionable: Boolean(alpacaAsset?.fractionable ?? false),
          cik: secAsset?.cik,
          lastUpdated: now,
        });
      }

      this.universeCache = newCache;
      const latencyMs = Date.now() - startTime;

      const stats: SecurityMasterSyncStats = {
        provider: alpacaAssetsMap.size > 0 ? 'ALPACA_SEC_JOINED_MASTER' : 'SEC_EDGAR_US_EQUITY_MASTER',
        totalSynchronized: allSymbols.size,
        totalEligible: eligible,
        totalSkipped: skipped,
        totalStale: 0,
        totalFailed: 0,
        latencyMs,
        lastSyncAt: now,
        status: 'SUCCESS'
      };

      this.lastSyncStats = stats;

      // Persist sync stats in database
      await prisma.providerSyncRecord.create({
        data: {
          provider: stats.provider,
          feedType: 'SECURITY_MASTER_SYNC',
          totalSynchronized: allSymbols.size,
          totalEligible: eligible,
          totalSkipped: skipped,
          totalStale: 0,
          totalFailed: 0,
          latencyMs,
          status: 'SUCCESS'
        }
      }).catch(() => {});

      logger.info(`✅ Security Master synchronized: ${newCache.size} equities in security master (${eligible} execution-eligible, ${skipped} non-tradable/SEC registrants, latency: ${latencyMs}ms).`);
      return stats;
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('❌ Security Master sync failed', { error: err.message });
      const stats: SecurityMasterSyncStats = {
        provider: providerName,
        totalSynchronized: this.universeCache.size,
        totalEligible: this.universeCache.size,
        totalSkipped: 0,
        totalStale: 1,
        totalFailed: 1,
        latencyMs,
        lastSyncAt: this.lastSyncStats?.lastSyncAt || new Date().toISOString(),
        status: 'FAILED'
      };
      this.lastSyncStats = stats;
      return stats;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Filter the universe dynamically based on trading parameters
   */
  getEligibleUniverse(options?: {
    tradableOnly?: boolean;
    fractionableOnly?: boolean;
    shortableOnly?: boolean;
    exchanges?: string[];
    limit?: number;
  }): SecurityMasterAsset[] {
    let list = Array.from(this.universeCache.values());

    if (options?.tradableOnly !== false) {
      list = list.filter(a => a.executionEligible && a.tradable && a.status === 'active');
    }
    if (options?.fractionableOnly) {
      list = list.filter(a => a.fractionable);
    }
    if (options?.shortableOnly) {
      list = list.filter(a => a.shortable);
    }
    if (options?.exchanges && options.exchanges.length > 0) {
      const allowed = new Set(options.exchanges.map(e => e.toUpperCase()));
      list = list.filter(a => allowed.has(a.exchange.toUpperCase()));
    }
    if (options?.limit && options.limit > 0) {
      list = list.slice(0, options.limit);
    }

    return list;
  }

  /**
   * Strictly returns symbols that are confirmed execution-eligible on Alpaca
   */
  getExecutionEligibleUniverse(limit = 100): SecurityMasterAsset[] {
    return this.getEligibleUniverse({ tradableOnly: true, limit });
  }

  /**
   * Checks whether a symbol is execution-eligible
   */
  isSymbolTradable(symbol: string): boolean {
    const asset = this.universeCache.get(symbol.toUpperCase());
    return Boolean(asset && asset.executionEligible && asset.tradable);
  }

  getAsset(symbol: string): SecurityMasterAsset | undefined {
    return this.universeCache.get(symbol.toUpperCase());
  }

  /**
   * Returns all assets in the master database (10,400+ public securities)
   */
  getAllAssets(options?: {
    search?: string;
    sector?: string;
    exchange?: string;
    tradableOnly?: boolean;
    limit?: number;
    offset?: number;
  }): { assets: SecurityMasterAsset[]; total: number } {
    let list = Array.from(this.universeCache.values());

    if (options?.tradableOnly) {
      list = list.filter(a => a.executionEligible && a.tradable);
    }
    if (options?.sector && options.sector !== 'all') {
      const secLow = options.sector.toLowerCase();
      list = list.filter(a => a.sector?.toLowerCase() === secLow);
    }
    if (options?.exchange && options.exchange !== 'all') {
      const exLow = options.exchange.toLowerCase();
      list = list.filter(a => a.exchange?.toLowerCase().includes(exLow));
    }
    if (options?.search && options.search.trim()) {
      const q = options.search.toLowerCase().trim();
      list = list.filter(a =>
        a.symbol.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.industry && a.industry.toLowerCase().includes(q))
      );
    }

    const total = list.length;
    const offset = options?.offset || 0;
    const limit = options?.limit || 100;
    const assets = list.slice(offset, offset + limit);

    return { assets, total };
  }

  getSyncStats(): SecurityMasterSyncStats {
    if (this.lastSyncStats) return this.lastSyncStats;
    return {
      provider: 'NOT_SYNCHRONIZED',
      totalSynchronized: this.universeCache.size,
      totalEligible: this.universeCache.size,
      totalSkipped: 0,
      totalStale: 1,
      totalFailed: 0,
      latencyMs: 0,
      lastSyncAt: new Date(0).toISOString(),
      status: 'PARTIAL'
    };
  }

  /**
   * Start periodic synchronization (every 6 hours)
   */
  startScheduledSync(intervalMs = 6 * 60 * 60 * 1000) {
    if (this.syncIntervalTimer) return;
    // Initial sync
    this.syncUniverse().catch(() => {});
    this.syncIntervalTimer = setInterval(() => {
      this.syncUniverse().catch(() => {});
    }, intervalMs);
  }

  stopScheduledSync() {
    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer);
      this.syncIntervalTimer = null;
    }
  }
}

export const securityMaster = new SecurityMasterService();
