import axios from 'axios';
import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { encryptSecret, decryptSecret } from '../utils/secrets';
import { prisma } from '../utils/prisma';
import { getAlpacaMode } from '../trading/liveGate';

// Polygon USDC Contract Addresses
const NATIVE_USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const BRIDGED_USDC_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

export interface AlpacaAccountState {
  connected: boolean;
  paperMode: boolean;
  apiKey?: string;
  secretKey?: string;
  accountNumber?: string;
  status?: string;
  currency?: string;
  cash: number;
  portfolioValue: number;
  buyingPower: number;
  daytradingBuyingPower: number;
  positions: any[];
  lastSyncAt: number;
  error?: string;
}

export interface PolymarketAccountState {
  connected: boolean;
  address?: string;
  privateKeyConfigured: boolean;
  usdcBalance: number;
  polBalance: number;
  portfolioValue: number;
  positions: any[];
  lastSyncAt: number;
  error?: string;
}

export class AccountManager {
  private alpacaState: AlpacaAccountState = {
    connected: false,
    paperMode: true,
    cash: 0,
    portfolioValue: 0,
    buyingPower: 0,
    daytradingBuyingPower: 0,
    positions: [],
    lastSyncAt: 0,
  };

  private polymarketState: PolymarketAccountState = {
    connected: false,
    privateKeyConfigured: false,
    usdcBalance: 0,
    polBalance: 0,
    portfolioValue: 0,
    positions: [],
    lastSyncAt: 0,
  };

  private alpacaConnectionQueue: Promise<unknown> = Promise.resolve();
  private alpacaGeneration = 0;
  private alpacaDisconnectGeneration = 0;

  constructor() {
    this.initFromEnv();
  }

  private async initFromEnv() {
    const bootstrapGeneration = this.alpacaGeneration;
    let storedKeys: { key: string; secret: string; paper: boolean } | null = null;
    try {
      const st = await prisma.settings.findUnique({ where: { id: 'settings-1' } });
      const key = decryptSecret(st?.alpacaApiKeyEnc);
      const secret = decryptSecret(st?.alpacaSecretKeyEnc);
      if (key && secret) storedKeys = { key, secret, paper: st?.alpacaPaperMode ?? true };
    } catch { /* Settings unavailable: environment bootstrap remains available. */ }
    // An owner connection made while Settings loaded supersedes this bootstrap.
    if (bootstrapGeneration === this.alpacaGeneration) {
      if (storedKeys) await this.testAndSaveAlpaca(storedKeys.key, storedKeys.secret, storedKeys.paper, false);
      else {
        const apiKey = process.env.ALPACA_API_KEY;
        const secretKey = process.env.ALPACA_SECRET_KEY;
        if (apiKey && secretKey && !apiKey.includes('XXXX') && apiKey !== 'dummy-key') {
          const isPaper = (process.env.ALPACA_BASE_URL || '').includes('paper') || getAlpacaMode() !== 'live';
          await this.testAndSaveAlpaca(apiKey, secretKey, isPaper, false);
        }
      }
    }

    // Check if env has Polymarket keys
    const pk = process.env.POLYMARKET_PRIVATE_KEY;
    if (pk && !pk.includes('0000000000000000000000000000000000000000000000000000000000000000') && pk.length >= 64) {
      try {
        const wallet = new ethers.Wallet(pk);
        await this.testAndSavePolymarket(wallet.address, pk, false);
      } catch (err) {
        // invalid wallet format in env
      }
    }
  }

  // ─── ALPACA BROKER INTEGRATION ──────────────────────────────────────────────
  async testAndSaveAlpaca(apiKey: string, secretKey: string, paperMode: boolean = true, saveSettings: boolean = true) {
    ++this.alpacaGeneration;
    const disconnectGeneration = this.alpacaDisconnectGeneration;
    return this.enqueueAlpaca(() => this.connectAlpaca(apiKey, secretKey, paperMode, saveSettings, disconnectGeneration));
  }

  private enqueueAlpaca<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.alpacaConnectionQueue.then(operation);
    this.alpacaConnectionQueue = pending.catch(() => {});
    return pending;
  }

  private async connectAlpaca(apiKey: string, secretKey: string, paperMode: boolean, saveSettings: boolean, disconnectGeneration: number) {
    const interrupted = () => disconnectGeneration !== this.alpacaDisconnectGeneration;
    const superseded = () => ({ success: false, error: 'Alpaca connection canceled by disconnect. Please reconnect.' });
    if (interrupted()) return superseded();
    const baseUrl = paperMode ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
    try {
      // 1. Validate credentials against /v2/account
      const accountRes = await axios.get(`${baseUrl}/v2/account`, {
        headers: {
          'APCA-API-KEY-ID': apiKey.trim(),
          'APCA-API-SECRET-KEY': secretKey.trim(),
        },
        timeout: 10000,
      });

      const acc = accountRes.data;

      // 2. Fetch live open positions
      let positions: any[] = [];
      try {
        const posRes = await axios.get(`${baseUrl}/v2/positions`, {
          headers: {
            'APCA-API-KEY-ID': apiKey.trim(),
            'APCA-API-SECRET-KEY': secretKey.trim(),
          },
          timeout: 10000,
        });
        positions = posRes.data.map((p: any) => ({
          symbol: p.symbol,
          qty: parseFloat(p.qty),
          side: p.side,
          marketValue: parseFloat(p.market_value),
          costBasis: parseFloat(p.cost_basis),
          unrealizedPnl: parseFloat(p.unrealized_pl),
          unrealizedPnlPct: parseFloat(p.unrealized_plpc) * 100,
          currentPrice: parseFloat(p.current_price),
          changeTodayPct: parseFloat(p.change_today) * 100,
        }));
      } catch {
        // ignore position error
      }

      const nextState: AlpacaAccountState = {
        connected: true,
        paperMode,
        apiKey: apiKey.trim(),
        secretKey: secretKey.trim(),
        accountNumber: acc.account_number,
        status: acc.status,
        currency: acc.currency,
        cash: parseFloat(acc.cash) || 0,
        portfolioValue: parseFloat(acc.equity) || parseFloat(acc.portfolio_value) || 0,
        buyingPower: parseFloat(acc.buying_power) || 0,
        daytradingBuyingPower: parseFloat(acc.daytrading_buying_power) || 0,
        positions,
        lastSyncAt: Date.now(),
      };

      if (interrupted()) return superseded();
      if (saveSettings) {
        // Stored encrypted (AES-256-GCM, ENCRYPTION_KEY) so Settings-entered
        // keys survive a restart without sitting in the DB in plaintext.
        const enc = {
          alpacaApiKeyEnc: encryptSecret(apiKey.trim()),
          alpacaSecretKeyEnc: encryptSecret(secretKey.trim()),
          alpacaPaperMode: paperMode,
        };
        try {
          await prisma.settings.upsert({
            where: { id: 'settings-1' },
            create: { id: 'settings-1', ...enc },
            update: enc,
          });
        } catch {
          logger.warn('Alpaca credential persistence unavailable');
          return { success: false, error: 'Could not save Alpaca connection. Previous connection retained. Please retry.' };
        }
      }

      // Publish only after durable encrypted settings have committed. Boot and
      // refresh reads explicitly opt out of persistence.
      if (interrupted()) return superseded();
      this.alpacaState = nextState;
      logger.info(`✅ Alpaca successfully connected! Account: ${acc.account_number} (${paperMode ? 'PAPER' : 'LIVE'}), Value: $${acc.portfolio_value}`);
      const { apiKey: _k, secretKey: _s, ...safeAccount } = this.alpacaState as any;
      return { success: true, account: safeAccount };
    } catch {
      logger.warn('Alpaca connection verification unavailable');
      return { success: false, error: 'Could not verify Alpaca connection. Previous connection retained. Please retry.' };
    }
  }

  // ─── POLYMARKET ACCOUNT INTEGRATION ─────────────────────────────────────────
  async testAndSavePolymarket(address: string, privateKey?: string, saveSettings: boolean = true) {
    try {
      const formattedAddress = address.trim();
      if (!ethers.isAddress(formattedAddress)) {
        return { success: false, error: 'Invalid Polygon/Ethereum wallet address format' };
      }

      // 1. Fetch on-chain USDC & POL balances via Polygon RPC
      let usdcBalance = 0;
      let polBalance = 0;

      try {
        const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
        const polWei = await provider.getBalance(formattedAddress);
        polBalance = parseFloat(ethers.formatEther(polWei));

        // Native USDC
        try {
          const usdcContract = new ethers.Contract(NATIVE_USDC_POLYGON, ERC20_ABI, provider);
          const bal = await usdcContract.balanceOf(formattedAddress);
          usdcBalance += parseFloat(ethers.formatUnits(bal, 6));
        } catch {}

        // Bridged USDC.e
        try {
          const bridgedContract = new ethers.Contract(BRIDGED_USDC_POLYGON, ERC20_ABI, provider);
          const bal = await bridgedContract.balanceOf(formattedAddress);
          usdcBalance += parseFloat(ethers.formatUnits(bal, 6));
        } catch {}
      } catch (rpcErr) {
        logger.warn('Polygon RPC balance query fallback', { error: (rpcErr as any).message });
      }

      // 2. Fetch Polymarket Data API for user positions and value
      let positions: any[] = [];
      let portfolioValue = usdcBalance;

      try {
        const positionsRes = await axios.get(`https://data-api.polymarket.com/positions`, {
          params: { user: formattedAddress, limit: 50 },
          timeout: 8000,
        });
        if (Array.isArray(positionsRes.data)) {
          positions = positionsRes.data.map((p: any) => ({
            title: p.title || p.question || 'Prediction Market',
            outcome: p.outcome || (p.side === 'YES' ? 'YES' : 'NO'),
            size: parseFloat(p.size) || 0,
            avgPrice: parseFloat(p.avgPrice) || 0,
            currentPrice: parseFloat(p.curPrice) || parseFloat(p.currentPrice) || 0,
            cashPnl: parseFloat(p.cashPnl) || 0,
            percentPnl: parseFloat(p.percentPnl) || 0,
            conditionId: p.conditionId,
            asset: p.asset,
          }));

          const positionsValue = positions.reduce((sum, p) => sum + (p.size * (p.currentPrice || p.avgPrice)), 0);
          portfolioValue += positionsValue;
        }
      } catch (dataApiErr) {
        logger.warn('Polymarket Data API positions fallback', { error: (dataApiErr as any).message });
      }

      // 3. Optional Value endpoint check
      try {
        const valRes = await axios.get(`https://data-api.polymarket.com/value`, {
          params: { user: formattedAddress },
          timeout: 6000,
        });
        if (Array.isArray(valRes.data) && valRes.data[0]?.value) {
          const apiVal = parseFloat(valRes.data[0].value);
          if (apiVal > 0) portfolioValue = apiVal + usdcBalance;
        }
      } catch {}

      this.polymarketState = {
        connected: true,
        address: formattedAddress,
        privateKeyConfigured: !!(privateKey && privateKey.length >= 64),
        usdcBalance,
        polBalance,
        portfolioValue,
        positions,
        lastSyncAt: Date.now(),
      };

      if (saveSettings) {
        // Only the public address is stored. A wallet private key is never
        // written to the database (live Polymarket trading is not implemented).
        await prisma.settings.upsert({
          where: { id: 'settings-1' },
          create: { id: 'settings-1', polymarketAddress: formattedAddress },
          update: { polymarketAddress: formattedAddress },
        }).catch(() => {});
      }

      logger.info(`✅ Polymarket successfully connected! Address: ${formattedAddress}, USDC: $${usdcBalance.toFixed(2)}, Value: $${portfolioValue.toFixed(2)}`);
      return { success: true, account: this.polymarketState };
    } catch (err: any) {
      const errMsg = err.message || 'Failed to verify Polymarket address';
      this.polymarketState = {
        ...this.polymarketState,
        connected: false,
        error: errMsg,
      };
      return { success: false, error: errMsg };
    }
  }

  // ─── GETTERS & STATUS ───────────────────────────────────────────────────────
  getAlpacaState(): AlpacaAccountState {
    return this.alpacaState;
  }

  getPolymarketState(): PolymarketAccountState {
    return this.polymarketState;
  }

  isAlpacaConnected(): boolean {
    return this.alpacaState.connected;
  }

  isPolymarketConnected(): boolean {
    return this.polymarketState.connected;
  }

  disconnectAlpaca() {
    ++this.alpacaGeneration;
    ++this.alpacaDisconnectGeneration;
    this.alpacaState = {
      connected: false,
      paperMode: true,
      cash: 0,
      portfolioValue: 0,
      buyingPower: 0,
      daytradingBuyingPower: 0,
      positions: [],
      lastSyncAt: 0,
    };
  }

  disconnectPolymarket() {
    this.polymarketState = {
      connected: false,
      privateKeyConfigured: false,
      usdcBalance: 0,
      polBalance: 0,
      portfolioValue: 0,
      positions: [],
      lastSyncAt: 0,
    };
  }

  /** Re-read cash / equity / positions for the connected Alpaca account (called every minute by brokerSync). */
  async refreshAlpaca() {
    return this.enqueueAlpaca(async () => {
      // Read custody only when this queued refresh executes. Capturing keys
      // before enqueue could restore an old account after a newer owner save.
      const st = this.alpacaState;
      if (!st.connected || !st.apiKey || !st.secretKey) return;
      await this.connectAlpaca(st.apiKey, st.secretKey, st.paperMode, false, this.alpacaDisconnectGeneration);
    });
  }

  getLiveAccountsSummary() {
    return {
      alpaca: {
        connected: this.alpacaState.connected,
        paperMode: this.alpacaState.paperMode,
        accountNumber: this.alpacaState.accountNumber || (this.alpacaState.connected ? 'ACTIVE' : 'NOT CONNECTED'),
        status: this.alpacaState.status || (this.alpacaState.connected ? 'ACTIVE' : 'DISCONNECTED'),
        cash: this.alpacaState.cash,
        portfolioValue: this.alpacaState.portfolioValue,
        buyingPower: this.alpacaState.buyingPower,
        positionsCount: this.alpacaState.positions.length,
        positions: this.alpacaState.positions,
        lastSyncAt: this.alpacaState.lastSyncAt,
        error: this.alpacaState.error,
      },
      polymarket: {
        connected: this.polymarketState.connected,
        address: this.polymarketState.address || 'NOT CONNECTED',
        usdcBalance: this.polymarketState.usdcBalance,
        polBalance: this.polymarketState.polBalance,
        portfolioValue: this.polymarketState.portfolioValue,
        positionsCount: this.polymarketState.positions.length,
        positions: this.polymarketState.positions,
        privateKeyConfigured: this.polymarketState.privateKeyConfigured,
        lastSyncAt: this.polymarketState.lastSyncAt,
        error: this.polymarketState.error,
      },
      combinedLiveEquity: (this.alpacaState.connected ? this.alpacaState.portfolioValue : 0) +
                          (this.polymarketState.connected ? this.polymarketState.portfolioValue : 0),
      combinedLiveCash: (this.alpacaState.connected ? this.alpacaState.cash : 0) +
                        (this.polymarketState.connected ? this.polymarketState.usdcBalance : 0),
    };
  }
}

export const accountManager = new AccountManager();
