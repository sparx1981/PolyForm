import { useEffect } from 'react';
import type { Page } from './router';

export interface SeoMeta {
  title: string;
  description: string;
  path: string;
}

const SITE_URL = 'https://polyform-alpha.vercel.app';

export const SEO: Record<Page, SeoMeta> = {
  home: {
    title: 'PolyForm — Browser-Based 3D Design for Buildings, Terrain and Landscape',
    description: 'Design buildings, shape terrain and plant the landscape in one browser-based 3D model. Real-world site context, live collaboration and a walkthrough view, with no install.',
    path: '/',
  },
  features: {
    title: 'Features — Modelling, Architecture, Terrain and Visualisation | PolyForm',
    description: 'Everything in PolyForm: modelling tools, architecture, terrain and landscape, site location, light and weather, collaboration, and file storage — all in one browser-based model.',
    path: '/features',
  },
  claude: {
    title: 'Build with Claude — AI-Assisted 3D Design | PolyForm',
    description: 'Connect Claude to PolyForm and describe the building, terrain or landscape change you want in plain language. Review an editable 3D model and floor plans before you continue.',
    path: '/build-with-claude',
  },
  developers: {
    title: 'Developers — JavaScript SDK and Extensibility Suite | PolyForm',
    description: 'Script anything you can draw in PolyForm. A console, a JavaScript SDK, a Code Recorder that turns drawing into code, and custom toolbars for your own workflow.',
    path: '/developers',
  },
  'sdk-docs': {
    title: 'SDK Reference — The Complete sdk Object | PolyForm',
    description: 'Every method in the PolyForm Developer Console’s sdk object, grouped by subsystem, with full signatures and return types.',
    path: '/developers/sdk',
  },
};

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function setJsonLd(id: string, data: object) {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement('script');
    el.id = id;
    el.type = 'application/ld+json';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

/** Sets this route's <title>, meta description, canonical URL and OG/Twitter tags, plus one shared piece of structured data. */
export function usePageSeo(page: Page) {
  useEffect(() => {
    const meta = SEO[page];
    const canonical = `${SITE_URL}${meta.path}`;
    document.title = meta.title;
    setMeta('description', meta.description);
    setLink('canonical', canonical);
    setMeta('og:title', meta.title, 'property');
    setMeta('og:description', meta.description, 'property');
    setMeta('og:url', canonical, 'property');
    setMeta('og:type', 'website', 'property');
    setMeta('twitter:card', 'summary');
    setMeta('twitter:title', meta.title);
    setMeta('twitter:description', meta.description);

    setJsonLd('ld-software-application', {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'PolyForm',
      applicationCategory: 'DesignApplication',
      operatingSystem: 'Web',
      url: SITE_URL,
      description: SEO.home.description,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free to try' },
    });
  }, [page]);
}
