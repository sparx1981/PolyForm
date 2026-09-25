import type { Browser } from 'playwright-core';
import type { Caller } from './store';
import type { Renderer, ScreenshotOptions } from './tools';

/**
 * Screenshots through the real PolyForm app: a headless browser opens the app's `?render=1`
 * page, which signs in as you with a one-off token, opens the model read-only, frames it and
 * tells us when it has finished drawing.
 */
export class AppRenderer implements Renderer {
  constructor(
    private appUrl: string,
    private mintToken: (uid: string) => Promise<string>,
    private launch: () => Promise<Browser> = launchChromium,
    private bypassSecret?: string,
  ) {}

  async screenshot(caller: Caller, modelId: string, opts: ScreenshotOptions): Promise<Buffer> {
    const token = await this.mintToken(caller.uid);
    const browser = await this.launch();
    try {
      const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
      const url = new URL(this.appUrl);
      url.searchParams.set('render', '1');
      // A Vercel-hosted app behind Vercel Authentication: the automation bypass lets this browser
      // in, and the cookie it sets covers the app's own scripts and assets that follow.
      if (this.bypassSecret) {
        url.searchParams.set('x-vercel-protection-bypass', this.bypassSecret);
        url.searchParams.set('x-vercel-set-bypass-cookie', 'true');
      }
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForFunction(() => typeof (window as any).__polyformRender === 'function', null, { timeout: 60_000 })
        .catch(() => { throw new Error(`The PolyForm app at ${this.appUrl} has no render mode (deploy the latest app).`); });
      await page.evaluate(job => (window as any).__polyformRender(job), { token, modelId, view: opts.view, focus: opts.focus });
      return await page.screenshot({ type: 'png' });
    } finally {
      await browser.close().catch(() => {});
    }
  }
}

/** Software-WebGL Chromium flags, the same as Vercel's packaged build uses. */
const GPU_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

/** Chromium: Vercel's packaged build, or a local one via CHROME_PATH. */
export async function launchChromium(): Promise<Browser> {
  const { chromium: playwright } = await import('playwright-core');
  const local = process.env.CHROME_PATH;
  if (local) {
    return playwright.launch({
      executablePath: local,
      args: ['--no-sandbox', '--no-zygote', '--single-process', '--in-process-gpu', '--disable-dev-shm-usage', ...GPU_ARGS],
    });
  }
  const chromium = (await import('@sparticuz/chromium')).default;
  return playwright.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args, ...GPU_ARGS].filter(a => !a.startsWith('--headless')),
    headless: true,
  });
}
