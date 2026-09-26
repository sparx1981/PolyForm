import React, { useState } from 'react';
import { ArrowDown, ArrowRight, Check, Copy, History, LayoutDashboard, PencilRuler, Sparkles } from 'lucide-react';
import { CAPABILITY_GROUPS, HOW_IT_WORKS, SETUP_STEPS } from './data';
import { Eyebrow, FloorPlanTile, MarketingVisual, RouterLink, scrollToId, type Page } from './shared';

const CONNECTOR_URL = 'https://polyform-mcp.vercel.app/mcp';

const REASSURANCE = [
  { icon: PencilRuler, text: 'Editable PolyForm output — not a locked image' },
  { icon: LayoutDashboard, text: '3D preview plus a floor plan of every level' },
  { icon: History, text: 'Step back through up to 20 model versions' },
];

const EXAMPLES: { prompt: string; calls: string[]; label: string }[] = [
  { prompt: 'Build me an L-shaped house, two storeys, with four bedrooms and a bathroom upstairs.', calls: ['create_model', 'add_room', 'add_opening', 'add_stairs', 'add_roof'], label: 'Create' },
  { prompt: 'Add a bathroom off the upstairs landing, three metres by two.', calls: ['add_room', 'add_opening'], label: 'Change' },
  { prompt: 'Turn on a wildflower meadow at the back, and set it to a rainy afternoon.', calls: ['set_appearance', 'set_weather'], label: 'Visualise' },
];

function CopyField() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-[#f8fafc] px-4 py-3">
      <code className="flex-1 text-[13px] text-polyform-dark-blue font-semibold break-all">{CONNECTOR_URL}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(CONNECTOR_URL);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Address remains visible if clipboard permission is denied.
          }
        }}
        className="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-polyform-blue hover:text-polyform-dark-blue px-2.5 py-1.5 rounded-md hover:bg-white transition-colors"
      >
        {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
      </button>
    </div>
  );
}

function ClaudePreview() {
  return (
    <div className="rounded-[24px] overflow-hidden bg-white text-polyform-gray shadow-[0_45px_100px_-35px_rgba(0,0,0,.65)] border border-white/15">
      <div className="h-12 px-4 flex items-center gap-2 border-b border-gray-100 text-[12px] font-semibold text-gray-500">
        <span className="w-2 h-2 rounded-full bg-polyform-green" />
        Claude × PolyForm
        <span className="ml-auto text-gray-400">Connected</span>
      </div>
      <div className="p-5 sm:p-6 flex flex-col gap-4">
        <div className="ml-auto max-w-[88%] bg-polyform-blue text-white text-sm leading-[1.55] px-4 py-3 rounded-2xl rounded-br-[4px]">
          Build me an L-shaped house, two storeys, with four bedrooms and a bathroom upstairs.
        </div>
        <div className="flex flex-wrap gap-1.5">
          {['create_model', 'add_room', 'add_opening', 'add_stairs', 'add_roof', 'preview_model'].map(c => (
            <span key={c} className="inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded-md bg-gray-100 text-gray-700">
              <span className="w-1.5 h-1.5 rounded-full bg-polyform-green" /> {c}
            </span>
          ))}
        </div>
        <div className="max-w-[92%] bg-gray-100 text-sm leading-[1.55] px-4 py-3 rounded-2xl rounded-bl-[4px]">
          Done. Here is the model and the plans for both floors. Open it in PolyForm to keep designing.
        </div>
        <div className="grid sm:grid-cols-[1.25fr_0.85fr_0.85fr] gap-2.5">
          <MarketingVisual label="3D preview" title="Editable PolyForm model" aspectRatio="4 / 3" className="rounded-xl" />
          <FloorPlanTile label="Level 1" variant={1} />
          <FloorPlanTile label="Level 2" variant={2} />
        </div>
      </div>
    </div>
  );
}

export default function BuildWithClaude({ go, onLogin }: { go: (p: Page, anchor?: string) => void; onLogin: () => void }) {
  return (
    <>
      <section className="relative overflow-hidden bg-polyform-dark-blue text-white py-24 sm:py-28 px-6">
        <div className="absolute inset-0 opacity-[0.1] pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.28) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.28) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="relative max-w-[1240px] mx-auto grid lg:grid-cols-[0.83fr_1.17fr] gap-14 lg:gap-20 items-center">
          <div className="flex flex-col gap-6">
            <Eyebrow dark icon={<Sparkles size={16} />}>Build with Claude</Eyebrow>
            <h1 className="text-[clamp(42px,6vw,72px)] font-bold leading-[1.01] tracking-[-0.045em]">
              Describe the change.<br />
              <span className="text-[#9ed5f7]">Keep the model.</span>
            </h1>
            <p className="text-[18px] leading-[1.7] text-white/78 max-w-[610px]">
              Connect Claude to PolyForm and create or change buildings, landscape and site context in plain language. The result is an editable PolyForm model — not just a render.
            </p>
            <div className="flex flex-col gap-3 pt-1">
              {REASSURANCE.map(r => (
                <span key={r.text} className="flex items-center gap-3 text-[15px] text-white/90">
                  <r.icon size={17} className="text-[#9ed5f7] shrink-0" /> {r.text}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => scrollToId('setup')}
              className="self-start mt-2 inline-flex items-center gap-2 text-base font-semibold px-6 py-[14px] rounded-lg bg-white text-polyform-dark-blue hover:bg-gray-100 transition-colors"
            >
              Connect Claude <ArrowDown size={16} />
            </button>
          </div>

          <ClaudePreview />
        </div>
      </section>

      <section className="py-28 px-6 bg-white">
        <div className="max-w-[1240px] mx-auto grid lg:grid-cols-[0.75fr_1.25fr] gap-12 lg:gap-20 items-start">
          <div className="flex flex-col gap-5 lg:sticky lg:top-[112px]">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="text-[clamp(34px,4.4vw,56px)] font-bold leading-[1.05] tracking-[-0.035em] text-polyform-dark-blue">
              From a sentence to a model you can keep editing.
            </h2>
            <p className="text-[16px] leading-[1.7] text-gray-600">
              Claude works through PolyForm rather than around it. The same model continues in the browser when you are ready to take over.
            </p>
          </div>
          <div className="flex flex-col">
            {HOW_IT_WORKS.map(s => (
              <div key={s.n} className="grid grid-cols-[58px_1fr] gap-5 py-8 border-t border-slate-200 last:border-b">
                <span className="font-mono font-semibold text-[13px] text-polyform-blue pt-1">{s.n}</span>
                <div className="flex flex-col gap-2">
                  <h3 className="text-xl font-bold text-polyform-dark-blue">{s.title}</h3>
                  <p className="text-[15px] leading-[1.65] text-gray-600">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f7f9fb] py-28 px-6">
        <div className="max-w-[1240px] mx-auto">
          <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-12 lg:gap-20 items-end">
            <div className="flex flex-col gap-5">
              <Eyebrow>What a prompt actually does</Eyebrow>
              <h2 className="text-[clamp(34px,4.4vw,56px)] font-bold leading-[1.05] tracking-[-0.035em] text-polyform-dark-blue">
                It uses the same tools you do.
              </h2>
            </div>
            <p className="text-[17px] leading-[1.7] text-gray-600">
              Requests are translated into PolyForm actions. That makes the result inspectable, editable and compatible with the rest of the modelling workflow.
            </p>
          </div>

          <div className="mt-14 grid md:grid-cols-3 gap-6">
            {EXAMPLES.map((ex, i) => (
              <div key={ex.label} className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-5 shadow-[0_18px_35px_-32px_rgba(15,23,42,.45)]">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-polyform-blue">{ex.label}</span>
                  <span className="font-mono text-[11px] text-gray-400">0{i + 1}</span>
                </div>
                <p className="text-[15px] leading-[1.65] text-polyform-dark-blue font-semibold">&ldquo;{ex.prompt}&rdquo;</p>
                <div className="flex flex-wrap gap-1.5 mt-auto">
                  {ex.calls.map(c => (
                    <span key={c} className="inline-flex items-center gap-1.5 font-mono text-[10px] px-2 py-1 rounded-md bg-[#f4f6f8] text-gray-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-polyform-green" /> {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-28 px-6 bg-white">
        <div className="max-w-[1240px] mx-auto grid lg:grid-cols-[0.75fr_1.25fr] gap-12 lg:gap-20 items-start">
          <div className="flex flex-col gap-5 lg:sticky lg:top-[112px]">
            <Eyebrow>What Claude can do</Eyebrow>
            <h2 className="text-[clamp(34px,4.2vw,54px)] font-bold leading-[1.05] tracking-[-0.035em] text-polyform-dark-blue">
              Built on PolyForm’s own toolset.
            </h2>
            <p className="text-[16px] leading-[1.7] text-gray-600">
              The connector can inspect the model, build with native tools, change appearance and weather, and preview the result before you open it.
            </p>
            <p className="text-[14px] leading-[1.65] text-gray-500">
              The last 20 versions of a model are retained, so a change can be stepped back when needed.
            </p>
            <RouterLink to="developers" go={go} className="self-start inline-flex items-center gap-2 text-[15px] font-semibold text-polyform-blue hover:text-polyform-dark-blue transition-colors">
              Explore the underlying SDK <ArrowRight size={16} />
            </RouterLink>
          </div>

          <div className="grid sm:grid-cols-2 gap-x-8">
            {CAPABILITY_GROUPS.map(g => (
              <div key={g.kind} className="py-6 border-t border-slate-200">
                <h3 className="text-lg font-bold text-polyform-dark-blue">{g.kind}</h3>
                <p className="mt-1 text-sm leading-[1.6] text-gray-600">{g.text}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {g.tools.map(t => (
                    <span key={t} className="font-mono text-[10px] px-2 py-1 rounded-md bg-[#f4f6f8] text-gray-600">{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="setup" className="bg-[#f7f9fb] py-28 px-6 scroll-mt-24">
        <div className="max-w-[1000px] mx-auto grid lg:grid-cols-[0.72fr_1.28fr] gap-12 lg:gap-16 items-start">
          <div className="flex flex-col gap-5">
            <Eyebrow>Set up</Eyebrow>
            <h2 className="text-[clamp(32px,4vw,50px)] font-bold leading-[1.05] tracking-[-0.03em] text-polyform-dark-blue">Add PolyForm to Claude.</h2>
            <p className="text-[15px] leading-[1.7] text-gray-600">Four steps, then PolyForm becomes available from your Claude conversations.</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {SETUP_STEPS.map(s => (
              <div key={s.n} className="grid grid-cols-[42px_1fr] gap-4 px-5 sm:px-6 py-5 border-b border-gray-100 last:border-b-0 items-start">
                <span className="w-8 h-8 rounded-full bg-[#eef6fb] text-polyform-blue text-[12px] font-bold flex items-center justify-center">{s.n}</span>
                <div className="flex flex-col gap-1">
                  <span className="text-base font-bold text-polyform-dark-blue">{s.title}</span>
                  <span className="text-[14px] leading-[1.6] text-gray-600">
                    {s.n === '2' ? <>Paste the address below, ending in <code>/mcp</code>.</> : s.body}
                  </span>
                  {s.n === '2' && <CopyField />}
                </div>
              </div>
            ))}
          </div>
          <div className="lg:col-start-2">
            <button
              type="button"
              onClick={onLogin}
              className="inline-flex items-center gap-2 text-base font-semibold px-6 py-[14px] rounded-lg bg-polyform-blue text-white shadow-[0_8px_20px_rgb(0_99_163_/_0.2)] hover:bg-polyform-dark-blue transition-colors"
            >
              Start designing <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
