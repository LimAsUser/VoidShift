# Menu implementation ledger

Approved reference: eight menu-concepts-v1 PNGs and the user-approved implementation plan.

- Task 1: asset extraction and title/preparation navigation — complete.
- Task 2: seven live menu layouts and presentation bindings — complete.
- Task 3: targeted regression and browser visual review — performed; see VALIDATION.md. Pixel-identical equivalence is not claimed.

Ruling: stay in the existing dirty MiniBranch, do not create a checkout, commit, publish, or run the full suite; the user's explicit constraints override generic skill defaults.
Ruling: crop approved illustrations directly, as expressly requested; use imagegen only to remove baked UI from backgrounds. Dynamic text/buttons/grids stay DOM.
Ruling: isolate menu styling and presentation in menu.css / js/menu.js rather than extending the existing 3,000-line cascade. Keep state/business operations in Game and UIManager.
Pre-flight: the inventory renderer and drag hit-testing share measured cell coordinates; use visual scaling with measured bounding rectangles, not stored grid-coordinate changes.

Ruling: preserve uniform, accurate inventory cells rather than reproducing uneven cell heights in the generated reference. Capacity and placement remain authoritative.
Ruling: visual fixtures render through separate temporary inventory objects and UI methods. They never purchase, save, join a room, or change the live Game state; reload removes them.
Verification: 105 targeted Node tests passed; JavaScript syntax, DOM IDs/action references, resource paths, CSS brace structure, whitespace and modified-file line endings checked.
Browser: approved in-app localhost route available; inspected desktop, mobile, and zoom-equivalent CSS viewport sizes. Corrected legacy CSS interference, mobile implicit-grid overflow, small labels, and fixed lobby actions.
Final polish: calibrated the large-screen shell and warehouse action spacing against the overlays; removed empty selection placeholders. Reconfirmed all 105 focused tests after the final presentation changes. Browser preview restored to its default viewport and reloaded to remove display fixtures.
Visual evidence: eight final screenshots plus half-opacity overlays in validation/. Typography, some spacing, and reconstructed background regions still differ from raster references. Do not call this pixel-identical acceptance.
