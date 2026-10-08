import { FormEvent, useEffect, useRef, useState } from 'react';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, Download, ShieldCheck } from 'lucide-react';
import { getPositions, runBacktestApi } from '../services/api';
import { parseResearchResponse, researchSymbols, ResearchConfig, ResearchResult } from '../services/researchReplay';
import './BacktestHub.css';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const instant = (n: string | number) => new Date(n).toLocaleString(undefined, { timeZone: 'UTC' });
const dateString = (n: number) => new Date(n).toISOString().slice(0, 10);
const initialEnd = dateString(Date.now() - 86400000);
const initialStart = dateString(Date.parse(`${initialEnd}T00:00:00Z`) - 89 * 86400000);
const defaults = { lookbackBars: 20, momentumThresholdPct: 1, riskPerTrade: 1, maxPositionSize: 10,
  brokerFeesPct: 0.1, slippageBps: 3, stopLossPct: 3, maxHoldBars: 4 };
const fields: { key: keyof typeof defaults; label: string; min: number; max: number; step: number }[] = [
  { key: 'lookbackBars', label: 'Lookback (hour bars)', min: 2, max: 3000, step: 1 },
  { key: 'momentumThresholdPct', label: 'Momentum threshold (%)', min: 0, max: 100, step: 0.1 },
  { key: 'riskPerTrade', label: 'Planned stop risk (%)', min: 0.01, max: 100, step: 0.01 },
  { key: 'maxPositionSize', label: 'Maximum allocation (%)', min: 0.01, max: 100, step: 0.01 },
  { key: 'brokerFeesPct', label: 'Fee per side (%)', min: 0, max: 10, step: 0.01 },
  { key: 'slippageBps', label: 'Slippage per side (bps)', min: 0, max: 1000, step: 1 },
  { key: 'stopLossPct', label: 'Stop distance (%)', min: 0.01, max: 99.99, step: 0.01 },
  { key: 'maxHoldBars', label: 'Maximum holding (bars)', min: 1, max: 3000, step: 1 },
];
type Completed = { config: ResearchConfig; result: ResearchResult; receivedAt: string };

export default function BacktestHub() {
  const [symbols, setSymbols] = useState('');
  const [dates, setDates] = useState({ startDate: initialStart, endDate: initialEnd });
  const [capital, setCapital] = useState(100000);
  const [parameters, setParameters] = useState(defaults);
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [holdingsMessage, setHoldingsMessage] = useState('Reading current-account holdings…');
  const [view, setView] = useState<'account' | 'trades' | 'evidence'>('account');
  const [observationPage, setObservationPage] = useState(0);
  const request = useRef<AbortController | null>(null);
  const editedSymbols = useRef(false);
  useEffect(() => {
    let active = true;
    getPositions().then((positions: unknown) => {
      if (!active) return;
      if (!Array.isArray(positions)) throw new Error('Unexpected holdings response');
      const eligible = [...new Set(positions.filter(p => p && typeof p.asset === 'string'
        && (p.market === 'stocks' || (p.market === 'crypto' && p.asset.endsWith('/USDT')))).map(p => p.asset as string))];
      if (!editedSymbols.current) setSymbols(eligible.slice(0, 10).join(', '));
      setHoldingsMessage(eligible.length ? `${eligible.length} supported current-account instruments available. ${editedSymbols.current ? 'Your edited selection was preserved.' : `The first ${Math.min(eligible.length, 10)} were selected; edit the selection to research another batch.`}`
        : 'No stock or USDT-quoted holdings returned. Other crypto holdings require an explicit historical quote mapping; enter a supported research pair.');
    }).catch(() => { if (active) setHoldingsMessage('Current-account holdings are unavailable. Enter instruments or check the account connection.'); });
    return () => { active = false; request.current?.abort(); };
  }, []);

  async function run(event: FormEvent) {
    event.preventDefault();
    if (running) return;
    setError('');
    try {
      const config: ResearchConfig = { ...dates, initialCapital: capital, symbols: researchSymbols(symbols),
        strategy: 'momentum_baseline', ...parameters };
      const start = Date.parse(`${dates.startDate}T00:00:00Z`), end = Date.parse(`${dates.endDate}T00:00:00Z`);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start >= 366 * 86400000
        || dates.endDate > dateString(Date.now() - 86400000)) throw new Error('Choose 1–366 completed UTC days.');
      const controller = new AbortController(); request.current = controller;
      setRunning(true); setCompleted(null);
      const payload = await runBacktestApi(config, controller.signal);
      if (!controller.signal.aborted) {
        setCompleted({ config, result: parseResearchResponse(payload, config), receivedAt: new Date().toISOString() });
        setView('account');
        setObservationPage(0);
      }
    } catch (reason: any) {
      if (!request.current?.signal.aborted) setError(reason?.code === 'ECONNABORTED' ? 'The response timed out. The backend may still be processing; its job status is not tracked. Check service activity before retrying.' : reason?.response?.data?.error || reason?.message || 'Research failed. Check the data provider and retry.');
    } finally { if (!request.current?.signal.aborted) setRunning(false); }
  }
  function exportResult() {
    if (!completed) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(completed, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `bhishma-research-${completed.config.endDate}.json`;
    link.click(); URL.revokeObjectURL(url);
  }
  const result = completed?.result;
  const observationPages = Math.max(1, Math.ceil((result?.equity.length || 0) / 50));
  const curve = result?.equity.filter((_, i, all) => i % Math.max(1, Math.ceil(all.length / 700)) === 0 || i === all.length - 1);
  return <main className="research-workspace" aria-labelledby="research-heading">
    <header className="research-header">
      <div><h1 id="research-heading">Bhishma research replay</h1><p>Follow the account path. Inspect the costs. Challenge the outcome.</p></div>
      <span className="research-state"><ShieldCheck size={17} aria-hidden="true" /> Research only</span>
    </header>
    <div className="research-layout">
      <form onSubmit={run} className="research-controls">
        <h2>Define the replay</h2>
        <fieldset disabled={running}>
          <legend className="research-sr-only">Instruments, dates and risk assumptions</legend>
          <label htmlFor="research-symbols">Instruments</label>
          <textarea id="research-symbols" value={symbols} rows={3} required aria-describedby="holdings-description symbol-description"
            onChange={e => { editedSymbols.current = true; setSymbols(e.target.value); }} placeholder="Stock tickers or crypto pairs, separated by commas" />
          <p id="holdings-description" className="research-help">{holdingsMessage}</p>
          <p id="symbol-description" className="research-help">Up to 10 instruments. Crypto pairs must use /USDT and exist at the historical provider. Account symbols are not silently converted.</p>
          <div className="research-field-pair">
            <label>Start date (UTC)<input type="date" required max={dates.endDate} value={dates.startDate} onChange={e => setDates({ ...dates, startDate: e.target.value })} /></label>
            <label>End date (UTC)<input type="date" required min={dates.startDate} max={dateString(Date.now() - 86400000)} value={dates.endDate} onChange={e => setDates({ ...dates, endDate: e.target.value })} /></label>
          </div>
          <label>Research capital (nominal USD)<input type="number" min={0.01} max={1e10} step={0.01} required value={capital} onChange={e => setCapital(Number(e.target.value))} /></label>
          <div className="research-rule"><h3>Momentum baseline</h3><p>Buy after the completed lookback gain exceeds the threshold. Wait one full additional bar, then use a later opening print. Long only; exit at a stop, holding limit or end of data.</p></div>
          <details><summary>Risk and cost assumptions</summary><div className="research-parameter-grid">{fields.map(field => <label key={field.key}>{field.label}<input type="number" required min={field.min} max={field.max} step={field.step}
            value={parameters[field.key]} onChange={e => setParameters({ ...parameters, [field.key]: Number(e.target.value) })} /></label>)}</div></details>
          <button className="research-primary" type="submit">{running ? 'Requesting historical replay…' : 'Run historical replay'}<ArrowRight size={17} aria-hidden="true" /></button>
        </fieldset>
        <p className="research-help">This runs research against historical data. It does not submit broker orders.</p>
      </form>
      <section className="research-results" aria-label="Research results" aria-busy={running}>
        {error && <div role="alert" className="research-error"><h2>Replay could not complete</h2><p>{error}</p><p>Check the dates, instruments and provider access, then run again. No replacement figures have been generated.</p></div>}
        {running && <div role="status" className="research-loading"><h2>Obtaining dated prices and replaying the account</h2><p>The backend must return a complete result before any performance figure appears. Provider requests can take several minutes.</p><div className="research-loading-line" /></div>}
        {!running && !result && !error && <div className="research-empty"><h2>Evidence before allocation</h2><p>Begin with the instruments in your account or enter a research batch. The replay will return cash, holdings, costs and the observed equity path.</p><p>There is no sample performance curve here. Missing provider data produces an error.</p></div>}
        {result && completed && <>
          <div className="research-result-heading"><div><h2>Account outcome</h2><p>{completed.config.symbols.join(' · ')}<br />{completed.config.startDate} to {completed.config.endDate} · received {instant(completed.receivedAt)} UTC</p></div>
            <button type="button" onClick={exportResult}><Download size={16} aria-hidden="true" /> Export evidence</button></div>
          <dl className="research-outcome">
            <div><dt>Final equity</dt><dd>{money(result.finalEquity)}</dd></div>
            <div><dt>Net account change</dt><dd className={result.totalReturn < 0 ? 'research-loss' : 'research-gain'}>{money(result.totalReturn)} ({result.returnPct.toFixed(2)}%)</dd></div>
            <div><dt>Cash / open positions</dt><dd>{money(result.cash)} / {result.openPositions}</dd></div>
            <div><dt>Modeled fees / observed drawdown</dt><dd>{money(result.totalFees)} / {result.maxDrawdown.toFixed(2)}%</dd></div>
          </dl>
          <div role="group" aria-label="Result views" className="research-view-controls">{(['account', 'trades', 'evidence'] as const).map(item => <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)}>{item === 'account' ? 'Account path' : item === 'trades' ? 'Trade ledger' : 'Data and assumptions'}</button>)}</div>
          {view === 'account' && <section><h3>Observed equity, cash and holdings</h3><p className="research-help">Stock USD and crypto USDT use nominal dollar units; currency conversion and stablecoin peg risk are not modeled.</p><p className="research-help">USD · UTC · {result.equity.length.toLocaleString()} recorded observations. The chart shows up to 701; export includes every point.</p>
            <div className="research-chart" aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><LineChart data={curve}>
              <CartesianGrid stroke="#d8d3c8" strokeDasharray="3 3" /><XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} tickFormatter={n => dateString(Number(n)).slice(5)} />
              <YAxis tickFormatter={n => Number(n).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })} width={58} /><Tooltip labelFormatter={n => `${instant(Number(n))} UTC`} formatter={(n: number, name: string) => [money(n), name]} />
              <Line dataKey="equity" name="Equity" stroke="#785326" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="cash" name="Cash" stroke="#526579" dot={false} isAnimationActive={false} />
              <Line dataKey="holdings" name="Holdings" stroke="#35705b" dot={false} isAnimationActive={false} />
            </LineChart></ResponsiveContainer></div>
            <details><summary>Accessible account observations</summary><div className="research-pagination"><button type="button" disabled={observationPage === 0} onClick={() => setObservationPage(p => p - 1)}>Previous</button><label>Observation page<input type="number" min={1} max={observationPages} value={observationPage + 1} onChange={e => setObservationPage(Math.max(0, Math.min(observationPages - 1, (Number(e.target.value) || 1) - 1)))} /></label><span>of {observationPages}</span><button type="button" disabled={observationPage >= observationPages - 1} onClick={() => setObservationPage(p => p + 1)}>Next</button></div><div className="research-table-scroll"><table><caption>Every recorded observation is available here in pages of 50, and in Export evidence.</caption><thead><tr><th scope="col">UTC time</th><th scope="col">Cash</th><th scope="col">Holdings</th><th scope="col">Equity</th></tr></thead><tbody>{result.equity.slice(observationPage * 50, (observationPage + 1) * 50).map(p => <tr key={p.timestamp}><td>{instant(p.timestamp)}</td><td>{money(p.cash)}</td><td>{money(p.holdings)}</td><td>{money(p.equity)}</td></tr>)}</tbody></table></div></details>
          </section>}
          {view === 'trades' && <section><h3>Modeled trade records</h3><p>{result.totalTrades} closed research trades · {result.openPositions} holdings still open. These are modeled historical fills, not broker fills.</p>
            {result.sampleTrades.length ? <div className="research-table-scroll"><table><caption>First {result.sampleTrades.length} closed trades returned by the backend.</caption><thead><tr><th scope="col">Instrument</th><th scope="col">Entry / exit (UTC)</th><th scope="col">Quantity</th><th scope="col">Prices (nominal $)</th><th scope="col">Fees</th><th scope="col">Net P&amp;L</th><th scope="col">Exit reason</th></tr></thead><tbody>{result.sampleTrades.map((t, i) => <tr key={`${t.symbol}-${t.timestamp}-${i}`}><th scope="row">{t.symbol}</th><td>{instant(t.timestamp)}<br />{instant(t.exitTimestamp)}</td><td>{t.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td><td>{money(t.entryPrice)} / {money(t.exitPrice)}</td><td>{money(t.fees)}</td><td>{money(t.pnl)}</td><td>{t.exitReason.split('_').join(' ')}</td></tr>)}</tbody></table></div> : <p>No closed research trades. A zero-trade result is not evidence of a successful strategy.</p>}
          </section>}
          {view === 'evidence' && <section><h3>Provider observations</h3><div className="research-table-scroll"><table><caption>Observed coverage is not proof of complete historical coverage.</caption><thead><tr><th scope="col">Instrument</th><th scope="col">Hour bars</th><th scope="col">First open (UTC)</th><th scope="col">Last completed (UTC)</th></tr></thead><tbody>{Object.entries(result.dataCoverage).map(([symbol, coverage]) => <tr key={symbol}><th scope="row">{symbol}</th><td>{coverage.bars.toLocaleString()}</td><td>{instant(coverage.firstOpen)}</td><td>{instant(coverage.lastCompleted)}</td></tr>)}</tbody></table></div>
            <h3>Limits of this result</h3><ul>{result.limitations.map((limit, i) => <li key={i}>{limit.split('_').join(' ')}</li>)}</ul></section>}
        </>}
        <section className="research-qualification"><h2>Qualification remains open</h2><p>The momentum baseline does not replay the specialist council or establish a profitable edge. Historical prices and a coherent account ledger are the beginning of qualification.</p>
          <dl><div><dt>Sharpe, trial correction and walk-forward</dt><dd>Not computed or qualified</dd></div><div><dt>Council, forecasting and external strategy adapters</dt><dd>Not connected to this replay</dd></div><div><dt>Monte Carlo, benchmark and monthly studies</dt><dd>Not implemented in this screen</dd></div><div><dt>Prediction-market and derivative replay</dt><dd>Not supported yet</dd></div><div><dt>Live deployment authorization</dt><dd>Not granted</dd></div></dl>
        </section>
      </section>
    </div>
  </main>;
}
