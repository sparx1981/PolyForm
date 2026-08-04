import React, { ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ERROR] Uncaught error in component tree:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-6 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl m-4">
          <div className="flex items-center gap-3 mb-2 text-red-600 dark:text-red-400">
            <span className="font-bold text-sm">Component Failure</span>
          </div>
          <p className="text-xs text-red-600/70 dark:text-red-400/70 overflow-hidden text-ellipsis">
            {this.state.error?.message}
          </p>
          <button 
            onClick={() => this.setState({ hasError: false })}
            className="mt-3 text-[10px] font-bold text-red-600 hover:underline"
          >
            Attempt Recovery
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
