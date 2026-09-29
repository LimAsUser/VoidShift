/* Read-only browser check. Run through the approved local browser evaluation API. */
function inspectMenuLayout() {
  const selectors = [
    '.brief-location', '.brief-objective', '.mission-steps article', '.brief-settings>.menu-card',
    '.brief-quota', '.brief-terminals', '.brief-prepared', '.brief-risk', '.brief-tips>p',
    '.map-scale-card', '.facility-schematic', '.storage-grid-panel', '.storage-controls',
    '.selected-item-detail', '.loadout-card', '.ammo-depot-panel', '.ammo-choice-card',
    '.coop-link-header', '.coop-host-seat', '.coop-member', '.coop-friendly-fire', '.coop-friendly-fire-status', '.coop-readiness',
    '.coop-action-buttons', '.tutorial-lessons', '.tutorial-preview', '.tutorial-art',
    '.tutorial-rules>p', '.tutorial-launch-card'
  ].join(',');
  const outsideCards = [];
  const tolerance = 2;
  for (const card of document.querySelectorAll(selectors)) {
    const bounds = card.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    if (/auto|scroll/.test(getComputedStyle(card).overflowY)) continue;
    const candidates = Array.from(card.querySelectorAll('img,p,h2,h3,button,label,output,small,strong,.terminal-pixel-icon'));
    if (card.matches('p,button')) candidates.unshift(card);
    for (const element of candidates) {
      if (element.closest(selectors) !== card) continue;
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      let scrollable = false;
      for (let parent = element === card ? null : element.parentElement; parent && parent !== card; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)) { scrollable = true; break; }
      }
      if (scrollable) continue;
      let rectangles = [box];
      if (!element.matches('img,.terminal-pixel-icon')) {
        const range = document.createRange();
        range.selectNodeContents(element);
        rectangles = Array.from(range.getClientRects());
      }
      for (const rectangle of rectangles) {
        const dx = Math.max(0, bounds.left - rectangle.left, rectangle.right - bounds.right);
        const dy = Math.max(0, bounds.top - rectangle.top, rectangle.bottom - bounds.bottom);
        if (dx > tolerance || dy > tolerance) {
          outsideCards.push({ card: card.className || card.tagName, kind: element.tagName,
            text: (element.alt || element.textContent || element.className).trim().slice(0, 60),
            dx: Math.round(dx), dy: Math.round(dy) });
          break;
        }
      }
    }
  }
  const isInViewport = element => {
    const rectangle = element.getBoundingClientRect();
    return rectangle.width > 0 && rectangle.height > 0 && rectangle.top >= 0 &&
      rectangle.left >= 0 && rectangle.bottom <= innerHeight + tolerance && rectangle.right <= innerWidth + tolerance;
  };
  const page = Array.from(document.querySelectorAll('.menu-page')).find(element => element.clientHeight > 0);
  const launch = document.getElementById('startButton');
  const lobbyActions = Array.from(document.querySelectorAll('.coop-action-buttons button')).filter(element => element.offsetHeight > 0);
  return {
    viewport: [innerWidth, innerHeight], page: page?.id || 'title', outsideCards,
    documentOverflow: document.documentElement.scrollWidth > innerWidth + tolerance,
    launchVisible: document.body.dataset.menuScreen === 'title' || isInViewport(launch),
    lobbyActionsVisible: lobbyActions.every(isInViewport)
  };
}
