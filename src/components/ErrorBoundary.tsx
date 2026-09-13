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
  resetKey: number;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    resetKey: 0
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, resetKey: 0 };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ERROR] Uncaught error in ${this.props.name || 'component tree'}:`, error, errorInfo);
  }

  public handleReset = () => {
    this.props.onReset?.();
    // Most callers don't pass onReset, and even when they do, flipping
    // hasError back to false alone re-renders the SAME child element —
    // if the crash came from bad local state inside that child rather
    // than props/context, it hits the identical state on the very next
    // render and immediately re-throws, leaving "Attempt Recovery"
    // permanently unable to actually recover. Bumping resetKey as this
    // boundary's own React `key` forces a full unmount/remount of the
    // subtree, discarding whatever local state caused the crash.
    this.setState((prev) => ({ hasError: false, error: undefined, resetKey: prev.resetKey + 1 }));
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

    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
