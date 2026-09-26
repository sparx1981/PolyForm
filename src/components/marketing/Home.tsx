import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Check, Cloud, Menu, Redo2, Sparkles, Undo2 } from 'lucide-react';
import {
  SHOWCASE_TABS, WORKS_WITH, WORKFLOW_STEPS, STORAGE_OPTIONS, CODE_SHORT, HERO_RAIL_ICONS, HERO_PANEL_TITLES,
} from './data';
import { ChatCard, Eyebrow, MarketingVisual, RouterLink, scrollToId, type Page } from './shared';
import { highlightJsLine } from './codeHighlight';


function ProductFrame() {
  return (
    <div className="w-full max-w-[1240px] rounded-[24px] overflow-hidden border border-slate-200 bg-white shadow-[0_45px_110px_-42px_rgba(15,23,42,0.5),0_4px_18px_rgba(15,23,42,0.08)] flex flex-col text-left">
      <div className="hidden sm:flex h-11 bg-[#075b92] text-white items-center gap-3.5 px-4 text-sm">
        <Menu size={18} />
        <span className="font-bold">PolyForm</span>
        <span className="w-px h-3.5 bg-white/25" />
        <Undo2 size={15} />
        <Redo2 size={15} />
        <span className="ml-auto text-[11px] text-white/60">Project synced</span>
        <span className="w-6 h-6 rounded-full bg-white/15 border border-white/20" />
      </div>
      <div className="flex" style={{ aspectRatio: '16 / 8.1', minHeight: 270 }}>
        <div className="hidden sm:flex w-12 flex-none border-r border-gray-200 flex-col items-center gap-1 py-2.5 text-gray-600 bg-white">
          {HERO_RAIL_ICONS.map((r, i) => (
            <span
              key={i}
              className={'w-8 h-[30px] rounded-md flex items-center justify-center ' + (r.active ? 'bg-polyform-blue text-white shadow-sm' : '')}
            >
              <r.icon size={16} />
            </span>
          ))}
        </div>
        <div className="flex-1 relative overflow-hidden bg-[#eef4f7]">
          <div
            className="absolute inset-0 opacity-70"
            style={{
              backgroundImage: 'linear-gradient(rgba(0,56,101,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(0,56,101,.07) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
            aria-hidden="true"
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_68%_24%,rgba(0,99,163,.13),transparent_35%)]" aria-hidden="true" />
          <svg viewBox="0 0 920 560" className="absolute inset-[5%] w-[90%] h-[90%]" role="img" aria-label="Architectural site model placeholder">
            <path d="M80 430 C190 355 260 420 350 370 S520 435 630 355 S785 330 850 365" fill="none" stroke="rgba(0,99,163,.34)" strokeWidth="2.5" strokeDasharray="10 9" />
            <path d="M120 456 C245 400 292 470 415 408 S625 454 822 398" fill="none" stroke="rgba(0,56,101,.16)" strokeWidth="2" />
            <path d="M268 355 L268 198 L485 260 L485 414 L268 355 Z" fill="rgba(255,255,255,.78)" stroke="#285b7c" strokeWidth="3" />
            <path d="M268 198 L412 125 L618 194 L485 260 Z" fill="rgba(0,99,163,.09)" stroke="#0063A3" strokeWidth="3" />
            <path d="M485 260 L618 194 L618 338 L485 414 Z" fill="rgba(255,255,255,.48)" stroke="#285b7c" strokeWidth="3" />
            <path d="M320 370 V280 L380 297 V386 M523 395 V293 L572 270 V370" fill="none" stroke="rgba(0,56,101,.58)" strokeWidth="3" />
            <path d="M170 407 L240 375 M650 350 L750 309 M662 386 L786 346" fill="none" stroke="rgba(0,99,163,.35)" strokeWidth="2" />
            <circle cx="177" cy="348" r="38" fill="rgba(0,102,56,.08)" stroke="rgba(0,102,56,.38)" strokeWidth="2" />
            <path d="M177 386 V430" stroke="rgba(0,102,56,.45)" strokeWidth="4" />
            <circle cx="742" cy="277" r="48" fill="rgba(0,102,56,.08)" stroke="rgba(0,102,56,.38)" strokeWidth="2" />
            <path d="M742 325 V374" stroke="rgba(0,102,56,.45)" strokeWidth="4" />
            <path d="M600 420 C654 390 715 400 790 420" fill="none" stroke="rgba(0,99,163,.45)" strokeWidth="3" />
            <circle cx="716" cy="123" r="32" fill="none" stroke="rgba(0,99,163,.28)" strokeWidth="2" />
            <path d="M716 73 V48 M716 198 V173 M666 123 H641 M791 123 H766" stroke="rgba(0,99,163,.2)" strokeWidth="2" />
          </svg>
          <div className="absolute left-5 bottom-5 rounded-lg bg-white/85 backdrop-blur-md border border-white/70 px-3.5 py-2 shadow-sm">
            <span className="block text-[10px] font-bold tracking-[0.12em] uppercase text-polyform-blue">Model view</span>
            <span className="block mt-0.5 text-[12px] font-semibold text-polyform-dark-blue">Building + terrain + landscape</span>
          </div>
        </div>
        <div className="hidden md:flex w-[230px] flex-none border-l border-gray-200 bg-[#f8fafb] flex-col">
          {HERO_PANEL_TITLES.map((title, i) => {
            const openPanel = i === 0 || i === 4;
            return (
              <div key={title} className={'px-3.5 py-3 border-b border-gray-200 flex flex-col gap-1.5 ' + (openPanel ? 'bg-white' : '')}>
                <span className="text-[10px] font-bold tracking-[0.11em] text-gray-500">{title}</span>
                {openPanel && (
                  <>
                    <span className="h-1.5 rounded-sm bg-gray-200" />
                    <span className="h-1.5 w-[72%] rounded-sm bg-gray-200" />
                    <span className="h-1 rounded-sm bg-gradient-to-r from-polyform-blue from-60% to-gray-200 to-60%" />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="hidden sm:flex h-8 border-t border-gray-200 items-center gap-3 px-3.5 text-[11px] text-gray-600 bg-white">
        <span className="flex items-center gap-1.5 text-polyform-green"><Cloud size={12} /> Synced</span>
        <span className="w-px h-3 bg-gray-200" />
        <span>Click a surface to apply the active material.</span>
      </div>
    </div>
  );
}

const PROOF_STRIP = [
  'No install',
  'Building + terrain in one model',
  'Real-world site context',
  'Live collaboration',
];

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
    <section id="workflow" className="bg-[#f7f9fb] py-28 px-6">
      <div className="max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-14 lg:gap-20 items-start">
          <div className="lg:sticky lg:top-[112px] flex flex-col gap-5">
            <Eyebrow>One continuous workflow</Eyebrow>
            <h2 className="text-[clamp(34px,4.4vw,58px)] font-bold leading-[1.04] tracking-[-0.035em] text-polyform-dark-blue">
              From real site to walk-through.
            </h2>
            <p className="text-[17px] leading-[1.7] text-gray-600 max-w-[520px]">
              Keep the building, ground and landscape together from the start. PolyForm removes the hand-offs between site context, modelling and presentation.
            </p>
            <div className="pt-3">
              <MarketingVisual
                label={'Workflow ' + step.n}
                title={step.title + ' — replace with PolyForm product imagery'}
                aspectRatio="4 / 3"
                className="shadow-[0_20px_50px_-30px_rgba(15,23,42,.35)]"
              />
            </div>
          </div>

          <div className="flex flex-col">
            {WORKFLOW_STEPS.map((s, i) => (
              <div
                key={s.n}
                ref={el => { stepRefs.current[i] = el; }}
                className={
                  'group py-10 sm:py-12 border-t last:border-b transition-colors '
                  + (active === i ? 'border-polyform-blue' : 'border-slate-200')
                }
              >
                <div className="grid grid-cols-[56px_1fr] gap-5 sm:gap-7">
                  <span className={'font-mono text-sm pt-1 ' + (active === i ? 'text-polyform-blue' : 'text-gray-400')}>{s.n}</span>
                  <div className="flex flex-col gap-3">
                    <h3 className="text-[clamp(22px,2.6vw,32px)] font-bold tracking-[-0.02em] text-polyform-dark-blue">{s.title}</h3>
                    <p className="text-[16px] leading-[1.7] text-gray-600 max-w-[600px]">{s.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}


function WhyPolyForm() {
  const traditional = ['Site context', 'Building model', 'Landscape work', 'Exports', 'Visualisation', 'Review', 'Rework'];
  const polyform = ['Site', 'Building', 'Landscape', 'Visualise', 'Collaborate', 'Automate'];

  return (
    <section className="py-24 sm:py-28 px-6 bg-white border-b border-slate-200">
      <div className="max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-[0.78fr_1.22fr] gap-12 lg:gap-20 items-end">
          <div className="flex flex-col gap-5">
            <Eyebrow>Why PolyForm</Eyebrow>
            <h2 className="text-[clamp(34px,4.4vw,58px)] font-bold leading-[1.04] tracking-[-0.035em] text-polyform-dark-blue">
              One model instead of a chain of hand-offs.
            </h2>
          </div>
          <p className="text-[17px] leading-[1.7] text-gray-600 max-w-[610px]">
            Keep site context, architecture, landscape, visualisation and review connected instead of moving the project through separate disconnected stages.
          </p>
        </div>

        <div className="mt-14 grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 bg-[#fbfcfd] p-6 sm:p-7">
            <span className="text-[11px] font-bold uppercase tracking-[0.13em] text-gray-400">Traditional workflow</span>
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              {traditional.map((item, i) => (
                <React.Fragment key={item}>
                  <span className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-gray-600">{item}</span>
                  {i < traditional.length - 1 && <ArrowRight size={14} className="text-gray-300" />}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-polyform-blue/20 bg-[#eef6fb] p-6 sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] font-bold uppercase tracking-[0.13em] text-polyform-blue">PolyForm workflow</span>
              <span className="text-[11px] font-bold text-polyform-dark-blue">One model throughout</span>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              {polyform.map((item, i) => (
                <React.Fragment key={item}>
                  <span className="px-3 py-2 rounded-lg bg-white text-[13px] font-bold text-polyform-dark-blue shadow-sm">{item}</span>
                  {i < polyform.length - 1 && <ArrowRight size={14} className="text-polyform-blue/45" />}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AudienceSection() {
  const audiences = [
    { title: 'Architects & designers', text: 'Develop the building with its real site and surroundings visible from the start.' },
    { title: 'Landscape teams', text: 'Shape terrain, planting, paths, water and external spaces in the same model as the architecture.' },
    { title: 'Builders & collaborators', text: 'Review the complete design, leave notes and walk through decisions before work starts.' },
    { title: 'Design technologists', text: 'Automate repeated work with Claude, JavaScript and the PolyForm SDK.' },
  ];

  return (
    <section className="py-24 sm:py-28 px-6 bg-white border-b border-slate-200">
      <div className="max-w-[1240px] mx-auto">
        <div className="max-w-[760px]">
          <Eyebrow>Built around the project</Eyebrow>
          <h2 className="mt-5 text-[clamp(34px,4.4vw,56px)] font-bold leading-[1.05] tracking-[-0.035em] text-polyform-dark-blue">
            For the people shaping the built environment.
          </h2>
        </div>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 border-y border-slate-200">
          {audiences.map((a, i) => (
            <div key={a.title} className={'py-7 sm:px-6 first:pl-0 last:pr-0 ' + (i > 0 ? 'sm:border-l sm:border-slate-200' : '')}>
              <span className="text-[11px] font-mono text-gray-400">0{i + 1}</span>
              <h3 className="mt-3 text-[17px] font-bold text-polyform-dark-blue">{a.title}</h3>
              <p className="mt-2 text-sm leading-[1.65] text-gray-600">{a.text}</p>
            </div>
          ))}
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
      <section className="relative overflow-hidden px-6 pt-16 sm:pt-20 pb-0 bg-white">
        <div className="absolute inset-x-0 top-0 h-[620px] bg-[radial-gradient(circle_at_50%_0%,rgba(0,99,163,0.08),transparent_62%)] pointer-events-none" />
        <div className="relative max-w-[980px] mx-auto text-center flex flex-col items-center">
          <Eyebrow>3D design for buildings + landscapes</Eyebrow>
          <h1 className="mt-6 text-[clamp(44px,7vw,82px)] font-bold leading-[0.98] tracking-[-0.055em] text-polyform-dark-blue">
            Design the whole site.<br />
            <span className="text-polyform-blue">Then step inside.</span>
          </h1>
          <p className="mt-7 text-[clamp(17px,1.7vw,21px)] leading-[1.65] text-gray-600 max-w-[760px]">
            PolyForm brings the building, terrain and landscape into one browser-based model — so you can design in context, collaborate live and experience the result before it is built.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <button
              type="button"
              onClick={onLogin}
              className="inline-flex items-center gap-2 text-base font-semibold px-6 py-[14px] rounded-lg bg-polyform-blue text-white shadow-[0_10px_25px_rgb(0_99_163_/_0.22)] hover:bg-polyform-dark-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-polyform-blue"
            >
              Start designing <ArrowRight size={16} />
            </button>
            <button
              type="button"
              onClick={() => scrollToId('workflow')}
              className="inline-flex items-center gap-2 text-base font-semibold px-[22px] py-[14px] rounded-lg bg-white text-polyform-dark-blue border border-slate-200 hover:bg-gray-50 transition-colors"
            >
              See how PolyForm works
            </button>
          </div>
          <p className="mt-4 text-[13px] text-gray-500">Free to try · No installation · Desktop, tablet and phone</p>
        </div>

        <div className="relative max-w-[1240px] mx-auto mt-12 translate-y-8">
          <ProductFrame />
        </div>
      </section>

      <section className="bg-[#f7f9fb] pt-20 pb-12 px-6 border-b border-slate-200/70">
        <div className="max-w-[1240px] mx-auto">
          <div className="flex flex-wrap justify-center items-center gap-x-8 gap-y-4">
            {PROOF_STRIP.map((label, i) => (
              <React.Fragment key={label}>
                {i > 0 && <span className="hidden md:block w-px h-4 bg-slate-300" aria-hidden="true" />}
                <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">{label}</span>
              </React.Fragment>
            ))}
          </div>
          <div className="mt-7 flex flex-wrap justify-center gap-x-8 gap-y-3">
            {WORKS_WITH.map(w => (
              w.href ? (
                <a key={w.label} href={w.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-polyform-blue transition-colors">
                  <w.icon size={16} /> {w.label}
                </a>
              ) : (
                <span key={w.label} className="flex items-center gap-2 text-sm font-semibold text-gray-500">
                  <w.icon size={16} /> {w.label}
                </span>
              )
            ))}
          </div>
        </div>
      </section>

      <WhyPolyForm />

      <section className="py-28 px-6 bg-white">
        <div className="max-w-[1240px] mx-auto">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-20 items-end">
            <div className="flex flex-col gap-5">
              <Eyebrow>One model</Eyebrow>
              <h2 className="text-[clamp(34px,4.4vw,58px)] font-bold leading-[1.04] tracking-[-0.035em] text-polyform-dark-blue">
                The building does not stop at the back door.
              </h2>
            </div>
            <p className="text-[18px] leading-[1.75] text-gray-600 max-w-[600px] lg:justify-self-end">
              Model the architecture and everything around it together. The patio meets the floor, the terrain meets the foundations and the landscape stays part of the same design.
            </p>
          </div>

          <div className="mt-14 grid lg:grid-cols-[320px_1fr] gap-8 lg:gap-12 items-start">
            <div role="tablist" className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
              {SHOWCASE_TABS.map((t, i) => (
                <button
                  key={t.label}
                  role="tab"
                  aria-selected={i === tab}
                  type="button"
                  onClick={() => setTab(i)}
                  className={
                    'flex-none lg:w-full flex items-center gap-3 text-sm font-semibold px-4 py-3.5 rounded-xl transition-all text-left '
                    + (i === tab
                      ? 'bg-[#eef6fb] text-polyform-dark-blue shadow-[inset_3px_0_0_#0063A3]'
                      : 'text-gray-500 hover:text-polyform-dark-blue hover:bg-gray-50')
                  }
                >
                  <t.icon size={17} className={i === tab ? 'text-polyform-blue' : 'text-gray-400'} /> {t.label}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
                className="grid md:grid-cols-[0.86fr_1.14fr] gap-8 lg:gap-12 items-center"
              >
                <div className="flex flex-col gap-5">
                  <h3 className="text-[clamp(28px,3.2vw,42px)] font-bold leading-[1.08] tracking-[-0.025em] text-polyform-dark-blue">{active.title}</h3>
                  <p className="text-[17px] leading-[1.7] text-gray-600">{active.body}</p>
                  <div className="flex flex-col">
                    {active.points.map(p => (
                      <div key={p} className="flex items-start gap-3 py-3 border-t border-slate-200 text-[15px] leading-[1.55] text-gray-700">
                        <Check size={16} className="text-polyform-blue shrink-0 mt-0.5" /> {p}
                      </div>
                    ))}
                  </div>
                </div>
                <MarketingVisual label={active.label} title={active.title} aspectRatio="4 / 3" />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </section>

      <WorkflowStory />

      <AudienceSection />

      <section className="relative overflow-hidden bg-polyform-dark-blue text-white py-28 px-6">
        <div className="absolute inset-0 opacity-[0.1] pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="relative max-w-[1240px] mx-auto grid lg:grid-cols-[0.85fr_1.15fr] gap-14 lg:gap-20 items-center">
          <div className="flex flex-col gap-5">
            <Eyebrow dark icon={<Sparkles size={16} />}>Build with Claude</Eyebrow>
            <h2 className="text-[clamp(34px,4.5vw,58px)] font-bold leading-[1.04] tracking-[-0.035em]">
              Describe the design.<br />Get an editable model.
            </h2>
            <p className="text-[17px] leading-[1.7] text-white/75">
              Connect PolyForm to Claude and ask for a building, a site change or a landscape edit in plain words. The result stays editable in PolyForm.
            </p>
            <RouterLink
              to="claude"
              go={go}
              className="self-start mt-2 inline-flex items-center gap-2 text-[15px] font-semibold text-white hover:text-[#9ed5f7] transition-colors"
            >
              Explore Build with Claude <ArrowRight size={16} />
            </RouterLink>
          </div>
          <ChatCard />
        </div>
      </section>

      <section className="py-28 px-6 bg-white">
        <div className="max-w-[1240px] mx-auto grid lg:grid-cols-2 gap-14 lg:gap-20">
          <div className="flex flex-col gap-5">
            <Eyebrow>Developers</Eyebrow>
            <h2 className="text-[clamp(30px,3.7vw,46px)] font-bold leading-[1.08] tracking-[-0.025em] text-polyform-dark-blue">Script anything you can draw.</h2>
            <p className="text-[16px] leading-[1.7] text-gray-600">
              Automate model creation with JavaScript, learn the SDK from your own drawing actions and build custom tools around your workflow.
            </p>
            <div className="bg-slate-950 rounded-2xl p-5 flex flex-col overflow-x-auto shadow-[0_24px_60px_-34px_rgba(15,23,42,.8)]">
              {CODE_SHORT.map((c, i) => highlightJsLine(c.t, i))}
            </div>
            <RouterLink to="developers" go={go} className="self-start inline-flex items-center gap-1.5 text-[15px] font-semibold text-polyform-blue hover:text-polyform-dark-blue transition-colors">
              Explore the developer platform <ArrowRight size={16} />
            </RouterLink>
          </div>

          <div className="flex flex-col gap-5">
            <Eyebrow>Interoperability</Eyebrow>
            <h2 className="text-[clamp(30px,3.7vw,46px)] font-bold leading-[1.08] tracking-[-0.025em] text-polyform-dark-blue">Keep projects where your team already works.</h2>
            <p className="text-[16px] leading-[1.7] text-gray-600">Choose where each model lives and keep every project visible from one place.</p>
            <div className="rounded-2xl border border-slate-200 bg-[#f8fafc] p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-center gap-2.5 text-[12px] font-semibold">
                <span className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-gray-600">Google Drive</span>
                <ArrowRight size={14} className="text-gray-300" />
                <span className="px-4 py-2.5 rounded-lg bg-polyform-blue text-white shadow-sm">PolyForm</span>
                <ArrowRight size={14} className="text-gray-300" />
                <span className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-gray-600">Trimble Connect</span>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px] text-gray-500">
                <span>Import SKP + supported 3D</span>
                <span>Export glTF</span>
                <span>Export STL</span>
                <span>Export SKP</span>
              </div>
            </div>
            <div className="flex flex-col">
              {STORAGE_OPTIONS.map(s => (
                <div key={s.title} className="grid grid-cols-[44px_1fr] gap-4 items-start py-4 border-t border-slate-200 last:border-b">
                  <span className="w-10 h-10 rounded-xl bg-[#eef6fb] text-polyform-blue flex items-center justify-center">
                    <s.icon size={18} />
                  </span>
                  <div className="flex flex-col gap-1 pt-0.5">
                    {s.href ? (
                      <a href={s.href} target="_blank" rel="noopener noreferrer" className="text-[15px] font-bold text-polyform-dark-blue hover:text-polyform-blue transition-colors">
                        {s.title}
                      </a>
                    ) : (
                      <span className="text-[15px] font-bold text-polyform-dark-blue">{s.title}</span>
                    )}
                    <span className="text-sm leading-[1.6] text-gray-600">{s.text}</span>
                  </div>
                </div>
              ))}
            </div>
            <span className="text-sm text-gray-500">Import SKP and other 3D files. Export glTF, STL and SKP.</span>
          </div>
        </div>
      </section>
    </>
  );
}
