import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import type { Graph } from '../lib/geometry';
import { formatValue } from '../lib/utils';
import {
  areaLabelText, dimensionGeometry, measureFace, resolveAreaFace,
  type AreaLabelArgs, type DimensionArgs, type LeaderArgs,
} from '../tools/annotations';

type Unit = 'mm' | 'cm' | 'm';
const DIM_COLOR = '#0284c7';

interface MarkProps { selected: boolean; onSelect?: () => void; color?: string }

const chip = (selected: boolean, border: string) =>
  `text-white text-xs font-medium px-2 py-1 rounded whitespace-nowrap shadow-lg border select-none ${selected ? 'bg-polyform-blue border-white' : `bg-black/80 ${border}`}`;

/** A placed dimension: a line pushed out from the measured one, extension lines and end ticks. */
export function DimensionMark({ args, unit, selected, onSelect, color }: MarkProps & { args: DimensionArgs; unit: Unit }) {
  const g = useMemo(() => dimensionGeometry(args), [args]);
  const line = selected ? '#FFFFFF' : (color || DIM_COLOR);
  const pick = onSelect ? (e: { stopPropagation: () => void }) => { e.stopPropagation(); onSelect(); } : undefined;
  return (
    <group>
      <Line points={[g.a, g.b]} color={line} lineWidth={selected ? 2.5 : 1.5} onClick={pick} />
      {g.extensions.map((pts, i) => <Line key={`e${i}`} points={pts} color={line} lineWidth={1} raycast={() => null} />)}
      {g.ticks.map((pts, i) => <Line key={`t${i}`} points={pts} color={line} lineWidth={2} raycast={() => null} />)}
      <Html position={g.mid} center occlude={false}>
        <div onClick={onSelect} className={`${chip(selected, 'border-sky-500/60 hover:border-sky-400')} ${onSelect ? 'cursor-pointer' : 'pointer-events-none'}`}>
          {args.text ?? formatValue(args.distance, unit, 2)}
        </div>
      </Html>
    </group>
  );
}

/** Text placed away from what it describes, joined by a line that ends in a dot. */
export function LeaderMark({ args, selected, onSelect, color }: MarkProps & { args: LeaderArgs }) {
  const line = selected ? '#FFFFFF' : (color || '#f59e0b');
  return (
    <group>
      <Line points={[args.target, args.anchor]} color={line} lineWidth={selected ? 2.5 : 1.5} raycast={() => null} />
      <mesh position={args.target} raycast={() => null} renderOrder={19}>
        <sphereGeometry args={[0.035, 12, 12]} />
        <meshBasicMaterial color={line} depthTest={false} />
      </mesh>
      <Html position={args.anchor} center occlude={false}>
        <div onClick={onSelect} className={`${chip(selected, 'border-amber-500/60 hover:border-amber-400')} ${onSelect ? 'cursor-pointer' : 'pointer-events-none'}`}>
          {args.text}
        </div>
      </Html>
    </group>
  );
}

/** A face's area and perimeter, read every time it draws so it follows the face. */
export function AreaMark({ args, graph, unit, selected, onSelect }: MarkProps & { args: AreaLabelArgs; graph: Graph; unit: Unit }) {
  const measured = (() => {
    const id = resolveAreaFace(graph, args);
    return id === null ? null : measureFace(graph, id);
  })();
  const area = measured?.area ?? args.area;
  const perimeter = measured?.perimeter ?? args.perimeter;
  const text = areaLabelText(area, perimeter, unit, m => formatValue(m, unit, 2));
  return (
    <Html position={args.position} center occlude={false}>
      <div onClick={onSelect} title={measured ? undefined : 'Face not found - showing the last reading'}
        className={`${chip(selected, 'border-emerald-500/60 hover:border-emerald-400')} ${onSelect ? 'cursor-pointer' : 'pointer-events-none'} ${measured ? '' : 'opacity-60'}`}>
        {text}
      </div>
    </Html>
  );
}
