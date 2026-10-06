import { useQuery } from '@tanstack/react-query';
import { getSystemStatus } from '../services/api';

/** Real system status, polled every 30s. `data` is undefined when the call fails. */
export function useSystemStatus() {
  return useQuery({
    queryKey: ['system-status'],
    queryFn: getSystemStatus,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: 1,
  });
}
