/** The legacy executor is retired; this panel never offers activation. */
import { Link } from 'react-router-dom';

export const PolymarketGreedAgent = () => (
  <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3" aria-labelledby="prediction-execution-status">
    <h2 id="prediction-execution-status" className="font-semibold text-slate-900">Live prediction trading is unavailable</h2>
    <p className="text-sm text-slate-600">
      Scheduled prediction research uses paper trades. The legacy execution path is retired.
      Historical records need broker reconciliation before they can establish actual trading performance.
    </p>
    <Link to="/polymarket" className="inline-block text-sm font-medium text-slate-900 underline underline-offset-4 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
      Review prediction markets
    </Link>
  </section>
);

export default PolymarketGreedAgent;
