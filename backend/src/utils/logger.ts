import winston from 'winston';

// Error instances have non-enumerable message/stack, so a bare Error nested in
// a meta field (e.g. logger.error('x failed', { err })) serializes to `{}`.
// Unwrap any Error found in top-level meta fields before formatting.
const unwrapNestedErrors = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (info[key] instanceof Error) {
      const err = info[key] as Error;
      // Don't spread the raw error (Axios/HTTP errors carry circular req/res refs)
      info[key] = { message: err.message, stack: err.stack };
    }
  }
  return info;
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    unwrapNestedErrors(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          if (!Object.keys(meta).length) return `${timestamp} [${level}] ${message}`;
          const seen = new WeakSet();
          const metaStr = JSON.stringify(meta, (_k, v) => {
            if (typeof v === 'object' && v !== null) {
              if (seen.has(v)) return '[Circular]';
              seen.add(v);
            }
            return v;
          });
          return `${timestamp} [${level}] ${message} ${metaStr}`;
        })
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});
