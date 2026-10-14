import { useEffect, useState } from 'react';
import { Activity, Circle, MessageSquare, ShieldCheck } from 'lucide-react';
import { connectSocket } from '../services/socket';
import { useStore } from '../store';
import api from '../services/api';
import toast from 'react-hot-toast';
import { AGENTS } from '../constants/agents';
import SymbolPicker from '../components/common/SymbolPicker';
import { useSelectedSymbol } from '../hooks/useDefaultSymbol';
import { debateTally } from '../utils/debateSessions';
import LastUpdated from '../components/common/LastUpdated';

export default function DebateRoomPage() {
  const { debateSessions, socketStatus } = useStore();
  const [selectedId, setSelectedId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const { symbol, market, setSymbol } = useSelectedSymbol('all');
  const sessions = Object.values(debateSessions).sort((a, b) => b.receivedAt - a.receivedAt);
  const session = debateSessions[selectedId] ?? sessions[0];
  const tally = debateTally(session);
  const result = session?.result;
  useEffect(() => { connectSocket(); }, []);

  const requestResearch = async () => {
    if (triggering || !symbol) return;
    setTriggering(true);
    try {
      await api.post('/agents/trigger-debate', { asset: symbol, market });
      toast(`Research request accepted for ${symbol}. A session appears when its start is observed.`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Research request failed. Try again when the service is available.');
    } finally { setTriggering(false); }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-900">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Team workspace</h1>
          <p className="mt-2 text-sm text-slate-600 max-w-2xl">
            Watch scheduled reviews as they happen. Each session keeps its own evidence,
            specialist votes and committee decision. A recommendation is separate from an order fill.
          </p>
          {socketStatus !== 'connected' && <button type="button" className="min-h-11 px-3 mt-2 rounded-lg border border-slate-300 text-sm" onClick={() => connectSocket()}>Retry live connection</button>}
          <p role="status" className="mt-2 flex items-center gap-2 text-sm">
            <Activity size={16} aria-hidden="true" />
            {socketStatus === 'connected' ? 'Live event connection established' : socketStatus === 'connecting' ? 'Connecting to live events…' : 'Live updates unavailable — displayed evidence may be incomplete'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SymbolPicker value={symbol} onChange={setSymbol} data-testid="symbol-picker" />
          <button data-testid="debate-trigger" onClick={requestResearch} disabled={triggering || !symbol}
            className="min-h-11 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            {triggering ? 'Requesting…' : 'Request research only'}
          </button>
        </div>
      </header>

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <label className="text-sm font-semibold flex items-center gap-3">
          Observed session
          <select aria-label="Observed debate session" className="min-h-11 rounded-lg border border-slate-300 px-3 max-w-full"
            value={session?.id ?? ''} onChange={event => setSelectedId(event.target.value)} disabled={!sessions.length}>
            {!sessions.length && <option value="">No session received</option>}
            {sessions.map(item => <option key={item.id} value={item.id}>{item.asset || 'Asset not yet supplied'} · {item.status} · {item.id.slice(-8)}</option>)}
          </select>
        </label>
        <p className="text-sm text-slate-600">{sessions.filter(item => item.status === 'running').length} sessions last observed in progress</p>
      </div>
      {session && <LastUpdated receivedAt={session.receivedAt} label="Team event" staleAfterMs={120000} />}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold flex gap-2 items-center"><MessageSquare size={20} aria-hidden="true" />{session?.asset ? `Reviewing ${session.asset}` : 'Specialist team'}</h2>
        <p className="text-sm text-slate-600 mt-1">
          {session?.status === 'complete' ? 'Committee review complete' : session?.round === 4 ? 'Coordinator is synthesizing the evidence' : session?.round ? `Round ${session.round}: ${session.round === 1 ? 'independent opening arguments' : session.round === 2 ? 'challenge and rebuttal, when available' : 'final specialist votes'}` : 'Waiting for a server event. Idle does not prove a specialist is healthy.'}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mt-5">
          {AGENTS.map(agent => {
            const state = session?.agents[agent.id];
            return <article key={agent.id} className="rounded-lg bg-slate-50 p-3">
              <h3 className="text-sm font-semibold">{agent.name}</h3>
              {agent.veto && <p className="text-xs text-slate-600 mt-1">Risk veto role</p>}
              <p className="mt-3 text-sm font-medium flex items-center gap-1">
                <Circle size={10} aria-hidden="true" />{state?.error ? 'Provider error' : state?.status === 'analyzing' ? 'Analyzing' : state?.vote ?? 'Not observed'}
              </p>
              {state?.confidence !== undefined && !state.error && <p className="text-xs text-slate-600 mt-1">Reported confidence {state.confidence}%</p>}
              {state?.reasoning && <p className="text-sm leading-relaxed mt-2 break-words">{state.reasoning}</p>}
            </article>;
          })}
        </div>
        <p className="text-sm mt-4">BUY {tally.buy} · SELL {tally.sell} · HOLD {tally.hold} · Provider errors {tally.errors}</p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Evidence and discussion</h2>
          <div className="max-h-[32rem] overflow-y-auto mt-4 space-y-5" aria-label="Debate transcript">
            {!session?.entries.length && <p className="text-sm text-slate-600">No argument has been received for this session. This view contains only events observed since sign-in; older sessions require a persisted history view.</p>}
            {session?.entries.map((entry, index) => <article key={`${session.id}-${index}`} className="border-b border-slate-200 pb-4">
              <h3 className="text-sm font-semibold">{entry.agentName || 'Specialist'} <span className="font-normal text-slate-600">· Round {entry.round}{entry.vote ? ` · ${entry.vote}` : ''}</span></h3>
              <p className="text-sm leading-relaxed mt-2 whitespace-pre-wrap break-words">{entry.content || 'No text supplied'}</p>
            </article>)}
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold flex gap-2 items-center"><ShieldCheck size={20} aria-hidden="true" />Committee decision</h2>
          {result ? <>
            <p className="text-3xl font-bold mt-5">{result.decision}</p>
            <p className="text-sm mt-3">Review purpose: {result.purpose || 'Not supplied by this server version'}</p>
            <p className="text-sm mt-2">Reported confidence: {result.confidence === undefined ? 'Unknown' : `${result.confidence}%`}. This is not a calibrated probability of profit.</p>
            <p className="text-sm mt-3">{result.purpose === 'RESEARCH' ? 'Research only — cannot authorize a trade.' : result.approved ? 'Committee approved. Subsequent risk checks and broker confirmation are required.' : `No execution approval. ${result.blockReason || ''}`}</p>
            {result.synthesis && <p className="text-sm leading-relaxed mt-4 whitespace-pre-wrap break-words">{result.synthesis}</p>}
            <p className="text-sm text-slate-600 mt-5">Order status: not established by debate events. Check the trade ledger for broker evidence.</p>
          </> : <p className="text-sm text-slate-600 mt-4">{session?.status === 'running' ? 'Awaiting the coordinator’s decision.' : 'No committee result received.'}</p>}
        </section>
      </div>
    </div>
  );
}
