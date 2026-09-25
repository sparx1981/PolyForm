const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const shell = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #f4f6f8; --card: #fff; --text: #1f2933; --muted: #5f6b76; --accent: #0063a3; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111418; --card: #1b2026; --text: #e6e9ec; --muted: #9aa5b1; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  main { background: var(--card); border-radius: 14px; padding: 32px 28px; max-width: 380px; width: calc(100% - 32px); box-shadow: 0 8px 30px rgba(0,0,0,.08); text-align: center; }
  h1 { font-size: 22px; margin: 0 0 8px; } p { color: var(--muted); margin: 0 0 20px; }
  button { width: 100%; padding: 12px; border-radius: 10px; border: 0; background: var(--accent); color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; } #status { margin-top: 14px; min-height: 1.5em; font-size: 14px; }
</style></head><body>${body}</body></html>`;

export function loginPage(clientName: string, pending: string, firebaseConfig: object) {
  return shell('Sign in to PolyForm', `
<main id="login" data-pending="${escape(pending)}" data-firebase="${escape(JSON.stringify(firebaseConfig))}">
  <h1>PolyForm</h1>
  <p>${escape(clientName)} wants to read and edit your PolyForm models. Sign in with the Google account you use for PolyForm.</p>
  <button id="google">Continue with Google</button>
  <div id="status" role="status"></div>
</main>
<script src="/login.js"></script>`);
}

export function errorPage(message: string) {
  return shell('PolyForm sign-in', `<main><h1>PolyForm</h1><p>${escape(message)}</p></main>`);
}

export function homePage(base: string) {
  return shell('PolyForm connector', `<main><h1>PolyForm connector</h1>
<p>Add this address to Claude as a custom connector:</p><p><code>${escape(base)}/mcp</code></p></main>`);
}
