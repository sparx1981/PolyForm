import catalog from './catalog.json';
import nativePages from './native-pages.json';

export type SectionKind = 'native' | 'hero' | 'text' | 'image' | 'features' | 'gallery' | 'faq' | 'cta';
export interface Section {
  id: string; kind: SectionKind; label: string; hidden: boolean;
  nativeIndex?: number; heading: string; body: string; image: string; alt: string;
  buttonLabel: string; buttonHref: string; items: { title: string; body: string; image: string; alt: string }[];
}
export interface CmsPage { id: string; path: string; title: string; description: string; hidden: boolean; sections: Section[] }
export interface SiteContent {
  schemaVersion: 1; copy: Record<string, string>; media: Record<string, { url: string; alt: string }>;
  replaceNavigation: boolean;
  pages: CmsPage[]; links: { id: string; label: string; href: string; location: 'header' | 'footer' }[];
}
export interface Revision { revision: number; content: SiteContent; updatedBy: string; updatedAt?: unknown }
export interface Proposal { schemaVersion: 1; title: string; baseRevision: number; changes: { path: string; before: unknown; after: unknown }[] }
export const COPY = catalog as Record<string, { value: string; groups: string[] }>;
export const NATIVE = nativePages as Record<string, string[]>;
export const pagePaths: Record<string, string> = { home: '/', features: '/features', claude: '/build-with-claude', developers: '/developers', 'sdk-docs': '/developers/sdk' };
export const pageNames: Record<string, string> = { home: 'Home', features: 'Product', claude: 'Build with Claude', developers: 'Developers', 'sdk-docs': 'SDK reference' };
export function copyKey(value: string) { let hash = 2166136261; for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return 'c' + (hash >>> 0).toString(16); }
export function newSection(kind: SectionKind, label: string = kind): Section {
  return { id: crypto.randomUUID(), kind, label, hidden: false, heading: '', body: '', image: '', alt: '', buttonLabel: '', buttonHref: '', items: [] };
}
export function defaultContent(): SiteContent {
  return { schemaVersion: 1, copy: {}, media: {}, links: [], replaceNavigation: false, pages: Object.entries(pagePaths).map(([id, path]) => ({ id, path, title: '', description: '', hidden: false, sections: (NATIVE[id] || []).map((label, nativeIndex) => ({ ...newSection('native', label), id: `${id}-${nativeIndex}`, nativeIndex })) })) };
}
export function safeUrl(value: string, image = false): boolean {
  if (!value) return true;
  if (/[\u0000-\u0020\\]/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  if (!image && (value.startsWith('#') || /^mailto:[^@]+@[^@]+$/.test(value))) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}
export function validateContent(value: unknown): asserts value is SiteContent {
  const fail = (message: string): never => { throw new Error(message); };
  if (!value || typeof value !== 'object') fail('Invalid content document.');
  const c = value as SiteContent;
  if (typeof c.replaceNavigation !== 'boolean') fail('Invalid navigation settings.');
  if (c.schemaVersion !== 1 || !Array.isArray(c.pages) || c.pages.length > 100 || !Array.isArray(c.links) || c.links.length > 100 || !c.copy || !c.media) fail('Invalid CMS schema.');
  const string = (s: unknown, max = 20000) => typeof s === 'string' && s.length <= max;
  for (const [key, text] of Object.entries(c.copy)) if (!COPY[key] || !string(text)) fail(`Unknown or invalid copy field: ${key}`);
  for (const [key, text] of Object.entries(c.copy)) if (/^(https?:\/\/|\/[^/])/.test(COPY[key].value) && !safeUrl(text)) fail('Content links must use safe URLs.');
  for (const [key, media] of Object.entries(c.media)) if (!string(key, 200) || !media || !string(media.url, 2000) || !safeUrl(media.url, true) || !string(media.alt, 500) || (media.url && !media.alt.trim())) fail('Images need a safe URL and alternative text.');
  const ids = new Set<string>(), paths = new Set<string>();
  for (const page of c.pages) {
    if (!page || !string(page.id, 80) || !/^[a-z0-9-]+$/.test(page.id) || ids.has(page.id)) fail('Pages need unique IDs.');
    ids.add(page.id);
    if (!string(page.path, 200) || !/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(page.path) || paths.has(page.path) || /^\/(?:app|admin|designs|api|assets)(?:\/|$)/.test(page.path)) fail('Use a unique page path outside reserved application routes.');
    paths.add(page.path);
    if (pagePaths[page.id] && page.path !== pagePaths[page.id]) fail('Existing page addresses must be preserved.');
    if (!string(page.title, 200) || !string(page.description, 500) || typeof page.hidden !== 'boolean' || (page.id === 'home' && page.hidden) || !Array.isArray(page.sections) || page.sections.length > 80) fail('Invalid page settings.');
    const sectionIds = new Set<string>(), nativeIds = new Set<number>();
    for (const s of page.sections) {
      if (!s || !string(s.id, 100) || sectionIds.has(s.id) || !['native','hero','text','image','features','gallery','faq','cta'].includes(s.kind) || typeof s.hidden !== 'boolean') fail('Invalid or duplicate section.');
      sectionIds.add(s.id);
      if (s.kind === 'native') {
        if (!Number.isInteger(s.nativeIndex) || !NATIVE[page.id]?.[s.nativeIndex!] || nativeIds.has(s.nativeIndex!)) fail('Invalid original section.');
        nativeIds.add(s.nativeIndex!);
      }
      for (const key of ['label','heading','body','image','alt','buttonLabel','buttonHref'] as const) if (!string(s[key])) fail(`Invalid section ${key}.`);
      if (!safeUrl(s.image, true) || !safeUrl(s.buttonHref) || (s.image && !s.alt.trim())) fail('Sections need safe links and image alternative text.');
      if (!Array.isArray(s.items) || s.items.length > 40) fail('A section supports up to 40 items.');
      for (const item of s.items) if (!item || !['title','body','image','alt'].every(k => string(item[k])) || !safeUrl(item.image, true) || (item.image && !item.alt.trim())) fail('Invalid section item.');
    }
  }
  for (const id of Object.keys(pagePaths)) if (!ids.has(id)) fail('Existing pages cannot be deleted; hide them instead.');
  for (const link of c.links) if (!link || !string(link.id, 100) || !string(link.label, 100) || !string(link.href, 2000) || !safeUrl(link.href) || !['header','footer'].includes(link.location)) fail('Invalid navigation link.');
  if (new TextEncoder().encode(JSON.stringify(c)).length > 700000) fail('Content exceeds the 700 KB limit.');
}
export function validateProposal(value: unknown): asserts value is Proposal {
  const p = value as Proposal;
  if (!p || p.schemaVersion !== 1 || typeof p.title !== 'string' || p.title.length > 200 || !Number.isInteger(p.baseRevision) || p.baseRevision < 0 || !Array.isArray(p.changes) || !p.changes.length || p.changes.length > 2000) throw new Error('Invalid proposal. Use the exported CMS snapshot and proposal format.');
  const seen = new Set<string>();
  for (const change of p.changes) {
    if (change?.path?.split('/').some(key => ['__proto__','prototype','constructor'].includes(key))) throw new Error('Invalid proposal path.');
    if (!change || typeof change.path !== 'string' || !/^(copy\/c[a-f0-9]+|media\/[^/]{1,200}|pages|links)$/.test(change.path) || seen.has(change.path) || !('before' in change) || !('after' in change)) throw new Error('Invalid or duplicate proposal change.');
    seen.add(change.path);
  }
}
export function proposalValue(content: SiteContent, path: string): unknown {
  const [group, key] = path.split('/');
  return key ? content[group]?.[key] ?? (group === 'copy' ? COPY[key]?.value : null) : content[group];
}
export function applyProposal(content: SiteContent, proposal: Proposal, selected: number[]): SiteContent {
  validateProposal(proposal);
  const next = structuredClone(content);
  for (const index of selected) {
    const change = proposal.changes[index];
    if (!change || JSON.stringify(proposalValue(content, change.path)) !== JSON.stringify(change.before)) throw new Error(`Conflict in ${change?.path ?? 'change'}: the current draft differs from the AI baseline. Your edits were preserved.`);
    const [group, key] = change.path.split('/');
    if (key) { if (change.after === null) delete next[group][key]; else next[group][key] = change.after; }
    else next[group] = change.after;
  }
  validateContent(next);
  return next;
}
