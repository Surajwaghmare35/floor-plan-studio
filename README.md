# Floor Plan Studio

Open-source, single-file floor plan editor that runs entirely in the browser.

Draw walls, doors, windows, furniture, and rooms. Analyze the plan, compare saved versions, and share a view-only or editable link — no server required for basic use.

## Demo

Open [`index.html`](./index.html) locally, or host it on any static site (S3, CloudFront, GitHub Pages, Netlify, etc.).

## BIM layer (Phase 1)

Additive parallel model in [`bim/`](./bim/) — stable UUIDs, IFC-oriented types, JSON serialize, legacy→BIM converter. **Does not** replace the grid editor or exporters yet. Run `node bim/test-bim.js`. Export via **Export BIM JSON** or ⌘/Ctrl+K → `bim`.

## Features

- Wall / door / window / loft / stairs editing
- Furniture + room templates + room library
- Multi-select move / rotate
- **Inspect** properties panel + structure/room tree (isolate room)
- **Measure** distance, angle, and area
- **Markup** arrows, clouds, text (included in share/JSON)
- Named views (zoom + layers + 3D presets)
- 3D orbit (drag yaw/pitch, top/iso presets, view cube)
- 3D door/window anim — all, one opening, or one room’s openings
- Toggle building slab / bath mini-slabs in 3D for a clearer view
- Architectural L×B dimensions (feet-inches) + areas (persist across reload)
- Site canvas: legal plot 84′×39′, building 34′6″×52′, setback 2′3″ (N/S/E), west gate
- 3D stack 7′ + 0.5′ loft + 3′ = 10.5′ · compound wall 5′ · stairs · porch rail
- Solar study (lat/lon/date + shadows) · first-person walk · finish variants
- Export AutoLISP (.lsp) · OBJ (3D) · standalone shareable 3D viewer HTML
- Flythrough along recorded walk · command palette (⌘/Ctrl+K) · global rename · sheet notes
- Layers: daylight, sun-by-hour, circulation heat, clash check, night mode
- **Analyze** scorecard (areas, egress, kitchen triangle, clashes)
- Named versions with ghost overlay + half-screen compare
- Themes: System / Dark / Light / Mint
- Share links (plan embedded in URL) or load from `?planUrl=`
- Export PNG, DXF, print/PDF sheet, JSON backup

## Quick start

```bash
# clone
git clone https://github.com/<you>/floor-plan-studio.git
cd floor-plan-studio

# open in browser (any static server works)
python3 -m http.server 8080
# then visit http://localhost:8080
```

Or simply double-click `index.html`.

## Sharing

| Action | Result |
|---|---|
| **Copy share link** | Others open your plan (editable in their browser only) |
| **View-only link** | Read-only: zoom, layers, analyze, export |
| **Download JSON** | Host the file and open with `index.html?planUrl=https://.../plan.json&mode=view` |

Edits are stored in the visitor’s browser (`localStorage`) unless you add your own backend later.

## Hosting

See [HOSTING.md](./HOSTING.md) for a private S3 + CloudFront pattern (or use GitHub Pages).

## Privacy

- No accounts, no telemetry, no external API calls by default
- Plans stay in the browser or in the share URL / JSON you distribute

## License

[MIT](./LICENSE) — use commercially or personally; attribution appreciated but not required beyond the license text.
