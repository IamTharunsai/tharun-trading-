import { createRoot } from 'react-dom/client';
import TeamWorkspacePage from '../../src/pages/TeamWorkspace';

const root = document.getElementById('root');
if (!root) throw new Error('Missing visual fixture root');
createRoot(root).render(<TeamWorkspacePage />);
