import type { ReactNode } from 'react';
import React from 'react';

type FallbackRender = (args: { error: Error; reset: () => void }) => ReactNode;

interface ErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  fallback?: ReactNode | FallbackRender;
  resetKeys?: unknown[];
  onError?: (error: Error, info: React.ErrorInfo) => void;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (!this.state.error) return;

    const prevKeys = prevProps.resetKeys;
    const nextKeys = this.props.resetKeys;
    if (!prevKeys || !nextKeys) return;
    if (prevKeys.length !== nextKeys.length) {
      this.reset();
      return;
    }
    for (let i = 0; i < prevKeys.length; i += 1) {
      if (!Object.is(prevKeys[i], nextKeys[i])) {
        this.reset();
        return;
      }
    }
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const { title, fallback } = this.props;
    const error = this.state.error;

    if (typeof fallback === 'function') {
      return fallback({ error, reset: this.reset });
    }

    if (fallback) {
      return fallback;
    }

    return (
      <div className="h-full w-full flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-xl border border-border/70 bg-background/80 shadow-xl p-5">
          <div className="text-sm font-semibold text-foreground">
            {title ? `${title} crashed` : 'Something went wrong'}
          </div>
          <div className="mt-2 text-xs text-muted-foreground break-words">
            {error.message || String(error)}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-md border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/40"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
