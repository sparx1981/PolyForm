import type { WaterUniforms } from './waterMaterial';

/** Integrate travel rather than speed * elapsed time, so editing current never jumps its phase. */
export function advanceWaterFlow(uniforms: WaterUniforms, delta: number): void {
  if (uniforms.uFlowSpeed.value <= 0) return;
  const dt = Math.max(0, Math.min(delta, 0.1));
  uniforms.uFlowTime.value += dt;
  uniforms.uFlowOffset.value.addScaledVector(uniforms.uFlowDir.value, uniforms.uFlowSpeed.value * dt);
}
