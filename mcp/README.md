# PolyForm connector for Claude

An MCP server that lets Claude read, build in and take pictures of your PolyForm models, even
when the app isn't open. It runs on Vercel and talks to PolyForm's Firebase project.

## What Claude can do

| Kind | Tools |
|---|---|
| Read | `list_models`, `get_model` (counts, extent, wall/fence length, patio/deck area), `list_objects`, `get_object`, `list_rooms`, `list_drawn_faces`, `list_civil_modifiers`, `check_model_health`, `check_layout`, `check_geometry`, `list_catalog` |
| See | `screenshot` (perspective, plan, front, back, left, right; whole model or one object) |
| Preview | `preview_model`: called when a design is finished. A 3D picture, plus a floor plan of each level for buildings (rooms and areas, doors, windows, stairs). The plans are drawn by the connector itself, so they work even without screenshots |
| Build | `create_model`, `build_model` (a whole model from a list of steps, saved as a file with no database), `export_model` (a stored model to a `.polyform` file in Google Drive), `add_shape`, `add_room`, `add_wall`, `add_curved_wall` (arcs, round and bent walls), `convert_to_walls` (a drawn offset ring to walls), `add_opening` (door/window in a wall), `add_roof` (gable, hip, flat or single-slope), `set_roof_extras` (chimney, gutters, solar), `add_roof_window` (Velux roof windows), `add_dormers`, `add_porch`, `add_stairs` (checked: must fit inside a room), `add_railing`, `add_terrain`, `flatten_terrain` (level a terrain back to one height), `import_site` (a real place's ground and existing buildings, up to 200 m square, from an address, postcode or lat/lng; LiDAR heights and roofs in England and the Netherlands), `set_street_life` (moving cars, people and birds on the imported site: off/quiet/normal/busy, in the editor too, Auto Street Light lamps, and extra routes), `add_plant`, `add_fence`, `add_pond` (still water or directional stream/current with speed and turbulence), `add_patio`, `add_interior_furniture`, `furnish_room`, `draw_line`, `draw_primitive`, `follow_me`, `add_road`, `add_grading_pad`, `set_pad_surface` |
| Edit | `transform_objects`, `set_appearance` (colour, material presets, plain finishes, and for terrain: ground texture, procedural grass and wildflower meadows), `set_weather` (rain, snow, clouds, mist and wind), `update_pond`, `update_patio`, `edit_drawn_faces` (Push/Pull, Offset, Chamfer, Fillet, booleans, paint and erase), `update_civil_modifier`, `remove_civil_modifier`, `rename_object`, `delete_objects`, `undo_last_change` |

Building uses the app's own code (the scripting library, the roof tool's roof assembly, the
patio, fence and pond tools), so objects come out exactly as if drawn in the app. Changes save
to the model in Firestore and appear live in the app if it's open. The connector persists the same model fields the app uses for these workflows: ordinary objects
(`shapes`), graphics settings (`graphicsSettings`), Civil/Terrain Studio state
(`terrainModifiers`) and drawn geometry (`kernel`). It keeps the last 20 connector changes per
model so `undo_last_change` can step back object, weather, civil or drawing-kernel edits.

Screenshots come from the real app: a headless browser opens the app's `?render=1` page, which
signs in as you with a one-off token, opens the model read-only and frames it.

## Setting it up

1. **Firebase key.** Firebase console → project `gen-lang-client-0540185995` → Project settings →
   Service accounts → *Generate new private key*. Keep the JSON file private.
2. **Vercel project.** Import this GitHub repository into Vercel and set **Root Directory** to
   `mcp` (leave "Include files outside the root directory" on). `vercel.json` sets the build.
3. **Environment variables** in the Vercel project:
   - `FIREBASE_SERVICE_ACCOUNT`: the whole JSON key file (or it base64-encoded)
   - `TOKEN_SECRET`: a random string of at least 32 characters (changing it signs everyone out)
   - `ALLOWED_EMAILS`: your Google sign-in email (comma-separate several)
   - `POLYFORM_APP_URL` (optional): where the app is hosted; default `https://gen-lang-client-0540185995.web.app`
   - `APP_BYPASS_SECRET` (optional): if the app is hosted on Vercel behind Vercel Authentication, its
     *Protection Bypass for Automation* secret, so the screenshot browser can open it
   - `PUBLIC_URL` (optional): the connector's own address, if Vercel's isn't right
4. **Allow sign-in from Vercel.** Firebase console → Authentication → Settings → Authorized
   domains → add the Vercel domain (e.g. `polyform-mcp.vercel.app`).
5. **Deploy the app** once so the hosted PolyForm has the `?render=1` page screenshots need.
6. **Add to Claude.** Claude → Settings → Connectors → *Add custom connector* →
   `https://<your-vercel-domain>/mcp`. Claude opens a PolyForm sign-in page; use your Google account.

## When the database is unavailable

Database calls have a time limit (20 seconds for small ones, 45 for opening or saving a whole model), so a stalled Firestore gives a clear
error instead of a silent hang until the host kills the request. Claude itself gives up on a tool call after about a minute. Two tools then keep work from being lost, both saving a `.polyform` file to a **PolyForm** folder in the user's own Google Drive
(open it in PolyForm with File → Open File):

- `build_model` takes the whole build as a list of steps (`{ tool, args }`, the same tools and arguments as calling them one by one), runs
  it in memory with no database (within about 45 seconds) and saves the result. Nothing is stored in Firestore; the model exists only as the file. A step can use an
  earlier result (`"$3.created.0.id"`, or `"$3.created.*.id"` for a list). If any step fails, nothing is saved.
- `export_model` saves a stored model, with its large meshes and images fetched back, so it can be kept or moved.

The Drive permission (`drive.file`, which only reaches files PolyForm creates) is requested on the connector's sign-in page. Google's token
lasts about an hour and the sign-in gives no way to renew it, so it works for about an hour after signing in; when it has run out the tools
say so and ask to disconnect and reconnect the connector in Claude. The token travels encrypted inside the connector's own tokens
(AES-256-GCM, key derived from `TOKEN_SECRET`); nothing is stored server-side. Connections made before this feature have no Drive
permission until they are reconnected once. The Google Drive API must be enabled for the Firebase project's Google Cloud project (the app's
own Drive storage already needs this).

## Improving the rules from a real model

Claude's standing rules, the tool descriptions and the automatic checks are all listed in [`RULES.md`](RULES.md), which
`npm run rules:export` generates from the code. The rules themselves are in `src/rules.ts`; the checks are in
`src/checks.ts` and are covered by `test/building.test.ts`.

To review a model the connector made: ask Claude (in this repo) to read it by name through the connector, list what is
wrong (it reads the objects, rooms, levels and `check_model_health`, and can take screenshots), and propose a change for
each problem as a rule, a check, or both. Nothing is changed in the model or the rules until you approve; an approved
change is added to `rules.ts` or `checks.ts` with a test and `RULES.md` is regenerated. A checked-in `RULES.md` can also be
handed to another assistant for suggestions, which come back as the same "rule, new wording, why" entries.

## Working on it

```sh
npx -y npm@11 install   # npm 10 trips over this lock file; the repo's CI uses npm 11 too
npm test                # tools, sign-in flow, and a real MCP client over HTTP
npm run typecheck
npm run build           # writes .vercel/output
npm run dev             # local server on :8787 with the same environment variables
```

For local screenshots set `CHROME_PATH` to a Chromium (headless-shell) binary.


## MCP vs Developer SDK

The connector is deliberately task-oriented rather than a one-to-one transport for every JavaScript SDK method. It exposes model-safe workflows that make sense remotely (read/inspect, build, draw with the geometry kernel, grade Civil/Terrain Studio state, furnish, edit, preview and undo). Lower-level provider registration APIs such as `sdk.bim.registerGeometryProvider` and `sdk.reconstruction.registerImageProvider` remain Developer SDK capabilities because they require code and/or binary providers in the browser/runtime.

For the complete scripting surface, use PolyForm's Developer Suite → Documentation or `src/components/marketing/sdkFullReference.tsx`. The repository also includes `docs/DEVELOPER_SDK.md` and `examples/developer-sdk-recipes.md`.
