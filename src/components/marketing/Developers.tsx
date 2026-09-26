import React from 'react';
import { ArrowRight, Circle, MousePointerClick, Sparkles } from 'lucide-react';
import { CODE_LONG, DEV_TOOL_GROUPS, SDK_METHODS } from './data';
import { highlightJsLine } from './codeHighlight';
import { Eyebrow, MarketingVisual, RouterLink, type Page } from './shared';

const DEV_TABS = ['Console', 'Library', 'Documentation', 'Spec'];

const RECORDER_STEPS = [
  { icon: MousePointerClick, title: 'Draw it', text: 'Use PolyForm normally — create geometry, transform it, apply materials or assemble architectural elements.' },
  { icon: Circle, title: 'Record it', text: 'Code Recorder captures the modelling actions as they happen, without changing how you work.' },
  { icon: Sparkles, title: 'Reuse it', text: 'The equivalent JavaScript SDK calls are ready to edit, save and run against another model.' },
];

export default function Developers({ onLogin, go }: { onLogin: () => void; go: (p: Page, anchor?: string) => void }) {
  return (
    <>
      <section className="relative overflow-hidden bg-[#071a2b] text-white py-24 sm:py-28 px-6">
        <div
          className="absolute inset-0 opacity-[0.12] pointer-events-none"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,.24) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.24) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative max-w-[1240px] mx-auto grid lg:grid-cols-[0.78fr_1.22fr] gap-14 lg:gap-20 items-center">
          <div className="flex flex-col gap-6">
            <Eyebrow dark>Developer extensibility suite</Eyebrow>
            <h1 className="text-[clamp(44px,6vw,74px)] font-bold leading-[1.01] tracking-[-0.045em]">
              Script anything<br />
              <span className="text-[#9ed5f7]">you can draw.</span>
            </h1>
            <p className="text-[18px] leading-[1.7] text-white/75 max-w-[560px]">
              Automate PolyForm with JavaScript, run scripts directly against the open model and turn repeated modelling work into tools your team can reuse.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onLogin}
                className="inline-flex items-center gap-2 text-base font-semibold px-6 py-[14px] rounded-lg bg-white text-[#071a2b] hover:bg-gray-100 transition-colors"
              >
                Open the console <ArrowRight size={16} />
              </button>
              <RouterLink
                to="sdk-docs"
                go={go}
                className="inline-flex items-center gap-2 text-base font-semibold px-[22px] py-[14px] rounded-lg border border-white/20 text-white hover:bg-white/10 transition-colors"
              >
                SDK reference
              </RouterLink>
            </div>
          </div>

          <div className="bg-[#020817] rounded-[22px] overflow-hidden border border-white/10 shadow-[0_45px_100px_-35px_rgba(0,0,0,.8)]">
            <div className="flex items-center gap-1 px-4 py-3 border-b border-white/10 bg-white/[0.025]">
              <span className="w-2 h-2 rounded-full bg-polyform-green mr-2" />
              {DEV_TABS.map((label, i) => (
                <span key={label} className={'hidden sm:inline-flex text-[11px] font-semibold px-2.5 py-1.5 rounded-md ' + (i === 0 ? 'bg-white/10 text-white' : 'text-slate-500')}>
                  {label}
                </span>
              ))}
              <button type="button" onClick={onLogin} className="ml-auto text-[11px] font-semibold px-3 py-1.5 rounded-md bg-polyform-blue text-white hover:bg-[#0879be] transition-colors">
                Run Script
              </button>
            </div>
            <div className="p-5 sm:p-6 flex flex-col overflow-x-auto min-h-[330px]">
              {CODE_LONG.map((c, i) => highlightJsLine(c.t, i))}
            </div>
            <div className="flex items-center gap-4 px-5 py-3 border-t border-white/10 text-[10px] text-slate-500 font-mono">
              <span>sdk connected</span>
              <span>model: active</span>
              <span className="ml-auto text-emerald-500">synced</span>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-6 bg-[#f7f9fb] border-b border-slate-200">
        <div className="max-w-[1240px] mx-auto grid lg:grid-cols-[0.72fr_1.28fr] gap-12 lg:gap-20 items-center">
          <div className="flex flex-col gap-5">
            <Eyebrow>5-minute start</Eyebrow>
            <h2 className="text-[clamp(32px,4vw,50px)] font-bold leading-[1.05] tracking-[-0.03em] text-polyform-dark-blue">
              Open the console. Run real geometry.
            </h2>
            <p className="text-[16px] leading-[1.7] text-gray-600">
              The fastest way to understand the SDK is to use it against the model in front of you.
            </p>
            <div className="flex flex-col border-y border-slate-200">
              {['Open the Developer Console', 'Paste a small SDK script', 'Run it against the active model', 'Save the script when it becomes useful'].map((step, i) => (
                <div key={step} className="grid grid-cols-[38px_1fr] gap-3 py-3.5 border-b border-slate-200 last:border-b-0">
                  <span className="font-mono text-[10px] text-polyform-blue pt-0.5">0{i + 1}</span>
                  <span className="text-sm font-semibold text-polyform-dark-blue">{step}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-[#020817] rounded-2xl border border-slate-800 overflow-hidden shadow-[0_26px_65px_-40px_rgba(15,23,42,.8)]">
            <div className="px-4 py-3 border-b border-white/10 text-[11px] font-semibold text-slate-400">Developer Console</div>
            <div className="p-5 sm:p-6 flex flex-col overflow-x-auto">
              {CODE_LONG.slice(2, 7).map((c, i) => highlightJsLine(c.t, i))}
            </div>
            <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between text-[10px] font-mono text-slate-500">
              <span>active model</span>
              <span className="text-emerald-500">ready to run</span>
            </div>
          </div>
        </div>
      </section>

      <section className="py-28 px-6 bg-white">
        <div className="max-w-[1240px] mx-auto grid lg:grid-cols-[0.82fr_1.18fr] gap-14 lg:gap-20 items-center">
          <div className="flex flex-col gap-5">
            <Eyebrow>Code Recorder</Eyebrow>
            <h2 className="text-[clamp(34px,4.5vw,58px)] font-bold leading-[1.04] tracking-[-0.035em] text-polyform-dark-blue">
              Your drawing can become the documentation.
            </h2>
            <p className="text-[17px] leading-[1.7] text-gray-600">
              Code Recorder translates modelling actions into the SDK calls that created them. Learn the API from work you already understand, then turn a one-off operation into a repeatable script.
            </p>
            <div className="mt-2 flex flex-col">
              {RECORDER_STEPS.map((s, i) => (
                <div key={s.title} className="grid grid-cols-[46px_1fr] gap-4 py-5 border-t border-slate-200 last:border-b">
                  <span className="w-10 h-10 rounded-xl bg-[#eef6fb] text-polyform-blue flex items-center justify-center">
                    <s.icon size={18} />
                  </span>
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-[16px] font-bold text-polyform-dark-blue">{s.title}</h3>
                      <span className="font-mono text-[10px] text-gray-400">0{i + 1}</span>
                    </div>
                    <p className="mt-1 text-[14px] leading-[1.6] text-gray-600">{s.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <MarketingVisual
              label="Code Recorder"
              title="Drawing actions become reusable JavaScript"
              dark
              aspectRatio="4 / 3"
              className="shadow-[0_30px_70px_-35px_rgba(15,23,42,.6)]"
            />
            <div className="hidden sm:block absolute -bottom-6 -left-6 w-[74%] bg-[#020817] rounded-xl border border-slate-800 p-4 shadow-xl">
              <div className="font-mono text-[11px] leading-[1.8] overflow-hidden">
                <div><span className="text-purple-300">const</span> <span className="text-slate-200">wall</span> <span className="text-slate-500">=</span> <span className="text-sky-300">sdk</span><span className="text-slate-400">.</span><span className="text-amber-200">createBox</span><span className="text-slate-300">(...);</span></div>
                <div><span className="text-sky-300">sdk</span><span className="text-slate-400">.</span><span className="text-amber-200">pushPull</span><span className="text-slate-300">(wall, 2.4);</span></div>
                <div><span className="text-sky-300">sdk</span><span className="text-slate-400">.</span><span className="text-amber-200">applyColor</span><span className="text-slate-300">(wall, '#e8e1d5');</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#f7f9fb] py-28 px-6">
        <div className="max-w-[1240px] mx-auto">
          <div className="grid lg:grid-cols-[0.7fr_1.3fr] gap-12 lg:gap-20 items-end mb-14">
            <div className="flex flex-col gap-5">
              <Eyebrow>Extensibility suite</Eyebrow>
              <h2 className="text-[clamp(34px,4.3vw,54px)] font-bold leading-[1.05] tracking-[-0.035em] text-polyform-dark-blue">
                Build the workflow around the model.
              </h2>
            </div>
            <p className="text-[17px] leading-[1.7] text-gray-600">
              Run automation, add your own interface and inspect what PolyForm is doing — without moving the design into a separate development environment.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
            {DEV_TOOL_GROUPS.map((g, gi) => (
              <div key={g.kicker} className="flex flex-col">
                <div className="flex items-baseline justify-between gap-4 pb-4 border-b-2 border-polyform-blue">
                  <div>
                    <span className="text-[11px] font-bold tracking-[0.13em] text-polyform-blue">{g.kicker}</span>
                    <h3 className="mt-2 text-xl font-bold text-polyform-dark-blue">{g.title}</h3>
                  </div>
                  <span className="font-mono text-[11px] text-gray-400">0{gi + 1}</span>
                </div>
                <div className="flex flex-col">
                  {g.items.map(item => (
                    <div key={item.title} className="flex gap-3.5 py-5 border-b border-slate-200 items-start">
                      <item.icon size={18} className="text-polyform-blue mt-0.5 shrink-0" />
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-bold text-polyform-dark-blue">{item.title}</span>
                        <span className="text-[13px] leading-[1.55] text-gray-600">{item.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="sdk" className="py-28 px-6 bg-white scroll-mt-24">
        <div className="max-w-[1240px] mx-auto">
          <div className="grid lg:grid-cols-[0.75fr_1.25fr] gap-12 lg:gap-20 items-end mb-10">
            <div className="flex flex-col gap-5">
              <Eyebrow>SDK reference</Eyebrow>
              <h2 className="text-[clamp(34px,4.3vw,54px)] font-bold leading-[1.05] tracking-[-0.035em] text-polyform-dark-blue">
                Start with the <code className="text-[0.84em]">sdk</code> object.
              </h2>
            </div>
            <div className="flex flex-col items-start lg:items-end gap-3">
              <p className="text-[15px] leading-[1.65] text-gray-600 max-w-[520px] lg:text-right">
                A compact sample of the modelling, site and collaboration methods available in the console.
              </p>
              <RouterLink
                to="sdk-docs"
                go={go}
                className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-polyform-blue hover:text-polyform-dark-blue transition-colors"
              >
                View full SDK documentation <ArrowRight size={16} />
              </RouterLink>
            </div>
          </div>

          <div className="border-y border-slate-200">
            {SDK_METHODS.map((m, i) => (
              <div key={m.sig} className="grid md:grid-cols-[42px_1.3fr_0.7fr] gap-3 md:gap-5 py-4 border-b border-slate-100 last:border-b-0 items-start">
                <span className="font-mono text-[10px] text-gray-400 pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <code className="text-[12px] sm:text-[13px] font-semibold text-polyform-dark-blue break-words">{m.sig}</code>
                <span className="text-sm leading-[1.55] text-gray-600">{m.text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
