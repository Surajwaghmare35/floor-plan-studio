# Floor Plan Studio — BIM layer (Phase 1)

Parallel **canonical BIM model** for Floor Plan Studio. It does **not** drive the 2D/3D renderers or exporters yet (Phase 2+).

## Files

| File | Role |
|---|---|
| `model.js` | UUIDs, IFC-oriented types, CRUD, validation, events, JSON serialize/migrate |
| `legacy-convert.js` | One-way converter: legacy grid snap → BIM model |
| `test-bim.js` | Node tests |

## Browser

Loaded from `index.html`:

- `window.FPSBim` — model API  
- `window.FPSBimLegacy` — converter  
- `window.__fpsBim` — last snapshot model  
- `window.__fpsBimJson` — last snapshot JSON  
- `refreshFpsBim()` / **Export BIM JSON** / command palette `bim`

## Node tests

```bash
node bim/test-bim.js
```

## Schema

- BIM documents use `schemaVersion` (current: **1**).
- Legacy editor snaps use `schemaVersion: 0` (absence treated as v0).
- This is **not** certified IFC. Types are named after IFC concepts for a future Phase 10 export path.

## Phase 2 (not done)

Wire renderers/exporters/BOQ to read from this model. Dual-write recommended before cutover.
