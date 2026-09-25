import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Check, Cloud, Menu, Redo2, Sparkles, Undo2 } from 'lucide-react';
import {
  SHOWCASE_TABS, WORKS_WITH, WORKFLOW_STEPS, STORAGE_OPTIONS, CODE_SHORT, HERO_RAIL_ICONS, HERO_PANEL_TITLES,
} from './data';
import { ChatCard, Eyebrow, IconTile, RouterLink, scrollToId, type Page } from './shared';
import { highlightJsLine } from './codeHighlight';

const LandingHero3D = lazy(() => import('../LandingHero3D'));

function ProductFrame() {
  return (
    <div className="w-full max-w-[1200px] rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-[0_40px_80px_-24px_rgba(15,23,42,0.28),0_2px_6px_rgba(0,0,0,0.06)] flex flex-col text-left">
      <div className="hidden sm:flex h-10 bg-polyform-blue text-white items-center gap-3.5 px-3.5 text-sm">
        <Menu size={18} />
        <span className="font-bold">PolyForm</span>
        <span className="w-px h-3.5 bg-white/25" />
        <Undo2 size={15} />
        <Redo2 size={15} />
        <span className="ml-auto w-6 h-6 rounded-full bg-white/20" />
      </div>
      <div className="flex" style={{ aspectRatio: '16 / 8.4', minHeight: 260 }}>
        <div className="hidden sm:flex w-11 flex-none border-r border-gray-200 flex-col items-center gap-1 py-2 text-gray-600">
          {HERO_RAIL_ICONS.map((r, i) => (
            <span
              key={i}
              className={'w-8 h-[30px] rounded flex items-center justify-center ' + (r.active ? 'bg-polyform-blue text-white' : '')}
            >
              <r.icon size={16} />
            </span>
          ))}
        </div>
        <div className="flex-1 relative bg-gradient-to-b from-sky-100 to-emerald-50">
          <Suspense fallback={null}>
            <LandingHero3D />
          </Suspense>
        </div>
        <div className="hidden sm:flex w-[220px] flex-none border-l border-gray-200 bg-gray-light flex-col">
          {HERO_PANEL_TITLES.map((title, i) => {
            const openPanel = i === 0 || i === 4;
            return (
              <div key={title} className={'px-3 py-2.5 border-b border-gray-200 flex flex-col gap-1.5 ' + (openPanel ? 'bg-white' : '')}>
                <span className="text-[10px] font-bold tracking-[0.1em] text-gray-500">{title}</span>
                {openPanel && (
                  <>
                    <span className="h-1.5 rounded-sm bg-gray-200" />
                    <span className="h-1.5 w-[70%] rounded-sm bg-gray-200" />
                    <span className="h-1 rounded-sm bg-gradient-to-r from-polyform-blue from-60% to-gray-200 to-60%" />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="hidden sm:flex h-7 border-t border-gray-200 items-center gap-2.5 px-3 text-[11px] text-gray-600">
        <span className="flex items-center gap-1 text-polyform-green"><Cloud size={12} /> Synced</span>
        <span>Click a surface to apply the active material.</span>
      </div>
    </div>
  );
}

const PROOF_STRIP = [
  'Browser based',
  'Building + terrain, one model',
  'Real-world site context',
  'Live collaboration',
];

/** The site-to-walkthrough story: a sticky visual on desktop that swaps as each step scrolls into view. */
function WorkflowStory() {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const index = stepRefs.current.indexOf(visible.target as HTMLDivElement);
          if (index !== -1) setActive(index);
        }
      },
      { rootMargin: '-35% 0px -35% 0px', threshold: [0, 0.5, 1] },
    );
    stepRefs.current.forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const step = WORKFLOW_STEPS[active];

  return (
    <section id="workflow" className="bg-gray-light py-[104px] px-6">
      <div className="max-w-[1200px] mx-auto flex flex-col gap-14">
        <div className="flex flex-col gap-3.5 max-w-[700px]">
          <Eyebrow>From plot to walk-through</Eyebrow>
          <h2 className="text-[clamp(32px,4vw,52px)] font-bold leading-[1.08] tracking-[-0.02em] text-polyform-dark-blue">
            Start with the site. Finish at the front door.
          </h2>
        </div>

        <div className="grid gap-12 lg:gap-16 items-start" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div className="grid lg:grid-cols-[1fr_1.1fr] gap-12 lg:gap-16">
            <div className="flex flex-col gap-1 order-2 lg:order-1">
              {WORKFLOW_STEPS.map((s, i) => (
                <div
                  key={s.n}
                  ref={el => { stepRefs.current[i] = el; }}
                  className={
                    'flex flex-col gap-3 py-8 border-t transition-opacity lg:min-h-[220px] lg:justify-center '
                    + (i === WORKFLOW_STEPS.length - 1 ? 'border-b ' : '')
                    + (active === i ? 'border-polyform-blue opacity-100' : 'border-gray-200 lg:opacity-50')
                  }
                >
                  <div className="flex items-center gap-3">
                    <IconTile icon={<s.icon size={20} />} size={40} />
                    <span className="font-mono font-semibold text-[13px] text-gray-400">{s.n}</span>
                  </div>
                  <span className="text-xl font-bold text-polyform-dark-blue">{s.title}</span>
                  <span className="text-[15px] leading-[1.6] text-gray-600 max-w-md">{s.body}</span>
                </div>
              ))}
            </div>

            <div className="order-1 lg:order-2 lg:sticky lg:top-[96px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="rounded-2xl overflow-hidden border border-gray-200 bg-gradient-to-b from-sky-100 to-emerald-50 shadow-[0_20px_40px_-16px_rgba(15,23,42,0.2)] flex items-end p-6"
                  style={{ aspectRatio: '4 / 3' }}
                  aria-label={`Illustration: ${step.title}`}
                >
                  <span className="text-sm font-semibold text-polyform-dark-blue/70 bg-white/70 backdrop-blur-sm px-3 py-1.5 rounded-lg">
                    {step.n} &middot; {step.title}
                  </span>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home({ go, onLogin }: { go: (p: Page, anchor?: string) => void; onLogin: () => void }) {
  const [tab, setTab] = useState(0);
  const active = SHOWCASE_TABS[tab];

  return (
    <>
      {/* Hero */}
      <section
        className="pt-10 flex flex-col items-center text-center px-6"
        style={{ background: 'linear-gradient(180deg, #fff 0%, #fff 62%, var(--color-gray-light) 62%)' }}
      >
        <span className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-polyform-blue bg-polyform-blue/10 px-3.5 py-1.5 rounded-full">
          Browser-based 3D design for buildings + landscapes
        </span>
        <h1 className="mt-5 text-[clamp(32px,4.4vw,54px)] font-bold leading-[1.1] tracking-[-0.03em] text-polyform-dark-blue max-w-[960px]">
          Design the building. Shape the site.<br />Experience it before it&rsquo;s built.
        </h1>
        <p className="mt-4 text-[clamp(16px,1.4vw,19px)] leading-[1.5] text-gray-600 max-w-[640px]">
          PolyForm brings buildings, terrain and landscape into one browser-based model. Design in context, collaborate live and move from first idea to walkthrough without leaving the browser.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 justify-center">
          <button
            type="button"
            onClick={onLogin}
            className="inline-flex items-center gap-2 text-base font-semibold px-[26px] py-[14px] rounded-lg bg-polyform-blue text-white shadow-[0_8px_20px_rgb(0_99_163_/_0.25)] hover:bg-polyform-dark-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-polyform-blue"
          >
            Start designing
          </button>
          <button
            type="button"
            onClick={() => scrollToId('workflow')}
            className="inline-flex items-center gap-2 text-base font-semibold px-[22px] py-[14px] rounded-lg bg-white text-polyform-dark-blue border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            See PolyForm in action <ArrowRight size={16} />
          </button>
        </div>
        <p className="mt-3 text-[13px] text-gray-500">No installation &middot; Free to try &middot; Works in your browser</p>
        <div className="mt-6 w-full flex justify-center">
          <ProductFrame />
        </div>
      </section>

      {/* Proof strip */}
      <section className="bg-gray-light pt-8 pb-10 px-6 border-b border-gray-200/70">
        <div className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
          {PROOF_STRIP.map(label => (
            <span key={label} className="text-[13px] font-semibold uppercase tracking-[0.06em] text-gray-500">{label}</span>
          ))}
          {WORKS_WITH.filter(w => w.href).map(w => (
            <a
              key={w.label}
              href={w.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] font-semibold uppercase tracking-[0.06em] text-gray-500 hover:text-polyform-blue transition-colors"
            >
              {w.label}
            </a>
          ))}
        </div>
      </section>

      {/* Feature showcase with tabs */}
      <section className="py-24 px-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-12">
          <div className="flex flex-wrap justify-between items-end gap-6">
            <div className="flex flex-col gap-3.5 max-w-[640px]">
              <Eyebrow>One model</Eyebrow>
              <h2 className="text-[clamp(32px,4vw,52px)] font-bold leading-[1.08] tracking-[-0.02em] text-polyform-dark-blue">
                Everything from foundations to flower beds
              </h2>
            </div>
            <p className="text-[17px] leading-[1.6] text-gray-600 max-w-[420px]">
              One model for the building and its site, so the patio meets the back door and the ground meets the floor.
            </p>
          </div>

          <div role="tablist" className="flex flex-wrap gap-1.5 p-1.5 bg-gray-light rounded-xl self-start">
            {SHOWCASE_TABS.map((t, i) => (
              <button
                key={t.label}
                role="tab"
                aria-selected={i === tab}
                type="button"
                onClick={() => setTab(i)}
                onKeyDown={e => {
                  if (e.key === 'ArrowRight') setTab((i + 1) % SHOWCASE_TABS.length);
                  if (e.key === 'ArrowLeft') setTab((i - 1 + SHOWCASE_TABS.length) % SHOWCASE_TABS.length);
                }}
                className={
                  'flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors '
                  + (i === tab ? 'bg-white text-polyform-blue shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'text-gray-600')
                }
              >
                <t.icon size={16} /> {t.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="grid gap-12 items-center"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))' }}
            >
              <div className="flex flex-col gap-5">
                <h3 className="text-[clamp(26px,2.6vw,34px)] font-bold leading-[1.15] tracking-[-0.01em] text-polyform-dark-blue">{active.title}</h3>
                <p className="text-[17px] leading-[1.65] text-gray-600">{active.body}</p>
                <div className="flex flex-col border-t border-gray-200">
                  {active.points.map(p => (
                    <div key={p} className="flex items-center gap-3 py-3.5 border-b border-gray-200 text-[15px] text-gray-700">
                      <Check size={16} className="text-polyform-blue shrink-0" /> {p}
                    </div>
                  ))}
                </div>
              </div>
              <div
                className="rounded-2xl overflow-hidden border border-gray-200 bg-gradient-to-b from-sky-100 to-emerald-50 shadow-[0_20px_40px_-16px_rgba(15,23,42,0.2)]"
                style={{ aspectRatio: '4 / 3' }}
                aria-label={active.shot}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      <WorkflowStory />

      {/* Build with Claude band */}
      <section className="bg-polyform-dark-blue text-white py-28 px-6">
        <div className="max-w-[1200px] mx-auto grid gap-16 items-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
          <div className="flex flex-col gap-5">
            <Eyebrow dark icon={<Sparkles size={16} />}>Build with Claude</Eyebrow>
            <h2 className="text-[clamp(32px,4vw,52px)] font-bold leading-[1.08] tracking-[-0.02em]">Describe the design. Get an editable model.</h2>
            <p className="text-[17px] leading-[1.65] text-white/85">
              Connect PolyForm to Claude and ask for a design in plain words. Claude builds it in your account, then shows you a 3D view and a floor plan of every level, so you can check the result before you open PolyForm.
            </p>
            <div className="flex flex-col gap-2.5">
              <span className="flex gap-2.5 text-[15px]"><span className="text-[#7CC3F0]">&bull;</span> Rooms, roofs, stairs, doors and windows</span>
              <span className="flex gap-2.5 text-[15px]"><span className="text-[#7CC3F0]">&bull;</span> Terrain, planting, fences, patios and ponds</span>
              <span className="flex gap-2.5 text-[15px]"><span className="text-[#7CC3F0]">&bull;</span> Every change can be undone</span>
            </div>
            <RouterLink
              to="claude"
              go={go}
              className="self-start inline-flex items-center gap-2 text-[15px] font-semibold px-[22px] py-3 rounded-lg bg-white text-polyform-dark-blue hover:bg-gray-100 transition-colors"
            >
              How the connector works <ArrowRight size={16} />
            </RouterLink>
          </div>
          <ChatCard />
        </div>
      </section>

      {/* Developers and Storage pair */}
      <section className="py-24 px-6">
        <div className="max-w-[1200px] mx-auto grid gap-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
          <div className="flex flex-col gap-4.5">
            <Eyebrow>Developers</Eyebrow>
            <h3 className="text-[30px] font-bold leading-[1.15] text-polyform-dark-blue">Script anything you can draw</h3>
            <p className="text-base leading-[1.6] text-gray-600">
              Write JavaScript against the PolyForm SDK in the Developer Extensibility Suite, then save it to your script library.
            </p>
            <div className="bg-slate-950 rounded-[10px] p-[18px] flex flex-col overflow-x-auto">
              {CODE_SHORT.map((c, i) => highlightJsLine(c.t, i))}
            </div>
            <RouterLink to="developers" go={go} className="self-start inline-flex items-center gap-1.5 text-[15px] font-semibold text-polyform-blue hover:text-polyform-dark-blue transition-colors">
              Explore the SDK <ArrowRight size={16} />
            </RouterLink>
          </div>

          <div className="flex flex-col gap-4.5">
            <Eyebrow>Interoperability</Eyebrow>
            <h3 className="text-[30px] font-bold leading-[1.15] text-polyform-dark-blue">Keep designs where you work</h3>
            <p className="text-base leading-[1.6] text-gray-600">Choose where each model lives. Every model appears in one list, wherever it is stored.</p>
            <div className="flex flex-col divide-y divide-gray-100 border-t border-b border-gray-100">
              {STORAGE_OPTIONS.map(s => (
                <div key={s.title} className="flex gap-3.5 items-start py-3.5">
                  <s.icon size={18} className="text-polyform-blue mt-0.5 shrink-0" />
                  <div className="flex flex-col gap-0.5">
                    {s.href ? (
                      <a href={s.href} target="_blank" rel="noopener noreferrer" className="text-[15px] font-semibold text-polyform-dark-blue hover:text-polyform-blue transition-colors hover:underline">
                        {s.title}
                      </a>
                    ) : (
                      <span className="text-[15px] font-semibold text-polyform-dark-blue">{s.title}</span>
                    )}
                    <span className="text-sm text-gray-600">{s.text}</span>
                  </div>
                </div>
              ))}
            </div>
            <span className="text-sm text-gray-600">Import SKP and other 3D files. Export glTF, STL and SKP.</span>
          </div>
        </div>
      </section>
    </>
  );
}
