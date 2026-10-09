# Redesign canvases (read-only snapshot, 9 Oct 2026)

A snapshot of the owner-approved Claude Design canvases and the HalalGoes design system,
taken so build agents can read every board offline. **Data branch: never merge into main.**
Claude Design remains the source of truth; re-mirror rather than edit.

- `canvases/<app>/<canvas>/project/*.dc.html`: one file per artboard; `canvas.json` is the index and holds notes to builders.
- `canvases/<app>/<canvas>/project/ds/`: the design-system copy pinned inside that canvas (may be older than the live one).
- `canvases/design-system/claude-design-system/project/`: the live design system (`README.md`, `tokens.json`, `components/<Name>/README.md`, `components/bundle.js`).
- `canvases/shared/round-2-changes/`: the owner's round-2 changes summary.
- `canvases/INDEX.json`: source URL, version and a summary of each canvas.
