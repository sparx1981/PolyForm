import React, { useEffect, useState } from 'react';
import Login from './Login';
import Home from './marketing/Home';
import Features from './marketing/Features';
import BuildWithClaude from './marketing/BuildWithClaude';
import Developers from './marketing/Developers';
import { ClosingCTA, Footer, Header, useMarketingRouter } from './marketing/shared';

const TITLES: Record<string, string> = {
  home: 'PolyForm · 3D design for buildings and gardens',
  features: 'Features · PolyForm',
  claude: 'Build with Claude · PolyForm',
  developers: 'Developers · PolyForm',
};

/** The first page for visitors who aren't signed in. Everything else sits behind sign-in. */
export default function Landing() {
  const [loginOpen, setLoginOpen] = useState(false);
  const { page, go } = useMarketingRouter();

  useEffect(() => {
    document.title = TITLES[page];
  }, [page]);

  return (
    <div id="landing-page" className="fixed inset-0 overflow-y-auto overflow-x-hidden bg-white text-trimble-gray">
      <Header page={page} go={go} onLogin={() => setLoginOpen(true)} />

      <main>
        {page === 'home' && <Home go={go} onLogin={() => setLoginOpen(true)} />}
        {page === 'features' && <Features />}
        {page === 'claude' && <BuildWithClaude />}
        {page === 'developers' && <Developers onLogin={() => setLoginOpen(true)} />}
        <ClosingCTA onLogin={() => setLoginOpen(true)} />
      </main>

      <Footer go={go} onLogin={() => setLoginOpen(true)} />

      {loginOpen && <Login onClose={() => setLoginOpen(false)} />}
    </div>
  );
}
