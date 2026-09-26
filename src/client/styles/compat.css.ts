// compat — split from src/client/mobile.css.ts (2026-08-16), order preserved.
// Self-contained: every rule here is mobile-only and the media query opens
// and closes in this file. Concatenation order still matters for the
// cascade (compat intentionally overrides layout), just not for syntax.

export const COMPAT_CSS = `@media (max-width: 1023px) and (pointer: coarse) {
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
  @media (prefers-reduced-motion: reduce) {
    [data-aionui-explorer-col] {
      animation: none !important;
    }
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
     toggle is a descendant of this column, so it is hidden with the rest of
     the column — there is no separate drawer-open rule for it. */
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
     internal scroll all still apply; the close button stays inside.
     2026-09-25: re-anchored from [data-mobile-nav="frame"] [aria-modal]
     to the market's own root marker — since rc.2 the whole settings
     sheet (market included) is portaled to <body> and no longer matches a
     frame-descendant selector. */
  [data-dsh-market-root] [class*="_opPanel"] {
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
     itself is locked to one ellipsized line no matter what follows it.
     2026-09-25: re-anchored from [data-mobile-nav="frame"] [aria-modal]
     to the market's own root marker — since rc.2 the whole settings
     sheet (market included) is portaled to <body> and no longer matches a
     frame-descendant selector. Same day, second pass: the ported rule's
     flex:1 1 auto on the title GREW it to fill the row, which pushed the
     repo link and the version "v1.65.1" to the far right — exactly where
     the pinned toolbar's close ✕ sits, crowding the corner the owner
     reported as "很容易误触" (hit-test: the version box reached x≈378,
     the close ✕ starts at x=350). flex:0 1 auto keeps the title at its
     natural width (repo + version pack left, as upstream intends) while
     still letting it shrink-and-ellipsize when the update buttons force a
     wrap — the wrap rule above, not flex-grow, is what makes room for
     them. */
  [data-dsh-market-root] [class*="_titleRow"] {
    flex-wrap: wrap !important;
    row-gap: 6px !important;
  }
  [data-dsh-market-root] [class*="_titleRow"] [class*="_title"] {
    flex: 0 1 auto !important;
    min-width: 0 !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }
  [data-dsh-market-root] [class*="_titleRow"] button {
    white-space: nowrap !important;
  }

  /* ---------- dshmarket polish: card byline stays on one line ----------
     The byline (avatar · owner · version · ↓downloads · ★stars) is a
     wrapping flex row by upstream design — the market would rather drop
     the counts to a second line than over-shrink the owner name (its
     .owner carries flex:0 1 auto + ellipsis + min-width:44px exactly for
     that). At a phone's card width the break point lands mid-row though:
     everything but the star fits, so a lone "· ★ 8k" wraps onto its own
     line under the author — inconsistent with the cards that happen to
     fit, which reads as a rendering bug (owner report 2026-09-25,
     IMG_4208: dsh-remote-web-ui and dsh-skill-explorer both orphaned the
     star). Pin the row to one line instead: the owner is the market's own
     flexible item, so it absorbs the squeeze and the counts stay whole.
     Desktop cards are far wider than the row and never wrapped anyway. */
  [data-dsh-market-root] [class*="_byline"] {
    flex-wrap: nowrap !important;
  }

  /* ---------- dshmarket polish: top inset ----------
     The sheet is pinned to the top of the screen (A': top = safe-area +
     12px) and the market page started FLUSH against the sheet's top
     edge — measured 2026-09-25: the title row's gap from the sheet's top
     was 0px while the pinned close ✕ sat 10px under it, so the whole
     page read as crushed against the boundary (owner report, IMG_4211:
     "最上面快要顶到边界了... 把整体往下移一点，有点留白会更美观").
     Give the page the same 12px inset its own horizontal padding already
     has (the root box was 12px from each side, 0px from the top), so the
     title lands ~12px under the sheet's rounded corner, level with the
     close ✕. The market page is the sheet's CONTENT, so it moves; the
     pinned toolbar (close ✕) belongs to the sheet and deliberately does
     NOT move ("关闭按钮可以不动"). Scrolls away naturally with the page.
     Desktop market is vertically centered with the host's own clearance
     and never had this read; the rule is mobile-only. */
  [data-dsh-market-root] {
    margin-top: 12px !important;
  }
  /* Below ~360px the fixed-width counts plus the owner's 44px min overrun
     the card, so the ellipsis eats most of the name ("omds..."). Trade text
     size for name length on the smallest phones: 11px → 10px text and
     6px → 4px gaps buy the owner roughly a third more room while the row
     stays one line. Tablet/phone tiers above this width are unaffected. */
  @media (max-width: 360px) {
    [data-dsh-market-root] [class*="_byline"] {
      gap: 4px !important;
      font-size: 10px !important;
    }
    [data-dsh-market-root] [class*="_byline"] [class*="_dot"] {
      margin-left: 3px !important;
    }
  }

  /* ---------- dshmarket 1.20+ compat: keep the settings nav visible ----------
     Upstream Market.module.css hides the host dialog's nav on phones
     ([role=dialog]:has([data-dsh-market-root]) > nav { display:none } at
     max-width:560px) so the market can take over the dialog; its comment
     assumes the host keeps "its own close button in the content header".
     Our host's only close ✕ lives inside that very nav, so the market
     would leave no categories and no way back or out (dead-end UI,
     2026-08-23). Mirror upstream's exact media condition and restore the
     nav: categories row + ✕ stay above the inline market page.
     2026-09-25 (rc.2 regression): 0.1.7-rc.2 renders this sheet through
     createPortal(..., document.body), so the frame-scoped selector matches
     nothing on rc.2+ hosts and the market takeover silently won — no
     categories row above the market page on every updated phone. The twin
     rule below carries the same declaration on a structural anchor
     ([role=dialog]:has(...) > nav, no frame prefix): on rc.1 hosts the
     frame-scoped rule does the work and the twin is inert (the sheet is a
     frame descendant there); on rc.2+ the twin carries it. Both stay
     inside this file's mobile media wrapper, so desktop never sees them.
     Premise note: this host generation keeps its close ✕ in the CONTENT
     header (pinned top-right — see layout.css), so the dead-end half of
     the 2026-08-23 report no longer applies; the rule is kept and twinned
     for the categories row it restores (guarded by the test suite). */
  @media (max-width: 560px) {
    [data-mobile-nav="frame"] [role="dialog"]:has([data-dsh-market-root]) > nav {
      display: flex !important;
    }
    [role="dialog"]:has([data-dsh-market-root]) > nav {
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
     Keep the nav tabs on ONE horizontally scrolling row. Setting rows need
     no mobile rework: the host redesigned them into compact space-between
     rows (text left, control right — verified in
     dsh-client-ui-settings-general .Pt1bsG_row, 2026-09-24). The old
     "stack each row" rules, written for the previous two-column generation
     with its dead label/control gap, now fight that design and double every
     row's height; they were removed (see the tombstone below). */

  /* Nav tabs + toolbar: TOMBSTONE (2026-09-25). This whole family —
     the single-row scroller, its hairline scrollbar, the compact cells and
     the hidden "Open configuration file" button — was scoped to
     [data-mobile-nav="frame"] because rc.1 rendered the settings sheet in
     place, inside the app frame. rc.2 wraps the sheet in
     createPortal(..., document.body): the overlay is a direct body child,
     nothing inside it matches a frame-descendant selector, and every rule
     here went dead at once. The live symptoms were the nav cells wrapping
     into uneven rows that slid under the 138px toolbar and the config-file
     button reappearing in that toolbar (owner report 2026-09-25). The
     portal-aware replacements live in layout.css.ts, in the "Settings
     dialog on mobile" section, anchored on the same structural
     :has(> :first-child > :last-child > button) gate (settings sheet only;
     export dialog and directory picker stay excluded). Nothing to restore
     here — do not re-add behind a frame selector. */
  /* Setting rows: no mobile rework — the host renders compact space-between
     rows natively (.Pt1bsG_row: text left, control right, 16px vertical
     padding, .5px divider). The previous "stack each row" rule family
     (column + gap:8 + control width:100% + the 36×20 switch cap that undid
     it) was written for the old two-column generation; on the redesigned
     host it doubled every row's height — the "settings feel vertically
     empty" report 2026-09-24 — and was removed in full. If an older host
     generation ever needs stacking again, reintroduce behind a generation
     guard, not as a blanket [class*="_row"] override. */
  /* Models provider editor: a CLOSED <details> ("_customized", the customized
     models section) must not paint its body. This engine paints the ~1500px
     model catalog of the closed details as a ghost layer anyway: it overlays
     the editor's own action rows (Fetch/Cancel/Apply/Add model) and the
     provider rows BEFORE the editor row in DOM order (those paint under the
     ghost and lose hit-testing), while rows after it paint above. Result
     (owner report 2026-09-19): providers cannot be deleted, "fetch available
     models" does nothing — every tap lands on whatever row overlaps the
     ghost. The host layout is computed for the collapsed details (editor
     217px, rows 903px), so the fix is to restore what the browser should do
     on its own: hide the body while the details is closed. Tapping the
     summary then opens it for real (details 33 → 1532px, rows re-flow,
     every button hittable — verified in place before this rule was written). */
  [aria-modal="true"] details[class*="_customized"]:not([open]) > [class*="_customizedBody"] {
    display: none !important;
  }
  /* Owner dialog footers (_w1urq family: the provider delete confirm, the
     workspace rename dialog, ...): the footer buttons keep white-space
     normal, so any width squeeze — a narrow viewport, a long provider name,
     Android font scaling (owner report 2026-09-19, verified at 320px with a
     1.3x font bump) — wraps the label inside the fixed 36px row where the
     second line clips. Keep each label on one line and let the footer wrap
     whole buttons to a second row instead. */
  [role="dialog"][aria-modal="true"] [class*="_footer"] {
    flex-wrap: wrap !important;
  }
  [role="dialog"][aria-modal="true"] [class*="_footer"] button[class*="_button"] {
    white-space: nowrap !important;
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
     The single injected footer action (the session-log download) becomes a
     full-width pill instead of a text-width capsule. */

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
     between metric groups, a 2px scrollbar as the swipe affordance.

     2026-09-23 改档（店主："把那个滑动的压缩一下，固定住，不再滑动"）：
     真机探针实测 可见宽 251px、内容 390px（"10 轮 268 步·244 tok/s" 178 +
     "57.5M tok·缓存命中 99%" 187，gap 12、font 12），右边 ~75px 被 dock 里的
     上下文百分比那块占着 ⇒ 一行本来就放不下。按店主选择：**保持一行 + 末尾
     省略号**。做法：字号 12→10（≈0.83×）、组间距 12→6、去掉为滚动条留的
     4px 下内边距；overflow 改 hidden（不可滑）、滚动条显式干掉；第一组
     flex:0 0 auto 保持完整，最后一组 flex:0 1 auto + min-width:0 自己吃掉
     差额并在末尾出省略号（实测截到"…缓存命…"，tok 数字仍完整可读）。
     高度仍是 28px：composer 的底部占位（8px + 28px）不变，其它几何不跟着动。 */

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
    overflow: hidden !important;
    overscroll-behavior-x: none;
    scrollbar-width: none !important;
    padding: 0 !important;
    line-height: 18px !important;
    font-size: 10px !important;
  }
  [data-mobile-nav="stats"]::-webkit-scrollbar {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
  [data-mobile-nav="stats"] > * {
    display: flex !important;
    flex-flow: row nowrap !important;
    align-items: center !important;
    white-space: nowrap !important;
    margin-right: 6px !important;
    padding: 0 !important;
  }
  /* 第一组（轮次·步数·tok/s）保持完整。 */
  [data-mobile-nav="stats"] > *:first-child {
    flex: 0 0 auto !important;
    width: max-content !important;
    min-width: max-content !important;
    max-width: none !important;
  }
  /* 最后一组（tok 总量·缓存命中）吃掉剩余宽度，末尾省略号。
     2026-09-23 第二版修正：第一版把整组改成 display:block + 子元素 inline，
     结果药丸里的图标变成 inline、基线对齐错位（店主："图标都出现位移"）。
     这版保持 flex 对齐，只让药丸**内部的文字 span** 收缩 + 出省略号；
     图标 svg 固定不缩。另外把两组药丸的左右内边距压到 6px、组间距压到 4px，
     抠出来的宽度全部让给第二组（实测它原本只分到 76px 而需要 156px）。 */
  [data-mobile-nav="stats"] > *:last-child {
    display: flex !important;
    align-items: center !important;
    flex: 0 1 auto !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: none !important;
    overflow: hidden !important;
    margin-right: 0 !important;
  }
  [data-mobile-nav="stats"] > *:last-child > * {
    display: flex !important;
    align-items: center !important;
    min-width: 0 !important;
    max-width: 100% !important;
    overflow: hidden !important;
  }
  [data-mobile-nav="stats"] > *:last-child svg {
    flex: 0 0 auto !important;
  }
  [data-mobile-nav="stats"] > *:last-child span {
    flex: 0 1 auto !important;
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }
  [data-mobile-nav="stats"] button {
    padding: 0 3px !important;
    margin: 0 !important;
    min-width: 0 !important;
    max-width: 100% !important;
  }
  /* 药丸内部的 span/svg 有自己的字号（宿主 .pill 自带），只在外层设 10px 不会被
     继承进去 —— 真机上第二组仍差 ~20px 被省略号切掉，所以这里显式压到内部。 */
  [data-mobile-nav="stats"] button,
  [data-mobile-nav="stats"] button span,
  [data-mobile-nav="stats"] button svg,
  [data-mobile-nav="stats"] > * {
    font-size: 10px !important;
    line-height: 18px !important;
  }
  [data-mobile-nav="stats"] > *:not(:last-child) {
    margin-right: 3px !important;
  }
  [data-mobile-nav="stats"] * {
    white-space: nowrap !important;
  }
  /* 「上下文环」显示在输入框行的右簇（店主 2026-09-23 确认：
     环要、百分比数字不要）。font-size:0 只塌掉文本、环 svg 有显式尺寸不受
     影响；绝对定位盖在自建占位上（见下方 #104 注释），不再搬动节点。 */
  [data-mobile-nav="stats-ring"] {
    position: absolute !important;
    flex: 0 0 auto !important;
    display: inline-flex !important;
    align-items: center !important;
    min-width: 0 !important;
    margin: 0 2px 0 0 !important;
    padding: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    border: 0 !important;
  }
  /* 文本要连**药丸内部**一起塌掉：药丸自带字号，只在外层设 0 不继承进去，
     真机上会留下半个 "46"。整棵子树 font-size:0，环 svg 用显式 px 不受影响。 */
  [data-mobile-nav="stats-ring"],
  [data-mobile-nav="stats-ring"] * {
    font-size: 0 !important;
  }
  [data-mobile-nav="stats-ring"] button {
    padding: 0 !important;
    margin: 0 !important;
    gap: 0 !important;
    min-width: 0 !important;
    width: auto !important;
    /* 宿主给药丸画的灰底/描边在输入框行里显得比环大一倍（店主："圆圈占了很多空间"），
       全去掉，只留环本身。 */
    background: transparent !important;
    box-shadow: none !important;
    border: 0 !important;
  }
  [data-mobile-nav="stats-ring"] svg {
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    flex: 0 0 auto !important;
  }
  /* 环与 TPS 读数不再搬动宿主 React 节点（#104：搬动后宿主卸载调 removeChild
     对不上父节点直接抛 NotFoundError，SlotErrorBoundary 把整个 composer 槽位
     清空）。节点留在 React 渲染的原位，可见槽位由插件自建占位顶住，宿主节点
     绝对定位盖在占位上；占位是插件节点，宿主重建/卸载都不经过它。 */
  [data-mobile-nav="stats-ring-reserve"],
  [data-mobile-nav="stats-tps-reserve"] {
    visibility: hidden !important;
    pointer-events: none !important;
  }
  [data-mobile-nav="stats-ring-reserve"] {
    flex: 0 0 auto !important;
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    margin: 0 2px 0 0 !important;
    padding: 0 !important;
  }
  [data-mobile-nav="stats-tps"] {
    display: flex !important;
    flex-flow: row nowrap !important;
    align-items: center !important;
    margin: 0 !important;
    padding: 0 !important;
    font-size: 10px !important;
    line-height: 18px !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }
  [data-mobile-nav="stats-tps"] * {
    white-space: nowrap !important;
  }
  [data-mobile-nav="stats-tps"] span {
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    min-width: 0 !important;
  }
  /* overlay 的定位上下文：宿主自己没定位时才生效（无 !important，宿主样式随时
     可以接管；stats-line 每帧按真实 positioned ancestor 计算，不受影响）。 */
  [data-mobile-nav="stats-ring-dock"],
  [data-mobile-nav="stats-tps-row"] {
    position: relative;
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

  /* ---------- git-graph branch chip: CSS re-anchor, no reparent (A′) ----------
     The branch chip (conversation.input.dock) floats between the dock rows
     and the input card; on a phone it reads as a stray capsule crowding the
     composer. #105: the old fix reparented the chip INTO the composer card,
     and React's unmount removeChild then threw NotFoundError into the
     SlotErrorBoundary (same root cause as #104). A′ re-anchors instead:
     the chip stays where React rendered it (inside the dock subtree) and
     the composerStack becomes the containing block, with the anchor
     constants = the card's static offset inside the stack + the original
     (12,12) corner offset. Constants measured 2026-09-24 (CDP, 393px):
     conversation phase card offset (16,0) → top 12 / left 28; hero phase
     card offset (16,122.9) → top 134.9 / left 28 (hero override below).
     The plugin's own sheet sets all four offsets on the anchor, so
     right/bottom must be neutralized too. Desktop untouched: the frame
     marker only exists below 1024px. Chip row geometry (2026-08-16, user
     feedback): 48px padding left a 16px dead gap and made the composer read
     too tall; 40px = chip (24px) at corner +12 + ~4px to the textarea; the
     chip has since grown to 28px (git-graph chip CSS), so the row is 44px
     (2026-09-06). The 44px clearance now keys off a STACK-level :has() —
     the chip is no longer a card descendant, so a card-level :has() could
     never match; the card disambiguation keeps non-composer cards (e.g. a
     todo card sharing the stack) out of the chip row. */
  [data-mobile-nav="frame"] [class*="_composerStack"] {
    position: relative;
  }
  [data-mobile-nav="frame"] [data-gitgraph-chip-anchor] {
    position: absolute !important;
    top: 12px !important;
    left: 28px !important;
    right: auto !important;
    bottom: auto !important;
    z-index: 1 !important;
  }
  [data-mobile-nav="frame"] [data-phase="hero"] [data-gitgraph-chip-anchor] {
    top: 134.9px !important;
  }
  [data-mobile-nav="frame"] [class*="_composerStack"]:has([data-gitgraph-chip-anchor]) [class*="_card"]:has(textarea, [data-composer-input]) {
    padding-top: 44px !important;
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

  /* ---------- dsh-file-viewer (conversation.view tab「文件查看器」) ----------
     The plugin ships NO responsive CSS: its min-width:0 flex panels overflow
     on a phone — the titlebar caps the path at 520px beside a 5-button action
     row, and CSV/code headers row-stick inside content scrollers. It renders
     inline into the conversation view region (stable 'dsfv-*' prefix, injected
     <style>), not a modal sheet, so the fixes here are: stop the PANEL from
     scrolling horizontally (leave horizontal scrolling inside the content
     scrollers), compress the titlebar/statusbar, enlarge touch targets, and
     scope everything under [data-file-viewer-open] so only the active
     file-viewer tab is affected. The marker is owned by the
     file-viewer-open-marker reconciler task; nothing leaks to desktop because
     this whole block lives inside the mobile media query.
     (Port of community fork fix 2ff7976.) */

  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-panel {
    min-width: 0 !important;
    max-width: 100% !important;
    overflow-x: hidden !important;
  }
  /* Titlebar: single compact row; path truncates, secondary meta hides on
     narrow, the 5-button action row wraps to two rows of tall targets. */
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-titlebar {
    gap: 4px !important;
    padding: 6px 8px !important;
    flex-wrap: nowrap !important;
    min-width: 0 !important;
  }
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-titlebar-path {
    min-width: 0 !important;
    padding-right: 4px !important;
  }
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-path {
    font-size: 13px !important;
    min-width: 0 !important;
    max-width: 220px !important;
  }
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-titlebar-actions {
    flex-wrap: wrap !important;
    gap: 4px !important;
    justify-content: flex-end !important;
    margin-left: auto !important;
  }
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-toolbar-btn {
    min-height: 34px !important;
    padding: 0 10px !important;
    font-size: 13px !important;
  }
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-icon-btn,
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-back-btn {
    min-height: 34px !important;
    min-width: 34px !important;
  }
  @media (max-width: 480px) {
    [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-meta {
      display: none !important;
    }
  }
  /* Status bar: wrap, safe-area bottom padding, compact. */
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-statusbar {
    flex-wrap: wrap !important;
    gap: 4px 10px !important;
    padding: 4px 8px calc(4px + env(safe-area-inset-bottom, 0px)) !important;
    font-size: 12px !important;
  }
  /* Content scrollers must own horizontal scrolling; the flex columns and the
     renderer stack must not let content push the panel wide. */
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-renderer,
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-renderer-stack,
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-scroll,
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-csv-scroll,
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-code-body {
    min-width: 0 !important;
    max-width: 100% !important;
  }
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-scroll,
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-csv-scroll {
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch !important;
  }
  /* Browser / subtoolbar rows wrap; file rows get touch-friendly height. */
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-browser-nav,
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-subtoolbar {
    flex-wrap: wrap !important;
    gap: 6px !important;
    padding: 4px 8px !important;
  }
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-file-row {
    min-height: 44px !important;
    padding: 8px 10px !important;
  }
  [data-mobile-nav="frame"][data-file-viewer-open] .dsfv-file-list [class*="name"] {
    min-width: 0 !important;
  }
  /* Produced-file chips render in the conversation tail, outside the viewer
     tab — keep tappable but not scoped to the marker. */
  [data-mobile-nav="frame"] .dsfv-produced-chip,
  [data-mobile-nav="frame"] .dsfv-produced-folder {
    min-height: 40px !important;
    padding: 0 12px !important;
  }
  @media (prefers-reduced-motion: reduce) {
    [data-mobile-nav="frame"][data-file-viewer-open] [class*="dsfv-"] {
      transition: none !important;
      animation: none !important;
    }
  }
}

`
