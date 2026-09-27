/**
 * Render mode (`?render=1`): the page the PolyForm connector's headless browser opens to take a
 * screenshot. It shows only the 3D view and never saves anything back.
 */
export const RENDER_MODE = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('render') === '1';

/**
 * The client presentation page (`/p/<shareId>`): a read-only look at a shared design. Like render
 * mode, it must never save anything - not the model, and not the visitor's own settings.
 */
export const CLIENT_PAGE = typeof window !== 'undefined'
  && /^\/p\/[0-9A-Za-z]{20,40}\/?$/.test(window.location.pathname);
