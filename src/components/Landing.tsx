import React, { useState } from 'react';
import Login from './Login';
import Home from './marketing/Home';
import Features from './marketing/Features';
import BuildWithClaude from './marketing/BuildWithClaude';
import Developers from './marketing/Developers';
import SdkDocs from './marketing/SdkDocs';
import { ClosingCTA, Footer, Header, useMarketingRouter } from './marketing/shared';
import { usePageSeo } from './marketing/seo';

/** The first page for visitors who aren't signed in. Everything else sits behind sign-in. */
export default function Landing() {
  const [loginOpen, setLoginOpen] = useState(false);
  const { page, go } = useMarketingRouter();
  usePageSeo(page);

  return (
    <div id="landing-page" className="fixed inset-0 overflow-y-auto overflow-x-hidden bg-white text-polyform-gray">
      <Header page={page} go={go} onLogin={() => setLoginOpen(true)} />

      <main>
        {page === 'home' && <Home go={go} onLogin={() => setLoginOpen(true)} />}
        {page === 'features' && <Features go={go} />}
        {page === 'claude' && <BuildWithClaude go={go} onLogin={() => setLoginOpen(true)} />}
        {page === 'developers' && <Developers onLogin={() => setLoginOpen(true)} go={go} />}
        {page === 'sdk-docs' && <SdkDocs go={go} />}
        <ClosingCTA page={page} onLogin={() => setLoginOpen(true)} />
      </main>

      <Footer go={go} onLogin={() => setLoginOpen(true)} />

      {loginOpen && <Login onClose={() => setLoginOpen(false)} />}
    </div>
  );
}
