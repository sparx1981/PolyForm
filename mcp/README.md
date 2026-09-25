# PolyForm connector for Claude

An MCP server that lets Claude read, build in and take pictures of your PolyForm models, even
when the app isn't open. It runs on Vercel and talks to PolyForm's Firebase project.

## What Claude can do

| Kind | Tools |
|---|---|
| Read | `list_models`, `get_model` (counts, extent, wall/fence length, patio/deck area), `list_objects`, `get_object`, `list_catalog` |
| See | `screenshot` (perspective, plan, front, back, left, right; whole model or one object) |
| Build | `create_model`, `add_shape`, `add_room`, `add_wall`, `add_opening` (door/window in a wall), `add_roof`, `add_stairs`, `add_terrain`, `add_plant`, `add_fence`, `add_pond`, `add_patio` |
| Edit | `transform_objects`, `set_appearance` (colour, material presets, plain finishes), `rename_object`, `delete_objects`, `undo_last_change` |

Building uses the app's own code (the scripting library, the roof tool's roof assembly, the
patio, fence and pond tools), so objects come out exactly as if drawn in the app. Changes save
to the model in Firestore and appear live in the app if it's open. The connector only changes a
model's objects (`shapes`), and keeps the last 20 versions per model so `undo_last_change` can
step back.

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

## Working on it

```sh
npx -y npm@11 install   # npm 10 trips over this lock file; the repo's CI uses npm 11 too
npm test                # tools, sign-in flow, and a real MCP client over HTTP
npm run typecheck
npm run build           # writes .vercel/output
npm run dev             # local server on :8787 with the same environment variables
```

For local screenshots set `CHROME_PATH` to a Chromium (headless-shell) binary.
