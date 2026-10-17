import { CSSProperties, KeyboardEvent, ReactNode, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, BarChart3, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Database,
  ExternalLink, FileText, LayoutGrid, MoreVertical, RefreshCw, Settings, AlertTriangle } from 'lucide-react';
import { AGENTS, AGENTS_BY_ID } from '../constants/agents';
import { EMPTY_WORKSPACE, SpecialistObservation, WorkspaceModel } from '../components/workspace/workspaceModel';
import navigationPlate from '../../../assets/plates/atrium-navigation.png';
import westHeaderPlate from '../../../assets/plates/atrium-header-west.png';
import eastHeaderPlate from '../../../assets/plates/atrium-header-east.png';
import courtyardPlate from '../../../assets/plates/atrium-courtyard.png';
import '../styles/rainlight-layout.css';
import '../styles/rainlight.css';
import '../styles/rainlight-interface.css';

const shortNames: Record<number, string> = { 3: 'Sentiment', 4: 'Fundamental', 7: 'Volume', 9: 'Macro' };
const shortName = (id: number) => (shortNames[id]
  ?? AGENTS_BY_ID[id]?.name.replace(/^The /, '') ?? 'Unknown specialist');
const stateLabel = (state: SpecialistObservation['state']) => ({ unobserved: 'Not observed', waiting: 'Waiting',
  running: 'Running', observed: 'Work observed', voted: 'Evidence received', error: 'Provider error' }[state]);
function Region({ id, className = '', children }: { id: string; className?: string; children?: ReactNode }) {
  const style: CSSProperties = { left: `var(--r-${id}-x)`, top: `var(--r-${id}-y)`,
    width: `var(--r-${id}-w)`, height: `var(--r-${id}-h)` };
  return <div className={`rainlight-region ${className}`} data-region={id} style={style}>{children}</div>;
}
function State({ observation }: { observation?: SpecialistObservation }) {
  const state = observation?.state ?? 'unobserved';
  return <span className={`rainlight-state rainlight-state--${state}`}><span aria-hidden="true" />{stateLabel(state)}</span>;
}
const descriptions: Record<number, string> = {
  2: 'Finds and interprets relevant news, filings and credible sources. Produces a concise, evidence-based summary with potential market impact.',
};
const evidenceTabs = ['Evidence', 'Notes', 'Handoffs', 'History'] as const;
type EvidenceTab = typeof evidenceTabs[number];

export function TeamWorkspaceView({ model, onRefresh, onRequestResearch }: {
  model: WorkspaceModel; onRefresh?: () => void; onRequestResearch?: (asset: string) => void;
}) {
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [selectedSpecialist, setSelectedSpecialist] = useState(2);
  const [tab, setTab] = useState<EvidenceTab>('Evidence');
  const tabRefs = useRef<Partial<Record<EvidenceTab, HTMLButtonElement | null>>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const review = model.reviews.find(item => item.id === selectedReviewId) ?? model.reviews[0];
  const observation = review?.specialists[selectedSpecialist];
  const observed = Object.values(review?.specialists ?? {}).filter(item => item.state !== 'unobserved' && item.state !== 'waiting').length;
  const waiting = Object.values(review?.specialists ?? {}).filter(item => item.state === 'waiting').length;
  const firstIssueReview = model.reviews.find(item => item.issue);
  const selectSpecialist = (id: number) => { setSelectedSpecialist(id); setTab('Evidence'); };
  const moveSpecialist = (offset: number) => selectSpecialist((selectedSpecialist - 1 + offset + AGENTS.length) % AGENTS.length + 1);
  // WAI-ARIA tabs: one tab stop, arrow movement, Home/End, linked panel.
  // https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, current: EvidenceTab) => {
    const index = evidenceTabs.indexOf(current);
    const next = event.key === 'ArrowRight' ? (index + 1) % evidenceTabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + evidenceTabs.length) % evidenceTabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? evidenceTabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setTab(evidenceTabs[next]); tabRefs.current[evidenceTabs[next]]?.focus();
  };
  const nav = [{ id: 'workspace', label: 'Workspace', href: '/', Icon: LayoutGrid },
    { id: 'markets', label: 'Markets', href: '/stocks', Icon: BarChart3 },
    { id: 'portfolio', label: 'Portfolio', href: '/portfolio', Icon: CircleDollarSign },
    { id: 'research', label: 'Research', href: '/multi-agent', Icon: FileText },
    { id: 'journal', label: 'Journal', href: '/journal', Icon: BookOpen },
    { id: 'settings', label: 'Settings', href: '/settings', Icon: Settings }];
  return (
    <main className="rainlight-world" aria-label="Rainlight Commons" data-sample-state={model.sampleState}>
      <div className="rainlight-architecture" aria-hidden="true">
        <img className="rainlight-plate rainlight-plate--navigation" src={navigationPlate} alt="" />
        <img className="rainlight-plate rainlight-plate--west" src={westHeaderPlate} alt="" />
        <img className="rainlight-plate rainlight-plate--east" src={eastHeaderPlate} alt="" />
        <img className="rainlight-plate rainlight-plate--courtyard" src={courtyardPlate} alt="" />
      </div>
      <div className="rainlight-navigation-wash" aria-hidden="true" />
      <div className="rainlight-header-wash" aria-hidden="true" />
      <header className="rainlight-contents">
        <Region id="brand" className="rainlight-brand">Bhishma</Region>
        <Region id="brand-description" className="rainlight-on-jade rainlight-brand-description">Personal trading<br />supervision workspace</Region>
        <Region id="welcome" className="rainlight-on-jade rainlight-welcome">Welcome back</Region>
        <Region id="main-heading" className="rainlight-on-jade rainlight-main-heading"><h1>Fourteen specialists. A clearer view.</h1></Region>
        <Region id="main-description" className="rainlight-on-jade rainlight-description">Understand what each specialist is doing, their evidence and handoffs, while positions and faults remain visible.</Region>
        <Region id="mode-select" className="rainlight-header-control"><Link to="/settings"><Database size={16} />{model.modeLabel}<ChevronDown size={14} /></Link></Region>
        <Region id="session-status" className="rainlight-header-control"><span><CalendarDays size={15} />{model.reviews.length} observed sessions<span className="rainlight-connection-dot" data-connection={model.connectionState} aria-label={model.connectionLabel} /></span></Region>
        <Region id="fault-status" className="rainlight-header-control"><button onClick={() => { if (firstIssueReview?.issue) { setSelectedReviewId(firstIssueReview.id); selectSpecialist(firstIssueReview.issue.specialistId); } }} disabled={!firstIssueReview}><AlertTriangle size={15} color={model.observedFaultCount !== null && model.observedFaultCount > 0 ? '#d83731' : undefined} />{model.observedFaultCount === null ? 'Unverified' : `${model.observedFaultCount} data fault${model.observedFaultCount === 1 ? '' : 's'}`}</button></Region>
        <Region id="account-menu" className="rainlight-header-control rainlight-account-menu"><Link to="/settings"><span className="rainlight-initials" aria-hidden="true">RC</span><span>Rainlight Commons<small>A more considered market.</small></span><ChevronDown size={13} /></Link></Region>
      </header>
      <nav className="rainlight-contents" aria-label="Main navigation">
        {nav.map(({ id, label, href, Icon }) => <Region key={id} id={`nav-${id}`} className={`rainlight-nav-item ${id === 'workspace' ? 'rainlight-nav-item--current' : ''}`}><Link to={href} aria-current={id === 'workspace' ? 'page' : undefined}><Icon size={21} strokeWidth={1.5} />{label}</Link></Region>)}
      </nav>
      <Region id="concept-caption" className="rainlight-concept-caption">{model.sampleState ? 'Design concept — sample state' : 'Observed work · source evidence'}</Region>
      <section className="rainlight-contents" aria-label="Selected review">
        <Region id="session-background" className="rainlight-reading-field" />
        <Region id="session-label" className="rainlight-small">Session</Region>
        <Region id="session-select" className="rainlight-session-select"><select aria-label="Choose observed review" value={review?.id ?? ''} onChange={event => setSelectedReviewId(event.target.value)} disabled={!model.reviews.length}>
          {!model.reviews.length && <option value="">No review observed</option>}
          {model.reviews.map(item => <option key={item.id} value={item.id}>{item.asset} · {item.marketLabel} · {item.stageLabel}</option>)}
        </select></Region>
        <Region id="observed-count" className="rainlight-small">Observed {observed} specialists · {waiting} waiting</Region>
        <Region id="session-receipt" className="rainlight-small">{review?.receiptLabel ?? 'No receipt'}</Region>
        <Region id="session-refresh" className="rainlight-icon-control"><button aria-label="Refresh observed team state" onClick={onRefresh} disabled={!onRefresh}><RefreshCw size={15} /></button></Region>
        <Region id="session-menu" className="rainlight-icon-control"><button aria-label="Review options" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><MoreVertical size={17} /></button>
          {menuOpen && <div className="rainlight-options"><Link to="/agents/debate-room">Open review history</Link><Link to="/agents/monitor">Open activity monitor</Link></div>}
        </Region>
      </section>
      <section className="rainlight-contents" aria-label="Specialist workspace">
        <Region id="commons-title" className="rainlight-commons-title">Specialists around the current review</Region>
        {AGENTS.map(agent => <Region key={agent.id} id={`station-${agent.id}`} className={`rainlight-station ${selectedSpecialist === agent.id ? 'rainlight-station--selected' : ''}`}>
          <button aria-pressed={selectedSpecialist === agent.id} onClick={() => selectSpecialist(agent.id)}><span className="rainlight-station-name">{agent.id}. {shortName(agent.id)}</span><State observation={review?.specialists[agent.id]} /></button>
        </Region>)}
        <Region id="review-summary" className="rainlight-review-disc" />
        <Region id="review-asset" className="rainlight-review-asset">{review?.asset ?? '—'}</Region>
        <Region id="review-market" className="rainlight-review-text">{review?.marketLabel ?? 'No review'}</Region>
        <Region id="review-stage" className="rainlight-review-text">{review?.stageLabel ?? 'Not observed'}</Region>
        <Region id="review-caption" className="rainlight-review-text rainlight-review-caption">Fourteen perspectives.<br />A more disciplined decision.</Region>
      </section>
      <section className="rainlight-contents" aria-label="Selected specialist details">
        <Region id="inspector-background" className="rainlight-reading-field" />
        <Region id="inspector-heading" className="rainlight-inspector-heading">Specialist details</Region>
        <Region id="previous-specialist" className="rainlight-icon-control"><button aria-label="Previous specialist" onClick={() => moveSpecialist(-1)}><ChevronLeft size={18} /></button></Region>
        <Region id="next-specialist" className="rainlight-icon-control"><button aria-label="Next specialist" onClick={() => moveSpecialist(1)}><ChevronRight size={18} /></button></Region>
        <Region id="specialist-name" className="rainlight-specialist-name">{selectedSpecialist}. {shortName(selectedSpecialist)}</Region>
        <Region id="specialist-state" className="rainlight-specialist-state"><State observation={observation} /></Region>
        <Region id="specialist-index" className="rainlight-small rainlight-muted">{selectedSpecialist} of {AGENTS.length}</Region>
        <Region id="specialist-description" className="rainlight-specialist-description">{descriptions[selectedSpecialist] ?? `${AGENTS_BY_ID[selectedSpecialist].role}. Inspect attributable observations and recorded evidence; missing events leave current activity unconfirmed.`}</Region>
        <div className="rainlight-contents" role="tablist" aria-label="Specialist evidence views">{evidenceTabs.map(name => <Region key={name} id={`tab-${name.toLowerCase()}`} className="rainlight-evidence-tab"><button ref={node => { tabRefs.current[name] = node; }} id={`rainlight-tab-${name.toLowerCase()}`} role="tab" aria-selected={tab === name} aria-controls="rainlight-inspector-content" tabIndex={tab === name ? 0 : -1} onKeyDown={event => moveTab(event, name)} onClick={() => setTab(name)}>{name}</button></Region>)}</div>
        {tab === 'Evidence' ? <div className="rainlight-contents" id="rainlight-inspector-content" role="tabpanel" aria-labelledby="rainlight-tab-evidence">
          <Region id="instrument-label" className="rainlight-fact-label">Instrument</Region>
          <Region id="instrument-value" className="rainlight-fact-value">{review?.instrumentName ?? review?.asset ?? 'Not supplied'}<small>{review?.listing ?? 'Listing unverified'}</small></Region>
          <Region id="instrument-link" className="rainlight-icon-control">{review && <Link to={`/quote?symbol=${encodeURIComponent(review.asset)}`} aria-label={`View ${review.asset} instrument`}><ExternalLink size={15} /></Link>}</Region>
          <Region id="price-label" className="rainlight-fact-label">Price (last)</Region>
          <Region id="price-value" className="rainlight-price-value">{review?.priceLabel ?? 'Unavailable'}</Region>
          <Region id="price-time" className="rainlight-small rainlight-muted">{review?.priceObservationLabel ?? 'Observation time unknown'}</Region>
          <Region id="forecast-label" className="rainlight-fact-label">Forecast return</Region>
          <Region id="forecast-value" className="rainlight-fact-value">{review?.forecastLabel ?? 'Forecast unavailable'}</Region>
          <Region id="fundamental-label" className="rainlight-fact-label">Fundamentals</Region>
          <Region id="fundamental-value" className="rainlight-fact-value">{review?.fundamentalsLabel ?? 'Fundamentals unavailable'}</Region>
        </div> : <div id="rainlight-inspector-content" role="tabpanel" aria-labelledby={`rainlight-tab-${tab.toLowerCase()}`} tabIndex={0} className="rainlight-tab-content">
          {tab === 'Notes' && <><h3>Recorded notes</h3>{observation?.notes?.length ? observation.notes.map((note, index) => <p key={index}>{note}</p>) : <p>No attributable notes received for this specialist.</p>}</>}
          {tab === 'Handoffs' && <><h3>Observed handoffs</h3>{review?.handoffs?.length ? review.handoffs.map((handoff, index) => <p key={index}>{shortName(handoff.from)} to {shortName(handoff.to)} · {handoff.receiptLabel}</p>) : <p>No explicit handoff events received. Opening research can run in parallel; nearby desks do not imply a serial pipeline.</p>}</>}
          {tab === 'History' && <><h3>Received evidence</h3>{observation?.history?.length ? observation.history.map((entry, index) => <p key={index}><time>{entry.receiptLabel}</time><br />{entry.text}</p>) : <p>No specialist history received for this review.</p>}</>}
        </div>}
        {review?.issue && <div className="rainlight-contents" role="status"><Region id="provider-issue" className="rainlight-issue-field" /><Region id="provider-issue-heading" className="rainlight-issue-heading"><AlertTriangle size={13} />{review.issue.title}</Region><Region id="provider-issue-detail" className="rainlight-issue-detail">{review.issue.detail}</Region></div>}
        <Region id="decision-label" className="rainlight-fact-label">Decision state</Region>
        <Region id="decision-state" className="rainlight-decision-state">{review?.decisionLabel ?? 'No decision received'}</Region>
        <Region id="execution-note" className="rainlight-execution-note">A recommendation is not a fill.</Region>
        <Region id="request-research" className="rainlight-request-research"><button disabled={!review || !onRequestResearch} onClick={() => review && onRequestResearch?.(review.asset)}><FileText size={17} />Request research only</button></Region>
      </section>
      <section className="rainlight-contents" aria-label="Specialist roster">
        <Region id="roster-background" className="rainlight-reading-field" />
        <Region id="roster-heading" className="rainlight-roster-heading">Specialists ({AGENTS.length})</Region>
        <Region id="roster-head-left" className="rainlight-roster-head rainlight-roster-grid"><span>Specialist</span><span>Status</span><span>Last update (ET)</span><span>Key evidence (latest)</span><span>Handoff</span></Region>
        <Region id="roster-head-right" className="rainlight-roster-head rainlight-roster-grid-right"><span>Specialist</span><span>Status</span><span>Last update (ET)</span></Region>
        {AGENTS.map(agent => {
          const item = review?.specialists[agent.id];
          return <Region key={agent.id} id={agent.id <= 7 ? `roster-left-${agent.id}` : `roster-right-${agent.id}`} className={`rainlight-roster-row ${selectedSpecialist === agent.id ? 'rainlight-roster-row--selected' : ''}`}>
            <button className={agent.id <= 7 ? 'rainlight-roster-grid' : 'rainlight-roster-grid-right'} onClick={() => selectSpecialist(agent.id)} aria-pressed={selectedSpecialist === agent.id}>
              <span>{shortName(agent.id)}</span><State observation={item} /><span>{item?.receiptLabel ?? '—'}</span>
              {agent.id <= 7 && <><span>{item?.evidence ?? '—'}</span><span>{review?.handoffs?.find(handoff => handoff.from === agent.id) ? shortName(review.handoffs.find(handoff => handoff.from === agent.id)!.to) : '—'}</span></>}
            </button>
          </Region>;
        })}
      </section>
      <footer className="rainlight-contents" aria-label="Account and faults">
        <Region id="footer-background" className="rainlight-reading-field" />
        <Region id="account-label" className="rainlight-footer-label">{model.accountLabel}</Region>
        <Region id="account-value" className="rainlight-footer-value">{model.accountSummary}</Region>
        <Region id="positions-label" className="rainlight-footer-label">Positions{model.positionsCount !== undefined ? ` (${model.positionsCount})` : ''}</Region>
        <Region id="positions-value" className="rainlight-footer-value">{model.positionsLabel}</Region>
        <Region id="fault-label" className="rainlight-footer-label">{model.faultsLabel}</Region>
        <Region id="fault-detail" className="rainlight-footer-fault">{model.faultSummary}</Region>
        <Region id="fault-link" className="rainlight-footer-link"><Link to="/agents/monitor">View</Link></Region>
      </footer>
    </main>
  );
}

/** The public home route is connected after the assembled view is verified.
 * Production defaults contain no sample financial values or simulated work. */
export default function TeamWorkspacePage() { return <TeamWorkspaceView model={EMPTY_WORKSPACE} />; }
