import { useEffect, useState } from 'react';
import { presentation, usePresentation } from '../../lib/presentation/store';
import { useApp } from '../../AppContext';
import { glassDimensions } from '../../lib/presentation/glass';

/**
 * An invisible handle over the glass lens so it can be dragged (or moved with the arrow keys). Not shown while the
 * lens follows the cursor: the pointer is the lens then, and everything under it stays clickable.
 */
export default function LoupeHandle() {
    const s = usePresentation();
    const [rect, setRect] = useState<DOMRect | null>(null);
    useEffect(() => {
        const canvas = document.querySelector('#polyform-viewport canvas');
        if (!canvas)
            return;
        const update = () => setRect(canvas.getBoundingClientRect());
        const observer = new ResizeObserver(update);
        observer.observe(canvas);
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => { observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
    }, []);
    if (!rect || s.loupeFollow)
        return null;
    const dims = glassDimensions(s, Math.min(s.loupeRadius, rect.width * .35, rect.height * .35), { width: rect.width, height: rect.height });
    const move = (x: number, y: number) => presentation.set({ loupePosition: [Math.max(0, Math.min(1, (x - rect.left) / rect.width)), Math.max(0, Math.min(1, (y - rect.top) / rect.height))] });
    const release = (e: React.PointerEvent<HTMLDivElement>) => {
        presentation.set({ loupePressed: false });
        if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
    };
    return <div role="slider" aria-label="Glass position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.loupePosition[0] * 100)} aria-valuetext="Drag to move the glass; arrow keys move it too" tabIndex={0}
        className="fixed z-[78] cursor-grab active:cursor-grabbing touch-none outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        style={{ left: rect.left + s.loupePosition[0] * rect.width - dims.hx, top: rect.top + s.loupePosition[1] * rect.height - dims.hy, width: dims.hx * 2, height: dims.hy * 2, borderRadius: dims.corner }}
        onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); presentation.set({ loupePressed: true }); }}
        onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.stopPropagation();
            move(e.clientX, e.clientY);
        } }}
        onPointerUp={release} onPointerCancel={release}
        onKeyDown={e => {
            const d: Record<string, [number, number]> = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] };
            if (d[e.key]) {
                e.preventDefault();
                e.stopPropagation();
                move(rect.left + (s.loupePosition[0] + d[e.key]![0]) * rect.width, rect.top + (s.loupePosition[1] + d[e.key]![1]) * rect.height);
            }
        }}/>;
}

/** The Camera toolbar's Glass tool: the same draggable handle, shown while that tool is active outside Presentation mode. */
export function GlassToolHandle() {
    const { activeTool } = useApp();
    const presenting = usePresentation().active;
    return activeTool === 'glass' && !presenting ? <LoupeHandle /> : null;
}
