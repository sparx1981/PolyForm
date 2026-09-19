# Polyform → Poly Haven material and environment integration

**Implementation handoff for Claude · 18 September 2026 · Specification only**

## 1. Decisions and scope

Implement an offline, repeatable **Poly Haven REST API importer**, publishing versioned assets to Polyform-controlled Firebase Storage/object storage and a static catalog through the application origin or CDN. The editor must consume our catalog and derivatives, not call Poly Haven during scene rendering. Replace the premade material picker and environment picker; retain compatibility adapters for existing projects, custom uploads, and embedded model materials.

Definitive rendering defaults: **2K KTX2 materials**, **1K reduced-quality tier**, opt-in **4K detail tier**; **half-float EXR height maps** at the selected tier; **2K Radiance HDR environments**, 1K reduced-quality and optional 4K background detail. All available material map semantics must be ingested and accounted for, including displacement. Do not confuse complete map coverage with downloading every duplicate format and resolution or binding incompatible map alternatives simultaneously.

Recommended migration: generate taxonomy-aware candidate matches, then ship a reviewed, versioned alias dictionary. This is the default recommendation pending the user's choice; the three alternatives and tradeoffs are in §9. Exact replacement asset assignments require the candidate report and visual review; do not invent IDs from asset names.

The new environment catalog is restricted to the union of **`pure-skies`, `mountains-hills`, `forest-woodland`**, including their taxonomy descendants. No studio, urban, interior, or model-asset ingestion is part of this update. Existing studio/neon/snowy choices remain compatibility-only when opening old state, not entries in the new Poly Haven library.

## 2. Repository findings that govern implementation

This audit covers the current working tree, including existing uncommitted graphics work. Preserve those changes. `PolyForm-gpu-integration/` and examples are reference copies; the application implementation is under `src/`.

| Area | Observed implementation | Consequence |
|---|---|---|
| Renderer | `package.json`: React 19, Vite 6, TypeScript 5.8, Three.js `^0.183.2` (installed 0.183.2), Fiber `^9.5.0`, Drei `^10.7.7`, postprocessing. `Viewport.tsx` mounts Fiber Canvas with continuous rendering. | Use the installed Three.js WebGL material/loader APIs. No Babylon.js or renderer rewrite is needed. |
| Architectural presets | `src/lib/materialPresets.ts`: 11 flat-color presets with optional PBR URL fields; no actual maps in the preset records. `developerService.ts` expands named presets onto shapes. | Replace preset definitions with aliases to catalog assets, preserving old SDK IDs. |
| Premade library | `RightPanelStack.tsx` builds a large hardcoded `standardList` of scalar PBR appearances. | Replace its source with catalog summaries; do not maintain a second independent PBR definition list. |
| Shape rendering | `types.ts` stores color, texture URL, normal/roughness/metalness/AO/displacement URLs and depth controls. `Viewport.tsx` has separate albedo and data-map caches and per-face string values. | Add canonical material references and one resolver. Preserve legacy URLs/colors through an adapter. |
| Terrain | `landscapeTextures.ts` generates canvas textures; `terrainFactory.ts` defaults to `lush_grass` and writes a generated data URL into `color`, `textureUrl`, and `terrainData.textureUrl`. Roads have another generator/cache in `terrain/roadMaterials.ts`. | A saved texture often has no recoverable preset identity. Never assume every green texture is grass or recover identity from arbitrary image pixels. |
| Plants | `plantLibrary.ts`, `plantModelLoader.ts`, `graphics/plantAssets.ts` load local GLB/FBX/USD templates under `public/models/`; preserve GLTF Standard materials, assign FBX BaseColor/Opacity/Normal/Roughness/AO, or fall back to vertex-colored procedural plants. `PlantModelMesh.tsx` clones materials, applies tint and wind; instanced vegetation uses the same primitives. | Leaf atlases, alpha cutouts, wind hooks, vertex colors, and mesh material groups must survive. Use slot-specific overrides, not whole-plant replacements. |
| Kernel geometry | `geometry/types.ts`: `materialFront`, `materialBack` strings and world-space `UVBasis`. `KernelGeometry.tsx` batches via `facesByMaterial`, then passes the group string as a material color. | Asset identifiers cannot be passed to `THREE.Color`. Extend kernel render resolution and serialization, preserving face IDs and UV continuity. |
| Depth | `SurfaceDepthBinding.tsx` separately loads the height texture; `SurfaceDepth.ts` replaces Three's displacement shader chunk and configures matching depth/distance shadow materials. `depthGeometry.ts` limits eligible shapes/subdivision. `Viewport.tsx` has a separate legacy native-displacement branch. | Route height through the shared loader and one displacement owner. Avoid native displacement plus a second shader displacement. |
| Environments | `SkyboxType` is a fixed union. `EnvironmentLighting()` translates names to Drei presets; snowy uses a canvas texture. Installed Drei resolves presets from `raw.githack.com/pmndrs/drei-assets/...`. | Replace new selections with explicit asset references/files; retain old enum adapter. |
| User materials | `AppContext.tsx` reads `/materials` filtered by `userId`, max 500, with an in-memory fetch throttle. `RightPanelStack.tsx` uploads to `textures/{uid}/...`, falling back to data URLs. | Do not put the global asset catalog in the user's material query or create a copy per user. |
| Saved projects | `TopBar.tsx` saves `/models` and exports `.polyform` version 2; `OpenModel.tsx` and TopBar restore data. Shapes, custom materials, scenes and graphics settings are serialized. Examined save payloads do not explicitly store top-level skybox state. Geometry offload actually uses Firestore `geometryOverflow` via `firebase.ts`, despite older comments describing Storage. | Add environment serialization explicitly; do not rely on graphicsSettings to contain it. Preserve codecs and geometry offload. |
| Hosting/cache | Vite serves `public/`; Firebase SDK initializes Auth, Firestore and Storage. `firebase.json` only configures Firestore, not production hosting/Storage/CORS. Texture/template caches are module Maps without a shared eviction policy. | Deployment host, bucket CORS, CDN origin and cache headers are configuration deliverables, not established production facts. |
| Service worker | `public/_service-worker.js` is registered in `main.tsx`. It declares cache names but does not implement Cache Storage reads/writes. Its fetch wrapper attempts to add CORS headers after fetching Storage resources. | This cannot repair a failed cross-origin fetch. Configure origin-side CORS; do not treat this worker as an offline asset cache. |

No working tile proxy is configured in `vite.config.ts`; older internal documentation mentioning one is not proof it exists in deployment.

## 3. Ingestion route assessment

| Route | Benefits for Polyform | Costs / pitfalls |
|---|---|---|
| **REST API automation — selected** | Retrieves canonical IDs, current taxonomy, attributes, physical dimensions, all file variants, hashes and sizes. Can precisely restrict environments and stage material coverage. Incremental/reproducible downloads; no supporter subscription; fits a Node/TypeScript toolchain. | Requires an importer, API-schema validation, throttling/retries, conversion tools, storage and bandwidth. Upstream metadata changes need controlled releases. |
| Supporter Google Drive bulk download → our storage | Useful for a large offline mirror or when a team already has the complete source library locally. A sync tool may simplify transferring an entire archive. | Access/entitlement setup, potentially much unnecessary data, Drive quotas and file-layout normalization. Still needs taxonomy/IDs, checksums, conversion, upload and catalog generation. Drive share URLs are unsuitable as the runtime CDN. Latest tier/access details were not independently established in this audit. |

Google Drive is **not definitively more efficient** for this architecture or the three-category scope, so no Patreon prerequisite is warranted. It can later be an alternate download cache behind the same importer; it must not become a separate metadata authority.

Poly Haven's current API guidance states that default endpoints are free, including commercial use, with no key required; identify requests using a unique User-Agent and provide clear Poly Haven credit for API-backed products. Asset CC0 status and API-service conditions are separate. Use `PolyformAssetImporter/1.0` (plus an operator contact configured in CI) and a visible “Poly Haven · CC0” source link. See [official API guidance](https://polyhaven.com/our-api) and [asset FAQ](https://docs.polyhaven.com/en/faq).

### 3.1 Verified API behavior

The following were read directly with a unique User-Agent during this audit. Treat counts as dated observations, not test constants.

| Endpoint | Required handling |
|---|---|
| `GET /api-docs/swagger.json` | Snapshot schema and hash with each ingestion release; validate fixtures against it. |
| `GET /taxonomy/textures`, `/taxonomy/hdris` | Traverse `categories` recursively; nodes contain `id`, `name`, `slug`, `path`, `slugPath`, `children`. Retain attribute schemas. |
| `GET /assets?type=textures` | Returns an object keyed by asset ID. Discover all published texture records; metadata discovery is not a command to download all source resolutions. |
| `GET /assets?type=hdris&category=pure-skies` | Canonical taxonomy filtering, inclusive of descendants. |
| Same with `category=mountains-hills` and `category=forest-woodland` | Fetch separately and union/deduplicate by ID. Observed counts: 59 skies, 107 mountains/hills, 59 forest/woodland. |
| `GET /info/{id}` | Name, authors, tags, legacy `categories`, canonical `category_id`/`category`, `attributes`, dimensions, files hash, thumbnail URL. |
| `GET /files/{id}` | Discover exact map/resolution/format leaves, URLs, byte sizes, MD5 and dependencies. Never synthesize download URLs from filenames. |

The old plural `categories` parameter is a legacy **AND** filter. It does not implement the requested union. `/categories/hdris` exposed legacy names such as `pure skies` but not the full new taxonomy. Use the singular `category` endpoint parameter.

Verified root IDs: `pure-skies` → `61ac0f4c-0977-548f-b345-f34c2d9eff35`; `mountains-hills` → `e2be213c-5874-5d77-bd68-611f48865362`; `forest-woodland` → `0adcf5c3-a3af-5e36-a317-c5450a6c6b69`. Revalidate by slug and ID at ingestion; fail closed on ambiguity or missing roots.

For `aerial_grass_rock`, actual file keys include **`Diffuse`, `nor_dx`, `nor_gl`, `AO`, `Displacement`, `Rough`, `rough_ao`, `arm`**, alongside blend/gltf/mtlx containers. `Diffuse["2k"].png` and `Displacement["2k"].exr` exist. Case-sensitive source names are not the same as filename suffixes. Its canonical category is `Stone/Rock & Cliffs/Mossy & Lichened Rock`; dimensions `[15000,15000]` agree with its `15M x 15M` scale. Validate dimensional units against metadata documentation/sample scale before converting to meters; preserve raw dimensions.

For `kloofendal_48d_partly_cloudy_puresky`, `hdri["2k"].hdr` was 5,451,493 bytes versus 20,062,163 bytes for EXR. This supports the HDR default for that sample, not a universal HDR/EXR size rule. API references: [OpenAPI](https://api.polyhaven.com/api-docs/swagger.json), [HDRI taxonomy](https://api.polyhaven.com/taxonomy/hdris), [sample material files](https://api.polyhaven.com/files/aerial_grass_rock).

## 4. Exact importer requirements

Add `scripts/polyhaven/{cli,api,discover,download,convert,validate,publish}.ts`, a checked-in `config/polyhaven.json`, tool-version lock, JSON-schema validators, and recorded small API fixtures. Use Node compatible with repository CI and `tsx`. Proposed commands (implement these commands; they are not present today):

```sh
npx tsx scripts/polyhaven/cli.ts discover --config config/polyhaven.json
npx tsx scripts/polyhaven/cli.ts plan --release <release-id> --out <plan.json>
npx tsx scripts/polyhaven/cli.ts ingest --plan <plan.json> --resume
npx tsx scripts/polyhaven/cli.ts validate --release <release-id>
npx tsx scripts/polyhaven/cli.ts publish --release <release-id> --dry-run
npx tsx scripts/polyhaven/cli.ts publish --release <release-id>
```

1. **Discover:** snapshot taxonomy, asset listings, `/info`, `/files`, acquisition timestamp and schema hash. Inventory all texture materials; restrict HDRIs before downloading. Initial release ingests every texture in a frozen explicit release manifest, starting with all approved legacy replacements; remaining discovered textures are unavailable until their complete map sets pass validation. Support full-library ingestion with the same path. Never show metadata-only records as usable materials.
2. **Plan:** produce IDs, source map inventory, resolution/format choices, missing-map declarations, estimated download/storage bytes, conversion tasks and mapping coverage. Default source ceiling 4K; select 4K where offered, otherwise highest lower source. Download one highest-quality suitable representation of **every offered map variant** at that ceiling, even if runtime chooses a different alternative. Record all other available variants without downloading them. If a semantic map exists only at another resolution, obtain its nearest available source and record the exception, never silently omit it or claim an upscale is native detail. Container/dependency files are not additional texture maps; inspect them if needed to establish semantics.
3. **Download:** URLs must originate from validated API records and allowed HTTPS download hosts. Four concurrent file transfers, two metadata requests at once, conservative configurable pacing; these are our defaults, not asserted provider limits. Respect `Retry-After`; exponential backoff with jitter, five retries for 429/transient 5xx/network failures; fail 4xx other than 429 with a report. Stream to `.part`, check expected byte size and upstream MD5, compute SHA-256, rename atomically. Resume via Range only when supported and verified; otherwise restart that file. A successful rerun performs no duplicate download/conversion/upload.
4. **Normalize:** registry of source-key aliases → semantic roles, case-insensitive for matching but preserve raw keys. No guessing channel layouts from `rough_ao` or an unfamiliar name. Use verified metadata/container information or a tested adapter. Unknown keys become blocking `unresolved-map` records with source retained. Do not report an asset as complete while a distinct map is silently ignored.
5. **Convert:** pinned Khronos KTX-Software/Basis tools plus OpenImageIO or equivalent explicitly installed image tooling. Decode source encoding correctly; color filtering in linear light before sRGB re-encoding; normal renormalization after resizing; linear scalar filtering; full mip chains for KTX2; tile-edge continuity checks. Generate 1K/2K/4K only up to native source size. Bake reviewed high-bit-depth height into half-float EXR with a documented value transform and verify decoder compatibility. Produce WebP color and lossless PNG data fallbacks. Never use browser canvas as the high-bit-depth height converter.
6. **Coverage:** every source map has status `bound`, `converted`, `alternative`, or `unsupported-blocking`, with destination slot/reason. OpenGL/DirectX normals and roughness/packed-map duplicates are alternatives, not independent layers. Where maps represent genuinely distinct unsupported shading properties, implement a PhysicalMaterial/custom conversion adapter with tests or quarantine that asset; never silently discard them.
7. **Validate:** decode every derivative; dimensions, finite values, map color space, normal orientation, channel content, hashes, thumbnail, source/category provenance, height range, native-resolution limits and complete inventory. Produce machine-readable reports and a contact sheet of legacy candidates. Source absence is distinguishable from failed download or failed conversion.
8. **Publish:** upload immutable files first; smoke-fetch them from the real application origin; then publish release catalog/manifests; finally atomically update the active release pointer. Keep failed releases staged. Use server-side credentials only (ADC/CI identity), the configured named Firestore database, explicit bucket/origin and destination environment. No credentials in Vite variables. Keep download work directories and binaries out of Git.
9. **Incremental sync:** compare source files hash, actual file checksums and converter/config version. New metadata or content yields a new release; never mutate bytes at an existing content URL. Upstream deletions mark deprecated assets, not deletion of bytes referenced by saved projects. Garbage collection requires a separate reference/retention audit.

## 5. Formats, resolution and resource budgets

| Option | Value / limitation | Decision |
|---|---|---|
| WebP/JPEG color | Straightforward TextureLoader use and small transfers; decoded GPU memory remains uncompressed. JPEG has no alpha. | WebP preview/color fallback; retain alpha losslessly where required. |
| PNG scalar/normal | Lossless values, simple fallback; potentially large transfers/GPU memory. Browser image decoding is not a reliable high-precision height path. | Lossless 8-bit data fallback; high precision height uses EXR. |
| KTX2 ETC1S | Compact color distribution, device-specific transcoding; quality can suffer on detailed normals/scalars. | Base color default, with UASTC override when visual checks fail. |
| KTX2 UASTC + Zstd | Better normal and packed-data fidelity, GPU compression and mipmaps; needs build tooling and transcoder. | Normal and ORM default; linear data encoding. |
| EXR | High dynamic range/precision; transfer/decode/memory cost varies. | Canonical runtime height; optional environment source/fallback only when HDR unavailable. |
| Radiance HDR | Works with existing environment tooling; stores HDR RGB illumination. | Runtime equirectangular environments. Never replace IBL with an ordinary tone-mapped WebP. |

Materials: default longest edge 2048; reduced tier 1024; 4096 only for explicitly selected close-up/high quality assets. Keep physical aspect ratio; “2K” is not a requirement to stretch nonsquare maps. Thumbnails: 256px WebP, lazy-loaded. Environment 2K is normally 2048×1024; 1K/4K preserve 2:1 projection. Use the same 2K source for background and IBL by default. Optional 4K background must not cause a second unbounded PMREM allocation.

Budget starting points, to be measured on target hardware: total managed textures + environment render targets **256 MiB desktop / 96 MiB reduced tier**; account for decoded GPU allocation, mipmaps and PMREM, not download bytes. A square RGBA8 2K image alone is ~16 MiB, ~21.3 MiB with mipmaps; compressed textures often save substantially but vary by target format. Half-float EXR decoded RGBA is larger; include its true loader output in accounting. Six active network transfers maximum, at most two KTX transcode workers initially. Lower tier or evict unused resources when over budget; never evict a resource still referenced by a mesh. These are engineering targets, not measured current performance.

Instantiate one KTX2 loader per renderer context, host matching JS/WASM locally, call `detectSupport(renderer)` before loads, and keep decoder versions aligned with Three.js 0.183.x. Use installed API behavior, not unpinned latest documentation. See [KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html) and [EXRLoader](https://threejs.org/docs/pages/EXRLoader.html).

## 6. Material semantics, map binding and height

| Semantic source | Renderer destination / conversion | Encoding |
|---|---|---|
| Diffuse/BaseColor/Albedo | `map`; color defaults to white, optional user tint is separate | sRGB color |
| `nor_gl` | `normalMap`, tangent space | NoColorSpace |
| `nor_dx` | Alternative: convert Y to OpenGL once, or use negative `normalScale.y`; never both | NoColorSpace |
| Roughness/Rough | `roughnessMap`, green channel; grayscale fallback replicated to RGB | NoColorSpace |
| Metalness/Metallic | `metalnessMap`, blue channel | NoColorSpace |
| AO | `aoMap`, red channel | NoColorSpace |
| ARM/ORM | Verify packing then use R=AO, G=roughness, B=metalness on the same texture. Construct ORM from independent maps if needed. | NoColorSpace |
| Displacement/Height | `displacementMap`, red-channel normalized height plus explicit scale/bias; controlled by one depth owner | NoColorSpace |
| Bump | `bumpMap` if no normal exists. If it adds distinct detail, bake a composed normal; Three ignores bump when normal is present. | NoColorSpace |
| Opacity/Alpha | `alphaMap` samples green; preserve existing cutoff/sidedness; use alphaTest for cutouts, blending only for translucency | NoColorSpace |
| Emission | `emissiveMap`, nonblack emissive multiplier; distinguish color image from HDR emission | sRGB for LDR color; linear for HDR |
| Specular/Gloss | Convert verified spec/gloss workflow to metallic/roughness, or choose a validated PhysicalMaterial adapter. Gloss inversion alone is not full specular-workflow conversion. | Explicit per source |
| Other maps | Inventory, determine semantics, implement/test adapter or block publication for that material | Never guessed |

For mapped roughness/metalness, use multiplier 1 unless a deliberate user override exists; leaving the old material's metalness at 0 would suppress a metalness map. Missing metalness defaults to 0 only for a confirmed dielectric; preserve authored metallic fallback for legacy metal. Map replacement must clear old slots, opacity modes and shader state before binding a new material, while preserving explicit user overrides separately.

All maps share UV basis, repeat, offset, rotation and orientation. Model units are treated as meters by terrain/plant code; normalize source physical scale once. Preserve an existing explicit repeat when migrating. Otherwise repeat = world extent / physical tile extent. Do not renormalize kernel UVs per face after a split. For GLTF overrides preserve its UV orientation/flipY convention; cross-test PNG/EXR/KTX2 orientation since compressed image flipping is not interchangeable with TextureLoader flipping.

In Three.js r183, select UV sets with `Texture.channel`: 0 → `uv`, 1 → `uv1`, 2 → `uv2`. Use channel 0 for tiled material AO unless a separate authored UV set is specified. Do not copy the stale “AO always requires uv2” assumption from `PlantFBXMesh.tsx`. Preserve authored GLTF UV-set assignments.

### 6.1 Mandatory displacement behavior

* Every available height map must be downloaded, preserved, converted and included in the runtime material descriptor. Merely showing relief through a normal map does not satisfy height support.
* Make `SurfaceDepth` the single displacement owner for newly referenced materials. Refactor `SurfaceDepthBinding` to consume a managed EXR/DataTexture handle, with load-error/cancellation handling. Do not send EXR/KTX2 to `TextureLoader`.
* Displacement formula: `offsetMeters = normalizedHeight * scaleMeters + biasMeters`. Store normalization, units and provenance in the asset descriptor. Source physical width/length does **not** establish displacement amplitude. Use reviewed source authoring information when available; otherwise mark `calibrated:false`, recommend a conservative 0.01 m peak-to-peak provisional range with bias −0.005 m, and expose adjustment. Never silently reuse the current 0.1 m native default for all materials.
* Apply displacement by default to eligible opaque ground/stone/brick materials with validated height and sufficient render geometry; preserve explicit user disablement. Architectural glass, leaf cards, unsuitable UVs, unsupported per-face arrangements and complex model skins must not be displaced indiscriminately. Their height remains assigned in the descriptor with a visible unsupported/disabled reason; use the normal map, or height-derived bump when no normal exists, as shading fallback.
* Use render-only subdivision with current bounded logic (detail 4–32 and existing 98,304-vertex guard), plus a scene-wide budget. Do not alter saved topology, terrain elevation/cut-fill, collision geometry, model exports or original face IDs. Height relief is visual; physical terrain edits remain the terrain system's responsibility.
* Require UVs and normals; generate a documented planar projection for suitable untextured primitive surfaces. Do not invent UVs for authored leaf atlases. Expand bounds to `max(abs(bias),abs(scale+bias))`, with instance/object scale accounted for. Avoid fixed small culling bounds when users increase amplitude.
* Preserve SurfaceDepth's matching depth/distance shadow materials and shader-hook composition with wind/weather. Clone mutable material instances; share texture resources. Maintain original-geometry raycasting to retain face selection, and document the visual/picking offset for relief.
* Initial eligibility preserves `canApplySurfaceDepth` exclusions (beveled surfaces, per-face overrides/divisions, unsupported types). Extending it requires group-safe subdivision, stable face lookup and corresponding tests. A material may support height while a particular geometry cannot.

Renderer semantics are corroborated by the installed `MeshStandardMaterial`, Texture and shader sources; see also [Three.js material reference](https://threejs.org/docs/pages/MeshStandardMaterial.html).

## 7. Catalog, database and naming schema

Use immutable manifests on object storage for the full catalog; Firestore stores a small active-release pointer and user/project references. This avoids thousands of real-time reads and Firestore document-size problems. Do not store image bytes, map inventories or the global catalog inside `/models`.

```ts
type AssetId = `ph:material:${string}` | `ph:hdri:${string}`;
type Quality = '1k' | '2k' | '4k';
type MaterialRef = { assetId: AssetId; revision: string };
interface AssetSummary {
  id: AssetId; sourceId: string; kind: 'material' | 'hdri';
  name: string; source: 'polyhaven'; license: 'CC0-1.0';
  revision: string; manifestUrl: string; thumbnailUrl: string;
  categoryId: string; categoryPath: string; categorySlugPath: string;
  ancestorCategoryIds: string[]; legacyCategories: string[];
  tags: string[]; attributes: Record<string, unknown>;
  environmentGroup?: 'pure-skies' | 'mountains-hills' | 'forest-woodland';
  availableTiers: Quality[];
}
interface MapVariant {
  url: string; sha256: string; byteLength: number;
  width: number; height: number; format: 'ktx2'|'webp'|'png'|'exr'|'hdr';
  encoding: 'srgb'|'linear-color'|'data';
  channels: Record<string, 'r'|'g'|'b'|'a'>;
  sourceKeys: string[]; uvChannel: number;
}
interface MaterialInstance {
  ref: MaterialRef;
  tint?: string; roughnessMultiplier?: number; metalnessMultiplier?: number;
  opacity?: number; alphaTest?: number;
  uv?: { repeat: [number,number]; offset: [number,number]; rotation: number };
  depth?: { enabled: boolean; scaleMeters: number; biasMeters: number };
}
interface EnvironmentState {
  ref: MaterialRef | null; // runtime validation requires ph:hdri
  intensity: number; backgroundIntensity: number;
  rotationRadians: number; blur: number; background: boolean;
  quality: Quality;
}
```

Tighten the material/environment reference types into distinct discriminated aliases in implementation. Full asset manifests additionally include schemaVersion, authors/source URL, raw metadata URL/hash, source files hash, complete source inventory with upstream MD5, converters/version, physical tile meters, calibration data, alpha mode, scalar fallbacks, per-tier semantic→variant bindings, coverage decisions and publication/deprecation status. Preserve source metadata separately from normalized fields.

**Strict identity and storage naming:**

* Canonical ID: `ph:material:<original_source_slug>` or `ph:hdri:<original_source_slug>`. Preserve underscores in source slugs. Display name is the source name; UI badge adds Poly Haven. Never use human-readable names as IDs.
* Firestore-safe lookup key when needed: `ph__material__<slug>` / `ph__hdri__<slug>`; map back explicitly.
* Object path: `polyhaven/v1/{textures|hdris}/{sourceSlug}/{revision}/{tier}/{sourceSlug}__{semantic}__{tier}__{sha256prefix}.{ext}`. Use ≥16 hash hex digits in filenames and full SHA-256 in manifests. Semantic names are fixed lowercase: `basecolor`, `normal-gl`, `orm`, `height`, `opacity`, `emissive`, `environment`, `preview`.
* Preserve canonical taxonomy node IDs, full paths and attributes. Use parent relationships from `/taxonomy`, not name splitting to infer hierarchy. Category changes never change asset IDs/URLs. Legacy categories and freeform tags are searchable metadata, not primary identity. Missing taxonomy maps to an explicit “Uncategorized” material bucket; missing environment membership blocks environment publication.

**Firestore changes:**

| Path | Change |
|---|---|
| `/assetCatalogs/polyhaven` (new) | `{schemaVersion:1, activeRelease, catalogUrl, catalogSha256, taxonomyUrl, updatedAt}`. Client read allowed for public library; all client writes denied. Only trusted publishing job writes. |
| `/materials/{id}` | Preserve owner-scoped custom records and existing `color`/`texture` forms. Add `type:'asset'`, `schemaVersion:2`, `assetRef`, overrides and optional `legacySnapshot`. For asset records do not require old `value`; validate the discriminated shape. |
| `/models/{id}` | Add `assetSchemaVersion:1`, `assetCatalogRelease`, `environment`, `materialBindings`, and migration metadata. Retain existing shape/scenes/customMaterials payloads and ownership. `materialBindings` is a deduplicated dictionary of MaterialInstance keyed by local binding ID. |
| Shape/TerrainData | Add `materialBindingId`; Shape adds `surfaceMaterialBindings:Record<number,string>` and slot-specific model bindings. Keep old scalar/URL fields for legacy adapter/rollback. |
| Kernel faces | Keep front/back string fields for format compatibility, but explicitly recognize `binding:<id>` tokens before color parsing. Bindings are saved in the project dictionary. Update graph codecs, material grouping and split/merge attribute propagation. |

Use `.polyform` **version 3**, reading versions 1/2/3. No automatic write merely from opening an older file. Environment fields must round-trip through every save, Save As, import/open, download and scene-capture/restore path. Scene snapshots should optionally override EnvironmentState; migrate only fields actually present. Degrees in the current UI/SDK convert once to radians in persisted state.

Update `firestore.rules` validators with bounded strings, valid discriminants, allowed IDs, finite/ranged numeric fields and ownership checks. Keep the existing collaboration rules rather than granting catalog writers access to user models. Use Storage rules/config for an admin-only `polyhaven/` write prefix, public-read derivatives if using a public CDN, and owner-scoped custom uploads. Test these in emulators; no public write rule. Add Firestore indexes only for actual new queries; the static catalog does not require a global search index in Firestore.

## 8. Frontend integration and environments

Add `src/lib/assets/{catalog,types,legacyAdapter,materialResolver,textureManager,environmentManager}.ts` and React hooks/components around them. Validate network JSON at runtime. Load a lightweight catalog index, then category pages/asset manifests lazily. Ship a small pinned fallback catalog for defaults so a transient pointer read failure does not empty the editor.

Resolution precedence is **explicit per-face/slot binding → explicit object binding → reviewed legacy alias → existing authored/custom material → safe scalar fallback**. Terrain's explicit binding takes priority over its old data URLs. User overrides are separate from catalog defaults and survive changing quality. Replacing a material is one undoable transaction; partial fetch failures do not partly overwrite project state.

| Existing file/path | Required modification |
|---|---|
| `RightPanelStack.tsx` | Replace `standardList` with searchable taxonomy tree, thumbnails, source credit and material apply action. Show availability/height support; apply an entire binding, not an albedo URL. Environment selector becomes the restricted HDRI catalog. Preserve custom uploads/colors. |
| `AppContext.tsx`, `types.ts` | Typed bindings and EnvironmentState; separate catalog state from `customMaterials:any[]`; selected paint value can represent a binding. Provide legacy-compatible setters. |
| `Viewport.tsx` | Resolve all material routes, including box faces, terrain, custom/primitive shapes and painting; remove separate URL caches for new assets. Avoid fetching in the JSX render body. Preserve style/wireframe/selection/transparency behavior. |
| `KernelGeometry.tsx`, `kernelSelection.ts`, geometry serializers | Batch by resolved binding/front/back identity instead of color alone. Preserve world UVs and `faceOfTriangle`; implement distinct front/back material behavior without z-fighting. Selection tint must not replace PBR data. |
| `materialPresets.ts`, `developerService.ts` | Legacy ID aliases, canonical list/apply APIs and async readiness; whole binding replaces all previous map slots. Keep old scripts functional and record stable asset IDs/revisions for replay. |
| `terrainFactory.ts`, `landscapeTextures.ts`, `roadMaterials.ts`, landscape/terrain controls | New default bindings and catalog choices; leave procedural generators available for old/unresolved files and offline fallback. Preserve road markings/geometry and terrain analysis shading. |
| `graphics/plantAssets.ts`, plant meshes, `InstancedVegetation.tsx` | Bind reviewed trunk/bark/rock slots only where appropriate, preserve embedded leaf atlases. Batch keys must include binding revision/overrides/UV/depth state. Editable and instanced plants must look equivalent. |
| `TopBar.tsx`, `OpenModel.tsx`, project/scene handlers | Shared versioned serializer/deserializer and migration adapter; update all save/load variants and SDK state export. |
| `SurfaceDepthBinding.tsx` | Managed texture handles, calibrated scale/bias, single ownership and safe teardown. |

**Texture manager:** deduplicate both in-flight promises and loaded resources. Key by immutable URL/hash plus color encoding, renderer context and relevant sampler state. Shared source textures must not be mutated to change one object's repeat or color space; own texture views/clones explicitly and include their cost. Reference-count acquisitions; LRU-evict only unreferenced resources; dispose textures, PMREM targets and workers at the right ownership boundary. Handle rejection, retry cooldown, unmount and out-of-order completion. Preserve current `polyform-texture-loaded` consumers or replace them deliberately with invalidation/subscriptions. Do not cache a failed promise forever.

**HTTP delivery:** content-hashed objects `Cache-Control: public,max-age=31536000,immutable`; catalog pointer revalidated (`no-cache`/ETag). Correct MIME types for KTX2, EXR, HDR, JSON and WASM. Configure GET/HEAD CORS for actual application origins and exposed ETag as required. An optional service-worker cache may cache immutable public assets with bounded quota/LRU; do not precache the full library or private Firebase/auth requests.

**Environment loader:** resolve the published HDR/EXR URL using RGBELoader/EXRLoader, set equirectangular reflection mapping and linear color semantics. Assign background and PMREM-backed IBL consistently; either let the Three/Drei lifecycle own PMREM or explicitly own targets, never duplicate it. Cache per renderer context and asset revision. Preserve rotation, blur and lighting intensity; retain the previous successful environment while a replacement loads. A newer selection supersedes late responses from older requests.

The existing WebGL2 check is not enough to declare an HDR load successful. Catch fetch/decode/allocation/context failures and fall back to the last good environment, then bundled low-resolution allowed-category HDR, then neutral background plus hemisphere light. Show one actionable nonblocking notice, not repeated errors each frame. Switching to None clears stale IBL/background and respects theme. Dispose resources only after the old scene no longer references them.

Limit new HDRI browsing to the three validated roots and their descendants. No fallback broadening to `outdoor`, name substring matching or a “city” preset. Preserve exact source taxonomy and a separate allowed-root `environmentGroup` for the three UI tabs. HDRI lighting does not cast directional sun shadows: retain existing sun controls and do not fabricate sun direction from filenames. Golden-hour/sunrise/twilight legacy mappings require reviewed sky candidates and preserve intensity/rotation; unsupported legacy studio/neon/snowy state uses the compatibility adapter with a migration notice.

## 9. Legacy mapping strategies and recommended procedure

| Strategy | Benefits | Pitfalls |
|---|---|---|
| A. Automatic fuzzy name/tag/category matching | Fast large-library coverage; can rank synonyms and material/usage attributes. | Ambiguous “stone”, “oak” or colors; false matches can ruin leaf atlases/glass. Names do not encode scale or material slots. Nondeterministic results if upstream catalog changes. |
| B. Manually authored dictionary | Deterministic, versionable, reviewable; ideal for 11 architectural IDs and known terrain/road presets; simple rollback. | Manual maintenance, omissions as defaults grow; does not identify lost IDs in saved data URLs. |
| **C. Candidate script + reviewed dictionary (recommended)** | Automated discovery with deliberate visual/semantic selection; reproducible mappings and explicit exceptions. | Requires a review step and retained reports. Cannot reconstruct absent provenance; those records must remain intact. |

Ship `config/polyhaven-legacy-map.v1.json` entries with `{legacyNamespace,legacyKey,targetAssetId,targetRevision,slot?,uvPolicy,overridePolicy,decision,reason,reviewedBy}`. `decision` is `replace` or `retain`; every built-in has a reviewed disposition. Namespaces prevent collisions between architectural, terrain, road, premade-name and plant-slot IDs. A deliberate retain entry is required for glass/transmission, pure colors, or an atlas with no suitable compatible Poly Haven replacement.

Candidate generation tokenizes names, uses an explicit synonym dictionary, weights canonical taxonomy/attributes before lexical similarity, filters incompatible surface use/alpha workflow and emits top three candidates with previews, scale, map coverage and reasons. Freeze source release and scoring version. Scores are ranking aids, not permission to overwrite user content. Do not auto-apply fuzzy matches at runtime.

Seed the inventory with architectural IDs `red-brick`, `coursed-stone`, `polished-concrete`, `stucco-white`, `vertical-timber`, `architectural-glass`, `standing-seam-zinc`, `weathered-steel`, `travertine-marble`, `terracotta-tile`, `black-granite`; terrain IDs `lush_grass`, `manicured_turf`, `alpine_rock`, `forest_mulch`, `desert_sand`, `cobblestone`, `crushed_gravel`, `fresh_snow`, `weathered_asphalt`, `terracotta_clay`; enumerate all current road and picker entries programmatically. `KNOWN_TEXTURE_IDS` also recognizes additional terrain names that are not generated in the inspected list: report these as recognized legacy tokens, not guaranteed assets.

Review defaults by domain:

* **Terrain:** change future creation from generated data URLs to the approved grass binding. Migrate explicit IDs/known aliases. Existing generated data URLs lacking source IDs remain legacy; offer user reassignment. Do not replace satellite imagery or arbitrary terrain textures.
* **Plants:** current species IDs select geometry, not a single interchangeable material. Preserve species and leaf atlas/alpha behavior. A bark slot may receive a reviewed tiling bark material if UVs support it; expose per-slot assignment. Procedural vertex-colored plants remain until an explicit compatible mapping is authored.
* **Models and architecture:** migrate known `materialPreset` and provenance-bearing built-in references. Preserve imported model materials, per-face colors and custom URLs unless explicit remapping exists. A color value matching a preset is insufficient evidence of identity.

### 9.1 Migration scripts

Add `scripts/polyhaven/{propose-mappings,migrate-projects}.ts`. Require default dry-run, project/user scope, mapping version, source release and output report. Inventory shapes, nested terrain data, customMaterials, kernel front/back strings, model slots, scenes and SDK-derived references actually persisted. Emit counts of mapped, retained, ambiguous, broken and missing assets; fail if any mapping target is unpublished or lacks required semantics.

Prefer read-time pure migration into a v3 in-memory model and write on the next explicit save. Bulk administrative migration is a separate command: backup original documents/files, hash preimages, checkpoint progress, bounded batches, compare update timestamps/preconditions to avoid concurrent-edit overwrites, and log every transformed path. Respect ownership and the configured named database. Never delete old asset bytes or user materials. Running twice must yield no additional changes; rollback restores preimages subject to the same conflict checks. Preserve unknown fields and use existing Firestore array/geometry codecs. Report unidentified data URLs rather than guessing.

## 10. Failure policy

| Failure / missing input | Required outcome |
|---|---|
| API/source file fails during ingestion | Retry per policy, quarantine incomplete asset, retain active release. Do not relabel a failed file as “not offered”. |
| Base color absent by source design | Use recorded neutral/authored scalar color; retain material semantics. Runtime load failure shows scalar fallback plus status. |
| Normal absent | No normal map; optionally derive from valid height with recorded settings. Never use an albedo checkerboard as a normal. |
| Roughness absent | Manifest scalar (default 0.7 if no authored value); neutral multiplier behavior. |
| Metalness absent | Confirmed dielectric 0, otherwise reviewed authored fallback. Do not infer metallic state merely from dark color. |
| AO absent | Unoccluded factor 1. Missing ORM channel is synthesized accordingly. |
| Height absent | Record `notOffered`; displacement disabled. Normal detail remains. Height load failure resets displacement safely. |
| Alpha absent | Opaque unless an existing authored material requires alpha; keep an embedded alpha atlas if replacing only another slot. |
| Emission absent | No emission. |
| KTX2 decoder/format fails | Try same-tier fallback image, then lower tier; account for greater uncompressed GPU memory. |
| Unknown material ID / removed catalog entry | Try pinned historical manifest, then saved legacy snapshot/scalars. Preserve unknown ID for future recovery; never silently substitute an unrelated material. |
| Storage/network unavailable | Keep loaded resources, use cached/bundled defaults and nonblocking status. No giant data URL fallback for the global catalog. |
| HDRI failure | Previous good → bundled allowed-category HDR → neutral background/hemisphere, preserving user's requested reference. |

Use structured diagnostics `{assetId,revision,role,stage,reason,retryable}` and a compact “Some maps unavailable” indicator. No per-frame console floods. Missing source channels must not count as failed ingestion when the manifest declares a valid fallback; unknown distinct maps do block completion.

## 11. Implementation order and acceptance gates

1. Freeze baseline working tree and fixture scenes; record current build/test failures without overwriting existing work. Implement types, schema validation, catalog and legacy resolver behind a feature flag.
2. Build importer and conversion proof with at least: a terrain material with height/AO/normal, a metallic material, an alpha-bearing material or a deterministic fixture if the catalog lacks one, and one HDRI from each allowed root. Validate all source map coverage, not only albedo.
3. Implement shared loader, color/UV/channel tests, cache lifecycle and fallback handling. Wire primitives/terrain, kernel faces, SDK and library UI; integrate depth and plant slot handling.
4. Generate candidate report, review alias dictionary, ingest approved replacements and requested HDRI inventory. Publish only verified releases; complete remaining planned material batches before claiming the entire catalog is ready.
5. Add v3 serialization, dry-run migration, Firestore/Storage rules and origin delivery configuration. Activate feature flag only after end-to-end checks.

Required checks:

* `npm run lint`, `npm run lint:kernel`, `npm test`, `npm run build`, plus graphics TypeScript configuration where applicable. Record pre-existing failures separately. Tests must run against deterministic fixtures, not depend on live API availability.
* Importer tests: uppercase map keys, unfamiliar maps, missing resolution, duplicate formats, packed channels, interrupted download, bad checksum, 429/backoff, unchanged rerun, upstream taxonomy change and failed publication. Verify the three-category **union**, excluding unrelated HDRIs.
* Material render tests: base color under sRGB management; asymmetric normal fixture detects inverted Y; independent AO/roughness/metalness channel fixture; shared-map UV consistency; no stale maps after switching; concurrent independent repeats; encoded height ramp yields expected meter offsets and aligned shadows without duplicate displacement.
* Depth tests: bounded subdivision/culling, explicit disabled state, missing map fallback, nonuniform object scale policy, safe unsupported geometry, selection face identity, original collision/elevation/export data unchanged, wind/weather shader coexistence and cleanup.
* Save/load tests: old named preset, data-URL terrain, custom upload, per-face paint, kernel front/back, plant atlas, scene environment, local v1/v2/v3 files and Firestore documents; ID/revision/overrides round-trip; migration idempotency, rollback and concurrent-edit refusal.
* Browser tests on desktop and a constrained WebGL2 device: open library without downloading full map sets; apply/undo/redo materials on primitive, terrain and kernel face; repeat changes do not affect neighbors; vegetation stays visually equivalent when instanced; fast HDRI switching cannot restore stale selections; None removes IBL; decoder/network failure keeps editor usable.
* Resource checks: inspect actual network bytes, GPU estimates and `renderer.info.memory`; repeat 20 material/environment switches, then release unused objects. After loading settles, resources plateau within the configured budget. No environment generation each frame. Record tested hardware, timing and memory rather than claiming universal frame rates.
* Rules tests: global catalog readable but client writes denied; custom material ownership/collaboration preserved; v2 asset record validation; Storage derivative write protection. Origin smoke test confirms actual CORS, cache headers, MIME and decoder availability with the registered service worker enabled.

Claude's final implementation report must provide changed files, importer commands and manifests, exact reviewed mappings/retentions, category coverage, source/derivative byte totals, map-coverage exceptions, before/after visual evidence, checks executed, baseline failures and rollback instructions. Do not claim deployment, migration or visual validation that was not performed.

## 12. Evidence and remaining deployment inputs

Audit evidence: repository paths above, installed Three/Drei source, and direct public API responses retrieved on 2026-09-18. No production database was queried or modified; no asset library was downloaded; no application behavior was changed by this specification. Current production CDN/hosting origin, bucket CORS, target-device performance and final material candidate choices remain implementation inputs to verify.

Primary references: [Poly Haven API guidance](https://polyhaven.com/our-api), [OpenAPI schema](https://api.polyhaven.com/api-docs/swagger.json), [texture taxonomy](https://api.polyhaven.com/taxonomy/textures), [HDRI taxonomy](https://api.polyhaven.com/taxonomy/hdris), [sample texture metadata](https://api.polyhaven.com/info/aerial_grass_rock), [sample HDRI files](https://api.polyhaven.com/files/kloofendal_48d_partly_cloudy_puresky), [CC0 FAQ](https://docs.polyhaven.com/en/faq). Current supporter entitlement/pricing is intentionally not asserted; it does not block the selected free API route.
