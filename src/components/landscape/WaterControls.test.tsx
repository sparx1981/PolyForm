// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { WaterControls } from './WaterControls';
import type { Shape } from '../../types';
const mock = vi.hoisted(() => ({ app: {} as any }));
vi.mock('../../AppContext', () => ({ useApp: () => mock.app }));
const pond = (id: string, level: number): Shape => ({ id, type: 'water', args: [], name: id, position: [0, level, 0], color: '#abc', waterData: { points: [[0,0],[5,0],[5,5]], depth: 1, clarity: 'lake', dig: true } });
function Harness() {
  const [shapes, setShapes] = useState([pond('a', 0), pond('b', 10)]);
  const [selectedId, select] = useState('a');
  mock.app = { shapes, setShapes, selectedId, waterToolSettings: { depth: 1, clarity: 'lake' }, setWaterToolSettings: vi.fn() };
  return <><WaterControls /><button onClick={() => select('b')}>Other pond</button></>;
}
describe('water controls', () => {
  it('keeps range endpoints fixed through successive drag updates and resets for another pond', () => {
    const view = render(<Harness />);
    const range = view.getByLabelText('Water level') as HTMLInputElement;
    fireEvent.change(range, { target: { value: '1' } });
    fireEvent.change(range, { target: { value: '1.5' } });
    expect(range.min).toBe('-2'); expect(range.max).toBe('2'); expect(range.value).toBe('1.5');
    expect(mock.app.shapes[0].position[1]).toBe(1.5);
    fireEvent.click(view.getByText('Other pond'));
    expect(range.min).toBe('8'); expect(range.max).toBe('12'); expect(range.value).toBe('10');
    cleanup();
  });
  it('stores motion settings on the selected pond', () => {
    const view = render(<Harness />);
    fireEvent.click(view.getByText('Gentle drift'));
    expect(mock.app.shapes[0].waterData.flow).toMatchObject({ mode: 'stream', speed: 0.12 });
    fireEvent.click(view.getByText('←'));
    expect(mock.app.shapes[0].waterData.flow.direction).toEqual([-1, 0]);
    expect(mock.app.shapes[1].waterData.flow).toBeUndefined();
    fireEvent.click(view.getByText('Pond / still'));
    expect(mock.app.shapes[0].waterData.flow.mode).toBe('still');
    cleanup();
  });
});
