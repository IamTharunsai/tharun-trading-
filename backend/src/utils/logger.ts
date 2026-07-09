import winston from 'winston';

// Error instances have non-enumerable message/stack, so a bare Error nested in
// a meta field (e.g. logger.error('x failed', { err })) serializes to `{}`.
// Unwrap any Error found in top-level meta fields before formatting.
const unwrapNestedErrors = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (info[key] instanceof Error) {
      const err = info[key] as Error;
      info[key] = { ...err, message: err.message, stack: err.stack };
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
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});
