// compat — split from src/client/mobile.css.ts (2026-08-16), order preserved.
// Self-contained: every rule here is mobile-only and the media query opens
// and closes in this file. Concatenation order still matters for the
// cascade (compat intentionally overrides layout), just not for syntax.

export const COMPAT_CSS = `@media (max-width: 1023px) {
  /* ---------- dsh-web-ui family compatibility ----------
     The linxin666 plugin suite extends the shell frame directly:
       - aionui-panel appends two trailing grid columns (explorer / preview)
         plus absolute drag handles to [data-dsh-frame]; its 5-track inline
         grid is already overridden above, but the handles and columns would
         still float over the main UI. On mobile the columns leave the grid
         as floating bottom sheets and keep their own visibility state —
         the suite's collapse chevron / preview tabs still work, so no
         feature is lost. The task-board / ssh plugins inject sidebar
         entries and center-column takeover panels; the entries need
         spacing and the kanban needs scrollable columns. */

  /* Touch devices: the drag handles are useless — the floating expand
     button is the opener. */
  .aionui-explorer-handle,
  .aionui-preview-handle {
    display: none !important;
  }

  /* Shared base: both columns leave the grid as floating panels. The
     explorer is gated shut by default (its own persisted expanded state
     must never cover the mobile UI on load); the header Files action opens
     it via the frame marker below, and the sheet's own collapse chevron
     clears it. Preview stays owned by the suite (hidden while no tab is
     open). The per-column rules below override the geometry. */
  [data-aionui-explorer-col],
  [data-aionui-preview-col] {
    position: fixed !important;
    z-index: 55 !important;
    background: var(--aion-bg-base, #ffffff) !important;
    border-left: none !important;
  }
  /* Explorer (file tree) bottom sheet: bottom edge aligned exactly with
     the composer card's bottom line — the card sits 36px above the
     viewport bottom (8px composer padding + the 28px stats strip below
     the card), so the sheet uses the same 36px bottom offset. */
  [data-aionui-explorer-col] {
    visibility: hidden !important;
    left: 8px !important;
    right: 8px !important;
    top: auto !important;
    bottom: 36px !important;
    width: auto !important;
    height: min(55dvh, 460px) !important;
    max-height: calc(100dvh - 44px) !important;
    border-radius: 14px !important;
    overflow: hidden !important;
    box-shadow: 0 -4px 28px rgba(0, 0, 0, .18) !important;
    animation: dsh-web-mobile-sheet-up .24s var(--ds-ease-out, ease-in-out) !important;
  }
  /* Preview (file content) bottom sheet. Gated shut by default: the suite
     persists open preview tabs in localStorage and restores them on load,
     which would pop the sheet over the fresh UI. The client only sets the
     frame marker after the user taps a file row in the explorer; the
     suite's own collapse chevron clears it via the visibility watcher. */
  [data-aionui-preview-col] {
    visibility: hidden !important;
    position: fixed !important;
    left: 8px !important;
    right: 8px !important;
    top: auto !important;
    bottom: 40px !important;
    width: auto !important;
    height: min(50dvh, 420px) !important;
    max-height: calc(100dvh - 48px) !important;
    border-radius: 14px !important;
    overflow: hidden !important;
    box-shadow: 0 -4px 28px rgba(0, 0, 0, .18) !important;
    z-index: 56 !important;
    animation: dsh-web-mobile-sheet-up .24s var(--ds-ease-out, ease-in-out) !important;
    /* Fullscreen toggle (issue #8): animate the geometry change instead of
       snapping. visibility is deliberately not listed, so opening/closing
       the sheet stays instant; the open/close keyframes own transform. */
    transition:
      left .24s var(--ds-ease-out, ease-in-out),
      right .24s var(--ds-ease-out, ease-in-out),
      top .24s var(--ds-ease-out, ease-in-out),
      bottom .24s var(--ds-ease-out, ease-in-out),
      width .24s var(--ds-ease-out, ease-in-out),
      height .24s var(--ds-ease-out, ease-in-out),
      border-radius .24s var(--ds-ease-out, ease-in-out),
      box-shadow .24s var(--ds-ease-out, ease-in-out),
      padding-top .24s var(--ds-ease-out, ease-in-out) !important;
  }
  /* User-opened preview sheet (frame marker, set on file-row tap). */
  [data-mobile-nav="frame"][data-aionui-preview-open] [data-aionui-preview-col] {
    visibility: visible !important;
  }
  /* The Files action opens the explorer sheet (frame marker). */
  [data-mobile-nav="frame"][data-aionui-explorer-open] [data-aionui-explorer-col] {
    visibility: visible !important;
  }
  /* While the preview sheet is up, the explorer sheet yields (two stacked
     bottom sheets would read as one broken overlay). Closing the preview
     via its collapse chevron / tab close clears the marker, and the
     explorer sheet returns. Same specificity as the explorer-open rule, so
     this must stay AFTER it. */
  [data-mobile-nav="frame"][data-aionui-preview-open] [data-aionui-explorer-col] {
    visibility: hidden !important;
  }
  /* The open drawer must never sit under a sheet: while the frame is in the
     narrow-expanded state both sheets yield (later in the file than the
     open marker rule, so it wins at equal specificity). The fullscreen
     toggle has its own drawer-open rule at the end of its section. */
  [data-mobile-nav="frame"]:not([data-sidebar-collapsed]) [data-aionui-explorer-col],
  [data-mobile-nav="frame"]:not([data-sidebar-collapsed]) [data-aionui-preview-col] {
    visibility: hidden !important;
    display: none !important;
  }
  /* The suite's own expand button reads the store state we bypass on
     mobile — hide it; the header Files action is the opener. */
  .aionui-floating-expand {
    display: none !important;
  }

  /* Preview sheet fullscreen toggle (issue #8): a fixed button parked in the
     sheet's titlebar row, just left of the suite's collapse chevron (24px at
     right:8px of the sheet, and the sheet spans 8px..(100vw-8px)). The top
     calc mirrors the sheet geometry above (bottom 40px + min(50dvh, 420px));
     when the frame carries "data-mobile-preview-full" the sheet goes
     fullscreen and the button moves to the viewport corner. */
  [data-mobile-nav="preview-full-toggle"] {
    position: absolute !important;
    right: 36px !important;
    top: 8px !important;
    z-index: 57 !important;
    display: none !important;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--aion-text-secondary, var(--dsw-alias-label-secondary, inherit));
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    /* Native look: same size/radius/hover language as the suite's tab-bar
       icon buttons (the 20px panelCollapse next to it). The button lives
       INSIDE the preview column, so it rides the sheet's own open
       animation and geometry transition — no curve matching needed. */
    transition: background-color .15s, top .24s var(--ds-ease-out, ease-in-out);
  }
  [data-mobile-nav="preview-full-toggle"]:hover {
    background: var(--aion-bg-3, rgba(0, 0, 0, .22));
  }
  [data-mobile-nav="preview-full-toggle"]:active {
    background: var(--aion-bg-active, rgba(0, 0, 0, .28));
  }
  [data-mobile-nav="preview-full-toggle"]:focus-visible {
    outline: 2px solid var(--dsw-alias-state-business-primary, #4f6ef7);
    outline-offset: 2px;
  }
  [data-mobile-nav="preview-full-toggle"] svg {
    width: 14px;
    height: 14px;
  }
  /* Keep the last tab (and the "+" URL-tab trigger) from sliding under the
     fullscreen toggle: reserve the right end of the preview tab row. */
  [data-aionui-preview-col] [class*="_tabScroll"] {
    padding-right: 34px !important;
  }
  /* Visible only while the preview sheet is open. Visibility itself is
     inherited from the column, so the sheet's own hide rules (collapse,
     drawer open) cover the button too. */
  [data-mobile-nav="frame"][data-aionui-preview-open] [data-aionui-preview-col] [data-mobile-nav="preview-full-toggle"] {
    display: inline-flex !important;
  }
  /* Icon swap on the frame fullscreen marker. */
  [data-mobile-nav="preview-full-toggle"] .dsh-web-mobile-full-out {
    display: none !important;
  }
  [data-mobile-nav="frame"][data-mobile-preview-full] [data-aionui-preview-col] [data-mobile-nav="preview-full-toggle"] .dsh-web-mobile-full-in {
    display: none !important;
  }
  [data-mobile-nav="frame"][data-mobile-preview-full] [data-aionui-preview-col] [data-mobile-nav="preview-full-toggle"] .dsh-web-mobile-full-out {
    display: inline !important;
  }
  /* Fullscreen preview: the sheet fills the whole viewport (notch included);
     the safe-area padding drops the titlebar row below the status bar, and
     the toggle follows the titlebar into the top corner. */
  [data-mobile-nav="frame"][data-aionui-preview-open][data-mobile-preview-full] [data-aionui-preview-col] {
    inset: 0 !important;
    left: 0 !important;
    right: 0 !important;
    top: 0 !important;
    bottom: 0 !important;
    width: 100% !important;
    height: 100dvh !important;
    max-height: none !important;
    box-sizing: border-box !important;
    padding-top: env(safe-area-inset-top, 0px) !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    z-index: 57 !important;
    animation: none !important;
  }
  /* Fullscreen: the column fills the viewport, so the button follows the
     titlebar row down below the notch. */
  [data-mobile-nav="frame"][data-mobile-preview-full] [data-aionui-preview-col] [data-mobile-nav="preview-full-toggle"] {
    top: calc(env(safe-area-inset-top, 0px) + 8px) !important;
  }
  @media (prefers-reduced-motion: reduce) {
    [data-aionui-preview-col],
    [data-mobile-nav="preview-full-toggle"] {
      transition: none !important;
      animation: none !important;
    }
  }

  /* dsh-web-ui sidebar entries (task board / ssh) sit flush against each
     other — give the injected rows breathing room. */
  button[data-dsh-taskboard-entry],
  button[data-dsh-ssh-entry] {
    margin-bottom: 8px !important;
  }

  /* Task board: five kanban columns at minmax(0,1fr) crush into ~78px phone
     strips. Give every column a usable minimum and let the row scroll. */
  [data-dsh-taskboard-board] > [class*="_columns"] {
    grid-template-columns: repeat(5, minmax(240px, 1fr)) !important;
    overflow-x: auto !important;
  }
  /* The floating button must not float over a takeover panel (task board /
     ssh own the center column while active). */
  html[data-dsh-taskboard-active] [data-mobile-nav="fab"],
  html[data-dsh-ssh-active] [data-mobile-nav="fab"],
  html[data-dsh-taskboard-active] [data-mobile-nav="backdrop"],
  html[data-dsh-ssh-active] [data-mobile-nav="backdrop"] {
    display: none !important;
  }
  /* Board header: let the search field take the slack instead of squeezing
     the action buttons. */
  [data-dsh-taskboard-board] > [class*="_boardHeader"] [class*="_search"] {
    flex: 1 1 auto !important;
    min-width: 80px !important;
  }

  /* ---------- dsh-web-ui polish: plugin market search ----------
     The market tab row (Discover / Themes / Installed + the plugin search
     box) is a no-wrap flex: at 390px the tabs plus the ~218px search box
     (~475px total) overflow the ~334px sheet and the search box runs off
     the right edge of the screen (it also forces a horizontal scrollbar on
     the sheet's options area). Let the row wrap: the tabs keep the first
     line and the search box gets its own full-width second line. */

  [aria-modal="true"] [class*="_tabs"] {
    flex-wrap: wrap !important;
    row-gap: 8px !important;
  }
  [aria-modal="true"] [class*="_searchInline"] {
    flex: 1 1 100% !important;
    width: 100% !important;
    max-width: 100% !important;
  }
  /* iOS Safari auto-zooms a focused input whose computed font-size is below
     16px. dshmarket's tab search uses the shared primitive Input at 13px;
     raise only this market-owned field on mobile so focusing it keeps the
     current viewport scale. Scoped to the market root to avoid changing
     unrelated settings/search fields; pinch zoom stays available. */
  [data-dsh-market-root] [class*="tabSearch"] input,
  [data-dsh-market-root] input[class*="tabSearch"] {
    font-size: 16px !important;
  }

  /* ---------- dshmarket polish: Tasks operations popup ----------
     Upstream .opPanel is a small dropdown pinned to the right edge of its
     ~54px trigger button; on a phone it reads as stuck to the sheet edge
     instead of centered. Promote it to a fixed, viewport-centered card:
     no ancestor between the popup and the viewport carries a transform,
     so position:fixed centers against the real viewport (a plain left:50%
     would resolve against the tiny relative trigger wrapper and land even
     further right). The upstream 86vw width cap, 70vh max-height and
     internal scroll all still apply; the close button stays inside. */
  [data-mobile-nav="frame"] [aria-modal="true"] [class*="_opPanel"] {
    position: fixed !important;
    top: 50% !important;
    bottom: auto !important;
    left: 50% !important;
    right: auto !important;
    transform: translate(-50%, -50%) !important;
  }

  /* ---------- dshmarket polish: header title row ----------
     The title row (icon + title + repo link + version + optional
     "Update market" / "Update all" buttons) is a nowrap flex whose
     natural width (~450px with both update buttons) exceeds the ~334px
     sheet. Flex then crushes the flexible items below their content
     width and every label wraps word-by-word — the "text turns
     vertical" report. Trigger is state-dependent (the buttons only
     exist while plugin updates are pending), which explains the
     sometimes-horizontal/sometimes-vertical flapping. Let the row wrap
     instead: line 1 keeps icon + title + repo + version, the update
     buttons get their own full-width-feeling second line, and the title
     itself is locked to one ellipsized line no matter what follows it. */
  [data-mobile-nav="frame"] [aria-modal="true"] [class*="_titleRow"] {
    flex-wrap: wrap !important;
    row-gap: 6px !important;
  }
  [data-mobile-nav="frame"] [aria-modal="true"] [class*="_titleRow"] [class*="_title"] {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }
  [data-mobile-nav="frame"] [aria-modal="true"] [class*="_titleRow"] button {
    white-space: nowrap !important;
  }

  /* ---------- dshmarket 1.20+ compat: keep the settings nav visible ----------
     Upstream Market.module.css hides the host dialog's nav on phones
     ([role=dialog]:has([data-dsh-market-root]) > nav { display:none } at
     max-width:560px) so the market can take over the dialog; its comment
     assumes the host keeps "its own close button in the content header".
     Our host's only close ✕ lives inside that very nav, so the market
     would leave no categories and no way back or out (dead-end UI,
     2026-08-23). Mirror upstream's exact media condition and restore the
     nav: categories row + ✕ stay above the inline market page. */
  @media (max-width: 560px) {
    [data-mobile-nav="frame"] [role="dialog"]:has([data-dsh-market-root]) > nav {
      display: flex !important;
    }
  }

  /* ---------- dsh-usage-stats polish: usage & balance panel ----------
     The panel's stats row shows three token counters side by side
     (today / month / total). The counters use tabular nowrap figures whose
     min-content width overflows the ~336px panel body on a phone: figures
     clip at the row's edges and the panel grows a horizontal scrollbar.
     Stack the three counters vertically — full-width rows, so the figures
     always fit. */

  [class*="usg_"][class*="_statsRow"] {
    flex-direction: column !important;
  }
  [class*="usg_"][class*="_stat"]:not([class*="_statsRow"]) {
    flex: 0 0 auto !important;
    width: 100% !important;
    min-width: 0 !important;
  }

  /* ---------- dsh-web-ui polish: settings sheet ----------
     The official dialog is a desktop two-column form; on a phone the
     label/control split leaves a huge dead gap and long descriptions wrap
     into tall stacks. Stack each row (text above, control full-width) and
     keep the nav tabs on ONE horizontally scrolling row. */

  /* Nav tabs: single scrolling row instead of the 3-per-row grid — seven
     categories wrap into three rows on a phone (~130px of sheet height);
     one row with a thin scrollbar keeps every tab reachable and returns
     that space to the options area (user feedback 2026-08-16). An earlier
     one-row attempt had no scroll affordance and silently cut the last
     tab off; the thin scrollbar IS the affordance. Scoped to the frame
     marker: the desktop dialog keeps its official vertical nav column. */
  [data-mobile-nav="frame"] [aria-modal="true"]:has(> :first-child > :last-child > button):not(:has([role="navigation"])):not(:has([class*="ZuhsRW"])) > :first-child [class*="_navList"] {
    display: flex !important;
    flex-wrap: nowrap !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    gap: 6px !important;
    width: 100% !important;
    scrollbar-width: thin !important;
    -webkit-overflow-scrolling: touch !important;
  }
  /* Hairline scrollbar for the tab row: the default WebKit scrollbar reads
     fat on a phone; 2px keeps the scroll affordance without the bulk. */
  [data-mobile-nav="frame"] [aria-modal="true"] [class*="_navList"]::-webkit-scrollbar {
    height: 2px !important;
  }
  [data-mobile-nav="frame"] [aria-modal="true"] [class*="_navList"]::-webkit-scrollbar-thumb {
    background: var(--dsw-alias-border-l2, rgba(0, 0, 0, .22)) !important;
    border-radius: 1px !important;
  }
  [data-mobile-nav="frame"] [aria-modal="true"] [class*="_navList"]::-webkit-scrollbar-track {
    background: transparent !important;
  }
  [data-mobile-nav="frame"] [aria-modal="true"] [class*="_navCell"] {
    flex: 0 0 auto !important;
    white-space: nowrap !important;
    padding: 6px 8px !important;
    gap: 6px !important;
    font-size: 13px !important;
    justify-content: flex-start !important;
  }
  [data-mobile-nav="frame"] [aria-modal="true"] [class*="_navCell"] svg {
    width: 14px !important;
    height: 14px !important;
    flex: none !important;
  }
  /* Content toolbar: the "Open configuration file" button is hidden on
     mobile — it is rarely needed on a phone and steals ~180px from the
     tab row's scroll area (user feedback 2026-08-16). Only the close ✕
     stays, flush right in the nav row. Desktop untouched (frame scoped). */
  [data-mobile-nav="frame"] [aria-modal="true"] [class*="_header"]:not([class*="_headerActions"]) [class*="_actions"] {
    display: none !important;
  }
  [data-mobile-nav="frame"] [aria-modal="true"] [class*="_header"]:not([class*="_headerActions"]) [class*="_actions"] [class*="_action"]:not([class*="_actions"]) {
    font-size: 13px !important;
    padding: 6px 12px !important;
    min-height: 0 !important;
  }
  /* Setting rows: text on top, control below at full width. Compound
     "_row*" families are excluded: the Models page names its whole card
     list "_rows" (plus "_rowCard/_rowHead/_rowIdentity/_rowActions"), and
     the bare-substring match used to hand the list's first/last cards a
     width:100% that - on the official content-box cards (+14px padding,
     1px border) - ran 30px past their siblings and off-screen. */
  [aria-modal="true"] [class*="_section"] [class*="_row"]:not([class*="_rows"]):not([class*="_rowCard"]):not([class*="_rowHead"]):not([class*="_rowIdentity"]):not([class*="_rowActions"]) {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 8px !important;
  }
  [aria-modal="true"] [class*="_section"] [class*="_row"]:not([class*="_rows"]):not([class*="_rowCard"]):not([class*="_rowHead"]):not([class*="_rowIdentity"]):not([class*="_rowActions"]) > :first-child {
    width: 100% !important;
    max-width: none !important;
  }
  [aria-modal="true"] [class*="_section"] [class*="_row"]:not([class*="_rows"]):not([class*="_rowCard"]):not([class*="_rowHead"]):not([class*="_rowIdentity"]):not([class*="_rowActions"]) > :last-child {
    width: 100% !important;
    max-width: none !important;
  }
  /* Appearance mode group: give the cube row a consistent bordered
     segmented look (the official borders differ per state). */
  [aria-modal="true"] [class*="_cubeRow"] > * {
    border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .12)) !important;
  }

  /* ---------- dsh-web-ui polish: explorer sheet ----------
     The aionui explorer was designed for a desktop side column: compact the
     header, search box and tree rows so a phone shows more entries, and pad
     the scroll bottom so the last row never sits flush on the edge. */

  [data-aionui-explorer-col] [class*="_tabBar"]:not([class*="_tabBarRight"]) {
    height: 36px !important;
  }
  [data-aionui-explorer-col] [class*="_tabBtn"],
  [data-aionui-explorer-col] [class*="_tabBtnActive"] {
    padding: 0 12px !important;
    font-size: 13px !important;
  }
  [data-aionui-explorer-col] [class*="_searchBox"] {
    height: 32px !important;
    font-size: 13px !important;
  }
  [data-aionui-explorer-col] [class*="_treeRow"] {
    height: 30px !important;
    font-size: 13px !important;
  }
  [data-aionui-explorer-col] [class*="_treeRow"] svg {
    width: 14px !important;
    height: 14px !important;
  }
  [data-aionui-explorer-col] [class*="_scrollArea"] {
    padding-bottom: 28px !important;
  }

  /* ---------- dsh-web-ui polish: drawer footer ----------
     The injected footer actions (Files + Session log) become two equal pill
     buttons instead of text-width capsules. */

  /* The official footerActions row also hosts the remote-web-ui entry
     row (two icon buttons); without wrapping the two groups squeeze each
     other on one line. Wrap so each group gets its own full-width row. */
  [data-mobile-nav="frame"] [class*="_footerActions"] {
    flex-wrap: wrap !important;
    gap: 6px !important;
  }
  [data-mobile-nav="drawer-actions"] {
    width: 100% !important;
  }
  [data-mobile-nav="drawer-actions"] > button {
    flex: 1 1 0 !important;
    padding: 0 8px !important;
    white-space: nowrap !important;
  }

  /* ---------- dsh-web-ui polish: floating pet ----------
     The whale-girl pet (dsh-pet) floats at the viewport corner with a
     persisted, draggable position. On phones the pet is scaled down so
     it does not dominate the screen; the plugin's own drag + persist
     still work (the position itself is left alone — the mobile default
     position is seeded via the pet API to just above the composer). */

  body > [class*="_float"]:has([class*="_sprite"][role="button"]) {
    transform: scale(.66);
    transform-origin: bottom right;
  }
  /* While a modal dialog (settings sheet / export) owns the screen the pet
     floats ABOVE it and covers the dialog content; modal semantics say the
     background is inert, so hide the pet for the modal's lifetime. */
  body:has([aria-modal="true"]) > [class*="_float"]:has([class*="_sprite"][role="button"]) {
    display: none !important;
  }

  /* ---------- dsh-web-ui polish: conversation stats line ----------
     The official session-status row (turns / steps / LLM time / TTFT /
     cache) is long. The client marks the exact row with
     [data-mobile-nav="stats"] (text-anchored, hashed classes can't be
     targeted). Layout: ONE fixed-height (28px) flex strip that scrolls
     horizontally — the full metrics stream stays reachable by swiping,
     the row never grows vertically, no ellipsis or fade, 12px gaps
     between metric groups, a 2px scrollbar as the swipe affordance. */

  [data-mobile-nav="stats"] {
    display: flex !important;
    flex-flow: row nowrap !important;
    align-items: center !important;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: 28px !important;
    min-height: 28px !important;
    max-height: 28px !important;
    box-sizing: border-box !important;
    white-space: nowrap !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    scrollbar-width: thin !important;
    scrollbar-color: var(--dsw-alias-border-l1, rgba(0, 0, 0, .28)) transparent !important;
    padding: 0 0 4px !important;
    line-height: 20px !important;
    font-size: 12px !important;
  }
  [data-mobile-nav="stats"]::-webkit-scrollbar {
    height: 2px !important;
  }
  [data-mobile-nav="stats"]::-webkit-scrollbar-thumb {
    background: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, .3)) !important;
    border-radius: 2px !important;
  }
  [data-mobile-nav="stats"]::-webkit-scrollbar-track {
    background: transparent !important;
  }
  [data-mobile-nav="stats"] > * {
    display: flex !important;
    flex: 0 0 auto !important;
    flex-flow: row nowrap !important;
    align-items: center !important;
    width: max-content !important;
    min-width: max-content !important;
    max-width: none !important;
    white-space: nowrap !important;
    margin-right: 12px !important;
    padding: 0 !important;
  }
  [data-mobile-nav="stats"] > *:last-child {
    margin-right: 0 !important;
  }
  [data-mobile-nav="stats"] * {
    white-space: nowrap !important;
  }

  /* ---------- dsh-genui panel dock ----------
     The genui panel docks above the composer (conversation.input.dock,
     id genui-panel). On a phone its business-blue outline, generous chrome
     and single-line ellipsis read as an unfinished artifact: long titles
     truncate mid-word ("…default b···") with the chevron glued to the
     ellipsis, and the pill crowds the composer. Mobile treatment: neutral
     card border matching the composer, tighter chrome so the full title
     fits, chevron with breathing room. Scoped to the mobile frame marker —
     desktop keeps genui's own styling untouched. */

  [data-mobile-nav="frame"] [data-genui-panel] {
    margin: 6px 12px 4px !important;
    border-color: var(--dsw-alias-border-l1, rgba(0, 0, 0, .12)) !important;
    border-radius: 12px !important;
  }
  [data-mobile-nav="frame"] [data-genui-panel] [class*="_panelToggle"] {
    padding: 7px 12px !important;
    gap: 8px !important;
  }
  [data-mobile-nav="frame"] [data-genui-panel] [class*="_panelBadge"] {
    padding: 0 7px !important;
    border-radius: 5px !important;
    font-size: 10.5px !important;
    line-height: 1.7 !important;
  }
  [data-mobile-nav="frame"] [data-genui-panel] [class*="_panelTitle"] {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    font-size: 12.5px !important;
    line-height: 1.45 !important;
  }
  [data-mobile-nav="frame"] [data-genui-panel] [class*="_panelChevron"] {
    flex: none !important;
    margin-left: 0 !important;
    padding-left: 4px !important;
  }

  /* ---------- git-graph branch chip: inside the composer card ----------
     The branch chip (conversation.input.dock) floats between the dock rows
     and the input card; on a phone it reads as a stray capsule crowding the
     composer. A client reconciler task (git-chip-reparent) reparents the
     chip INTO the composer card; these rules pin it to the card's top-left
     and give the card a dedicated chip row. The card is position: relative
     by the official stylesheet, so the absolute anchor resolves against it.
     The plugin's own sheet sets all four offsets on the anchor, so
     right/bottom must be neutralized too. Scope is the frame marker + the
     anchor attribute (NOT the dock slot — the reparenting moves the chip
     out of the dock's subtree). Desktop untouched: the frame marker only
     exists below 1024px, and the effect restores the chip to the dock when
     the viewport widens. Chip row geometry (2026-08-16, user feedback):
     48px padding left a 16px dead gap between the chip and the input line
     and made the composer read too tall; the row is now 40px = chip (24px)
     at top 12px + ~4px to the textarea — the chip sits slightly lower and
     the gap is compressed without touching the official height budget
     further. */

  [data-mobile-nav="frame"] [data-gitgraph-chip-anchor] {
    position: absolute !important;
    top: 12px !important;
    left: 12px !important;
    right: auto !important;
    bottom: auto !important;
    z-index: 1 !important;
  }
  [data-mobile-nav="frame"] [class*="_card"]:has([data-gitgraph-chip-anchor]) {
    padding-top: 40px !important;
  }

  /* ---------- dsh-meme 表情选择卡片：右缘安全距离 ----------
     The meme picker (conversation.input.overlay, id meme-picker) is
     absolutely positioned left:0 inside the composer's overlay anchor with
     width:min(360px,90vw). That 90vw resolves against the VIEWPORT, not the
     anchor, and with the picker's own padding+border the border-box
     (377px on a 390px phone) exceeds the 356px anchor — the card's right
     edge then runs past the anchor and off the right screen edge, while the
     left edge keeps the anchor's 17px safe inset. Stretch the card to the
     anchor on both sides (left/right 0, width auto, border-box) so the
     right gap mirrors the left; cap at the card's original border-box size
     (360px content + 24px padding + 2px border) so tablets keep the
     intended card width instead of stretching. Desktop is untouched: the
     frame marker only exists below 1024px. */
  [data-mobile-nav="frame"] .meme-picker {
    left: 0 !important;
    right: 0 !important;
    width: auto !important;
    box-sizing: border-box !important;
    max-width: 386px !important;
  }

  /* dsh-meme 网格缩略图：自适应铺满卡片,保留 8px 间隙。
     dsh-meme 的 .mp-grid 是 flex-wrap + 固定 76px 的 .mp-cell(行内 style 再压到 74px):
     3 列(390px 手机)时每行右侧剩 ~78px 空白,卡片没有铺满。换成响应式 grid:
     repeat(auto-fill, minmax(64px,1fr)) 让列数随可用宽度伸缩、卡片 width:100% +
     aspect-ratio:1 随轨道自适应(方形,cover 裁切不变),gap 仍是 dsh-meme 的 8px。
     行内 width/height 用 !important 覆盖;手机端约 4 列、平板端约 5 列,均满宽。 */
  [data-mobile-nav="frame"] .meme-picker .mp-grid {
    display: grid !important;
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)) !important;
    scrollbar-width: thin !important;
    scrollbar-color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, .3)) transparent !important;
  }
  [data-mobile-nav="frame"] .meme-picker .mp-cell {
    width: 100% !important;
    height: auto !important;
    aspect-ratio: 1 !important;
  }
  /* dsh-meme 网格右侧滚动条：默认 WebKit 滚动条在手机上看太粗,压成 4px
     细条——保留滚动指示又不占横向空间,thumb 圆角浅色、轨道透明。 */
  [data-mobile-nav="frame"] .meme-picker .mp-grid::-webkit-scrollbar {
    width: 4px !important;
  }
  [data-mobile-nav="frame"] .meme-picker .mp-grid::-webkit-scrollbar-thumb {
    background: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, .3)) !important;
    border-radius: 999px !important;
  }
  [data-mobile-nav="frame"] .meme-picker .mp-grid::-webkit-scrollbar-track {
    background: transparent !important;
  }

  /* ---------- agent preset 模式选择菜单：手机端紧凑底部弹层 ----------
     The official agent-preset menu (role=menu, portal mounted on body) uses
     position:fixed + max-height:820px + bottom:12px, so on a phone it
     stretches from the trigger down to 12px above the screen bottom —
     effectively filling the screen. Turn it into a polished bottom sheet:
     cap the height, center it horizontally (the official max-width 360px
     left-anchors at left:12px, leaving 12/18px asymmetric gaps), add a
     drag-handle affordance, breathing room, and softer top radius; the
     inner viewport keeps scrolling. Scoped to the agent-preset item class
     (cubgiG_*) so other role=menu dropdowns (model/access mode) are
     untouched. Desktop ≥1024px is outside the media query, so it keeps the
     official large dropdown. */
  /* agent-preset 菜单依赖 @deepseek-ai/dsh-client-ui-agent-preset 的 CSS Module 哈希 (cubgiG_*)，升级该包时需验证此选择器是否仍有效 */
  [role="menu"]:has([class*="cubgiG_item"]) {
    top: auto !important;
    left: 50% !important;
    right: auto !important;
    bottom: 12px !important;
    transform: translateX(-50%) !important;
    width: min(100% - 24px, 360px) !important;
    max-width: 360px !important;
    max-height: min(55dvh, 440px) !important;
    padding: 30px 6px 10px !important;
    border-radius: 16px !important;
  }
  [role="menu"]:has([class*="cubgiG_item"])::before {
    content: '';
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    border-radius: 999px;
    background: var(--dsw-alias-border-l2, rgba(0, 0, 0, .22)) !important;
    pointer-events: none;
  }
  /* 菜单内部滚动条：默认 WebKit 滚动条在竖屏太粗,会占 ~15px 宽度把文字描述
     挤窄,导致描述换行/截断不自然。压成 4px 细条(与表情网格一致),文字区域
     恢复自适应宽度。 */
  [role="menu"]:has([class*="cubgiG_item"]) [class*="_viewport_"] {
    scrollbar-width: thin !important;
    scrollbar-color: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, .3)) transparent !important;
  }
  [role="menu"]:has([class*="cubgiG_item"]) [class*="_viewport_"]::-webkit-scrollbar {
    width: 4px !important;
  }
  [role="menu"]:has([class*="cubgiG_item"]) [class*="_viewport_"]::-webkit-scrollbar-thumb {
    background: var(--dsw-alias-label-tertiary, rgba(0, 0, 0, .3)) !important;
    border-radius: 999px !important;
  }
  [role="menu"]:has([class*="cubgiG_item"]) [class*="_viewport_"]::-webkit-scrollbar-track {
    background: transparent !important;
  }

/* 搜索框底部间距修复 */
[aria-modal="true"] [class*="tabSearchRow"] {
  padding: 2px 4px 16px !important;
}


/* ===== 已安装列表：路径单行截断 ===== */
[class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"]) > div > [class*="spec"] {
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  max-width: 100% !important;
  font-size: 12px !important;
}
[class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"]) > div > [class*="nm"] {
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  max-width: 100% !important;
}
/* ===== 已安装列表：手机端纵向重排 ===== */
@media (max-width: 1023px) {
  [class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"]) {
    flex-wrap: wrap !important;
    align-items: center !important;
    gap: 4px 10px !important;
  }
  [class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"]) > div:first-child {
    flex: 1 1 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
  }
  [class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"]) > [class*="grow"] {
    flex: 1 1 auto !important;
  }
  [class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"]) > button {
    flex: 0 0 auto !important;
  }
  [class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"]) > button[class*="switch"] {
    order: 3 !important;
  }
  [class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"]) > button:not([class*="switch"]) {
    order: 2 !important;
  }
  [class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"]) > [class*="owner"] {
    order: 1 !important;
  }
  [class*="irow"]:not([class*="irowActions"]):not([class*="irowTrailing"]) > [class*="grow"] {
    order: 0 !important;
  }
}
/* ===== 市场卡片图片容器：横向滚动 ===== */
[data-mobile-nav="frame"] [class*="cardShots"] {
  display: flex !important;
  flex-wrap: nowrap !important;
  overflow-x: auto !important;
  -webkit-overflow-scrolling: touch !important;
  scrollbar-width: thin !important;
  min-width: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
  gap: 8px !important;
  padding: 4px 0 !important;
}
[data-mobile-nav="frame"] [class*="cardShots"] > [class*="cardShot"] {
  flex: 0 0 min(100%, 420px) !important;
  width: min(100%, 420px) !important;
  max-width: 100% !important;
  height: auto !important;
  display: block !important;
  object-fit: contain !important;
}
[data-mobile-nav="frame"] [class*="cardShots"]::-webkit-scrollbar {
  height: 4px !important;
}
[data-mobile-nav="frame"] [class*="cardShots"]::-webkit-scrollbar-thumb {
  background: var(--ds-border-color, #ccc) !important;
  border-radius: 4px !important;
}
}

`
