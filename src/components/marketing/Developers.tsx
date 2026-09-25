import React from 'react';
import { ArrowRight } from 'lucide-react';
import { CODE_LONG, DEV_TOOLS, SDK_METHODS } from './data';
import { Eyebrow, scrollToId, type Page } from './shared';

const DEV_TABS = ['Console', 'Library', 'Documentation', 'Spec'];

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
              <button
                type="button"
                onClick={() => scrollToId('sdk')}
                className="flex-none whitespace-nowrap shrink-0 text-base font-semibold px-[22px] py-[14px] rounded-lg border border-gray-200 text-polyform-dark-blue hover:bg-gray-50 transition-colors"
              >
                SDK reference
              </button>
            </div>
          </div>

          <div className="bg-slate-950 rounded-2xl overflow-hidden shadow-[0_40px_80px_-24px_rgba(15,23,42,0.45)]">
            <div className="flex items-center gap-1 px-3.5 py-2.5 border-b border-white/10">
              {DEV_TABS.map((label, i) => (
                <span key={label} className={'text-xs font-semibold px-2.5 py-1.5 rounded-md ' + (i === 0 ? 'bg-white/10 text-white' : 'text-slate-400')}>
                  {label}
                </span>
              ))}
              <span className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-md bg-polyform-blue text-white">Run Script</span>
            </div>
            <div className="p-5 flex flex-col overflow-auto">
              {CODE_LONG.map((c, i) => (
                <span key={i} className={'font-mono text-[13px] leading-[1.75] whitespace-pre ' + (c.comment ? 'text-[#7C8AA0]' : 'text-[#E2E8F0]')}>
                  {c.t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-[104px] px-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-10">
          <h2 className="text-[clamp(30px,3.6vw,46px)] font-bold leading-[1.1] tracking-[-0.02em] text-polyform-dark-blue">In the suite</h2>
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
            {DEV_TOOLS.map(d => (
              <div key={d.title} className="border border-gray-200 rounded-xl p-[26px] flex flex-col gap-3 shadow-modus-1">
                <span className="w-10 h-10 rounded-lg bg-polyform-blue/10 text-polyform-blue flex items-center justify-center">
                  <d.icon size={20} />
                </span>
                <span className="text-lg font-bold text-polyform-dark-blue">{d.title}</span>
                <span className="text-[15px] leading-[1.6] text-gray-600">{d.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="sdk" className="bg-gray-light py-[104px] px-6 scroll-mt-[84px]">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-3">
              <Eyebrow>SDK reference</Eyebrow>
              <h2 className="text-[clamp(30px,3.6vw,46px)] font-bold leading-[1.1] tracking-[-0.02em] text-polyform-dark-blue">
                The <code className="text-[0.9em]">sdk</code> object
              </h2>
            </div>
            <button
              type="button"
              onClick={() => go('sdk-docs')}
              className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-polyform-blue hover:text-polyform-dark-blue transition-colors"
            >
              View full SDK documentation <ArrowRight size={16} />
            </button>
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
