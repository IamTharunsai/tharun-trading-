import axios, { AxiosInstance } from 'axios';
import { parseTeamSessionSnapshot } from './teamSessionSnapshot';
import { LoadedTeamReadback } from '../utils/teamWorkspaceAdapter';

export interface TeamReadbackAuth { token: string | null; authEpoch: number }
export interface TeamReadbackAuthSource { getState: () => TeamReadbackAuth }
export type TeamReadbackClient = Pick<AxiosInstance, 'get'>;
export const TEAM_READBACK_POLL_MS = 10_000;
export const teamWorkspaceQueryKey = (authEpoch: number) => ['team-workspace', 'server-sessions', authEpoch] as const;

/** The existing session API captures credentials synchronously; never store a token in a query key. */
export function teamWorkspaceQueryOptions(auth: TeamReadbackAuthSource, client: TeamReadbackClient, session: TeamReadbackAuth) {
  const current = () => !!session.token && auth.getState().authEpoch === session.authEpoch && auth.getState().token === session.token;
  return { queryKey: teamWorkspaceQueryKey(session.authEpoch), enabled: !!session.token,
    placeholderData: undefined, structuralSharing: false as const, staleTime: 5000, gcTime: 0,
    refetchInterval: TEAM_READBACK_POLL_MS, refetchIntervalInBackground: false, refetchOnWindowFocus: true, refetchOnReconnect: true,
    refetchOnMount: 'always' as const, retry: false as const,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<LoadedTeamReadback> => {
      if (!current() || signal.aborted) throw new axios.CanceledError('Authentication session changed');
      const response = await client.get<unknown>('/agents/sessions', { signal, timeout: 5000 });
      if (!current() || signal.aborted) throw new axios.CanceledError('Authentication session changed');
      const snapshot = parseTeamSessionSnapshot(response.data);
      return { snapshot, receivedAt: Date.now(), authEpoch: session.authEpoch };
    } };
}
