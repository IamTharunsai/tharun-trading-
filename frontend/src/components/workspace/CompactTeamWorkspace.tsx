import { KeyboardEvent, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { AGENTS, AGENTS_BY_ID } from '../../constants/agents';
import { SpecialistObservation, WorkspaceModel, WorkspaceReview } from './workspaceModel';
import { ResearchNotice, readbackStateLabel } from './WorkspaceReadbackCoverage';
import { TeamWorkspaceReadbackMeta } from '../../utils/teamWorkspaceAdapter';
import crest from '../../../../assets/brand/bhishma-dog-crest.png';
import courtyard from '../../../../assets/plates/atrium-courtyard.png';
import '../../styles/compact-workspace.css';

const tabs = ['Evidence', 'Notes', 'Handoffs', 'History'] as const;
type Tab = typeof tabs[number];
const name = (id: number) => AGENTS_BY_ID[id]?.name.replace(/^The /, '') ?? 'Unknown specialist';
const state = (value?: SpecialistObservation) => ({ unobserved: 'Not observed', waiting: 'Waiting', running: 'Running',
  observed: 'Work observed', voted: 'Evidence received', error: 'Observed issue' }[value?.state ?? 'unobserved']);

/** Same observations/actions as the spatial view; no extra requests or authority. */
export default function CompactTeamWorkspace({ model, review, meta, selected, tab, research, onSelect, onReview, onTab, onRefresh, onRequestResearch }: {
  model: WorkspaceModel; review?: WorkspaceReview; meta?: TeamWorkspaceReadbackMeta; selected: number; tab: Tab;
  research?: ResearchNotice; onSelect: (id: number) => void; onReview: (id: string) => void; onTab: (tab: Tab) => void;
  onRefresh?: () => void; onRequestResearch?: (id: string) => void;
}) {
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const observation = review?.specialists[selected];
  const move = (event: KeyboardEvent<HTMLButtonElement>, current: Tab) => {
    const index = tabs.indexOf(current);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); onTab(tabs[next]); refs.current[tabs[next]]?.focus();
  };
  return <main className="rainlight-compact" aria-label="Rainlight Commons compact workspace">
    <header className="compact-arrival" style={{ backgroundImage: `linear-gradient(0deg,#eaf0e8f0,#eaf0e8a0),url(${courtyard})` }}>
      <Link className="compact-brand" to="/"><img src={crest} alt="Bhishma crest" /><span>Bhishma<small>Rainlight Commons</small></span></Link>
      <h1>Your team, in view.</h1><p>Recorded work, evidence and the next place to look.</p>
      <nav aria-label="Compact workspace navigation"><Link to="/city">City & offices</Link><Link to="/dashboard">Trading dashboard</Link><Link to="/settings">Settings</Link></nav>
    </header>
    <section className="compact-section" aria-label="Observed review selection">
      <div className="compact-section-heading"><h2>Observed reviews</h2><button aria-label="Refresh observed team state" onClick={onRefresh}
        disabled={!onRefresh || meta?.isRefreshing || meta?.state === 'signed-out'}><RefreshCw size={18} /></button></div>
      <p>{meta ? readbackStateLabel[meta.state] : model.connectionLabel}. Execution unconfirmed.</p>
      <label className="compact-review-label">Review<select aria-label="Choose observed review" value={review?.id ?? ''} disabled={!model.reviews.length} onChange={event => onReview(event.target.value)}>
        {!model.reviews.length && <option value="">No review observed</option>}
        {model.reviews.map(item => <option key={item.id} value={item.id}>{item.asset} · {item.marketLabel} · {item.stageLabel}</option>)}
      </select></label>
      {review && <p className="compact-muted">{review.stageLabel}</p>}
      <a href="#workspace-coverage">{meta?.asOfLabel ?? 'View observation coverage'}</a>
    </section>
    <section className="compact-section" aria-label="Specialist team">
      <h2>Fourteen perspectives</h2><p className="compact-muted">Choose a specialist to inspect their observations.</p>
      <div className="compact-team-grid">{AGENTS.map(agent => <button key={agent.id} aria-label={`Select ${name(agent.id)}`} aria-pressed={selected === agent.id}
        onClick={() => onSelect(agent.id)}><strong>{agent.id}. {name(agent.id)}</strong><span>{state(review?.specialists[agent.id])}</span></button>)}</div>
    </section>
    <section className="compact-section compact-inspector" aria-label="Selected specialist details">
      <div className="compact-section-heading"><h2>{selected}. {name(selected)}</h2><div className="compact-step-controls">
        <button aria-label="Previous specialist" onClick={() => onSelect((selected - 2 + AGENTS.length) % AGENTS.length + 1)}><ChevronLeft size={18} /></button>
        <button aria-label="Next specialist" onClick={() => onSelect(selected % AGENTS.length + 1)}><ChevronRight size={18} /></button></div></div>
      <p>{state(observation)} · {observation?.receiptLabel ?? 'No receipt'}</p>
      <div className="compact-evidence-tabs" role="tablist" aria-label="Specialist evidence views">{tabs.map(item => <button key={item} ref={node => { refs.current[item] = node; }}
        id={`compact-tab-${item}`} role="tab" aria-selected={tab === item} aria-controls="compact-inspector-panel" tabIndex={tab === item ? 0 : -1}
        onClick={() => onTab(item)} onKeyDown={event => move(event, item)}>{item}</button>)}</div>
      <div id="compact-inspector-panel" role="tabpanel" aria-labelledby={`compact-tab-${tab}`} tabIndex={0}>
        {tab === 'Evidence' && <><dl><dt>Instrument context</dt><dd>{review?.asset ?? 'Not supplied'} · {review?.marketLabel ?? 'Market unverified'}</dd>
          <dt>Last price</dt><dd>{review?.priceLabel ?? 'Unavailable'}<small>{review?.priceObservationLabel ?? 'Observation time unknown'}</small></dd>
          <dt>Forecast return</dt><dd>{review?.forecastLabel ?? 'Forecast unavailable'}</dd><dt>Fundamentals</dt><dd>{review?.fundamentalsLabel ?? 'Fundamentals unavailable'}</dd></dl>
          {observation?.evidence && <p>{observation.evidence}</p>}</>}
        {tab === 'Notes' && (observation?.notes?.length ? observation.notes.map((note, index) => <p key={index}>{note}</p>) : <p>No attributable notes received for this specialist.</p>)}
        {tab === 'Handoffs' && (review?.handoffs?.length ? review.handoffs.map((item, index) => <p key={index}>{name(item.from)} to {name(item.to)} · {item.receiptLabel}</p>)
          : <p>No explicit handoff events received. Opening research can run in parallel; nearby desks do not imply a serial pipeline.</p>)}
        {tab === 'History' && (observation?.history?.length ? observation.history.map((item, index) => <p key={index}><time>{item.receiptLabel}</time><br />{item.text}</p>)
          : <p>No specialist history received for this review.</p>)}
      </div>
      {review?.issue && <aside className="compact-issue" role="status"><strong>{review.issue.title}</strong><p>{review.issue.detail}</p></aside>}
      <p>{review?.decisionLabel ?? 'No decision received'}</p><p className="compact-muted">A recommendation is not a fill.</p>
      {review && onRequestResearch ? <button className="compact-primary" disabled={research?.phase === 'pending'} onClick={() => onRequestResearch(review.id)}>
        {research?.phase === 'pending' ? 'Requesting research only' : 'Request research only'}</button> : <Link className="compact-primary" to="/agents/debate-room">Choose asset for research</Link>}
    </section>
    <footer className="compact-section"><h2>Account & coverage</h2><p>{model.accountLabel}: {model.accountSummary}</p><p>{model.positionsLabel}</p>
      <p>{model.faultSummary}</p><Link to="/agents/monitor">Open activity monitor</Link></footer>
  </main>;
}
