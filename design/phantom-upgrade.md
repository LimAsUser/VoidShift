# Phantom-style presentation upgrade — execution ledger

## Approved scope

User-approved plan: preserve MiniBranch's uncommitted work, the 2D engine, instant movement and all gameplay numbers. Do not change main menu/safehouse/HUD layout, protocol V20, saves, online DB, Audio V2, monster art or map geometry. No commits, pushes, publication, full test suite or new production dependencies.

## Locked contracts

- Camera: normal 1.25, aim 1.375, exponential zoom/look time constants 0.10s, maximum look 15% per axis. Initialize correct zoom; zero-dt pointer events only recompute aim. Existing UI locks/recoil/inverse transform remain. Reduced motion has instant zoom, no new sway.
- Visibility: Config.player.poweredRoomVisionRange = Math.hypot(900,602)/1.56; both actor discovery and renderer use it, independent of camera. Flashlight420/off126/half-brightness,74 near visibility and wall/door clipping remain.
- Movement unchanged: walk70/sprint150/aim38.5/supply40/down20. No velocity/braking/turn-rate changes.
- New art namespace player-tactical-v1: upper-short.png, upper-long.png, legs-idle.png, legs-walk.png. True overhead, right-facing deep blue-gray astronaut, light blue details, transparent PNG. Upper grip layers and legs share normalized hip anchor (.5,.5),40-world-unit square; crop/anchor metadata may be calibrated against real generated alpha before delivery. Six existing guns and V20 downed pose retained.
- legs-walk is4 columns x4 rows: forward/backward/left/right;4 phases per row. All artwork faces right; rows depict relative motion, not4 camera directions. Forward abs(relative angle)<=45deg; backward>=135deg; otherwise signed left/right. Actual displacement advances phase by distance/8.75 normally or distance/12.5 for sprint; idle/stun/pause/reduced-motion/teleport respected.
- PlayerArt.pose retains numeric0 idle,1..4 motion and5 downed; poses cache records motion mode separately. PlayerArt.reset(identity?) clears an actor or all histories. Mission change, same-mission rejoin/large correction/member removal must reset history. Local aim immediate; existing remote angle interpolation remains.
- Scene work is cosmetic: quiet broad floor panels, raised wall edge and short shadow. Static caching remains; low quality skips new art, missing/incomplete/zero-size art falls back to the existing arrow. Do not alter actual walls/doors/collision/lighting or obstruction.

## Ownership and preflight

- Camera worker: config.js, entities.js, Game.advanceCamera and camera initialization only; camera/vision-specific tests. Root will synchronize the renderer's powered range after renderer worker finishes.
- Player-art worker: player-art.js and its focused tests only. Root creates PNGs, wires Game history resets and renderer integration after workers finish.
- Environment worker: renderer floor/wall/cache drawing and focused tests only, not camera/player/vision methods.
- Root: images/metadata, integration/cache versions, isolated previews, targeted verification, one independent read-only review, local LAN build/verification and handoff.
- Ruling: use current MiniBranch directly rather than create a worktree; keep user dirt and avoid all Git mutations. Use targeted suites rather than skill-default full-suite/commits, as explicitly required by the user.

## Progress

- Setup: approved plan and current source inspected. Original source copies retained under ignored .wrangler/phantom-before-v1 for real-renderer before/after comparison; they are not rollback operations.
- Camera: complete; focused RED3 pass/7 expected failures became GREEN10/10. Added a further fixed-world-target check over desktop/narrow sizes and100/125/200% CSS scaling equivalents; final camera suite11/11.
- Player art/animation: complete; original PNGs generated/inspected/copied,18/18 tests after RED→GREEN. Four PNGs total3,240,971 bytes. Old body/weapon assets retained.
- Environment: complete;6/6 scene checks after RED→GREEN. Floor buffers remain cached, door gaps and true wall endpoints preserved, low-quality branch unchanged.
- Integration: complete;10/10 real-Game/PlayerArt history checks after RED→GREEN, plus existing co-op/LAN checks. Script cache tags now config11/entities12/player-art2/renderer17/game29. No message or save format changes.
- Independent read-only review: complete; compared the five modified production files with the preserved pre-change copies and traced direct callers. No new Critical/Important/Minor issues reported. Reviewer did not independently run tests or perform device acceptance.
- Final targeted batch:155 passed across camera/art/history/scene/vision/starship/ambush/combat/LAN/performance files. Native built Worker four-member/eight-WebSocket/receipt integration test:1 passed. Syntax, scoped line endings,355 unique DOM IDs, references and scoped diff checks passed. Current-assets local build succeeded;4 PNGs verified in built output.
- Radmin local verification: service started on26.134.249.221:8787, V20/LAN_WS_V20/maxPlayers4 readiness200; current script tags, all4 PNG signatures and existing ambience200 verified. No pending local migrations. Service stopped normally and temporary host credential removed; no firewall or online data changed.
- Real second-PC Radmin acceptance requires a second participating device; do not claim local simulation proves it.

## Rulings and acceptance evidence

- Ruling: generated walk figures fill more of their source cells than the idle layer. Keep source PNGs untouched and calibrate a20-world drawing quad plus16 pivots to the same hip seam, inside the original40-world actor frame. This changes only image composition, not origin/hitbox/rays. Every phase's seam is tested and browser-inspected.
- Ruling: update stale nearby fixtures rather than old gameplay: red-ring cases explicitly use easy difficulty; lighting checks the actual cached distance field rather than removed gradients; grenade art/range expectations use the existing equipment-v17/120-unit rules; ambush map fixture loads its existing BackpackManager dependency. No tests removed or production rules restored to old behavior.
- Original built-in generation prompts/selected file IDs and alpha assembly notes are in resources/images/player-tactical-v1/README.md. Rejected full-body/side-view candidates are not runtime resources.
- Actual Game/Renderer training capture, identical initial ship/position: design/phantom-before.png and design/phantom-after.png,1280×720. Captures composite the real world and vision canvases; DOM HUD/tutorial panels are intentionally not included. Profiles used separate QA save/journal keys and no online API.
- Browser inspected six guns/four facing directions/movement rows/downed; actual task startup at1280×720,1920×1080 and390×844;1024×576 and640×360 effective layouts represent125/200% at1280 baseline. Fixed-world projection is also checked mathematically at those scales. Native Edge/Chrome toolbar zoom was not verified.
- Low quality was switched through actual in-task settings: arrow/plain floor appeared immediately, then high quality restored. Zero-sized startup guards pass. Fresh QA page logged no errors after the preview allowlist was corrected for the existing ambience filename's spaces; production audio was not edited.
- Reduced-motion logic is covered by unit tests. A temporary browser media emulation was applied and removed, but its key-hold automation waited abnormally long; no keyboard-feel or timing acceptance is claimed from that interaction. Actual player feel remains for manual playtest. Temporary viewport overrides were reset; QA tabs/server were closed.
- Static training-room CPU draw submission sample,10 warmup calls then120 draws at1280×720: before mean0.732ms/P951.000ms; after mean0.962ms/P951.400ms, approximately+0.230ms mean. This is one local static-scene sample, not GPU completion time, AI simulation, a memory peak, large-battle performance or an FPS promise.
- No full suite, commit, push, Site publication, online migration or new production dependency. The only build was the existing local LAN workflow.
