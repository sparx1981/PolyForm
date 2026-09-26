import React, { useCallback, useEffect, useState } from 'react';

export type Page = 'home' | 'features' | 'claude' | 'developers' | 'sdk-docs';

export const PATHS: Record<Page, string> = {
  home: '/',
  features: '/features',
  claude: '/build-with-claude',
  developers: '/developers',
  'sdk-docs': '/developers/sdk',
};

function pageFromPath(pathname: string): Page {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/features') return 'features';
  if (path === '/build-with-claude') return 'claude';
  if (path === '/developers/sdk') return 'sdk-docs';
  if (path === '/developers') return 'developers';
  return 'home';
}

const MARKETING_PATHS = new Set(Object.values(PATHS));

/** True for any path this signed-out marketing site owns (used by App.tsx to render Landing before auth resolves). */
export function isMarketingPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return MARKETING_PATHS.has(path);
}

/** Real History API router for the signed-out marketing site: normal URLs, back/forward, and a shared hash-anchor scroll. */
export function useMarketingRouter() {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // A direct load of e.g. /features#architecture: scroll to the anchor once the page has painted.
  useEffect(() => {
    if (window.location.hash) {
      const id = window.location.hash.slice(1);
      requestAnimationFrame(() => scrollToId(id));
    }
  }, []);

  const go = useCallback((next: Page, anchor?: string) => {
    const url = PATHS[next] + (anchor ? `#${anchor}` : '');
    window.history.pushState({}, '', url);
    setPage(next);
    if (anchor) {
      requestAnimationFrame(() => scrollToId(anchor));
    } else {
      window.scrollTo(0, 0);
    }
  }, []);

  return { page, go };
}

export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;

  const landingScroller = document.getElementById('landing-page');
  if (landingScroller) {
    const scrollerRect = landingScroller.getBoundingClientRect();
    const targetTop = el.getBoundingClientRect().top - scrollerRect.top + landingScroller.scrollTop - 88;
    landingScroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    return;
  }

  const top = el.getBoundingClientRect().top + window.scrollY - 88;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

/** Builds a real href for a marketing destination, for use in <a> tags (go() still does the client-side navigation on click). */
export function hrefFor(next: Page, anchor?: string): string {
  return PATHS[next] + (anchor ? `#${anchor}` : '');
}

interface RouterLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> {
  to: Page;
  anchor?: string;
  go: (p: Page, anchor?: string) => void;
  children: React.ReactNode;
}

/**
 * A real <a href> that navigates client-side on a plain left click (so back/forward, middle-click,
 * ctrl/cmd-click and "open in new tab" all keep working natively), and falls back to a normal
 * browser navigation for anything else - crawlers, keyboard users opening in a new tab, no-JS.
 */
export function RouterLink({ to, anchor, go, children, ...rest }: RouterLinkProps) {
  return (
    <a
      href={hrefFor(to, anchor)}
      onClick={e => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(to, anchor);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
