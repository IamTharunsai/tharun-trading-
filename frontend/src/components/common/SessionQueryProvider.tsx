import { ReactNode, useSyncExternalStore } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SessionQueryCache } from '../../services/sessionQueryCache';

export default function SessionQueryProvider({ cache, children }: {
  cache: SessionQueryCache;
  children: ReactNode;
}) {
  const { client, epoch } = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  // The key also removes component-local previous results and old observers.
  // Replacing only the context client would leave that subtree mounted.
  return <QueryClientProvider key={epoch} client={client}>{children}</QueryClientProvider>;
}
