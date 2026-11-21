import { effortEffects, mountEffortBar } from './effort_bar.mjs';

// The desktop host owns the options and the selection. Re-read both from the
// current button before writing; a retained composer may belong to another chat.
export function resolveInheritedLabel(groupItems, selectedLabel) {
  if (!Array.isArray(groupItems) || !groupItems.length) return null;
  if (groupItems.some(item => item.label === selectedLabel)) return selectedLabel;
  const tierRe = /^(.*?)\s*\((off|low|medium|high|extra|xhigh|max|minimal)(?:\s+thinking)?\)$/i;
  const match = typeof selectedLabel === 'string' ? tierRe.exec(selectedLabel) : null;
  const cur = match ? match[2].toLowerCase() : null;
  const byTier = key => groupItems.find(item => item.tier && item.tier.toLowerCase() === key)?.label;
  if (cur) {
    const exact = byTier(cur);
    if (exact) return exact;
    if (cur === 'xhigh' || cur === 'extra' || cur === 'max') {
      const downgraded = byTier('high');
      if (downgraded) return downgraded;
    }
  }
  return byTier('high') || byTier('medium') || byTier('low') || groupItems[0]?.label || null;
}

export function readPickerState(trigger) {
  if (!trigger) return null;
  const key = Object.keys(trigger).find(key => key.startsWith('__reactFiber$'));
  let fiber = trigger[key];
  if (!fiber) return null;
  if (fiber.alternate) {
    let root = fiber;
    while (root.return) root = root.return;
    if (root.stateNode?.current && root !== root.stateNode.current) fiber = fiber.alternate;
  }

  let hasOwner = false, conversationId, selector, legacyProvider, options, plannerPreference;
  for (let node = fiber; node; node = node.return) {
    const props = node.memoizedProps;
    if (!props || typeof props !== 'object') continue;
    if (!hasOwner && 'placement' in props && 'conversationId' in props) {
      hasOwner = true;
      conversationId = props.conversationId;
    }
    const candidate = props.value && typeof props.value === 'object' ? props.value : props;
    if (!selector && typeof candidate.setSelectedModel === 'function' &&
        candidate.selectedModel && typeof candidate.selectedModel === 'object' &&
        Array.isArray(candidate.modelOptions)) {
      selector = candidate;
    }
    if (selector?.orchestratorPick && plannerPreference === undefined &&
        typeof props.value?.onDidChange === 'function' && typeof props.value?.getState === 'function') {
      plannerPreference = props.value.getState()?.getPrefValue?.('orchestratorModel');
    }
    if (!options) options = props.modelOptions ?? props.value?.modelOptions;
    if (!legacyProvider && typeof props.value?.getModelConfigForConversation === 'function' &&
        typeof props.value?.setModelConfigByLabelForConversation === 'function') {
      legacyProvider = props.value;
    }
  }

  const usable = list => {
    const map = new Map();
    for (const option of list) {
      if (!option || option.disabled || option.isDisabled || option.isAvailable === false || option.isHidden) continue;
      if (typeof option.label !== 'string' || !option.label.trim()) continue;
      if (!map.has(option.label)) map.set(option.label, option);
    }
    return map;
  };
  const tierRe = /^(.*?)\s*\((off|low|medium|high|extra|xhigh|max|minimal)(?:\s+thinking)?\)$/i;
  const summarize = (byLabel, extraDisabled = []) => {
    const labels = [...byLabel.keys()];
    const items = labels.map(label => {
      const opt = byLabel.get(label);
      return {
        label,
        disabled: false,
        tagTitle: typeof opt?.tagTitle === 'string' ? opt.tagTitle : '',
        tagDescription: typeof opt?.tagDescription === 'string' ? opt.tagDescription : '',
      };
    });
    const seenDisabled = new Set(labels);
    for (const opt of extraDisabled) {
      if (!opt || typeof opt.label !== 'string' || !opt.label.trim() || seenDisabled.has(opt.label)) continue;
      if (typeof opt.tagTitle !== 'string' || !opt.tagTitle.trim()) continue;
      seenDisabled.add(opt.label);
      items.push({
        label: opt.label,
        disabled: true,
        tagTitle: opt.tagTitle,
        tagDescription: typeof opt.tagDescription === 'string' ? opt.tagDescription : '',
      });
    }
    const groups = [];
    const byName = new Map();
    for (const entry of items) {
      const m = !entry.disabled ? tierRe.exec(entry.label) : null;
      const gk = m ? m[1].trim() : '\0' + entry.label;
      let g = byName.get(gk);
      if (!g) {
        g = { name: m ? m[1].trim() : entry.label, count: 0, matched: !!m, firstLabel: entry.label };
        byName.set(gk, g);
        groups.push(g);
      }
      g.count++;
    }
    const families = groups.map(g => (g.matched && g.count >= 2 ? g.name : g.firstLabel));
    return { labels, items, families };
  };

  if (selector) {
    if (!hasOwner) return null;
    const scopeId = typeof conversationId === 'string' && conversationId ? conversationId : '__new__';
    const byLabel = usable(selector.modelOptions);
    let selected = selector.selectedModel?.label;
    if (!byLabel.has(selected)) return null;
    const extraDisabled = [];
    const groupLists = Array.isArray(selector.groups)
      ? selector.groups
      : (Array.isArray(selector.modelSorts?.[0]?.groups) ? selector.modelSorts[0].groups : []);
    for (const grp of groupLists) {
      for (const opt of grp?.options || []) {
        if (opt && (opt.disabled || opt.isDisabled || opt.isAvailable === false)) extraDisabled.push(opt);
      }
    }
    const isOrchestrator = opt => /^(gemini-pro-coordinator|gemini-pro-orchestrator(?:-.+)?)$/.test(opt?.modelId || '');
    const selectedOption = byLabel.get(selected);
    const hostRoot = groupLists.flatMap(group => group?.options || [])
      .find(opt => isOrchestrator(opt) && byLabel.has(opt.label));
    const pick = selector.orchestratorPick;
    const plannerOptions = Array.isArray(selector.orchestratorPlanners) ? usable(selector.orchestratorPlanners) : new Map();
    if (hostRoot && typeof pick?.select === 'function' && plannerOptions.size && !selector.bestOfNConfig?.isBestOfNEnabled) {
      const rootOption = isOrchestrator(selectedOption) ? selectedOption : byLabel.get(hostRoot.label);
      const planners = new Map();
      const plannerChoices = new Map();
      const targets = Object.create(null);
      const defaultPlanner = [...plannerOptions.values()].find(opt => opt.value === plannerPreference)
        ?? plannerOptions.get(selector.orchestratorDefaultPlanner?.label);
      const currentPlanner = [...plannerOptions.values()].find(opt => opt.value === pick.model) ?? defaultPlanner;
      const plannerLabel = opt => 'Orchestrator → ' + opt.label;
      for (const opt of plannerOptions.values()) {
        const match = tierRe.exec(opt.label);
        const name = match?.[1].trim() ?? opt.label;
        const group = planners.get(name) ?? { name, items: [] };
        const label = plannerLabel(opt);
        group.items.push({ label, tier: match?.[2] ?? null });
        planners.set(name, group);
        plannerChoices.set(label, opt);
        const standalone = byLabel.get(opt.label);
        if (standalone && standalone.value === opt.value) targets[opt.label] = label;
      }
      const orchestrator = {
        planners: [...planners.values()],
        current: currentPlanner ? plannerLabel(currentPlanner) : null,
        active: isOrchestrator(selectedOption),
        standalone: targets[currentPlanner?.label] ? currentPlanner.label : null,
        targets,
      };
      // Keep the display row separate from the concrete host options and planner IDs.
      const displayOptions = new Map();
      for (const [label, opt] of byLabel) {
        if (!isOrchestrator(opt)) displayOptions.set(label, opt);
        else if (!displayOptions.has('Orchestrator')) displayOptions.set('Orchestrator', {
          tagTitle: hostRoot.tagTitle,
          tagDescription: 'Offloads routine steps to a faster executor.',
        });
      }
      const { labels, items, families } = summarize(displayOptions, extraDisabled.filter(opt => !isOrchestrator(opt)));
      if (orchestrator.active) selected = orchestrator.current ?? 'Orchestrator';
      return {
        conversationId: scopeId, labels: [...labels, ...plannerChoices.keys()], items, families, selected, orchestrator,
        choose(label) {
          const planner = plannerChoices.get(label);
          if (planner) {
            pick.select(planner.value === defaultPlanner?.value ? 0 : planner.value);
            return selector.setSelectedModel(rootOption);
          }
          const option = label === 'Orchestrator' ? rootOption : displayOptions.get(label);
          if (option) return selector.setSelectedModel(option);
        },
      };
    }
    const { labels, items, families } = summarize(byLabel, extraDisabled);
    return {
      conversationId: scopeId,
      labels,
      items,
      families,
      selected,
      choose(label) {
        const option = byLabel.get(label);
        if (!option) return;
        return selector.setSelectedModel(option);
      },
    };
  }

  if (!legacyProvider || typeof conversationId !== 'string' || !conversationId) return null;
  options ??= legacyProvider.visibleModelConfigs;
  if (!Array.isArray(options)) return null;
  const byLabel = usable(options);
  const selected = legacyProvider.getModelConfigForConversation(conversationId)?.label;
  if (!byLabel.has(selected)) return null;
  const { labels, items, families } = summarize(byLabel);
  return {
    conversationId,
    labels,
    items,
    families,
    selected,
    choose(label) {
      // Legacy 2.32.1 conversation-scoped path.
      return legacyProvider.setModelConfigByLabelForConversation(label, conversationId, false);
    },
  };
}

export function syncModelPicker(root, footer, prefsOrEnabled, labels, findFooterLeft, settingsLabels = labels) {
  const enabled = typeof prefsOrEnabled === 'boolean' ? prefsOrEnabled : prefsOrEnabled?.modelEffortPicker === true;
  const hideTags = typeof prefsOrEnabled === 'object' ? prefsOrEnabled?.hideModelTags === true : false;
  const hideDefaultEffort = typeof prefsOrEnabled === 'object' ? prefsOrEnabled?.hideDefaultEffort === true : false;
  const effortCaption = prefsOrEnabled?.showEffortBar === true ? (labels?.effortLevel || 'Effort level') : '';
  const effortOptions = effortCaption ? settingsLabels?.effortBarOptions : null;
  const customizeList = typeof prefsOrEnabled === 'object' ? prefsOrEnabled?.customizeModelList === true : false;
  const hiddenList = customizeList && Array.isArray(prefsOrEnabled?.hiddenModels) ? prefsOrEnabled.hiddenModels : [];
  const previous = root._modelPicker;
  if (!enabled && !previous) return;
  const trigger = enabled && footer.querySelector('button[data-testid="model-selector-trigger"]');
  const read = () => {
    try { return readPickerState(trigger); } catch { return null; }
  };
  const state = trigger && read();
  if (previous && (!state || previous.trigger !== trigger || previous.id !== state.conversationId)) {
    previous.dispose();
  }
  if (!state) return;

  const resolveCaption = src => (typeof src === 'string' ? src : src?.modelEffortPicker) || 'Enhanced model capsule';
  const resolveUnconfirmed = src => (typeof src === 'object' && src?.modelPickerUnconfirmed) ||
    (document.documentElement.lang.startsWith('zh') ? '尚未确认切换，请查看原生菜单。' : 'Selection unconfirmed. Check the native menu.');

  if (root._modelPicker) {
    root._modelPicker.setConfig(hiddenList, hideTags, hideDefaultEffort, effortCaption, effortOptions);
    root._modelPicker.refresh(state, resolveCaption(labels), resolveUnconfirmed(labels));
    return;
  }

  const SVG_INFO = '<svg class="dk-mp-info-svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M450-290h60V-520H450v230Zm30-298.46q13.73 0 23.02-9.29t9.29-23.02-9.29-23.02-23.02-9.29-23.02 9.29-9.29 23.02 9.29 23.02 23.02 9.29ZM480-100q-78.84 0-148.2-29.92t-120.69-81.21-81.21-120.69T100-480t29.92-148.2 81.21-120.69 120.69-81.21T480-860t148.2 29.92 120.69 81.21 81.21 120.69T860-480t-29.92 148.2-81.21 120.69-120.69 81.21T480-100Zm0-60q134 0 227-93t93-227-93-227-227-93-227 93-93 227 93 227 227 93Z"/></svg>';
  const SVG_CHECK = '<svg class="dk-mp-check" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>';
  const SVG_CHEV = '<svg class="dk-mp-chev" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></svg>';
  const SVG_DOWN = '<svg class="dk-mp-down" width="14" height="14" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-357.85L253.85-584L296-626.15l184,184l184-184L706.15-584L480-357.85Z"/></svg>';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dk-pill';
  button.dataset.el = 'modelPicker';
  const panel = document.createElement('div');
  panel.className = 'dk-model-options';
  panel.popover = 'auto';
  panel.setAttribute('role', 'menu');
  const options = document.createElement('div');
  options.className = 'dk-model-list';
  const orchestratorSwitch = document.createElement('button');
  orchestratorSwitch.type = 'button';
  orchestratorSwitch.className = 'dk-orchestrator-switch';
  orchestratorSwitch.setAttribute('role', 'switch');
  orchestratorSwitch.innerHTML = 'Orchestrator<span class="dk-orchestrator-track" aria-hidden="true"></span>';
  orchestratorSwitch.hidden = true;
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  const sub = document.createElement('div');
  sub.className = 'dk-model-sub';
  sub.popover = 'manual';
  sub.setAttribute('role', 'menu');
  const tiers = document.createElement('div');
  tiers.className = 'dk-model-tiers';
  tiers.popover = 'manual';
  tiers.setAttribute('role', 'menu');
  const tip = document.createElement('div');
  tip.className = 'dk-model-tip';
  tip.popover = 'manual';
  tip.setAttribute('role', 'tooltip');
  panel.append(options, orchestratorSwitch, status, sub, tiers, tip);
  root.prepend(button, panel);
  button.popoverTargetElement = panel;

  const tierOrder = { off: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, extra: 6, max: 7 };
  const tierRe = /^(.*?)\s*\((off|low|medium|high|extra|xhigh|max|minimal)(?:\s+thinking)?\)$/i;
  const displayTier = tier => tier?.toLowerCase() === 'xhigh' ? 'Extra High' : tier;
  const plannerText = (label, showEffort = true) => {
    const name = label?.replace(/^Orchestrator → /, '') ?? '';
    const match = tierRe.exec(name);
    return match ? match[1].trim() + (showEffort ? ' ' + displayTier(match[2]) : '') : name;
  };
  const switchTarget = ({ orchestrator, selected }) => orchestrator?.active
    ? orchestrator.standalone : orchestrator?.targets[selected];
  const setFormattedLabel = (el, label, orchestrator) => {
    const match = tierRe.exec(label);
    const textWrap = document.createElement('span');
    textWrap.className = 'dk-mp-text';
    if (orchestrator?.active && orchestrator.current) {
      const nameEl = document.createElement('span');
      nameEl.className = 'dk-mp-name';
      nameEl.textContent = 'Orchestrator';
      const effortEl = document.createElement('span');
      effortEl.className = 'dk-mp-effort';
      effortEl.textContent = ' ' + plannerText(orchestrator.current);
      textWrap.append(nameEl, effortEl);
    } else if (!match) {
      textWrap.textContent = label;
    } else {
      const nameEl = document.createElement('span');
      nameEl.className = 'dk-mp-name';
      nameEl.textContent = match[1].trim();
      const effortEl = document.createElement('span');
      effortEl.className = 'dk-mp-effort';
      effortEl.textContent = ' ' + match[2];
      textWrap.append(nameEl, effortEl);
    }
    el.replaceChildren(textWrap);
    el.insertAdjacentHTML('beforeend', SVG_DOWN);
  };

  let signature, pending = null, expiry;
  let queuedEffort = null;
  let currentCaption = resolveCaption(labels);
  let currentUnconfirmed = resolveUnconfirmed(labels);
  let currentHidden = [...hiddenList];
  let currentHideTags = hideTags;
  let currentHideDefaultEffort = hideDefaultEffort;
  let currentEffortCaption = effortCaption;
  let currentEffortOptions = effortOptions;
  let currentEffortLabels = [];
  const rememberedEffort = new Map();
  let effortBar = null;
  let renderedGroups = new Map();
  let currentSelected = state.selected;
  let openSubRow = null;
  let openPlannerRow = null;
  let subCloseTimer = null;

  // Give a diagonal move from the active row to its submenu a short head start
  // over sibling rows. Straight up/down movement still changes rows immediately.
  const menuAim = menu => {
    let origin, hovered, deferred, timer;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
    };
    return {
      reset() {
        cancel();
        origin = hovered = deferred = null;
      },
      update(event, row, active, activate) {
        const x = event.clientX, y = event.clientY;
        if (row && row === active) {
          cancel();
          origin = { x, y };
          hovered = row;
          return;
        }
        if (active && origin && event.pointerType !== 'touch' && menu.matches(':popover-open')) {
          const box = menu.getBoundingClientRect();
          const anchor = active.getBoundingClientRect();
          const edge = box.left >= anchor.right ? box.left : box.right;
          const progress = (x - origin.x) / (edge - origin.x);
          const minY = origin.y + (box.top - 6 - origin.y) * progress - 4;
          const maxY = origin.y + (box.bottom + 6 - origin.y) * progress + 4;
          if (progress > 0 && progress < 1 && y >= minY && y <= maxY) {
            deferred = row;
            timer ??= setTimeout(() => {
              timer = null;
              const next = deferred;
              activate(next);
              hovered = next;
              origin = null;
            }, 320);
            return;
          }
        }
        cancel();
        if (row === hovered) return;
        activate(row);
        hovered = row;
        origin = { x, y };
      },
    };
  };
  const modelAim = menuAim(sub);
  const plannerAim = menuAim(tiers);

  const hideTip = () => {
    if (tip.matches(':popover-open')) tip.hidePopover();
  };
  const showTipFor = infoEl => {
    const text = infoEl?.dataset?.tip;
    if (!text || !panel.matches(':popover-open')) { hideTip(); return; }
    tip.textContent = text;
    if (!tip.matches(':popover-open')) tip.showPopover();
    const ir = infoEl.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const left = Math.max(6, Math.min(ir.left + ir.width / 2 - tr.width / 2, innerWidth - tr.width - 6));
    let top = ir.top - tr.height - 6;
    if (top < 6) top = Math.min(innerHeight - tr.height - 6, ir.bottom + 6);
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  };

  const markBranch = (row, open) => {
    if (open) row.setAttribute('data-sub-open', 'true');
    else row.removeAttribute('data-sub-open');
    if (row.hasAttribute('aria-haspopup')) row.setAttribute('aria-expanded', String(open));
  };
  const hideTiers = () => {
    plannerAim.reset();
    if (openPlannerRow) markBranch(openPlannerRow, false);
    openPlannerRow = null;
    if (tiers.matches(':popover-open')) tiers.hidePopover();
  };
  const hideSub = () => {
    clearTimeout(subCloseTimer);
    subCloseTimer = null;
    modelAim.reset();
    hideTiers();
    if (openSubRow) {
      markBranch(openSubRow, false);
      openSubRow = null;
    }
    if (sub.matches(':popover-open')) sub.hidePopover();
  };
  const scheduleHideSub = () => {
    clearTimeout(subCloseTimer);
    subCloseTimer = setTimeout(hideSub, 260);
  };
  const cancelHideSub = () => {
    clearTimeout(subCloseTimer);
    subCloseTimer = null;
  };
  const showBeside = (menu, parent, row, preferLeft = false) => {
    if (!menu.matches(':popover-open')) menu.showPopover();
    const box = parent.getBoundingClientRect();
    const anchor = row.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    const right = box.right - 1;
    const left = box.left - size.width + 1;
    const fitsRight = right + size.width <= innerWidth - 6;
    const fitsLeft = left >= 6;
    const x = fitsLeft && (preferLeft || !fitsRight) ? left : fitsRight ? right
      : Math.max(6, Math.min(right, innerWidth - size.width - 6));
    const top = Math.max(6, Math.min(anchor.top - 5, innerHeight - size.height - 6));
    menu.style.left = x + 'px';
    menu.style.top = top + 'px';
  };
  const renderTiers = (menu, group, nativeLabels = false) => {
    menu.replaceChildren();
    menu.setAttribute('aria-label', group.name);
    for (const item of group.items) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'dk-model-sub-item';
      choice.setAttribute('role', 'menuitem');
      choice.dataset.label = item.label;
      choice.setAttribute('aria-label', nativeLabels ? plannerText(item.label) : item.label);
      const isSelected = item.label === currentSelected;
      choice.setAttribute('aria-pressed', String(isSelected));
      choice.disabled = pending !== null;
      const text = document.createElement('span');
      text.textContent = nativeLabels ? displayTier(item.tier) : item.tier;
      choice.append(text);
      if (isSelected) {
        const chk = document.createElement('span');
        chk.className = 'dk-mp-end';
        chk.innerHTML = SVG_CHECK;
        choice.append(chk);
      }
      menu.append(choice);
    }
  };
  const showSubFor = (row, group) => {
    cancelHideSub();
    if (currentEffortCaption || !panel.matches(':popover-open') || !(group?.planners || group?.isMultiTier)) {
      hideSub();
      return false;
    }
    if (openSubRow === row) return true;
    hideSub();
    openSubRow = row;
    markBranch(row, true);
    if (!group.planners) renderTiers(sub, group);
    else {
      sub.replaceChildren();
      sub.setAttribute('aria-label', group.name);
      for (const planner of group.planners) {
        const target = planner.items.find(item => item.label === currentSelected)
          ?? planner.items.find(item => item.tier?.toLowerCase() === 'medium') ?? planner.items[0];
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'dk-model-sub-item';
        choice.dataset.label = target.label;
        choice.dataset.planner = planner.name;
        choice.setAttribute('role', 'menuitem');
        choice.setAttribute('aria-pressed', String(planner.items.some(item => item.label === currentSelected)));
        choice.disabled = pending !== null;
        if (planner.isMultiTier) {
          choice.setAttribute('aria-haspopup', 'menu');
          choice.setAttribute('aria-expanded', 'false');
        }
        const main = document.createElement('span');
        main.className = 'dk-model-main';
        const name = document.createElement('span');
        name.className = 'dk-mp-name';
        name.textContent = planner.name;
        main.append(name);
        if (target.tier && !currentHideDefaultEffort) {
          const effort = document.createElement('span');
          effort.className = 'dk-mp-effort';
          effort.textContent = displayTier(target.tier);
          main.append(effort);
        }
        choice.append(main);
        const end = document.createElement('span');
        end.className = 'dk-mp-end';
        if (planner.isMultiTier) end.innerHTML = SVG_CHEV;
        else if (target.label === currentSelected) end.innerHTML = SVG_CHECK;
        choice.append(end);
        sub.append(choice);
      }
    }
    showBeside(sub, panel, row);
    return true;
  };
  const showTiersFor = row => {
    cancelHideSub();
    const planner = renderedGroups.get(openSubRow?.dataset.family)?.planners?.find(p => p.name === row?.dataset.planner);
    if (!planner?.isMultiTier) { hideTiers(); return false; }
    if (openPlannerRow === row) return true;
    hideTiers();
    openPlannerRow = row;
    markBranch(row, true);
    renderTiers(tiers, planner, true);
    showBeside(tiers, sub, row, sub.getBoundingClientRect().left < panel.getBoundingClientRect().left);
    return true;
  };

  const applyNativeMode = active => {
    if (!active) {
      close();
      trigger.removeAttribute('data-deck-model-bubble');
      root.style.marginLeft = '6px';
      return;
    }
    if (trigger.getAttribute('data-deck-model-bubble') !== 'hidden') {
      trigger.setAttribute('data-deck-model-bubble', 'hidden');
    }
    // A replaced native button leaves its 0-width wrapper at the exact spot; drop the
    // strip's own left margin so the capsule starts where the native one did.
    root.style.marginLeft = '0px';
  };
  const close = () => {
    hideTip();
    hideSub();
    if (panel.matches(':popover-open')) panel.hidePopover();
  };
  const isCurrent = () => findFooterLeft() === footer && trigger.isConnected &&
    footer.querySelector('button[data-testid="model-selector-trigger"]') === trigger;

  const tintEffort = (node, group, label) => {
    if (!node) return;
    let color = '';
    if (currentEffortCaption && group?.isMultiTier) {
      const idx = group.items.findIndex(item => item.label === label);
      if (idx >= 0) color = effortEffects().valueColorFor(group.items[idx].tier, idx, group.items.length,
        idx === group.items.length - 1, group.items[0].tier.toLowerCase() === 'off', false);
    }
    node.style.color = color;
    node.style.opacity = color ? '1' : '';
    node.style.fontWeight = color ? '600' : '';
  };

  applyNativeMode(true);

  const picker = {
    trigger, id: state.conversationId,
    setConfig(nextHidden, nextHideTags = false, nextHideDefaultEffort = false, nextEffortCaption = '', effortSettings = null) {
      currentHidden = Array.isArray(nextHidden) ? [...nextHidden] : [];
      currentHideTags = nextHideTags === true;
      currentHideDefaultEffort = nextHideDefaultEffort === true;
      currentEffortCaption = nextEffortCaption;
      currentEffortOptions = effortSettings;
      if (trigger.hasAttribute('data-deck-model-bubble')) applyNativeMode(true);
    },
    setBubble(active) {
      applyNativeMode(active);
    },
    sync() {
      if (root._modelPicker !== picker) return;
      const next = isCurrent() ? read() : null;
      if (next && next.conversationId === picker.id) picker.refresh(next, currentCaption, currentUnconfirmed);
      else picker.dispose();
    },
    dispose() {
      clearTimeout(expiry);
      close();
      effortBar?.setOpen(false);
      button.remove();
      panel.remove();
      trigger.removeAttribute('data-deck-model-bubble');
      root.style.marginLeft = '6px';
      delete root._modelPicker;
    },
    refresh(next, caption, unconfirmed) {
      currentCaption = caption || currentCaption;
      currentUnconfirmed = unconfirmed || currentUnconfirmed;
      currentSelected = next.selected;
      if (button.dataset.label !== next.selected) {
        button.dataset.label = next.selected;
        setFormattedLabel(button, next.selected, next.orchestrator);
      }
      button.removeAttribute('title');
      button.setAttribute('aria-label', currentCaption + ': ' +
        (next.orchestrator?.active ? button.querySelector('.dk-mp-text').textContent : next.selected));
      panel.setAttribute('aria-label', currentCaption);
      if (pending && (next.selected === pending || (pending === 'Orchestrator' && next.orchestrator?.active))) {
        clearTimeout(expiry);
        pending = null;
        status.textContent = '';
        if (!currentEffortCaption) close();
        const queued = queuedEffort;
        queuedEffort = null;
        if (queued && queued !== next.selected) queueMicrotask(() => void commitSelection(queued, 'effort'));
      }
      const key = JSON.stringify([next.items || next.labels, next.selected, next.orchestrator, pending, currentHidden, currentHideTags, currentHideDefaultEffort, currentEffortCaption, currentEffortOptions?.title]);
      if (key === signature) return;
      signature = key;
      hideSub();

      const rawItems = Array.isArray(next.items) && next.items.length
        ? next.items
        : next.labels.map(label => ({ label, disabled: false, tagTitle: '', tagDescription: '' }));

      const groups = [];
      const byName = new Map();
      for (const entry of rawItems) {
        const match = !entry.disabled ? tierRe.exec(entry.label) : null;
        const groupKey = match ? match[1].trim() : '\0' + entry.label;
        let group = byName.get(groupKey);
        if (!group) {
          group = { name: match ? match[1].trim() : entry.label, disabled: !!entry.disabled, items: [], tagTitle: '', tagDescription: '' };
          byName.set(groupKey, group);
          groups.push(group);
        }
        if (!group.tagTitle && entry.tagTitle) group.tagTitle = entry.tagTitle;
        if (!group.tagDescription && entry.tagDescription) group.tagDescription = entry.tagDescription;
        group.items.push({ label: entry.label, tier: match ? match[2] : null });
      }
      const sortTiers = (a, b) => (tierOrder[a.tier?.toLowerCase()] ?? 99) - (tierOrder[b.tier?.toLowerCase()] ?? 99);
      for (const group of groups) {
        group.isMultiTier = !group.disabled && group.items.length >= 2 && group.items.every(item => item.tier !== null);
        group.familyName = group.isMultiTier ? group.name : group.items[0].label;
        if (group.isMultiTier) group.items.sort(sortTiers);
        if (next.orchestrator && group.familyName === 'Orchestrator') {
          group.planner = next.orchestrator.current;
          group.planners = next.orchestrator.planners.map(planner => ({
            name: planner.name,
            items: [...planner.items].sort(sortTiers),
            isMultiTier: planner.items.length > 1 && planner.items.every(item => item.tier !== null),
          }));
        }
      }

      const activePlanner = next.orchestrator?.active && groups.find(group => group.planners)
        ?.planners.find(planner => planner.items.some(item => item.label === next.selected));
      const selectedInList = currentEffortCaption && next.orchestrator?.active ? next.orchestrator.standalone : next.selected;
      const effortGroup = currentEffortCaption && (activePlanner || groups.find(group => group.items.some(item => item.label === next.selected)));
      if (selectedInList && effortGroup?.isMultiTier) rememberedEffort.set(effortGroup.name, selectedInList);
      tintEffort(button.querySelector('.dk-mp-effort'), effortGroup, next.selected);
      currentEffortLabels = effortGroup ? effortGroup.items.map(item => item.label) : [];
      panel.dataset.effortMode = String(!!currentEffortCaption);
      panel.setAttribute('role', currentEffortCaption ? 'dialog' : 'menu');
      if (currentEffortCaption) {
        button.setAttribute('aria-haspopup', 'dialog');
        options.setAttribute('role', 'menu');
        options.setAttribute('aria-label', currentCaption);
      } else {
        button.removeAttribute('aria-haspopup');
        options.removeAttribute('role');
        options.removeAttribute('aria-label');
      }
      orchestratorSwitch.hidden = !(currentEffortCaption && next.orchestrator);
      orchestratorSwitch.disabled = !switchTarget(next);
      orchestratorSwitch.setAttribute('aria-disabled', String(orchestratorSwitch.disabled || pending !== null));
      orchestratorSwitch.setAttribute('aria-checked', String(next.orchestrator?.active === true));
      if (effortGroup) {
        if (!effortBar) {
          effortBar = mountEffortBar(label => void commitSelection(label, 'effort'));
          orchestratorSwitch.after(effortBar.element);
        }
        effortBar.refresh(effortGroup, next.selected, pending, currentEffortCaption, currentEffortOptions);
        effortBar.setOpen(panel.matches(':popover-open'));
      } else if (effortBar) {
        effortBar.setOpen(false);
        effortBar.element.remove();
        effortBar = null;
      }

      const hiddenSet = new Set(currentHidden);
      const modelGroups = orchestratorSwitch.hidden ? groups : groups.filter(group => !group.planners);
      const filtered = modelGroups.filter(group => !hiddenSet.has(group.familyName));
      const visibleGroups = filtered.length > 0 ? filtered : modelGroups;

      const appendBadge = (container, group) => {
        if (currentHideTags || !group.tagTitle) return;
        const badge = document.createElement('span');
        badge.className = 'dk-mp-badge';
        const badgeText = document.createElement('span');
        badgeText.textContent = group.tagTitle;
        badge.append(badgeText);
        if (group.tagDescription) {
          const info = document.createElement('span');
          info.className = 'dk-mp-info';
          info.innerHTML = SVG_INFO;
          info.dataset.tip = group.tagDescription;
          badge.append(info);
        }
        container.append(badge);
      };

      renderedGroups = new Map();
      const focusedFamily = currentEffortCaption && options.getRootNode().activeElement?.closest('button.dk-model-row')?.dataset.family;
      options.replaceChildren();
      for (const group of visibleGroups) {
        renderedGroups.set(group.familyName, group);
        if (group.disabled) {
          const row = document.createElement('div');
          row.className = 'dk-model-row dk-model-disabled';
          row.dataset.family = group.familyName;
          row.setAttribute('aria-disabled', 'true');
          const main = document.createElement('span');
          main.className = 'dk-model-main';
          const nameEl = document.createElement('span');
          nameEl.className = 'dk-mp-name';
          nameEl.textContent = group.name;
          main.append(nameEl);
          appendBadge(main, group);
          row.append(main);
          options.append(row);
          continue;
        }
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'dk-model-row';
        row.setAttribute('role', 'menuitem');
        const isActiveGroup = group.planners ? next.orchestrator.active : group.items.some(item => item.label === selectedInList);
        const targetLabel = !group.isMultiTier ? group.items[0].label : !currentEffortCaption
          ? resolveInheritedLabel(group.items, next.orchestrator?.active ? 'Orchestrator' : next.selected)
          : (group.items.find(item => item.label === selectedInList)
            || group.items.find(item => item.label === rememberedEffort.get(group.name))
            || group.items.find(item => item.tier.toLowerCase() === 'medium') || group.items[0]).label;
        row.dataset.label = targetLabel;
        row.dataset.family = group.familyName;
        row.setAttribute('aria-label', group.planner ? group.name + ' ' + plannerText(group.planner) : targetLabel);
        row.setAttribute('aria-pressed', String(isActiveGroup));
        if (group.planners || (group.isMultiTier && !currentEffortCaption)) {
          row.setAttribute('aria-haspopup', 'menu');
          row.setAttribute('aria-expanded', 'false');
        }
        if (currentEffortCaption) row.setAttribute('aria-disabled', String(pending !== null));
        else row.disabled = pending !== null;

        const main = document.createElement('span');
        main.className = 'dk-model-main';
        const nameEl = document.createElement('span');
        nameEl.className = 'dk-mp-name';
        const singleMatch = !group.isMultiTier ? tierRe.exec(group.items[0].label) : null;
        main.append(nameEl);
        if (group.planner) {
          nameEl.textContent = group.name;
          nameEl.classList.add('dk-mp-orchestrator');
          const planner = document.createElement('span');
          planner.className = 'dk-mp-name dk-mp-effort dk-mp-planner';
          planner.textContent = plannerText(group.planner, !currentHideDefaultEffort);
          main.append(planner);
        } else if (group.isMultiTier) {
          nameEl.textContent = group.name;
        } else if (currentHideDefaultEffort && singleMatch) {
          nameEl.textContent = singleMatch[1].trim();
        } else {
          nameEl.textContent = group.items[0].label;
        }
        if (group.isMultiTier) {
          const displayTier = group.items.find(item => item.label === targetLabel)?.tier || '';
          if (displayTier && !currentHideDefaultEffort) {
            const eff = document.createElement('span');
            eff.className = 'dk-mp-effort';
            eff.textContent = displayTier;
            tintEffort(eff, group, targetLabel);
            main.append(eff);
          }
        }

        appendBadge(main, group);

        const end = document.createElement('span');
        end.className = 'dk-mp-end';
        if (isActiveGroup) end.innerHTML = SVG_CHECK;
        else if (group.planners || (group.isMultiTier && !currentEffortCaption)) end.innerHTML = SVG_CHEV;
        row.append(main, end);
        options.append(row);
        if (group.familyName === focusedFamily) row.focus({ preventScroll: true });
      }
    },
  };
  root._modelPicker = picker;

  const commitSelection = async (label, source = 'model') => {
    if (!isCurrent()) return;
    const fromEffort = source === 'effort';
    if (fromEffort && (!currentEffortCaption || !currentEffortLabels.includes(label))) return;
    if (pending) {
      // Keep only the newest effort choice while the host confirms the previous one.
      if (fromEffort && currentEffortLabels.includes(pending)) queuedEffort = label === pending ? null : label;
      return;
    }
    const current = read();
    if (!current || current.conversationId !== picker.id) {
      picker.dispose();
      return;
    }
    if (source === 'switch') {
      label = currentEffortCaption && switchTarget(current);
      if (!label) return;
    } else if (source === 'model' && currentEffortCaption && current.orchestrator?.active) {
      // Keep routing through Orchestrator only when the chosen model and tier are supported.
      label = current.orchestrator.targets[label] ?? label;
    }
    if (!current.labels.includes(label)) {
      picker.dispose();
      return;
    }
    if (label === current.selected || (label === 'Orchestrator' && current.orchestrator?.active)) {
      if (!currentEffortCaption) close();
      return;
    }
    pending = label;
    status.textContent = '';
    picker.refresh(current, currentCaption, currentUnconfirmed);
    const fail = () => {
      if (root._modelPicker !== picker || pending !== label) return;
      pending = null;
      queuedEffort = null;
      status.textContent = currentUnconfirmed;
      const next = read();
      if (next && next.conversationId === picker.id) picker.refresh(next, currentCaption, currentUnconfirmed);
      else picker.dispose();
    };
    expiry = setTimeout(fail, 3000);
    const check = () => {
      if (root._modelPicker !== picker) return;
      const next = read();
      if (isCurrent() && next?.conversationId === picker.id) picker.refresh(next, currentCaption, currentUnconfirmed);
      else picker.dispose();
    };
    try {
      await current.choose(label);
      check();
      if (pending === label) requestAnimationFrame(check);
    } catch { fail(); }
  };

  panel.addEventListener('beforetoggle', event => {
    if (event.newState !== 'open') { hideTip(); hideSub(); effortBar?.setOpen(false); return; }
    picker.sync();
    if (root._modelPicker !== picker) return;
    const rect = button.getBoundingClientRect();
    const estWidth = Math.min(320, innerWidth - 12);
    panel.style.left = Math.max(6, Math.min(rect.left, innerWidth - estWidth - 6)) + 'px';
    panel.style.bottom = Math.max(6, innerHeight - rect.top + 6) + 'px';
    panel.style.maxHeight = Math.max(48, rect.top - 12) + 'px';
    effortBar?.setOpen(true);
  });
  panel.addEventListener('toggle', event => {
    if (event.newState !== 'open') { hideTip(); hideSub(); }
  });
  options.addEventListener('pointerover', event => {
    const info = event.target.closest('.dk-mp-info[data-tip]');
    if (info) showTipFor(info);
    else hideTip();
  });
  options.addEventListener('pointermove', event => {
    if (currentEffortCaption) return;
    modelAim.update(event, event.target.closest('button.dk-model-row'), openSubRow,
      row => showSubFor(row, renderedGroups.get(row?.dataset.family)));
  });
  options.addEventListener('pointerout', event => {
    const info = event.target.closest('.dk-mp-info[data-tip]');
    if (info && !info.contains(event.relatedTarget)) hideTip();
  });
  options.addEventListener('focusin', event => {
    const row = event.target.closest('button.dk-model-row');
    if (!row) return;
    const group = renderedGroups.get(row.dataset.family);
    if (group?.planners && openSubRow === row) hideTiers();
    showSubFor(row, group);
  });
  options.addEventListener('pointerenter', cancelHideSub);
  options.addEventListener('pointerleave', () => {
    hideTip();
    modelAim.reset();
    scheduleHideSub();
  });
  sub.addEventListener('pointerenter', () => modelAim.reset());
  sub.addEventListener('pointerleave', () => plannerAim.reset());
  tiers.addEventListener('pointerenter', () => plannerAim.reset());
  for (const menu of [sub, tiers]) {
    menu.addEventListener('pointerenter', cancelHideSub);
    menu.addEventListener('pointerleave', scheduleHideSub);
    menu.addEventListener('click', event => {
      const choice = event.target.closest('button[data-label]');
      if (choice) void commitSelection(choice.dataset.label);
    });
  }
  sub.addEventListener('pointermove', event => {
    plannerAim.update(event, event.target.closest('button[data-planner]'), openPlannerRow, showTiersFor);
  });
  sub.addEventListener('focusin', event => showTiersFor(event.target.closest('button[data-planner]')));
  const focusFirst = menu => menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  for (const menu of [options, sub, tiers]) {
    menu.addEventListener('keydown', event => {
      const row = event.target.closest('button');
      if (!row) return;
      if (event.key === 'ArrowRight') {
        if (menu === options && showSubFor(row, renderedGroups.get(row.dataset.family))) focusFirst(sub);
        else if (menu === sub && showTiersFor(row)) focusFirst(tiers);
        else return;
      } else if ((event.key === 'ArrowLeft' || event.key === 'Escape') && menu !== options) {
        if (menu === tiers) {
          const parent = openPlannerRow;
          hideTiers();
          parent?.focus({ preventScroll: true });
          hideTiers();
        } else {
          const parent = openSubRow;
          hideSub();
          parent?.focus({ preventScroll: true });
          hideSub();
        }
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const rows = [...menu.querySelectorAll('button:not(:disabled)')];
        const step = event.key === 'ArrowDown' ? 1 : -1;
        rows[(rows.indexOf(row) + step + rows.length) % rows.length]?.focus();
      } else return;
      event.preventDefault();
      event.stopPropagation();
    });
  }
  options.addEventListener('click', event => {
    const choice = event.target.closest('button[data-label]');
    if (choice) void commitSelection(choice.dataset.label);
  });
  orchestratorSwitch.addEventListener('click', () => void commitSelection(null, 'switch'));

  picker.refresh(state, currentCaption, currentUnconfirmed);
}
