import { useContext, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AtmosphereContext } from '@takram/three-atmosphere/r3f';
import { AtmosphereParameters, getAltitudeCorrectionOffset } from '@takram/three-atmosphere';
import { Ellipsoid } from '@takram/three-geospatial';
import { Vector3, type Material, type Mesh } from 'three';
import { attachCloudMaterialShadow, createCloudShadowUniforms } from '../../lib/graphics/cloudMaterialShadow';
import { useApp } from '../../AppContext';

export function CloudMaterialShadows() {
  const { transientStates, ellipsoid = Ellipsoid.WGS84 } = useContext(AtmosphereContext);
  const { scene } = useThree();
  const { shadowsEnabled } = useApp();
  const uniforms = useMemo(createCloudShadowUniforms, []);
  const installed = useMemo(() => new Map<Material, () => void>(), []);
  const position = useMemo(() => new Vector3(), []);
  useEffect(() => () => { installed.forEach(restore => restore()); installed.clear(); }, [installed]);
  useFrame(({camera}) => {
    const shadow = transientStates?.shadow;
    uniforms.pfCloudEnabled.value = !!shadow && shadowsEnabled;
    if (!shadow || !transientStates) return;
    uniforms.pfCloudMap.value = shadow.map;
    uniforms.pfCloudCount.value = Math.min(4,shadow.cascadeCount);
    uniforms.pfCloudNear.value = camera.near; uniforms.pfCloudFar.value = shadow.far;
    uniforms.pfCloudTop.value = shadow.topHeight;
    uniforms.pfCloudRadius.value = AtmosphereParameters.DEFAULT.bottomRadius;
    uniforms.pfCloudECEF.value.copy(transientStates.worldToECEFMatrix);
    uniforms.pfCloudSun.value.copy(transientStates.sunDirection);
    getAltitudeCorrectionOffset(camera.getWorldPosition(position).applyMatrix4(transientStates.worldToECEFMatrix), uniforms.pfCloudRadius.value, ellipsoid, uniforms.pfCloudCorrection.value);
    for (let i=0;i<uniforms.pfCloudCount.value;i++) {
      uniforms.pfCloudMatrices.value[i].copy(shadow.matrices[i]);
      uniforms.pfCloudIntervals.value[i].copy(shadow.intervals[i]);
    }
    scene.traverse(object => {
      const material = (object as Mesh).material;
      if (!material) return;
      for (const item of Array.isArray(material) ? material : [material]) {
        if (!(item as Material & {isMeshStandardMaterial?: boolean}).isMeshStandardMaterial || installed.has(item)) continue;
        installed.set(item,attachCloudMaterialShadow(item,uniforms));
      }
    });
  });
  return null;
}
