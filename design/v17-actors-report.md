# V17 actors/config report

## Changed

- `js/config.js`: requested original weapon intervals and magazine reload durations; machinegun and mini-shotgun definitions; dedicated ammo pack metadata; barrier skill and shield passive; Heavy charge damage 5. New art paths use `resources/images/equipment-v17/<id>.png`.
- `js/entities.js`: dynamic default weapon ownership; supply/shield runtime state; supply cancellation and movement; magazine reload serial; actor contact cooldowns; Hunter damage argument; quiet-target discovery timers; barrier-aware Nightmare movement and Heavy charge collisions.
- `tests/v17-actors.test.cjs`: focused real-actor behavioral checks.
- This report. Existing user edits and files owned by the root agent were preserved.

## APIs and integration contracts

- `Config.weapons.machinegun`: primary, price 15000, magazine 100, initial reserve 0, interval 0.3, full magazine reload 10, automatic, damage 2, penetration 1, hip spread 0.52, aim spread 0.26; SMG recoil/noise.
- `Config.weapons['mini-shotgun']`: sidearm, price 3000, magazine 2, initial reserve 0, interval 0.3, shell reload 1, semi-automatic, 3 pellets, damage 1, total hip cone 40 degrees and aimed cone 20 degrees; shotgun recoil/noise.
- `Config.ammo.weaponPacks.machinegun = { unitsPerPurchase: 100, pricePerPurchase: 200 }`.
- `Config.ammo.weaponPacks['mini-shotgun'] = { unitsPerPurchase: 10, pricePerPurchase: 50 }`.
- Original `Config.ammo.standardUnitsPerRound` remains limited to pistol/SMG/revolver/shotgun, preventing standard conversion into or out of either new weapon.
- `Config.skills.barrier`: price 5000, cooldown 30. `Config.passives.shield`: price 6000, cooldown 50, duration 3. Existing armory normalization retains permanent ownership without equipping these automatically.
- Player reset initializes `supplyUse = null`, `shieldUntil = 0`, `shieldReadyAt = 0`. Root may assign `supplyUse = { itemId, effect, endsAt }`; while present, movement speed is 40 and sprint cannot consume stamina. Accepted shooting, melee, and roll clear it; rejected attempts preserve it. Down/stun clear it on update, including a stun that fully expires in that update. Positive flash stun clears it immediately. Health loss alone does not clear it.
- `Player.reloadSerial` starts at 0, survives resets of the same actor, and increments once when a full magazine reload successfully starts. Shell loads, rejected reloads, and reload completion do not increment it.
- `Hunter.registerHit(amount = 1)` subtracts the supplied nonnegative numeric damage; death/revive rules and result shape remain intact.
- `Hunter.attackCooldown` and `Monster.attackCooldown` initialize to 0 and decay in seconds. Successful contacts set 0.5 and 0.2 respectively. Wall/roll rejection leaves the cooldown available. A small numeric tolerance avoids FPS-dependent floating point drift. Contact hits no longer relocate either actor; activation relocation and Nightmare sleep behavior remain intact.
- Hunter/Monster/Heavy `discoveryTimer` initializes to 0. A quiet target (`player.noise < 30`, not aggregate noise) transitioning the actor from unalerted to alerted sets it to 1. Normal active updates, flash stun, and Hunter/Heavy corpse updates decrement it. Ambusher sight activation uses its actual viewer. Heavy also decrements it when the current target is downed/missing.
- Nightmare checks optional `map.movementBarrierAt(x, y, radius)` along its segmented chase and stops at the barrier; existing slow phasing through ordinary walls remains.
- `recoverStuckPursuer` checks the full radius-aware nudge path, preventing jumps through thin obstacles.
- `Heavy.canChargeFrom` uses `map.blocked(x, y, radius, false, true)` for charge clearance. Fourth argument retains existing `ignoreDoors` semantics; fifth means ignore movement barriers only. Static wall visibility and clearance remain required.
- A Heavy charge impact includes `result.wallImpact.barrierId` when `movementBarrierAt` returns a barrier at the blocked next position. Existing 3-second stun remains; root applies barrier damage and debris effects.

## Verification

- RED base run: after fixing the audio fixture, 27 of 30 tests failed on missing/wrong behavior; three existing preservation checks passed. Initial fixture run had 28 failures including one fixture error, which was repaired before production changes.
- GREEN base run: all 30 tests passed.
- RED barrier/corpse integration run: 5 of 36 tests failed on Nightmare barrier crossing, thin-obstacle nudge, Heavy charge clearance, corpse discovery decay, and downed-target discovery decay.
- GREEN final focused run: all 36 tests passed with `node --test tests/v17-actors.test.cjs` on Node v24.19.0.
- Focused checks cover 30/120 FPS attack cadence, independent actor cooldowns, walls/roll immunity, full and shell reload behavior, reserve persistence, easy pistol-only infinite reserve, supply interruption, and serial behavior.
- Syntax checks: `node --check js/config.js`, `node --check js/entities.js`, and `node --check tests/v17-actors.test.cjs`.
- Existing source CRLF and no-BOM status preserved; only modified source files normalized after patches introduced mixed endings. New test/report use LF without BOM.

## Root-owned remaining integration

- Dedicated pack purchasing, skill/shield runtime, task-end cleanup, supplied item consumption, multiplayer state replication, presentation and art files remain with root/other workers.
- Pass the shooter's damage into Hunter bullet hits in `game.js`; actor support now accepts it.
- Root map implementation must retain/add the documented fifth `blocked` argument and `movementBarrierAt` hook. Heavy impact damage is emitted as an ID hook, not applied by actors.
- Root consumes `reloadSerial` for magazine debris and cancels supplies on accepted skill activation.
- No full suite, build, lint, dependency install, browser/play-feel QA, commits, pushes, or publishing were performed.
