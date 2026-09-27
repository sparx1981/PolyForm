import React, { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useApp } from '../AppContext';
import Login from './Login';
import Home from './marketing/Home';
import Features from './marketing/Features';
import BuildWithClaude from './marketing/BuildWithClaude';
import Developers from './marketing/Developers';
import SdkDocs from './marketing/SdkDocs';
import Designs from './marketing/Designs';
import { ClosingCTA, Footer, Header, useMarketingRouter } from './marketing/shared';
import { usePageSeo } from './marketing/seo';
import { recordWebsiteActivity, type MarketingPage } from '../lib/websiteActivity';

/**
 * The marketing site. Rendered for signed-out visitors and, now that sign-in happens in place,
 * for signed-in users too - the header swaps "Sign in" for a profile menu but the page underneath
 * doesn't change. `onEnterApp` is the only way out of here into the editor (Start designing, or
 * opening a design from My Designs).
 */
export default function Landing({ onEnterApp }: { onEnterApp: () => void }) {
  const { user } = useApp();
  const [loginOpen, setLoginOpen] = useState(false);
  const { page, go } = useMarketingRouter();
  usePageSeo(page);

  useEffect(() => {
    // My Designs is a private, signed-in page - not anonymous marketing traffic.
    if (page !== 'designs') void recordWebsiteActivity(page as MarketingPage);
  }, [page]);

  // Once sign-in succeeds, close the modal rather than leaving it open over the same page.
  useEffect(() => {
    if (user && loginOpen) setLoginOpen(false);
  }, [user, loginOpen]);

  const onPrimaryCta = user ? onEnterApp : () => setLoginOpen(true);
  const onOpenDesigns = () => go('designs');
  const onSignOut = () => {
    void signOut(auth);
    go('home');
  };

  return (
    <div id="landing-page" className="fixed inset-0 overflow-y-auto overflow-x-hidden bg-white text-polyform-gray">
      <Header page={page} go={go} onLogin={onPrimaryCta} user={user} onOpenDesigns={onOpenDesigns} onSignOut={onSignOut} />

      <main>
        {page === 'home' && <Home go={go} onLogin={onPrimaryCta} />}
        {page === 'features' && <Features go={go} />}
        {page === 'claude' && <BuildWithClaude go={go} onLogin={onPrimaryCta} />}
        {page === 'developers' && <Developers onLogin={onPrimaryCta} go={go} />}
        {page === 'sdk-docs' && <SdkDocs go={go} />}
        {page === 'designs' && <Designs onOpenDesign={onEnterApp} onSignInRequired={() => setLoginOpen(true)} />}
        {page !== 'designs' && <ClosingCTA page={page} onLogin={onPrimaryCta} />}
      </main>

      <Footer go={go} onLogin={onPrimaryCta} user={user} onOpenDesigns={onOpenDesigns} onSignOut={onSignOut} />

      {loginOpen && <Login onClose={() => setLoginOpen(false)} />}
    </div>
  );
}
