# Monster and corpse performance delivery — 2026-09-30

Implemented locally on MiniBranch. Monster counts, combat values, AI update frequency, fragment counts, blood, soft corpse interaction, resolution,40/100/200 corpse limits and default100 are retained. No commit, push, Site publication, protocol/schema change or new dependency. Existing uncommitted TURN work is preserved.

## Changes

-128-unit static wall/door broad phase feeds the original exact collision/ray formulas. Generation uses the original scan; completed maps build the index. Doors read live open state. Dynamic barriers remain in their existing path.
- Corpse pieces use independently clipped transparent bitmap caches at adequate upward-rounded DPR/zoom resolution.64MiB derived texture budget,2ms per-frame construction work budget checked after each piece, original drawing when unavailable/full, explicit eviction and task cleanup. Blood/spray and white flash remain.
- Conservative offscreen actor/corpse culling retains scattered onscreen pieces and Heavy warning paths whose body is offscreen.
- Exact visibility memoization, including unchanged observers across frames, invalidates on position, facing, player state, view rules, geometry identity or door state. No quantization or weaker occlusion. Coordinate cache capped16,384 entries; stable-object cache uses weak references.
- Entity grids persist between frames; same-cell moves retain entries/order. Target selection uses a stable linear minimum and current downed state. Corpse dirty records are encoded once per20Hz send tick and shared across peers; slow-peer queues retain latest/final poses.

## Matched browser measurement

Local in-app browser,1280x768 viewport,DPR1,120 warm-up renders and240 measured renders per case. Same fixture, seeds, view and assets. Full synchronous render-call time in milliseconds, not a guaranteed device FPS figure.

| Scene | Original median | New median | Original P95 | New P95 |
|---|---:|---:|---:|---:|
|40 bodies|1.7|1.0|2.6|1.8|
|100 bodies|3.5|2.0|9.6|6.4|
|200 bodies /1,059 fragments|7.0|4.0|13.2|5.8|
|200 bodies +100 Hunter/10 Heavy/8 Nightmare|7.4|4.5|14.2|6.4|
|Same mixed scene, moving view|7.5|6.8|14.7|8.7|

The200-body warmed median improved42.9%, exceeding the30% target. Mixed moving-view P95 improved40.8%; its median gain is smaller. New derived textures used~27.6MiB for the static200-body case and~29.1MiB when moving, below64MiB. Earlier short baseline and failed tuning iterations are not substituted for these matched final results.

Raw results and reproducible local harness: `.sites-runtime/perf-20260929/`. The baseline directory contains the exact pre-edit browser source. The server is local-only and was stopped after validation.

## CPU/simulation evidence

Fixed-step Node VM stress simulation,120 ticks with118 actors on a seeded large map (900 walls,80 doors), followed by200 bodies/180 physics ticks:

| Phase | Original median / P95(ms) | New median / P95(ms) |
|---|---:|---:|
|Actor updates|217.53 /353.79|3.13 /4.97|
|One collision + ray query|0.392 /0.493|0.0074 /0.0115|
|Corpse physics, including settled frames|0.0017 /45.45|0.0030 /2.21|
|Snapshot creation + JSON encoding|0.130 /0.290|0.133 /0.232|

This deliberately stressful Node VM fixture is not browser FPS. Startup pathfinding still had a164ms peak after optimization, so occasional cold spikes are not claimed eliminated. Mostly sleeping-frame physics medians are not representative of actively moving fragments; P95 shows that cost more clearly.

Exact final actor positions, attack ticks/targets (24 attacks), player HP/O2 and final corpse fragment poses matched the original. Snapshot size remained50,604 bytes. Corpse pose encoding calls fell33,711→507 in the fixture.

**Network tradeoff:** retaining timer remainder restores the intended20Hz; the previous reset timer drifted below that rate. In this three-peer fixture, packets increased81→96 and bytes222,588→264,969. The improvement is less CPU encoding work, not reduced bandwidth. Slow-peer independent buffering and final delivery semantics remain covered by tests.

## Verification and limits

-93/93 focused tests pass, including30 generated maps (10/size), three door-state configurations,500 random queries plus doorway boundaries per map/state, radius44 checks, corpse rendering/physics, camera, training and snapshot regressions. Indexed/full-scan geometry results matched. A stale door-snapshot test fixture received its missing remotePlayers Map; production door logic was not changed to satisfy it.
- Independent read-only reviewer found no confirmed P0–P3 issue. Reviewer separately ran the18 then-current performance tests; the final run additionally includes cadence verification and all selected regressions.
- Four changed production scripts passed syntax checks;341 unique DOM IDs and65 local asset references checked. Main menu HTML, combat configuration, TURN networking, audio and UI source remain unchanged. Existing line endings/BOM preserved; only mixed endings normalized.
- Browser checks covered complete fragments/blood, cached white flash, Reduce Motion and DPR2 reallocation. Focused corpse pixel comparison, after rebuilding the unchanged floor caches on both sides, had mean RGB error0.103/255 and0.50% pixels differing by over8 channel levels; cached resampling is not pixel-identical. No missing-body simplification was used.
- Real cross-network2–4-player load, human feel acceptance and whole-project testing were not performed. No universal60 FPS promise.

## Decisions retained

1. Exact visibility can persist across unchanged frames because profiling showed it necessary; complete context invalidation is essential and tested.
2. Static geometry must call `rebuildCollisionIndex()` after in-place coordinate edits. Array replacement/length changes rebuild automatically; current runtime geometry is otherwise immutable.
3.20Hz remainder handling can increase real packet rate versus the old drifted timer, as measured above.
4. User's no-commit/no-full-suite/no-publish boundary overrides generic workflow defaults. Baselines and ledger are kept for reproducibility.

There are no deferred reviewer findings. Temporary browser state/viewport overrides are cleared; test tabs/server are closed.
