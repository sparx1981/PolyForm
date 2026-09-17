import * as THREE from 'three';

let cachedSnowyTexture: THREE.CanvasTexture | null = null;

/**
 * Generates an equirectangular 360-degree panoramic texture representing
 * a crisp, high-altitude alpine winter scene with snow-capped peaks, low winter sun,
 * crystalline atmosphere, and snow-covered terrain.
 */
export function getSnowyEnvironmentTexture(): THREE.CanvasTexture {
  if (cachedSnowyTexture) {
    return cachedSnowyTexture;
  }

  const width = 2048;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    // Fallback simple texture if 2D context is unavailable
    const fallback = new THREE.CanvasTexture(canvas);
    return fallback;
  }

  // 1. Base Sky Gradient (Deep arctic cobalt zenith to pale winter horizon)
  const skyGradient = ctx.createLinearGradient(0, 0, 0, height * 0.55);
  skyGradient.addColorStop(0.0, '#1d4ed8'); // Deep crisp winter blue at zenith
  skyGradient.addColorStop(0.25, '#3b82f6');
  skyGradient.addColorStop(0.55, '#60a5fa');
  skyGradient.addColorStop(0.8, '#93c5fd');
  skyGradient.addColorStop(0.95, '#e0f2fe'); // Frosty ice mist near horizon
  skyGradient.addColorStop(1.0, '#f8fafc'); // Crystalline horizon white
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, width, height * 0.55);

  // 2. Base Snow Ground Gradient (Pale frosty horizon to pristine snowfield below)
  const groundGradient = ctx.createLinearGradient(0, height * 0.5, 0, height);
  groundGradient.addColorStop(0.0, '#f1f5f9'); // Horizon snow mist
  groundGradient.addColorStop(0.15, '#ffffff'); // Bright sunlit snow plain
  groundGradient.addColorStop(0.4, '#f8fafc');
  groundGradient.addColorStop(0.7, '#e2e8f0'); // Gentle foreground snow shadows
  groundGradient.addColorStop(1.0, '#cbd5e1'); // Deeper nadir snow shadow
  ctx.fillStyle = groundGradient;
  ctx.fillRect(0, height * 0.5, width, height * 0.5);

  // 3. Winter Sun & Atmospheric Corona
  // Position: azimuth around x = width * 0.35, elevation just above horizon
  const sunX = width * 0.35;
  const sunY = height * 0.40; // Low angle winter sun (~18 degrees elevation)

  // Wide atmospheric sunburst / halo
  const sunGlow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, width * 0.3);
  sunGlow.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  sunGlow.addColorStop(0.04, 'rgba(254, 243, 199, 0.9)'); // Warm golden core
  sunGlow.addColorStop(0.12, 'rgba(253, 230, 138, 0.45)');
  sunGlow.addColorStop(0.25, 'rgba(254, 215, 170, 0.2)');
  sunGlow.addColorStop(0.5, 'rgba(224, 242, 254, 0.12)'); // Icy halo ring
  sunGlow.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = sunGlow;
  ctx.beginPath();
  ctx.arc(sunX, sunY, width * 0.3, 0, Math.PI * 2);
  ctx.fill();

  // 22° Sun Halo (Atmospheric ice crystal halo)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(sunX, sunY, width * 0.12, 0, Math.PI * 2);
  ctx.stroke();

  // Intense Sun Disc
  const sunDisc = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 22);
  sunDisc.addColorStop(0.0, '#ffffff');
  sunDisc.addColorStop(0.6, '#ffffff');
  sunDisc.addColorStop(0.85, '#fef08a');
  sunDisc.addColorStop(1.0, 'rgba(254, 240, 138, 0.0)');
  ctx.fillStyle = sunDisc;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 22, 0, Math.PI * 2);
  ctx.fill();

  // 4. Distant Alpine Mountain Ranges (Seamless 360-degree wrapping)
  // Layer 1: Distant high jagged peaks (periwinkle atmospheric haze)
  const horizonBaseY = height * 0.505;

  function renderMountainLayer(
    peaksCount: number,
    baseHeightOffset: number,
    heightAmplitude: number,
    rockFill: string,
    snowHighlight: string,
    phase: number
  ) {
    if (!ctx) return;
    const step = 2;
    const points: { x: number; y: number }[] = [];

    for (let x = 0; x <= width; x += step) {
      const angle = (x / width) * Math.PI * 2;
      // Seamless multi-frequency harmonic elevation
      let h = Math.sin(angle * peaksCount + phase) * 0.45;
      h += Math.sin(angle * (peaksCount * 2 + 1) + phase * 1.5) * 0.25;
      h += Math.sin(angle * (peaksCount * 4 + 3) + phase * 2.7) * 0.15;
      h += Math.cos(angle * (peaksCount * 7 + 5)) * 0.08;
      h += Math.sin(angle * (peaksCount * 13 + 1)) * 0.04;

      // Normalize to positive peaks
      const peakY = horizonBaseY - baseHeightOffset - Math.abs(h) * heightAmplitude;
      points.push({ x, y: peakY });
    }

    // Fill silhouette
    ctx.beginPath();
    ctx.moveTo(0, horizonBaseY + 30);
    for (const pt of points) {
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.lineTo(width, horizonBaseY + 30);
    ctx.closePath();
    ctx.fillStyle = rockFill;
    ctx.fill();

    // Snow caps & sunlit ridge facets
    ctx.strokeStyle = snowHighlight;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  }

  // Far distant range (soft frosty blue-gray)
  renderMountainLayer(5, 45, 90, '#94a3b8', 'rgba(255, 255, 255, 0.75)', 0.4);

  // Mid-distance sharp alpine massifs
  renderMountainLayer(9, 20, 75, '#64748b', 'rgba(255, 255, 255, 0.9)', 1.8);

  // Closer snowy ridges & foothills
  renderMountainLayer(14, 5, 45, '#cbd5e1', 'rgba(255, 255, 255, 0.95)', 3.2);

  // 5. Horizon Snow Mist / Frost Haze
  const frostHaze = ctx.createLinearGradient(0, horizonBaseY - 25, 0, horizonBaseY + 35);
  frostHaze.addColorStop(0.0, 'rgba(241, 245, 249, 0.0)');
  frostHaze.addColorStop(0.4, 'rgba(248, 250, 252, 0.85)');
  frostHaze.addColorStop(0.7, 'rgba(241, 245, 249, 0.95)');
  frostHaze.addColorStop(1.0, 'rgba(241, 245, 249, 0.0)');
  ctx.fillStyle = frostHaze;
  ctx.fillRect(0, horizonBaseY - 25, width, 60);

  // 6. Snowfield Drifts & Wind-Carved Sastrugi Rhythms on ground
  ctx.fillStyle = 'rgba(186, 230, 253, 0.18)'; // Subtle cool blue snow shadow drifts
  for (let d = 0; d < 12; d++) {
    const driftY = horizonBaseY + 25 + d * 40;
    ctx.beginPath();
    ctx.moveTo(0, driftY);
    for (let x = 0; x <= width; x += 10) {
      const angle = (x / width) * Math.PI * 2;
      const driftOffset = Math.sin(angle * (3 + (d % 4)) + d * 0.8) * (8 + d * 3);
      ctx.lineTo(x, driftY + driftOffset);
    }
    ctx.lineTo(width, driftY + 18);
    ctx.lineTo(0, driftY + 18);
    ctx.closePath();
    ctx.fill();
  }

  // 7. Sun Glint on Snow Surface directly below Sun
  const glintGradient = ctx.createRadialGradient(sunX, horizonBaseY + 40, 10, sunX, horizonBaseY + 180, width * 0.18);
  glintGradient.addColorStop(0.0, 'rgba(255, 255, 255, 0.7)');
  glintGradient.addColorStop(0.2, 'rgba(254, 243, 199, 0.35)');
  glintGradient.addColorStop(0.6, 'rgba(224, 242, 254, 0.15)');
  glintGradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = glintGradient;
  ctx.fillRect(sunX - width * 0.2, horizonBaseY, width * 0.4, 260);

  // 8. Subtle Diamond Dust / Crystalline Atmospheric Shimmer
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  const rngSeed = 42;
  let s = rngSeed;
  function pseudoRandom() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  }
  for (let i = 0; i < 400; i++) {
    const rx = pseudoRandom() * width;
    const ry = (pseudoRandom() * 0.45 + 0.3) * height;
    const rSize = pseudoRandom() * 1.5 + 0.5;
    ctx.beginPath();
    ctx.arc(rx, ry, rSize, 0, Math.PI * 2);
    ctx.fill();
  }

  // Create Three.js Texture with Equirectangular mapping
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  cachedSnowyTexture = texture;
  return texture;
}
