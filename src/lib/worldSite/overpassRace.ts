/**
 * PolyForm — World View: asking OpenStreetMap's Overpass servers without waiting on a busy one.
 *
 * The public servers are often slow or overloaded. Asking them one after another means a hung
 * server eats the whole time allowed, so instead the first is asked at once and each next one a
 * couple of seconds later while there's still no answer; the first real answer wins and the rest
 * are cancelled. If they all refuse, they're asked again after a short pause while time remains.
 * Used by the app's relay (api/overpass), the browser and the Claude connector.
 */

/** Public Overpass servers, in the order they're asked. */
export const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export interface OverpassRaceOptions {
  servers?: string[];
  /** Milliseconds before asking the next server. */
  stagger?: number;
  /** Milliseconds before giving up altogether. */
  deadline?: number;
  /**
   * Milliseconds to wait, when every server has said no, before asking them all again (while
   * the deadline allows). Busy servers usually refuse at once, and a few seconds later one has room.
   */
  retryPause?: number;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export class OverpassError extends Error {
  constructor(public details: string[]) {
    super(`the OpenStreetMap servers are busy or unreachable (${details.join('; ')})`);
  }
}

/** Whether text is an Overpass JSON answer (a busy server sends an HTML or XML error page). */
export function isOverpassAnswer(text: string): boolean {
  return text.trimStart().startsWith('{') && text.includes('"elements"');
}

/** The raw JSON text of the first server to answer `query` properly. */
export function raceOverpass(query: string, opts: OverpassRaceOptions = {}): Promise<string> {
  const servers = opts.servers ?? OVERPASS_SERVERS;
  const stagger = opts.stagger ?? 2000;
  const deadline = opts.deadline ?? 20000;
  const retryPause = opts.retryPause ?? 3000;
  const start = Date.now();
  const doFetch = opts.fetch ?? fetch;
  const controllers: AbortController[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const errors: string[] = [];
  let settled = false;

  return new Promise<string>((resolve, reject) => {
    const finish = (ok: boolean, value: string | Error) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      controllers.forEach(c => c.abort());
      ok ? resolve(value as string) : reject(value);
    };
    const round = (delay: number) => {
      let finished = 0;
      const failed = (host: string, why: string) => {
        errors.push(`${host}: ${why}`);
        if (++finished < servers.length || settled) return;
        // All said no. Ask again after a pause if there's time for a server to answer.
        if (Date.now() - start + retryPause + 2 * stagger < deadline) round(retryPause);
        else finish(false, new OverpassError(errors));
      };
      servers.forEach((server, i) => {
        const host = new URL(server).host;
        timers.push(setTimeout(async () => {
          if (settled) return;
          const ctrl = new AbortController();
          controllers.push(ctrl);
          try {
            const res = await doFetch(`${server}?data=${encodeURIComponent(query)}`, { headers: opts.headers, signal: ctrl.signal });
            const text = await res.text();
            if (res.ok && isOverpassAnswer(text)) finish(true, text);
            else failed(host, `HTTP ${res.status}`);
          } catch (err) {
            if (!settled) failed(host, err instanceof Error ? err.message : String(err));
          }
        }, delay + i * stagger));
      });
    };
    round(0);
    timers.push(setTimeout(() => finish(false, new OverpassError(errors.length ? errors : ['no answer in time'])), deadline));
  });
}
