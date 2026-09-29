import React, { Children } from 'react';
import { useCms } from './context';
import { safeUrl, type Section } from './model';

export function SectionView({ section: s }: { section: Section }) {
  const dark = s.kind === 'cta';
  return <section id={s.id} className={`px-6 py-20 ${dark ? 'bg-polyform-dark-blue text-white' : 'bg-white text-polyform-dark-blue'}`}>
    <div className={`max-w-[1240px] mx-auto ${s.kind === 'hero' || dark ? 'text-center' : ''}`}>
      {s.heading && (s.kind === 'hero' ? <h1 className="text-5xl sm:text-6xl font-bold tracking-tight">{s.heading}</h1> : <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{s.heading}</h2>)}
      {s.body && <p className="mt-6 text-lg leading-relaxed whitespace-pre-wrap">{s.body}</p>}
      {s.image && safeUrl(s.image, true) && <img className="mt-8 rounded-2xl max-h-[650px] w-full object-contain" src={s.image} alt={s.alt} loading="lazy" />}
      {!!s.items.length && <div className={s.kind === 'faq' ? 'mt-8 text-left space-y-3' : 'mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3'}>{s.items.map((item, i) => s.kind === 'faq'
        ? <details key={i} className="border rounded-xl p-5"><summary className="font-semibold cursor-pointer">{item.title}</summary><p className="mt-4 whitespace-pre-wrap">{item.body}</p></details>
        : <article key={i} className="border border-slate-200 rounded-2xl p-6 text-left">{item.image && safeUrl(item.image, true) && <img src={item.image} alt={item.alt} className="w-full rounded-xl mb-5" loading="lazy" />}<h3 className="text-xl font-semibold">{item.title}</h3><p className="mt-3 whitespace-pre-wrap">{item.body}</p></article>)}</div>}
      {s.buttonLabel && s.buttonHref && safeUrl(s.buttonHref) && <a className={`inline-block mt-8 rounded-lg px-6 py-3 font-semibold ${dark ? 'bg-white text-polyform-dark-blue' : 'bg-polyform-blue text-white'}`} href={s.buttonHref}>{s.buttonLabel}</a>}
    </div>
  </section>;
}
export function CmsLayout({ page, children }: { page: string; children?: React.ReactNode }) {
  const { content } = useCms();
  const config = content?.pages.find(p => p.id === page);
  if (!config) return <>{children}</>;
  if (config.hidden) return <div className="p-20 text-center"><h1 className="text-3xl font-bold">Page unavailable</h1><a href="/">Return home</a></div>;
  const native = Children.toArray(children);
  return <>{config.sections.filter(s => !s.hidden).map(s => s.kind === 'native' ? <React.Fragment key={s.id}>{native[s.nativeIndex!]}</React.Fragment> : <SectionView key={s.id} section={s} />)}</>;
}
