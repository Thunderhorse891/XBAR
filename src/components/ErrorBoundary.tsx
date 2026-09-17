import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error?: Error;
};

class ErrorBoundaryImpl extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('XBAR UI error boundary', error, errorInfo);
    void trackRuntimeEvent({
      workspaceId: useCloudStore.getState().workspaceId,
      eventName: 'ui.error_boundary',
      severity: 'error',
      payload: {
        message: error.message,
        stack: error.stack ?? '',
        componentStack: errorInfo.componentStack,
      },
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const screenLoadFailed =
      /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \S+ failed/i.test(
        this.state.error.message,
      );

    return (
      <div className="app-error-shell">
        <div className="app-error-panel" role="alert">
          <div className="app-error-panel__eyebrow">
            {screenLoadFailed ? 'Screen unavailable' : 'Application error'}
          </div>
          <h1 className="app-error-panel__title">
            {screenLoadFailed ? 'This screen could not load' : 'This screen hit a runtime problem'}
          </h1>
          <p className="app-error-panel__copy">
            {screenLoadFailed
              ? 'An app update or a connection interruption can prevent this screen from loading. Check your connection, then reload to try again.'
              : 'The app stopped a broken screen. Reload to try again. If the problem continues, share the technical details with support.'}
          </p>
          <p className="app-error-panel__copy">
            Reloading does not clear saved workspace data. Any unsaved edits on this screen may be lost.
          </p>
          <details className="app-error-panel__message">
            <summary>Technical details</summary>
            <p>{this.state.error.message}</p>
          </details>
          <div className="inline-actions">
            <button className="button button--primary" type="button" onClick={this.handleReload}>
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundaryImpl;
