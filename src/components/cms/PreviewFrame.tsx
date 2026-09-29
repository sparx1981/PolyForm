import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** A real viewport isolates editor CSS and exercises the site's responsive breakpoints. */
export default function PreviewFrame({ children, mobile }: { children: React.ReactNode; mobile: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const prepare = () => {
    const doc = frame.current?.contentDocument;
    if (!doc || doc.body.dataset.ready) return;
    doc.body.dataset.ready = 'true';
    doc.documentElement.lang = 'en';
    for (const node of document.head.querySelectorAll('style,link[rel="stylesheet"]')) doc.head.appendChild(node.cloneNode(true));
    doc.body.style.margin = '0';
    doc.body.style.background = 'white';
    setTarget(doc.body);
  };
  useEffect(prepare, []);
  return <iframe ref={frame} onLoad={prepare} title={mobile ? 'Mobile draft preview' : 'Desktop draft preview'} className="cms-preview" style={{ display:'block', width: mobile ? 390 : '100%', maxWidth:'100%', height:'75vh' }}>{target && createPortal(<div onClickCapture={e => { if ((e.target as HTMLElement).closest('a')) e.preventDefault(); }}>{children}</div>, target)}</iframe>;
}
