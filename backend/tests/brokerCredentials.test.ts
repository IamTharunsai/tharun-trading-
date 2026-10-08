jest.mock('axios', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/utils/config', () => ({ appConfig: { TRADING_MODE: 'paper', ALPACA: {
  paperApiKey: 'test-paper-key', paperSecretKey: 'test-paper-secret',
  liveApiKey: 'test-live-key', liveSecretKey: 'test-live-secret',
} } }));
jest.mock('../src/services/accountManager', () => ({ accountManager: { getAlpacaState: () => ({ connected: false }) } }));

import axios from 'axios';
import { AlpacaBroker, createAlpacaBroker } from '../src/services/alpacaBroker';
import { getTradingBroker } from '../src/trading/brokerRouter';
import { appConfig } from '../src/utils/config';

const account = { id: 'account-good', account_number: 'fixture', last_equity: '1000',
  portfolio_value: '1000', cash: '800', buying_power: '800', equity: '1000' };
const denied = { response: { status: 401 }, message: 'fixture authentication denied' };

beforeEach(() => { jest.clearAllMocks(); });

test('one rejected account cannot disable another valid broker', async () => {
  (axios.create as jest.Mock).mockReturnValueOnce({ get: jest.fn().mockRejectedValue(denied) })
    .mockReturnValueOnce({ get: jest.fn().mockResolvedValue({ data: account }) });
  expect(await new AlpacaBroker('bad-key', 'bad-secret').getPortfolioSummary()).toBeNull();
  expect(await new AlpacaBroker('good-key', 'good-secret').getPortfolioSummary()).toMatchObject({ account_id: 'account-good' });
});

test('a recovered account can be verified after a previous rejection', async () => {
  const get = jest.fn().mockRejectedValueOnce(denied).mockResolvedValueOnce({ data: account });
  (axios.create as jest.Mock).mockReturnValue({ get });
  const broker = new AlpacaBroker('recover-key', 'recover-secret');
  expect(await broker.getPortfolioSummary()).toBeNull();
  expect(await broker.getPortfolioSummary()).toMatchObject({ account_id: 'account-good' });
  expect(get).toHaveBeenCalledTimes(2);
});

test('a rejection does not permanently prevent construction with replacement credentials', async () => {
  (axios.create as jest.Mock).mockReturnValue({ get: jest.fn().mockRejectedValue(denied) });
  expect(await new AlpacaBroker('old-key', 'old-secret').validateCredentials()).toBe(false);
  const previousKey = process.env.ALPACA_API_KEY;
  const previousSecret = process.env.ALPACA_SECRET_KEY;
  try {
    process.env.ALPACA_API_KEY = 'replacement-key'; process.env.ALPACA_SECRET_KEY = 'replacement-secret';
    expect(createAlpacaBroker()).toBeInstanceOf(AlpacaBroker);
  } finally {
    if (previousKey === undefined) delete process.env.ALPACA_API_KEY; else process.env.ALPACA_API_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.ALPACA_SECRET_KEY; else process.env.ALPACA_SECRET_KEY = previousSecret;
  }
});

test('secret rotation replaces the cached client even when the key ID is unchanged', () => {
  (axios.create as jest.Mock).mockReturnValue({ get: jest.fn() });
  const first = getTradingBroker();
  expect(getTradingBroker()).toBe(first);
  const previous = appConfig.ALPACA.paperSecretKey;
  try {
    appConfig.ALPACA.paperSecretKey = 'rotated-paper-secret';
    expect(getTradingBroker()).not.toBe(first);
    expect(axios.create).toHaveBeenLastCalledWith(expect.objectContaining({ headers: {
      'APCA-API-KEY-ID': 'test-paper-key', 'APCA-API-SECRET-KEY': 'rotated-paper-secret',
    } }));
  } finally { appConfig.ALPACA.paperSecretKey = previous; }
});
