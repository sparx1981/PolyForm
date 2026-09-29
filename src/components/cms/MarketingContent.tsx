import React, { useEffect, useState } from 'react';
import { CmsProvider } from './context';
import { watchPublished } from './service';
import type { SiteContent } from './model';

export default function MarketingContent({ children }: { children: React.ReactNode }) {
  const [content, setContent] = useState<SiteContent | null>(null);
  useEffect(() => watchPublished(revision => setContent(revision?.content ?? null), error => console.warn('CMS content unavailable; retaining last good marketing content.', error.message)), []);
  return <CmsProvider value={content}>{children}</CmsProvider>;
}
