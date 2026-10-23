import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { login } from '../services/api';
import toast from 'react-hot-toast';
import { Zap, Lock, Mail, Shield, Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totp, setTotp] = useState('');
  const [requireTotp, setRequireTotp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { setAuth } = useStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const data = await login(email, password, requireTotp ? totp : undefined);
      setAuth(data.token, data.user);
      toast.success('Access granted — Authenticated as Owner');
      navigate('/');
    } catch (err: any) {
      if (err.response?.data?.requireTotp) {
        setRequireTotp(true);
        toast('Enter your Two-Factor Authentication (2FA) code', { icon: '🔐' });
      } else {
        const msg = err.response?.data?.error || 'Invalid email or password.';
        setErrorMsg(msg);
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bh-scope bh-chakra-lines min-h-screen bg-bh-ink-950 text-bh-bone-100 flex items-center justify-center p-4 relative overflow-hidden font-plex">
      {/* Subtle grid pattern background */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, #C6A15B 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative z-10 w-full max-w-md bh-page-enter">
        {/* Header Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-bh-lg bg-bh-gold-dim border border-bh-border-strong shadow-bh-gold-glow bh-gold-pulse mb-4">
            <Zap size={32} className="text-bh-gold-bright" />
          </div>
          <h1 className="bh-wordmark font-alike text-3xl">
            BHISHMA
          </h1>
          <p className="font-mono text-xs text-bh-bone-500 mt-1 uppercase tracking-wider">
            Trading Terminal · Owner Authentication
          </p>
        </div>

        {/* Login Card */}
        <div className="bh-panel bh-reveal p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-2 pb-4 border-b border-bh-border">
            <Lock size={14} className="text-bh-gold" />
            <span className="font-mono text-xs text-bh-bone-300 font-bold uppercase tracking-wider">
              Secure Owner Gateway
            </span>
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2.5 p-3 rounded-bh bg-bh-down/10 border border-bh-down/30 text-bh-down text-xs font-mono">
              <AlertCircle size={16} className="shrink-0 text-bh-down" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Email Field */}
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block font-mono text-xs text-bh-bone-500 font-semibold tracking-wider">
                EMAIL ADDRESS
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-bh-bone-600" />
                <input data-testid="login-email"
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="owner@domain.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-bh-ink-750 border border-bh-border rounded-bh font-mono text-sm text-bh-bone-100 placeholder-bh-bone-600 focus:outline-none focus:border-bh-gold-deep focus:ring-1 focus:ring-bh-gold/40 transition"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block font-mono text-xs text-bh-bone-500 font-semibold tracking-wider">
                PASSWORD
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-bh-bone-600" />
                <input data-testid="login-password"
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-11 py-2.5 bg-bh-ink-750 border border-bh-border rounded-bh font-mono text-sm text-bh-bone-100 placeholder-bh-bone-600 focus:outline-none focus:border-bh-gold-deep focus:ring-1 focus:ring-bh-gold/40 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-bh-bone-600 hover:text-bh-bone-100 transition p-1"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* 2FA Field (conditionally required) */}
            {requireTotp && (
              <div className="space-y-1.5 p-3 rounded-bh bg-bh-gold/10 border border-bh-gold/30 bh-reveal">
                <label htmlFor="login-totp" className="block font-mono text-xs text-bh-gold-bright font-bold tracking-wider">
                  2FA AUTHENTICATOR CODE
                </label>
                <div className="relative">
                  <Shield size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-bh-gold" />
                  <input data-testid="login-totp"
                    id="login-totp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totp}
                    onChange={e => setTotp(e.target.value)}
                    maxLength={6}
                    pattern="[0-9]{6}"
                    placeholder="000000"
                    className="w-full pl-10 pr-4 py-2.5 bg-bh-ink-750 border border-bh-gold/50 rounded-bh font-mono text-base tracking-[0.3em] text-bh-bone-100 focus:outline-none focus:border-bh-gold focus:ring-1 focus:ring-bh-gold/40 transition"
                  />
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button data-testid="login-submit"
              type="submit"
              disabled={loading}
              className="bh-gold-hover w-full mt-2 py-3 px-4 rounded-bh bg-gradient-to-r from-bh-gold-deep via-bh-gold to-bh-gold-deep hover:from-bh-gold hover:to-bh-gold-bright text-bh-ink-950 font-mono font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-bh-ink-950 border-t-transparent rounded-full animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <Zap size={16} />
                  <span>AUTHENTICATE & ENTER SYSTEM</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Security Warning Notice */}
        <p className="text-center font-mono text-[11px] text-bh-bone-600 mt-6">
          Access restricted to authorized account owners. All authentication attempts are logged and monitored.
        </p>
      </div>
    </div>
  );
}
