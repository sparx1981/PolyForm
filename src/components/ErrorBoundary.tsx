import React, { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
  name?: string;
  onReset?: () => void;
  compact?: boolean;
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
    console.error(`[ERROR] Uncaught error in ${this.props.name || 'component tree'}:`, error, errorInfo);
  }

  public handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isCompact = this.props.compact;

      return (
        <div className={`border border-red-200 dark:border-red-900/50 bg-red-50/90 dark:bg-red-950/30 rounded-xl text-red-700 dark:text-red-300 ${
          isCompact ? 'p-3 m-1' : 'p-4 m-2'
        }`}>
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle size={isCompact ? 14 : 16} className="text-red-500 shrink-0" />
            <span className="font-semibold text-xs tracking-tight">
              {this.props.name ? `${this.props.name} Encountered an Issue` : 'Component Failure'}
            </span>
          </div>
          <p className="text-[11px] text-red-600/80 dark:text-red-400/80 line-clamp-2 leading-relaxed mb-2 font-mono">
            {this.state.error?.message || 'An unexpected runtime error occurred.'}
          </p>
          <button 
            onClick={this.handleReset}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium bg-red-100 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 text-red-700 dark:text-red-200 rounded-md transition-colors cursor-pointer"
          >
            <RefreshCw size={10} />
            Attempt Recovery
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
