import React from 'react';
import Home from '../marketing/Home';
import Features from '../marketing/Features';
import BuildWithClaude from '../marketing/BuildWithClaude';
import Developers from '../marketing/Developers';
import SdkDocs from '../marketing/SdkDocs';
import { CmsLayout } from './Sections';
import type { Page } from '../marketing/router';
export default function MarketingPage({ id, go, onLogin }: { id: string; go: (page: Page, anchor?: string) => void; onLogin: () => void }) {
  if (id === 'home') return <Home go={go} onLogin={onLogin} />;
  if (id === 'features') return <Features go={go} />;
  if (id === 'claude') return <BuildWithClaude go={go} onLogin={onLogin} />;
  if (id === 'developers') return <Developers go={go} onLogin={onLogin} />;
  if (id === 'sdk-docs') return <SdkDocs go={go} />;
  return <CmsLayout page={id} />;
}
