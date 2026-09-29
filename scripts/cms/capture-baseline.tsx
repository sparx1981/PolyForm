import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import Home from '../../src/components/marketing/Home';
import Features from '../../src/components/marketing/Features';
import BuildWithClaude from '../../src/components/marketing/BuildWithClaude';
import Developers from '../../src/components/marketing/Developers';
import SdkDocs from '../../src/components/marketing/SdkDocs';
import { Header, Footer, ClosingCTA } from '../../src/components/marketing/shared';
const props = { go: () => {}, onLogin: () => {}, user: null, onOpenDesigns: () => {}, onSignOut: () => {}, page: 'home' as const };
Object.assign(globalThis, { window: { location: { hash: '' }, addEventListener: () => {}, removeEventListener: () => {} } });
// SSR regression fixture: DOM and copy must remain identical before a CMS publish.
const html = [Home, Features, BuildWithClaude, Developers, SdkDocs, Header, Footer, ClosingCTA].map(C => renderToStaticMarkup(<C {...props} />));
writeFileSync(process.argv[2], JSON.stringify(html));

