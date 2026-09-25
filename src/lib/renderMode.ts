/**
 * Render mode (`?render=1`): the page the PolyForm connector's headless browser opens to take a
 * screenshot. It shows only the 3D view and never saves anything back.
 */
export const RENDER_MODE = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('render') === '1';
