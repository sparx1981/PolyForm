import React, { useState } from 'react';
import { ArrowRight, Box } from 'lucide-react';
import { RouterLink, type Page } from './router';

export type { Page };
export { RouterLink, useMarketingRouter, scrollToId, hrefFor, isMarketingPath } from './router';

export function Logo({ go, size = 32, textSize = 'text-[19px]' }: { go?: (p: Page) => void; size?: number; textSize?: string }) {
  const content = (
    <>
      <span
        className="rounded-lg bg-polyform-blue text-white flex items-center justify-center shadow-sm shrink-0"
        style={{ width: size, height: size }}
      >
        <Box size={Math.round(size * 0.56)} />
      </span>
      PolyForm
    </>
  );
  const className = 'flex items-center gap-2.5 font-bold ' + textSize + ' tracking-[-0.015em] text-polyform-dark-blue';
  if (!go) return <span className={className}>{content}</span>;
  return <RouterLink to="home" go={go} className={className} aria-label="PolyForm home">{content}</RouterLink>;
}

const NAV: { page: Page; label: string }[] = [
  { page: 'features', label: 'Product' },
  { page: 'claude', label: 'AI' },
  { page: 'developers', label: 'Developers' },
];

export function Header({ page, go, onLogin }: { page: Page; go: (p: Page, anchor?: string) => void; onLogin: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isActive = (n: Page) => page === n || (n === 'developers' && page === 'sdk-docs');

  return (
    <header className="sticky top-0 z-[100] bg-white/90 backdrop-blur-xl border-b border-slate-200/70" style={{ height: 72 }}>
      <nav className="max-w-[1280px] mx-auto px-6 lg:px-8 h-full flex items-center justify-between gap-6" aria-label="Main">
        <Logo go={go} />

        <div className="hidden md:flex items-center h-full gap-7">
          {NAV.map(n => (
            <RouterLink
              key={n.page}
              to={n.page}
              go={go}
              className={
                'relative h-full flex items-center text-sm font-semibold transition-colors '
                + (isActive(n.page)
                  ? 'text-polyform-dark-blue after:absolute after:left-0 after:right-0 after:bottom-0 after:h-[2px] after:bg-polyform-blue'
                  : 'text-gray-500 hover:text-polyform-dark-blue')
              }
              aria-current={isActive(n.page) ? 'page' : undefined}
            >
              {n.label}
            </RouterLink>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-1.5">
          <button
            type="button"
            onClick={onLogin}
            className="text-sm font-semibold px-3.5 py-2.5 rounded-lg text-gray-600 hover:text-polyform-dark-blue hover:bg-gray-50 transition-colors"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={onLogin}
            className="text-sm font-semibold px-4.5 py-2.5 rounded-lg bg-polyform-blue text-white shadow-[0_5px_16px_rgb(0_99_163_/_0.2)] hover:bg-polyform-dark-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-polyform-blue"
          >
            Start designing
          </button>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen(v => !v)}
          className="md:hidden min-h-11 min-w-11 text-sm font-semibold px-3 rounded-lg text-polyform-gray hover:bg-gray-50"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label="Menu"
        >
          Menu
        </button>
      </nav>

      {mobileOpen && (
        <div id="mobile-nav" className="md:hidden border-t border-gray-100 bg-white px-6 py-4 flex flex-col gap-1 shadow-lg">
          {NAV.map(n => (
            <RouterLink
              key={n.page}
              to={n.page}
              go={(p, a) => { go(p, a); setMobileOpen(false); }}
              className={
                'text-sm font-semibold min-h-11 flex items-center px-3.5 rounded-lg '
                + (isActive(n.page) ? 'text-polyform-blue bg-[rgb(0_99_163_/_0.07)]' : 'text-gray-600 hover:bg-gray-50')
              }
              aria-current={isActive(n.page) ? 'page' : undefined}
            >
              {n.label}
            </RouterLink>
          ))}
          <div className="h-px bg-gray-100 my-2" />
          <button type="button" onClick={() => { onLogin(); setMobileOpen(false); }} className="text-sm font-semibold min-h-11 rounded-lg text-left px-3.5 text-polyform-gray hover:bg-gray-50">
            Sign in
          </button>
          <button type="button" onClick={() => { onLogin(); setMobileOpen(false); }} className="text-sm font-semibold min-h-11 rounded-lg bg-polyform-blue text-white text-center">
            Start designing
          </button>
        </div>
      )}
    </header>
  );
}

export function ClosingCTA({ onLogin }: { onLogin: () => void }) {
  return (
    <section className="relative overflow-hidden bg-polyform-dark-blue text-white py-24 px-6">
      <div
        className="absolute inset-0 opacity-[0.12] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
        aria-hidden="true"
      />
      <div className="relative max-w-[1040px] mx-auto text-center flex flex-col items-center">
        <Eyebrow dark>Start in the browser</Eyebrow>
        <h2 className="mt-5 text-[clamp(34px,4.7vw,58px)] font-bold leading-[1.05] tracking-[-0.035em] max-w-[800px]">
          Design the whole project in one place.
        </h2>
        <p className="mt-5 text-[17px] sm:text-lg leading-[1.65] text-white/75 max-w-[620px]">
          Start with the site, shape the building and landscape, then walk through the result before it is built.
        </p>
        <button
          type="button"
          onClick={onLogin}
          className="mt-8 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-polyform-dark-blue font-semibold text-base px-6 py-[14px] hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-polyform-dark-blue"
        >
          Start designing <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

type FooterCol = { title: string; links: { label: string; page?: Page; anchor?: string; onClick?: () => void }[] };

export function Footer({ go, onLogin }: { go: (p: Page, anchor?: string) => void; onLogin: () => void }) {
  const columns: FooterCol[] = [
    { title: 'PRODUCT', links: [{ label: 'Product overview', page: 'features' }, { label: 'AI — Build with Claude', page: 'claude' }, { label: 'Developers', page: 'developers' }, { label: 'SDK reference', page: 'sdk-docs' }] },
    {
      title: 'CAPABILITIES',
      links: [
        { label: 'Architecture', page: 'features', anchor: 'build' },
        { label: 'Terrain & landscape', page: 'features', anchor: 'shape-the-site' },
        { label: 'Visualisation', page: 'features', anchor: 'visualise' },
        { label: 'Collaboration', page: 'features', anchor: 'work-together' },
        { label: 'Automation', page: 'features', anchor: 'automate' },
        { label: 'Files & storage', page: 'features', anchor: 'files' },
      ],
    },
    { title: 'ACCOUNT', links: [{ label: 'Sign in', onClick: onLogin }] },
  ];

  return (
    <footer className="bg-[#f8fafc] border-t border-slate-200 pt-16 pb-10">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-8 flex flex-col gap-12">
        <div className="grid gap-12 md:grid-cols-[1.3fr_2fr]">
          <div className="flex flex-col gap-4 max-w-[360px]">
            <Logo go={go} size={30} textSize="text-lg" />
            <p className="text-sm text-gray-500 leading-relaxed">
              Browser-based 3D design for buildings, terrain and landscape — from real site context to eye-level walkthrough.
            </p>
          </div>
          <nav className="grid grid-cols-2 sm:grid-cols-3 gap-10" aria-label="Footer">
            {columns.map(col => (
              <div key={col.title} className="flex flex-col gap-3">
                <span className="text-[11px] font-bold tracking-[0.14em] text-gray-400">{col.title}</span>
                {col.links.map(link => (
                  link.page ? (
                    <RouterLink key={link.label} to={link.page} anchor={link.anchor} go={go} className="text-sm text-gray-600 hover:text-polyform-blue transition-colors">
                      {link.label}
                    </RouterLink>
                  ) : (
                    <button key={link.label} type="button" onClick={link.onClick} className="text-sm text-gray-600 hover:text-polyform-blue text-left transition-colors">
                      {link.label}
                    </button>
                  )
                ))}
              </div>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 text-[13px] text-gray-500 border-t border-slate-200 pt-6">
          <span>© {new Date().getFullYear()} PolyForm</span>
          <span>3D design for buildings + landscapes</span>
        </div>
      </div>
    </footer>
  );
}

export function Eyebrow({ children, dark = false, icon }: { children: React.ReactNode; dark?: boolean; icon?: React.ReactNode }) {
  return (
    <span className={'inline-flex items-center gap-2.5 text-[12px] font-bold uppercase tracking-[0.12em] ' + (dark ? 'text-white/85' : 'text-polyform-blue')}>
      <span className={'h-px w-7 ' + (dark ? 'bg-white/45' : 'bg-polyform-blue/45')} aria-hidden="true" />
      {icon}
      {children}
    </span>
  );
}

export function IconTile({ icon, size = 44 }: { icon: React.ReactNode; size?: number }) {
  return (
    <span
      className="rounded-[10px] bg-polyform-blue/10 text-polyform-blue flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      {icon}
    </span>
  );
}

export function MarketingVisual({
  label,
  title,
  dark = false,
  aspectRatio = '16 / 10',
  className = '',
}: {
  label: string;
  title: string;
  dark?: boolean;
  aspectRatio?: string;
  className?: string;
}) {
  const grid = dark ? 'rgba(255,255,255,.09)' : 'rgba(0,56,101,.08)';
  return (
    <div
      className={
        'relative overflow-hidden rounded-[24px] border '
        + (dark ? 'border-white/10 bg-[#062a47]' : 'border-slate-200 bg-[#f4f8fb] ')
        + className
      }
      style={{
        aspectRatio,
        backgroundImage: 'linear-gradient(' + grid + ' 1px, transparent 1px), linear-gradient(90deg, ' + grid + ' 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }}
      role="img"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_25%,rgba(0,99,163,0.16),transparent_35%)]" />
      <svg viewBox="0 0 640 400" className="absolute inset-[9%] w-[82%] h-[82%]" aria-hidden="true">
        <path d="M86 298 L220 225 L365 278 L530 184" fill="none" stroke={dark ? 'rgba(255,255,255,.25)' : 'rgba(0,56,101,.28)'} strokeWidth="2" />
        <path d="M220 225 L220 122 L365 174 L365 278" fill="none" stroke={dark ? 'rgba(255,255,255,.62)' : 'rgba(0,56,101,.62)'} strokeWidth="3" />
        <path d="M220 122 L316 76 L452 129 L365 174 Z" fill={dark ? 'rgba(124,195,240,.08)' : 'rgba(0,99,163,.07)'} stroke={dark ? 'rgba(124,195,240,.7)' : 'rgba(0,99,163,.58)'} strokeWidth="3" />
        <path d="M365 174 L452 129 L452 230 L365 278" fill="none" stroke={dark ? 'rgba(255,255,255,.52)' : 'rgba(0,56,101,.48)'} strokeWidth="3" />
        <path d="M102 300 C160 260 186 300 242 275 S338 322 410 278 S510 245 560 270" fill="none" stroke={dark ? 'rgba(124,195,240,.45)' : 'rgba(0,99,163,.36)'} strokeWidth="2" strokeDasharray="7 7" />
        <circle cx="524" cy="122" r="28" fill="none" stroke={dark ? 'rgba(255,255,255,.26)' : 'rgba(0,56,101,.2)'} strokeWidth="2" />
        <path d="M524 75 V51 M524 193 V169 M477 122 H453 M595 122 H571" stroke={dark ? 'rgba(255,255,255,.18)' : 'rgba(0,56,101,.16)'} strokeWidth="2" />
      </svg>
      <div className="absolute top-5 left-5">
        <span className={'text-[11px] font-bold tracking-[0.14em] uppercase ' + (dark ? 'text-white/55' : 'text-polyform-blue/70')}>{label}</span>
      </div>
      <div className="absolute left-5 right-5 bottom-5 flex items-end justify-between gap-4">
        <span className={'text-sm sm:text-base font-semibold max-w-[75%] ' + (dark ? 'text-white/85' : 'text-polyform-dark-blue/80')}>{title}</span>
        <span className={'w-2 h-2 rounded-full ' + (dark ? 'bg-[#7CC3F0]' : 'bg-polyform-blue')} aria-hidden="true" />
      </div>
    </div>
  );
}

export function FloorPlanTile({ label, variant = 1 }: { label: string; variant?: 1 | 2 }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-[#fbfaf7] p-3 flex flex-col gap-1.5">
      <svg viewBox="0 0 100 80" className="w-full" role="img" aria-label={'Floor plan, ' + label}>
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
    <div className="bg-white text-polyform-gray rounded-[22px] overflow-hidden shadow-[0_40px_90px_-28px_rgba(0,0,0,0.55)] border border-white/15">
      <div className="h-11 px-4 flex items-center gap-2 border-b border-gray-100 text-[12px] font-semibold text-gray-500">
        <span className="w-2 h-2 rounded-full bg-polyform-green" />
        Claude × PolyForm
        <span className="ml-auto text-gray-400">Connected</span>
      </div>
      <div className="p-5 flex flex-col gap-3.5">
        <div className="ml-auto max-w-[85%] bg-polyform-blue text-white text-sm leading-[1.55] px-4 py-3 rounded-2xl rounded-br-[4px]">
          Build me an L-shaped house, two storeys, with four bedrooms and a bathroom upstairs.
        </div>
        <div className="max-w-[90%] bg-gray-100 text-sm leading-[1.55] px-4 py-3 rounded-2xl rounded-bl-[4px]">
          Done. Here is the 3D view and the plans for both floors. You can keep editing the model in PolyForm.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FloorPlanTile label="Level 1" variant={1} />
          <FloorPlanTile label="Level 2" variant={2} />
        </div>
      </div>
    </div>
  );
}
