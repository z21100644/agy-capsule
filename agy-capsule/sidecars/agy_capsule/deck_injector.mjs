// Deck injector: mounts a compact metrics strip into the Antigravity composer
// footer (next to the model selector) via the local DevTools (CDP) endpoint.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { readPickerState, resolveInheritedLabel, syncModelPicker } from './model_picker.mjs';
import { createMotionThemes, motionThemes } from './motion_themes.mjs';
import { EFFORT_BAR_CSS, effortEffects, mountEffortBar, mountOrchestratorSwitch } from './effort_bar.mjs';
import { createUpstreamEffort } from './effort_upstream.mjs';
import { readCloudTrajectory } from './cloud_telemetry.mjs';
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

// Side panels reuse the native footer. Select the owning view, never the
// widest composer; geometry only tells us whether a candidate is on screen.
function findFooterLeft() {
  let main = null, newComposer = null;
  const nonMain = '[data-side-panel-composer], [data-testid="side-question-tab-content"], [data-testid="subagent-tab-composer"], [data-testid="voice-dock-composer"]';
  for (const el of document.querySelectorAll('.agy-composer-footer > div:first-child')) {
    if (el.closest(nonMain)) continue;
    const view = el.closest('[data-testid="conversation-view"]');
    // New-conversation surfaces have the host's input and media scope, but
    // no conversation-view until the conversation starts.
    if (!view && !el.closest('[data-testid="agent-input-box"]')?.closest('[data-media-drop-scope]')) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (Math.min(r.bottom, innerHeight) <= Math.max(r.top, 0) ||
        Math.min(r.right, innerWidth) <= Math.max(r.left, 0)) continue;
    if (view) {
      const pane = view.closest('[data-pane-id]');
      if (pane && !pane.hasAttribute('data-pane-unfocused')) return el;
      main ??= el;
    } else {
      newComposer ??= el;
    }
  }
  return main ?? newComposer;
}

// A transform shrinks the box getBoundingClientRect reports, not the room an element needs.
function layoutSize(el, side) {
  return parseFloat(getComputedStyle(el)[side]) || el.getBoundingClientRect()[side];
}

function conversationIdOf(el) {
  const id = el?.getAttribute('data-cascade-id');
  return /^[0-9a-f-]{36}$/i.test(id || '') ? id : '';
}

// The host's conversation provider receives contextWindowUsage independently of
// model usage. Look up only the visible composer's conversation on its Fiber path.
export function readCompactionEstimate(footer, conversationId) {
  const key = Object.keys(footer).find(key => key.startsWith('__reactFiber$'));
  for (let fiber = key && footer[key], depth = 0; fiber && depth < 100; fiber = fiber.return, depth++) {
    const contexts = [fiber.memoizedProps?.value];
    for (let dep = fiber.dependencies?.firstContext; dep; dep = dep.next) contexts.push(dep.memoizedValue);
    for (const value of contexts) {
      const state = value?.getAgentStates?.()?.get?.(conversationId)?.provider?.getState?.();
      if (state?.conversationId !== conversationId) continue;
      const usage = state.contextWindowUsage;
      if (usage?.estimatedAfterCompaction !== true) return null;
      const { estimatedTokensUsed: tokens, maxContextTokens: limit, generatorMetadataIndex } = usage;
      if (Number.isSafeInteger(tokens) && tokens > 0 && Number.isSafeInteger(limit) && limit > 0
        && Number.isSafeInteger(generatorMetadataIndex) && generatorMetadataIndex >= 0) {
        return { tokens, limit, generatorMetadataIndex };
      }
      return null;
    }
  }
  return null;
}

// The child transcript and the child composer share a wrapper. The composer
// wrapper survives even when the host omits the input or native model button.
function findSubagentAnchors(footer) {
  const anchors = new Map();
  const visible = el => {
    if (!el?.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return Math.min(r.right, innerWidth) > Math.max(r.left, 0) && Math.min(r.bottom, innerHeight) > Math.max(r.top, 0);
  };
  const add = (el, id) => { if (id && visible(el)) anchors.set(el, id); };
  for (const transcript of document.querySelectorAll('[data-testid="subagent-tab-conversation"][data-cascade-id]')) {
    const composer = transcript.nextElementSibling;
    const id = conversationIdOf(transcript);
    if (id && composer?.matches('[data-testid="subagent-tab-composer"]') && visible(transcript)) {
      // The wrapper can have zero height before we add the strip.
      if (composer.checkVisibility({ opacityProperty: true, visibilityProperty: true })) anchors.set(composer, id);
    }
  }
  for (const el of document.querySelectorAll('[data-testid="conversation-view"][data-cascade-id]')) {
    if (!el.contains(footer)) add(el, conversationIdOf(el));
  }
  return anchors;
}

function pageMount(d, childAnchor = null) {
  if (window.__deckOwnerTs && d.instanceTs && d.instanceTs < window.__deckOwnerTs) {
    return 'superseded';
  }
  if (d.instanceTs) {
    window.__deckOwnerTs = d.instanceTs;
  }
  const footerLeft = childAnchor || findFooterLeft();
  if (!footerLeft) {
    window.__agyCapsuleCleanup?.();
    return 'no-footer';
  }
  const childSidebar = childAnchor?.matches('[data-testid="subagent-tab-composer"]');
  const presentation = globalThis.__agyCapsulePresentation;

  const clearFooterLayout = (node) => {
    node._turboTarget?.removeAttribute('data-deck-turbo-collapsed');
    const footer = childAnchor ? null : node._observedFooterLeft || node.closest('.agy-composer-footer > div:first-child');
    if (!footer) return;
    const classes = ['dk-fl-squeezed', 'dk-model-squeezed', 'dk-model-squeezed-hard', 'dk-squeeze-box', 'dk-squeeze-item'];
    for (const element of [footer, ...footer.querySelectorAll(classes.map(c => '.' + c).join(','))]) element.classList.remove(...classes);
  };
  const release = (node) => {
    if (!node) return;
    document.removeEventListener('click', node._onOutsideClick);
    document.removeEventListener('keydown', node._onEscape);
    if (node._onResize) window.removeEventListener('resize', node._onResize);
    node._modelPicker?.dispose();
    node._modelObserver?.disconnect();
    node._resizeObserver?.disconnect();
    if (node._layoutRaf) cancelAnimationFrame(node._layoutRaf);
    node._layoutRaf = 0;
    clearFooterLayout(node);
  };
  // A late legacy injector may recreate its light-DOM strip after migration.
  // Remove it on every pass, not only when initializing the shadow host.
  const legacy = document.getElementById('deck-metrics-strip');
  if (legacy && !childAnchor) { release(legacy); legacy.remove(); }
  let host = childAnchor
    ? childAnchor.querySelector(':scope > [data-agy-capsule-subagent]')
    : document.getElementById('agy-capsule-host');
  let root = host?.shadowRoot?.getElementById('deck-metrics-strip');
  if (!root) {
    if (!childAnchor) window.__agyCapsuleCleanup?.();
    host?.remove();
    host = document.createElement('div');
    if (childAnchor) {
      host.setAttribute('data-agy-capsule-subagent', '');
      host.style.cssText = 'display:block;align-self:center;width:100%;max-width:100%;box-sizing:border-box;flex:none;position:sticky;bottom:0;z-index:2';
    } else {
      host.id = 'agy-capsule-host';
      host.style.display = 'contents';
    }
    const shadow = host.attachShadow({ mode: 'open' });
    root = document.createElement('div');
    root.id = 'deck-metrics-strip';
    shadow.appendChild(root);
  }
  // The capsule localizes this shadow tree itself, independently of the host.
  if (host.getAttribute('translate') !== 'no') host.setAttribute('translate', 'no');

  // Upgrade or initialize DOM structure in-place
  if (root.getAttribute('data-deck-ver') !== '140') {
    release(root);
    root._pinnedGroup = null;
    root.removeAttribute('data-pinned');
    root.setAttribute('data-deck-ver', '140');
    root._speedActivity = null;
    root._motionPrev = null;
    root._renderKey = null;
    root._cacheIconSvg = null;
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
        #deck-metrics-strip button.dk-pill[data-el="modelPicker"],
        .dk-model-options,
        .dk-model-sub,
        .dk-model-tiers,
        .dk-model-tip {
          font-family: "Google Sans Flex", "Google Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 12px; font-weight: 350; line-height: 16px;
          font-variation-settings: "ROND" 0, "slnt" 0, "wdth" 92;
          -webkit-font-smoothing: auto;
        }
        #deck-metrics-strip button.dk-pill[data-el="modelPicker"] {
          display: inline-flex; align-items: center; gap: 4px;
          height: 28px; max-width: 18em; padding: 0 4px 0 8px; margin-right: 6px; border-radius: 9999px;
          cursor: pointer; white-space: nowrap;
          color: var(--secondary-foreground, var(--foreground, inherit));
        }
        #deck-metrics-strip button.dk-pill[data-el="modelPicker"] .dk-mp-text {
          min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        #deck-metrics-strip button.dk-pill[data-el="modelPicker"] .dk-mp-name { color: inherit; }
        #deck-metrics-strip button.dk-pill[data-el="modelPicker"] .dk-mp-effort { color: inherit; opacity: 0.7; font-weight: 350; }
        #deck-metrics-strip button.dk-pill[data-el="modelPicker"] .dk-mp-down { width: 14px; height: 14px; flex-shrink: 0; display: block; }
        #deck-metrics-strip button.dk-pill[data-el="modelPicker"]:hover,
        #deck-metrics-strip button.dk-pill[data-el="modelPicker"]:focus-visible {
          background: var(--secondary, rgba(128, 128, 128, 0.12));
          color: var(--secondary-foreground, var(--foreground, #0a0a0c));
          outline: none;
        }
        .dk-model-options,
        .dk-model-sub,
        .dk-model-tiers,
        .dk-model-tip {
          position: fixed; inset: auto; margin: 0; padding: 4px;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--foreground, #fff) 9%, transparent);
          background: var(--card, rgb(19, 19, 23));
          backdrop-filter: blur(22px);
          box-shadow: 0 1px 0 color-mix(in srgb, var(--foreground, #fff) 8%, transparent) inset, 0 20px 44px -12px rgba(0, 0, 0, 0.38), 0 3px 10px -2px rgba(0, 0, 0, 0.28);
          color: var(--foreground, CanvasText);
        }
        .dk-model-options {
          min-width: 148px; width: max-content; max-width: min(320px, calc(100vw - 12px));
          overflow-y: auto; overflow-x: hidden; scrollbar-width: none;
        }
        .dk-model-options::-webkit-scrollbar { display: none; }
        .dk-model-options:has(> .agy-effort) { min-width: min(212px, calc(100vw - 12px)); }
        .dk-model-options > :is(.agy-effort, .dk-orch-slot) { contain: inline-size; }
        .dk-model-options > .agy-effort { margin: 5px 0 1px; }
        ${EFFORT_BAR_CSS}
        .dk-model-list { display: flex; flex-direction: column; gap: 1px; }
        .dk-model-row,
        .dk-model-sub-item {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 6px;
          padding: 4px 8px; min-height: 24px; border: 0; border-radius: 7px;
          background: transparent; color: var(--secondary-foreground, var(--foreground, CanvasText));
          font: inherit; text-align: left; cursor: pointer; outline: none;
          transition: background 0.1s ease, color 0.1s ease;
        }
        .dk-model-row.dk-model-disabled {
          opacity: 0.5; cursor: not-allowed;
        }
        .dk-model-sub-item { font-size: 13px; line-height: 18.57px; }
        .dk-model-row:not(.dk-model-disabled):hover:not(:disabled),
        .dk-model-row:not(.dk-model-disabled):focus-visible:not(:disabled),
        .dk-model-row[data-sub-open="true"],
        .dk-model-sub-item[data-sub-open="true"],
        .dk-model-sub-item:hover:not(:disabled),
        .dk-model-sub-item:focus-visible:not(:disabled) {
          background: var(--secondary, rgba(128, 128, 128, 0.14));
          color: var(--foreground, CanvasText);
        }
        .dk-model-row[aria-pressed="true"],
        .dk-model-sub-item[aria-pressed="true"] {
          color: var(--foreground, CanvasText);
        }
        .dk-model-options[data-effort-mode="true"] .dk-model-row[aria-pressed="true"] {
          background: var(--secondary, rgba(128, 128, 145, 0.14));
        }
        .dk-model-row:disabled,
        .dk-model-sub-item:disabled { opacity: 0.55; cursor: progress; }
        .dk-model-main { display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
        .dk-mp-dot { width: 5.5px; height: 5.5px; border-radius: 50%; flex-shrink: 0; opacity: 0.72; transition: opacity 0.12s ease, transform 0.12s ease; }
        .dk-model-row:hover .dk-mp-dot,
        .dk-model-row[aria-pressed="true"] .dk-mp-dot { opacity: 1; transform: scale(1.18); }
        .dk-model-main .dk-mp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dk-model-main .dk-mp-effort { flex-shrink: 0; color: inherit; opacity: 0.7; font-weight: 350; }
        .dk-mp-tier { display: inline-grid; white-space: nowrap; }
        .dk-mp-tier > span { grid-area: 1 / 1; }
        .dk-mp-tier > [data-size-tier] { visibility: hidden; }
        .dk-mp-tier > [data-size-tier]::before { content: attr(data-size-tier); }
        .dk-model-options[data-effort-mode="true"] [data-size-tier] { font-weight: 600; }
        .dk-model-main .dk-mp-orchestrator { flex-shrink: 0; }
        .dk-model-main .dk-mp-planner { flex-shrink: 1; min-width: 0; }
        .dk-mp-badge {
          display: inline-flex; align-items: center; gap: 4px;
          flex-shrink: 0; padding: 0 6px; border-radius: 999px;
          background: var(--secondary, rgba(128, 128, 128, 0.16));
          color: inherit; opacity: 0.7; font-size: 12px; font-weight: 350; line-height: 16px;
        }
        .dk-mp-info { display: inline-flex; align-items: center; flex-shrink: 0; color: inherit; opacity: 0.75; }
        .dk-mp-badge .dk-mp-info { opacity: 1; }
        .dk-mp-info:hover { opacity: 1; }
        .dk-mp-info-svg { width: 12px; height: 12px; display: block; }
        .dk-mp-end { display: inline-flex; align-items: center; flex-shrink: 0; color: var(--muted-foreground, #8e8e93); }
        .dk-model-row > .dk-mp-end { width: 14px; }
        .dk-model-row[aria-pressed="true"] .dk-mp-end,
        .dk-model-sub-item[aria-pressed="true"] .dk-mp-end { color: var(--foreground, CanvasText); }
        .dk-mp-check { width: 14px; height: 14px; display: block; }
        .dk-mp-chev { width: 14px; height: 14px; display: block; opacity: 0.7; }
        .dk-model-sub, .dk-model-tiers {
          min-width: min(160px, calc(100vw - 12px)); flex-direction: column; gap: 1px;
          max-width: calc(100vw - 12px);
        }
        .dk-model-sub:has([data-planner]) { min-width: min(205px, calc(100vw - 12px)); }
        .dk-model-sub:popover-open, .dk-model-tiers:popover-open { display: flex; }
        .dk-model-tip {
          max-width: 220px; padding: 6px 10px; border-radius: 10px;
          color: var(--secondary-foreground, var(--foreground, CanvasText));
          pointer-events: none; white-space: normal; overflow-wrap: break-word;
        }
        .dk-model-options [role="status"] { padding: 6px 8px 2px; color: #e06c75; font-size: 12px; }
        .dk-model-options [role="status"]:empty { display: none; }
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
        #deck-metrics-strip[data-child-turn-only] .dk-ctx-pop :is(.dk-cache-bar, .dk-summary-row, .dk-track, .dk-list, [data-generation-block]) { display: none; }
        #deck-metrics-strip [data-el="childModel"] { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #deck-metrics-strip [data-el="childModel"][hidden] { display: none; }
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
        #deck-metrics-strip > .dk-speed { flex: none; padding: 3px 5px; white-space: nowrap; }
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
        /* Frosted skin: only the panel material changes. The surface is the host's own --card, made
           translucent over a blurred backdrop, so it follows light and dark themes by itself. The
           highlight and the shadow are plain white and black at low alpha and need no theme at all. */
        #deck-metrics-strip[data-ui-skin="frosted"] .dk-pop {
          background: linear-gradient(rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0) 55%), color-mix(in srgb, var(--card, rgba(20, 20, 22, 0.97)) 80%, transparent);
          backdrop-filter: blur(22px) saturate(150%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 10px 28px -10px rgba(0, 0, 0, 0.3), 0 2px 6px rgba(0, 0, 0, 0.08);
        }
        #deck-metrics-strip .dk-grp:hover .dk-pop {
          display: block;
        }
        #deck-metrics-strip .dk-grp[data-pinned="true"] .dk-pop { display: block; pointer-events: auto; }
        #deck-metrics-strip[data-pinned] .dk-grp:not([data-pinned="true"]):hover .dk-pop { display: none; }
        #deck-metrics-strip .dk-grp[data-dismissed="true"] .dk-pop { display: none; }
        /* Optional pop-in, declared only where motion is welcome: reduced motion keeps panels instant. */
        @keyframes dk-pop-in { from { opacity: 0; transform: translateY(3px) scale(.985); } }
        @media (prefers-reduced-motion: no-preference) {
          #deck-metrics-strip[data-pop-animation="true"] .dk-pop { transform-origin: 50% 100%; animation: dk-pop-in .13s cubic-bezier(.22, 1, .36, 1); }
        }
        #deck-metrics-strip .dk-grp .dk-pop[popover] { position: fixed; inset: auto; margin: 0; }
        #deck-metrics-strip .dk-grp .dk-pop[popover]:not(:popover-open) { display: none; }
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
        /* Optional hit-rate ring: next to the number, or in its place. */
        #deck-metrics-strip .dk-cache-hit { display: inline-flex; align-items: center; }
        #deck-metrics-strip .dk-cache-hit:empty,
        #deck-metrics-strip[data-cache-hit-format="ring"] .dk-cache-pct { display: none; }
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
        #deck-metrics-strip[data-show-quota-dividers="true"] .dk-q-group + .dk-q-group { margin-top: var(--agy-section-gap); padding-top: var(--agy-section-gap); border-top: 1px solid var(--border, rgba(142, 142, 147, 0.24)); }
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
        #deck-metrics-strip[data-label-case="lowercase"] .tb-single-label,
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
        #deck-metrics-strip[data-context-estimated] :is(.dk-cache-bar, .dk-list) { display: none; }
        #deck-metrics-strip .dk-item-label { order: var(--agy-order-label, 0); }
        #deck-metrics-strip .dk-item-k { order: var(--agy-order-value, 1); }
        #deck-metrics-strip .dk-item-pct { order: var(--agy-order-percent, 2); }
        /* Optional hover link between the progress bar and the breakdown: pointing at either end of a
           pair keeps that pair lit and dims the rest. CSS only, so nothing runs while it is off. */
        #deck-metrics-strip[data-highlight-context-hover="true"] .dk-ctx-pop:has([data-cat="turn0"]:hover) [data-cat]:not([data-cat="turn0"]),
        #deck-metrics-strip[data-highlight-context-hover="true"] .dk-ctx-pop:has([data-cat="read"]:hover) [data-cat]:not([data-cat="read"]),
        #deck-metrics-strip[data-highlight-context-hover="true"] .dk-ctx-pop:has([data-cat="think"]:hover) [data-cat]:not([data-cat="think"]),
        #deck-metrics-strip[data-highlight-context-hover="true"] .dk-ctx-pop:has([data-cat="write"]:hover) [data-cat]:not([data-cat="write"]) { opacity: .35; }
        #deck-metrics-strip[data-highlight-context-hover="true"] .dk-ctx-pop:has([data-cat="turn0"]:hover) [data-cat="turn0"] .dk-item-label,
        #deck-metrics-strip[data-highlight-context-hover="true"] .dk-ctx-pop:has([data-cat="read"]:hover) [data-cat="read"] .dk-item-label,
        #deck-metrics-strip[data-highlight-context-hover="true"] .dk-ctx-pop:has([data-cat="think"]:hover) [data-cat="think"] .dk-item-label,
        #deck-metrics-strip[data-highlight-context-hover="true"] .dk-ctx-pop:has([data-cat="write"]:hover) [data-cat="write"] .dk-item-label { color: var(--foreground, #18181b); }
        @media (prefers-reduced-motion: no-preference) {
          #deck-metrics-strip[data-highlight-context-hover="true"] .dk-seg { transition: width 0.25s ease, opacity .18s ease; }
          #deck-metrics-strip[data-highlight-context-hover="true"] .dk-item-row { transition: opacity .18s ease; }
        }
        /* Optional compact status bar: the cache and the last request as one row along the panel's
           lower edge. It takes the place of those two rows only; the rest of the panel is unchanged. */
        #deck-metrics-strip .dk-telemetry-dock { display: none; }
        #deck-metrics-strip[data-compact-telemetry-bar="true"] .dk-ctx-pop { overflow: hidden; }
        #deck-metrics-strip[data-compact-telemetry-bar="true"] .dk-cache-bar,
        #deck-metrics-strip[data-compact-telemetry-bar="true"] [data-generation-block] { display: none; }
        #deck-metrics-strip[data-compact-telemetry-bar="true"] [data-generation-block] + [data-turn-metrics-block] { border-top: 1px solid var(--border, rgba(142, 142, 147, 0.24)); padding-top: var(--agy-section-gap); }
        #deck-metrics-strip[data-compact-telemetry-bar="true"] .dk-telemetry-dock {
          display: block;
          margin: var(--agy-section-gap, 6px) calc(var(--agy-pad-x, 12px) * -1) calc(var(--agy-pad-y, 10px) * -1);
          border-top: 1px solid color-mix(in srgb, var(--border, rgba(142, 142, 147, 0.24)) 64%, transparent);
          background: color-mix(in srgb, var(--foreground, #18181b) 3%, transparent);
          font-variant-numeric: tabular-nums;
        }
        #deck-metrics-strip .dk-telemetry-dock[data-mode="cache-only"] .tb-trio,
        #deck-metrics-strip .dk-telemetry-dock[data-mode="trio"] .tb-single { display: none; }
        #deck-metrics-strip .dk-telemetry-dock .tb-trio { display: grid; grid-template-columns: minmax(0, 0.84fr) minmax(0, 0.82fr) minmax(0, 1.44fr); }
        #deck-metrics-strip .dk-telemetry-dock .tb-cell { position: relative; display: flex; align-items: center; justify-content: center; gap: 4.5px; padding: 6px 4px; min-width: 0; white-space: nowrap; }
        #deck-metrics-strip .dk-telemetry-dock .tb-cell:hover { background-color: color-mix(in srgb, var(--foreground, #18181b) 4.5%, transparent); }
        #deck-metrics-strip .dk-telemetry-dock .tb-cell + .tb-cell::before { content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 1px; height: 12px; border-radius: 1px; background: color-mix(in srgb, var(--border, rgba(142, 142, 147, 0.24)) 70%, transparent); }
        #deck-metrics-strip .dk-telemetry-dock .tb-single { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px var(--agy-pad-x, 12px); }
        #deck-metrics-strip .dk-telemetry-dock .tb-single-left { display: inline-flex; align-items: center; gap: 5px; min-width: 0; white-space: nowrap; }
        #deck-metrics-strip .dk-telemetry-dock .tb-single-right { display: inline-flex; align-items: baseline; gap: 7px; flex-shrink: 0; white-space: nowrap; }
        #deck-metrics-strip .dk-telemetry-dock .tb-icon { display: inline-flex; align-items: center; flex-shrink: 0; }
        #deck-metrics-strip .dk-telemetry-dock .tb-svg { opacity: .7; }
        #deck-metrics-strip .dk-telemetry-dock .tb-val { font-weight: 500; color: var(--foreground, #18181b); color: color-mix(in srgb, var(--foreground, #18181b) 88%, transparent); }
        #deck-metrics-strip .dk-telemetry-dock .tb-ttft .tb-val,
        #deck-metrics-strip .dk-telemetry-dock .tb-unit { font-weight: 400; color: var(--muted-foreground, #8e8e93); }
        /* The cache state tints the cache's end of the bar and colors its value. */
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="fresh"] .tb-cache { background-image: linear-gradient(90deg, color-mix(in srgb, #4ea84e 9%, transparent), transparent); }
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="warning"] .tb-cache { background-image: linear-gradient(90deg, color-mix(in srgb, #d4940a 11%, transparent), transparent); }
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="cold"] .tb-cache { background-image: linear-gradient(90deg, color-mix(in srgb, #e06c75 10%, transparent), transparent); }
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="fresh"] .tb-single { background-image: linear-gradient(90deg, color-mix(in srgb, #4ea84e 8%, transparent), transparent 42%); }
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="warning"] .tb-single { background-image: linear-gradient(90deg, color-mix(in srgb, #d4940a 9%, transparent), transparent 42%); }
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="cold"] .tb-single { background-image: linear-gradient(90deg, color-mix(in srgb, #e06c75 9%, transparent), transparent 42%); }
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="warning"] .tb-cache .tb-val,
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="warning"] .tb-single .tb-val,
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="warning"] .tb-single-sub { color: #d4940a; }
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="cold"] .tb-cache .tb-val,
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="cold"] .tb-single .tb-val { opacity: .46; }
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="cold"] .tb-single-sub { color: #e06c75; }
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="idle"] .tb-cache .tb-val,
        #deck-metrics-strip .dk-telemetry-dock[data-cache-status="idle"] .tb-single .tb-val { font-weight: 400; color: var(--muted-foreground, #8e8e93); }
        /* The bolt takes the speed's color, by the capsule's own thresholds. */
        #deck-metrics-strip .dk-telemetry-dock .tb-speed[data-speed-tier="green"] .tb-svg { color: light-dark(#16a34a, #4ea84e); opacity: .9; }
        #deck-metrics-strip .dk-telemetry-dock .tb-speed[data-speed-tier="yellow"] .tb-svg { color: light-dark(#d97706, #d4940a); opacity: .9; }
        #deck-metrics-strip .dk-telemetry-dock .tb-speed[data-speed-tier="red"] .tb-svg { color: light-dark(#dc2626, #e06c75); opacity: .9; }
        /* The bar can sit at the top of the panel instead: a flat row over a hairline, like the Cache
           row it stands in for, without the dock's tint and hover. */
        #deck-metrics-strip[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .dk-ctx-pop > .dk-panel-content { display: flex; flex-direction: column; }
        #deck-metrics-strip[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .dk-telemetry-dock {
          order: -1;
          margin: 0 0 var(--agy-section-gap, 6px);
          padding-bottom: var(--agy-section-gap, 6px);
          border-top: 0;
          border-bottom: 1px solid color-mix(in srgb, var(--border, rgba(142, 142, 147, 0.24)) 64%, transparent);
          background: none;
        }
        #deck-metrics-strip[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .dk-telemetry-dock .tb-cell { padding: 0 3px; background: none; }
        #deck-metrics-strip[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .dk-telemetry-dock .tb-cell:first-child { justify-content: flex-start; padding-left: 0; }
        #deck-metrics-strip[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .dk-telemetry-dock .tb-cell:last-child { justify-content: flex-end; padding-right: 0; }
        #deck-metrics-strip[data-compact-telemetry-bar="true"][data-telemetry-bar-position="top"] .dk-telemetry-dock .tb-single { padding: 0; background: none; }
        @media (prefers-reduced-motion: no-preference) {
          #deck-metrics-strip .dk-telemetry-dock .tb-cell { transition: background-color .14s ease; }
        }
      </style>

      ${childAnchor ? '<span class="dk-pill" data-el="childModel" hidden></span>' : ''}
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
            <div class="dk-cache-left"><span data-i18n="cache">Cache</span><span class="dk-cache-pct" data-k="valCacheHit" data-el="valCacheHitEl">0%</span><span class="dk-cache-hit" data-el="cacheHitRing"></span><span class="dk-dot" data-el="dotCached" style="display:inline-flex;align-items:center;justify-content:center;background:transparent"></span></div>
            <span class="dk-cache-meter" data-el="cacheMeter" hidden><span data-el="cacheMeterFill"></span></span>
            <div class="dk-cache-k" data-k="valCacheHitK"></div>
          </div>
          <div class="dk-summary-row">
            <div class="dk-used-pct" data-context-tip="overview"><span data-k="usedPctText">0%</span> <span data-i18n="used">used</span></div>
            <div class="dk-used-frac" data-k="usedFrac" data-context-tip="overview">0 / --</div>
          </div>
          <div class="dk-track" data-context-tip="overview">
            <div class="dk-seg" data-el="segTurn0" data-cat="turn0" style="width: 0%; background: #d4940a"></div>
            <div class="dk-seg" data-el="segRead" data-cat="read" style="width: 0%; background: #388bfd"></div>
            <div class="dk-seg" data-el="segThink" data-cat="think" style="width: 0%; background: #00b386"></div>
            <div class="dk-seg" data-el="segOut" data-cat="write" style="width: 0%; background: #e86a24"></div>
            <div class="dk-seg" data-el="segEstimate" style="width: 0%; background: #8b949e"></div>
          </div>
          <div class="dk-list">
            <div class="dk-item-row" data-cat="turn0" data-context-tip="turn0">
              <span class="dk-dot" style="background:#d4940a"></span>
              <div class="dk-item-body"><span class="dk-item-label" data-i18n="turn0">Turn0</span><span class="dk-item-k" data-k="valTurn0K">0</span><span class="dk-item-pct" data-k="valTurn0Pct">0%</span></div>
            </div>
            <div class="dk-item-row" data-cat="read" data-context-tip="read">
              <span class="dk-dot" style="background:#388bfd"></span>
              <div class="dk-item-body"><span class="dk-item-label" data-i18n="read">Read</span><span class="dk-item-k" data-k="valReadK">0</span><span class="dk-item-pct" data-k="valReadPct">0%</span></div>
            </div>
            <div class="dk-item-row" data-cat="think" data-context-tip="think">
              <span class="dk-dot" style="background:#00b386"></span>
              <div class="dk-item-body"><span class="dk-item-label" data-i18n="think">Think</span><span class="dk-item-k" data-k="valThinkK">0</span><span class="dk-item-pct" data-k="valThinkPct">0%</span></div>
            </div>
            <div class="dk-item-row" data-cat="write" data-context-tip="write">
              <span class="dk-dot" style="background:#e86a24"></span>
              <div class="dk-item-body"><span class="dk-item-label" data-i18n="write">Write</span><span class="dk-item-k" data-k="valOutK">0</span><span class="dk-item-pct" data-k="valOutPct">0%</span></div>
            </div>
          </div>
          <div class="dk-generation" data-generation-block>
            ${presentation.generationMarkup()}
          </div>
          ${presentation.turnMetricsMarkup('dk-generation')}
          ${presentation.telemetryBarMarkup('dk-telemetry-dock')}
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
    let nativeStyle = null;
    if (!childAnchor) {
    nativeStyle = document.getElementById('agy-capsule-native-layout');
    if (!nativeStyle) {
      nativeStyle = document.createElement('style');
      nativeStyle.id = 'agy-capsule-native-layout';
      document.head.appendChild(nativeStyle);
    }
    nativeStyle.textContent = `
        .agy-composer-footer button[data-deck-model-bubble="bubble"] {
          position: relative; width: 22px !important; min-width: 22px !important; max-width: 22px !important;
          overflow: hidden; padding: 0 !important; font-size: 0 !important; border-radius: 999px;
        }
        .agy-composer-footer button[data-deck-model-bubble="bubble"] > * { opacity: 0 !important; }
        .agy-composer-footer button[data-deck-model-bubble="bubble"]::after { content: '⋯'; position: absolute; inset: 0; display: grid; place-items: center; font-size: 14px; pointer-events: none; }
        .agy-composer-footer button[data-deck-model-bubble="hidden"] {
          position: absolute !important; width: 0 !important; min-width: 0 !important; max-width: 0 !important;
          height: 0 !important; overflow: hidden !important; padding: 0 !important; margin: 0 !important;
          border: 0 !important; opacity: 0 !important; pointer-events: none !important;
        }
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
    }
    root._dispose = () => {
      release(root);
      nativeStyle?.remove();
      host.remove();
      if (window.__agyCapsuleCleanup === root._dispose) delete window.__agyCapsuleCleanup;
    };
    if (childAnchor) host._dispose = root._dispose;
    else window.__agyCapsuleCleanup = root._dispose;

    const groups = [...root.querySelectorAll('.dk-grp')];
    const overlays = childSidebar ? groups.map(grp => grp.querySelector('.dk-pop')) : [];
    for (const pop of overlays) pop.popover = 'manual';
    const closePinned = root._closePinned = (dismiss = false) => {
      const pinned = root._pinnedGroup;
      if (pinned) {
        pinned.removeAttribute('data-pinned');
        if (dismiss) pinned.dataset.dismissed = 'true';
        pinned.querySelector('.dk-pill').setAttribute('aria-expanded', 'false');
        const pop = pinned.querySelector('.dk-pop');
        if (pop.matches(':popover-open')) pop.hidePopover();
      }
      root._pinnedGroup = null;
      root.removeAttribute('data-pinned');
    };
    root._layoutPopovers = (grp = root._pinnedGroup || root.querySelector('.dk-grp:hover')) => {
      const pop = grp && !grp.hidden && !grp.dataset.dismissed && !root.classList.contains('dk-hide-all')
        ? grp.querySelector('.dk-pop') : null;
      // A sidebar strip sits in its own stacking context below the native
      // composer. Only its panel needs to escape into the browser's top layer.
      for (const overlay of overlays) {
        if (overlay !== pop && overlay.matches(':popover-open')) overlay.hidePopover();
      }
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
      if (pop && childSidebar && !pop.matches(':popover-open')) pop.showPopover();
      if (!pop?.getBoundingClientRect().width) return;
      const width = layoutSize(pop, 'width');
      const pill = grp.querySelector('.dk-pill').getBoundingClientRect();
      const firstGrp = [...root.querySelectorAll('.dk-grp')].find(node => !node.hidden && node.getBoundingClientRect().width > 0);
      const stripLeft = (firstGrp || root).getBoundingClientRect().left;
      let left = Math.max(stripLeft, pill.right - width);
      left = Math.max(minLeft, Math.min(left, maxRight - width));
      pop.style.left = (childSidebar ? left : left - grp.getBoundingClientRect().left) + 'px';
      if (childSidebar) pop.style.bottom = (innerHeight - pill.top + 8) + 'px';
    };
    for (const grp of groups) {
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
        if (pop) {
          if (pop.matches(':popover-open')) pop.hidePopover();
          pop.style.left = '';
        }
      });
      grp.querySelector('.dk-pill').addEventListener('click', (event) => {
        event.stopPropagation();
        root._refreshCacheTooltip?.();
        const wasPinned = root._pinnedGroup === grp;
        closePinned();
        if (wasPinned) {
          grp.dataset.dismissed = 'true';
          root._layoutPopovers(grp);
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
      for (const grp of groups) {
        grp.dataset.dismissed = 'true';
        grp.querySelector('.dk-pill').setAttribute('aria-expanded', 'false');
      }
      root._layoutPopovers();
    };
    document.addEventListener('click', root._onOutsideClick);
    document.addEventListener('keydown', root._onEscape);
    root._onResize = () => root._scheduleLayout?.();
    window.addEventListener('resize', root._onResize);
    root.querySelector('[data-el="rowCacheHit"]').addEventListener('mouseenter', () => root._refreshCacheTooltip?.());
    root.querySelector('[data-telemetry-bar]').addEventListener('mouseenter', () => root._paintStatusBar?.());
  }

  // The expiry ring or bar advances with the clock, so it is painted on its own and never forces
  // a full pass. The DOM serializes SVG differently, hence the comparison with the last write.
  const paintCacheIndicator = () => {
    const dotCached = root.querySelector('[data-el="dotCached"]');
    if (dotCached && root._cacheIconSvg !== d.cacheIconSvg) dotCached.innerHTML = root._cacheIconSvg = d.cacheIconSvg;
    const cacheMeter = root.querySelector('[data-el="cacheMeter"]');
    const cacheMeterFill = root.querySelector('[data-el="cacheMeterFill"]');
    if (!cacheMeter || !cacheMeterFill) return;
    const hidden = d.cacheIndicator !== 'bar';
    if (cacheMeter.hidden !== hidden) cacheMeter.hidden = hidden;
    if (hidden) return;
    cacheMeterFill.style.width = d.cacheProgressPct || '0%';
    cacheMeterFill.style.backgroundColor = d.cacheProgressColor || '';
  };
  // Everything else is repainted and re-fitted only when the snapshot, a clock-driven text, the
  // host's running state or the footer geometry changed since the last pass.
  const now = Date.now();
  const cancelBtnVisible = !childAnchor && !!footerLeft.parentElement?.querySelector('[data-testid="input-cancel-button"]');
  const waiting = cancelBtnVisible || !!d.turnQueue?.hasPendingPlanner;
  const alertData = { ...d.contextData, requestError: d.requestError, turnQueue: d.turnQueue };
  const pickerKey = () => {
    if (childAnchor || (d.prefs?.modelEffortPicker !== true && !root._modelPicker)) return null;
    const trigger = footerLeft.querySelector('button[data-testid="model-selector-trigger"]');
    let state = null;
    try { state = trigger ? readPickerState(trigger) : null; } catch {}
    return [
      Boolean(root._modelPicker),
      root._modelPicker ? root._modelPicker.trigger === trigger : true,
      state ? [state.conversationId, state.selected, state.items, state.orchestrator ?? null] : null,
    ];
  };
  const renderKey = () => JSON.stringify([
    Boolean(childAnchor),
    { ...d, cacheIconSvg: '', cacheProgressPct: '', cacheProgressColor: '' },
    location.pathname, cancelBtnVisible, root._speedActivity?.coolUntil > now,
    presentation.alertView(alertData, d.prefs, undefined, now, waiting).label,
    d.turnMetrics && presentation.turnMetricsText(d.turnMetrics, undefined, now).elapsed,
    pickerKey(),
    [root, ...(footerLeft.parentElement?.children || [])].map(el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }),
  ]);
  if (footerLeft.contains(host) && root._renderKey === renderKey()) {
    paintCacheIndicator();
    return root._renderResult;
  }

  if (!footerLeft.contains(host)) {
    footerLeft.appendChild(host);
  }
  const labels = presentation.apply(root, d.prefs);
  const contextPill = root.querySelector('[data-el="grpCtx"] .dk-pill');
  const pillSpeed = root.querySelector('[data-el="pillSpeed"]');
  const tps = d.turnSpeed?.generation?.tps;
  const hasSpeed = Number.isFinite(tps) && tps >= 0;
  const motionEnabled = d.prefs?.speedAnimation === true;
  const running = !!d.turnSpeed?.hasActiveStep || cancelBtnVisible;
  const showPillSpeed = d.requestTimingAvailable !== false && d.prefs?.showSpeed !== false
    && (childAnchor ? hasSpeed || (running && motionEnabled) : !!d.turnSpeed || running);
  pillSpeed.hidden = !showPillSpeed;
  const childTurnOnly = !!(childAnchor && !d.hasContext && d.turnMetrics && d.prefs?.showTurnMetrics !== false);
  let childContext;
  if (childAnchor) {
    root.style.maxWidth = 'calc(100% - 12px)';
    const model = root.querySelector('[data-el="childModel"]');
    const modelName = d.subagent?.model || '';
    model.hidden = !modelName;
    if (model.textContent !== modelName) model.textContent = modelName;
    model.title = labels.childRequestModel + ': ' + modelName;
    childContext = contextPill.parentElement;
    childContext.hidden = !d.hasContext && !childTurnOnly;
    root.toggleAttribute('data-child-turn-only', childTurnOnly);
    // Speed alone needs no context button or empty popover.
    const speedParent = childContext.hidden ? root : contextPill;
    if (pillSpeed.parentElement !== speedParent) {
      if (speedParent === root) root.insertBefore(pillSpeed, childContext);
      else contextPill.appendChild(pillSpeed);
    }
  } else {
    effortEffects().applySidecarPrefs(d.prefs, window);
    syncModelPicker(root, footerLeft, d.prefs, labels, findFooterLeft,
      presentation.dictionaries[d.prefs?.settingsLanguage] || labels);
  }
  root.toggleAttribute('data-context-estimated', d.contextEstimated);
  presentation.renderContextTooltips(root, d.contextData, labels);
  const alerts = presentation.renderAlerts(root, alertData, d.prefs, labels, now, waiting);
  root.querySelector('[data-el="grpQuota"]').hidden = !!childAnchor || d.cloudPaygo;
  if (childAnchor) host.hidden = !alerts.visible && childContext.hidden && !showPillSpeed && root.querySelector('[data-el="childModel"]').hidden;
  if (childAnchor) host.style.display = host.hidden ? 'none' : 'block';
  if (root._pinnedGroup?.hidden) root._closePinned();
  root._refreshCacheTooltip = () => {
    root.querySelector('[data-el="rowCacheHit"]').title = presentation.cacheTooltip(d.cache, labels, Date.now(), d.prefs);
  };
  root._refreshCacheTooltip();
  presentation.renderGeneration(root.querySelector('.dk-ctx-pop'), d.generation, labels, d.prefs);
  presentation.renderTurnMetrics(root, d.turnMetrics, labels, d.prefs);
  // The compact status bar is computed only while it is shown. Like the Cache row it repaints
  // when the pointer enters it, because its cache tooltip states an age.
  root._paintStatusBar = () => {
    if (d.prefs?.compactTelemetryBar === true) presentation.renderTelemetryBar(root.querySelector('.dk-ctx-pop'), d.cache, d.generation, labels, d.prefs, Date.now());
  };
  root._paintStatusBar();
  // A child can execute again without changing either the URL or transcript.
  // Activity and the last completed request's speed are independent signals.
  const turnKey = location.pathname + ':' + ((childAnchor ? d.turnSpeed?.executionId : d.turnSpeed?.userStepIndex) ?? 'none');
  const requestIndex = d.turnSpeed?.generation?.requestIndex ?? null;
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
  contextPill.setAttribute('aria-label', childTurnOnly ? labels.turnMetrics : labels.context);
  for (const node of [contextPill, ...contextPill.querySelectorAll('[title]')]) node.removeAttribute('title');
  root.querySelector('[data-el="grpQuota"] .dk-pill').setAttribute('aria-label', labels.quota);

  const setK = (k, val) => {
    const el = root.querySelector(`[data-k="${k}"]`);
    if (el && el.textContent !== val) el.textContent = val;
  };

  setK('pillCtx', childTurnOnly ? labels.turnLabel : d.pillCtx);
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
  const modelText = childAnchor ? '' : applyModelQuota();

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
      if (node.hasAttribute?.('data-deck-model-bubble')) {
        const r = node.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) {
          const visR = Math.min(r.right, parentClip);
          if (visR > maxR) maxR = visR;
        }
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
    root._modelPicker?.setBubble(true);
    const visible = el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const children = Array.from(footerLeft.children);
    const nativeChildren = children.slice(0, children.indexOf(host)).filter(el => visible(el) || el.classList.contains('dk-model-squeezed'));
    const modelTargets = nativeChildren.filter((c) => c.textContent && c.textContent.trim().length > 0 && !c.hasAttribute('data-deck-model-bubble') && !c.querySelector('[data-deck-model-bubble]'));
    const turbo = footer.querySelector('[data-testid="permissions-selector-trigger"]');
    if (root._turboTarget && root._turboTarget !== turbo) root._turboTarget.removeAttribute('data-deck-turbo-collapsed');
    root._turboTarget = turbo;

    const isClippedEl = (el) => {
      if (el instanceof SVGElement) return false;
      if (el.hasAttribute?.('data-deck-model-bubble') || el.closest?.('[data-deck-model-bubble]')) return false;
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
      const fitsLeft = nativeMaxRight === -Infinity || rootRect.left >= nativeMaxRight - 0.5;
      const crowdedModel = !mode.compress && minRightBound - rootRect.right < 24 && isNativeSqueezed();
      if (fitsRight && fitsLeft && !(mode.compress && anySvgClipped) && !crowdedModel) break;
    }
    if (root.classList.contains('dk-hide-all')) root._modelPicker?.setBubble(false);
    } finally {
      root._adjustingLayout = false;
    }
  };
  root._adjustLayout = () => {
    if (childAnchor) {
      root.classList.remove('dk-hide-all', 'dk-hide-speed');
      const model = root.querySelector('[data-el="childModel"]');
      // Allow a readable ellipsis, but don't show a sliver of the model or
      // clip the non-shrinking pills when the host splits the sidebar again.
      const overflows = () => root.scrollWidth > root.clientWidth + 1 ||
        (!model.hidden && model.clientWidth < Math.min(24, model.scrollWidth));
      if (!host.hidden && overflows() && showPillSpeed && (!childContext.hidden || !model.hidden || alerts.visible)) {
        root.classList.add('dk-hide-speed');
      }
      if (!host.hidden && overflows()) {
        root._closePinned();
        root.classList.add('dk-hide-all');
      }
    } else adjustLayout();
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
      root._modelPicker?.sync?.();
      if (root._applyModelQuota) root._applyModelQuota();
      root._scheduleLayout?.();
    });
    if (!childAnchor) {
      obs.observe(footerLeft, { subtree: true, characterData: true, childList: true });
      root._modelObserver = obs;
    }

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
  const ctxIconSvg = root.querySelector('[data-el="ctxIconSvg"]');

  if (segRead) segRead.style.width = d.segReadW;
  if (segOut) segOut.style.width = d.segOutW;
  if (segThink) segThink.style.width = d.segThinkW;
  if (segTurn0) segTurn0.style.width = d.segTurn0W;
  root.querySelector('[data-el="segEstimate"]').style.width = d.segEstimateW;
  if (ctxIconSvg) ctxIconSvg.style.color = d.contextEstimated ? '' : d.ctxIconColor || '';
  paintCacheIndicator();
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
  // The hit-rate ring stands for the number, so it takes the number's color and dimming.
  const cacheHitRing = root.querySelector('[data-el="cacheHitRing"]');
  if (cacheHitRing) {
    cacheHitRing.innerHTML = d.cacheHitRingSvg;
    cacheHitRing.style.color = d.cacheValColor;
    cacheHitRing.style.opacity = d.cacheValOp;
  }

  // The child value must clear immediately rather than animate old execution text out.
  if (!childAnchor) motion('speed', pillSpeed, text => { speedValue.textContent = text.trim(); });
  motion('error', root.querySelector('[data-el="grpError"]'));

  // Update Quota Popover HTML
  const quotaPop = root.querySelector('[data-el="quotaPop"]');
  if (quotaPop && quotaPop.innerHTML !== d.quotaHtml) {
    quotaPop.innerHTML = d.quotaHtml;
  }
  presentation.apply(root, d.prefs);
  if (!childAnchor) applyModelQuota();

  root._fitPanelHeights = () => {
    // Only visible capsules participate in matched panel height.
    const errorPop = root.querySelector('.dk-error-pop');
    const contextPop = root.querySelector('.dk-ctx-pop');
    const pops = contextPop.closest('.dk-grp').hidden ? [] : [contextPop];
    if (!pops.length) contextPop.style.height = '';
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

  root._renderKey = renderKey();
  return root._renderResult = 'ok:' + modelText;
}

function toView(d) {
  const ctx = contextBreakdown(d);
  const cache = cacheView(d, d.prefs);
  const { iconSvg: cacheIconSvg, valColor: cacheValColor, valDeco: cacheValDeco, valOp: cacheValOp, text: valCacheHit, countdown: valCacheHitK, ctxIconColor, indicator: cacheIndicator, progressPct: cacheProgressPct, progressColor: cacheProgressColor, hitRingSvg: cacheHitRingSvg } = cache;

  const quotaGroups = d.subagent ? [] : quotaView(d.quotaGroups, d.prefs);
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
    subagent: d.subagent,
    hasContext: Number.isFinite(ctx.ctx) && ctx.ctx > 0 && Number.isFinite(ctx.maxCtx) && ctx.maxCtx > 0,
    contextEstimated: ctx.estimated,
    prefs: d.prefs || { language: 'en' },
    requestTimingAvailable: d.requestTimingAvailable !== false,
    generation: d.requestTimingAvailable === false ? null : (d.generation || null),
    turnSpeed: d.turnSpeed || null,
    turnQueue: d.turnQueue || null,
    turnMetrics: d.turnMetrics || null,
    requestError: d.requestError || { kind: 'none' },
    cloudPaygo: d.cloudPaygo === true,
    cache: { contextTokens: d.contextTokens, cachedIn: d.cachedIn, lastStepEpochMs: d.lastStepEpochMs || 0 },
    contextData: { contextTokens: d.contextTokens, maxContextTokens: d.maxContextTokens, cachedIn: d.cachedIn, uncachedIn: d.uncachedIn, turn0Tokens: d.turn0Tokens, totalOutputTokens: d.totalOutputTokens, totalThinkingTokens: d.totalThinkingTokens, contextEstimate: d.contextEstimate },
    pillCtx: ctx.usedPct,
    ctxIconColor,
    usedPctText: ctx.usedPct + ' used',
    usedFrac: ctx.usedFrac,
    segReadW: ctx.segReadW,
    segOutW: ctx.segOutW,
    segThinkW: ctx.segThinkW,
    segTurn0W: ctx.segTurn0W,
    segEstimateW: ctx.segEstimateW,
    cacheIndicator,
    cacheProgressPct,
    cacheProgressColor,
    cacheIconSvg,
    cacheHitRingSvg,
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
  let dataId = '';
  let mainView = null;
  let mainObserver;
  let disposed = false;
  const children = new Map();
  const childHosts = new Map();
  const removeChild = (anchor, entry) => {
    entry.observer.disconnect();
    entry.host._dispose?.();
    childHosts.delete(anchor);
  };
  const sync = (render = false) => {
    const footer = findFooterLeft();
    const view = footer?.closest('[data-testid="conversation-view"]') ?? null;
    const path = location.pathname;
    const conversationId = conversationIdOf(view) || path.match(/\/c\/([0-9a-f-]{36})/i)?.[1] || '';
    if (path !== dataPath) children.clear();
    if (path !== dataPath || conversationId !== dataId) data = null;
    dataPath = path;
    dataId = conversationId;
    if (view !== mainView) {
      mainObserver?.disconnect();
      if (view) {
        mainObserver ??= new MutationObserver(() => sync());
        mainObserver.observe(view, { attributes: true, attributeFilter: ['data-cascade-id'] });
      }
      mainView = view;
    }
    // Installed runtimes own the page; one-off legacy mounts must not strand
    // this runtime behind a newer timestamp while leaving two visible strips.
    window.__deckOwnerTs = owner;
    const anchors = findSubagentAnchors(footer);
    const ids = new Set(anchors.values());
    for (const id of children.keys()) if (!ids.has(id)) children.delete(id);
    const snapshots = new Map(anchors);
    const box = footer?.parentElement?.parentElement;
    if (box && data?.subagent) snapshots.set(box, null);
    for (const [anchor, entry] of childHosts) {
      if (!snapshots.has(anchor) || snapshots.get(anchor) !== entry.id || !entry.host.isConnected) {
        removeChild(anchor, entry);
      }
    }
    if (!footer || !data || data.subagent) window.__agyCapsuleCleanup?.();
    else if (render) pageMount(toView(data));
    if (render) for (const [anchor, id] of snapshots) {
      const next = id === null ? data : children.get(id);
      const entry = childHosts.get(anchor);
      if (!next?.subagent) {
        if (entry) removeChild(anchor, entry);
        continue;
      }
      pageMount(toView(next), anchor);
      if (!entry) {
        const host = anchor.querySelector(':scope > [data-agy-capsule-subagent]');
        if (!host) continue;
        const transcript = anchor.matches('[data-testid="subagent-tab-composer"]')
          ? anchor.previousElementSibling : anchor.closest('[data-testid="conversation-view"]');
        const observer = new MutationObserver(() => sync());
        if (transcript) observer.observe(transcript, { attributes: true, attributeFilter: ['data-cascade-id'] });
        if (anchor.parentElement) observer.observe(anchor.parentElement, { childList: true });
        childHosts.set(anchor, { id, observer, host });
      }
    }
    return { footer, conversationId, ids, hasKnownChildAnchor: [...anchors.keys()].some(el => el.matches('[data-testid="subagent-tab-composer"]')) };
  };
  const timer = setInterval(() => sync(true), 1000);
  const api = {
    owner, hash,
    readState(caller) {
      if (caller < owner) return 'superseded';
      const { footer, conversationId, ids, hasKnownChildAnchor } = sync();
      let modelConversationId = null, modelFamilies = null, contextEstimate = null;
      if (footer) {
        try {
          const trigger = footer.querySelector('button[data-testid="model-selector-trigger"]');
          const pickerState = trigger && readPickerState(trigger);
          if (pickerState?.families?.length) {
            modelConversationId = pickerState.conversationId;
            modelFamilies = pickerState.families;
          }
        } catch {}
        try {
          if (conversationIdOf(mainView) === conversationId && conversationId) {
            contextEstimate = readCompactionEstimate(footer, conversationId);
          }
        } catch {}
      }
      let effortSync = null;
      try { effortSync = effortEffects().readPendingPatch(); } catch {}
      return { owner, hash, path: location.pathname, hasFooter: !!footer, modelConversationId, modelFamilies, effortSync, contextEstimate,
        conversationId, loadedMain: !!data, hasKnownChildAnchor, subagentIds: [...ids], loadedSubagentIds: [...children.keys()] };
    },
    ackEffortSync(caller, rev) {
      if (caller < owner) return 'superseded';
      if (caller !== owner || disposed) return false;
      try { effortEffects().ackPendingPatch(rev); } catch {}
      return true;
    },
    readCloudTelemetry(caller, path, convId) {
      if (caller < owner) return 'superseded';
      if (caller !== owner || disposed || path !== location.pathname || !convId) return false;
      const { footer, conversationId } = sync();
      if (!footer || conversationId !== convId) return false;
      if (conversationIdOf(footer.closest('[data-testid="conversation-view"]')) !== convId) return null;
      try { return readCloudTrajectory(convId); } catch { return null; }
    },
    apply(next, path, caller, id) {
      if (caller < owner) return 'superseded';
      if (caller !== owner || disposed || path !== location.pathname) return false;
      const current = sync();
      if (id !== undefined && (!current.footer || current.conversationId !== id)) return false;
      data = next;
      sync(true);
      return true;
    },
    applySubagent(next, path, caller, id) {
      if (caller < owner) return 'superseded';
      if (caller !== owner || disposed || path !== location.pathname || !sync().ids.has(id)) return false;
      if (next?.subagent) children.set(id, next);
      else children.delete(id);
      sync(true);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      mainObserver?.disconnect();
      for (const [anchor, entry] of childHosts) removeChild(anchor, entry);
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
  const functions = [toView, findFooterLeft, conversationIdOf, readCompactionEstimate, findSubagentAnchors, layoutSize, resolveInheritedLabel, readPickerState, createMotionThemes, motionThemes, createUpstreamEffort, effortEffects, mountEffortBar, mountOrchestratorSwitch, syncModelPicker, readCloudTrajectory, pageMount, installRuntime].map(fn => fn.toString()).join('\n');
  const effortBar = `const EFFORT_BAR_CSS=${JSON.stringify(EFFORT_BAR_CSS)};`;
  const source = getPresentationScript() + '\n' + effortBar + '\n' + functions;
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const code = `(()=>{const INSTANCE_TS=${Number(owner)};if(globalThis.__agyCapsuleDeck?.owner>INSTANCE_TS)return 'superseded';${source}\nconst {escapeHtml,appearance,cacheView,contextBreakdown,quotaView,makeRingSvg}=globalThis.__agyCapsulePresentation;\nreturn installRuntime(INSTANCE_TS,${JSON.stringify(hash)});})()`;
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
  let availableModels = new Map();
  let availableEstimates = new Map();
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
    availableModels.clear();
    availableEstimates.clear();
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
    const nextModels = new Map();
    const nextEstimates = new Map();
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
            entry.lastChildPayloads = new Map();
            state = await run(`globalThis.__agyCapsuleDeck?.readState(${owner})??null`);
          }
          if (state === 'superseded') return await supersede();
          if (state?.owner !== owner || !state.path) { failed++; continue; }
          if (state.effortSync?.patch && typeof state.effortSync.patch === 'object') {
            try { options.onEffortSettingsPatch?.(state.effortSync.patch); } catch {}
            const acked = await run(`globalThis.__agyCapsuleDeck?.ackEffortSync(${owner},${Number(state.effortSync.rev) || 0})??false`);
            if (acked === 'superseded') return await supersede();
            if (stopped) break;
          }
          const childIds = Array.isArray(state.subagentIds) ? state.subagentIds.filter(id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) : [];
          if (state.hasFooter !== true && !childIds.length) { noAnchor++; continue; }
          const mainId = state.conversationId || state.path.match(/\/c\/([0-9a-f-]{36})/i)?.[1] || '';
          if (mainId && state.modelConversationId === mainId && Array.isArray(state.modelFamilies) && state.modelFamilies.length > 0) {
            nextModels.set(mainId, state.modelFamilies);
          }
          // Data-source failures belong to the sidebar health path, not to CDP.
          let pageFailed = false;
          if (state.hasFooter === true) {
            if (mainId && options.needsCloudTelemetry?.(mainId)) {
              const cloud = await run(`globalThis.__agyCapsuleDeck?.readCloudTelemetry(${owner},${JSON.stringify(state.path)},${JSON.stringify(mainId)})`);
              if (cloud === 'superseded') return await supersede();
              if (stopped) break;
              if (entry.closed || context !== entry.context || cloud === false) continue;
              if (cloud === null || cloud?.conversationId === mainId) options.onCloudTelemetry?.(mainId, cloud);
            }
            const estimate = mainId ? state.contextEstimate ?? null : null;
            if (estimate) nextEstimates.set(mainId, estimate);
            const data = await Promise.resolve().then(() => estimate
              ? inspect(mainId, true, false, estimate) : inspect(mainId, true)).catch(() => null);
            if (data && !data.error && !stopped) {
              const payload = JSON.stringify(data);
              if (entry.lastPayload !== payload || entry.lastPath !== state.path || entry.lastConversationId !== mainId || state.loadedMain === false) {
                const applied = await run(`globalThis.__agyCapsuleDeck?.apply(${payload},${JSON.stringify(state.path)},${owner},${JSON.stringify(mainId)})??false`);
                if (applied === 'superseded') return await supersede();
                if (applied) { entry.lastPayload = payload; entry.lastPath = state.path; entry.lastConversationId = mainId; }
                else { entry.lastPayload = ''; pageFailed = true; }
              }
            }
          }
          const childPayloads = entry.lastChildPayloads ??= new Map();
          const loaded = new Set(state.loadedSubagentIds);
          let hasChild = state.hasKnownChildAnchor === true;
          for (const id of childPayloads.keys()) if (!childIds.includes(id)) childPayloads.delete(id);
          for (const id of childIds) {
            const result = await Promise.resolve().then(() => inspect(id, true, true)).catch(() => null);
            if (stopped) break;
            const child = result?.subagent && !result.error ? result : null;
            if (child) hasChild = true;
            const payload = JSON.stringify(child);
            if (child ? loaded.has(id) && childPayloads.get(id) === payload : !loaded.has(id)) continue;
            const applied = await run(`globalThis.__agyCapsuleDeck?.applySubagent(${payload},${JSON.stringify(state.path)},${owner},${JSON.stringify(id)})??false`);
            if (applied === 'superseded') return await supersede();
            if (applied) childPayloads.set(id, payload);
            // A child tab can close while its DB is being read. Its stale
            // response is rejected without counting as an injector failure.
          }
          if (state.hasFooter !== true && !hasChild) noAnchor++;
          if (pageFailed) failed++;
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
    } finally {
      if (!stopped) {
        availableModels = nextModels;
        availableEstimates = nextEstimates;
      }
      busy = false;
    }
  };
  const timer = setInterval(tick, INTERVAL_MS);
  console.log('[deck] injector started, port file:', options.portFile || PORT_FILE);
  return { tick, stop, status: () => cdpState, models: conversationId => availableModels.get(conversationId) ?? [],
    contextEstimate: conversationId => availableEstimates.get(conversationId) ?? null };
}
