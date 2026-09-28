# Presentation quality changes

Implemented against main `11346353` in the isolated `present-improvements` checkout, branch `codex/present-quality-lighting`.

## Behaviour

- **Stages:** Sketch is open linework. White volumes emerge upwards through it into Massing; openings, timber, roof trim and fittings appear in Detailed; original materials and planting return in Built. The reference was the supplied 22.6-second recording. This follows its visual progression using the user's model, rather than recreating its example building.
- **Build / Explode:** generated GPU-instanced timber is now registered member by member with the presentation engine. Build schedules those members with the rest of the structure. Explode spreads them out from the shell, with separate roof-frame clearance. Rest bounds remain stable during animation. Stopping restores the model, and editor updates to instance matrices are preserved.
- **Notes:** panel and spatial notes share Comments' rounded cards, typography and metadata styling. Visibility, deletion, camera focus and completion remain available. Spatial completion now records the same completion metadata as the panel.
- **Portal:** glass bevel width reduced from 0.22 to 0.07 of the portal radius, retaining the frosted material and animated highlight.
- **Doors:** closed-leaf line and translucent overlays are hidden while a door opens, including overlays created after the animation starts. Their prior visibility returns when the door closes or walk/presentation ends.
- **Auto light:** under Lighting. Existing fixtures balances bound fixture lights; Custom room lights creates a broad key and soft fill at each detected room's interior point. Warm, neutral and cool presets; named editable lights; no duplicate generated rigs on reapply; immediate Undo. Manual lights are preserved. Spot and directional targets now update their world matrices correctly.

## Validation

- Targeted presentation, automatic-lighting and walk-door tests.
- TypeScript check and production build.
- Browser inspection of the backend-free review scene: Sketch, partial Build, Explode, generated lighting and Notes. No browser errors observed.
- Review scene: run `npm run dev -- --port 3012`, then open `/examples/presentation-quality.html`.

## Practical limits

Auto light is an editable rendering starting point, not a photometric calculation. Room lights require enclosed wall layouts, estimate ceiling height from walls, and cap generation at 12 rooms / 24 lights. Sloping ceilings and unusually shaped rooms may require manual adjustments. Fixture balancing uses proximity to detected rooms. Undo is available until another light edit or a model switch, to avoid overwriting subsequent work.

The local review scene uses sample geometry. The user's full model, authenticated editor workflow and live deployment have not been exercised. No changes have been deployed.
