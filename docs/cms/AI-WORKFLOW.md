# PolyForm marketing CMS AI workflow

AI agents must submit marketing changes as a proposal JSON. They must not edit the deployed marketing source or write to Firebase CMS collections directly.

1. In Content management, use **Export for AI** and provide `polyform-cms-snapshot.json` to ChatGPT or Claude Code.
2. Ask the agent to return a JSON proposal with this shape:

```json
{
  "schemaVersion": 1,
  "title": "Feature update",
  "baseRevision": 12,
  "changes": [
    { "path": "copy/c1a2b3", "before": "Existing text", "after": "Proposed text" }
  ]
}
```

`path` must be an exported copy key (`copy/c…`) or an exported media key (`media/…`). A proposal must include the exact `before` value from the snapshot. Do not include HTML, JavaScript, Firestore writes, image uploads, or credentials. Use a new section or page through the CMS when the proposal needs structure; the CMS validates those edits.

3. In **AI proposals**, import the JSON. Review each before/after pair. Conflicts are disabled automatically when the administrator has changed the same field since export.
4. Apply selected changes to the unsaved draft, edit as needed, **Save draft**, inspect **Preview**, then **Publish**.

The repository can enforce this convention with review checks, but an agent that has unrestricted deployment credentials can still bypass any client workflow. Keep Firebase rules and deployment credentials restricted to the administrator and CI service that needs them.
