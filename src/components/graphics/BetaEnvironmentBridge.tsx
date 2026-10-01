import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../../AppContext';
import type { BetaEffects } from './BetaEnvironmentRuntime';

export const BetaEffectsContext = createContext<typeof BetaEffects | null>(null);
type Runtime = typeof import('./BetaEnvironmentRuntime');
let loading: Promise<Runtime> | undefined;

class BetaFailureBoundary extends React.Component<{ children: ReactNode; fallback: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('Beta environment unavailable', error); this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function BetaEnvironmentRoot({ children }: { children: ReactNode }) {
  const { graphicsSettings, setGraphicsSettings, setMeasurements } = useApp();
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const enabled = graphicsSettings.beta.enabled;
  const fail = () => {
    setGraphicsSettings(p => ({ ...p, beta: { ...p.beta, enabled: false } }));
    setMeasurements('Beta environment could not load. Existing rendering restored; try enabling Beta again.');
  };
  useEffect(() => {
    if (!enabled || runtime) return;
    let active = true;
    loading ??= import('./BetaEnvironmentRuntime');
    loading.then(module => { if (active) setRuntime(module); }).catch(() => { loading = undefined; if (active) fail(); });
    return () => { active = false; };
  }, [enabled, runtime]);
  if (!enabled || !runtime) return <>{children}</>;
  return <BetaFailureBoundary fallback={children} onError={fail}><runtime.BetaEnvironmentRuntime onError={fail}>{children}</runtime.BetaEnvironmentRuntime></BetaFailureBoundary>;
}

export function BetaEnvironmentEffects() {
  const Effects = useContext(BetaEffectsContext);
  return Effects ? <Effects /> : null;
}
