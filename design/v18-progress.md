# V18 execution ledger

Plan: user-approved VOID SHIFT V18, 2026-09-29. Work in current MiniBranch, preserving existing dirty V17 work. No commit/push/publish/reset/checkout/stash, online database changes, new dependencies or full test suite. Existing title artwork/layout and unapproved Audio V2 remain untouched.

## Tasks

- [x] 1. Balance/cadence: easy Hunter HP2 counts10/16/24 respawn2/3/4 every30; medium HP3 counts14/18/30 respawn4/6/8 every30; hard HP5 counts24/34/50 respawn6/8/10 every20. Nightmare HP1/3/5 sleep40/30/20 counts1/1/1,1/2/3,2/3/4. Heavy medium HP10 counts2/3/4; hard HP20 counts3/4/5, no easy. Existing count multiplier1/1/1.5/2, HP unscaled, Heavy replenishes max1/wave. Final terminal immediate table Hunter wave+max1Heavy; reset normal interval. Extraction call waits20/40/60, medium/hard interval10 thereafter. Training separate8s.
- [x] 2. Settings/progress: overall and background ambience volumes0-100 default100; hide proximity interaction key hints defaultfalse, preserve progress/QTE/objectives and training hints. Local permanent advanced unlock only formal solo standard medium+medium success; frozen start context. Guest follows Host without personal unlock. Existing death/sleep-cycle ledger counts add lifetime totals idempotently; no guessed history.
- [x] 3. Feedback/corpses: shake6CSSpx/.24s/range500, motion-reduced off, no aim influence; unified existing injured MP3 host-authoritative de-duped. All players existing host cyan. Flash/grenade radius120 maxthrow600 min50. True Hunter death4-6 fragments, Heavy6-8; pending revive intact, Nightmare sleep intact. Soft player nudges, no blocking/slowdown/AI/hit collision. Walls/doors contain fragments; settling/sleep, blood/debris bounded by existing40/100/200 render limit and200host registry. Host seed/state, moving updates only, rejoin no historical burst.
- [x] 4. V18 protocol/cache, focused tests, readonly review, browser QA if available; report explicit limitations.

## Preflight/shared interfaces

| Tasks | Contract | Resolution |
|---|---|---|
| 1/2 | Standard profile qualification versus new preset migration | One V18 migration overwrites specified balance fields, preserves other assets. Qualification snapshots full standard-profile equality at formal start. |
| 2/3 | Profiles/receipts | Existing SaveRewards journal+WebLock; separate result and defeat finalization so early pending results do not freeze zero counts. |
| 1/3 | Nightmare HP vs old hit counter | Real HP accepts damage amounts; sleep retains existing sleepCycle ledger; wake restores maxHP. |
| 3/4 | Corpse registry/reconnect | Extend bounded existing corpse records, static seeds plus moving poses, no collider insertion into map. |
| 2/4 | Local entitlement vs Host mission | Persist own preference separately; session-effective Host access never grants local unlock. |

Baseline captured under tmp/v18-baseline. Scoped inspection found no applicable on-disk AGENTS.md; user instructions apply. Inline implementation with focused TDD; independent read-only final review. User restrictions supersede skill commit/full-suite/worktree defaults.

## Implementation evidence

- Balance, progression, audio, UI, corpse geometry/physics and rendering each received failing-first targeted tests; six V18 suites currently pass21 checks, integration suite adds5 passing checks. Eleven training lifecycle regressions plus twelve selected V17 supply/debris regressions pass.
- Runtime fragments use existing live sprites with seeded polygon clips, no new raster art/dependencies. Host physics uses existing EntitySpatialGrid and sleep tracking. Per-peer moving-pose queues coalesce by corpse ID, respect64KB buffered budget, batch16 bodies and retain final poses until sent; rejoin synchronization delays pose flushing until scene restoration ready.
- Corpse feedback is a cosmetic soft interaction only: players never change position/speed from collision with fragments. Main menu layout/art untouched.
- Final read-only review completed; browser/performance checks completed for the local controlled scenarios documented in v18-delivery.md. Real cross-network multiplayer remains unverified.
- Independent read-only review found2 important edges. Regression tests first reproduced locked Guest offline-choice trapping and fragment/blood edges crossing walls. Fixed by central offline choice restoration and conservative full-fragment bounds (including rotation), radius-aware stain placement. Focused14 checks pass after fixes.
- Browser inspection additionally reproduced hidden=true difficulty-modified label still rendered due existing CSS display override; scoped hidden selector added so standard-preset qualification is not misleading.
- Ruling: In very narrow spaces, find a nearby clear position within the same room; only if necessary reduce the cosmetic fragment scale to fit its conservative bound. Reason: ensure full visible fragments never penetrate bulkheads. Cost: exceptionally narrow death locations may show smaller chunks; player/AI/weapon collision is unchanged.
- Final selected run:117/117 tests passed;13 production JS/TS syntax checks;341 unique DOM IDs,65 valid local HTML references; main-menu section matches the baseline. Existing affected protocol/balance fixtures updated, not unrelated tests.
- Browser: volume/hint persistence after reload, locked hard choice, records panel and390x844 settings layout. Two-corpse screenshot and40/100/200 dense-pile measurements saved. Temporary in-memory fixtures cleared by reload; viewport reset, temporary tab and server closed.
