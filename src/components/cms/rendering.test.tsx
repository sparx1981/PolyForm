// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import baseline from '../../../docs/cms/baseline.json';
import Home from '../marketing/Home';
import Features from '../marketing/Features';
import BuildWithClaude from '../marketing/BuildWithClaude';
import Developers from '../marketing/Developers';
import SdkDocs from '../marketing/SdkDocs';
import { SDK_METHOD_COUNT, SDK_REFERENCE } from '../marketing/sdkFullReference';
import { Header, Footer, ClosingCTA } from '../marketing/shared';
import { CmsProvider } from './context';
import { copyKey, defaultContent, newSection } from './model';
import { CmsLayout } from './Sections';
const props={go:vi.fn(),onLogin:vi.fn(),user:null,onOpenDesigns:vi.fn(),onSignOut:vi.fn(),page:'home' as const};
afterEach(cleanup);
describe('marketing preservation and CMS rendering',()=>{
  const normalise=(s:string)=>s.replace(/© \d{4}/g,'© YEAR');
  [Home,Features,BuildWithClaude,Developers,Header,Footer,ClosingCTA].forEach((Component,index)=> {
    const baselineIndex = index < 4 ? index : index + 1;
    it(`preserves original ${Component.name} DOM and copy with empty CMS`,()=>{expect(normalise(renderToStaticMarkup(<CmsProvider value={defaultContent()}><Component {...props}/></CmsProvider>))).toBe(normalise(baseline[baselineIndex]));});
  });
  it('renders the generated SDK reference without relying on a frozen API baseline',()=>{
    const html=renderToStaticMarkup(<CmsProvider value={defaultContent()}><SdkDocs {...props}/></CmsProvider>);
    expect(html).toContain(`${SDK_METHOD_COUNT} methods across ${SDK_REFERENCE.length} groups`);
    for(const group of SDK_REFERENCE) expect(html).toContain(`value="${group.id}"`);
  });
  it('renders saved text without interpreting HTML and updates SDK descriptions',()=>{const c=defaultContent();c.copy[copyKey('Then step inside.')]='<script>not code</script>';const html=renderToStaticMarkup(<CmsProvider value={c}><Home {...props}/></CmsProvider>);expect(html).toContain('&lt;script&gt;not code&lt;/script&gt;');expect(html).not.toContain('<script>not code');c.copy[copyKey('Create a box.')]='Administrator documentation';expect(renderToStaticMarkup(<CmsProvider value={c}><SdkDocs {...props}/></CmsProvider>)).toContain('Administrator documentation');});
  it('reorders and hides native sections and renders new sections',()=>{const c=defaultContent(),page=c.pages[0];page.sections=[{...page.sections[1]}, {...page.sections[0],hidden:true},{...newSection('text'),heading:'New section',body:'Editable body'}];const html=renderToStaticMarkup(<CmsProvider value={c}><CmsLayout page="home"><section>Hero</section><section>Second</section></CmsLayout></CmsProvider>);expect(html).toContain('Second');expect(html).not.toContain('Hero');expect(html).toContain('Editable body');});
  it('keeps CMS entry invisible to ordinary and unverified users',()=>{for(const user of [null,{email:'other@example.com',emailVerified:true},{email:'craigtrickett@gmail.com',emailVerified:false}]){const {unmount}=render(<Header {...props} user={user as never}/>);const menu=screen.queryByLabelText('Account menu');if(menu)fireEvent.click(menu);expect(screen.queryByText('Content management')).toBeNull();unmount();}});
  it('opens CMS only through the verified administrator profile menu',()=>{const open=vi.fn();window.addEventListener('polyform:open-cms',open);render(<Header {...props} user={{email:'craigtrickett@gmail.com',emailVerified:true} as never}/>);fireEvent.click(screen.getByLabelText('Account menu'));fireEvent.click(screen.getByText('Content management'));expect(open).toHaveBeenCalledOnce();window.removeEventListener('polyform:open-cms',open);});
});

