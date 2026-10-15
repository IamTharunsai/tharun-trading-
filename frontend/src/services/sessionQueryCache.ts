import { QueryClient } from '@tanstack/react-query';

interface AuthSnapshot { token: string | null }
interface AuthSource {
  getState: () => AuthSnapshot;
  subscribe: (listener: (state: AuthSnapshot) => void) => () => void;
}

export interface SessionQuerySnapshot {
  readonly client: QueryClient;
  /** A local remount key, never a credential or a user identifier. */
  readonly epoch: number;
}

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 2, staleTime: 5000, refetchInterval: 30000 } },
  });
}

function retire(client: QueryClient): void {
  // Cancellation starts immediately; clearing must not wait for transport abort.
  // A provider may ignore AbortSignal, so isolation also requires a new client.
  void client.cancelQueries();
  client.clear();
}

/**
 * Bind before rendering the application. Zustand notifies this subscription
 * synchronously, so the next session gets a new client before React renders it.
 * Credentials stay inside this closure and never enter keys or snapshots.
 */
export function createSessionQueryCache(auth: AuthSource) {
  let identity = auth.getState().token;
  let snapshot: SessionQuerySnapshot = { client: newClient(), epoch: 0 };
  let disposed = false;
  const listeners = new Set<() => void>();
  const unsubscribeAuth = auth.subscribe(state => {
    if (disposed || state.token === identity) return;
    identity = state.token;
    const previous = snapshot.client;
    snapshot = { client: newClient(), epoch: snapshot.epoch + 1 };
    retire(previous);
    listeners.forEach(listener => listener());
  });

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeAuth();
      listeners.clear();
      retire(snapshot.client);
      identity = null;
    },
  };
}

export type SessionQueryCache = ReturnType<typeof createSessionQueryCache>;
