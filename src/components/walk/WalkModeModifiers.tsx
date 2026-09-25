import { PersonStanding } from 'lucide-react';
import { useApp } from '../../AppContext';
import { MOVEMENT_SPEED_RANGE, MOUSE_SENSITIVITY_RANGE } from '../../lib/walkMode/constants';

/** Tool Modifier palette section for Walk Mode (spec §5.6): Movement Speed and Mouse Sensitivity. */
export function WalkModeModifiers() {
  const { walkMovementSpeed, setWalkMovementSpeed, walkMouseSensitivity, setWalkMouseSensitivity } = useApp();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-medium">
        <PersonStanding size={12} className="text-polyform-blue" />
        <span>Walking Settings</span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-gray-500 font-bold uppercase tracking-wider">
          <span>Movement Speed</span>
          <span className="font-mono text-polyform-blue">{walkMovementSpeed.toFixed(1)} m/s</span>
        </div>
        <input
          type="range"
          min={MOVEMENT_SPEED_RANGE.min}
          max={MOVEMENT_SPEED_RANGE.max}
          step={MOVEMENT_SPEED_RANGE.step}
          value={walkMovementSpeed}
          onChange={(e) => setWalkMovementSpeed(parseFloat(e.target.value))}
          className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-polyform-blue"
          title="How fast you walk"
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-gray-500 font-bold uppercase tracking-wider">
          <span>Mouse Sensitivity</span>
          <span className="font-mono text-polyform-blue">{walkMouseSensitivity.toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min={MOUSE_SENSITIVITY_RANGE.min}
          max={MOUSE_SENSITIVITY_RANGE.max}
          step={MOUSE_SENSITIVITY_RANGE.step}
          value={walkMouseSensitivity}
          onChange={(e) => setWalkMouseSensitivity(parseFloat(e.target.value))}
          className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-polyform-blue"
          title="How fast the camera turns with mouse movement"
        />
      </div>

      <p className="text-[9px] text-gray-400 italic">Click a spot on the model to start walking, then move with WASD and look with the mouse. Esc exits.</p>
    </div>
  );
}
