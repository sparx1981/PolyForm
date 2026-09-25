import React from 'react';
import { ArrowRight } from 'lucide-react';
import { FEATURE_CHAPTERS, FEATURE_SECTIONS } from './data';
import { Eyebrow, IconTile, RouterLink, scrollToId, type Page } from './shared';

const FILES_SECTION = FEATURE_SECTIONS.find(s => s.id === 'files')!;

export default function Features({ go }: { go: (p: Page, anchor?: string) => void }) {
  return (
    <>
      <section className="pt-24 pb-16 px-6 border-b border-gray-100">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
          <Eyebrow>Product</Eyebrow>
          <h1 className="text-[clamp(38px,5.5vw,64px)] font-bold leading-[1.05] tracking-[-0.03em] text-polyform-dark-blue max-w-[900px]">
            One model for the building and its site
          </h1>
          <p className="text-lg leading-[1.6] text-gray-600 max-w-[640px]">
            The patio meets the back door, and the ground meets the floor, because they were always the same model. Six chapters cover what PolyForm does, from the first sketch to the walkthrough.
          </p>
        </div>
      </section>

      <section className="px-6 pb-16">
        <div className="max-w-[1200px] mx-auto flex gap-16 items-start">
          <aside className="hidden lg:flex sticky top-[80px] w-[200px] flex-none flex-col gap-0.5 pt-2">
            <span className="text-[11px] font-bold tracking-[0.12em] text-gray-400 px-3 pb-2.5">ON THIS PAGE</span>
            {FEATURE_CHAPTERS.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => scrollToId(c.id)}
                className="text-sm font-medium text-gray-500 px-3 py-[7px] rounded-md text-left hover:bg-gray-50 hover:text-polyform-blue transition-colors"
              >
                {c.kicker[0] + c.kicker.slice(1).toLowerCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => scrollToId('files')}
              className="text-sm font-medium text-gray-500 px-3 py-[7px] rounded-md text-left hover:bg-gray-50 hover:text-polyform-blue transition-colors"
            >
              Files &amp; storage
            </button>
          </aside>

          <div className="flex-1 min-w-0 flex flex-col">
            {FEATURE_CHAPTERS.map((chapter, ci) => {
              const sections = FEATURE_SECTIONS.filter(s => chapter.sectionIds.includes(s.id));
              return (
                <article key={chapter.id} id={chapter.id} className="py-16 border-b border-gray-100 flex flex-col gap-10 scroll-mt-20">
                  <div className="grid gap-10 items-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
                    <div className="flex flex-col gap-4">
                      <Eyebrow>{chapter.kicker}</Eyebrow>
                      <h2 className="text-[clamp(28px,3vw,40px)] font-bold leading-[1.1] tracking-[-0.015em] text-polyform-dark-blue">{chapter.title}</h2>
                      <p className="text-base leading-[1.65] text-gray-600">{chapter.body}</p>
                    </div>
                    <div
                      className="rounded-xl overflow-hidden border border-gray-200 bg-gradient-to-b from-sky-100 to-emerald-50 flex items-end p-5"
                      style={{ aspectRatio: '16 / 10' }}
                    >
                      <span className="text-sm font-semibold text-polyform-dark-blue/70 bg-white/70 backdrop-blur-sm px-3 py-1.5 rounded-lg" role="img" aria-label={`Illustration: ${chapter.title}`}>
                        {chapter.kicker}
                      </span>
                    </div>
                  </div>

                  {sections.map(s => (
                    <div key={s.id} id={s.id} className="flex flex-col gap-3 scroll-mt-20">
                      {sections.length > 1 && (
                        <div className="flex items-center gap-2.5">
                          <IconTile icon={<s.icon size={18} />} size={32} />
                          <h3 className="text-lg font-bold text-polyform-dark-blue">{s.title}</h3>
                        </div>
                      )}
                      <div className="grid gap-x-8 gap-y-0 sm:columns-2" style={{ columnGap: 32 }}>
                        {s.items.map(i => (
                          <div key={i.name} className="flex justify-between gap-3 py-3 border-t border-gray-100 [break-inside:avoid]">
                            <div className="flex flex-col gap-0.5 min-w-0">
                              {i.href ? (
                                <a href={i.href} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-polyform-gray hover:text-polyform-blue transition-colors hover:underline">
                                  {i.name}
                                </a>
                              ) : (
                                <span className="text-sm font-bold text-polyform-gray">{i.name}</span>
                              )}
                              <span className="text-[13px] leading-[1.5] text-gray-600">{i.text}</span>
                            </div>
                            {i.key && <span className="font-mono text-[11px] text-gray-400 shrink-0 pt-0.5">{i.key}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </article>
              );
            })}

            {/* Interoperability: kept visible and separate, not buried under a chapter. */}
            <article id="files" className="py-16 flex flex-col gap-8 scroll-mt-20">
              <div className="flex flex-col gap-4 max-w-[640px]">
                <Eyebrow>Interoperability</Eyebrow>
                <h2 className="text-[clamp(28px,3vw,40px)] font-bold leading-[1.1] tracking-[-0.015em] text-polyform-dark-blue">{FILES_SECTION.title}</h2>
                <p className="text-base leading-[1.65] text-gray-600">{FILES_SECTION.body}</p>
              </div>
              <div className="grid gap-x-8 gap-y-0 sm:columns-2" style={{ columnGap: 32 }}>
                {FILES_SECTION.items.map(i => (
                  <div key={i.name} className="flex justify-between gap-3 py-3 border-t border-gray-100 [break-inside:avoid]">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      {i.href ? (
                        <a href={i.href} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-polyform-gray hover:text-polyform-blue transition-colors hover:underline">
                          {i.name}
                        </a>
                      ) : (
                        <span className="text-sm font-bold text-polyform-gray">{i.name}</span>
                      )}
                      <span className="text-[13px] leading-[1.5] text-gray-600">{i.text}</span>
                    </div>
                    {i.key && <span className="font-mono text-[11px] text-gray-400 shrink-0 pt-0.5">{i.key}</span>}
                  </div>
                ))}
              </div>
              <RouterLink to="claude" go={go} className="self-start inline-flex items-center gap-1.5 text-[15px] font-semibold text-polyform-blue hover:text-polyform-dark-blue transition-colors">
                See it built by Claude <ArrowRight size={16} />
              </RouterLink>
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
