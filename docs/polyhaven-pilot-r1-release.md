# Poly Haven pilot r1 release record

Release: `2026-09-18-pilot-r1`  
Operator: `craigtrickett@gmail.com`  
Mapping reviewer: Craig  
Pilot URL: https://gen-lang-client-0540185995.web.app/

## Delivered

- Firebase Hosting pilot deployed on 2026-09-19 to project `gen-lang-client-0540185995`. This is **not** the separate production origin `https://polyform.ai.studio/`.
- 22 assets: 19 materials and 3 HDRIs, with 1k, 2k, and 4k tiers.
- 152 verified upstream source files, 6,162,314,127 bytes; 489 verified derivative files, 4,537,867,736 bytes.
- All 21 reviewer decisions are recorded in `config/polyhaven-legacy-map.v1.json`: 20 replacements and retention of `architectural-glass`. No bulk project-document migration was performed.
- Conversion tools: KTX-Software 4.4.2 and OpenImageIO 3.1.17.0.
- Coverage inventory has 85 converted source semantics, 1,310 alternative source variants, and no unsupported-blocking entries. Alternative entries include duplicate source formats/resolutions and DirectX-normal or packed-map alternatives; they are not 1,310 missing assets.

## Verification

- Importer validation: valid, zero errors and warnings. Report: `.polyhaven/releases/2026-09-18-pilot-r1/validation.json`.
- App tests: 984 passed across 68 files. Production Vite build succeeded.
- Firebase Firestore and Storage rules compiled in dry-run, but were **not deployed**.
- Hosting served the app, catalog, KTX2, HDR, and Basis WASM with HTTP 200. KTX2, HDR, and catalog response MIME/cache headers were checked. The fetched catalog hash matched `active-release.json`; sampled KTX2 and HDR bytes matched their manifests.
- Browser showed the PolyForm sign-in page and no error overlay. It did not have an authenticated Google session, so material-picker, viewport, and visual quality checks were **not approved**.
- TypeScript lint still reports the existing `Effects.tsx` particle-type mismatch; kernel lint still reports eight strict-null errors in `shaderHooks.ts` and `WeatherSystem.ts`.

## Activation gates and scope

- The Firestore `/assetCatalogs/polyhaven` active-release document was **not created**. The validated static pointer exists only in the pilot Hosting deployment.
- The default Firebase Storage bucket was **not** populated with derivatives; the pilot serves them through Firebase Hosting. Storage rules are not needed for these public Hosting objects.
- `https://polyform.ai.studio/` remains unchanged and does not currently serve `/polyhaven/catalog.v1.json` (HTTP 404 on 2026-09-19). The pilot does not establish a production-origin route or synchronize the Google AI Studio app.
- Before production activation, an authenticated operator must inspect representative material/terrain/environment rendering and approve it, choose a production delivery/deployment path for the separate origin, and review/deploy the rules if the Firestore pointer is to be used. A versioned taxonomy URL and trusted pointer write are also pending.

## Rollback

Firebase Hosting supports release rollback in its console. Because the default Hosting site returned 404 before this pilot, rolling back that site will remove the pilot. The separate production origin and Firestore active-release pointer were not changed by this deployment. Keep immutable release files until saved-project references and retention have been audited.
