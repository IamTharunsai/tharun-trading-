import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { notifySessionRevoked, sessionTokenDigest } from '../utils/sessionRevocation';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  totpEnabled?: boolean;
  lastLogin?: Date | null;
}
export interface AuthRequest extends Request { userId?: string; user?: AuthenticatedUser }

export const AUTH_STORE_DEADLINE_MS = 3_000;
export const MAX_PENDING_AUTH_STORE_OPERATIONS = 32;
let pendingStoreOperations = 0;
class AuthStoreUnavailable extends Error {}
// Keep only digests in process memory. Existing persistent raw-token rows remain compatible.
const memoryRevocationCache = new Set<string>();
export const isTokenLocallyRevoked = (token: string): boolean => memoryRevocationCache.has(sessionTokenDigest(token));

function storeOperation<T>(work: () => PromiseLike<T>): Promise<T> {
  if (pendingStoreOperations >= MAX_PENDING_AUTH_STORE_OPERATIONS) return Promise.reject(new AuthStoreUnavailable());
  pendingStoreOperations++;
  let operation: Promise<T>;
  try { operation = Promise.resolve(work()); }
  catch (error) { pendingStoreOperations--; return Promise.reject(error); }
  // Slots remain occupied until Prisma actually settles, including after an HTTP deadline.
  return operation.finally(() => { pendingStoreOperations--; });
}
async function deadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new AuthStoreUnavailable()), AUTH_STORE_DEADLINE_MS);
      timer.unref?.();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
/** Bounds the response and pending work; it cannot cancel a query already running in Prisma. */
export function boundedAuthStore<T>(work: () => PromiseLike<T>): Promise<T> { return deadline(storeOperation(work)); }

async function readRevocation(token: string): Promise<boolean> {
  if (isTokenLocallyRevoked(token)) return true;
  const record = await storeOperation(() => prisma.revokedToken.findUnique({ where: { token }, select: { token: true } }));
  if (record) memoryRevocationCache.add(sessionTokenDigest(token));
  return !!record;
}
/** Storage errors are deliberately propagated. Unknown revocation state is never permission. */
export function isTokenRevoked(token: string): Promise<boolean> { return deadline(readRevocation(token)); }

export async function revokeToken(token: string): Promise<{ persisted: boolean }> {
  memoryRevocationCache.add(sessionTokenDigest(token));
  notifySessionRevoked(token); // Evict local sockets before waiting for persistence.
  try {
    await boundedAuthStore(() => prisma.revokedToken.create({ data: { token } }));
    return { persisted: true };
  } catch (error) {
    // The token is the table's sole unique key; a concurrent revocation is durable too.
    if ((error as { code?: string })?.code === 'P2002') return { persisted: true };
    logger.warn('Persistent session revocation unavailable');
    return { persisted: false };
  }
}

function invalid(res: Response) {
  return res.status(401).json({ code: 'AUTH_INVALID', error: 'Session expired or invalid. Please log in again.' });
}
function unavailable(res: Response) {
  res.setHeader('Retry-After', '1');
  return res.status(503).json({ code: 'AUTH_UNAVAILABLE', error: 'Authentication temporarily unavailable. Please retry.' });
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  const token = /^Bearer ([^\s]{1,8192})$/.exec(req.headers.authorization ?? '')?.[1];
  if (!token) return invalid(res);
  let claims: jwt.JwtPayload;
  try {
    // The issued-token contract is HS256 with a mandatory exp. No issuer/audience migration.
    // https://github.com/auth0/node-jsonwebtoken/tree/v9.0.2#jwtverifytoken-secretorpublickey-options-callback
    const decoded = jwt.verify(token, appConfig.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || typeof decoded.userId !== 'string' || !decoded.userId.trim()
      || decoded.userId !== decoded.userId.trim() || decoded.userId.length > 128 || /[\u0000-\u001f\u007f]/.test(decoded.userId)
      || typeof decoded.exp !== 'number' || !Number.isSafeInteger(decoded.exp * 1000) || decoded.exp * 1000 <= Date.now()) return invalid(res);
    claims = decoded;
  } catch { return invalid(res); }
  if (isTokenLocallyRevoked(token)) return invalid(res);

  let user;
  let revoked;
  try {
    // A single absolute deadline bounds both current-authority queries together.
    [user, revoked] = await deadline(Promise.all([
      storeOperation(() => prisma.user.findUnique({ where: { id: claims.userId }, select: { id: true, email: true, role: true, totpEnabled: true, lastLogin: true } })),
      readRevocation(token),
    ]));
  } catch { return unavailable(res); }
  if (revoked || isTokenLocallyRevoked(token) || claims.exp! * 1000 <= Date.now()) return invalid(res);
  if (!user || user.id !== claims.userId || typeof user.email !== 'string' || !user.email.trim()) return invalid(res);
  req.userId = user.id;
  req.user = { id: user.id, email: user.email, role: typeof user.role === 'string' ? user.role : '',
    totpEnabled: user.totpEnabled, lastLogin: user.lastLogin };
  next();
}

export async function requireOwner(req: AuthRequest, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => {
    if (req.user?.role !== 'OWNER' && !(appConfig.OWNER_EMAIL && req.user?.email === appConfig.OWNER_EMAIL)) {
      return res.status(403).json({ error: 'Forbidden: Owner privileges required for this operation.' });
    }
    next();
  });
}
