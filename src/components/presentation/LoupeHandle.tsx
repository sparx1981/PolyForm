import { useEffect, useState } from 'react';
import { presentation, usePresentation } from '../../lib/presentation/store';
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
    if (!rect)
        return null;
    const radius = Math.min(s.loupeRadius, rect.width * .35, rect.height * .35);
    const move = (x: number, y: number) => presentation.set({ loupePosition: [Math.max(0, Math.min(1, (x - rect.left) / rect.width)), Math.max(0, Math.min(1, (y - rect.top) / rect.height))] });
    return <div role="slider" aria-label="Detail loupe position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.loupePosition[0] * 100)} aria-valuetext="Drag to inspect a detail; arrow keys move the lens" tabIndex={0} className="fixed z-[78] rounded-full cursor-grab active:cursor-grabbing touch-none outline-none focus:ring-2 focus:ring-sky-400" style={{ left: rect.left + s.loupePosition[0] * rect.width - radius, top: rect.top + s.loupePosition[1] * rect.height - radius, width: radius * 2, height: radius * 2, boxShadow: '0 8px 20px #0004, 0 0 0 1px #fff8' }} onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.stopPropagation();
        move(e.clientX, e.clientY);
    } }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId); }} onKeyDown={e => { const d: Record<string, [
        number,
        number
    ]> = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] }; if (d[e.key]) {
        e.preventDefault();
        e.stopPropagation();
        move(rect.left + (s.loupePosition[0] + d[e.key][0]) * rect.width, rect.top + (s.loupePosition[1] + d[e.key][1]) * rect.height);
    } }}/>;
}
