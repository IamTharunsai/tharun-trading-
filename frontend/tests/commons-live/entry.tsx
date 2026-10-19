import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SessionQueryProvider from '../../src/components/common/SessionQueryProvider';
import { createSessionQueryCache } from '../../src/services/sessionQueryCache';
import { teamWorkspaceQueryKey } from '../../src/services/teamWorkspaceQuery';
import { LoadedTeamReadback } from '../../src/utils/teamWorkspaceAdapter';
import { useStore } from '../../src/store';
import TeamWorkspacePage from '../../src/pages/TeamWorkspace';
import WorkspaceDirectoryPage from '../../src/pages/WorkspaceDirectory';

const cache = createSessionQueryCache(useStore);
// CI fixture control only. Actual page, auth epoch, cache provider and Axios interceptors remain intact.
const control = {
  signIn(actor: string) { useStore.getState().setAuth(`dummy-${actor}`, { id: actor }); },
  signOut() { useStore.getState().logout(); },
  auth() { const state = useStore.getState(); return { signedIn: !!state.token, epoch: state.authEpoch, cacheEpoch: cache.getSnapshot().epoch }; },
  ageReadback() {
    const key = teamWorkspaceQueryKey(useStore.getState().authEpoch);
    cache.getSnapshot().client.setQueryData<LoadedTeamReadback>(key, old => old ? { ...old, receivedAt: Date.now() - 60_000 } : old);
  },
};
declare global { interface Window { commonsFixture: typeof control } }
window.commonsFixture = control;
createRoot(document.getElementById('root')!).render(<MemoryRouter><SessionQueryProvider cache={cache}><Routes>
  <Route path="/" element={<TeamWorkspacePage />} />
  <Route path="/city" element={<WorkspaceDirectoryPage />} />
  <Route path="/offices/:officeId" element={<WorkspaceDirectoryPage />} />
</Routes></SessionQueryProvider></MemoryRouter>);
