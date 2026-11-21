import { createUpstreamEffort, UPSTREAM_EFFORT_CSS } from './effort_upstream.mjs';

export const EFFORT_BAR_CSS = UPSTREAM_EFFORT_CSS +
' .ces-root:focus-visible, .ces-set button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }' +
' .ces-set { inset: auto; margin: 0; width: 292px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto; }' +
' .ces-set-opt { text-wrap: balance; min-height: 27px; }' +
' @media (prefers-reduced-motion: reduce) { .ces-star, .ces-energy__sweep { animation-play-state: paused !important; } }';

export function effortEffects() {
  return effortEffects.instance ??= createUpstreamEffort();
}

export function mountEffortBar(choose) {
  const effects = effortEffects();
  const element = document.createElement('div');
  element.className = 'agy-effort ces-ag-section';
  element.innerHTML = '<div class="ces-ag-effort-row"><div class="ces-ag-effort-head"><span class="ces-ag-effort-title"></span><span class="ces-ag-effort-value"></span></div><div class="ces-inline"></div></div>';
  const row = element.firstElementChild;
  const container = row.lastElementChild;
  const [caption, valueElement] = row.firstElementChild.children;

  let groupKey, mounted, open = false, settingsLabels, settingsMenu, settingsListeners;
  const seat = {
    baseName: '',
    currentEffort: '',
    effortLevels: [],
    selectEffort(item) { choose(item.effort); },
  };

  function updateMount() {
    if (open && seat.effortLevels.length && !mounted) {
      mounted = effects.mountCodexEffortSlider({ container, row, valueElement, seat, caption: caption.textContent });
    }
  }

  function closeSettings(restoreFocus = false) {
    if (!settingsMenu) return;
    settingsListeners.abort();
    settingsMenu.hidePopover();
    settingsMenu.remove();
    settingsMenu = null;
    if (restoreFocus) container.firstElementChild?.focus({ preventScroll: true });
  }

  function openSettings(x, y) {
    if (!settingsLabels?.title) return;
    closeSettings();
    const labels = settingsLabels;
    const menu = document.createElement('div');
    settingsMenu = menu;
    menu.className = 'ces-set';
    menu.popover = 'manual';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', labels.title);

    const choices = [];
    const renderChoices = () => {
      const prefs = effects.readSettings(window);
      for (const [button, key, value] of choices) {
        const active = prefs[key] === value;
        button.classList.toggle('is-on', active);
        button.setAttribute('aria-pressed', String(active));
      }
    };
    const buttonFor = (className, label, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = label;
      button.addEventListener('click', action);
      return button;
    };

    for (const [key, values] of [
      ['motion', ['fast', 'quick', 'full']],
      ['ticks', ['highlight', 'dim', 'hidden']],
      ['theme', ['auto', 'codex', 'claude']],
    ]) {
      const group = document.createElement('div');
      group.className = 'ces-set-group';
      group.innerHTML = '<div class="ces-set-label"></div><div class="ces-set-opts" role="group"></div>';
      group.firstElementChild.textContent = labels[key][0];
      const options = group.lastElementChild;
      options.setAttribute('aria-label', labels[key][0]);
      values.forEach((value, index) => {
        const button = buttonFor('ces-set-opt', labels[key][index + 1], () => {
          effects.writeSettings({ [key]: value }, window);
          renderChoices();
        });
        choices.push([button, key, value]);
        options.append(button);
      });
      menu.append(group);
    }

    renderChoices();
    element.append(menu);
    menu.showPopover();
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - rect.width - 8, x)) + 'px';
    menu.style.top = Math.max(8, Math.min(innerHeight - rect.height - 8, y)) + 'px';
    (menu.querySelector('.ces-set-opt.is-on') || menu.querySelector('button')).focus({ preventScroll: true });

    settingsListeners = new AbortController();
    const listeners = { capture: true, signal: settingsListeners.signal };
    document.addEventListener('pointerdown', event => {
      if (!event.composedPath().includes(menu)) closeSettings();
    }, listeners);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSettings(true);
    }, listeners);
    const off = effects.onSettingsChange(renderChoices, window);
    settingsListeners.signal.addEventListener('abort', off, { once: true });
  }

  row.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    openSettings(event.clientX, event.clientY);
  });
  row.addEventListener('keydown', event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = row.getBoundingClientRect();
    openSettings(rect.left, rect.bottom + 4);
  });

  return {
    element,
    setOpen(next) {
      open = next;
      if (open) updateMount();
      else {
        closeSettings();
        mounted?.unmount();
        mounted = null;
      }
    },
    refresh(group, selected, pending, label, localizedSettings) {
      settingsLabels = localizedSettings;
      caption.textContent = label;
      const levels = group.items.map(item => ({ effort: item.label, label: item.tier ?? '' }));
      const nextKey = JSON.stringify([group.name, levels]);
      if (nextKey !== groupKey) {
        closeSettings();
        mounted?.unmount();
        mounted = null;
        groupKey = nextKey;
        seat.baseName = group.name;
        seat.effortLevels = levels;
      }
      seat.currentEffort = group.items.some(item => item.label === pending) ? pending : selected;
      updateMount();
      if (mounted) {
        container.firstElementChild.setAttribute('aria-label', label);
        // Schedule after the upstream pointer/key handler sets its spring target.
        const instance = mounted;
        queueMicrotask(() => { if (instance === mounted) instance.refresh(); });
      }
    },
  };
}

// Static settings thumbnail uses the same track geometry and colors, without a frame loop.
export const EFFORT_TRACK_MARKUP = '<div class="ces-inline" data-energy="1" style="--ces-energy:1"><div class="ces-track" style="--ces-fill:calc(100% - 14px);--ces-fill-bg:linear-gradient(90deg,#4c1d95,#9333ea,#c084fc)"><div class="ces-fill" style="width:var(--ces-fill);background:var(--ces-fill-bg)"></div><div class="ces-knob"></div></div></div>';
