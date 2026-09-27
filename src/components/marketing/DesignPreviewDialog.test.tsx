// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import DesignPreviewDialog from './DesignPreviewDialog';

function postFromFrame(data: unknown) {
  const frame = document.querySelector('iframe')!;
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: frame.contentWindow }));
  });
}

describe('DesignPreviewDialog', () => {
  afterEach(cleanup);

  it('embeds the read-only render page for the design', () => {
    render(<DesignPreviewDialog model={{ id: 'abc 1', name: 'House' }} onOpen={() => {}} onClose={() => {}} />);
    expect(document.querySelector('iframe')!.getAttribute('src')).toBe('/?render=1&preview=abc%201');
    expect(screen.getByText(/Loading 3D preview/)).toBeTruthy();
  });

  it('hides the loading cover once the preview says it is ready', () => {
    render(<DesignPreviewDialog model={{ id: 'm', name: 'House' }} onOpen={() => {}} onClose={() => {}} />);
    postFromFrame({ type: 'polyform-preview', status: 'ready' });
    expect(screen.queryByText(/Loading 3D preview/)).toBeNull();
  });

  it('shows why the preview failed', () => {
    render(<DesignPreviewDialog model={{ id: 'm' }} onOpen={() => {}} onClose={() => {}} />);
    postFromFrame({ type: 'polyform-preview', status: 'error', message: 'This design could not be found.' });
    expect(screen.getByText(/This design could not be found/)).toBeTruthy();
  });

  it('ignores messages that do not come from its own frame', () => {
    render(<DesignPreviewDialog model={{ id: 'm' }} onOpen={() => {}} onClose={() => {}} />);
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'polyform-preview', status: 'ready' }, origin: window.location.origin, source: window }));
    });
    expect(screen.getByText(/Loading 3D preview/)).toBeTruthy();
  });

  it('does not try to load designs kept in Drive or Trimble Connect', () => {
    render(<DesignPreviewDialog model={{ id: 'm', storage: { provider: 'google-drive' } }} onOpen={() => {}} onClose={() => {}} />);
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByText(/kept in your own cloud storage/)).toBeTruthy();
  });

  it('opens the design, and closes on Escape or the close button', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<DesignPreviewDialog model={{ id: 'm' }} onOpen={onOpen} onClose={onClose} />);
    fireEvent.click(screen.getByText('Open in PolyForm'));
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByLabelText('Close preview'));
    // Escape pressed while the 3D view has the keyboard focus.
    postFromFrame({ type: 'polyform-preview', status: 'escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
