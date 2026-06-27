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
  confirmingClear: boolean;
};

class ErrorBoundaryImpl extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { confirmingClear: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
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

  handleRequestClear = () => {
    this.setState({ confirmingClear: true });
  };

  handleCancelClear = () => {
    this.setState({ confirmingClear: false });
  };

  handleConfirmClear = async () => {
    try {
      await useXbarStore.persist.clearStorage();
    } catch {
      // Proceed with reload even if clear fails — the goal is recovery.
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const { confirmingClear } = this.state;

    return (
      <div className="app-error-shell">
        <div className="app-error-panel">
          <div className="app-error-panel__eyebrow">Application error</div>
          <h1 className="app-error-panel__title">This screen hit a runtime problem</h1>
          <p className="app-error-panel__copy">
            The app stopped a broken component before it could take down the whole workspace. Reload to retry, or clear the
            browser workspace if the saved session is corrupted.
          </p>
          <div className="app-error-panel__message">{this.state.error.message}</div>

          {confirmingClear ? (
            <div className="app-error-panel__confirm">
              <p className="app-error-panel__confirm-text">
                This will permanently delete all local workspace data including horses, documents, and records. This
                action cannot be undone. Cloud-synced data will not be affected.
              </p>
              <div className="inline-actions">
                <button className="button button--destructive" type="button" onClick={this.handleConfirmClear}>
                  Yes, clear everything
                </button>
                <button className="button button--ghost" type="button" onClick={this.handleCancelClear}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="inline-actions">
              <button className="button button--primary" type="button" onClick={this.handleReload}>
                Reload app
              </button>
              <button className="button button--ghost" type="button" onClick={this.handleRequestClear}>
                Clear browser workspace
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundaryImpl;
