import React from 'react';
import { ArrowRight, Circle, MousePointerClick, Sparkles } from 'lucide-react';
import { CODE_LONG, DEV_TOOL_GROUPS, SDK_METHODS } from './data';
import { highlightJsLine } from './codeHighlight';
import { Eyebrow, RouterLink, scrollToId, type Page } from './shared';

const DEV_TABS = ['Console', 'Library', 'Documentation', 'Spec'];

const RECORDER_STEPS = [
  { icon: MousePointerClick, title: 'Draw something', text: 'Push/Pull a box, bevel an edge, place a roof — anything in the toolbar.' },
  { icon: Circle, title: 'PolyForm records the action', text: 'Every draw, transform and material change is captured as it happens.' },
  { icon: Sparkles, title: 'JavaScript SDK code appears', text: 'Ready to copy into the console, edit, and run again.' },
];

export default function Developers({ onLogin, go }: { onLogin: () => void; go: (p: Page, anchor?: string) => void }) {
  return (
    <>
      <section className="py-24 px-6 border-b border-gray-100">
        <div className="max-w-[1200px] mx-auto grid gap-14 items-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))' }}>
          <div className="flex flex-col gap-5">
            <Eyebrow>Developer Extensibility Suite</Eyebrow>
            <h1 className="text-[clamp(40px,5.5vw,68px)] font-bold leading-[1.04] tracking-[-0.03em] text-polyform-dark-blue">
              Script anything you can draw
            </h1>
            <p className="text-lg leading-[1.65] text-gray-600">
              Automate scene creation with JavaScript and the <code className="font-mono text-[0.9em]">sdk</code> object.
              Write in the console, run it against the open model, and keep the scripts you like in your library.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onLogin}
                className="flex-none whitespace-nowrap shrink-0 text-base font-semibold px-6 py-[14px] rounded-lg bg-polyform-blue text-white shadow-[0_8px_20px_rgb(0_99_163_/_0.25)] hover:bg-polyform-dark-blue transition-colors"
              >
                Open the console
              </button>
              <RouterLink
                to="sdk-docs"
                go={go}
                className="flex-none whitespace-nowrap shrink-0 text-base font-semibold px-[22px] py-[14px] rounded-lg border border-gray-200 text-polyform-dark-blue hover:bg-gray-50 transition-colors"
              >
                SDK reference
              </RouterLink>
            </div>
          </div>

          <div className="bg-slate-950 rounded-2xl overflow-hidden shadow-[0_40px_80px_-24px_rgba(15,23,42,0.45)]">
            <div className="flex items-center gap-1 px-3.5 py-2.5 border-b border-white/10">
              {DEV_TABS.map((label, i) => (
                <span key={label} className={'text-xs font-semibold px-2.5 py-1.5 rounded-md ' + (i === 0 ? 'bg-white/10 text-white' : 'text-slate-400')}>
                  {label}
                </span>
              ))}
              <button type="button" onClick={onLogin} className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-md bg-polyform-blue text-white hover:bg-polyform-dark-blue transition-colors">
                Run Script
              </button>
            </div>
            <div className="p-5 flex flex-col overflow-x-auto">
              {CODE_LONG.map((c, i) => highlightJsLine(c.t, i))}
            </div>
          </div>
        </div>
      </section>

      {/* Code Recorder: a distinctive developer proposition, given its own section rather than a grid card. */}
      <section className="py-[104px] px-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-12">
          <div className="flex flex-col gap-3.5 max-w-[680px]">
            <Eyebrow>Code Recorder</Eyebrow>
            <h2 className="text-[clamp(30px,3.6vw,46px)] font-bold leading-[1.1] tracking-[-0.02em] text-polyform-dark-blue">
              Don&rsquo;t know the SDK yet? Draw, and learn it from what you drew.
            </h2>
            <p className="text-base leading-[1.65] text-gray-600">
              Code Recorder watches the model while you work and turns your drawing into the exact SDK calls that produced it — the fastest way to learn the API, or to turn a one-off design into a repeatable script.
            </p>
          </div>
          <div className="grid gap-6 items-stretch" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
            {RECORDER_STEPS.map((s, i) => (
              <div key={s.title} className="relative flex flex-col gap-3 pt-6 border-t-[3px] border-polyform-blue">
                <s.icon size={22} className="text-polyform-blue" />
                <span className="text-lg font-bold text-polyform-dark-blue">{s.title}</span>
                <span className="text-[15px] leading-[1.6] text-gray-600">{s.text}</span>
                {i < RECORDER_STEPS.length - 1 && (
                  <ArrowRight size={18} className="hidden lg:block absolute -right-8 top-6 text-gray-300" aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gray-light py-[104px] px-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-10">
          <h2 className="text-[clamp(30px,3.6vw,46px)] font-bold leading-[1.1] tracking-[-0.02em] text-polyform-dark-blue">In the suite</h2>
          <div className="grid gap-10" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}>
            {DEV_TOOL_GROUPS.map(g => (
              <div key={g.kicker} className="flex flex-col gap-4">
                <Eyebrow>{g.kicker}</Eyebrow>
                <h3 className="text-lg font-bold text-polyform-dark-blue -mt-2">{g.title}</h3>
                <div className="flex flex-col divide-y divide-gray-200">
                  {g.items.map(item => (
                    <div key={item.title} className="flex gap-3 py-3.5 items-start">
                      <item.icon size={18} className="text-polyform-blue mt-0.5 shrink-0" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-bold text-polyform-dark-blue">{item.title}</span>
                        <span className="text-[13px] leading-[1.5] text-gray-600">{item.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="sdk" className="py-[104px] px-6 scroll-mt-20">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-3">
              <Eyebrow>SDK reference</Eyebrow>
              <h2 className="text-[clamp(30px,3.6vw,46px)] font-bold leading-[1.1] tracking-[-0.02em] text-polyform-dark-blue">
                The <code className="text-[0.9em]">sdk</code> object
              </h2>
            </div>
            <RouterLink
              to="sdk-docs"
              go={go}
              className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-polyform-blue hover:text-polyform-dark-blue transition-colors"
            >
              View full SDK documentation <ArrowRight size={16} />
            </RouterLink>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {SDK_METHODS.map(m => (
              <div key={m.sig} className="grid gap-1.5 px-6 py-4 border-b border-gray-100 last:border-b-0" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', columnGap: 32 }}>
                <code className="text-[13px] font-semibold text-polyform-dark-blue break-words">{m.sig}</code>
                <span className="text-sm leading-[1.55] text-gray-600">{m.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
