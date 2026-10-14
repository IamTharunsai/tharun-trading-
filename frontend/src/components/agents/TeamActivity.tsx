import { Link } from 'react-router-dom';
import { Activity, ArrowRight } from 'lucide-react';
import { useStore } from '../../store';
import { AGENTS } from '../../constants/agents';
import { debateTally } from '../../utils/debateSessions';
import LastUpdated from '../common/LastUpdated';

export default function TeamActivity() {
  const { debateSessions, socketStatus } = useStore();
  const sessions = Object.values(debateSessions).sort((a, b) => b.receivedAt - a.receivedAt);
  const session = sessions.find(item => item.status === 'running') ?? sessions[0];
  const tally = debateTally(session);
  return <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Live specialist team">
    <div className="flex justify-between items-start gap-4 flex-wrap">
      <div><h2 className="text-xl font-semibold flex items-center gap-2"><Activity size={20} aria-hidden="true" />Your team at work</h2>
        <p className="text-sm text-slate-600 mt-2">{socketStatus === 'connected' ? 'Connected to live events.' : 'Live events are unavailable or reconnecting.'} {session ? `${session.asset || 'Asset not supplied'} · ${session.status === 'complete' ? 'Review complete' : `Last observed stage ${session.round || 'unknown'}`}.` : 'No session received since sign-in.'}</p>
      </div>
      <Link to="/agents/debate-room" className="min-h-11 flex items-center gap-2 px-3 text-sm font-medium rounded-lg border border-slate-300">Open team workspace <ArrowRight size={16} aria-hidden="true" /></Link>
    </div>
    <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-5">
      {AGENTS.map(agent => {
        const state = session?.agents[agent.id];
        return <li className="text-sm" key={agent.id}><p className="font-semibold">{agent.name}</p><p className={`mt-1 ${state?.error ? 'text-red-700' : 'text-slate-600'}`}>{state?.error ? 'Provider error' : state?.status === 'analyzing' ? 'Analyzing evidence' : state?.vote || 'No event received'}</p></li>;
      })}
    </ul>
    {session && <div className="mt-5 flex flex-wrap items-center gap-4 text-sm"><span>BUY {tally.buy} · SELL {tally.sell} · HOLD {tally.hold} · Errors {tally.errors}</span><LastUpdated receivedAt={session.receivedAt} label="Team event" staleAfterMs={120000} /></div>}
    <p className="text-sm text-slate-600 mt-3">These are observed research events. A committee approval does not establish broker acceptance or a fill. Missing or overdue events leave current activity unconfirmed.</p>
  </section>;
}
