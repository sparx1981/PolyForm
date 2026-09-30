import { RUNNER_CORE, type PlaygroundResult } from './runnerCore';

export const RUN_TIMEOUT_MS = 5000;

/**
 * The page inside the sandboxed iframe. It has an opaque origin (no cookies, storage or sign-in) and a
 * CSP with no network access; the visitor's code runs in a worker inside it, so a runaway loop only
 * costs the worker. The parent gives up after RUN_TIMEOUT_MS and throws the whole iframe away.
 */
export function sandboxDocument(): string {
  const bootstrap = `
var CORE = ${JSON.stringify(RUNNER_CORE + '\nself.onmessage = async function (e) { self.postMessage(await run(e.data)); };')};
function fail(id, message) { parent.postMessage({ polyformPlayground: true, id: id, result: { ok: false, error: message, logs: [], objects: [] } }, '*'); }
window.addEventListener('message', function (e) {
  if (e.source !== parent || !e.data || e.data.type !== 'run') return;
  var id = e.data.id;
  try {
    var url = URL.createObjectURL(new Blob([CORE], { type: 'text/javascript' }));
    var worker = new Worker(url);
    worker.onmessage = function (m) { parent.postMessage({ polyformPlayground: true, id: id, result: m.data }, '*'); worker.terminate(); };
    worker.onerror = function (er) { fail(id, er.message || 'The script could not run.'); worker.terminate(); };
    worker.postMessage(e.data.code);
  } catch (err) { fail(id, String(err && err.message || err)); }
});
parent.postMessage({ polyformPlayground: true, ready: true }, '*');`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:"></head><body><script>${bootstrap.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

let nextId = 0;

/** Runs a snippet against the preview sdk in a throwaway sandboxed iframe. */
export function runSandboxed(code: string, timeoutMs = RUN_TIMEOUT_MS): Promise<PlaygroundResult> {
  return new Promise(resolve => {
    const id = ++nextId;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    let done = false;
    const finish = (result: PlaygroundResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `The script ran for more than ${timeoutMs / 1000} seconds and was stopped. Check for a loop that never ends.`, logs: [], objects: [] }), timeoutMs);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || !e.data || e.data.polyformPlayground !== true) return;
      if (e.data.ready) frame.contentWindow?.postMessage({ type: 'run', id, code }, '*');
      else if (e.data.id === id) finish(e.data.result as PlaygroundResult);
    };
    window.addEventListener('message', onMessage);
    frame.srcdoc = sandboxDocument();
    document.body.appendChild(frame);
  });
}
