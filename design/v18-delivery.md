# V18 local delivery — 2026-09-29

Implemented in the existing MiniBranch checkout, preserving prior uncommitted work. No commit, push, Site publication, online migration, new dependency or Audio V2 integration.

## Changed

- Heavy impact shake is6 CSS px/.24s within500 units, deduplicated and disabled with Reduce Motion. Logic aim excludes this cosmetic shake. All three monster contacts use the existing injured MP3 with Host events, spatial playback and bounded overlap.
- True-dead Hunter/Heavy produce seeded4–6/6–8 sprite fragments, short blood spray and ground stains. Players nudge sleeping pieces without obstruction or speed changes; fragments respect full wall/door clearance. Pending Hunter revival and Nightmare sleep retain intact bodies. Local display budgets remain40/100/200; Host state is bounded to200 bodies plus up to20 local retiring fades.
- Settings add persistent overall/ambient volumes and optional hidden proximity-key hints. Progress, QTE, objectives and training guidance remain visible. All player body/map colors use the existing Host cyan. Both throwable abilities now reach600 with radius120; minimum50 and other rules retained.
- Difficulty presets, actual Nightmare HP, normal/final/called-extraction spawning and20/40/60-second rescue follow the approved tables. Counts use frozen1/1/1.5/2 team factors; HP does not. Training keeps independent values and8-second rescue.
- Large/hard require a frozen eligible formal solo standard-medium/medium success. Guest Host access never grants personal ownership. Local profiles include true Hunter/Heavy kills and Nightmare suppression totals, independent of reward multipliers and idempotent across receipts.
- Client/server/room protocol isV18. Cache versions updated. No database schema changes in this iteration.

## Verification

Final targeted command:117/117 passed across V18 balance/progress/audio/UI/corpse/renderer/integration, training-session, selected V17 equipment/runtime/profile/renderer/UI, camera, difficulty, Nightmare, extraction, world-scaling, lobby-lifecycle and room-protocol suites. This was not the complete repository suite.

Additional checks:13 changed production JavaScript/TypeScript files pass `node --check`;341 HTML IDs are unique;65 local HTML references exist; the main-menu section matches the pre-turn baseline. Scoped diff/line-ending checks pass. Original CRLF/LF and BOM status retained; only mixed endings normalized.

Independent read-only review identified two P2 cases: locked Guest choices remaining after an unexpected offline transition, and cosmetic fragment/blood edges crossing bulkheads. Both were reproduced in focused regressions and fixed. No claim of a second reviewer pass after those fixes.

Local in-app browser checks: startup has no captured console errors; hard starts locked; volume60/ambient25/hide-hints survive reload; personal records and condition text render;390x844 settings have reachable controls without horizontal overflow. Main menu appearance retained. Screenshots: `tmp/v18-settings-narrow.png`, `tmp/v18-corpse-preview.png`.

## Measured cost, not an FPS promise

Controlled local browser,1280x768 viewport, fixed training-room camera, dense visible corpse pile, normal motion. Two warm renders then20 synchronous full-render calls per budget:

| Visible bodies | Median render call | Maximum sampled call |
|---|---:|---:|
|40|6.4ms|33.1ms|
|100|12.2ms|37.6ms|
|200|30.4ms|49.0ms|

The200-body fixture contained1,059 fragments;80 physics steps at.025s had median0.1ms/max18.6ms, including steps after settling. All bodies eventually slept; static bodies generated no repeated pose packets. This median is not the cost of keeping every fragment active continuously. Full registry JSON was190,647 bytes, carried by existing bounded reliable chunking on reconnect, not by every regular snapshot. Pose updates coalesce by body and batch at most16, retaining latest/final poses through slow-buffer or reconnect-sync pauses. Focused tests verify packet size below32KB and suppress reconnect death bursts.

High200 visibly costs more than the lower budgets; default100 remains unchanged. These synchronous measurements are not real-network FPS, device-wide benchmarks or a claim that200 is a platform limit.

## Remaining acceptance boundaries

- Real2–4-player cross-network play, prolonged multi-client corpse pushing and human audio/impact feel were not exercised.
- Actual browser200% zoom and a full manual campaign qualifying-unlock run were not performed; qualification and repeat-result paths were verified through focused logic tests.
- Very narrow death locations may scale cosmetic chunks down after searching nearby clear space. No collision radius for living actors, weapon ray or player movement was changed by this fallback.
- Local browser simulation overrides were cleared by reload, temporary viewport reset, test tab/server stopped. No gameplay fixture changes were applied to production Site data.
