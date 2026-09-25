import React, { useState } from 'react';
import { ArrowDown, Check, Copy, History, LayoutDashboard, PencilRuler, Sparkles } from 'lucide-react';
import { CAPABILITY_GROUPS, HOW_IT_WORKS, SETUP_STEPS } from './data';
import { Eyebrow, FloorPlanTile, IconTile, RouterLink, scrollToId, type Page } from './shared';

const CONNECTOR_URL = 'https://polyform.app/mcp';

const REASSURANCE = [
  { icon: PencilRuler, text: 'Editable PolyForm output, not a locked render' },
  { icon: LayoutDashboard, text: 'A 3D preview and a floor plan of every level' },
  { icon: History, text: 'Every change can be undone, up to 20 steps back' },
];

const EXAMPLES: { prompt: string; calls: string[]; label: string }[] = [
  { prompt: 'Build me an L-shaped house, two storeys, with four bedrooms and a bathroom upstairs.', calls: ['create_model', 'add_room', 'add_opening', 'add_stairs', 'add_roof'], label: 'Prompt → model result' },
  { prompt: 'Add a bathroom off the upstairs landing, three metres by two.', calls: ['add_room', 'add_opening'], label: 'Prompt → floor-plan change' },
  { prompt: 'Turn on a wildflower meadow at the back, and set it to a rainy afternoon.', calls: ['set_appearance', 'set_weather'], label: 'Prompt → terrain and weather change' },
];

function CopyField() {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-light px-4 py-3">
      <code className="flex-1 text-[13px] text-polyform-dark-blue font-semibold break-all">{CONNECTOR_URL}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(CONNECTOR_URL);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard access can be denied; the address is still visible to copy by hand.
          }
        }}
        className="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-polyform-blue hover:text-polyform-dark-blue px-2.5 py-1.5 rounded-md hover:bg-white transition-colors"
      >
        {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
      </button>
    </div>
  );
}

export default function BuildWithClaude({ go, onLogin }: { go: (p: Page, anchor?: string) => void; onLogin: () => void }) {
  return (
    <>
      <section className="bg-polyform-dark-blue text-white py-24 px-6">
        <div className="max-w-[1200px] mx-auto grid gap-16 items-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))' }}>
          <div className="flex flex-col gap-5">
            <Eyebrow dark icon={<Sparkles size={16} />}>Build with Claude</Eyebrow>
            <h1 className="text-[clamp(38px,5.2vw,64px)] font-bold leading-[1.08] tracking-[-0.03em]">Describe the design.<br />Get an editable 3D model.</h1>
            <p className="text-lg leading-[1.65] text-white/85">
              Connect Claude to PolyForm and create or change buildings, landscape and site context in plain language. Review the 3D result and floor plans before continuing in PolyForm.
            </p>
            <div className="flex flex-col gap-2.5 pt-1">
              {REASSURANCE.map(r => (
                <span key={r.text} className="flex items-center gap-2.5 text-[15px] text-white/90">
                  <r.icon size={16} className="text-[#7CC3F0] shrink-0" /> {r.text}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => scrollToId('setup')}
              className="self-start mt-1 inline-flex items-center gap-2 text-base font-semibold px-6 py-[14px] rounded-lg bg-white text-polyform-dark-blue hover:bg-gray-100 transition-colors"
            >
              Connect Claude <ArrowDown size={16} />
            </button>
          </div>

          <div className="bg-white text-polyform-gray rounded-2xl p-[22px] flex flex-col gap-3 shadow-[0_40px_80px_-24px_rgba(0,0,0,0.5)]">
            <div className="ml-auto max-w-[85%] bg-polyform-blue text-white text-sm leading-[1.55] px-4 py-3 rounded-2xl rounded-br-[4px]">
              Build me an L-shaped house, two storeys, with four bedrooms and a bathroom upstairs.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {['create_model', 'add_room', 'add_opening', 'add_stairs', 'add_roof', 'preview_model'].map(c => (
                <span key={c} className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-1 rounded-md bg-gray-100 text-gray-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-polyform-green" /> {c}
                </span>
              ))}
            </div>
            <div className="max-w-[92%] bg-gray-100 text-sm leading-[1.55] px-4 py-3 rounded-2xl rounded-bl-[4px]">
              Done. Here is the 3D view and the plans for both floors: kitchen, lounge, hallway and WC downstairs; four bedrooms and a bathroom upstairs.
            </div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: '1.3fr 1fr 1fr' }}>
              <div
                className="rounded-[10px] border border-gray-200 bg-gradient-to-b from-sky-100 to-emerald-50 relative"
                style={{ minHeight: 130 }}
                aria-label="3D preview"
              />
              <FloorPlanTile label="Level 1" variant={1} />
              <FloorPlanTile label="Level 2" variant={2} />
            </div>
          </div>
        </div>
      </section>

      <section className="py-[104px] px-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-12">
          <h2 className="text-[clamp(30px,3.6vw,46px)] font-bold leading-[1.1] tracking-[-0.02em] text-polyform-dark-blue">How it works</h2>
          <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' }}>
            {HOW_IT_WORKS.map(s => (
              <div key={s.n} className="border-t-[3px] border-polyform-blue pt-6 flex flex-col gap-3">
                <span className="font-mono font-semibold text-[13px] text-polyform-blue">{s.n}</span>
                <span className="text-xl font-bold text-polyform-dark-blue">{s.title}</span>
                <span className="text-base leading-[1.6] text-gray-600">{s.body}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Before/after examples, built from genuine connector tool calls - not fabricated screenshots. */}
      <section className="bg-gray-light py-[104px] px-6">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-12">
          <div className="flex flex-col gap-3.5 max-w-[640px]">
            <Eyebrow>What a prompt actually does</Eyebrow>
            <h2 className="text-[clamp(30px,3.6vw,46px)] font-bold leading-[1.1] tracking-[-0.02em] text-polyform-dark-blue">
              Every prompt runs the app&rsquo;s own tools
            </h2>
          </div>
          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
            {EXAMPLES.map(ex => (
              <div key={ex.label} className="flex flex-col gap-3">
                <span className="text-[13px] font-semibold text-gray-500">{ex.label}</span>
                <div className="bg-white rounded-xl p-4 flex flex-col gap-2.5 shadow-modus-1">
                  <p className="text-sm leading-[1.5] text-polyform-dark-blue font-medium">&ldquo;{ex.prompt}&rdquo;</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ex.calls.map(c => (
                      <span key={c} className="inline-flex items-center gap-1.5 font-mono text-[11px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-polyform-green" /> {c}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-[104px] px-6">
        <div className="max-w-[1200px] mx-auto grid gap-14 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))' }}>
          <div className="flex flex-col gap-4 lg:sticky lg:top-[80px]">
            <Eyebrow>What Claude can do</Eyebrow>
            <h2 className="text-[clamp(30px,3.6vw,46px)] font-bold leading-[1.1] tracking-[-0.02em] text-polyform-dark-blue">
              Built with the app&rsquo;s own tools
            </h2>
            <p className="text-base leading-[1.65] text-gray-600">
              The connector uses PolyForm&rsquo;s scripting library, roof assembly and patio, fence and pond tools, so objects come out exactly as if you drew them. Changes save to the model and appear live if the app is open.
            </p>
            <p className="text-base leading-[1.65] text-gray-600">
              It keeps the last 20 versions of each model, so Claude can step back a change when you ask.
            </p>
            <RouterLink to="developers" go={go} className="self-start text-[15px] font-semibold text-polyform-blue hover:text-polyform-dark-blue transition-colors">
              See the full SDK &rarr;
            </RouterLink>
          </div>

          <div className="flex flex-col divide-y divide-gray-100 border-t border-b border-gray-100">
            {CAPABILITY_GROUPS.map(g => (
              <div key={g.kind} className="flex flex-col gap-3 py-5">
                <div className="flex items-center gap-3">
                  <IconTile icon={<g.icon size={18} />} size={36} />
                  <div className="flex flex-col">
                    <span className="text-[17px] font-bold text-polyform-dark-blue">{g.kind}</span>
                    <span className="text-sm text-gray-600">{g.text}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.tools.map(t => (
                    <span key={t} className="font-mono text-xs px-2 py-1 rounded-md bg-gray-50 border border-gray-200 text-gray-700">{t}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="setup" className="bg-gray-light py-[104px] px-6 scroll-mt-20">
        <div className="max-w-[880px] mx-auto flex flex-col gap-8">
          <div className="flex flex-col gap-3.5">
            <Eyebrow>Set up</Eyebrow>
            <h2 className="text-[clamp(30px,3.6vw,46px)] font-bold leading-[1.1] tracking-[-0.02em] text-polyform-dark-blue">Add PolyForm to Claude</h2>
          </div>
          <div className="flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white">
            {SETUP_STEPS.map(s => (
              <div key={s.n} className="flex gap-5 px-6 py-[22px] border-b border-gray-100 last:border-b-0 items-start">
                <span className="w-7 h-7 flex-none rounded-full bg-polyform-blue text-white text-[13px] font-bold flex items-center justify-center">{s.n}</span>
                <div className="flex flex-col gap-1">
                  <span className="text-base font-bold text-polyform-dark-blue">{s.title}</span>
                  <span className="text-[15px] leading-[1.6] text-gray-600">
                    {s.n === '2' ? <>Paste the address below, ending in <code>/mcp</code>.</> : s.body}
                  </span>
                  {s.n === '2' && <CopyField />}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onLogin}
            className="self-start inline-flex items-center gap-2 text-base font-semibold px-6 py-[14px] rounded-lg bg-polyform-blue text-white shadow-[0_8px_20px_rgb(0_99_163_/_0.25)] hover:bg-polyform-dark-blue transition-colors"
          >
            Start designing
          </button>
        </div>
      </section>
    </>
  );
}
