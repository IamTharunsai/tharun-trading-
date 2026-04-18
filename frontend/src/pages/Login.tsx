import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { login } from '../services/api';
import toast from 'react-hot-toast';
import { Zap, Lock, Mail, Shield } from 'lucide-react';

const C = {
  bg:     '#FAF6F1',
  card:   '#FFFFFF',
  border: '#E8D5C4',
  accent: '#FF8C42',
  text:   '#2C1810',
  muted:  '#8B6F47',
  green:  '#2D8A4A',
  yellow: '#F5A623',
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [requireTotp, setRequireTotp] = useState(false);
  const [loading, setLoading] = useState(false);
  const { setAuth } = useStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await login(email, password, requireTotp ? totp : undefined);
      setAuth(data.token, data.user);
      toast.success('Access granted');
      navigate('/');
    } catch (err: any) {
      if (err.response?.data?.requireTotp) {
        setRequireTotp(true);
        toast('Enter your 2FA code', { icon: '🔐' });
      } else {
        toast.error(err.response?.data?.error || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      fontFamily: 'Syne, sans-serif',
    }}>
      {/* Subtle dot grid background */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.35,
        backgroundImage: 'radial-gradient(circle, #E8D5C4 1px, transparent 1px)',
        backgroundSize: '28px 28px',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 380 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64, borderRadius: 18,
            background: `linear-gradient(135deg, ${C.accent}, #E8732A)`,
            marginBottom: 16, boxShadow: '0 8px 24px rgba(255,140,66,0.3)',
          }}>
            <Zap size={30} color="#fff" />
          </div>
          <h1 style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 28, color: C.text, margin: '0 0 6px' }}>
            THARUN TRADING AGENT
          </h1>
          <p style={{ fontFamily: 'Space Mono', fontSize: 11, color: C.muted, margin: 0, letterSpacing: '0.12em' }}>
            AI-POWERED AUTONOMOUS TRADING
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: C.card,
          border: `1.5px solid ${C.border}`,
          borderRadius: 16,
          padding: 28,
          boxShadow: '0 4px 24px rgba(139,111,71,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
            <Lock size={13} color={C.accent} />
            <span style={{ fontFamily: 'Space Mono', fontSize: 11, color: C.muted, letterSpacing: '0.1em' }}>
              SECURE ACCESS — OWNER ONLY
            </span>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Email */}
            <div>
              <label style={{ fontFamily: 'Space Mono', fontSize: 10, color: C.muted, display: 'block', marginBottom: 6, letterSpacing: '0.1em' }}>
                EMAIL ADDRESS
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={13} color={C.muted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  placeholder="your@email.com"
                  style={{
                    width: '100%', padding: '11px 12px 11px 36px',
                    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
                    fontFamily: 'Space Mono', fontSize: 13, color: C.text,
                    outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => e.target.style.borderColor = C.accent}
                  onBlur={e => e.target.style.borderColor = C.border}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={{ fontFamily: 'Space Mono', fontSize: 10, color: C.muted, display: 'block', marginBottom: 6, letterSpacing: '0.1em' }}>
                PASSWORD
              </label>
              <div style={{ position: 'relative' }}>
                <Lock size={13} color={C.muted} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)} required
                  placeholder="••••••••••••"
                  style={{
                    width: '100%', padding: '11px 12px 11px 36px',
                    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
                    fontFamily: 'Space Mono', fontSize: 13, color: C.text,
                    outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => e.target.style.borderColor = C.accent}
                  onBlur={e => e.target.style.borderColor = C.border}
                />
              </div>
            </div>

            {/* 2FA */}
            {requireTotp && (
              <div>
                <label style={{ fontFamily: 'Space Mono', fontSize: 10, color: C.yellow, display: 'block', marginBottom: 6, letterSpacing: '0.1em' }}>
                  2FA CODE
                </label>
                <div style={{ position: 'relative' }}>
                  <Shield size={13} color={C.yellow} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    type="text" value={totp} onChange={e => setTotp(e.target.value)}
                    maxLength={6} pattern="[0-9]{6}" placeholder="000000"
                    style={{
                      width: '100%', padding: '11px 12px 11px 36px',
                      background: '#FFFBEE', border: `1px solid ${C.yellow}`, borderRadius: 8,
                      fontFamily: 'Space Mono', fontSize: 16, color: C.text,
                      outline: 'none', letterSpacing: '0.3em', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit" disabled={loading}
              style={{
                marginTop: 4,
                padding: '13px 24px',
                background: loading ? '#E8D5C4' : `linear-gradient(135deg, ${C.accent}, #E8732A)`,
                border: 'none', borderRadius: 10,
                fontFamily: 'Space Mono', fontWeight: 700, fontSize: 13,
                color: loading ? C.muted : '#FFFFFF',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: loading ? 'none' : '0 4px 16px rgba(255,140,66,0.35)',
                transition: 'all 0.2s ease',
              }}
            >
              {loading ? (
                <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>◌</span> Authenticating...</>
              ) : (
                <><Zap size={15} /> ACCESS SYSTEM</>
              )}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontFamily: 'Space Mono', fontSize: 10, color: C.muted, marginTop: 20, opacity: 0.7 }}>
          Unauthorized access is logged and reported.
        </p>
      </div>
    </div>
  );
}
