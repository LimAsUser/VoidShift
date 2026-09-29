# V17 renderer stage report

## Changed

- `js/renderer.js`: laser is red at alpha 0.35, approximately one CSS pixel after camera/display scaling, with no glow. Existing world ray endpoint and transforms are retained.
- Enemy hit flash overlays a cached white alpha mask made from the actual sprite with native canvas `source-in`; actor and authoritative corpse record `hitFlashUntil` control expiry. Discovery `!` and 0.9-second floating/fading damage numbers reuse the existing point visibility helper and the final fog pass. Reduced motion keeps damage labels static.
- Local and remote active shields use faint cyan fill/outline without lighting or collision effects.
- Placed barriers use the generated barrier raster, health text, and their supplied footprint. The local blueprint rotates for vertical placement and is tinted cyan or red from `valid`.
- Casings stay opaque for eight seconds then fade for two; magazines remain rendered until game state removes them. Both are viewport/vision culled and drawn below actors. Initial 0.3-second bounce is disabled for reduced motion.
- Room lights now use a bounded room-local distance-to-line field rather than three source-over radial samples per strip. Normal and faulty strip geometry is cached, contributions combine with `max`, and each visible room erases fog once. Strength at a strip is 0.72; at half its range it is 0.01125. Identical overlapping strips have the same values as a single strip.
- Maximum field axis is 128 cells, with nominal eight-world-unit cells for ordinary rooms. Normal fields are uploaded only once; faulty intensity recomposes cached numeric fields without new geometry/rays/canvases. Room shape, observer forward visibility, walls, closed doors, flashlight, existing fog and blackout precedence remain in the existing paths.
- World/full-map terminals, searchable crates, grenade throws and legacy collectible representations use `equipment-v17` art. `BackpackManager.imageFor` supplies collectible images. Monster, crew, ship, facility and main-menu artwork are unchanged.

## State API

No new external draw call is required. Existing `Renderer.draw` and vision/overlay calls consume:

- `actor.hitFlashUntil`, `actor.discoveryTimer`, local/remote `shieldUntil`.
- `state.damageNumbers`: `{ key, x, y, radius, amount, born, shotId }`; shot coalescing belongs to equipment/game code.
- `state.barriers`: `{ id, x, y, w, h, hp }`; `state.barrierBlueprint`: corresponding footprint plus `valid` and `vertical`.
- `state.casings`, `state.magazines`: `{ id, x, y, angle, born, weaponId }`; retention/reset/sync belongs to equipment/game code.
- `state.corpses` additionally accepts `hitFlashUntil` for lethal-hit flash. Game/equipment owns matching records by `effectKey` and propagating the timestamp.
- `room.lights` static strip geometry/state and `state.powerLossStartedAt`/`elapsed` retain their existing contracts.

## Verification

- RED: after correcting the canvas fixture's missing `style`, the initial new test run had nine expected feature assertion failures and one existing visibility characterization pass.
- Lethal corpse RED: focused `node --test --test-name-pattern="lethal-hit corpse" tests/v17-renderer.test.cjs` failed on the expected absent corpse mask before the two-line production extension.
- GREEN: `node --test tests/v17-renderer.test.cjs` passed **12/12** in the final run. The tests use real attenuation/cache helpers and the existing map/entity visibility logic; native canvas draw/composite calls are recorded by a small canvas double.
- `node --check js/renderer.js` exited 0.
- Renderer original CRLF/no-BOM format restored after incremental patches introduced mixed endings; final check: 2051 CRLF, zero bare LF, no BOM. New test/report files use LF/no BOM.
- Additional localized regression command: `node --test tests/v17-renderer.test.cjs tests/vision-rendering.test.cjs tests/enemy-v15-rendering.test.cjs` returned **24/27** before the extra mask-sharing test was added. All ten new tests passed in that run; three older assertions failed:
  - `enemy-v15-rendering.test.cjs`: **faulty strips vary slowly, cache contributions, match tubes and obey reduced motion and blackout** expects separate normal/flicker fog erases `[1, .5]`. V17 intentionally uses one max-composed field, so this assertion must be updated by its owner.
  - `vision-rendering.test.cjs`: **living Hunter and stunned Heavy have red circles, while sleeping Monster retains only its status** and **all living enemy bodies have red circles underneath, corpses hide them and waking restores them** use `selectedDifficulty: 'normal'` and expect rings. Existing dirty V16 code already restricts rings to `'easy'`; those branches were not changed here.

## Limitations and not run

- No full suite, project build, project linter, browser playthrough, pixel-rendered screenshot QA, or publishing was run.
- Canvas tests establish drawing/compositing contracts and numeric lighting behavior, not visual acceptance on a real GPU/display. Generated barrier image was visually inspected; it has a dark opaque background and is scaled inside the collision footprint.
- Feedback visibility uses the existing shared point helper, and final fog is still applied after world/overlay rendering. This preserves existing perception behavior rather than introducing a second sight system.
- Live/down actor paths and the authoritative corpse registry honor `hitFlashUntil`. Root game/equipment code owns propagation and stable `effectKey` matching; renderer supports the supplied absolute mission timestamp.

Only renderer, the new V17 renderer test, and this report were edited by this worker. Other workers' dirty changes were preserved.
