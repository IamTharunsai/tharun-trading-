/**
 * INTEGRATION: FinceptTerminal → APEX
 * Economic Calendar Panel — macro events with impact ratings
 *
 * FinceptTerminal ref: https://github.com/Fincept-Corporation/FinceptTerminal
 * OpenTerminal ref: https://github.com/ErTasselli/OpenTerminal
 * APEX file location: frontend/src/components/panels/EconomicCalendar.tsx
 */

import React, { useEffect, useState, useCallback } from 'react';

interface EconomicEvent {
  id: string;
  date: string;
  time: string;
  country: string;
  currency: string;
  event: string;
  impact: 'low' | 'medium' | 'high';
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  revised: string | null;
  category: string;
  description: string;
}

interface CentralBank {
  bank: string;
  acronym: string;
  country: string;
  currency: string;
  currentRate: number;
  rateUnit: string;
  nextMeeting: string;
  lastChange: 'hike' | 'cut' | 'hold';
  lastChangeAmount: number;
  tone: 'hawkish' | 'neutral' | 'dovish';
  marketImpliedNextMove: string;
}

const IMPACT_CONFIG = {
  high:   { color: '#ef4444', label: '●●●', bg: 'rgba(239,68,68,0.12)' },
  medium: { color: '#f59e0b', label: '●●○', bg: 'rgba(245,158,11,0.12)' },
  low:    { color: '#6b7280', label: '●○○', bg: 'rgba(107,114,128,0.08)' },
};

const COUNTRY_FLAG: Record<string, string> = {
  US: '🇺🇸', EU: '🇪🇺', UK: '🇬🇧', JP: '🇯🇵',
  CN: '🇨🇳', CA: '🇨🇦', AU: '🇦🇺', CH: '🇨🇭',
};

const TONE_CONFIG = {
  hawkish: { color: '#ef4444', label: '🦅 Hawkish' },
  neutral:  { color: '#f59e0b', label: '⚖️ Neutral'  },
  dovish:   { color: '#22c55e', label: '🕊️ Dovish'  },
};

function groupByDate(events: EconomicEvent[]): Record<string, EconomicEvent[]> {
  return events.reduce((acc, ev) => {
    if (!acc[ev.date]) acc[ev.date] = [];
    acc[ev.date].push(ev);
    return acc;
  }, {} as Record<string, EconomicEvent[]>);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const EconomicCalendar: React.FC = () => {
  const [events,  setEvents]  = useState<EconomicEvent[]>([]);
  const [banks,   setBanks]   = useState<CentralBank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [days,    setDays]    = useState(14);
  const [tab,     setTab]     = useState<'calendar' | 'banks'>('calendar');
  const [filter,  setFilter]  = useState<'all' | 'high' | 'medium'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('apex_token');
      const headers = { Authorization: `Bearer ${token}` };

      const [calRes, bankRes] = await Promise.all([
        fetch(`/api/market/economic/calendar?days=${days}`, { headers }),
        fetch('/api/market/economic/central-banks', { headers }),
      ]);

      if (!calRes.ok || !bankRes.ok) throw new Error('Failed to load economic data');

      const calData  = await calRes.json();
      const bankData = await bankRes.json();

      setEvents(calData.events || []);
      setBanks(bankData.banks || []);
    } catch (e: any) {
      setError(e.message || 'Error loading data');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === 'all' ? events : events.filter(e => e.impact === filter);
  const grouped  = groupByDate(filtered);
  const dates    = Object.keys(grouped).sort();

  return (
    <div style={{
      background: 'var(--panel-bg, #0f0f0f)',
      border: '1px solid var(--border, #1e2a3a)',
      borderRadius: 12,
      padding: 20,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
      color: 'var(--text, #e2e8f0)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>📅</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: 0.5 }}>Economic Calendar</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim, #64748b)' }}>FinceptTerminal · Macro Intelligence</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([7, 14, 30] as const).map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: days === d ? '#3b82f6' : 'transparent',
              color:      days === d ? '#fff' : 'var(--text-dim, #64748b)',
              border:     days === d ? '1px solid #3b82f6' : '1px solid var(--border, #1e2a3a)',
            }}>{d}d</button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border, #1e2a3a)', paddingBottom: 0 }}>
        {(['calendar', 'banks'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: 'transparent',
            color: tab === t ? '#3b82f6' : 'var(--text-dim, #64748b)',
            borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
            textTransform: 'capitalize',
          }}>{t === 'calendar' ? '📆 Calendar' : '🏦 Central Banks'}</button>
        ))}
        {tab === 'calendar' && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            {(['all', 'high', 'medium'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: filter === f
                  ? f === 'high' ? '#ef4444' : f === 'medium' ? '#f59e0b' : '#3b82f6'
                  : 'transparent',
                color: filter === f ? '#fff' : 'var(--text-dim, #64748b)',
                border: '1px solid var(--border, #1e2a3a)',
              }}>{f.toUpperCase()}</button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim, #64748b)' }}>
            Loading economic data…
          </div>
        )}

        {error && (
          <div style={{ padding: 16, background: 'rgba(239,68,68,0.1)', borderRadius: 8, color: '#ef4444', fontSize: 12 }}>
            ⚠ {error}
          </div>
        )}

        {!loading && !error && tab === 'calendar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {dates.length === 0 ? (
              <div style={{ color: 'var(--text-dim, #64748b)', textAlign: 'center', padding: 32, fontSize: 13 }}>
                No {filter !== 'all' ? filter + '-impact ' : ''}events in the next {days} days.
              </div>
            ) : dates.map(date => (
              <div key={date}>
                {/* Date header */}
                <div style={{
                  fontSize: 11, fontWeight: 700, color: '#3b82f6', letterSpacing: 1,
                  textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span>{formatDate(date)}</span>
                  <span style={{ color: 'var(--text-dim, #64748b)', fontWeight: 400 }}>
                    — {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </span>
                </div>

                {/* Events */}
                {grouped[date].map(ev => {
                  const cfg = IMPACT_CONFIG[ev.impact];
                  const isOpen = expanded === ev.id;
                  return (
                    <div
                      key={ev.id}
                      onClick={() => setExpanded(isOpen ? null : ev.id)}
                      style={{
                        background: isOpen ? cfg.bg : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${isOpen ? cfg.color + '40' : 'var(--border, #1e2a3a)'}`,
                        borderLeft: `3px solid ${cfg.color}`,
                        borderRadius: 8,
                        padding: '10px 14px',
                        marginBottom: 6,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14 }}>{COUNTRY_FLAG[ev.country] || '🌐'}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-dim, #64748b)', minWidth: 55 }}>{ev.time}</span>
                        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{ev.event}</span>
                        <span style={{ color: cfg.color, fontSize: 11, fontWeight: 700 }}>{cfg.label}</span>
                        {ev.forecast && (
                          <span style={{ fontSize: 11, color: 'var(--text-dim, #64748b)' }}>
                            F: <b style={{ color: 'var(--text, #e2e8f0)' }}>{ev.forecast}</b>
                          </span>
                        )}
                        {ev.previous && (
                          <span style={{ fontSize: 11, color: 'var(--text-dim, #64748b)' }}>
                            P: <b style={{ color: 'var(--text, #e2e8f0)' }}>{ev.previous}</b>
                          </span>
                        )}
                        {ev.actual && (
                          <span style={{
                            fontSize: 12, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                            background: '#22c55e22', color: '#22c55e',
                          }}>{ev.actual} ✓</span>
                        )}
                      </div>

                      {isOpen && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border, #1e2a3a)' }}>
                          <div style={{ fontSize: 12, color: 'var(--text-dim, #64748b)', lineHeight: 1.6 }}>
                            {ev.description}
                          </div>
                          <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11 }}>
                              <span style={{ color: 'var(--text-dim, #64748b)' }}>Currency: </span>
                              <b>{ev.currency}</b>
                            </span>
                            <span style={{ fontSize: 11 }}>
                              <span style={{ color: 'var(--text-dim, #64748b)' }}>Category: </span>
                              <b style={{ textTransform: 'capitalize' }}>{ev.category}</b>
                            </span>
                            {ev.revised && (
                              <span style={{ fontSize: 11 }}>
                                <span style={{ color: 'var(--text-dim, #64748b)' }}>Revised: </span>
                                <b>{ev.revised}</b>
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {!loading && !error && tab === 'banks' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {banks.map(bank => {
              const tone = TONE_CONFIG[bank.tone];
              return (
                <div key={bank.acronym} style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border, #1e2a3a)',
                  borderRadius: 10,
                  padding: 16,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>{COUNTRY_FLAG[bank.country] || '🌐'}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{bank.bank}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim, #64748b)' }}>{bank.currency}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                        {bank.currentRate.toFixed(2)}{bank.rateUnit}
                      </div>
                      <div style={{ fontSize: 11, color: bank.lastChange === 'cut' ? '#22c55e' : bank.lastChange === 'hike' ? '#ef4444' : '#f59e0b' }}>
                        {bank.lastChange === 'cut' ? '▼' : bank.lastChange === 'hike' ? '▲' : '—'} {bank.lastChangeAmount}bp
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
                    <div style={{ fontSize: 11 }}>
                      <div style={{ color: 'var(--text-dim, #64748b)' }}>Next Meeting</div>
                      <div style={{ fontWeight: 600 }}>{bank.nextMeeting}</div>
                    </div>
                    <div style={{ fontSize: 11 }}>
                      <div style={{ color: 'var(--text-dim, #64748b)' }}>Tone</div>
                      <div style={{ fontWeight: 600, color: tone.color }}>{tone.label}</div>
                    </div>
                  </div>
                  <div style={{
                    background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                    borderRadius: 6, padding: '6px 10px', fontSize: 11,
                  }}>
                    <span style={{ color: 'var(--text-dim, #64748b)' }}>Market pricing: </span>
                    <b style={{ color: '#3b82f6' }}>{bank.marketImpliedNextMove}</b>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ fontSize: 10, color: 'var(--text-dim, #64748b)', borderTop: '1px solid var(--border, #1e2a3a)', paddingTop: 8 }}>
        FinceptTerminal · Economic Calendar · Central Bank Tracker · Times in ET
      </div>
    </div>
  );
};

export default EconomicCalendar;
