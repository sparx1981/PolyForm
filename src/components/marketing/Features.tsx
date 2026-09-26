import React from 'react';
import { ArrowRight } from 'lucide-react';
import { FEATURE_CHAPTERS, FEATURE_SECTIONS } from './data';
import { Eyebrow, MarketingVisual, RouterLink, scrollToId, type Page } from './shared';

const FILES_SECTION = FEATURE_SECTIONS.find(s => s.id === 'files')!;

export default function Features({ go }: { go: (p: Page, anchor?: string) => void }) {
  return (
    <>
      <section className="relative overflow-hidden px-6 pt-20 pb-20 bg-white border-b border-slate-200">
        <div className="absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_20%_0%,rgba(0,99,163,0.08),transparent_48%)] pointer-events-none" />
        <div className="relative max-w-[1240px] mx-auto grid lg:grid-cols-[0.95fr_1.05fr] gap-12 lg:gap-20 items-end">
          <div className="flex flex-col gap-5">
            <Eyebrow>Product</Eyebrow>
            <h1 className="text-[clamp(42px,6vw,72px)] font-bold leading-[1.01] tracking-[-0.045em] text-polyform-dark-blue">
              One model.<br />The whole site.
            </h1>
          </div>
          <div className="flex flex-col gap-5">
            <p className="text-[19px] leading-[1.7] text-gray-600 max-w-[640px]">
              PolyForm keeps architecture, terrain and landscape together from the first sketch to the final walk-through. No separate site model. No disconnected garden plan.
            </p>
            <p className="text-sm text-gray-500">Explore the product by workflow, then drill into the detailed tools beneath each chapter.</p>
          </div>
        </div>
      </section>

      <section className="px-6 py-24 bg-[#f8fafc]">
        <div className="max-w-[1240px] mx-auto flex gap-14 xl:gap-20 items-start">
          <aside className="hidden lg:flex sticky top-[100px] w-[190px] flex-none flex-col">
            <span className="text-[11px] font-bold tracking-[0.14em] text-gray-400 px-3 pb-3">EXPLORE</span>
            {FEATURE_CHAPTERS.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => scrollToId(c.id)}
                className="text-sm font-semibold text-gray-500 px-3 py-2.5 rounded-lg text-left hover:bg-white hover:text-polyform-blue transition-colors"
              >
                {c.kicker[0] + c.kicker.slice(1).toLowerCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => scrollToId('files')}
              className="text-sm font-semibold text-gray-500 px-3 py-2.5 rounded-lg text-left hover:bg-white hover:text-polyform-blue transition-colors"
            >
              Files & storage
            </button>
          </aside>

          <div className="flex-1 min-w-0 flex flex-col">
            {FEATURE_CHAPTERS.map((chapter, ci) => {
              const sections = FEATURE_SECTIONS.filter(s => chapter.sectionIds.includes(s.id));
              const reverse = ci % 2 === 1;
              return (
                <article key={chapter.id} id={chapter.id} className="py-14 first:pt-0 border-b border-slate-200 scroll-mt-24">
                  <div className={'grid lg:grid-cols-[0.72fr_1.28fr] gap-10 lg:gap-16 items-center ' + (reverse ? 'lg:[&>*:first-child]:order-2 lg:grid-cols-[1.28fr_0.72fr]' : '')}>
                    <div className="flex flex-col gap-5">
                      <Eyebrow>{chapter.kicker}</Eyebrow>
                      <h2 className="text-[clamp(30px,4vw,50px)] font-bold leading-[1.06] tracking-[-0.03em] text-polyform-dark-blue">{chapter.title}</h2>
                      <p className="text-[16px] sm:text-[17px] leading-[1.7] text-gray-600">{chapter.body}</p>
                    </div>
                    <MarketingVisual
                      label={chapter.kicker + ' media'}
                      title={chapter.title + ' — replace with PolyForm product imagery'}
                      aspectRatio="16 / 10"
                      className="shadow-[0_24px_55px_-38px_rgba(15,23,42,.42)]"
                    />
                  </div>

                  <div className={'mt-10 grid gap-x-10 gap-y-8 ' + (sections.length > 1 ? 'md:grid-cols-2' : '')}>
                    {sections.map(s => (
                      <div key={s.id} id={s.id} className="scroll-mt-24">
                        {sections.length > 1 && (
                          <h3 className="text-[15px] font-bold text-polyform-dark-blue mb-1">{s.title}</h3>
                        )}
                        {sections.length > 1 && <p className="text-[13px] leading-[1.55] text-gray-500 mb-3">{s.body}</p>}
                        <div className="grid sm:grid-cols-2 gap-x-7">
                          {s.items.map(i => (
                            <div key={i.name} className="flex justify-between gap-3 py-3 border-t border-slate-200">
                              <div className="flex flex-col gap-1 min-w-0">
                                {i.href ? (
                                  <a href={i.href} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-polyform-dark-blue hover:text-polyform-blue transition-colors">
                                    {i.name}
                                  </a>
                                ) : (
                                  <span className="text-sm font-bold text-polyform-dark-blue">{i.name}</span>
                                )}
                                <span className="text-[13px] leading-[1.55] text-gray-600">{i.text}</span>
                              </div>
                              {i.key && <span className="font-mono text-[10px] text-gray-400 shrink-0 pt-0.5">{i.key}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}

            <article id="files" className="pt-16 scroll-mt-24">
              <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-14 items-start">
                <div className="flex flex-col gap-4">
                  <Eyebrow>Interoperability</Eyebrow>
                  <h2 className="text-[clamp(30px,4vw,50px)] font-bold leading-[1.06] tracking-[-0.03em] text-polyform-dark-blue">{FILES_SECTION.title}</h2>
                  <p className="text-[16px] leading-[1.7] text-gray-600">{FILES_SECTION.body}</p>
                  <RouterLink to="claude" go={go} className="mt-2 self-start inline-flex items-center gap-1.5 text-[15px] font-semibold text-polyform-blue hover:text-polyform-dark-blue transition-colors">
                    See PolyForm with Claude <ArrowRight size={16} />
                  </RouterLink>
                </div>
                <div>
                  <div className="mb-7 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                    <div className="flex flex-wrap items-center justify-center gap-2.5 text-[12px] font-semibold">
                      <span className="px-3 py-2 rounded-lg border border-slate-200 bg-[#f8fafc] text-gray-600">Google Drive</span>
                      <ArrowRight size={14} className="text-gray-300" />
                      <span className="px-4 py-2.5 rounded-lg bg-polyform-blue text-white">PolyForm</span>
                      <ArrowRight size={14} className="text-gray-300" />
                      <span className="px-3 py-2 rounded-lg border border-slate-200 bg-[#f8fafc] text-gray-600">Trimble Connect</span>
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px] text-gray-500">
                      <span>Import SKP + supported 3D</span>
                      <span>Export glTF</span>
                      <span>Export STL</span>
                      <span>Export SKP</span>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-x-8">
                  {FILES_SECTION.items.map(i => (
                    <div key={i.name} className="flex justify-between gap-3 py-4 border-t border-slate-200 last:border-b">
                      <div className="flex flex-col gap-1 min-w-0">
                        {i.href ? (
                          <a href={i.href} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-polyform-dark-blue hover:text-polyform-blue transition-colors">
                            {i.name}
                          </a>
                        ) : (
                          <span className="text-sm font-bold text-polyform-dark-blue">{i.name}</span>
                        )}
                        <span className="text-[13px] leading-[1.55] text-gray-600">{i.text}</span>
                      </div>
                      {i.key && <span className="font-mono text-[10px] text-gray-400 shrink-0 pt-0.5">{i.key}</span>}
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
