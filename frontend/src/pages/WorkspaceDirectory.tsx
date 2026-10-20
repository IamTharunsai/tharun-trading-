import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Search } from 'lucide-react';
import crest from '../../../assets/brand/bhishma-dog-crest.png';
import courtyard from '../../../assets/plates/atrium-courtyard.png';
import '../styles/rainlight-layout.css';
import '../styles/workspace-directory.css';

// Navigation only: office membership conveys purpose, never provider readiness.
export const WORKSPACE_OFFICES = [
  { id: 'council', name: 'Council office', purpose: 'Follow the team from a question to recorded evidence.', rooms: [
    ['agents', 'Specialist council'], ['agents/debate-room', 'Debates & research'], ['agents/monitor', 'Activity monitor'], ['agents/chat', 'Team conversation'],
  ] },
  { id: 'markets', name: 'Market observatory', purpose: 'Explore instruments, charts and market context.', rooms: [
    ['stocks', 'Stock universe'], ['charts', 'Charts'], ['quote', 'Instrument quotes'], ['screener', 'Market screener'], ['options', 'Options chain'], ['macro', 'Macro dashboard'],
  ] },
  { id: 'prediction', name: 'Prediction exchange', purpose: 'Inspect prediction markets and their execution state.', rooms: [
    ['polymarket', 'Polymarket'],
  ] },
  { id: 'research', name: 'Research library', purpose: 'Review models, sources and strategy experiments.', rooms: [
    ['multi-agent', 'Multi-agent research'], ['alternative-data', 'Alternative data'], ['forecaster', 'Price forecasts'], ['crypto-strategy', 'Crypto strategy'], ['backtest', 'Backtest hub'], ['insider', 'Insider transactions'],
  ] },
  { id: 'portfolio', name: 'Portfolio office', purpose: 'Reconcile decisions with positions, trades and outcomes.', rooms: [
    ['dashboard', 'Trading dashboard'], ['portfolio', 'Portfolio & risk'], ['trades', 'Trade ledger'], ['analytics', 'Analytics'], ['tearsheet', 'Performance report'], ['journal', 'Trade journal'], ['investment', 'Investment plan'], ['copy-trading', 'Copy trading'],
  ] },
  { id: 'news', name: 'Newsroom', purpose: 'Read the market backdrop and daily coverage.', rooms: [
    ['news', 'News wire'], ['recap', 'Market recap'], ['live-tv', 'Financial television'],
  ] },
  { id: 'operations', name: 'Operations office', purpose: 'Manage account connections and platform preferences.', rooms: [
    ['settings', 'Settings & connections'],
  ] },
] as const;

export default function WorkspaceDirectoryPage() {
  const { officeId } = useParams();
  const [query, setQuery] = useState('');
  const office = WORKSPACE_OFFICES.find(item => item.id === officeId);
  const invalid = Boolean(officeId && !office);
  const search = query.trim().toLocaleLowerCase();
  const offices = (office ? [office] : WORKSPACE_OFFICES).filter(item =>
    `${item.name} ${item.purpose} ${item.rooms.map(room => room[1]).join(' ')}`.toLocaleLowerCase().includes(search));
  return <main className="bhishma-directory">
    <header className="bhishma-directory-header">
      <Link className="bhishma-directory-brand" to="/"><img src={crest} alt="" /><span>Bhishma<small>Rainlight Commons</small></span></Link>
      <nav aria-label="Workspace navigation"><Link to="/">Commons</Link><Link to="/city" aria-current={!officeId ? 'page' : undefined}>City & offices</Link><Link to="/dashboard">Trading dashboard</Link><Link to="/settings">Settings</Link></nav>
    </header>
    <section className="bhishma-directory-arrival">
      <img src={courtyard} alt="Rainlight courtyard surrounded by shared workspaces" />
      <div><Link className="bhishma-directory-back" to={officeId ? '/city' : '/'}><ArrowLeft size={18} />{officeId ? 'Back to the city' : 'Back to the Commons'}</Link>
        <h1>{invalid ? 'Office not found' : office?.name ?? 'A city for your work.'}</h1>
        <p>{invalid ? 'Choose an office below to continue.' : office?.purpose ?? 'One Commons. Seven offices. Every existing trading tool has a place.'}</p>
      </div>
    </section>
    <section className="bhishma-directory-content" aria-label="Office directory">
      <div className="bhishma-directory-heading"><h2>{office ? 'Inside this office' : 'Find your workspace'}</h2>
        <label><Search size={18} /><span className="sr-only">Find an office or tool</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find an office or tool" /></label></div>
      <p className="bhishma-directory-note">These doors open the existing tools. Their own data, source timestamps and execution controls remain authoritative.</p>
      {offices.length === 0 && <p role="status">No matching workspace. Try another tool or office name.</p>}
      {offices.map(item => <article key={item.id} className="bhishma-directory-office">
        <div><h3>{office ? item.name : <Link to={`/offices/${item.id}`}>{item.name}<ArrowUpRight size={20} /></Link>}</h3><p>{item.purpose}</p></div>
        <ul>{item.rooms.map(([path, label]) => <li key={path}><Link to={`/${path}`}>{label}<ArrowUpRight size={17} aria-hidden="true" /></Link></li>)}</ul>
      </article>)}
      <footer><Link to="/">Return to observed specialist work<ArrowUpRight size={18} /></Link><p>Spatial office navigation is available here. Animated employees, 3D exploration and voice controls are still being developed.</p></footer>
    </section>
  </main>;
}
