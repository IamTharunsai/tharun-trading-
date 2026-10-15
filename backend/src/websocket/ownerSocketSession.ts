import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { appConfig } from '../utils/config';
import { isTokenLocallyRevoked } from '../middleware/auth';
import { onSessionRevoked, sessionTokenDigest } from '../utils/sessionRevocation';

export const SOCKET_REVALIDATE_MS = 30_000;
export const SOCKET_AUTH_DEADLINE_MS = 3_000;
const MAX_TIMER_MS = 2_147_483_647;

interface OwnerSocketIdentity { userId: string; expiresAt: number }
export interface OwnerSocketLease {
  ready: Promise<OwnerSocketIdentity>;
  isActive: () => boolean;
  dispose: () => void;
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('unauthorized')), SOCKET_AUTH_DEADLINE_MS);
        timer.unref?.();
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Socket admission deliberately does not use the HTTP revocation check's fail-open fallback. */
export async function authenticateSocketOwner(token: string): Promise<OwnerSocketIdentity> {
  try {
    if (typeof token !== 'string' || token.length === 0 || token.length > 8192 || isTokenLocallyRevoked(token)) throw new Error();
    const decoded = jwt.verify(token, appConfig.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || typeof decoded.userId !== 'string' || !decoded.userId || decoded.userId.length > 128
      || typeof decoded.exp !== 'number' || !Number.isSafeInteger(decoded.exp * 1000) || decoded.exp * 1000 <= Date.now()) throw new Error();
    const [user, revoked] = await bounded(Promise.all([
      prisma.user.findUnique({ where: { id: decoded.userId }, select: { id: true, email: true, role: true } }),
      prisma.revokedToken.findUnique({ where: { token }, select: { token: true } }),
    ]));
    // Match requireOwner's explicit role/configured-email permissions using the current database user.
    // An empty/unknown database role is not promoted to OWNER.
    if (!user || user.id !== decoded.userId || revoked || isTokenLocallyRevoked(token)
      || (user.role !== 'OWNER' && !(appConfig.OWNER_EMAIL && user.email === appConfig.OWNER_EMAIL))
      || decoded.exp * 1000 <= Date.now()) throw new Error();
    return { userId: user.id, expiresAt: decoded.exp * 1000 };
  } catch { throw new Error('unauthorized'); }
}

/**
 * One expiry timer and one sequential revalidation timer per lease, plus a bounded query deadline.
 * A receive-only socket is rechecked every 30s; database queries may add up to 3s (event-loop stalls excluded).
 * Query timeout invalidates the lease; it does not cancel a query already running in Prisma.
 */
export function maintainSocketOwner(token: string, invalidate: () => void): OwnerSocketLease {
  let stopped = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let validationTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = () => {};
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    if (expiryTimer) clearTimeout(expiryTimer);
    if (validationTimer) clearTimeout(validationTimer);
    unsubscribe();
  };
  const rejectSession = () => {
    if (stopped) return;
    dispose();
    invalidate();
  };
  const digest = sessionTokenDigest(token);
  // Subscribe before the first database read so logout during admission cannot slip through.
  unsubscribe = onSessionRevoked(revoked => { if (revoked === digest) rejectSession(); });

  const scheduleExpiry = (expiresAt: number) => {
    if (stopped) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return rejectSession();
    expiryTimer = setTimeout(() => scheduleExpiry(expiresAt), Math.min(remaining, MAX_TIMER_MS));
    expiryTimer.unref?.();
  };
  const scheduleValidation = (startedAt: number) => {
    if (stopped) return;
    validationTimer = setTimeout(async () => {
      if (stopped) return;
      const started = Date.now();
      try {
        await authenticateSocketOwner(token);
        if (!stopped) scheduleValidation(started);
      } catch { rejectSession(); }
    }, Math.max(0, SOCKET_REVALIDATE_MS - (Date.now() - startedAt)));
    validationTimer.unref?.();
  };
  const ready = (async () => {
    const started = Date.now();
    const identity = await authenticateSocketOwner(token);
    if (stopped) throw new Error('unauthorized');
    scheduleExpiry(identity.expiresAt);
    scheduleValidation(started);
    return identity;
  })().catch(() => { dispose(); throw new Error('unauthorized'); });

  return { ready, isActive: () => !stopped, dispose };
}
