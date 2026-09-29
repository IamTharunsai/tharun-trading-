import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] page crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Navigating to another page clears the error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-xl mx-auto mt-10 bg-white border border-red-200 rounded-xl p-6 shadow-xs text-center" data-testid="error-boundary">
        <AlertTriangle className="mx-auto text-red-500 mb-3" size={28} />
        <h2 className="text-lg font-bold text-slate-900 mb-1">This page hit an error</h2>
        <p className="text-sm text-slate-500 mb-3">Something on this page failed to render. The rest of the terminal is still working.</p>
        <pre className="text-[11px] text-left bg-slate-50 border border-slate-200 rounded p-2 text-red-700 overflow-x-auto mb-4 whitespace-pre-wrap">{String(this.state.error?.message || this.state.error)}</pre>
        <div className="flex justify-center gap-2">
          <button
            data-testid="error-boundary-retry"
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700"
          >Try again</button>
          <button
            data-testid="error-boundary-reload"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center gap-1.5"
          ><RotateCcw size={14} /> Reload</button>
        </div>
      </div>
    );
  }
}
