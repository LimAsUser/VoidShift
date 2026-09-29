# Menu content-overflow repair

This pass changes only `menu.css` and image wrappers/cache version in `index.html`. Game rules, prices, saves, network data and inventory coordinates are unchanged.

## Cause and repair

Fixed-height/fractional tracks could become smaller than the text, button and image content they contained. Percentage-height images also contributed unwanted intrinsic height. The previous page-level checks did not detect these internal overflows.

- Cards now keep their content minimum; excess height is handled by the existing page scroller.
- Independent media frames keep briefing, weapon and oxygen images within their allocated space.
- Mobile mission steps stack vertically and headings can wrap.
- Co-op seat rows account for full status labels; lobby actions remain outside the roster scroller.
- Tutorial hints enter normal flow on short/narrow screens; the lesson list can scroll.
- Standard 1920x1080 briefing, loadout, ammo and tutorial views were checked for both internal bounds and unchanged page-level fit.

## Verified

- **49 baseline page/viewport checks passed**: seven preparation pages at 1920x1080, 1920x900, 1440x900, 1280x720, 1280x640, 960x540 and 390x844.
- **14 title/settings checks passed**: both surfaces at the same seven sizes.
- **15 stress checks passed**: long item names, six selected items, eight-digit values, all weapons owned, long ammo conversion output, pending guest readiness and an offline teammate.
- **9 scroll-reachability checks passed**: mission-step text, oxygen count, last failure rule, revolver purchase, final ammo stock row, transfer action, oxygen note, final lesson and tutorial launch.
- **10 focused Node tests passed**: `node --test tests/menu-presentation.test.cjs tests/prep-ui.test.cjs`.
- No full suite, build, commit, push or Sites publish. Browser fixture objects are presentation-only and removed by reload; no purchase/save/network action was executed for QA.

The read-only browser checker is `tests/menu-layout-audit.js`. It measures actual text ranges and image/control boxes against their owning card, with a 2px subpixel tolerance. Intentional scroll regions are allowed; the separate reachability checks verify their content remains accessible.

## Evidence

- [Before: briefing at 1280x640](before-briefing-1280x640.png)
- [After: same viewport](after-briefing-1280x640.png)
- [After: bottom content reached by scrolling](after-briefing-scrolled-1280x640.png)
- [Baseline results](layout-results.json)
- [Stress results](stress-results.json)
- [Reachability results](reachability.json)

Each preparation page also has screenshots named `<page>-<width>x<height>.png`; stress cases use the `stress-` prefix. All captures come from the approved in-app local browser route.
