import jwt from 'jsonwebtoken';
import express from 'express';

jest.mock('../src/utils/prisma', () => ({ prisma: {
  user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}), findFirst: jest.fn(), create: jest.fn() },
  revokedToken: { findUnique: jest.fn(), create: jest.fn() }, authAuditLog: { create: jest.fn().mockResolvedValue({}) },
} }));
jest.mock('../src/utils/config', () => ({ appConfig: { JWT_SECRET: 'fixture-only-rest-session-secret', OWNER_EMAIL: 'configured@example.test' } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/utils/redis', () => ({ redis: {} }));
jest.mock('bcryptjs', () => ({ compare: jest.fn().mockResolvedValue(true), hash: jest.fn().mockResolvedValue('fixture-hash') }));
jest.mock('speakeasy', () => ({}));
jest.mock('express-rate-limit', () => () => (_req: any, _res: any, next: any) => next());
jest.mock('axios', () => ({ get: jest.fn(() => { throw new Error('Unexpected provider request'); }) }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));
jest.mock('../src/agents/orchestrator', () => ({ activateKillSwitch: jest.fn(), deactivateKillSwitch: jest.fn(), isKillSwitchActive: jest.fn() }));
jest.mock('../src/trading/riskManager', () => ({ closePosition: jest.fn() }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrices: jest.fn() }));
jest.mock('../src/services/groundedDeepDive', () => ({ parseDeepDiveInput: jest.fn(), runGroundedDeepDive: jest.fn(), DeepDiveUnavailable: class extends Error {} }));
jest.mock('../src/routes/backtest', () => ({ __esModule: true, default: require('express').Router() }));
jest.mock('../src/routes/chat', () => ({ chatRouter: require('express').Router() }));
jest.mock('../src/routes/intelligence', () => ({ __esModule: true, default: require('express').Router() }));
jest.mock('../src/routes/agentMonitor', () => ({ __esModule: true, default: require('express').Router() }));

import { prisma } from '../src/utils/prisma';
import { logger } from '../src/utils/logger';
import { requireAuth, requireOwner, revokeToken, isTokenRevoked, isTokenLocallyRevoked, AUTH_STORE_DEADLINE_MS, MAX_PENDING_AUTH_STORE_OPERATIONS } from '../src/middleware/auth';
import { onSessionRevoked } from '../src/utils/sessionRevocation';
import authRouter from '../src/routes/auth';

const NOW = Date.parse('2026-10-15T18:00:00Z');
const SECRET = 'fixture-only-rest-session-secret';
const owner = { id: 'fixture-owner', email: 'owner@example.test', role: 'OWNER', totpEnabled: false, lastLogin: null, passwordHash: 'PRIVATE_HASH' };
const userLookup = prisma.user.findUnique as jest.Mock;
const revokedLookup = prisma.revokedToken.findUnique as jest.Mock;
const revokedCreate = prisma.revokedToken.create as jest.Mock;
const privateWork = jest.fn();
const router = express.Router();
router.use('/api/auth', authRouter);
router.get('/private', requireOwner, (_req, res) => { privateWork(); res.json({ marker: 'PRIVATE_OWNER' }); });
router.get('/member', requireAuth, (_req, res) => res.json({ marker: 'MARKET_ONLY' }));
let serial = 0;
const token = (payload: Record<string, unknown> = {}, algorithm: jwt.Algorithm = 'HS256', secret = SECRET) =>
  jwt.sign({ userId: owner.id, exp: NOW / 1000 + 7200, jti: `fixture-${++serial}`, ...payload }, secret, { algorithm });
const rawClaims = (payload: unknown) => jwt.sign(JSON.stringify(payload), SECRET, { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => {
  jest.useFakeTimers({ now: NOW }); jest.clearAllMocks();
  userLookup.mockResolvedValue(owner); revokedLookup.mockResolvedValue(null); revokedCreate.mockResolvedValue({});
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
function request(path: string, bearer?: string, method = 'GET', body: unknown = {}) {
  return new Promise<any>((resolve, reject) => {
    const headers: Record<string, unknown> = {};
    const response: any = { statusCode: 200, headers };
    response.setHeader = (name: string, value: unknown) => { headers[name.toLowerCase()] = value; return response; };
    response.status = (status: number) => { response.statusCode = status; return response; };
    response.json = (payload: unknown) => { response.payload = payload; resolve(response); return response; };
    (router as any).handle({ method, url: path, headers: bearer ? { authorization: bearer } : {}, body, query: {}, socket: {}, ip: 'fixture' }, response,
      (error: unknown) => error ? reject(error) : resolve({ ...response, statusCode: 404 }));
  });
}

test('accepts an actual HS256 expiring token and only current database authority', async () => {
  const response = await request('/private', `Bearer ${token({ role: 'MEMBER' })}`);
  expect(response.statusCode).toBe(200); expect(privateWork).toHaveBeenCalledTimes(1);
  expect(userLookup).toHaveBeenCalledWith(expect.objectContaining({ where: { id: owner.id } }));
  expect(response.headers['cache-control']).toBe('no-store');
});
test('preserves valid legacy tokens without a jti', async () => {
  const legacy = jwt.sign({ userId: owner.id, exp: NOW / 1000 + 7200 }, SECRET, { algorithm: 'HS256' });
  expect((await request('/private', `Bearer ${legacy}`)).statusCode).toBe(200);
});
test.each(['MEMBER', 'ADMIN', '', null, undefined])('never promotes current database role %p from an OWNER token', async role => {
  userLookup.mockResolvedValue({ ...owner, role });
  expect((await request('/private', `Bearer ${token({ role: 'OWNER' })}`)).statusCode).toBe(403);
  expect(privateWork).not.toHaveBeenCalled();
});
test('preserves configured current owner email without trusting token email', async () => {
  userLookup.mockResolvedValue({ ...owner, email: 'configured@example.test', role: '' });
  expect((await request('/private', `Bearer ${token({ email: 'other@example.test' })}`)).statusCode).toBe(200);
  userLookup.mockResolvedValue({ ...owner, email: 'member@example.test', role: 'MEMBER' });
  expect((await request('/private', `Bearer ${token({ email: 'configured@example.test' })}`)).statusCode).toBe(403);
});
test.each([null, { ...owner, id: 'mismatched' }, { ...owner, email: '' }])('invalid current database identity returns 401', async current => {
  userLookup.mockResolvedValue(current);
  expect((await request('/private', `Bearer ${token()}`)).statusCode).toBe(401);
  expect(privateWork).not.toHaveBeenCalled();
});
test('rejects malformed signatures, algorithms, missing/invalid claims before database access', async () => {
  const invalid = [undefined, 'Bearer', 'Basic fixture', 'Bearer invalid', `Bearer ${'x'.repeat(8193)}`,
    `Bearer ${token()} extra`, `Bearer ${token({}, 'HS384')}`, `Bearer ${token({}, 'none', '')}`, `Bearer ${token({}, 'HS256', 'wrong-secret')}`,
    `Bearer ${token({ exp: NOW / 1000 })}`, `Bearer ${token({ nbf: NOW / 1000 + 60 })}`, `Bearer ${jwt.sign({ userId: owner.id }, SECRET)}`,
    `Bearer ${rawClaims('string')}`, ...[null, 4, '', '   ', ' x', 'x ', 'x'.repeat(129), 'x\u0000y'].map(userId => `Bearer ${rawClaims({ userId, exp: NOW / 1000 + 60 })}`),
    ...[null, 'later', 1e20].map(exp => `Bearer ${rawClaims({ userId: owner.id, exp })}`)];
  for (const bearer of invalid) expect((await request('/private', bearer)).statusCode).toBe(401);
  expect(userLookup).not.toHaveBeenCalled(); expect(revokedLookup).not.toHaveBeenCalled(); expect(privateWork).not.toHaveBeenCalled();
});
test.each(['user', 'revocation'])('%s lookup failure is a bounded 503, never private permission or a false invalid-session response', async failed => {
  (failed === 'user' ? userLookup : revokedLookup).mockRejectedValue(new Error('PRIVATE_DATABASE_DETAIL'));
  const response = await request('/private', `Bearer ${token()}`);
  expect(response.statusCode).toBe(503); expect(response.payload.code).toBe('AUTH_UNAVAILABLE');
  expect(response.headers['retry-after']).toBe('1'); expect(privateWork).not.toHaveBeenCalled();
  expect(JSON.stringify([response.payload, (logger.warn as jest.Mock).mock.calls])).not.toContain('PRIVATE_DATABASE_DETAIL');
});
test('persistent revocation lookup errors propagate rather than returning not-revoked', async () => {
  revokedLookup.mockRejectedValue(new Error('fixture offline'));
  await expect(isTokenRevoked(token())).rejects.toThrow('fixture offline');
});
test('revoked credentials return 401 and never reach private work', async () => {
  revokedLookup.mockResolvedValue({ token: 'fixture' });
  expect((await request('/private', `Bearer ${token()}`)).statusCode).toBe(401);
  expect(privateWork).not.toHaveBeenCalled();
});
test('one absolute deadline denies stalled authority and ignores a late successful lookup', async () => {
  const delayed = deferred<typeof owner>(); userLookup.mockReturnValueOnce(delayed.promise);
  const pending = request('/private', `Bearer ${token()}`);
  await jest.advanceTimersByTimeAsync(AUTH_STORE_DEADLINE_MS);
  expect((await pending).statusCode).toBe(503); expect(privateWork).not.toHaveBeenCalled();
  delayed.resolve(owner); await delayed.promise; await Promise.resolve();
  expect(privateWork).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
test('expiry and local revocation during a database read are rechecked before next', async () => {
  const delayed = deferred<typeof owner>(); userLookup.mockReturnValueOnce(delayed.promise);
  const pending = request('/private', `Bearer ${token({ exp: NOW / 1000 + 1 })}`);
  await jest.advanceTimersByTimeAsync(1000); delayed.resolve(owner);
  expect((await pending).statusCode).toBe(401);
  const next = deferred<typeof owner>(); userLookup.mockReturnValueOnce(next.promise);
  const raw = token(); const raced = request('/private', `Bearer ${raw}`);
  await revokeToken(raw); next.resolve(owner);
  expect((await raced).statusCode).toBe(401); expect(privateWork).not.toHaveBeenCalled();
});
test('caps outstanding store work even after request deadlines, then recovers when queries settle', async () => {
  const delayed = deferred<any>(); userLookup.mockReturnValue(delayed.promise); revokedLookup.mockReturnValue(delayed.promise);
  const pending = Array.from({ length: MAX_PENDING_AUTH_STORE_OPERATIONS * 2 }, () => request('/private', `Bearer ${token()}`));
  await jest.advanceTimersByTimeAsync(AUTH_STORE_DEADLINE_MS);
  expect((await Promise.all(pending)).every(response => response.statusCode === 503)).toBe(true);
  expect(userLookup.mock.calls.length + revokedLookup.mock.calls.length).toBe(MAX_PENDING_AUTH_STORE_OPERATIONS);
  expect(privateWork).not.toHaveBeenCalled();
  delayed.resolve(null); await delayed.promise; await Promise.resolve(); await Promise.resolve();
  userLookup.mockResolvedValue(owner); revokedLookup.mockResolvedValue(null);
  expect((await request('/private', `Bearer ${token()}`)).statusCode).toBe(200);
});
test('real login issues the existing two-hour HS256 contract and me projects the current identity once', async () => {
  const login = await request('/api/auth/login', undefined, 'POST', { email: owner.email, password: 'fixture-password' });
  expect(login.statusCode).toBe(200);
  const claims = jwt.verify(login.payload.token, SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  expect(claims.userId).toBe(owner.id); expect(claims.exp).toBe(NOW / 1000 + 7200); expect(claims.iss).toBeUndefined(); expect(claims.aud).toBeUndefined();
  userLookup.mockClear();
  const me = await request('/api/auth/me', `Bearer ${login.payload.token}`);
  expect(me.statusCode).toBe(200); expect(userLookup).toHaveBeenCalledTimes(1);
  expect(me.payload).toEqual({ id: owner.id, email: owner.email, role: 'OWNER', totpEnabled: false, lastLogin: null });
  expect(JSON.stringify(me.payload)).not.toContain('PRIVATE_HASH');
});
test('logout confirms only durable revocation and immediately notifies local transports', async () => {
  const raw = token(); const invalidated = jest.fn(); const stop = onSessionRevoked(invalidated);
  try {
    const response = await request('/api/auth/logout', `Bearer ${raw}`, 'POST');
    expect(response.statusCode).toBe(200); expect(response.payload).toMatchObject({ success: true, revocationConfirmed: true });
    expect(revokedCreate).toHaveBeenCalledWith({ data: { token: raw } }); expect(invalidated).toHaveBeenCalledTimes(1);
    expect((await request('/private', `Bearer ${raw}`)).statusCode).toBe(401);
  } finally { stop(); }
});
test('same-clock logins have fresh cryptographic session IDs and revoking one cannot conflate the other', async () => {
  const first = await request('/api/auth/login', undefined, 'POST', { email: owner.email, password: 'fixture-password' });
  const second = await request('/api/auth/login', undefined, 'POST', { email: owner.email, password: 'fixture-password' });
  expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200);
  const oldToken = first.payload.token; const freshToken = second.payload.token;
  const oldClaims = jwt.verify(oldToken, SECRET) as jwt.JwtPayload;
  const freshClaims = jwt.verify(freshToken, SECRET) as jwt.JwtPayload;
  expect(oldClaims.iat).toBe(freshClaims.iat); expect(oldToken).not.toBe(freshToken);
  expect(oldClaims.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(freshClaims.jti).not.toBe(oldClaims.jti);
  const persisted = new Set<string>();
  revokedCreate.mockImplementation(({ data }) => { persisted.add(data.token); return Promise.resolve({}); });
  revokedLookup.mockImplementation(({ where }) => Promise.resolve(persisted.has(where.token) ? { token: where.token } : null));
  expect((await request('/api/auth/logout', `Bearer ${oldToken}`, 'POST')).payload.revocationConfirmed).toBe(true);
  expect(isTokenLocallyRevoked(oldToken)).toBe(true); expect(isTokenLocallyRevoked(freshToken)).toBe(false);
  expect(await isTokenRevoked(freshToken)).toBe(false);
  expect((await request('/private', `Bearer ${oldToken}`)).statusCode).toBe(401);
  expect((await request('/private', `Bearer ${freshToken}`)).statusCode).toBe(200);
});
test('failed persistent logout stays locally revoked but never claims global invalidation or leaks raw errors/tokens', async () => {
  const raw = token(); revokedCreate.mockRejectedValue(new Error(`PRIVATE_DATABASE_DETAIL ${raw}`));
  const response = await request('/api/auth/logout', `Bearer ${raw}`, 'POST');
  expect(response.statusCode).toBe(503); expect(response.payload).toMatchObject({ success: false, revocationConfirmed: false, code: 'LOGOUT_UNCONFIRMED' });
  expect(await isTokenRevoked(raw)).toBe(true); expect((await request('/private', `Bearer ${raw}`)).statusCode).toBe(401);
  expect(JSON.stringify([response.payload, (logger.warn as jest.Mock).mock.calls])).not.toContain(raw);
  expect(JSON.stringify(response.payload)).not.toContain('PRIVATE_DATABASE_DETAIL');
});
test('stalled logout persistence returns unconfirmed at the deadline and cannot later send success', async () => {
  const delayed = deferred<any>(); revokedCreate.mockReturnValueOnce(delayed.promise);
  const pending = request('/api/auth/logout', `Bearer ${token()}`, 'POST');
  await jest.advanceTimersByTimeAsync(AUTH_STORE_DEADLINE_MS);
  const response = await pending; expect(response.statusCode).toBe(503); expect(response.payload.revocationConfirmed).toBe(false);
  delayed.resolve({}); await delayed.promise; await Promise.resolve();
  expect(response.payload.revocationConfirmed).toBe(false); expect(jest.getTimerCount()).toBe(0);
});
test('a concurrent duplicate durable revocation is confirmed', async () => {
  revokedCreate.mockRejectedValue(Object.assign(new Error('fixture duplicate'), { code: 'P2002' }));
  const response = await request('/api/auth/logout', `Bearer ${token()}`, 'POST');
  expect(response.statusCode).toBe(200); expect(response.payload.revocationConfirmed).toBe(true);
});
