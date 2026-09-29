# Combat equipment V17 execution ledger

Source: user-approved plan, 2026-09-29. Work in current MiniBranch. No commits, resets, checkout, stash, publishing, online migrations, production dependencies, full test suite, or Audio V2 integration. Preserve pre-existing changes and title/menu art/layout.

## Tasks and ownership

1. Config/entities: six weapon definitions, enemy attack cadence/no post-hit teleport, actor supply movement/cancellation hooks, shield runtime fields; targeted actor tests.
2. Game integration: timed supplies, shield damage, barrier deployment/collision/removal/AI, authoritative events and V17/reconnect, preview authority and local profile; root owns game.js and network/server integration.
3. Presentation: image assets, rendering hit/debris/shield/barrier/lighting, UI shop/ammo/lobby/team/profile and selected-sale-only; staged ownership handed to workers.
4. Verification: focused regression and independent read-only integration review, no full suite.

## Interface/preflight checks

| Tasks | Shared contract | Decision |
|---|---|---|
| 1 / 2 | Player runtime and new weapon ids | machinegun, mini-shotgun; supplyUse={itemId,effect,endsAt}; shieldUntil/shieldReadyAt use mission time; root controls completion and damage. |
| 1 / 3 | Art paths / actor hit effects | Versioned resources/images/equipment-v17, no overwrite of old title/shared assets. |
| 2 / 3 | HUD/barrier/feedback state | Presentation reads authoritative state; no visual effect modifies aim or damage. |
| 2 / 4 | Persistence and sync | V17, unique action/event IDs, mission profile dedupe; no new database schema. |
| 1 | Whole-magazine old shotgun/revolver versus mini | Old shotgun full reload 1s, revolver full reload 2s; mini only shell-by-shell 1s. |
| 2 | Unlimited permanent entities versus finite performance | No silent barrier/magazine cap; spatial indexing/culling and chunked reconnect. Short-lived casings cap 600. |
| 3 | All item art versus protected main menu | Replace consuming item/fixture paths; retain title cockpit/background/crew/monster/facility images. |

## Progress

- Baseline: MiniBranch, already dirty V16 work. No applicable on-disk AGENTS.md found in root/parent or scoped tree; user-provided instructions apply.
- Skills: TDD, imagegen, minimal-change and subagent-driven execution. User boundaries override skill commit/full-suite/worktree defaults.
- Task 1 complete: actor/config implementation, 36 focused tests; independent read-only review passed.
- Task 2 complete: game/controller integration, timed supplies/shield, dynamic barriers, V17 reliable paging, preview authority, personal records. Read-only integration review found three issues; regression tests reproduced them and fixes passed scoped re-review.
- Task 3 complete: 20 generated item/fixture PNGs, updated shop/HUD/inventory/renderer, protected title art. UI review's short-height overlap fixed and re-reviewed; renderer review passed including lethal corpse flash.
- Task 4 complete: 123 focused tests in the final main run, plus 8 adapted lighting/render regression tests passed. 13 JavaScript and 2 TypeScript syntax checks, 334 unique DOM IDs, zero missing static resource references, whitespace/line-ending/BOM checks passed.
- Browser: local isolated origin, temporary in-memory fixture with persistence disabled; actual views 1280x720,700x352,390x796. White flash, damage number, discovery, shield/barrier art and HUD observed. Test overrides cleared by reload; viewport reset and temporary local server stopped.
- Browser budget sample: 400 barriers,2000 permanent magazines,600 casings; 30 render calls median3.3ms/max8.9ms; equipment JSON186583bytes. This is a fixed-view local render measurement, not multiplayer FPS certification.
- Known pre-existing regressions: 7 abilities/heavy-integration failures reproduced against captured pre-V17 sources; 2 legacy vision ring expectations also fail against baseline. Left outside this task; details in v17-delivery.md.
- Not run: full suite/build, live multiplayer across devices/Internet, actual browser200percent zoom, publication, commits, online migrations.
