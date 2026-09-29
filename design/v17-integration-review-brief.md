# Root integration review (read-only)

Current MiniBranch contains significant pre-existing V16 work. Review ONLY V17 diff against tmp/v17-baseline, plus new equipment.js, not all git HEAD changes. UI/actors separate reviews already passed; renderer stage still being implemented. No edits/tests/subagents. Report concrete critical/important gaps, source lines and both spec/quality verdicts.

Approved integration contract:
- Each supply H/C or inventory button starts2s mission-time use, speed40; item locks against drop/transfer, consume+heal only at completion; shot/melee/roll/skill cancel, damage alone doesn't; down/stun/offline/end cancel. Host authoritative dedupe, guests receive pending runtime.
- Shield passive6000, first effective attack before HP/O2 damage triggers3s protection and50s cooldown. Roll/no-friendly-fire-invalid hits don't consume shield. Shield is not roll invulnerability: retain knockback/hitstun/flashstun/noise/monster cooldown; normal oxygen drain continues. Single passive slot.
- Magnetic barrier permanent unlock5000,20HP/cd30, firstT blueprint secondT confirm, Rrotate Esc cancel, nearby<=120 placement with door snap. Blocks bodies incl Nightmare, not rays/vision/player weapons/grenades. Monster/Hunter deal1 per .2/.5s; Heavy5+stun3 even if broken. Any player holdE3s within64 andfacing removes, move/release/stun/battle cancels. Unlimitedcount, no old-object expiry. Must not leave monster stuck forever.
- New gunpack direct purchases MG100/$200, mini10/$50, only owned/safehouse, standard conversionunchanged. MG2 damage actually applied Hunter. Enemies no postattackteleport; this is actor-reviewedalready.
- Damage numbers actualHP lost, whiteflash80ms; same shot/target coalesced, no armor falsehits. Casings1 pertrigger8+2s max600; reloadmag whole-magstart only, permanentuntilend, no duplicate on snapshots/rejoin. Cosmetics do not affect bullets.
- V17 protocol/client/servermarker; reliable unique mission/seq events. Unlimited permanent history now segmented into equipment-state-page <32KB with atomic restore+deferred deltas and input freeze while syncing; ordinary snapshot onlyrevision. No repeated old cosmeticburst onreconnect. Shared staterewardprofile local-only, noDBschema.
- Guest map must wait for Host confirmed seeds/scale/difficulty/signature, never local solo fallback. Host drafts remainprivate. Roster compact perweapon totals/carrycounts/equippedabilities updates.
- Profile per difficulty successes/failures; wipe/quit/kick/timeout failures, temporarydisconnectandtraining excluded. Actualstartedmission required, missionIDdedupe including receipt replay, stale tabs don'terase via rewardjournal/locks.
- Only selectedsafehouse sell retained, task sell handlersremoved.

Evidence: new actor36,UI10,equipment6,integration8,supply4,profile3 checks green at timeofdispatch, plus rewards4/lobby14 andsupplyregression3. Old tests abilities/heavy-integration have7 failures exactly matching pre-V17 baseline (oldHP assumptions20vs40,5vs60/90 andmissingSaveRewardsfixture). Do not reinterpret asnewregression without evidence. NewRenderer is separate stage and not complete yet.

Read v17-integration-review.diff, equipment.js and relevant callers as needed. Focus concurrency/input/lifecycle correctness, not styling.
