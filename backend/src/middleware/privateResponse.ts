import { Request, Response, NextFunction } from 'express';

/** Personal account and agent responses must not enter shared HTTP caches. */
export function privateResponse(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
