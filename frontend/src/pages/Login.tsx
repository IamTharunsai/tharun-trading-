import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { login } from '../services/api';
import toast from 'react-hot-toast';
import { Zap, Lock, Mail, Shield } from 'lucide-react';

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
    <div className="min-h-screen bg-apex-bg flex items-center justify-center p-4">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: 'linear-gradient(#E8D5C4 1px, transparent 1px), linear-gradient(90deg, #E8D5C4 1px, transparent 1px)',
        backgroundSize: '50px 50px'
      }} />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-apex-accent/10 border border-apex-accent/30 mb-4">
            <Zap size={32} className="text-apex-accent" />
          </div>
          <h1 className="font-sans font-bold text-3xl text-apex-text">THARUN TRADING AGENT</h1>
          <p className="font-mono text-xs text-apex-muted mt-1 tracking-widest">AI-POWERED AUTONOMOUS TRADING</p>
        </div>

        {/* Card */}
        <div className="card card-glow">
          <div className="flex items-center gap-2 mb-6">
            <Lock size={14} className="text-apex-accent" />
            <span className="font-mono text-xs text-apex-muted uppercase tracking-widest">Secure Access — Owner Only</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block font-mono text-xs text-apex-muted mb-1.5 uppercase tracking-wider">Email</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-apex-muted" />
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  className="w-full bg-apex-surface border border-apex-border rounded-lg pl-9 pr-4 py-2.5 font-mono text-sm text-apex-text placeholder-apex-muted focus:outline-none focus:border-apex-accent transition-colors"
                  placeholder="nandigam2081@gmail.com"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-xs text-apex-muted mb-1.5 uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-apex-muted" />
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)} required
                  className="w-full bg-apex-surface border border-apex-border rounded-lg pl-9 pr-4 py-2.5 font-mono text-sm text-apex-text placeholder-apex-muted focus:outline-none focus:border-apex-accent transition-colors"
                  placeholder="••••••••••••"
                />
              </div>
            </div>

            {requireTotp && (
              <div>
                <label className="block font-mono text-xs text-apex-muted mb-1.5 uppercase tracking-wider">2FA Code</label>
                <div className="relative">
                  <Shield size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-apex-yellow" />
                  <input
                    type="text" value={totp} onChange={e => setTotp(e.target.value)}
                    maxLength={6} pattern="[0-9]{6}"
                    className="w-full bg-apex-surface border border-apex-yellow/50 rounded-lg pl-9 pr-4 py-2.5 font-mono text-sm text-apex-yellow placeholder-apex-muted focus:outline-none focus:border-apex-yellow transition-colors tracking-[0.3em]"
                    placeholder="000000"
                  />
                </div>
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full bg-apex-accent hover:bg-apex-accent/90 text-apex-bg font-mono font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
            >
              {loading ? (
                <><span className="animate-spin">◌</span> Authenticating...</>
              ) : (
                <><Zap size={16} /> ACCESS SYSTEM</>
              )}
            </button>
          </form>
        </div>

        <p className="text-center font-mono text-xs text-apex-muted mt-6 opacity-50">
          Unauthorized access attempts are logged and reported.
        </p>
      </div>
    </div>
  );
}
