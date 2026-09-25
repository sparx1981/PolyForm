# Where models are stored

Save As offers three places:

| | PolyForm cloud | Google Drive | Trimble Connect |
|---|---|---|---|
| Where the model lives | Firestore document | `.polyform` file in *My Drive › PolyForm* | `.polyform` file in a Connect project folder you choose |
| Size limit | ~1 MB document (large meshes overflow into extra documents) | none in practice | none in practice |
| Live collaboration | yes | no (single user; share the file instead) | no (single user; Connect keeps versions) |
| Claude connector | yes | not yet | not yet |

Every model, wherever it is stored, keeps a small entry in Cloud Models (name, owner and a
`storage` pointer to the file), so all models appear in one list with a badge for Drive/Connect.
Opening a Drive/Connect model downloads its file; edits save the whole file back five seconds
after the last change (and on **Save**). If the account needs signing in again, a yellow banner
offers **Connect**.

The file is the complete project (format version 4): objects, drawn geometry (kernel), timber
framing, terrain edits, environment and materials. **Save File** / **Open File** use the same
format, so version 4 files now round-trip everything; version 3 files still open.

Deleting a Drive/Connect model from Cloud Models removes its entry only; the file stays in Drive
or Connect.

## Setting up Google Drive

PolyForm uses your existing Google sign-in and asks for one extra permission, *See, edit, create
and delete only the specific Google Drive files you use with this app* (`drive.file`). It cannot
see anything else in your Drive.

In the Google Cloud console for project `gen-lang-client-0540185995`:

1. **APIs & Services → Library → Google Drive API → Enable.**
2. **APIs & Services → OAuth consent screen → Data access → Add or remove scopes** → under
   *Manually add scopes* paste the full scope `https://www.googleapis.com/auth/drive.file` →
   **Add to table** → **Update** → Save.

## Setting up Trimble Connect

Until this is done the option shows **Needs setup**.

1. Sign in at the Trimble Developer Console (developer.trimble.com) and create an application:
   - Grant type: **Authorization Code** with **PKCE** (public client, no secret)
   - Callback / redirect URLs (add each place the app runs):
     - `https://polyform-sparx1981.vercel.app/trimble-callback.html`
     - `https://gen-lang-client-0540185995.web.app/trimble-callback.html`
     - `http://localhost:3000/trimble-callback.html`
   - API access: **Trimble Connect**
2. Note the **Client ID** and the **application name** (the name is the OAuth scope).
3. Set these as build-time environment variables where the app is built (the `polyform` Vercel
   project, and `.env.local` for local development), then redeploy:
   - `VITE_TRIMBLE_CLIENT_ID`
   - `VITE_TRIMBLE_APP_NAME`
   - optional `VITE_TRIMBLE_IDENTITY_URL` (default `https://id.trimble.com`) and
     `VITE_TRIMBLE_CONNECT_URL` (default the North America Connect API; your region is found
     automatically)

The Trimble Connect code is written against Trimble's published APIs and tested against a
simulated service, but it has not yet run against a real Trimble account.
