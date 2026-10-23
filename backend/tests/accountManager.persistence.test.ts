jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../src/utils/prisma', () => ({ prisma: { settings: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() } } }));
jest.mock('../src/utils/config', () => ({ appConfig: { ENCRYPTION_KEY: 'fixture-encryption-key-with-no-production-authority' } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
import axios from 'axios';
import { prisma } from '../src/utils/prisma';
import { AccountManager } from '../src/services/accountManager';
import { decryptSecret } from '../src/utils/secrets';
import { logger } from '../src/utils/logger';
const http = axios.get as jest.Mock;
const read = prisma.settings.findUnique as jest.Mock;
const save = prisma.settings.upsert as jest.Mock;
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const account = { account_number: 'fixture-account', status: 'ACTIVE', currency: 'USD', cash: '100', equity: '100', portfolio_value: '100' };
let stored: any;
beforeEach(() => {
  delete process.env.ALPACA_API_KEY; delete process.env.ALPACA_SECRET_KEY; delete process.env.POLYMARKET_PRIVATE_KEY;
  jest.clearAllMocks(); stored = null;
  read.mockImplementation(async () => stored);
  save.mockImplementation(async (args: any) => { stored = args.update; return stored; });
  http.mockImplementation(async (url: string) => ({ data: url.endsWith('/positions') ? [] : account }));
});
async function prior() {
  const manager = new AccountManager(); await flush();
  expect((await manager.testAndSaveAlpaca('fixture-prior-key', 'fixture-prior-secret', true, false)).success).toBe(true);
  return manager;
}
test('DB failure is a safe failure retaining prior runtime connection and never exposing raw errors', async () => {
  const manager = await prior(); const before = manager.getAlpacaState();
  save.mockRejectedValueOnce(new Error('fixture-new-secret private database detail'));
  const result = await manager.testAndSaveAlpaca('fixture-new-key', 'fixture-new-secret');
  expect(result).toEqual({ success: false, error: 'Could not save Alpaca connection. Previous connection retained. Please retry.' });
  expect(manager.getAlpacaState()).toEqual(before);
  expect(JSON.stringify([result, (logger.warn as jest.Mock).mock.calls])).not.toContain('fixture-new-secret');
});
test('new runtime connection is published only after durable encrypted settings commit and reloads on restart', async () => {
  const manager = await prior(); const before = manager.getAlpacaState();
  let commit!: () => void;
  save.mockImplementationOnce((args: any) => new Promise(resolve => { commit = () => { stored = args.update; resolve(stored); }; }));
  const pending = manager.testAndSaveAlpaca('fixture-new-key', 'fixture-new-secret');
  await flush(); expect(save).toHaveBeenCalledTimes(1); expect(manager.getAlpacaState()).toEqual(before);
  commit(); const result = await pending;
  expect(result.success).toBe(true); expect(JSON.stringify(result)).not.toContain('fixture-new-secret');
  expect(stored).toEqual({ alpacaApiKeyEnc: expect.stringMatching(/^v1:/), alpacaSecretKeyEnc: expect.stringMatching(/^v1:/), alpacaPaperMode: true });
  expect(JSON.stringify(save.mock.calls)).not.toContain('fixture-new-secret');
  expect(JSON.stringify(save.mock.calls)).not.toContain('fixture-new-key');
  expect(decryptSecret(stored.alpacaApiKeyEnc)).toBe('fixture-new-key');
  expect(decryptSecret(stored.alpacaSecretKeyEnc)).toBe('fixture-new-secret');
  process.env.ALPACA_API_KEY = 'fixture-env-key'; process.env.ALPACA_SECRET_KEY = 'fixture-env-secret';
  save.mockClear(); const restarted = new AccountManager(); await flush();
  expect(restarted.getAlpacaState()).toMatchObject({ connected: true, apiKey: 'fixture-new-key', secretKey: 'fixture-new-secret' });
  expect(save).not.toHaveBeenCalled();
});
test('provider verification failure retains prior connection and returns no raw provider details', async () => {
  const manager = await prior(); const before = manager.getAlpacaState();
  http.mockRejectedValueOnce({ response: { data: { message: 'fixture-secret private provider detail' } } });
  const result = await manager.testAndSaveAlpaca('fixture-key', 'fixture-secret');
  expect(result).toMatchObject({ success: false }); expect(JSON.stringify(result)).not.toContain('fixture-secret');
  expect(manager.getAlpacaState()).toEqual(before); expect(save).not.toHaveBeenCalled();
});
test('non-persisting refresh remains nonwriting', async () => {
  const manager = await prior(); await manager.refreshAlpaca();
  expect(manager.getAlpacaState().connected).toBe(true); expect(save).not.toHaveBeenCalled();
});

test('late Settings bootstrap read cannot overwrite a newer durable owner connection', async () => {
  let releaseRead!: (value: any) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { releaseRead = resolve; }));
  const manager = new AccountManager();
  expect((await manager.testAndSaveAlpaca('fixture-owner-key', 'fixture-owner-secret')).success).toBe(true);
  process.env.ALPACA_API_KEY = 'fixture-stale-env-key'; process.env.ALPACA_SECRET_KEY = 'fixture-stale-env-secret';
  releaseRead(null); await flush();
  expect(manager.getAlpacaState()).toMatchObject({ connected: true, apiKey: 'fixture-owner-key' });
  expect(http).toHaveBeenCalledTimes(2); expect(save).toHaveBeenCalledTimes(1);
});
test('inflight bootstrap verification finishes before queued durable owner publication', async () => {
  process.env.ALPACA_API_KEY = 'fixture-env-key'; process.env.ALPACA_SECRET_KEY = 'fixture-env-secret';
  let releaseAccount!: (value: any) => void;
  http.mockImplementationOnce(() => new Promise(resolve => { releaseAccount = resolve; }));
  const manager = new AccountManager(); await flush();
  const owner = manager.testAndSaveAlpaca('fixture-owner-key', 'fixture-owner-secret');
  expect(save).not.toHaveBeenCalled();
  releaseAccount({ data: account }); expect((await owner).success).toBe(true);
  expect(manager.getAlpacaState()).toMatchObject({ connected: true, apiKey: 'fixture-owner-key' });
  expect(decryptSecret(stored.alpacaApiKeyEnc)).toBe('fixture-owner-key');
});

test.each([true, false])('queued refresh reads current custody inside queue (refresh after owner B: %s)', async refreshAfterB => {
  const manager = await prior();
  let releaseA!: (value: any) => void;
  http.mockImplementationOnce(() => new Promise(resolve => { releaseA = resolve; }));
  const a = manager.testAndSaveAlpaca('fixture-A-key', 'fixture-A-secret');
  await flush();
  let refresh: Promise<unknown>; let b: ReturnType<typeof manager.testAndSaveAlpaca>;
  if (refreshAfterB) {
    b = manager.testAndSaveAlpaca('fixture-B-key', 'fixture-B-secret');
    refresh = manager.refreshAlpaca();
  } else {
    refresh = manager.refreshAlpaca();
    b = manager.testAndSaveAlpaca('fixture-B-key', 'fixture-B-secret');
  }
  releaseA({ data: account });
  await Promise.all([a, b, refresh]);
  expect(manager.getAlpacaState()).toMatchObject({ connected: true, apiKey: 'fixture-B-key' });
  expect(decryptSecret(stored.alpacaApiKeyEnc)).toBe('fixture-B-key');
  const accountKeys = http.mock.calls.filter(([url]) => url.endsWith('/account')).map(([, options]) => options.headers['APCA-API-KEY-ID']);
  expect(accountKeys.slice(-3)).toEqual(refreshAfterB
    ? ['fixture-A-key', 'fixture-B-key', 'fixture-B-key']
    : ['fixture-A-key', 'fixture-A-key', 'fixture-B-key']);
});
test('disconnect fences pending verification publication without claiming credential revocation', async () => {
  const manager = await prior();
  let release!: (value: any) => void;
  http.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = manager.testAndSaveAlpaca('fixture-new-key', 'fixture-new-secret');
  await flush(); manager.disconnectAlpaca(); release({ data: account });
  expect(await pending).toMatchObject({ success: false });
  expect(manager.getAlpacaState()).toMatchObject({ connected: false });
  expect(save).not.toHaveBeenCalled();
});

test('disconnect during an already-started save blocks publication while retaining durable save evidence', async () => {
  const manager = await prior(); let commit!: () => void;
  save.mockImplementationOnce((args: any) => new Promise(resolve => { commit = () => { stored = args.update; resolve(stored); }; }));
  const pending = manager.testAndSaveAlpaca('fixture-new-key', 'fixture-new-secret');
  await flush(); manager.disconnectAlpaca(); commit();
  expect(await pending).toMatchObject({ success: false });
  expect(manager.getAlpacaState().connected).toBe(false);
  expect(decryptSecret(stored.alpacaApiKeyEnc)).toBe('fixture-new-key');
});
