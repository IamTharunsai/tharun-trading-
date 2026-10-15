import { createHash } from 'crypto';

type RevocationListener = (digest: string) => void;
const listeners = new Set<RevocationListener>();

export function sessionTokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Process-local notification only. Persistent revocation is still checked in the database. */
export function notifySessionRevoked(token: string): void {
  const digest = sessionTokenDigest(token);
  for (const listener of [...listeners]) {
    // A transport cleanup failure must not prevent persistent logout/revocation.
    try { listener(digest); } catch { /* Other sessions still need notification. */ }
  }
}

export function onSessionRevoked(listener: RevocationListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
