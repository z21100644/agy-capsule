// Deck injector: mounts a compact metrics strip into the Antigravity composer
// footer (next to the model selector) via the local DevTools (CDP) endpoint.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { createPresentation, getPresentationScript } from './ui.mjs';

const { escapeHtml, appearance, cacheView, contextBreakdown, quotaView, makeRingSvg } = createPresentation();

const INTERVAL_MS = 1000;
const INSTANCE_TS = Date.now();
const PORT_FILE =
  process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort')
    : process.platform === 'win32'
      ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Antigravity', 'DevToolsActivePort')
      : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'Antigravity', 'DevToolsActivePort');

// A renderer can retain several composers while only one is on screen.
function findFooterLeft() {
  let best = null, bestWidth = 0;
  for (const el of document.querySelectorAll('.agy-composer-footer > div:first-child')) {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (Math.min(r.bottom, window.innerHeight) <= Math.max(r.top, 0)) continue;
    const width = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
    if (width > bestWidth) { best = el; bestWidth = width; }
  }
  return best;
}

// A transform shrinks the box getBoundingClientRect reports, not the room an element needs.
function layoutSize(el, side) {
  return parseFloat(getComputedStyle(el)[side]) || el.getBoundingClientRect()[side];
}

function pageMount(d) {
  if (window.__deckOwnerTs && d.instanceTs && d.instanceTs < window.__deckOwnerTs) {
    return 'superseded';
  }
  if (d.instanceTs) {
    window.__deckOwnerTs = d.instanceTs;
  }
  const footerLeft = findFooterLeft();
  if (!footerLeft) {
    window.__agyCapsuleCleanup?.();
    return 'no-footer';
  }
  const presentation = globalThis.__agyCapsulePresentation;

  const clearFooterLayout = (node) => {
    node._turboTarget?.removeAttribute('data-deck-turbo-collapsed');
    const footer = node._observedFooterLeft || node.closest('.agy-composer-footer > div:first-child');
    if (!footer) return;
    const classes = ['dk-fl-squeezed', 'dk-model-squeezed', 'dk-model-squeezed-hard', 'dk-squeeze-box', 'dk-squeeze-item'];
    for (const element of [footer, ...footer.querySelectorAll(classes.map(c => '.' + c).join(','))]) element.classList.remove(...classes);
  };
  const release = (node) => {
    if (!node) return;
    document.removeEventListener('click', node._onOutsideClick);
    document.removeEventListener('keydown', node._onEscape);
    if (node._onResize) window.removeEventListener('resize', node._onResize);
    node._modelObserver?.disconnect();
    node._resizeObserver?.disconnect();
    if (node._layoutRaf) cancelAnimationFrame(node._layoutRaf);
    node._layoutRaf = 0;
    clearFooterLayout(node);
  };
  // A late legacy injector may recreate its light-DOM strip after migration.
  // Remove it on every pass, not only when initializing the shadow host.
  const legacy = document.getElementById('deck-metrics-strip');
  if (legacy) { release(legacy); legacy.remove(); }
  let host = document.getElementById('agy-capsule-host');
  let root = host?.shadowRoot?.getElementById('deck-metrics-strip');
  if (!root) {
    window.__agyCapsuleCleanup?.();
    host?.remove();
    host = document.createElement('div');
    host.id = 'agy-capsule-host';
    host.style.display = 'contents';
    const shadow = host.attachShadow({ mode: 'open' });
    root = document.createElement('div');
    root.id = 'deck-metrics-strip';
    shadow.appendChild(root);
  }

  // Upgrade or initialize DOM structure in-place
  if (root.getAttribute('data-deck-ver') !== '110') {
    release(root);
    root._pinnedGroup = null;
    root.removeAttribute('data-pinned');
    root.setAttribute('data-deck-ver', '110');
    root._speedActivity = null;
    root._motionPrev = null;
    root.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'flex-shrink: 0',
      'gap: 0px',
      'margin-left: 6px',
      'margin-right: 6px',
      'font-size: 12.5px',
      // Match the promo's Source Han faces, with local-only cross-platform fallbacks.
      'font-family: "Source Han Sans CN", "思源黑体 CN", "Source Han Sans SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", Arial, sans-serif',
      'font-weight: 400',
      'font-variation-settings: normal',
      'font-variant-ligatures: normal',
      'line-height: normal',
      'color: var(--secondary-foreground, var(--foreground, #3f3f46))',
      'user-select: none',
      'position: relative',
      '-webkit-font-smoothing: antialiased',
    ].join(';');

    root.innerHTML = `
      <style>
        #deck-metrics-strip, #deck-metrics-strip * { box-sizing: border-box; }
        #deck-metrics-strip .dk-grp {
          display: inline-flex;
          align-items: center;
          /* Popovers are placed by JS relative to their group: context and
             quota start at the strip's left edge but always reach their own
             capsule's right edge; the error panel right-aligns to its capsule. */
          position: relative;
        }
        #deck-metrics-strip .dk-pill {
          font: inherit;
          color: inherit;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 5px;
          border-radius: 6px;
          cursor: default;
          position: relative;
          background: transparent;
          border: none;
          white-space: nowrap;
          transition: background 0.12s ease, color 0.12s ease;
        }
        #deck-metrics-strip .dk-grp:hover .dk-pill,
        #deck-metrics-strip .dk-grp[data-pinned="true"] .dk-pill {
          background: var(--secondary, rgba(128, 128, 128, 0.12));
          color: var(--foreground, #0a0a0c);
        }
        #deck-metrics-strip .dk-grp:hover .dk-val,
        #deck-metrics-strip .dk-grp:hover .dk-svg,
        #deck-metrics-strip .dk-grp[data-pinned="true"] .dk-val,
        #deck-metrics-strip .dk-grp[data-pinned="true"] .dk-svg {
          color: var(--foreground, #0a0a0c);
        }
        #deck-metrics-strip .dk-pill-quota {
          gap: 10px;
        }
        #deck-metrics-strip .dk-q-pair[hidden] { display: none; }
        #deck-metrics-strip .dk-grp[hidden] { display: none; }
        #deck-metrics-strip [data-el="grpError"] .dk-pill,
        #deck-metrics-strip [data-el="grpError"] .dk-val,
        #deck-metrics-strip [data-el="grpError"] .dk-svg { color: #e06c75; }
        #deck-metrics-strip [data-el="grpError"][data-alert-mode="queue"] .dk-pill,
        #deck-metrics-strip [data-el="grpError"][data-alert-mode="queue"] .dk-val,
        #deck-metrics-strip [data-el="grpError"][data-alert-mode="queue"] .dk-svg { color: light-dark(#d97706, #d4940a); }
        #deck-metrics-strip [data-el="grpError"] [data-alert-icon] { display: none; }
        #deck-metrics-strip [data-el="grpError"][data-alert-mode="error"] [data-alert-icon="error"],
        #deck-metrics-strip [data-el="grpError"][data-alert-mode="queue"] [data-alert-icon="queue"] { display: inline-block; }
        #deck-metrics-strip .dk-error-pop { width: 240px; }
        #deck-metrics-strip .dk-error-heading { font-weight: 600; margin-bottom: 8px; color: var(--foreground, #ddd); }
        #deck-metrics-strip .dk-error-diagnostic { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border, #444); white-space: pre-wrap; }
        #deck-metrics-strip .dk-error-diagnostic:empty { display: none; }
        #deck-metrics-strip.dk-hide-error-label [data-el="grpError"] .dk-val,
        #deck-metrics-strip.dk-hide-ctx [data-el="grpCtx"] { display: none; }
        #deck-metrics-strip[data-context-tone="warning"] [data-k="pillCtx"] { color: #d4940a !important; }
        #deck-metrics-strip[data-context-tone="error"] [data-k="pillCtx"] { color: #e06c75 !important; }
        #deck-metrics-strip .dk-speed { padding-left: 2px; font-variant-numeric: tabular-nums; }
        #deck-metrics-strip .dk-speed-dot { display: none; }
        #deck-metrics-strip .dk-speed[data-motion] { display: inline-flex; align-items: center; gap: 4px; transition: color .35s ease; }
        #deck-metrics-strip .dk-speed[data-motion] .dk-speed-dot { display: inline-block; width: 5px; height: 5px; flex-shrink: 0; border-radius: 50%; background: currentColor; }
        #deck-metrics-strip .dk-speed[data-tier="green"] { color: light-dark(#16a34a, #4ea84e); }
        #deck-metrics-strip .dk-speed[data-tier="yellow"] { color: light-dark(#d97706, #d4940a); }
        #deck-metrics-strip .dk-speed[data-tier="red"] { color: light-dark(#dc2626, #e06c75); }
        #deck-metrics-strip .dk-speed[data-motion="idle"] { color: var(--muted-foreground, #8e8e93); }
        #deck-metrics-strip .dk-pill:hover .dk-speed[data-motion="idle"],
        #deck-metrics-strip .dk-grp[data-pinned="true"] .dk-speed[data-motion="idle"] { color: var(--foreground, #ebebeb); }
        #deck-metrics-strip .dk-speed[data-motion="active"] .dk-speed-dot { animation: dk-speed-breathe 1.2s ease-in-out infinite; }
        #deck-metrics-strip .dk-speed[data-motion="recent"] .dk-speed-dot { opacity: .9; }
        #deck-metrics-strip .dk-speed[data-motion="idle"] .dk-speed-dot { opacity: .48; }
        /* Same motion language as the settings previews: colors ease over .18s. */
        #deck-metrics-strip [data-k="pillCtx"], #deck-metrics-strip [data-el="ctxIconSvg"],
        #deck-metrics-strip .dk-cache-pct, #deck-metrics-strip .dk-cache-k { transition: color .18s ease, opacity .18s ease; }
        @keyframes dk-speed-breathe { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.78); } }
        @media (prefers-reduced-motion: reduce) {
          #deck-metrics-strip .dk-speed[data-motion="active"] .dk-speed-dot { animation: none; }
          #deck-metrics-strip .dk-speed[data-motion] { transition: none; }
          #deck-metrics-strip [data-k="pillCtx"], #deck-metrics-strip [data-el="ctxIconSvg"],
          #deck-metrics-strip .dk-cache-pct, #deck-metrics-strip .dk-cache-k, #deck-metrics-strip .dk-cache-meter > span, #deck-metrics-strip .dk-q-group, #deck-metrics-strip .dk-q-active { transition: none; }
        }
        #deck-metrics-strip .dk-speed[hidden],
        #deck-metrics-strip.dk-hide-speed .dk-speed { display: none; }
        #deck-metrics-strip .dk-generation { margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--border, rgba(142,142,147,.24)); font-variant-numeric: tabular-nums; }
        #deck-metrics-strip .generation-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--agy-row-gap, 5px) 10px; align-items: baseline; }
        #deck-metrics-strip .generation-row { display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; font-size: 13.5px; font-weight: 400; color: var(--muted-foreground, #8e8e93); }
        #deck-metrics-strip [data-generation-row="speed"] { justify-self: end; }
        #deck-metrics-strip .generation-row > :first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #deck-metrics-strip .generation-row > :last-child { flex-shrink: 0; white-space: nowrap; font-weight: 500; color: var(--foreground, #18181b); color: color-mix(in srgb, var(--foreground, #18181b) 88%, transparent); }
        #deck-metrics-strip [data-generation-row="timing"] > :last-child { font-weight: 400; color: var(--muted-foreground, #8e8e93); }
        #deck-metrics-strip .generation-heading { margin-bottom: 8px; font-size: 13.5px; font-weight: 500; color: var(--foreground, #18181b); color: color-mix(in srgb, var(--foreground, #18181b) 88%, transparent); }
        #deck-metrics-strip .generation-row[hidden], #deck-metrics-strip [data-generation-group][hidden] { display: none; }
        #deck-metrics-strip.dk-hide-wk [data-el="pairWk"],
        #deck-metrics-strip.dk-hide-5h [data-el="pair5h"] {
          display: none;
        }
        #deck-metrics-strip.dk-hide-wk .dk-pill-quota,
        #deck-metrics-strip.dk-hide-5h .dk-pill-quota {
          gap: 0;
        }
        #deck-metrics-strip.dk-hide-qval [data-el="grpQuota"] .dk-val {
          display: none;
        }
        #deck-metrics-strip.dk-hide-qval [data-el="grpQuota"] .dk-q-pair {
          gap: 0;
        }
        #deck-metrics-strip.dk-hide-cval [data-el="grpCtx"] .dk-val {
          display: none;
        }
        #deck-metrics-strip.dk-hide-cval [data-el="grpCtx"] .dk-pill {
          gap: 0;
        }
        #deck-metrics-strip.dk-hide-quota [data-el="grpQuota"] {
          display: none;
        }
        #deck-metrics-strip.dk-hide-all {
          display: none !important;
        }
        #deck-metrics-strip .dk-q-pair {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        #deck-metrics-strip .dk-svg {
          width: 13px;
          height: 13px;
          color: var(--muted-foreground, rgba(142, 142, 147, 0.85));
          flex-shrink: 0;
          transition: color 0.12s ease;
        }
        #deck-metrics-strip .dk-val {
          font-weight: 500;
          color: var(--muted-foreground, #71717a);
          font-variant-numeric: tabular-nums;
          transition: color 0.12s ease;
        }
        #deck-metrics-strip .dk-pop {
          display: none;
          position: absolute;
          bottom: calc(100% + 8px);
          left: 0;
          background: var(--card, rgba(20, 20, 22, 0.97));
          backdrop-filter: blur(22px);
          border: 1px solid var(--border, rgba(128, 128, 128, 0.18));
          border-radius: 10px;
          padding: var(--agy-pad-y, 10px) var(--agy-pad-x, 12px);
          max-width: var(--dk-pop-max-width, calc(100vw - 16px));
          overflow-wrap: anywhere;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.03);
          z-index: 999999;
          color: var(--muted-foreground, #8e8e93);
          font-size: 13.5px;
          line-height: 1.35;
          pointer-events: none;
        }
        #deck-metrics-strip .dk-grp:hover .dk-pop {
          display: block;
        }
        #deck-metrics-strip .dk-grp[data-pinned="true"] .dk-pop { display: block; pointer-events: auto; }
        #deck-metrics-strip[data-pinned] .dk-grp:not([data-pinned="true"]):hover .dk-pop { display: none; }
        #deck-metrics-strip .dk-grp[data-dismissed="true"] .dk-pop { display: none; }
        /* Context Popover (matches plugin UI) */
        #deck-metrics-strip .dk-ctx-pop {
          width: 228px;
        }
        #deck-metrics-strip .dk-cache-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          font-size: 13.5px;
          line-height: 1.35;
          padding-bottom: 5px;
          margin-bottom: 7.5px;
          border-bottom: 1px solid var(--border, rgba(142, 142, 147, 0.24));
        }
        #deck-metrics-strip .dk-cache-left {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-weight: 500;
          color: var(--foreground, #18181b);
          color: color-mix(in srgb, var(--foreground, #18181b) 88%, transparent);
          white-space: nowrap;
        }
        #deck-metrics-strip .dk-cache-left > .dk-dot {
          width: 10px;
          height: 10px;
          flex-shrink: 0;
        }
        #deck-metrics-strip[data-cache-indicator="ring"] .dk-cache-left > .dk-dot {
          width: 14px;
          height: 14px;
        }
        #deck-metrics-strip .dk-cache-left > .dk-dot:empty {
          display: none !important;
        }
        #deck-metrics-strip .dk-cache-meter {
          flex: 1;
          min-width: 32px;
          height: 4px;
          border-radius: 999px;
          background: rgba(142, 142, 147, 0.24);
          overflow: hidden;
        }
        #deck-metrics-strip .dk-cache-meter[hidden] {
          display: none;
        }
        #deck-metrics-strip .dk-cache-meter > span {
          display: block;
          height: 100%;
          width: 0%;
          border-radius: inherit;
          transition: width 0.35s linear, background-color 0.25s ease;
        }
        #deck-metrics-strip .dk-cache-pct {
          margin-left: 0;
          font-variant-numeric: tabular-nums;
          font-size: 13.5px;
          white-space: nowrap;
        }
        #deck-metrics-strip .dk-cache-k {
          text-align: right;
          color: var(--muted-foreground, #8e8e93);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          font-size: 13.5px;
          font-weight: 400;
        }
        #deck-metrics-strip .dk-cache-k:empty {
          display: none;
        }
        #deck-metrics-strip .dk-summary-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 6px;
          margin-bottom: 6.5px;
        }
        #deck-metrics-strip .dk-used-pct {
          font-size: 13.5px;
          font-weight: 400;
          color: var(--muted-foreground, #8e8e93);
        }
        #deck-metrics-strip .dk-used-pct > [data-k="usedPctText"] {
          font-weight: 500;
          color: var(--foreground, #18181b);
          color: color-mix(in srgb, var(--foreground, #18181b) 88%, transparent);
        }
        #deck-metrics-strip .dk-used-frac {
          font-size: 13.5px;
          font-weight: 400;
          color: var(--muted-foreground, #8e8e93);
          font-variant-numeric: tabular-nums;
        }
        #deck-metrics-strip .dk-track {
          position: relative;
          width: 100%;
          height: 4px;
          background: rgba(142, 142, 147, 0.24);
          border-radius: 999px;
          display: flex;
          gap: 1.5px;
          overflow: hidden;
          margin-bottom: 8.5px;
        }
        #deck-metrics-strip .dk-seg {
          height: 100%;
          border-radius: 999px;
          transition: width 0.25s ease;
        }
        #deck-metrics-strip .dk-list,
        #deck-metrics-strip .turn-bar-list {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          align-items: start;
          gap: 4px;
        }
        #deck-metrics-strip .turn-bar-list {
          grid-template-columns: minmax(calc((100% - 12px) / 4), max-content) minmax(0, 1fr) calc((100% - 12px) / 4) calc((100% - 12px) / 4);
        }
        #deck-metrics-strip .dk-item-row,
        #deck-metrics-strip .turn-bar-item {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          column-gap: 5px;
          row-gap: 2px;
          min-width: 0;
        }
        #deck-metrics-strip .dk-item-body {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        #deck-metrics-strip .dk-item-label,
        #deck-metrics-strip .turn-bar-label,
        #deck-metrics-strip .turn-bar-short {
          color: var(--muted-foreground, #8e8e93);
          font-size: 13.5px;
          line-height: 1.25;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #deck-metrics-strip .turn-bar-item[data-turn-row="requests"] {
          container-type: inline-size;
        }
        #deck-metrics-strip .turn-bar-short {
          display: none;
        }
        @container (max-width: 39px) {
          #deck-metrics-strip .turn-bar-item[data-turn-row="requests"] .turn-bar-label {
            display: none;
          }
          #deck-metrics-strip .turn-bar-item[data-turn-row="requests"] .turn-bar-short {
            display: block;
          }
        }
        #deck-metrics-strip .dk-item-row > .dk-dot,
        #deck-metrics-strip .turn-bar-line {
          grid-row: 1 / span 2;
          align-self: stretch;
          width: 2.5px;
          margin: 2px 0;
          border-radius: 99px;
          flex-shrink: 0;
        }
        #deck-metrics-strip .turn-bar-line {
          background: rgba(142, 142, 147, 0.42);
          background: color-mix(in srgb, var(--muted-foreground, #8e8e93) 55%, transparent);
        }
        #deck-metrics-strip .dk-item-row > .dk-dot { grid-row: 1; }
        #deck-metrics-strip .dk-item-k,
        #deck-metrics-strip .dk-item-pct,
        #deck-metrics-strip .turn-bar-val {
          grid-column: 2;
          color: var(--muted-foreground, #8e8e93);
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          font-size: 13.5px;
          font-weight: 400;
          line-height: 1.25;
        }
        /* Quota Popover (matches plugin UI) */
        #deck-metrics-strip .dk-quota-pop {
          width: max-content;
        }
        #deck-metrics-strip[data-quota-indicator="bar"] .dk-quota-pop {
          min-width: min(228px, var(--dk-pop-max-width, calc(100vw - 16px)));
        }
        /* One grid for the whole popover; groups, rows and the pct+indicator
           cell are subgrids, so every column lines up across all groups. */
        #deck-metrics-strip .dk-quota-pop > .dk-panel-content {
          display: grid;
          grid-template-columns: minmax(54px, max-content) max-content max-content minmax(0, max-content);
          column-gap: 8px;
          align-content: start;
        }
        #deck-metrics-strip[data-quota-indicator="bar"] .dk-quota-pop > .dk-panel-content {
          grid-template-columns: minmax(54px, max-content) max-content minmax(48px, 1fr) minmax(0, max-content);
        }
        #deck-metrics-strip[data-language^="zh"] .dk-quota-pop > .dk-panel-content {
          grid-template-columns: minmax(42px, max-content) max-content max-content minmax(0, max-content);
        }
        #deck-metrics-strip[data-language^="zh"][data-quota-indicator="bar"] .dk-quota-pop > .dk-panel-content {
          grid-template-columns: minmax(42px, max-content) max-content minmax(48px, 1fr) minmax(0, max-content);
        }
        #deck-metrics-strip .dk-q-group,
        #deck-metrics-strip .dk-q-row {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: subgrid;
          align-items: center;
        }
        #deck-metrics-strip .dk-q-title {
          grid-column: 1 / -1;
          font-size: 13.5px;
          font-weight: 500;
          line-height: 1.25;
          color: var(--foreground, #18181b);
          color: color-mix(in srgb, var(--foreground, #18181b) 88%, transparent);
        }
        #deck-metrics-strip .dk-q-row {
          font-size: 13.5px;
          font-variant-numeric: tabular-nums;
        }
        #deck-metrics-strip .dk-q-label {
          color: var(--muted-foreground, #8e8e93);
        }
        #deck-metrics-strip .dk-q-mid {
          grid-column: 4;
          text-align: left;
          color: var(--muted-foreground, #8e8e93);
        }
        #deck-metrics-strip .dk-q-right {
          grid-column: 2 / 4;
          display: grid;
          grid-template-columns: subgrid;
          align-items: center;
          column-gap: 5px;
          color: var(--muted-foreground, #8e8e93);
          white-space: nowrap;
        }
        /* Optional presentation inspired by z21100644/agy-capsule PR #1.
           Both styles use the existing four-category telemetry, unchanged. */
        #deck-metrics-strip .dk-q-group { transition: opacity .2s ease; }
        #deck-metrics-strip[data-highlight-active-model="true"] .dk-q-group[data-active="false"] { opacity: .7; }
        #deck-metrics-strip .dk-q-pct { justify-self: end; }
        #deck-metrics-strip .dk-q-meter { min-width: 24px; height: 4px; border-radius: 99px; overflow: hidden; background: rgba(142,142,147,.24); }
        #deck-metrics-strip .dk-q-meter > span { display: block; height: 100%; border-radius: inherit; }
        #deck-metrics-strip .dk-q-active { display: inline-block; width: 0; height: 4px; flex-shrink: 0; border-radius: 50%; background: currentColor; margin-left: 0; vertical-align: middle; align-self: center; opacity: 0; transform: scale(.5); transition: opacity .2s ease, transform .2s ease, width .2s ease, margin-left .2s ease; }
        #deck-metrics-strip[data-highlight-active-model="true"] .dk-q-group[data-active="true"] .dk-q-active { width: 4px; margin-left: 4px; opacity: 1; transform: scale(1); }
        /* Shared spacing rules; indicator and marker are independent. */
        #deck-metrics-strip .dk-list { row-gap: var(--agy-row-gap); }
        #deck-metrics-strip .dk-cache-bar { padding-bottom: var(--agy-section-gap); margin-bottom: var(--agy-section-gap); }
        #deck-metrics-strip .dk-generation { margin-top: var(--agy-section-gap); padding-top: var(--agy-section-gap); }
        #deck-metrics-strip [data-generation-block]:not([hidden]) + [data-turn-metrics-block] { border-top: 0; padding-top: 0; margin-top: var(--agy-section-gap); }
        #deck-metrics-strip .generation-heading { margin-bottom: var(--agy-row-gap); }
        #deck-metrics-strip .dk-q-group { margin: 0; }
        #deck-metrics-strip .dk-q-group + .dk-q-group { margin-top: calc(var(--agy-section-gap) + 4px); padding-top: 0; border-top: 0; }
        #deck-metrics-strip .dk-q-title { margin-bottom: var(--agy-row-gap); }
        #deck-metrics-strip .dk-q-row { margin-bottom: var(--agy-row-gap); }
        #deck-metrics-strip .dk-q-row:last-child { margin-bottom: 0; }
        #deck-metrics-strip[data-panel-layout="matched"] .dk-ctx-pop > .dk-panel-content { height: 100%; display: flex; flex-direction: column; justify-content: space-between; }
        #deck-metrics-strip[data-panel-layout="matched"] .dk-quota-pop > .dk-panel-content { height: 100%; align-content: space-between; }
        #deck-metrics-strip[data-label-case="lowercase"] .dk-cache-left,
        #deck-metrics-strip[data-label-case="lowercase"] .dk-used-pct,
        #deck-metrics-strip[data-label-case="lowercase"] .dk-item-label,
        #deck-metrics-strip[data-label-case="lowercase"] .turn-bar-label,
        #deck-metrics-strip[data-label-case="lowercase"] .turn-bar-short,
        #deck-metrics-strip[data-label-case="lowercase"] .dk-q-label { text-transform: lowercase; }
        /* Context breakdown / turn metrics: columns (vertical lines) or rows (marker + label + values). */
        #deck-metrics-strip:not([data-context-layout="rows"]) .dk-item-pct { display: none; }
        #deck-metrics-strip[data-column-percent="true"]:not([data-context-layout="rows"]) .dk-item-pct { display: block; }
        #deck-metrics-strip[data-column-label="false"]:not([data-context-layout="rows"]) .dk-item-label,
        #deck-metrics-strip[data-column-value="false"]:not([data-context-layout="rows"]) .dk-item-k { display: none; }
        #deck-metrics-strip[data-context-layout="rows"] .dk-list { grid-template-columns: auto minmax(0, 1fr) auto auto; column-gap: 8px; align-items: center; }
        #deck-metrics-strip[data-context-layout="rows"] .dk-item-row,
        #deck-metrics-strip[data-turn-layout="rows"] .turn-bar-item { grid-column: 1 / -1; display: grid; grid-template-columns: subgrid; align-items: center; }
        #deck-metrics-strip[data-context-layout="rows"] .dk-item-body { grid-column: 2 / -1; display: grid; grid-template-columns: subgrid; align-items: center; }
        #deck-metrics-strip[data-context-layout="rows"] .dk-item-label { grid-column: 1; grid-row: 1; }
        #deck-metrics-strip[data-context-layout="rows"] .dk-item-pct { grid-column: 2; grid-row: 1; justify-self: end; }
        #deck-metrics-strip[data-context-layout="rows"] .dk-item-k { grid-column: 3; grid-row: 1; justify-self: end; }
        #deck-metrics-strip[data-turn-layout="rows"] .turn-bar-list { grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 8px; row-gap: var(--agy-row-gap); align-items: center; }
        #deck-metrics-strip[data-turn-layout="rows"] .turn-bar-label { grid-column: 2; grid-row: 1; display: block; }
        #deck-metrics-strip[data-turn-layout="rows"] .turn-bar-short { display: none; }
        #deck-metrics-strip[data-turn-layout="rows"] .turn-bar-item[data-turn-row="requests"] { container-type: normal; }
        #deck-metrics-strip[data-context-layout="rows"] .dk-item-pct { margin-right: 4px; }
        #deck-metrics-strip[data-turn-layout="rows"] .turn-bar-val { grid-column: 3; grid-row: 1; justify-self: end; }
        #deck-metrics-strip[data-context-layout="rows"] .dk-item-row > .dk-dot,
        #deck-metrics-strip[data-turn-layout="rows"] .turn-bar-line { grid-column: 1; grid-row: 1; align-self: center; width: 10px; height: 10px; margin: 0; border-radius: 3px; }
        #deck-metrics-strip[data-context-marker="dot"][data-context-layout="rows"] .dk-item-row > .dk-dot,
        #deck-metrics-strip[data-turn-marker="dot"][data-turn-layout="rows"] .turn-bar-line { border-radius: 50%; }
        #deck-metrics-strip[data-show-context-breakdown="false"] .dk-list { display: none; }
        #deck-metrics-strip .dk-item-label { order: var(--agy-order-label, 0); }
        #deck-metrics-strip .dk-item-k { order: var(--agy-order-value, 1); }
        #deck-metrics-strip .dk-item-pct { order: var(--agy-order-percent, 2); }
      </style>

      <!-- Context Capsule + Popover -->
      <div class="dk-grp" data-el="grpCtx">
        <button type="button" class="dk-pill" aria-expanded="false">
          <svg class="dk-svg" data-el="ctxIconSvg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>
          <span class="dk-val" data-k="pillCtx">--%</span>
          <span class="dk-speed" data-el="pillSpeed" hidden><span class="dk-speed-dot" aria-hidden="true"></span><span data-generation="speed"></span></span>
        </button>
        <div class="dk-pop dk-ctx-pop">
          <div class="dk-panel-content">
          <div class="dk-cache-bar" data-el="rowCacheHit">
            <div class="dk-cache-left"><span data-i18n="cache">Cache</span><span class="dk-cache-pct" data-k="valCacheHit" data-el="valCacheHitEl">0%</span><span class="dk-dot" data-el="dotCached" style="display:inline-flex;align-items:center;justify-content:center;background:transparent"></span></div>
            <span class="dk-cache-meter" data-el="cacheMeter" hidden><span data-el="cacheMeterFill"></span></span>
            <div class="dk-cache-k" data-k="valCacheHitK"></div>
          </div>
          <div class="dk-summary-row">
            <div class="dk-used-pct" data-context-tip="overview"><span data-k="usedPctText">0%</span> <span data-i18n="used">used</span></div>
            <div class="dk-used-frac" data-k="usedFrac" data-context-tip="overview">0 / --</div>
          </div>
          <div class="dk-track" data-context-tip="overview">
            <div class="dk-seg" data-el="segTurn0" style="width: 0%; background: #d4940a"></div>
            <div class="dk-seg" data-el="segRead" style="width: 0%; background: #388bfd"></div>
            <div class="dk-seg" data-el="segThink" style="width: 0%; background: #00b386"></div>
            <div class="dk-seg" data-el="segOut" style="width: 0%; background: #e86a24"></div>
          </div>
          <div class="dk-list">
            <div class="dk-item-row" data-context-tip="turn0">
              <span class="dk-dot" style="background:#d4940a"></span>
              <div class="dk-item-body"><span class="dk-item-label" data-i18n="turn0">Turn0</span><span class="dk-item-k" data-k="valTurn0K">0</span><span class="dk-item-pct" data-k="valTurn0Pct">0%</span></div>
            </div>
            <div class="dk-item-row" data-context-tip="read">
              <span class="dk-dot" style="background:#388bfd"></span>
              <div class="dk-item-body"><span class="dk-item-label" data-i18n="read">Read</span><span class="dk-item-k" data-k="valReadK">0</span><span class="dk-item-pct" data-k="valReadPct">0%</span></div>
            </div>
            <div class="dk-item-row" data-context-tip="think">
              <span class="dk-dot" style="background:#00b386"></span>
              <div class="dk-item-body"><span class="dk-item-label" data-i18n="think">Think</span><span class="dk-item-k" data-k="valThinkK">0</span><span class="dk-item-pct" data-k="valThinkPct">0%</span></div>
            </div>
            <div class="dk-item-row" data-context-tip="write">
              <span class="dk-dot" style="background:#e86a24"></span>
              <div class="dk-item-body"><span class="dk-item-label" data-i18n="write">Write</span><span class="dk-item-k" data-k="valOutK">0</span><span class="dk-item-pct" data-k="valOutPct">0%</span></div>
            </div>
          </div>
          <div class="dk-generation" data-generation-block>
            ${presentation.generationMarkup()}
          </div>
          ${presentation.turnMetricsMarkup('dk-generation')}
          </div>
        </div>
      </div>

      <!-- Merged Quota Capsule (5h + Weekly) + Popover -->
      <div class="dk-grp" data-el="grpQuota">
        <button type="button" class="dk-pill dk-pill-quota" aria-expanded="false">
          <span class="dk-q-pair" data-el="pair5h">
            <svg class="dk-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>
            <span class="dk-val" data-k="pill5h">--%</span>
          </span>
          <span class="dk-q-pair" data-el="pairWk">
            <svg class="dk-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span class="dk-val" data-k="pillWk">--%</span>
          </span>
        </button>
        <div class="dk-pop dk-quota-pop" data-el="quotaPop"></div>
      </div>
      <div class="dk-grp" data-el="grpError" data-alert-mode="none" hidden>
        <button type="button" class="dk-pill" aria-expanded="false">
          <svg class="dk-svg" data-alert-icon="error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>
          <svg class="dk-svg" data-alert-icon="queue" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>
          <span class="dk-val" data-request-error="label"></span>
        </button>
        <div class="dk-pop dk-error-pop">
          <div class="dk-error-heading" data-request-error="heading"></div>
          <div data-request-error="detail"></div>
          <div class="dk-error-diagnostic" data-request-error="diagnostic"></div>
        </div>
      </div>
    `;

    // Only native layout integration stays outside the shadow boundary.
    let nativeStyle = document.getElementById('agy-capsule-native-layout');
    if (!nativeStyle) {
      nativeStyle = document.createElement('style');
      nativeStyle.id = 'agy-capsule-native-layout';
      document.head.appendChild(nativeStyle);
    }
    nativeStyle.textContent = `
        .agy-composer-footer button[data-deck-turbo-collapsed="true"] {
          width: 28px !important; min-width: 28px !important; max-width: 28px !important;
          padding: 6px !important; gap: 0 !important; justify-content: center !important;
        }
        .agy-composer-footer button[data-deck-turbo-collapsed="true"] > :not(:first-child) { display: none !important; }
        .agy-composer-footer button[data-deck-turbo-collapsed="true"] > svg:first-child { width: 16px !important; height: 16px !important; flex-shrink: 0 !important; }
        .agy-composer-footer .dk-fl-squeezed {
          min-width: 0 !important;
          flex-shrink: 1 !important;
        }
        .agy-composer-footer .dk-model-squeezed {
          min-width: 0 !important;
          flex: 0 1 auto !important;
          overflow: hidden !important;
          max-width: 100% !important;
        }
        .agy-composer-footer .dk-model-squeezed .dk-squeeze-box,
        .agy-composer-footer .dk-model-squeezed .dk-squeeze-item {
          min-width: 0 !important;
          max-width: 100% !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }
        .agy-composer-footer .dk-model-squeezed .dk-squeeze-box,
        .agy-composer-footer .dk-model-squeezed-hard .dk-squeeze-item {
          flex-shrink: 1 !important;
        }
        .agy-composer-footer .dk-model-squeezed svg {
          flex-shrink: 0 !important;
        }
    `;
    root._dispose = () => {
      release(root);
      nativeStyle.remove();
      host.remove();
      if (window.__agyCapsuleCleanup === root._dispose) delete window.__agyCapsuleCleanup;
    };
    window.__agyCapsuleCleanup = root._dispose;

    const closePinned = (dismiss = false) => {
      const pinned = root._pinnedGroup;
      if (pinned) {
        pinned.removeAttribute('data-pinned');
        if (dismiss) pinned.dataset.dismissed = 'true';
        pinned.querySelector('.dk-pill').setAttribute('aria-expanded', 'false');
      }
      root._pinnedGroup = null;
      root.removeAttribute('data-pinned');
    };
    root._layoutPopovers = (grp = root._pinnedGroup || root.querySelector('.dk-grp:hover')) => {
      const pop = grp?.querySelector('.dk-pop');
      if (!pop && root.dataset.panelLayout !== 'matched') {
        root._fitPanelHeights?.();
        return;
      }
      // Constrain width before measuring heights or positioning; moving a panel
      // alone cannot make it fit inside a narrower clipping ancestor.
      let minLeft = 8;
      let maxRight = window.innerWidth - 8;
      for (let el = root; el && el !== document.documentElement; el = el.parentElement || el.getRootNode().host) {
        const cs = getComputedStyle(el);
        if (cs.overflowX === 'visible' && !/paint|strict|content/.test(cs.contain)) continue;
        const innerLeft = el.getBoundingClientRect().left + el.clientLeft;
        minLeft = Math.max(minLeft, innerLeft + 4);
        maxRight = Math.min(maxRight, innerLeft + el.clientWidth - 4);
      }
      const limit = `${Math.max(0, maxRight - minLeft)}px`;
      if (root.style.getPropertyValue('--dk-pop-max-width') !== limit) root.style.setProperty('--dk-pop-max-width', limit);
      root._fitPanelHeights?.();
      if (!pop?.getBoundingClientRect().width) return;
      const width = layoutSize(pop, 'width');
      const pill = grp.querySelector('.dk-pill').getBoundingClientRect();
      const stripLeft = root.getBoundingClientRect().left;
      let left = Math.max(stripLeft, pill.right - width);
      left = Math.max(minLeft, Math.min(left, maxRight - width));
      pop.style.left = (left - grp.getBoundingClientRect().left) + 'px';
    };
    for (const grp of root.querySelectorAll('.dk-grp')) {
      grp.addEventListener('mouseenter', () => {
        root._refreshCacheTooltip?.();
        grp.removeAttribute('data-dismissed');
        if (!root._pinnedGroup || root._pinnedGroup === grp) grp.querySelector('.dk-pill').setAttribute('aria-expanded', 'true');
        root._layoutPopovers(root._pinnedGroup || grp);
      });
      grp.addEventListener('mouseleave', () => {
        grp.removeAttribute('data-dismissed');
        if (root._pinnedGroup === grp) return;
        grp.querySelector('.dk-pill').setAttribute('aria-expanded', 'false');
        const pop = grp.querySelector('.dk-pop');
        if (pop) pop.style.left = '';
      });
      grp.querySelector('.dk-pill').addEventListener('click', (event) => {
        event.stopPropagation();
        root._refreshCacheTooltip?.();
        const wasPinned = root._pinnedGroup === grp;
        closePinned();
        if (wasPinned) {
          grp.dataset.dismissed = 'true';
        } else {
          grp.removeAttribute('data-dismissed');
          grp.dataset.pinned = 'true';
          root.dataset.pinned = 'true';
          root._pinnedGroup = grp;
          grp.querySelector('.dk-pill').setAttribute('aria-expanded', 'true');
          root._layoutPopovers(grp);
        }
      });
    }
    root._onOutsideClick = (event) => { if (!event.composedPath().includes(root)) closePinned(); };
    root._onEscape = (event) => {
      if (event.key !== 'Escape') return;
      closePinned(true);
      for (const grp of root.querySelectorAll('.dk-grp')) {
        grp.dataset.dismissed = 'true';
        grp.querySelector('.dk-pill').setAttribute('aria-expanded', 'false');
      }
    };
    document.addEventListener('click', root._onOutsideClick);
    document.addEventListener('keydown', root._onEscape);
    root._onResize = () => root._scheduleLayout?.();
    window.addEventListener('resize', root._onResize);
    root.querySelector('[data-el="rowCacheHit"]').addEventListener('mouseenter', () => root._refreshCacheTooltip?.());
  }

  if (!footerLeft.contains(host)) {
    footerLeft.appendChild(host);
  }
  const labels = presentation.apply(root, d.prefs);
  presentation.renderContextTooltips(root, d.contextData, labels);
  const now = Date.now();
  const cancelBtnVisible = !!footerLeft.parentElement.querySelector('[data-testid="input-cancel-button"]');
  const alerts = presentation.renderAlerts(root, { ...d.contextData, requestError: d.requestError, turnQueue: d.turnQueue }, d.prefs, labels, now, cancelBtnVisible || !!d.turnQueue?.hasPendingPlanner);
  root.querySelector('[data-el="grpQuota"]').hidden = d.cloudPaygo;
  if (root._pinnedGroup?.hidden) {
    root._pinnedGroup.removeAttribute('data-pinned');
    root._pinnedGroup.querySelector('.dk-pill').setAttribute('aria-expanded', 'false');
    root._pinnedGroup = null;
    root.removeAttribute('data-pinned');
  }
  root._refreshCacheTooltip = () => {
    root.querySelector('[data-el="rowCacheHit"]').title = presentation.cacheTooltip(d.cache, labels, Date.now(), d.prefs);
  };
  root._refreshCacheTooltip();
  presentation.renderGeneration(root.querySelector('.dk-ctx-pop'), d.generation, labels, d.prefs);
  presentation.renderTurnMetrics(root, d.turnMetrics, labels, d.prefs);
  const pillSpeed = root.querySelector('[data-el="pillSpeed"]');
  const tps = d.turnSpeed?.generation?.tps;
  // Turn scope comes from persisted USER_INPUT, not cancel-button appearance.
  // Activity and the last completed request's speed are independent signals.
  const turnKey = location.pathname + ':' + (d.turnSpeed?.userStepIndex ?? 'none');
  const requestIndex = d.turnSpeed?.generation?.requestIndex ?? null;
  const running = !!d.turnSpeed?.hasActiveStep || cancelBtnVisible;
  const hasSpeed = Number.isFinite(tps) && tps >= 0;
  const motionEnabled = d.prefs?.speedAnimation === true;
  pillSpeed.hidden = d.prefs?.showSpeed === false || (!d.turnSpeed && !running);
  const speedValue = pillSpeed.querySelector('[data-generation="speed"]');
  const speedText = hasSpeed ? tps.toFixed(1) + ' tok/s' : '—';
  if (speedValue.textContent !== speedText) speedValue.textContent = speedText;
  let activity = root._speedActivity;
  if (!activity || activity.turnKey !== turnKey) {
    activity = root._speedActivity = { turnKey, running: false, requestIndex: null, coolUntil: 0 };
  }
  if (running) activity.coolUntil = 0;
  else if (activity.running) activity.coolUntil = now + 15000;
  else if (requestIndex !== null && requestIndex !== activity.requestIndex) {
    // Use response completion time, not unrelated tool activity.
    const recordedAt = d.turnSpeed?.completedAtMs || 0;
    if (recordedAt > 0 && recordedAt <= now) activity.coolUntil = Math.max(activity.coolUntil, recordedAt + 15000);
  }
  activity.running = running;
  activity.requestIndex = requestIndex;
  if (motionEnabled && !pillSpeed.hidden) {
    pillSpeed.dataset.motion = running ? 'active' : activity.coolUntil > now ? 'recent' : 'idle';
    pillSpeed.dataset.tier = hasSpeed ? (tps >= 25 ? 'green' : tps >= 10 ? 'yellow' : 'red') : 'unknown';
  } else {
    pillSpeed.removeAttribute('data-motion');
    pillSpeed.removeAttribute('data-tier');
  }
  const contextPill = root.querySelector('[data-el="grpCtx"] .dk-pill');
  contextPill.setAttribute('aria-label', labels.context);
  for (const node of [contextPill, ...contextPill.querySelectorAll('[title]')]) node.removeAttribute('title');
  root.querySelector('[data-el="grpQuota"] .dk-pill').setAttribute('aria-label', labels.quota);

  const setK = (k, val) => {
    const el = root.querySelector(`[data-k="${k}"]`);
    if (el && el.textContent !== val) el.textContent = val;
  };

  setK('pillCtx', d.pillCtx);
  setK('usedPctText', d.pillCtx);
  setK('usedFrac', d.usedFrac);
  setK('valCacheHit', d.valCacheHit);
  setK('valCacheHitK', d.valCacheHitK || '');
  setK('valTurn0K', d.valTurn0K);
  setK('valReadK', d.valReadK);
  setK('valThinkK', d.valThinkK);
  setK('valOutK', d.valOutK);
  setK('valTurn0Pct', d.valTurn0Pct);
  setK('valReadPct', d.valReadPct);
  setK('valThinkPct', d.valThinkPct);
  setK('valOutPct', d.valOutPct);

  // Match active model to quota pills
  root._deckQuotas = d;
  // Reveals reserve their final width before fitting the footer. Animating layout
  // width from zero lets the fit check pass too early and overlap native buttons.
  // Leaving items may shrink; they never need more room than the fitted layout.
  const motion = (key, el, restore) => {
    const state = root._motionPrev || (root._motionPrev = {});
    // Still collapsing: a later re-render hiding it again must not cut the animation short.
    if (el._leaving) {
      if (el.hidden) { el.hidden = false; return; }
      el._leaving.cancel(); el._leaving = null;
    }
    const visible = !el.hidden;
    const text = el.textContent;
    const width = visible ? el.getBoundingClientRect().width : 0;
    const p = state[key];
    state[key] = { visible, text, width };
    if (!p || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (visible === p.visible && (!visible || text === p.text)) return;
    for (const a of el.getAnimations()) a.cancel();
    const gap = parseFloat(getComputedStyle(el.parentElement).columnGap) || 0;
    // Cancel the gap on the side that has a neighbour, so a leading item doesn't slide outside its capsule.
    const prevSib = el.previousElementSibling;
    const side = prevSib && !prevSib.hidden && getComputedStyle(prevSib).display !== 'none' ? 'marginLeft' : 'marginRight';
    const box = (w, o, m) => ({ overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: w + 'px', minWidth: Math.min(w, width || w) + 'px', opacity: o, [side]: m + 'px' });
    const timing = { duration: 220, easing: 'ease' };
    if (visible && !p.visible) {
      el.animate([{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }, { opacity: 1, clipPath: 'inset(0)' }], timing);
    } else if (!visible && p.visible) {
      el.hidden = false;
      restore?.(p.text); // collapse what was shown, not the cleared value
      const out = el.animate([{ ...box(p.width, 1, 0), minWidth: '0px' }, { ...box(0, 0, -gap), minWidth: '0px' }], { ...timing, fill: 'forwards' });
      el._leaving = out;
      out.onfinish = () => { el._leaving = null; el.hidden = true; out.cancel(); root._scheduleLayout?.(); };
    } else if (Math.abs(width - p.width) > 0.5) {
      el.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 180, easing: 'ease' });
    }
  };
  const applyModelQuota = () => {
    let mt = '';
    for (const child of footerLeft.children) {
      if (child !== host && child.textContent) {
        mt += ' ' + child.textContent.trim();
      }
    }
    mt = mt.trim().toLowerCase();
    const q = root._deckQuotas || d;
    const groups = q.quotaSummaryGroups || [];

    let matched = null;
    // 1. Match specific non-generic group titles (e.g. "Gemini 4 Argon", "Gemini 4 Carbon", "Claude and GPT models")
    for (const g of groups) {
      if (g.title === 'Gemini') continue;
      if (
        (g.rawName.includes('claude') || g.rawName.includes('gpt')) &&
        (mt.includes('claude') || mt.includes('sonnet') || mt.includes('opus') || mt.includes('gpt'))
      ) {
        matched = g;
        break;
      }
      const tokens = g.rawName
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !['gemini', 'model', 'models', 'and', 'the', 'for'].includes(t));
      if (tokens.some((t) => mt.includes(t))) {
        matched = g;
        break;
      }
    }

    // 2. Match explicit "Models within this group: ..." description list
    if (!matched) {
      const modelKeys = ['carbon', 'argon', 'hydrogen', 'flash', 'claude', 'sonnet', 'opus', 'gpt'];
      const activeKeys = modelKeys.filter((k) => mt.includes(k));
      if (activeKeys.length > 0) {
        matched = groups.find((g) => activeKeys.some((k) => g.modelsInGroup && g.modelsInGroup.includes(k))) || null;
      }
    }

    // 3. Fallback to main Gemini group (handles Ultra where Argon is part of Gemini Models)
    if (!matched) {
      matched = groups.find((g) => g.title === 'Gemini') || groups[0] || null;
    }
    for (const group of root.querySelectorAll('.dk-q-group')) {
      group.dataset.active = group.dataset.pool === matched?.rawName ? 'true' : 'false';
    }

    const q5hVal = matched ? matched.q5h || '--%' : '--%';
    const qWkVal = matched ? matched.qWk || '--%' : '--%';
    setK('pill5h', q5hVal);
    setK('pillWk', qWkVal);
    const hideAbsent = q.prefs?.hideUnavailableQuota === true;
    const pair5h = root.querySelector('[data-el="pair5h"]');
    const pairWk = root.querySelector('[data-el="pairWk"]');
    pair5h.hidden = hideAbsent && q5hVal === '--%' && qWkVal !== '--%';
    pairWk.hidden = hideAbsent && qWkVal === '--%' && q5hVal !== '--%';
    motion('pair5h', pair5h);
    motion('pairWk', pairWk);
    root.dataset.preferWkOnly = q5hVal === '--%' && qWkVal !== '--%' ? '1' : '0';
    return mt;
  };
  root._applyModelQuota = applyModelQuota;
  const modelText = applyModelQuota();

  const getNativeVisualInfo = (el) => {
    let maxR = -Infinity;
    let svgClipped = false;
    const walk = (node, parentClip) => {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (cs.display === 'contents') {
        for (const child of node.children) walk(child, parentClip);
        return;
      }
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      const r = node.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        if (tag === 'svg') {
          if (parentClip < Infinity && r.width > 0 && r.right > parentClip + 1) {
            svgClipped = true;
          }
          const visR = Math.min(r.right, parentClip);
          if (visR > maxR) maxR = visR;
          return;
        }
        const visR = Math.min(r.right, parentClip);
        if (visR > maxR) maxR = visR;
        const ownClip = cs.overflowX === 'hidden' || cs.overflowX === 'clip' ? r.right : Infinity;
        const nextClip = Math.min(parentClip, ownClip);
        if (cs.overflowX === 'visible' && node.scrollWidth > node.clientWidth + 1) {
          const overflowR = Math.min(r.left + node.scrollWidth, parentClip);
          if (overflowR > maxR) maxR = overflowR;
        }
        for (const child of node.children) walk(child, nextClip);
      } else {
        for (const child of node.children) walk(child, parentClip);
      }
    };
    walk(el, Infinity);
    return { maxR, svgClipped };
  };

  const adjustLayout = () => {
    if (root._adjustingLayout) return;
    root._adjustingLayout = true;
    try {
    const footer = footerLeft.parentElement;
    if (!footer || footer.getBoundingClientRect().width <= 0) return;
    const visible = el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const children = Array.from(footerLeft.children);
    const nativeChildren = children.slice(0, children.indexOf(host)).filter(el => visible(el) || el.classList.contains('dk-model-squeezed'));
    const modelTargets = nativeChildren.filter((c) => c.textContent && c.textContent.trim().length > 0);
    const turbo = footer.querySelector('[data-testid="permissions-selector-trigger"]');
    if (root._turboTarget && root._turboTarget !== turbo) root._turboTarget.removeAttribute('data-deck-turbo-collapsed');
    root._turboTarget = turbo;

    const isClippedEl = (el) => {
      if (el instanceof SVGElement) return false;
      const overflow = getComputedStyle(el).overflowX;
      if (overflow !== 'hidden' && overflow !== 'clip') return false;
      if (el.scrollWidth <= el.clientWidth + 2) return false;
      const r = el.getBoundingClientRect();
      return r.height > 0 && el.getClientRects().length > 0;
    };

    const isNativeSqueezed = () => {
      for (const c of nativeChildren) {
        if (isClippedEl(c)) return true;
        for (const node of c.querySelectorAll('*')) {
          if (isClippedEl(node)) return true;
        }
      }
      return false;
    };

    const syncSqueezeClasses = (compress) => {
      footerLeft.classList.toggle('dk-fl-squeezed', !!compress);
      for (const mt of modelTargets) {
        mt.classList.toggle('dk-model-squeezed', !!compress);
        mt.classList.toggle('dk-model-squeezed-hard', compress === 'hard');
        if (!compress) {
          mt.classList.remove('dk-squeeze-box', 'dk-squeeze-item');
          for (const el of mt.querySelectorAll('.dk-squeeze-box, .dk-squeeze-item')) {
            el.classList.remove('dk-squeeze-box', 'dk-squeeze-item');
          }
          continue;
        }
        const tag = (el) => {
          const txt = el.textContent ? el.textContent.trim() : '';
          if (!txt) {
            el.classList.remove('dk-squeeze-box', 'dk-squeeze-item');
            return;
          }
          const isBoxOrLong = el.children.length > 0 || txt.length > 5;
          el.classList.toggle('dk-squeeze-box', isBoxOrLong);
          el.classList.toggle('dk-squeeze-item', !isBoxOrLong);
        };
        tag(mt);
        for (const el of mt.querySelectorAll('div, span, button, a, p, label')) tag(el);
      }
    };

    const compactCls = root.dataset.preferWkOnly === '1' ? 'dk-hide-5h' : 'dk-hide-wk';
    const modeClasses = ['dk-hide-speed', 'dk-hide-wk', 'dk-hide-5h', 'dk-hide-qval', 'dk-hide-cval', 'dk-hide-quota', 'dk-hide-error-label', 'dk-hide-ctx', 'dk-hide-all'];
    const modes = [
      { classes: [], compress: '' },
      // First reserve width by collapsing the native Turbo selector to its shield.
      // Keep it collapsed through ALL capsule stages, never alternate priorities.
      ...(turbo ? [{ classes: [], compress: '' }] : []),
      { classes: ['dk-hide-speed'], compress: '' },
      ...(alerts.visible ? [{ classes: ['dk-hide-error-label'], compress: '' }] : []),
      { classes: [compactCls, 'dk-hide-error-label'], compress: '' },
      { classes: [compactCls, 'dk-hide-qval', 'dk-hide-error-label'], compress: '' },
      { classes: [compactCls, 'dk-hide-qval', 'dk-hide-error-label', 'dk-hide-cval'], compress: '' },
      { classes: [compactCls, 'dk-hide-qval', 'dk-hide-error-label', 'dk-hide-cval'], compress: 'soft' },
      { classes: [compactCls, 'dk-hide-qval', 'dk-hide-error-label', 'dk-hide-cval'], compress: 'hard' },
      { classes: ['dk-hide-cval', 'dk-hide-quota', 'dk-hide-error-label'], compress: 'hard' },
      ...(alerts.visible ? [{ classes: ['dk-hide-ctx', 'dk-hide-quota', 'dk-hide-error-label'], compress: 'hard' }] : []),
      { classes: ['dk-hide-all'], compress: '' },
    ];

    for (const [modeIndex, mode] of modes.entries()) {
      if (turbo) {
        if (modeIndex > 0) turbo.setAttribute('data-deck-turbo-collapsed', 'true');
        else turbo.removeAttribute('data-deck-turbo-collapsed');
      }
      const classes = mode.classes.length > 0 && !mode.classes.includes('dk-hide-speed') ? ['dk-hide-speed', ...mode.classes] : mode.classes;
      for (const cls of modeClasses) {
        root.classList.toggle(cls, classes.includes(cls));
      }
      syncSqueezeClasses(mode.compress);
      if (mode.classes.includes('dk-hide-all')) break;

      const rootRect = root.getBoundingClientRect();
      if (rootRect.width <= 0) continue;

      const rightControls = footer
        ? Array.from(footer.children).filter((el) => {
            if (el === footerLeft || !visible(el) || !(el.textContent.trim() || el.querySelector('button, svg, img, input, a, [role="button"]'))) return false;
            const rect = el.getBoundingClientRect();
            const left = footerLeft.getBoundingClientRect();
            return rect.bottom > left.top + 2 && rect.top < left.bottom - 2;
          })
        : [];
      const rightMinLeft =
        rightControls.length > 0
          ? Math.min(...rightControls.map((el) => el.getBoundingClientRect().left))
          : Infinity;
      const footerCs = footer ? getComputedStyle(footer) : null;
      const footerRightEdge = footer
        ? footer.getBoundingClientRect().right - (parseFloat(footerCs.paddingRight) || 0)
        : Infinity;
      const flCs = getComputedStyle(footerLeft);
      const flClipRight = flCs.overflowX !== 'visible' ? footerLeft.getBoundingClientRect().right + 1 : Infinity;
      const minRightBound = Math.min(rightMinLeft, footerRightEdge, flClipRight);

      let nativeMaxRight = -Infinity;
      let anySvgClipped = false;
      for (const c of nativeChildren) {
        const info = getNativeVisualInfo(c);
        if (info.maxR > nativeMaxRight) nativeMaxRight = info.maxR;
        if (info.svgClipped) anySvgClipped = true;
      }

      const fitsRight =
        rootRect.right <= rightMinLeft - 4 &&
        rootRect.right <= footerRightEdge + 1 &&
        rootRect.right <= flClipRight;
      const fitsLeft = nativeMaxRight === -Infinity || rootRect.left >= nativeMaxRight + 1;
      const crowdedModel = !mode.compress && minRightBound - rootRect.right < 24 && isNativeSqueezed();
      if (fitsRight && fitsLeft && !(mode.compress && anySvgClipped) && !crowdedModel) break;
    }
    } finally {
      root._adjustingLayout = false;
    }
  };
  root._adjustLayout = () => {
    adjustLayout();
    root._layoutPopovers();
  };
  root._scheduleLayout = () => {
    if (root._layoutRaf) return;
    root._layoutRaf = requestAnimationFrame(() => {
      root._layoutRaf = 0;
      if (root.isConnected) root._adjustLayout();
    });
  };

  if (root._observedFooterLeft !== footerLeft) {
    if (root._observedFooterLeft) clearFooterLayout(root);
    if (root._modelObserver) root._modelObserver.disconnect();
    if (root._resizeObserver) root._resizeObserver.disconnect();
    root._observedFooterLeft = footerLeft;

    const obs = new MutationObserver((mutations) => {
      if (mutations.every((m) => root.contains(m.target))) return;
      const lateLegacy = document.getElementById('deck-metrics-strip');
      if (lateLegacy) {
        release(lateLegacy);
        lateLegacy.remove();
        if (globalThis.__agyCapsuleDeck) window.__deckOwnerTs = globalThis.__agyCapsuleDeck.owner;
      }
      if (root._applyModelQuota) root._applyModelQuota();
      root._scheduleLayout?.();
    });
    obs.observe(footerLeft, { subtree: true, characterData: true, childList: true });
    root._modelObserver = obs;

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        root._scheduleLayout?.();
      });
      if (footerLeft.parentElement) ro.observe(footerLeft.parentElement);
      ro.observe(footerLeft);
      root._resizeObserver = ro;
    }
  }

  // Update progress bar & cache cooling indicator
  const segRead = root.querySelector('[data-el="segRead"]');
  const segOut = root.querySelector('[data-el="segOut"]');
  const segThink = root.querySelector('[data-el="segThink"]');
  const segTurn0 = root.querySelector('[data-el="segTurn0"]');
  const dotCached = root.querySelector('[data-el="dotCached"]');
  const ctxIconSvg = root.querySelector('[data-el="ctxIconSvg"]');

  if (segRead) segRead.style.width = d.segReadW;
  if (segOut) segOut.style.width = d.segOutW;
  if (segThink) segThink.style.width = d.segThinkW;
  if (segTurn0) segTurn0.style.width = d.segTurn0W;
  if (ctxIconSvg) ctxIconSvg.style.color = d.ctxIconColor || '';
  if (dotCached && dotCached.innerHTML !== d.cacheIconSvg) {
    dotCached.innerHTML = d.cacheIconSvg;
  }
  const cacheMeter = root.querySelector('[data-el="cacheMeter"]');
  const cacheMeterFill = root.querySelector('[data-el="cacheMeterFill"]');
  if (cacheMeter && cacheMeterFill) {
    cacheMeter.hidden = d.cacheIndicator !== 'bar';
    if (!cacheMeter.hidden) {
      cacheMeterFill.style.width = d.cacheProgressPct || '0%';
      cacheMeterFill.style.backgroundColor = d.cacheProgressColor || '';
    }
  }
  const valCacheHitEl = root.querySelector('[data-el="valCacheHitEl"]');
  if (valCacheHitEl) {
    valCacheHitEl.style.color = d.cacheValColor;
    valCacheHitEl.style.textDecoration = d.cacheValDeco;
    valCacheHitEl.style.opacity = d.cacheValOp;
  }
  const valCacheHitKEl = root.querySelector('[data-k="valCacheHitK"]');
  if (valCacheHitKEl) {
    valCacheHitKEl.style.color = d.cacheValColor;
  }

  motion('speed', pillSpeed, text => { speedValue.textContent = text.trim(); });
  motion('error', root.querySelector('[data-el="grpError"]'));

  // Update Quota Popover HTML
  const quotaPop = root.querySelector('[data-el="quotaPop"]');
  if (quotaPop && quotaPop.innerHTML !== d.quotaHtml) {
    quotaPop.innerHTML = d.quotaHtml;
  }
  presentation.apply(root, d.prefs);
  applyModelQuota();

  root._fitPanelHeights = () => {
    // Only visible capsules participate in matched panel height.
    const errorPop = root.querySelector('.dk-error-pop');
    const pops = [root.querySelector('.dk-ctx-pop')];
    if (!quotaPop.closest('.dk-grp').hidden) pops.push(quotaPop);
    else quotaPop.style.height = '';
    if (errorPop && !errorPop.closest('.dk-grp').hidden) pops.push(errorPop);
    else if (errorPop) errorPop.style.height = '';
    if (root.dataset.panelLayout !== 'matched') {
      for (const pop of pops) pop.style.height = '';
      root._heightKey = '';
      return;
    }
    const key = JSON.stringify(d.prefs) + pops.map(pop => pop.textContent).join('|') + root.style.getPropertyValue('--dk-pop-max-width');
    if (key === root._heightKey) return;
    const previous = pops.map(pop => ({ display: pop.style.display, visibility: pop.style.visibility }));
    root.dataset.panelLayout = 'natural';
    for (const pop of pops) { pop.style.height = ''; pop.style.display = 'block'; pop.style.visibility = 'hidden'; }
    const heights = pops.map(pop => layoutSize(pop, 'height'));
    root.dataset.panelLayout = 'matched';
    for (const [index, pop] of pops.entries()) {
      pop.style.display = previous[index].display;
      pop.style.visibility = previous[index].visibility;
      if (heights.every(height => height > 0)) pop.style.height = Math.max(...heights) + 'px';
    }
    if (heights.every(height => height > 0)) root._heightKey = key;
  };
  root._adjustLayout();

  return 'ok:' + modelText;
}

function toView(d) {
  const ctx = contextBreakdown(d);
  const cache = cacheView(d, d.prefs);
  const { iconSvg: cacheIconSvg, valColor: cacheValColor, valDeco: cacheValDeco, valOp: cacheValOp, text: valCacheHit, countdown: valCacheHitK, ctxIconColor, indicator: cacheIndicator, progressPct: cacheProgressPct, progressColor: cacheProgressColor } = cache;

  const quotaGroups = quotaView(d.quotaGroups, d.prefs);
  const quotaSummaryGroups = quotaGroups.map(({ title, rawName, modelsInGroup, q5h, qWk }) => ({ title, rawName, modelsInGroup, q5h, qWk }));
  const useBar = appearance(d.prefs).quotaIndicator === 'bar';
  let quotaHtml = '<div class="dk-panel-content">';
  for (const g of quotaGroups) {
    quotaHtml += '<div class="dk-q-group" data-pool="' + escapeHtml(g.rawName) + '">';
    quotaHtml += '<div class="dk-q-title">' + escapeHtml(g.title) + '<span class="dk-q-active" style="color:' + g.activeColor + '" aria-hidden="true"></span></div>';
    for (const b of g.buckets) {
      quotaHtml += '<div class="dk-q-row" data-quota-tooltip="' + escapeHtml(JSON.stringify(b.tooltip)) + '">';
      const indicator = useBar
        ? '<span class="dk-q-meter"><span style="width:' + b.barWidth + '%;background:' + b.color + '"></span></span>'
        : makeRingSvg(b.remainingFraction);
      quotaHtml += '  <span class="dk-q-label"' + (b.labelKey ? ' data-i18n="' + b.labelKey + '"' : '') + '>' + escapeHtml(b.label) + '</span>';
      quotaHtml += '  <span class="dk-q-right"><span class="dk-q-pct notranslate" translate="no">' + b.pctLeft + '%</span>' + indicator + '</span>';
      quotaHtml += '  <span class="dk-q-mid notranslate" translate="no">' + escapeHtml(b.resetShort) + '</span>';
      quotaHtml += '</div>';
    }
    quotaHtml += '</div>';
  }

  quotaHtml += '</div>';
  return {
    prefs: d.prefs || { language: 'en' },
    generation: d.generation || null,
    turnSpeed: d.turnSpeed || null,
    turnQueue: d.turnQueue || null,
    turnMetrics: d.turnMetrics || null,
    requestError: d.requestError || { kind: 'none' },
    cloudPaygo: d.cloudPaygo === true,
    cache: { contextTokens: ctx.ctx, cachedIn: ctx.cached, lastStepEpochMs: d.lastStepEpochMs || 0 },
    contextData: { contextTokens: ctx.ctx, maxContextTokens: ctx.maxCtx, cachedIn: ctx.cached, uncachedIn: d.uncachedIn, turn0Tokens: ctx.turn0, totalOutputTokens: ctx.out, totalThinkingTokens: ctx.think },
    pillCtx: ctx.usedPct,
    ctxIconColor,
    usedPctText: ctx.usedPct + ' used',
    usedFrac: ctx.usedFrac,
    segReadW: ctx.segReadW,
    segOutW: ctx.segOutW,
    segThinkW: ctx.segThinkW,
    segTurn0W: ctx.segTurn0W,
    cacheIndicator,
    cacheProgressPct,
    cacheProgressColor,
    cacheIconSvg,
    cacheValColor,
    cacheValDeco,
    cacheValOp,
    valCacheHit,
    valCacheHitK,
    valTurn0Pct: ctx.turn0Pct,
    valTurn0K: ctx.turn0K,
    valReadPct: ctx.readPct,
    valReadK: ctx.readK,
    valThinkPct: ctx.thinkPct,
    valThinkK: ctx.thinkK,
    valOutPct: ctx.outPct,
    valOutK: ctx.outK,
    valRead: ctx.readPct + ' · ' + ctx.readK,
    valOut: ctx.outPct + ' · ' + ctx.outK,
    valThink: ctx.thinkPct + ' · ' + ctx.thinkK,
    valTurn0: ctx.turn0Pct + ' · ' + ctx.turn0K,
    quotaSummaryGroups,
    quotaHtml,
    instanceTs: INSTANCE_TS,
  };
}

// Installed once in each renderer. Clocks/layout keep updating without a CDP
// payload, and navigation clears old data before the next server snapshot.
function installRuntime(owner, hash) {
  const previous = globalThis.__agyCapsuleDeck;
  if (previous?.owner > owner) return 'superseded';
  previous?.dispose();
  window.__deckOwnerTs = owner;
  let data = null;
  let dataPath = '';
  let disposed = false;
  const run = () => {
    if (disposed || !data) return;
    if (globalThis.__agyCapsuleDeck !== api) return;
    if (location.pathname !== dataPath) {
      window.__agyCapsuleCleanup?.();
      return;
    }
    // Installed runtimes own the page; one-off legacy mounts must not strand
    // this runtime behind a newer timestamp while leaving two visible strips.
    window.__deckOwnerTs = owner;
    pageMount(toView(data));
  };
  const timer = setInterval(run, 1000);
  const api = {
    owner, hash,
    readState(caller) {
      if (caller < owner) return 'superseded';
      return { owner, hash, path: location.pathname, hasFooter: !!findFooterLeft() };
    },
    apply(next, path, caller) {
      if (caller < owner) return 'superseded';
      if (caller !== owner || disposed || path !== location.pathname) return false;
      data = next;
      dataPath = path;
      run();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      if (globalThis.__agyCapsuleDeck === api) {
        window.__agyCapsuleCleanup?.();
        delete globalThis.__agyCapsuleDeck;
      }
    },
  };
  globalThis.__agyCapsuleDeck = api;
  return true;
}

export function buildRuntimeBundle(owner = INSTANCE_TS) {
  const functions = [toView, findFooterLeft, layoutSize, pageMount, installRuntime].map(fn => fn.toString()).join('\n');
  const source = getPresentationScript() + '\n' + functions;
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const code = `(()=>{const INSTANCE_TS=${Number(owner)};if(globalThis.__agyCapsuleDeck?.owner>INSTANCE_TS)return 'superseded';${getPresentationScript()}\nconst {escapeHtml,appearance,cacheView,contextBreakdown,quotaView,makeRingSvg}=globalThis.__agyCapsulePresentation;\n${functions}\nreturn installRuntime(INSTANCE_TS,${JSON.stringify(hash)});})()`;
  return { code, hash };
}

export { pageMount, toView, layoutSize };

// The host publishes its HTTP (language server) and HTTPS (composer) ports
// together. Match the current session, not the newest record on disk.
export function createComposerOriginResolver(productRoots = [], env = process.env, now = Date.now) {
  let session;
  return async function composerOrigin() {
    const address = env.ANTIGRAVITY_LS_ADDRESS, token = env.ANTIGRAVITY_CSRF_TOKEN;
    const match = /^(127\.0\.0\.1|localhost):([1-9]\d{0,4})$/.exec(address || '');
    if (!match || +match[2] > 65535 || !token) { session = null; return null; }
    for (const root of productRoots) {
      let hub;
      try { hub = JSON.parse(readFileSync(join(root, 'daemon', 'hub_' + match[2] + '.json'), 'utf8')); }
      catch { continue; }
      if (hub?.httpPort !== +match[2] || !Number.isInteger(hub.httpsPort) || hub.httpsPort < 1 || hub.httpsPort > 65535) continue;
      const origin = new URL('https://127.0.0.1:' + hub.httpsPort).origin;
      if (!session || session.address !== address || session.token !== token || session.origin !== origin || session.pid !== hub.pid) {
        session = { address, token, origin, pid: hub.pid, verified: false, retryAt: 0, delay: 4000 };
      }
      if (session.verified) return origin;
      if (now() < session.retryAt) return null;
      // The hub and the sidecar use distinct credentials. Ask the LS itself;
      // never send the sidecar credential to a redirected or non-loopback URL.
      try {
        const res = await fetch('http://' + match[1] + ':' + match[2] + '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': token },
          body: '{}', redirect: 'error', signal: AbortSignal.timeout(3000),
        });
        await res.body?.cancel();
        if (res.ok) { session.verified = true; return origin; }
      } catch { /* A starting or unavailable LS is not proof of identity. */ }
      session.retryAt = now() + session.delay;
      session.delay = Math.min(60_000, session.delay * 2);
      return null;
    }
    session = null;
    return null;
  };
}

export function startDeckInjector(inspect, options = {}) {
  const owner = options.instanceTs ?? INSTANCE_TS;
  const bundle = buildRuntimeBundle(owner);
  const sockets = new Map();
  let cachedPages = [];
  let lastListAt = 0;
  let lastErr = '';
  let stopped = false;
  let busy = false;
  // 'unknown' until the first lookup; the sidebar explains 'missing' / 'unreachable'.
  let cdpState = 'unknown';
  let discovery = 'unknown', noAnchorSince = null, failedRounds = 0;
  const now = options.now || Date.now;
  const composerOrigin = createComposerOriginResolver(options.productRoots, options.env, now);
  const logOnce = message => {
    if (lastErr !== message) { lastErr = message; console.error('[deck]', message); }
  };
  const retire = (entry, id) => {
    if (entry.closed) return;
    entry.closed = true;
    for (const callback of entry.pending.values()) callback(undefined);
    entry.pending.clear();
    try { entry.ws.close(); } catch {}
    if (sockets.get(id) === entry) sockets.delete(id);
  };
  const connect = async target => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const entry = { ws, pending: new Map(), nextId: 1, lastPayload: '', lastPath: '', origin: new URL(target.url).origin };
    await new Promise((resolve, reject) => {
      const fail = message => { clearTimeout(timer); retire(entry, target.id); reject(new Error(message)); };
      const timer = setTimeout(() => fail('ws timeout'), 3000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => fail('ws error');
    });
    if (stopped) { retire(entry, target.id); throw new Error('injector stopped'); }
    ws.onmessage = event => {
      try {
        const message = JSON.parse(event.data);
        // Browser-issued, document-specific IDs cannot be reused across navigation.
        if (message.method === 'Runtime.executionContextCreated') {
          const ctx = message.params.context;
          if (ctx.auxData?.isDefault && ctx.auxData.frameId === entry.frameId) {
            entry.context = ctx.origin === entry.origin ? ctx.uniqueId : null;
            entry.lastPayload = '';
          }
        } else if (message.method === 'Runtime.executionContextsCleared' ||
                   (message.method === 'Runtime.executionContextDestroyed' && message.params.executionContextUniqueId === entry.context)) {
          entry.context = null;
        }
        const callback = entry.pending.get(message.id);
        if (callback) { entry.pending.delete(message.id); callback(message); }
      } catch {}
    };
    ws.onerror = ws.onclose = () => retire(entry, target.id);
    sockets.set(target.id, entry);
    const tree = await command(entry, 'Page.getFrameTree', {});
    entry.frameId = tree?.frameTree?.frame?.id;
    if (!entry.frameId || !await command(entry, 'Runtime.enable', {})) {
      retire(entry, target.id);
      throw new Error('could not identify composer document');
    }
    return entry;
  };
  const command = (entry, method, params) => new Promise(resolve => {
    if (entry.ws.readyState !== 1) return resolve(undefined);
    const id = entry.nextId++;
    const timer = setTimeout(() => { entry.pending.delete(id); resolve(undefined); }, 3000);
    entry.pending.set(id, message => { clearTimeout(timer); resolve(message?.result); });
    try { entry.ws.send(JSON.stringify({ id, method, params })); }
    catch { clearTimeout(timer); entry.pending.delete(id); resolve(undefined); }
  });
  const evaluate = async (entry, context, expression) => {
    if (!context || context !== entry.context) return;
    return (await command(entry, 'Runtime.evaluate', { uniqueContextId: context, expression, returnByValue: true }))?.result?.value;
  };
  const pages = async () => {
    if (lastListAt && now() - lastListAt < 4000) return cachedPages;
    let port;
    try { port = readFileSync(options.portFile || PORT_FILE, 'utf8').split(/\r?\n/)[0].trim(); }
    catch { discovery = 'missing'; logOnce('DevToolsActivePort not found'); return []; }
    try {
      if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('invalid CDP port');
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const targets = await response.json();
      const origin = await composerOrigin();
      const wsOrigin = new URL('ws://127.0.0.1:' + Number(port)).origin;
      cachedPages = targets.filter(t => {
        if (!origin || t?.type !== 'page' || typeof t.id !== 'string' || !t.id || !URL.canParse(t.url) || new URL(t.url).origin !== origin || !URL.canParse(t.webSocketDebuggerUrl)) return false;
        const ws = new URL(t.webSocketDebuggerUrl);
        return ws.origin === wsOrigin && ws.pathname === '/devtools/page/' + t.id && !ws.username && !ws.password && !ws.search && !ws.hash;
      });
      lastListAt = now();
      discovery = origin ? 'ok' : 'unverified';
      if (!origin) logOnce('composer origin not verified for this host session; footer paused');
      const ids = new Set(cachedPages.map(t => t.id));
      for (const [id, entry] of sockets) if (!ids.has(id) || entry.origin !== origin) retire(entry, id);
      return cachedPages;
    } catch (error) { discovery = 'unreachable'; logOnce('CDP list failed: ' + error.message); return []; }
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    await Promise.all([...sockets].map(async ([id, entry]) => {
      try { await evaluate(entry, entry.context, `globalThis.__agyCapsuleDeck?.owner===${owner}&&globalThis.__agyCapsuleDeck.dispose()`); }
      finally { retire(entry, id); }
    }));
  };
  const supersede = async () => {
    await stop();
    (options.onSuperseded || (() => process.exit(0)))();
  };
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const list = await pages();
      let noAnchor = 0, failed = 0;
      for (const target of list) {
        if (stopped) break;
        try {
          const entry = sockets.get(target.id) || await connect(target);
          const context = entry.context;
          const run = expression => evaluate(entry, context, expression);
          let state = await run(`globalThis.__agyCapsuleDeck?.readState(${owner})??null`);
          if (state === undefined || stopped) { failed++; continue; }
          if (state === 'superseded') return await supersede();
          if (state?.owner !== owner || state.hash !== bundle.hash) {
            const installed = await run(bundle.code);
            if (installed === 'superseded') return await supersede();
            if (!installed || stopped) { failed++; continue; }
            entry.lastPayload = '';
            state = await run(`globalThis.__agyCapsuleDeck?.readState(${owner})??null`);
          }
          if (state === 'superseded') return await supersede();
          if (state?.owner !== owner || !state.path) { failed++; continue; }
          if (state.hasFooter !== true) { noAnchor++; continue; }
          const match = state.path.match(/\/c\/([0-9a-f-]{36})/);
          // Data-source failures belong to the sidebar health path, not to CDP.
          const data = await Promise.resolve().then(() => inspect(match ? match[1] : '', true)).catch(() => null);
          if (!data || data.error || stopped) continue;
          const payload = JSON.stringify(data);
          if (entry.lastPayload !== payload || entry.lastPath !== state.path) {
            const applied = await run(`globalThis.__agyCapsuleDeck?.apply(${payload},${JSON.stringify(state.path)},${owner})??false`);
            if (applied === 'superseded') return await supersede();
            if (applied) { entry.lastPayload = payload; entry.lastPath = state.path; }
            else { entry.lastPayload = ''; failed++; }
          }
          lastErr = '';
        } catch (error) {
          if (stopped) return;
          failed++;
          const entry = sockets.get(target.id);
          if (entry) retire(entry, target.id);
          logOnce('page ' + target.id + ': ' + error.message);
        }
      }
      if (stopped) return;
      noAnchorSince = list.length && noAnchor === list.length ? (noAnchorSince ?? now()) : null;
      failedRounds = list.length && failed === list.length ? failedRounds + 1 : 0;
      cdpState = discovery !== 'ok' ? discovery : failedRounds >= 3 ? 'inject-failed'
        : noAnchorSince !== null && now() - noAnchorSince >= 60_000 ? 'no-anchor' : 'ok';
      options.onStatus?.(cdpState);
    } finally { busy = false; }
  };
  const timer = setInterval(tick, INTERVAL_MS);
  console.log('[deck] injector started, port file:', options.portFile || PORT_FILE);
  return { tick, stop, status: () => cdpState };
}
