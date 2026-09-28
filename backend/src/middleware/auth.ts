import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { appConfig } from '../utils/config';
import { logger } from '../utils/logger';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
}

export interface AuthRequest extends Request {
  userId?: string;
  user?: AuthenticatedUser;
}

// Persistent token revocation backed by SQLite database (survives process restart)
const memoryRevocationCache = new Set<string>();

export async function revokeToken(token: string): Promise<void> {
  memoryRevocationCache.add(token);
  try {
    await prisma.revokedToken.create({ data: { token } });
    logger.info('🔒 Token revoked server-side and recorded to persistent database');
  } catch (err: any) {
    logger.warn('Failed to persist revoked token to DB', { error: err.message });
  }
}

export async function isTokenRevoked(token: string): Promise<boolean> {
  if (memoryRevocationCache.has(token)) return true;
  try {
    const record = await prisma.revokedToken.findUnique({ where: { token } });
    if (record) {
      memoryRevocationCache.add(token);
      return true;
    }
  } catch {
    // Fail safe
  }
  return false;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No valid bearer token provided.' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token is required. Please log in again.' });
  }

  const revoked = await isTokenRevoked(token);
  if (revoked) {
    return res.status(401).json({ error: 'Token has been revoked. Please log in again.' });
  }

  try {
    const decoded = jwt.verify(token, appConfig.JWT_SECRET) as { userId: string; role?: string };
    
    // Verify user exists in database
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) {
      return res.status(401).json({ error: 'User associated with this token no longer exists.' });
    }

    req.userId = user.id;
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role || 'OWNER',
    };
    next();
  } catch (err: any) {
    logger.warn('Token validation failure', { message: err.message });
    return res.status(401).json({ error: 'Session expired or token invalid. Please log in again.' });
  }
}

export async function requireOwner(req: AuthRequest, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => {
    if (req.user?.role !== 'OWNER' && req.user?.email !== appConfig.OWNER_EMAIL) {
      logger.warn(`Unauthorized attempt to access owner route: ${req.user?.email || 'anonymous'}`);
      return res.status(403).json({ error: 'Forbidden: Owner privileges required for this operation.' });
    }
    next();
  });
}
