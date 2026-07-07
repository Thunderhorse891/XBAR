import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';
import { useXbarStore } from '@/store/useXbarStore';

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

  handleResetWorkspace = async () => {
    try {
      await useXbarStore.persist.clearStorage();
    } catch (error) {
      console.error('Failed to clear persisted workspace state', error);
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="app-error-shell">
        <div className="app-error-panel">
          <div className="app-error-panel__eyebrow">Application error</div>
          <h1 className="app-error-panel__title">This screen hit a runtime problem</h1>
          <p className="app-error-panel__copy">
            The app stopped a broken component before it could take down the whole workspace. Reload to retry, or clear
            the browser workspace if the saved session is corrupted.
          </p>
          <div className="app-error-panel__message">{this.state.error.message}</div>
          <div className="inline-actions">
            <button className="button button--primary" type="button" onClick={this.handleReload}>
              Reload app
            </button>
            <button className="button button--ghost" type="button" onClick={this.handleResetWorkspace}>
              Clear browser workspace
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundaryImpl;
