import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Developers from './Developers';
import { CmsProvider } from '../cms/context';
import { COPY, NATIVE, copyKey, defaultContent, validateContent } from '../cms/model';
import { PLAYGROUND_EXAMPLES, PLAYGROUND_TEXT } from '../../lib/playground/examples';

describe('Developers page playground', () => {
  it('has every playground string in the CMS catalog so editors can change it', () => {
    const values = [...Object.values(PLAYGROUND_TEXT), ...PLAYGROUND_EXAMPLES.flatMap(e => [e.title, e.text, e.code])];
    for (const value of values) expect(COPY[copyKey(value)]?.value, value.slice(0, 40)).toBe(value);
  });

  it('renders on the page without disturbing the CMS section order', () => {
    const content = defaultContent();
    expect(content.pages.find(p => p.id === 'developers')!.sections).toHaveLength(NATIVE.developers!.length);
    validateContent(content);
    const html = renderToStaticMarkup(<CmsProvider value={content}><Developers onLogin={() => {}} go={() => {}} /></CmsProvider>);
    expect(html).toContain('Try it live');
    expect(html).toContain('Room with a roof');
    // The five original sections are still there, in order, with the playground inside the second one.
    const order = ['Script anything', 'Open the console. Run real geometry.', 'Try it live', 'Your drawing can become the documentation.', 'Build the workflow around the model.', 'Start with the '];
    let at = -1;
    for (const marker of order) { const next = html.indexOf(marker); expect(next, marker).toBeGreaterThan(at); at = next; }
  });

  it('shows edited example text and code from the CMS', () => {
    const content = defaultContent();
    const example = PLAYGROUND_EXAMPLES[0]!;
    content.copy[copyKey(example.title)] = 'Renamed example';
    const html = renderToStaticMarkup(<CmsProvider value={content}><Developers onLogin={() => {}} go={() => {}} /></CmsProvider>);
    expect(html).toContain('Renamed example');
  });
});
