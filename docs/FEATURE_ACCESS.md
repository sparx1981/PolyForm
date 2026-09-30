# New feature access and activation

This file is the user-facing activation map for recently added PolyForm capabilities. New feature work should update this page whenever an entry point changes.

| Feature | Where it is activated in PolyForm | Notes |
| --- | --- | --- |
| WorldView street life (cars, people, birds) | Architecture toolbar → **WorldView** → **Street life**. Choose Off, Quiet, Normal or Busy, then enable **Cars / People / Birds** to show them while editing. Presentation mode also exposes **Street** controls. | Uses imported/drawn road and walking routes. |
| Reconstruction Studio | Top bar / import flow → **Reconstruction Studio**. The AI toolbar **Photo to 3D (AI)** routes into the same studio. | Calibrate a plan, add a locked underlay, run local wall recognition, review, then commit geometry. |
| AI Photo → 3D | AI toolbar → **Photo to 3D (AI)** → choose an object photo → **Generate 3D mesh**. | Requires Settings → API → Hugging Face token. Returned GLB geometry passes through PolyForm asset validation. |
| Interior Studio | Architecture toolbar → **Interior Studio** (armchair icon). | Requires an enclosed room. Choose a furnishing preset and click **Furnish selected room**. |
| Soft bodies and cloth | Architecture toolbar → **Interior Studio** → **Soft furnishings** preset → leave **Settle soft furnishings** enabled. | Sofas and beds use bakeable soft-body settling; curtains use bakeable cloth settling. The result is saved as ordinary deterministic mesh geometry. |
| Pond / lake water | Landscapes toolbar → **Pond / Lake** → draw a closed outline. | The water body digs its own terrain basin by default. |
| Water flow / current | Select an existing pond/lake → Landscapes → **Ponds & Lakes** → **Surface motion**. Choose **Pond / still**, **Gentle drift**, or **Stream / current**. For flowing water set speed, turbulence and direction. | This extends the existing physically based pond/lake water; it does not create a second water system. |
| IFC metadata and geometry adapter | Developer Suite → SDK. Use `sdk.ifc` metadata helpers and register/import through an IFC geometry provider. | Provider-neutral adapter exists. A bundled direct WebIFC/ThatOpen tessellator remains a follow-up until its runtime dependency is integrated. |
| Generated asset validation | Automatic when generated/external geometry is inserted, including Photo → 3D. | Geometry is flattened/validated before becoming a PolyForm shape. |
| Model health checks | Automatically reported by Reconstruction Studio and Interior Studio after committing generated geometry. | Used to surface errors/warnings before further editing. |

## Rule for future features

Every new capability must have at least one explicit user entry point (toolbar, menu, contextual selection control, or documented SDK method). Avoid shipping functionality that is reachable only by internal events or hidden metadata.
