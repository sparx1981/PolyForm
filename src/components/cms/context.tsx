import { createContext, useContext, useMemo } from 'react';
import { COPY, copyKey, safeUrl, type SiteContent } from './model';

export const CmsContext = createContext<SiteContent | null>(null);
export const CmsProvider = CmsContext.Provider;
export function useCms() {
  const content = useContext(CmsContext);
  return useMemo(() => {
    const cache = new WeakMap<object, unknown>();
    const hasCopy = !!content && Object.keys(content.copy).length > 0;
    function text(original: string) { return content?.copy[copyKey(original)] ?? original; }
    function data<T>(input: T): T {
      if (!hasCopy) return input;
      if (typeof input === 'string') return (COPY[copyKey(input)] ? text(input) : input) as T;
      if (input && typeof input === 'object' && cache.has(input)) return cache.get(input) as T;
      if (Array.isArray(input)) { const result = input.map(data); cache.set(input, result); return result as T; }
      if (input && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype && !('$$typeof' in input)) {
        const result = Object.fromEntries(Object.entries(input).map(([k,v]) => [k, ['id','key','page','anchor','sectionIds','icon','calls'].includes(k) ? v : k === 'href' && typeof v === 'string' ? (safeUrl(text(v)) ? text(v) : v) : data(v)]));
        cache.set(input, result); return result as T;
      }
      return input;
    }
    const originals = new Map(Object.entries(content?.copy ?? {}).map(([key, value]) => [value, COPY[key]?.value ?? value]));
    return { content, text, data, original: (value: string) => originals.get(value) ?? value, media: (key: string) => { const item = content?.media[key]; return item && safeUrl(item.url, true) ? item : undefined; }, url: (original: string) => { const next = text(original); return safeUrl(next) ? next : original; } };
  }, [content]);
}
export function CmsLinks({ location }: { location: 'header' | 'footer' }) {
  const { content } = useCms();
  return <>{content?.links.filter(l => l.location === location).map(l => <a key={l.id} href={safeUrl(l.href) ? l.href : '#'} className="text-sm font-semibold text-gray-600 hover:text-polyform-blue">{l.label}</a>)}</>;
}
