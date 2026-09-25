import React, { useEffect, useState } from 'react';
import { Box, LogIn } from 'lucide-react';

export type Page = 'home' | 'features' | 'claude' | 'developers';

const PATHS: Record<Page, string> = { home: '/', features: '/features', claude: '/claude', developers: '/developers' };

function pageFromHash(): Page {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === '/features') return 'features';
  if (hash === '/claude') return 'claude';
  if (hash === '/developers') return 'developers';
  return 'home';
}

/** Small hash-based router for the signed-out marketing site (no server-side SPA fallback configured). */
export function useMarketingRouter() {
  const [page, setPage] = useState<Page>(pageFromHash);

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const go = (next: Page, anchor?: string) => {
    window.location.hash = PATHS[next] + (anchor ? `#${anchor}` : '');
    // window.location.hash above already changes the hash once; ensure state updates even if the hash string is identical.
    setPage(next);
    window.scrollTo(0, 0);
    if (anchor) {
      requestAnimationFrame(() => scrollToId(anchor));
    }
  };

  return { page, go };
}

export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 84;
  window.scrollTo({ top, behavior: 'smooth' });
}

export function Logo({ onClick, size = 32, textSize = 'text-[19px]' }: { onClick?: () => void; size?: number; textSize?: string }) {
  return (
    <span
      onClick={onClick}
      className={`flex items-center gap-2.5 font-bold ${textSize} tracking-[-0.01em] text-polyform-dark-blue ${onClick ? 'cursor-pointer' : ''}`}
    >
      <span
        className="rounded-lg bg-polyform-blue text-white flex items-center justify-center shadow-sm shrink-0"
        style={{ width: size, height: size }}
      >
        <Box size={Math.round(size * 0.56)} />
      </span>
      PolyForm
    </span>
  );
}

const NAV: { page: Page; label: string }[] = [
  { page: 'features', label: 'Features' },
  { page: 'claude', label: 'Build with Claude' },
  { page: 'developers', label: 'Developers' },
];

export function Header({ page, go, onLogin }: { page: Page; go: (p: Page, anchor?: string) => void; onLogin: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-[100] bg-white/85 backdrop-blur-md border-b border-gray-100" style={{ height: 68 }}>
      <nav className="max-w-[1200px] mx-auto px-6 h-full flex items-center justify-between gap-6" aria-label="Main">
        <Logo onClick={() => go('home')} />

        <div className="hidden md:flex items-center gap-1">
          {NAV.map(n => (
            <button
              key={n.page}
              type="button"
              onClick={() => go(n.page)}
              className={
                'text-sm font-semibold px-3.5 py-2 rounded-lg transition-colors '
                + (page === n.page ? 'text-polyform-blue bg-[rgb(0_99_163_/_0.08)]' : 'text-gray-600 hover:bg-gray-50')
              }
            >
              {n.label}
            </button>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={onLogin}
            className="text-sm font-semibold px-3.5 py-2 rounded-lg text-polyform-gray hover:bg-gray-50 transition-colors"
          >
            Log in
          </button>
          <button
            type="button"
            onClick={onLogin}
            className="text-sm font-semibold px-4 py-[9px] rounded-lg bg-polyform-blue text-white shadow-[0_4px_12px_rgb(0_99_163_/_0.2)] hover:bg-polyform-dark-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-polyform-blue"
          >
            Start designing
          </button>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen(v => !v)}
          className="md:hidden text-sm font-semibold px-3 py-2 rounded-lg text-polyform-gray hover:bg-gray-50"
          aria-expanded={mobileOpen}
          aria-label="Menu"
        >
          Menu
        </button>
      </nav>

      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white px-6 py-3 flex flex-col gap-1">
          {NAV.map(n => (
            <button
              key={n.page}
              type="button"
              onClick={() => { go(n.page); setMobileOpen(false); }}
              className={
                'text-sm font-semibold px-3.5 py-2.5 rounded-lg text-left '
                + (page === n.page ? 'text-polyform-blue bg-[rgb(0_99_163_/_0.08)]' : 'text-gray-600 hover:bg-gray-50')
              }
            >
              {n.label}
            </button>
          ))}
          <div className="h-px bg-gray-100 my-2" />
          <button type="button" onClick={() => { onLogin(); setMobileOpen(false); }} className="text-sm font-semibold px-3.5 py-2.5 rounded-lg text-left text-polyform-gray hover:bg-gray-50">
            Log in
          </button>
          <button type="button" onClick={() => { onLogin(); setMobileOpen(false); }} className="text-sm font-semibold px-4 py-2.5 rounded-lg bg-polyform-blue text-white text-center">
            Start designing
          </button>
        </div>
      )}
    </header>
  );
}

export function ClosingCTA({ onLogin }: { onLogin: () => void }) {
  return (
    <section className="bg-polyform-dark-blue text-white py-[88px]">
      <div className="max-w-[1200px] mx-auto px-6 flex flex-wrap items-center justify-between gap-7">
        <div>
          <h2 className="text-[clamp(30px,3.6vw,46px)] font-bold tracking-[-0.02em]">Start your first design</h2>
          <p className="mt-2 text-[17px] text-white/80">Sign in and you&rsquo;re straight into the modeller.</p>
        </div>
        <button
          type="button"
          onClick={onLogin}
          className="inline-flex items-center gap-2 rounded-lg bg-white text-polyform-dark-blue font-semibold text-base px-[26px] py-[14px] hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-polyform-dark-blue"
        >
          <LogIn size={18} /> Login Now
        </button>
      </div>
    </section>
  );
}

type FooterCol = { title: string; links: { label: string; page?: Page; anchor?: string; onClick?: () => void }[] };

export function Footer({ go, onLogin }: { go: (p: Page, anchor?: string) => void; onLogin: () => void }) {
  const columns: FooterCol[] = [
    { title: 'PRODUCT', links: [{ label: 'Features', page: 'features' }, { label: 'Build with Claude', page: 'claude' }, { label: 'Developers', page: 'developers' }] },
    {
      title: 'FEATURES',
      links: [
        { label: 'Architecture', page: 'features', anchor: 'architecture' },
        { label: 'Terrain', page: 'features', anchor: 'terrain' },
        { label: 'Site location', page: 'features', anchor: 'location' },
        { label: 'Weather', page: 'features', anchor: 'weather' },
        { label: 'Collaboration', page: 'features', anchor: 'collaboration' },
      ],
    },
    { title: 'ACCOUNT', links: [{ label: 'Log in', onClick: onLogin }] },
  ];

  return (
    <footer className="border-t border-gray-100 pt-16 pb-10">
      <div className="max-w-[1200px] mx-auto px-6 flex flex-col gap-12">
        <div className="flex flex-wrap justify-between gap-10">
          <div className="flex flex-col gap-3 max-w-[300px]">
            <Logo size={28} textSize="text-lg" onClick={() => go('home')} />
            <p className="text-sm text-gray-500 leading-relaxed">3D design for buildings and gardens.</p>
          </div>
          <div className="flex flex-wrap gap-14">
            {columns.map(col => (
              <div key={col.title} className="flex flex-col gap-2.5">
                <span className="text-[11px] font-bold tracking-[0.12em] text-gray-400">{col.title}</span>
                {col.links.map(link => (
                  <button
                    key={link.label}
                    type="button"
                    onClick={link.onClick ?? (() => go(link.page!, link.anchor))}
                    className="text-sm text-gray-600 hover:text-polyform-blue text-left transition-colors"
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="text-[13px] text-gray-500 border-t border-gray-100 pt-6">© {new Date().getFullYear()} PolyForm</div>
      </div>
    </footer>
  );
}

export function Eyebrow({ children, dark = false, icon }: { children: React.ReactNode; dark?: boolean; icon?: React.ReactNode }) {
  return (
    <span className={'inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] ' + (dark ? 'text-white' : 'text-polyform-blue')}>
      {icon}
      {children}
    </span>
  );
}

export function IconTile({ icon, size = 44, iconSize = 22 }: { icon: React.ReactNode; size?: number; iconSize?: number }) {
  return (
    <span
      className="rounded-[10px] bg-polyform-blue/10 text-polyform-blue flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      {icon}
    </span>
  );
}

export function FloorPlanTile({ label, variant = 1 }: { label: string; variant?: 1 | 2 }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-[#fbfaf7] p-3 flex flex-col gap-1.5">
      <svg viewBox="0 0 100 80" className="w-full">
        <path d="M8 8 H92 V44 H52 V72 H8 Z" fill="#f5f1e8" stroke="#1f2937" strokeWidth="3" />
        <path
          d={variant === 1 ? 'M50 8 V44 M8 44 H52' : 'M36 8 V44 M64 8 V44 M8 44 H52 M30 44 V72'}
          stroke="#1f2937" strokeWidth="2" fill="none"
        />
      </svg>
      <p className="text-[11px] font-semibold text-gray-600">{label}</p>
    </div>
  );
}

export function ChatCard() {
  return (
    <div className="bg-white text-polyform-gray rounded-2xl p-[22px] flex flex-col gap-3.5 shadow-[0_40px_80px_-24px_rgba(0,0,0,0.5)]">
      <div className="ml-auto max-w-[85%] bg-polyform-blue text-white text-sm leading-[1.55] px-4 py-3 rounded-2xl rounded-br-[4px]">
        Build me an L-shaped house, two storeys, with four bedrooms and a bathroom upstairs.
      </div>
      <div className="max-w-[90%] bg-gray-100 text-sm leading-[1.55] px-4 py-3 rounded-2xl rounded-bl-[4px]">
        Done. Here is the 3D view and the plans for both floors: kitchen, lounge, hallway and WC downstairs; four bedrooms and a bathroom upstairs.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FloorPlanTile label="Level 1" variant={1} />
        <FloorPlanTile label="Level 2" variant={2} />
      </div>
    </div>
  );
}
