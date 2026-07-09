import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

export default function LastUpdated({ at }: { at?: number | Date | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const ts = at ? new Date(at) : new Date();
  const secondsAgo = Math.max(0, Math.floor((Date.now() - ts.getTime()) / 1000));
  const relative = secondsAgo < 5 ? 'just now' : secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.floor(secondsAgo / 60)}m ago`;

  return (
    <span
      title={format(ts, 'EEEE, MMMM d yyyy • HH:mm:ss')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontFamily: 'Space Mono', fontSize: 10, color: 'var(--apex-muted)',
      }}
    >
      <RefreshCw size={10} />
      Updated {relative} · {format(ts, 'HH:mm:ss')}
    </span>
  );
}
