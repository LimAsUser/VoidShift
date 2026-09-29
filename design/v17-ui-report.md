# V17 UI implementation report

## Changed

- Removed the three all-sale controls from safehouse storage/backpack and field inventory. Selected sales, transfers and all-deposit remain.
- Added configuration-driven missing weapon cards in the existing primary/sidearm sections. Machinegun and mini-shotgun equip their configured slots; existing four weapon cards remain.
- Added reusable dedicated ammo purchase cards for `Config.ammo.weaponPacks`, calling `game.purchaseWeaponAmmo(id)`. Ownership, funds and mission locks disable purchasing. Standard conversion includes only keys with positive `Config.ammo.standardUnitsPerRound`.
- Added `ui.updateEquipmentStatus(player, state, partyEntries)`: two-second supply progress, three-second barrier removal, fifty-second shield cooldown/active status and teammate HP/oxygen/downed/revive/supply/shield status. Party card DOM is rebuilt only when seat identities change.
- Extended lobby equipment rows with individual weapon totals, oxygen bottles, medkits, skill and passive from host/member summaries, retaining loadout fallback, ready state and latency.
- Guest map chooser uses the authoritative `getMenuPreviewMap` result, displays synchronization/error states for missing/incompatible maps, clears stale previews and does not construct a local fallback. Incompatibility disables readiness and start. Host map drafts remain local.
- Removed visible enemy preview names; accessible image alt/title names remain. Images increased from 30x30 to 45x45 in chooser and lobby.
- Added personal records inside Settings, with easy/medium/hard successes and failures. Records refresh on settings opening and records-section selection, and `updatePersonalRecords(records)` is callable directly.
- Routed preparation, runtime HUD, inventory, LOADOUT, ability, shop and terminal UI art to `resources/images/equipment-v17/`. Flashbang retains its existing reference. Added six-weapon/timed-supply/shield/barrier controls to help without changing lesson definitions or borrowed equipment.
- Loaded `js/equipment.js?v=1` before `js/game.js?v=24`; network is `v=17`, UI `v=23`, menu `v=17`, inventory `v=4`, styles `v=14`, menu styles `v=22`. Root-owned script cache versions remain for root.

## Inspected / verified

- Scoped UI, menu, inventory, HTML, UI styles, existing UI fixtures and the documented Config/Game/Equipment contracts.
- `node --test tests/v17-ui.test.cjs`: 10 passed. Tests cover configuration slot/equip behavior, direct-ammo purchase locks, standard-conversion separation, timer progress, retained party DOM, per-weapon summary/records, Guest synchronization, mismatch locks, unified inventory art and shared left-HUD markup ownership.
- `node --test --test-name-pattern='host lobby displays|pending connection disables' tests/coop-lobby-lifecycle.test.cjs`: 2 passed.
- `node --check js/ui.js`, `node --check js/menu.js`, `node --check js/inventory.js`: passed.
- Source comparison confirmed the protected title region was preserved after normalizing line endings for comparison. All-sale handlers are absent from HTML and equipment loads before Game.
- Original no-BOM state preserved. UI/inventory/HTML/styles retain CRLF; menu/menu styles/new test/report retain LF. Only modified files with mixed endings were normalized.

## Remaining boundary / not run

- No browser or gameplay visual QA, full project tests, build, lint, dependency installation, commit or publish.
- An attempted full run of the scoped `tests/coop-lobby-lifecycle.test.cjs` hit the failing case `a normal guest stays guest and connects only when both game channels open`; the following asynchronous case did not finish, so that run was interrupted. Its room fixtures still use protocol 16 at lines 140 and 161 while runtime is now 17. Those existing tests were outside this task's edit ownership and were left untouched. The separate UI-only cases above passed.
- Generated image files and renderer behavior are separate stages; no claim of final art availability or visual acceptance is made here.

## Root integration hooks

- Call `ui.updateEquipmentStatus(player, state, partyEntries)` during rendering, with the documented party entries. Use `player.supplyUse`, `player.barrierRemoval`, `shieldUntil`, `shieldReadyAt` and mission `state.elapsed`.
- Supply `coop.hostSummary` / `member.summary` with `{ weapons: [{ id, magazine, reserve, total }], oxygen, medkits, skill, passive }`; summary fallback is supported.
- Provide `game.purchaseWeaponAmmo(id)` and `game.getPersonalRecords()`; root confirmed these hooks are implemented.
- Game's direct prepared-equipment art paths must use the unified image folder; root confirmed its direct weapon paths were updated.

## Protected main menu

No cockpit/background/layout/animation, crew/facility/monster sprite paths or title buttons were changed. Currency replacement is restricted to preparation/runtime content, with a title-specific guard in the shared currency renderer. New CSS addresses the new UI and existing equipment/terminal surfaces.

## P2 short-height HUD follow-up

- Confirmed the source-level cause: top-anchored party cards and bottom-anchored equipment status used independent absolute positions, allowing overlap around 700x400 with three teammates and both supply/shield visible.
- Grouped vitals, party, equipment status and ammo in one `hud-left-column`. At heights of 650px or less, these panels share a viewport-bounded flex column and use normal flow. Compact teammate rows, single-row progress meters and compact ammo spacing make room for simultaneous status. The teammate list may shrink and scroll in smaller spaces, while equipment/vitals/ammo retain their space. Tall-screen positioning is preserved through `display: contents`.
- Added a failing structural regression first, then verified the complete targeted UI file: 10 passed. The regression parses actual HUD markup, checks balanced non-void tags and ensures all four panels share the same parent. It does not measure browser rectangles.
- Scoped check found no self-closing `aside` tag in `index.html`; no broad HTML cleanup was performed.
- Root will verify 700x400 browser geometry with three teammate cards, supply progress and shield together. No browser acceptance is claimed for this follow-up.
