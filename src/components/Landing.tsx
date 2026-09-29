import { lazy, Suspense, useEffect, useState } from 'react';
import MarketingContent from './cms/MarketingContent';
import { useCms } from './cms/context';
import { isCmsAdmin } from './cms/access';
import { CmsLayout } from './cms/Sections';
import { pagePaths } from './cms/model';
const CmsAdmin = lazy(() => import('./cms/CmsAdmin'));
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
  return <MarketingContent><LandingContent onEnterApp={onEnterApp} /></MarketingContent>;
}
function LandingContent({ onEnterApp }: { onEnterApp: () => void }) {
  const { user } = useApp();
  const [loginOpen, setLoginOpen] = useState(false);
  const [cmsOpen, setCmsOpen] = useState(false);
  const { content } = useCms();
  const { page, go, pathname } = useMarketingRouter();
  const custom = content?.pages.find(p => p.path === pathname && !pagePaths[p.id]);
  const existing = Object.values(pagePaths).includes(pathname) || pathname === '/designs';
  const hidden = content?.pages.find(p => p.path === pathname)?.hidden;
  usePageSeo(page, pathname);
  useEffect(() => { const open = () => { if (isCmsAdmin(user)) setCmsOpen(true); }; window.addEventListener('polyform:open-cms', open); return () => window.removeEventListener('polyform:open-cms', open); }, [user]);

  useEffect(() => {
    // My Designs is a private, signed-in page - not anonymous marketing traffic.
    if (existing && page !== 'designs') void recordWebsiteActivity(page as MarketingPage);
  }, [page, existing]);

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
        {(!existing || hidden) ? custom && !hidden ? <CmsLayout page={custom.id} /> : <div className="py-24 px-6 text-center"><h1 className="text-3xl font-bold">Page unavailable</h1><a href="/" className="inline-block mt-5 text-polyform-blue">Return home</a></div> : <>
        {page === 'home' && <Home go={go} onLogin={onPrimaryCta} />}
        {page === 'features' && <Features go={go} />}
        {page === 'claude' && <BuildWithClaude go={go} onLogin={onPrimaryCta} />}
        {page === 'developers' && <Developers onLogin={onPrimaryCta} go={go} />}
        {page === 'sdk-docs' && <SdkDocs go={go} />}
        {page === 'designs' && <Designs onOpenDesign={onEnterApp} onSignInRequired={() => setLoginOpen(true)} />}
        </>}
        {page !== 'designs' && !hidden && (existing || custom) && <ClosingCTA page={page} onLogin={onPrimaryCta} />}
      </main>

      <Footer go={go} onLogin={onPrimaryCta} user={user} onOpenDesigns={onOpenDesigns} onSignOut={onSignOut} />

      {loginOpen && <Login onClose={() => setLoginOpen(false)} />}
      {cmsOpen && isCmsAdmin(user) && <Suspense fallback={<div role="status" className="fixed inset-0 z-[1000] bg-white p-12">Loading content studio…</div>}><CmsAdmin onClose={() => setCmsOpen(false)} /></Suspense>}
    </div>
  );
}
