import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../../AppContext';

export const BetaEffectsContext = createContext<ReactNode>(null);
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
  const [effects, setEffects] = useState<ReactNode>(null);
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
  // Keep cameras, controls and material owners at the same React path throughout loading.
  return <BetaEffectsContext.Provider value={enabled && effects ? <BetaFailureBoundary fallback={null} onError={fail}>{effects}</BetaFailureBoundary> : null}>
    {children}
    {enabled && runtime && <BetaFailureBoundary fallback={null} onError={fail}>
      <runtime.BetaEnvironmentRuntime onError={fail} onEffects={setEffects} />
    </BetaFailureBoundary>}
  </BetaEffectsContext.Provider>;
}

export function BetaEnvironmentEffects() {
  return useContext(BetaEffectsContext);
}
