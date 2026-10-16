jest.mock('../src/utils/prisma', () => ({ prisma: { user: { findUnique: jest.fn() }, revokedToken: { findUnique: jest.fn() } } }));
jest.mock('../src/utils/config', () => ({ appConfig: { JWT_SECRET: 'fixture-only-team-session-secret', OWNER_EMAIL: 'configured@example.test' } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
import express from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/utils/prisma';
import { agentSessionsRouter } from '../src/routes/agentSessions';
import { teamSessionRegistry } from '../src/services/teamSessions';

const routes = express.Router(); routes.use('/api/agents/sessions', agentSessionsRouter);
const owner = { id: 'fixture-owner', email: 'owner@example.test', role: 'OWNER' };
const readback = jest.spyOn(teamSessionRegistry, 'snapshot');
let serial = 0;
const token = (userId = owner.id, role = 'MEMBER') => jwt.sign({ userId, role, jti: `fixture-${++serial}` }, 'fixture-only-team-session-secret', { algorithm: 'HS256', expiresIn: '1h' });
beforeEach(() => {
  jest.clearAllMocks();
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(owner);
  (prisma.revokedToken.findUnique as jest.Mock).mockResolvedValue(null);
});
function request(bearer?: string, method = 'GET') {
  return new Promise<any>((resolve, reject) => {
    const headers: Record<string, unknown> = {};
    const res: any = { statusCode: 200, headers };
    res.setHeader = (name: string, value: unknown) => { headers[name.toLowerCase()] = value; return res; };
    res.status = (status: number) => { res.statusCode = status; return res; };
    res.json = (payload: unknown) => { res.payload = payload; resolve(res); return res; };
    (routes as any).handle({ method, url: '/api/agents/sessions', headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, query: {}, body: {} }, res,
      (error: unknown) => error ? reject(error) : resolve({ ...res, statusCode: 404 }));
  });
}

test('real expiring JWT with current owner reads actual observed research and no-store', async () => {
  const debateId = 'route-research-fixture';
  teamSessionRegistry.observe({ debateId, asset: 'BTC/USD', market: 'crypto', purpose: 'RESEARCH', marketSnapshotAt: 123 }, 'debate:start', { debateId }, false);
  const response = await request(token());
  expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  expect(response.payload.sessions.find((s: any) => s.id === debateId)).toMatchObject({ market: 'crypto', purpose: 'RESEARCH', agents: {} });
  expect(response.payload.semantics.executionLiveness).toBe('unknown'); expect(readback).toHaveBeenCalledTimes(1);
});

test.each(['anonymous', 'invalid', 'expired', 'revoked', 'deleted', 'member', 'demoted', 'store-unavailable'])('%s cannot read registry state', async actor => {
  let bearer: string | undefined = token();
  if (actor === 'anonymous') bearer = undefined;
  if (actor === 'invalid') bearer = 'invalid';
  if (actor === 'expired') bearer = jwt.sign({ userId: owner.id, exp: 1 }, 'fixture-only-team-session-secret');
  if (actor === 'revoked') (prisma.revokedToken.findUnique as jest.Mock).mockResolvedValue({ token: 'fixture' });
  if (actor === 'deleted') (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
  if (actor === 'member' || actor === 'demoted') {
    bearer = token(owner.id, 'OWNER'); (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...owner, role: 'MEMBER' });
  }
  if (actor === 'store-unavailable') (prisma.revokedToken.findUnique as jest.Mock).mockRejectedValue(new Error('PRIVATE_STORE_DETAIL'));
  const response = await request(bearer);
  expect(response.statusCode).toBe(actor === 'store-unavailable' ? 503 : actor === 'member' || actor === 'demoted' ? 403 : 401);
  expect(readback).not.toHaveBeenCalled(); expect(JSON.stringify(response.payload)).not.toContain('PRIVATE_');
});

test('current demotion/deletion after a successful read and configured-owner policy use current DB state', async () => {
  const bearer = token(); expect((await request(bearer)).statusCode).toBe(200);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...owner, role: 'MEMBER' });
  expect((await request(bearer)).statusCode).toBe(403);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(null); expect((await request(bearer)).statusCode).toBe(401);
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...owner, email: 'configured@example.test', role: 'MEMBER' });
  expect((await request(bearer)).statusCode).toBe(200);
});

test('the readback router registers no mutation handler', async () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) expect((await request(token(), method)).statusCode).toBe(404);
  expect(readback).not.toHaveBeenCalled();
});
