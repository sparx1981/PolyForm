import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { LUT, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Color, Data3DTexture, DataTexture, Matrix4, TextureLoader, Vector2, Vector3, RedFormat, UnsignedByteType, RepeatWrapping, LinearFilter, NearestFilter, RGBAFormat, type Texture } from 'three';
import { Atmosphere, Sky, SunLight, SkyLight, AtmosphereContext, type AtmosphereApi } from '@takram/three-atmosphere/r3f';
import { PrecomputedTexturesLoader, type PrecomputedTextures } from '@takram/three-atmosphere';
import { Clouds, CloudLayer } from '@takram/three-clouds/r3f';
import { AerialPerspective } from '@takram/three-atmosphere/r3f';
import { LensFlare } from '@takram/three-geospatial-effects/r3f';
import { CloudMaterialShadows } from './CloudMaterialShadows';
import { createHaldLookupTexture } from '@takram/three-geospatial-effects';
import { getSunDirectionECI, getECIToECEFRotationMatrix } from '@takram/three-atmosphere';
import { useApp } from '../../AppContext';
import { tilesToSiteMatrix } from '../../lib/worldSite/googleTiles';
import { createContext, useContext } from 'react';

const base = `${import.meta.env.BASE_URL}beta/`;
const groundAlbedo = new Color(0.12,0.13,0.11);
interface Assets { atmosphere: PrecomputedTextures; stars: ArrayBuffer; weather: Texture; shape: Data3DTexture; detail: Data3DTexture; turbulence: Texture; noise: Data3DTexture }
const AssetsContext = createContext<Assets | null>(null);

/** Own every loaded GPU texture, including partial loads; failure restores the legacy scene. */
export function BetaEnvironmentRuntime({ onEffects, onError }: { onEffects: (effects: ReactNode) => void; onError: () => void }) {
  const { gl } = useThree();
  const { graphicsSettings, shapes, setMeasurements } = useApp();
  const s = graphicsSettings.beta;
  const [assets, setAssets] = useState<Assets | null>(null);
  const atmosphere = useRef<AtmosphereApi>(null);
  const lastDate = useRef<number>(NaN);
  const errorHandler = useRef(onError); errorHandler.current = onError;
  useEffect(() => {
    let alive = true;
    const owned: Texture[] = [];
    const controller = new AbortController();
    const bytes = async (path: string) => {
      const response = await fetch(base + path, { signal: controller.signal });
      if (!response.ok) throw new Error(`Beta asset ${path}: ${response.status}`);
      return response.arrayBuffer();
    };
    const volume = async (path: string, w: number, h = w, d = w, nearest = false) => {
      const buffer = await bytes(path);
      if (buffer.byteLength !== w * h * d) throw new Error(`Invalid Beta volume: ${path}`);
      const texture = new Data3DTexture(new Uint8Array(buffer), w, h, d); owned.push(texture);
      texture.format = RedFormat; texture.type = UnsignedByteType;
      texture.minFilter = texture.magFilter = nearest ? NearestFilter : LinearFilter;
      texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping; texture.needsUpdate = true;
      return texture;
    };
    const image = async (path: string) => {
      const texture = await new TextureLoader().loadAsync(base + path);
      if (!alive) { texture.dispose(); throw new Error('Beta asset load cancelled'); }
      owned.push(texture);
      texture.wrapS = texture.wrapT = RepeatWrapping; texture.needsUpdate = true; return texture;
    };
    const atmospheric = new Promise<PrecomputedTextures>((resolve, reject) => {
      const textures = new PrecomputedTexturesLoader().setType(gl).load(base + 'atmosphere', resolve, undefined, reject);
      for (const texture of Object.values(textures)) if (texture) owned.push(texture);
    });
    Promise.all([atmospheric, bytes('atmosphere/stars.bin'), image('clouds/local_weather.png'),
      volume('clouds/shape.bin',128), volume('clouds/shape_detail.bin',32), image('clouds/turbulence.png'), volume('stbn.bin',128,128,64,true)])
      .then(([atmosphere, stars, weather, shape, detail, turbulence, noise]) => {
        if (alive) { setAssets({ atmosphere, stars, weather, shape, detail, turbulence, noise }); setMeasurements('Beta environment assets ready'); }
        else owned.forEach(t => t.dispose());
      }).catch(error => { if (alive) { console.error(error); errorHandler.current(); } });
    return () => { alive = false; controller.abort(); owned.forEach(t => t.dispose()); };
  }, [gl]);
  const site = s.useSite ? shapes.find(shape => shape.terrainData?.site)?.terrainData?.site : undefined;
  const worldToECEF = useMemo(() => new Matrix4().fromArray(tilesToSiteMatrix(site?.lat ?? s.latitude, site?.lng ?? s.longitude, site?.elevation ?? s.elevation)).invert(),
    [site?.lat, site?.lng, site?.elevation, s.latitude, s.longitude, s.elevation]);
  const date = useMemo(() => new Date(s.date + 'Z'), [s.date]);
  // Priority -1 runs before the library's sky, cloud and lighting updates.
  useFrame(() => {
    atmosphere.current?.worldToECEFMatrix.copy(worldToECEF);
    if (atmosphere.current && lastDate.current !== +date) { atmosphere.current.updateByDate(date); lastDate.current = +date; }
  }, -1);
  if (!assets) return null;
  return <AssetsContext.Provider value={assets}><Atmosphere ref={atmosphere} textures={assets.atmosphere} date={date}>
    <PublishEffects onEffects={onEffects} />
    <CelestialScene worldToECEF={worldToECEF} date={date} />
    {s.clouds && s.sky && <CloudMaterialShadows />}
    {s.sky && <Environment key={`${s.date}:${worldToECEF.elements.join(',')}`} frames={3} resolution={128}><Sky groundAlbedo={groundAlbedo} /></Environment>}
  </Atmosphere></AssetsContext.Provider>;
}

/** The composer receives the same atmosphere state without reparenting the editor scene. */
function PublishEffects({ onEffects }: { onEffects: (effects: ReactNode) => void }) {
  const atmosphere = useContext(AtmosphereContext);
  const assets = useContext(AssetsContext);
  useEffect(() => {
    onEffects(<AssetsContext.Provider value={assets}><AtmosphereContext.Provider value={atmosphere}><BetaEffects /></AtmosphereContext.Provider></AssetsContext.Provider>);
    return () => onEffects(null);
  }, [onEffects, atmosphere, assets, AssetsContext]);
  return null;
}

function CelestialScene({ worldToECEF, date }: { worldToECEF: Matrix4; date: Date }) {
  const { graphicsSettings, shadowsEnabled, lightPosition, setLightPosition } = useApp();
  const originalLightPosition = useRef(lightPosition);
  const publishLight = useRef(setLightPosition); publishLight.current = setLightPosition;
  const sunLight = useRef<import('@takram/three-atmosphere').SunDirectionalLight>(null);
  const s = graphicsSettings.beta, assets = useContext(AssetsContext)!;
  const { camera, gl } = useThree();
  const direction = useMemo(() => getSunDirectionECI(date, new Vector3()).applyMatrix4(getECIToECEFRotationMatrix(date, new Matrix4())).transformDirection(worldToECEF.clone().invert()), [date,worldToECEF]);
  const daylight = Math.max(0, Math.min(1, (direction.y + 0.08) / 0.15));
  useEffect(() => {
    if (!s.sky) return;
    publishLight.current(direction.clone().multiplyScalar(100).toArray() as [number,number,number]);
    return () => publishLight.current(originalLightPosition.current);
  }, [direction,s.sky]);
  useFrame(({camera}) => { sunLight.current?.target.position.set(camera.position.x,0,camera.position.z); }, -1);
  useEffect(() => { const previous = gl.toneMappingExposure; gl.toneMappingExposure = s.exposure; return () => { gl.toneMappingExposure = previous; }; }, [gl, s.exposure]);
  return <>
    {s.sky && <Sky groundAlbedo={groundAlbedo} renderOrder={-1000} />}
    {s.stars && <LocalStars data={assets.stars} date={date} worldToECEF={worldToECEF} intensity={s.starIntensity * (1 - daylight)} />}
    {s.sky && <><SunLight ref={sunLight} position={[camera.position.x, 0, camera.position.z]} distance={100} intensity={1} castShadow={shadowsEnabled}
      shadow-mapSize={[2048,2048]} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-camera-far={250} shadow-bias={-0.0001} />
      <SkyLight intensity={1} /></>}
  </>;
}

/** Catalogue directions live in ECI; use ordinary Three points in local coordinates
 * so celestial points retain their light through the editor's composed render. */
function LocalStars({ data, date, worldToECEF, intensity }: { data: ArrayBuffer; date: Date; worldToECEF: Matrix4; intensity: number }) {
  const { camera } = useThree();
  const points = useRef<import('three').Points>(null);
  const geometry = useMemo(() => {
    const view = new DataView(data), positions: number[] = [], colours: number[] = [];
    const transform = new Matrix4().extractRotation(worldToECEF.clone().invert()).multiply(getECIToECEFRotationMatrix(date, new Matrix4()));
    const direction = new Vector3();
    for (let i = 0; i + 9 < data.byteLength; i += 10) {
      direction.set(view.getInt16(i,true)/32767,view.getInt16(i+2,true)/32767,view.getInt16(i+4,true)/32767).transformDirection(transform);
      if (direction.y <= 0) continue;
      positions.push(direction.x,direction.y,direction.z);
      const magnitude = -2 + view.getUint8(i+6)/255*10;
      const brightness = Math.min(1,Math.pow(10,-(magnitude-1)/2.5));
      colours.push(view.getUint8(i+7)/255*brightness,view.getUint8(i+8)/255*brightness,view.getUint8(i+9)/255*brightness);
    }
    const result = new BufferGeometry();
    result.setAttribute('position',new Float32BufferAttribute(positions,3));
    result.setAttribute('color',new Float32BufferAttribute(colours,3));
    return result;
  }, [data,date,worldToECEF]);
  useEffect(() => () => geometry.dispose(),[geometry]);
  useFrame(() => { if (points.current) { points.current.position.copy(camera.position); points.current.scale.setScalar(camera.far*0.8); } });
  if (!(camera as {isPerspectiveCamera?: boolean}).isPerspectiveCamera) return null;
  return <points ref={points} geometry={geometry} frustumCulled={false} raycast={() => null}>
    <pointsMaterial size={2} sizeAttenuation={false} vertexColors color={new Color().setScalar(intensity)} transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} fog={false} />
  </points>;
}

/** Original Hald grades, generated in memory: no third-party LUT dependency or colour cast at neutral. */
function Grade() {
  const { graphicsSettings } = useApp();
  const { grade, gradeStrength } = graphicsSettings.beta;
  const lut = useMemo(() => {
    const size = 16, data = new Uint8Array(size ** 3 * 4);
    const tint = grade === 'warm' ? [1.05,1,0.92] : grade === 'cool' ? [0.93,1,1.05] : [1,1,1];
    for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
      const index = (r + g * size + b * size * size) * 4;
      [r,g,b].forEach((v,c) => { data[index+c] = Math.min(255, Math.round(v / (size-1) * 255 * tint[c])); }); data[index+3] = 255;
    }
    const source = new DataTexture(data,64,64,RGBAFormat); source.needsUpdate = true;
    const result = createHaldLookupTexture(source); source.dispose(); return result;
  }, [grade]);
  useEffect(() => () => lut.dispose(), [lut]);
  return <LUT lut={lut} tetrahedralInterpolation blendMode-opacity={gradeStrength} />;
}

export function BetaEffects() {
  const { graphicsSettings } = useApp();
  const s = graphicsSettings.beta, assets = useContext(AssetsContext)!;
  const { size, camera } = useThree();
  const quality = size.width < 768 ? 'low' : s.quality;
  const wind = useMemo(() => new Vector2(graphicsSettings.weather.windX, graphicsSettings.weather.windZ).multiplyScalar(s.windScale * 0.00005), [graphicsSettings.weather.windX, graphicsSettings.weather.windZ, s.windScale]);
  const perspective = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera;
  if (!assets) return null;
  return <>
    {/* Temporal upscale samples only one pixel in each 4x4 block and bypasses
        accumulation for fresh pixels. Use the library's TAA resolve instead. */}
    {s.clouds && perspective && <Clouds disableDefaultLayers qualityPreset={quality} temporalUpscale={false} resolutionScale={quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : 1}
      coverage={s.coverage} localWeatherVelocity={wind} shapeVelocity={[wind.x,0,wind.y]} shadow-farScale={0.25}
      localWeatherTexture={assets.weather} shapeTexture={assets.shape} shapeDetailTexture={assets.detail} turbulenceTexture={assets.turbulence} stbnTexture={assets.noise}>
      {Array.from({ length: s.layers }, (_, i) => <CloudLayer key={i} index={i} altitude={s.altitude + i * (s.thickness + 500)} height={s.thickness}
        densityScale={s.cloudType === 'cirrus' ? 0.1 : 0.3} shapeAmount={s.cloudType === 'stratus' ? 0.1 : 1} shapeDetailAmount={s.cloudType === 'cirrus' ? 1 : 0.5} shadow />)}
    </Clouds>}
    {(s.atmosphere || s.clouds) && perspective && <AerialPerspective sky={false} sunLight={false} skyLight={false} transmittance={s.atmosphere} inscatter={s.atmosphere} stbnTexture={assets.noise} />}
    {s.flare && <LensFlare intensity={s.flareIntensity} featuresMaterial-ghostAmount={s.ghosts} featuresMaterial-haloAmount={s.halo} />}
    <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    {s.grading && <Grade />}
    <SMAA />
  </>;
}
