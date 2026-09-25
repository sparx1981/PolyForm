import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { SDK_METHOD_COUNT, SDK_REFERENCE, type SdkMethod, type SdkTag } from './sdkFullReference';
import { Eyebrow, type Page } from './shared';

const TAG_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  core: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-500' },
  architecture: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  landscape: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  materials: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  measurement: { bg: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-500' },
  toolbars: { bg: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-500' },
  selection: { bg: 'bg-pink-50', text: 'text-pink-700', dot: 'bg-pink-500' },
  camera: { bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-500' },
  ai: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
  scene: { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500' },
  outliner: { bg: 'bg-cyan-50', text: 'text-cyan-700', dot: 'bg-cyan-500' },
  blockKit: { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500' },
  worldView: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
};

function matches(query: string, tag: SdkTag, method: SdkMethod): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    method.name.toLowerCase().includes(q)
    || method.signature.toLowerCase().includes(q)
    || method.description.toLowerCase().includes(q)
    || tag.title.toLowerCase().includes(q)
  );
}

function MethodRow({ tag, method }: { tag: SdkTag; method: SdkMethod }) {
  const [open, setOpen] = useState(false);
  const color = TAG_COLORS[tag.id] ?? TAG_COLORS.core;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
        <span className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded ${color.bg} ${color.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} /> {tag.id === 'core' ? 'sdk' : tag.id}
        </span>
        <code className="text-[13px] font-semibold text-polyform-dark-blue break-all">{method.signature}</code>
        <span className="ml-auto hidden sm:block text-sm text-gray-500 text-right shrink-0 max-w-[40%] truncate">{method.description}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 flex flex-col gap-3 text-sm">
          <p className="text-gray-600 sm:hidden">{method.description}</p>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Signature</span>
            <code className="block bg-slate-950 text-[#E2E8F0] text-[13px] font-mono px-3 py-2 rounded-md overflow-x-auto">{method.signature}</code>
          </div>
          <div className="flex gap-6">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Returns</span>
              <code className="text-[13px] font-mono text-polyform-dark-blue">{method.returns}</code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SdkDocs({ go }: { go: (p: Page, anchor?: string) => void }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => SDK_REFERENCE
      .map(tag => ({ ...tag, methods: tag.methods.filter(method => matches(query, tag, method)) }))
      .filter(tag => tag.methods.length > 0),
    [query],
  );

  return (
    <>
      <section className="pt-24 pb-16 px-6 border-b border-gray-100">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-5">
          <button
            type="button"
            onClick={() => go('developers')}
            className="self-start inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-polyform-blue transition-colors"
          >
            <ArrowLeft size={15} /> Back to Developers
          </button>
          <Eyebrow>Full SDK reference</Eyebrow>
          <h1 className="text-[clamp(36px,5vw,56px)] font-bold leading-[1.05] tracking-[-0.03em] text-polyform-dark-blue max-w-[900px]">
            The complete <code className="text-[0.85em] font-mono">sdk</code> object
          </h1>
          <p className="text-lg leading-[1.6] text-gray-600 max-w-[680px]">
            Every method in the Developer Console&rsquo;s <code className="font-mono text-[0.9em]">sdk</code> object, grouped by
            subsystem, with its full signature and return type &mdash; {SDK_METHOD_COUNT} methods across {SDK_REFERENCE.length} groups.
          </p>
          <div className="relative max-w-md mt-2">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter methods (e.g. roof, terrain, camera)"
              className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-gray-200 bg-gray-light focus:outline-none focus:ring-2 focus:ring-polyform-blue focus:border-transparent"
            />
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="max-w-[1200px] mx-auto flex gap-12 items-start">
          <aside className="hidden lg:flex sticky top-[88px] w-[200px] flex-none flex-col gap-0.5">
            <span className="text-[11px] font-bold tracking-[0.12em] text-gray-400 px-3 pb-2.5">GROUPS</span>
            {SDK_REFERENCE.map(tag => {
              const color = TAG_COLORS[tag.id] ?? TAG_COLORS.core;
              return (
                <a
                  key={tag.id}
                  href={`#sdk-${tag.id}`}
                  className="flex items-center gap-2 text-sm font-medium text-gray-600 px-3 py-[7px] rounded-md hover:bg-gray-50 hover:text-polyform-blue transition-colors"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
                  {tag.id === 'core' ? 'sdk' : tag.id}
                  <span className="ml-auto text-xs text-gray-400">{tag.methods.length}</span>
                </a>
              );
            })}
          </aside>

          <div className="flex-1 min-w-0 flex flex-col gap-12">
            {filtered.length === 0 && (
              <p className="text-gray-500">No methods match &ldquo;{query}&rdquo;.</p>
            )}
            {filtered.map(tag => (
              <div key={tag.id} id={`sdk-${tag.id}`} className="flex flex-col gap-3 scroll-mt-[88px]">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h2 className="text-xl font-bold text-polyform-dark-blue font-mono">{tag.id === 'core' ? 'sdk' : `sdk.${tag.id}`}</h2>
                  <span className="text-sm text-gray-500">{tag.description}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {tag.methods.map(method => (
                    <MethodRow key={method.name} tag={tag} method={method} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
