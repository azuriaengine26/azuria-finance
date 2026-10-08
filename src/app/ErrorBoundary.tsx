import { Component, type ReactNode } from 'react';

/** Keeps one broken screen from taking down the whole app; your data is untouched. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  componentDidCatch(error: Error) { console.error('Screen error', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel" role="alert" style={{ maxWidth: 560 }}>
        <h2>This screen hit a problem</h2>
        <p className="small muted" style={{ margin: '8px 0 14px' }}>Your data is safe — nothing was changed. Go back to the dashboard, or reload the app. If it keeps happening, export a backup from Settings and send the message below to support.</p>
        <pre className="tiny" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 10, borderRadius: 8 }}>{String(this.state.error.message)}</pre>
        <div className="row" style={{ marginTop: 12 }}>
          <a className="btn primary" href="#/" onClick={() => this.setState({ error: null })}>Go to dashboard</a>
          <button className="btn" onClick={() => location.reload()}>Reload app</button>
        </div>
      </div>
    );
  }
}
