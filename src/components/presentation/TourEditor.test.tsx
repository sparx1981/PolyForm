// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TourEditor } from './ContentEditor';

const app = vi.hoisted(() => ({ tour: [] as { id: string; title: string; position: [number, number, number]; target: [number, number, number] }[] }));
vi.mock('../../AppContext', () => ({ useApp: () => ({ presentationContent: { labels: [], tour: app.tour }, setPresentationContent: () => {} }) }));
vi.mock('../../lib/presentation/camera', () => ({ currentView: () => null, flyTo: () => Promise.resolve(), pickMode: { active: false }, pickPoint: () => null }));
vi.mock('./PresentationPanel', () => ({ Popover: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));

afterEach(() => { cleanup(); app.tour = []; });

describe('Guided tour editor', () => {
  it('has a Play tour button that is off until there is a stop to play', () => {
    const onPlay = vi.fn();
    render(<TourEditor onPlay={onPlay} />);
    const play = screen.getByRole('button', { name: /play tour/i }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    fireEvent.click(play);
    expect(onPlay).not.toHaveBeenCalled();
  });
  it('plays the tour when there are stops', () => {
    app.tour = [{ id: 'a', title: 'Front', position: [0, 2, 8], target: [0, 1, 0] }, { id: 'b', title: 'Garden', position: [6, 2, 2], target: [0, 1, 0] }];
    const onPlay = vi.fn();
    render(<TourEditor onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('button', { name: /play tour/i }));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
