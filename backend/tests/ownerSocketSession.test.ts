import jwt from 'jsonwebtoken';
import { EventEmitter } from 'events';
import type { Server as HttpServer } from 'http';

jest.mock('../src/utils/prisma', () => ({ prisma: {
  user: { findUnique: jest.fn() },
  revokedToken: { findUnique: jest.fn(), create: jest.fn() },
} }));
jest.mock('../src/utils/config', () => ({ appConfig: { JWT_SECRET: 'fixture-only-socket-signing-secret', OWNER_EMAIL: 'owner@example.test' } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('socket.io', () => ({ Server: jest.fn() }));

import { Server as SocketServer } from 'socket.io';
import { prisma } from '../src/utils/prisma';
import { revokeToken } from '../src/middleware/auth';
import { notifySessionRevoked } from '../src/utils/sessionRevocation';
import { authenticateSocketOwner, maintainSocketOwner, OwnerSocketLease, SOCKET_AUTH_DEADLINE_MS, SOCKET_REVALIDATE_MS } from '../src/websocket/ownerSocketSession';
import { getIO, initWebSocket } from '../src/websocket/server';

const NOW = Date.parse('2026-10-15T15:00:00Z');
const SECRET = 'fixture-only-socket-signing-secret';
const owner = { id: 'fixture-owner', email: 'owner@example.test', role: 'OWNER' };
const userLookup = prisma.user.findUnique as jest.Mock;
const revokedLookup = prisma.revokedToken.findUnique as jest.Mock;
const revokedCreate = prisma.revokedToken.create as jest.Mock;
const leases: OwnerSocketLease[] = [];
const servers: EventEmitter[] = [];
let tokenSerial = 0;
const token = (payload: Record<string, unknown> = {}, lifetime = 120) => jwt.sign({ userId: owner.id, role: 'OWNER', jti: `fixture-${++tokenSerial}`, exp: NOW / 1000 + lifetime, ...payload }, SECRET);
const leaseFor = (raw: string, invalidate = jest.fn()) => {
  const lease = maintainSocketOwner(raw, invalidate); leases.push(lease); return lease;
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.clearAllMocks();
  userLookup.mockResolvedValue(owner);
  revokedLookup.mockResolvedValue(null);
  revokedCreate.mockResolvedValue({});
});
afterEach(() => {
  for (const server of servers.splice(0)) server.emit('close');
  for (const lease of leases.splice(0)) lease.dispose();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('current database owner authority for socket admission', () => {
  it('accepts the current database owner even when a token carries an obsolete member role', async () => {
    await expect(authenticateSocketOwner(token({ role: 'MEMBER' }))).resolves.toEqual({ userId: owner.id, expiresAt: NOW + 120000 });
    expect(userLookup).toHaveBeenCalledWith({ where: { id: owner.id }, select: { id: true, email: true, role: true } });
  });
  it('accepts the configured owner email consistently with the explicit requireOwner email rule', async () => {
    userLookup.mockResolvedValue({ ...owner, role: 'MEMBER' });
    await expect(authenticateSocketOwner(token())).resolves.toMatchObject({ userId: owner.id });
  });
  it.each(['MEMBER', '', 'ADMIN'])('does not trust a JWT owner claim over database role %p', async role => {
    userLookup.mockResolvedValue({ ...owner, email: 'member@example.test', role });
    await expect(authenticateSocketOwner(token())).rejects.toThrow('unauthorized');
  });
  it('refuses deleted users and mismatched identities', async () => {
    userLookup.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...owner, id: 'different-user' });
    await expect(authenticateSocketOwner(token())).rejects.toThrow('unauthorized');
    await expect(authenticateSocketOwner(token())).rejects.toThrow('unauthorized');
  });
  it('refuses malformed, expired and non-expiring credentials before database access', async () => {
    const invalid = [null, '', 'invalid', 'x'.repeat(8193), token({}, 0), token({ userId: 12 }), jwt.sign({ userId: owner.id }, SECRET), jwt.sign({ userId: owner.id, exp: NOW / 1000 + 120 }, 'wrong-fixture-secret')];
    for (const raw of invalid) await expect(authenticateSocketOwner(raw as string)).rejects.toThrow('unauthorized');
    expect(userLookup).not.toHaveBeenCalled(); expect(revokedLookup).not.toHaveBeenCalled();
  });
  it('refuses revoked tokens and fails closed when either database check is unavailable', async () => {
    revokedLookup.mockResolvedValueOnce({ token: 'fixture-revoked' });
    await expect(authenticateSocketOwner(token())).rejects.toThrow('unauthorized');
    revokedLookup.mockRejectedValueOnce(new Error('fixture storage unavailable'));
    await expect(authenticateSocketOwner(token())).rejects.toThrow('unauthorized');
    userLookup.mockRejectedValueOnce(new Error('fixture storage unavailable'));
    await expect(authenticateSocketOwner(token())).rejects.toThrow('unauthorized');
  });
  it('bounds a stalled authority lookup and releases its deadline timer', async () => {
    revokedLookup.mockImplementationOnce(() => new Promise(() => {}));
    const refused = expect(authenticateSocketOwner(token())).rejects.toThrow('unauthorized');
    await jest.advanceTimersByTimeAsync(SOCKET_AUTH_DEADLINE_MS);
    await refused;
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('passive socket session lifetime', () => {
  it('disconnects exactly once at token expiry and removes timers/subscriptions', async () => {
    const invalidated = jest.fn(); const raw = token({}, 1);
    await leaseFor(raw, invalidated).ready;
    expect(jest.getTimerCount()).toBe(2);
    await jest.advanceTimersByTimeAsync(1000);
    expect(invalidated).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
    notifySessionRevoked(raw); expect(invalidated).toHaveBeenCalledTimes(1);
  });
  it('evicts locally before bounded persistence finishes and cleans both lifecycles', async () => {
    const invalidated = jest.fn(); const raw = token();
    const lease = leaseFor(raw, invalidated); await lease.ready;
    let finish!: (value: unknown) => void;
    revokedCreate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const persist = revokeToken(raw);
    expect(invalidated).toHaveBeenCalledTimes(1); expect(lease.isActive()).toBe(false);
    // Socket timers are disposed; the bounded REST persistence attempt owns one deadline.
    expect(jest.getTimerCount()).toBe(1);
    expect(revokedCreate).toHaveBeenCalledWith({ data: { token: raw } });
    await expect(authenticateSocketOwner(raw)).rejects.toThrow('unauthorized');
    finish({}); await expect(persist).resolves.toEqual({ persisted: true });
    expect(jest.getTimerCount()).toBe(0);
  });
  it('does not evict a different token and cleans up an explicitly disposed lease', async () => {
    const invalidated = jest.fn(); const raw = token(); const lease = leaseFor(raw, invalidated);
    await lease.ready; notifySessionRevoked(token({ userId: 'other-fixture' }));
    expect(invalidated).not.toHaveBeenCalled();
    lease.dispose(); notifySessionRevoked(raw);
    expect(invalidated).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
  });
  it.each(['demoted', 'deleted', 'revoked', 'database unavailable'])('revalidates receive-only clients after %s', async change => {
    const invalidated = jest.fn(); await leaseFor(token(), invalidated).ready;
    if (change === 'demoted') userLookup.mockResolvedValue({ ...owner, email: 'former-owner@example.test', role: 'MEMBER' });
    if (change === 'deleted') userLookup.mockResolvedValue(null);
    if (change === 'revoked') revokedLookup.mockResolvedValue({ token: 'fixture-revoked' });
    if (change === 'database unavailable') revokedLookup.mockRejectedValue(new Error('fixture unavailable'));
    await jest.advanceTimersByTimeAsync(SOCKET_REVALIDATE_MS);
    expect(invalidated).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  });
  it('has no overlapping idle authority checks and does not restart after a timed-out late result', async () => {
    const invalidated = jest.fn(); await leaseFor(token(), invalidated).ready;
    let finish!: (value: unknown) => void;
    userLookup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await jest.advanceTimersByTimeAsync(SOCKET_REVALIDATE_MS);
    expect(userLookup).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(SOCKET_AUTH_DEADLINE_MS);
    expect(invalidated).toHaveBeenCalledTimes(1);
    finish(owner); await Promise.resolve(); await Promise.resolve();
    await jest.advanceTimersByTimeAsync(SOCKET_REVALIDATE_MS);
    expect(userLookup).toHaveBeenCalledTimes(2); expect(jest.getTimerCount()).toBe(0);
  });
  it('refuses logout during initial admission even if the database result arrives afterwards', async () => {
    let finish!: (value: unknown) => void;
    userLookup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const invalidated = jest.fn(); const raw = token(); const lease = leaseFor(raw, invalidated);
    const refused = expect(lease.ready).rejects.toThrow('unauthorized');
    notifySessionRevoked(raw); finish(owner); await refused;
    expect(invalidated).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  });
});

function serverFixture(raw: unknown = token()) {
  const http = new EventEmitter(); servers.push(http);
  const io = { use: jest.fn(), on: jest.fn() };
  (SocketServer as unknown as jest.Mock).mockImplementation(() => io);
  initWebSocket(http as unknown as HttpServer);
  const socket: any = new EventEmitter();
  socket.handshake = { auth: { token: raw }, headers: {} }; socket.data = {};
  socket.conn = Object.assign(new EventEmitter(), { readyState: 'open' });
  socket.disconnect = jest.fn(() => { socket.emit('disconnect', 'server namespace disconnect'); return socket; });
  const middleware = io.use.mock.calls[0][0];
  const connected = io.on.mock.calls.find(([name]) => name === 'connection')![1];
  return { http, io, socket, middleware, connected };
}

describe('actual Socket.IO registration with dummy transports', () => {
  it('admits the verified owner and registers no socket kill-switch mutation listeners', async () => {
    const f = serverFixture(); const next = jest.fn(); await f.middleware(f.socket, next); f.connected(f.socket);
    expect(next).toHaveBeenCalledWith(); expect(f.socket.data).toMatchObject({ userId: owner.id });
    expect(f.socket.listenerCount('kill:switch:activate')).toBe(0);
    expect(f.socket.listenerCount('kill:switch:deactivate')).toBe(0);
    f.socket.emit('kill:switch:activate'); f.socket.emit('kill:switch:deactivate');
    expect(f.socket.disconnect).not.toHaveBeenCalled();
    f.socket.emit('disconnect'); expect(jest.getTimerCount()).toBe(0);
    expect(f.socket.conn.listenerCount('close')).toBe(0);
  });
  it('refuses non-owners without retaining lease timers or transport listeners', async () => {
    userLookup.mockResolvedValue({ ...owner, email: 'member@example.test', role: 'MEMBER' });
    const f = serverFixture(); const next = jest.fn(); await f.middleware(f.socket, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(jest.getTimerCount()).toBe(0); expect(f.socket.conn.listenerCount('close')).toBe(0);
  });
  it('cleans an aborted handshake even though Socket.IO disconnect was never emitted', async () => {
    let finish!: (value: unknown) => void;
    userLookup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const f = serverFixture(); const next = jest.fn(); const admission = f.middleware(f.socket, next);
    f.socket.conn.readyState = 'closed'; f.socket.conn.emit('close'); finish(owner); await admission;
    expect(next).toHaveBeenCalledWith(expect.any(Error)); expect(jest.getTimerCount()).toBe(0);
  });
  it('disconnects an admitted transport on local revocation and disposes state on server close', async () => {
    const raw = token(); const f = serverFixture(raw); await f.middleware(f.socket, jest.fn());
    notifySessionRevoked(raw);
    expect(f.socket.disconnect).toHaveBeenCalledWith(true); expect(jest.getTimerCount()).toBe(0);
    const other = serverFixture(token({ exp: NOW / 1000 + 180 })); await other.middleware(other.socket, jest.fn());
    other.http.emit('close');
    expect(other.socket.disconnect).toHaveBeenCalledWith(true); expect(jest.getTimerCount()).toBe(0);
    expect(getIO()).toBeNull();
  });
});
