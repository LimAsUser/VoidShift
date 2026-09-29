# Live menu validation

## Changed

- Added a real title/preparation navigation flow and seven interactive menu pages based on the approved images.
- Extracted original raster illustrations into resources/images/menu; cleaned background UI using built-in imagegen.
- Reused Game/UIManager operations and save/network formats. Added only menu presentation, selection details, preview controls and scoped styling.
- Reused real prices, balance, ammo, ownership, item matrices, and authoritative lobby state. No sample inventory is installed into the game.

## Verified

- Targeted Node run: **105 passed, 0 failed**.
- Command: `node --test tests/menu-presentation.test.cjs tests/prep-ui.test.cjs tests/warehouse.test.cjs tests/oxygen-backpack.test.cjs tests/coop.test.cjs tests/coop-multiplayer.test.cjs tests/mission-lifecycle.test.cjs tests/inventory.test.cjs`.
- `node --check` passed for js/menu.js, js/game.js, js/ui.js and scripts/sync-game.mjs.
- Unique DOM IDs, existing inline action methods, local image/script/stylesheet references, menu.css brace structure and diff whitespace checked.
- Existing edited CRLF files restored without changing their BOM status; new files use LF.
- Browser route: `http://127.0.0.1:8017` in the approved in-app browser. Title entry, settings open/close, all seven tabs, tutorial previews and return-to-title checked.
- Layout sizes: 1920×1080, 1280×720, 1536×864, 960×540 and 390×844. The latter desktop sizes represent the available CSS space at 125% and 200% browser zoom; the browser zoom setting itself was not changed.
- No page-level horizontal overflow and Start Dive remains visible in the final phone checks. Warehouse action rack and lobby ready/start/leave controls remain visible in the constrained viewports checked.
- Final 1920 browser inspection reported no duplicate IDs, broken loaded images or console errors.

## Screenshots and overlays

Each screenshot is a real browser render, not the original generated image. Warehouse and lobby use temporary presentation-only fixture data; reloading restores the real page. Other pages show the isolated preview origin's new-game state, which intentionally differs from the reference's money/ownership examples.

| Page | Actual screenshot | Half-opacity overlay |
|---|---|---|
| Title | [Screenshot](validation/01-title-1920.png) | [Overlay](validation/01-title-overlay.png) |
| Briefing | [Screenshot](validation/02-briefing-1920.png) | [Overlay](validation/02-briefing-overlay.png) |
| Map | [Screenshot](validation/03-map-1920.png) | [Overlay](validation/03-map-overlay.png) |
| Warehouse | [Screenshot](validation/04-storage-1920.png) | [Overlay](validation/04-storage-overlay.png) |
| Loadout | [Screenshot](validation/05-loadout-1920.png) | [Overlay](validation/05-loadout-overlay.png) |
| Ammo / supplies | [Screenshot](validation/06-ammo-1920.png) | [Overlay](validation/06-ammo-overlay.png) |
| Co-op | [Screenshot](validation/07-coop-fixture-1920.png) | [Overlay](validation/07-coop-overlay.png) |
| Tutorial | [Screenshot](validation/08-tutorial-1920.png) | [Overlay](validation/08-tutorial-overlay.png) |

The original generated references contain non-uniform grid geometry and raster-only typography. The implementation uses functional uniform grid cells and system fonts. Background inpainting also creates small scene differences. Layout/artwork are reconstructed, but **100% pixel-equivalent visual acceptance is not claimed**; typography and some positions/spacing still differ, as the overlays show.

## Not run

- No full test suite, project-wide build/lint, multiplayer live-room session, or actual mission playthrough.
- Purchasing, selling, rotation, transfer, settlement and multiplayer rules were covered by isolated logic tests; browser fixtures were not used to mutate a saved inventory.
- Hover/pressed/reduced-motion rules were source-checked; focus and disabled examples were observed in the browser, not an exhaustive visual-state matrix for every control.
- No commit, push or Sites deployment. The existing dirty MiniBranch changes remain.
