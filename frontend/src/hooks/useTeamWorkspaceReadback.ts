import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { useStore } from '../store';
import { TeamReadbackAuth, TeamReadbackAuthSource, TeamReadbackClient, teamWorkspaceQueryOptions } from '../services/teamWorkspaceQuery';
import { projectTeamWorkspaceReadback } from '../utils/teamWorkspaceAdapter';

/** Shared hook core permits actual QueryClient/render fixtures with offline session-aware clients. */
export function useTeamWorkspaceReadbackForSession(session: TeamReadbackAuth, auth: TeamReadbackAuthSource, client: TeamReadbackClient) {
  const query = useQuery(teamWorkspaceQueryOptions(auth, client, session));
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!session.token) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [session.authEpoch, session.token]);
  const current = auth.getState();
  const belongs = current.authEpoch === session.authEpoch && current.token === session.token;
  const projection = projectTeamWorkspaceReadback({ tokenPresent: belongs && !!current.token, authEpoch: session.authEpoch,
    data: belongs ? query.data : undefined, error: belongs && query.isError ? query.error : undefined,
    isFetching: belongs && query.isFetching, now: Math.max(now, query.dataUpdatedAt) });
  return { ...projection, isRefreshing: belongs && query.isFetching,
    refresh: async () => {
      const latest = auth.getState();
      if (!latest.token || latest.authEpoch !== session.authEpoch || latest.token !== session.token) return;
      await query.refetch();
    } };
}

/** Use beneath the existing SessionQueryProvider; that provider remounts on identity/epoch changes. */
export function useTeamWorkspaceReadback() {
  const token = useStore(state => state.token), authEpoch = useStore(state => state.authEpoch);
  return useTeamWorkspaceReadbackForSession({ token, authEpoch }, useStore, api);
}
