import React from 'react';
import { FEATURE_SECTIONS } from './data';
import { Eyebrow, IconTile, scrollToId } from './shared';

export default function Features() {
  return (
    <>
      <section className="pt-24 pb-[72px] px-6 border-b border-gray-100">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
          <Eyebrow>Features</Eyebrow>
          <h1 className="text-[clamp(40px,6vw,72px)] font-bold leading-[1.04] tracking-[-0.03em] text-trimble-dark-blue max-w-[900px]">
            Everything from foundations to flower beds
          </h1>
          <p className="text-lg leading-[1.6] text-gray-600 max-w-[640px]">
            One model for the building and its site, so the patio meets the back door and the ground meets the floor.
          </p>
        </div>
      </section>

      <section className="px-6 pb-28">
        <div className="max-w-[1200px] mx-auto flex gap-16 items-start">
          <aside className="hidden lg:flex sticky top-[100px] w-[220px] flex-none flex-col gap-0.5 pt-16">
            <span className="text-[11px] font-bold tracking-[0.12em] text-gray-400 px-3 pb-2.5">ON THIS PAGE</span>
            {FEATURE_SECTIONS.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => scrollToId(f.id)}
                className="text-sm font-medium text-gray-600 px-3 py-[7px] rounded-md text-left hover:bg-gray-50 hover:text-trimble-blue transition-colors"
              >
                {f.title}
              </button>
            ))}
          </aside>

          <div className="flex-1 min-w-0 flex flex-col">
            {FEATURE_SECTIONS.map(f => (
              <article key={f.id} id={f.id} className="py-16 border-b border-gray-100 flex flex-col gap-7 scroll-mt-[84px]">
                <div className="grid gap-10 items-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}>
                  <div className="flex flex-col gap-4">
                    <IconTile icon={<f.icon size={22} />} />
                    <h2 className="text-[clamp(26px,2.8vw,36px)] font-bold leading-[1.12] tracking-[-0.01em] text-trimble-dark-blue">{f.title}</h2>
                    <p className="text-base leading-[1.65] text-gray-600">{f.body}</p>
                  </div>
                  <div
                    className="rounded-xl overflow-hidden border border-gray-200 bg-gradient-to-b from-sky-100 to-emerald-50"
                    style={{ aspectRatio: '16 / 10' }}
                    aria-label={`Screenshot: ${f.title.toLowerCase()}`}
                  />
                </div>
                <div
                  className="grid gap-px bg-gray-200 border border-gray-200 rounded-xl overflow-hidden"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 250px), 1fr))' }}
                >
                  {f.items.map(i => (
                    <div key={i.name} className="bg-white px-[18px] py-4 flex flex-col gap-1">
                      <div className="flex justify-between gap-2 items-baseline">
                        <span className="text-sm font-bold text-trimble-gray">{i.name}</span>
                        {i.key && <span className="font-mono text-[11px] text-gray-500">{i.key}</span>}
                      </div>
                      <span className="text-[13px] leading-[1.5] text-gray-600">{i.text}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
