import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { TeamWorkspaceView } from '../../src/pages/TeamWorkspace';
import { workspaceFixture } from './workspaceFixture';

const root = document.getElementById('root');
if (!root) throw new Error('Missing visual fixture root');
createRoot(root).render(<MemoryRouter><TeamWorkspaceView model={workspaceFixture} onRefresh={() => undefined} onRequestResearch={() => undefined} /></MemoryRouter>);
