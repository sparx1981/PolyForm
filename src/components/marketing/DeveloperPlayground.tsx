import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Play, RotateCcw } from 'lucide-react';
import { useCms } from '../cms/context';
import { Eyebrow } from './shared';
import { PLAYGROUND_EXAMPLES, PLAYGROUND_TEXT } from '../../lib/playground/examples';
import { runSandboxed } from '../../lib/playground/sandbox';
import type { PlaygroundResult } from '../../lib/playground/runnerCore';

const PlaygroundPreview = lazy(() => import('./PlaygroundPreview'));

class PreviewBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const LOG_TONE = { log: 'text-slate-200', info: 'text-sky-300', warn: 'text-amber-300', error: 'text-red-300' } as const;

/** "Try it live": example scripts, an editor, a Console and a 3D preview, run in a sandbox. Everything visible is CMS text. */
export default function DeveloperPlayground({ onLogin }: { onLogin: () => void }) {
  const cms = useCms();
  const T = cms.data(PLAYGROUND_TEXT);
  const examples = cms.data(PLAYGROUND_EXAMPLES);
  const [exampleId, setExampleId] = useState(examples[0]?.id ?? '');
  const example = examples.find(e => e.id === exampleId) ?? examples[0];
  const [code, setCode] = useState(example?.code ?? '');
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(false);
  const root = useRef<HTMLElement>(null);
  const latest = useRef(0);

  // Nothing (sandbox, 3D) starts until the section is near the screen.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setActive(true); return; }
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setActive(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const run = useCallback(async (source: string) => {
    const ticket = ++latest.current;
    setRunning(true);
    const next = await runSandboxed(source);
    if (ticket !== latest.current) return;
    setResult(next);
    setRunning(false);
  }, []);

  useEffect(() => { if (active && example) void run(code); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (id: string) => {
    const next = examples.find(e => e.id === id);
    if (!next) return;
    setExampleId(id);
    setCode(next.code);
    void run(next.code);
  };
  const objects = result?.objects ?? [];
  const changed = example ? code !== example.code : false;

  return (
    <section ref={root} id="try-it" className="py-24 px-6 bg-[#071a2b] text-white scroll-mt-24">
      <div className="max-w-[1240px] mx-auto">
        <div className="grid lg:grid-cols-[0.75fr_1.25fr] gap-8 lg:gap-16 items-end mb-10">
          <div className="flex flex-col gap-5">
            <Eyebrow dark>{T.eyebrow}</Eyebrow>
            <h2 className="text-[clamp(32px,4vw,50px)] font-bold leading-[1.05] tracking-[-0.03em]">{T.heading}</h2>
          </div>
          <p className="text-[16px] leading-[1.7] text-white/75 max-w-[640px]">{T.intro}</p>
        </div>

        <div role="tablist" aria-label={T.examplesLabel} className="flex flex-wrap gap-2 mb-4">
          {examples.map(e => (
            <button
              key={e.id}
              type="button"
              role="tab"
              aria-selected={e.id === exampleId}
              onClick={() => choose(e.id)}
              className={'text-[13px] font-semibold px-3.5 py-2 rounded-lg border transition-colors ' + (e.id === exampleId ? 'bg-white text-[#071a2b] border-white' : 'border-white/20 text-white/80 hover:bg-white/10')}
            >
              {e.title}
            </button>
          ))}
        </div>
        {example && <p className="text-[14px] text-white/65 mb-6 max-w-[760px]">{example.text}</p>}

        <div className="grid lg:grid-cols-2 gap-5">
          <div className="bg-[#020817] rounded-2xl border border-white/10 overflow-hidden flex flex-col min-h-[420px]">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 bg-white/[0.025]">
              <span className="w-2 h-2 rounded-full bg-polyform-green" />
              <label htmlFor="playground-code" className="text-[11px] font-semibold text-slate-400">{T.editorLabel}</label>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={() => { if (example) { setCode(example.code); void run(example.code); } }} disabled={!changed}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-md text-slate-300 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent">
                  <RotateCcw size={12} aria-hidden /> {T.reset}
                </button>
                <button type="button" onClick={() => void run(code)} disabled={running}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-md bg-polyform-blue text-white hover:bg-[#0879be] disabled:opacity-60 transition-colors">
                  <Play size={12} aria-hidden /> {running ? T.running : T.run}
                </button>
              </div>
            </div>
            <textarea
              id="playground-code"
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void run(code); } }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="flex-1 min-h-[360px] w-full resize-y bg-transparent text-[#d4d4d4] font-mono text-[13px] leading-[1.7] p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-polyform-blue"
            />
          </div>

          <div className="flex flex-col gap-5">
            <div className="relative rounded-2xl border border-white/10 overflow-hidden bg-[#eef3f8] min-h-[300px] flex-1">
              <div className="absolute top-3 left-3 z-10 text-[11px] font-semibold text-slate-600 bg-white/80 rounded-md px-2 py-1">{T.previewLabel}{objects.length ? ` · ${objects.length} ${T.objects}` : ''}</div>
              {objects.length === 0 && !running && <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">{T.previewEmpty}</div>}
              {active && objects.length > 0 && (
                <PreviewBoundary fallback={<div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 px-6 text-center">{T.noWebgl}</div>}>
                  <Suspense fallback={null}><PlaygroundPreview objects={objects} /></Suspense>
                </PreviewBoundary>
              )}
              {objects.length > 0 && <div className="absolute bottom-3 right-3 z-10 text-[11px] text-slate-500 bg-white/70 rounded-md px-2 py-1">{T.previewHint}</div>}
            </div>
            <div className="bg-[#020817] rounded-2xl border border-white/10 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/10 bg-white/[0.025] text-[11px] font-semibold text-slate-400">{T.consoleLabel}</div>
              <div role="log" aria-live="polite" className="p-4 font-mono text-[12px] leading-[1.7] min-h-[96px] max-h-[180px] overflow-auto">
                {result && result.logs.length === 0 && result.ok && <div className="text-slate-500">{T.consoleEmpty}</div>}
                {!result && <div className="text-slate-500">{T.consoleEmpty}</div>}
                {result?.logs.map((l, i) => <div key={i} className={LOG_TONE[l.level] + ' whitespace-pre-wrap break-words'}>{l.text}</div>)}
                {result && !result.ok && <div className="text-red-300 whitespace-pre-wrap break-words">{T.errorPrefix} {result.error}</div>}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <button type="button" onClick={onLogin} className="inline-flex items-center gap-2 text-base font-semibold px-6 py-[14px] rounded-lg bg-white text-[#071a2b] hover:bg-gray-100 transition-colors">
            {T.cta} <ArrowRight size={16} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
