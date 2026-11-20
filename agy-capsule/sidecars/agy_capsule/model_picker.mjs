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

  let hasOwner = false, conversationId, selector, legacyProvider, options;
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
  const summarize = (byLabel, extraDisabled = []) => {
    const tierRe = /^(.*?)\s*\((off|low|medium|high|extra|xhigh|max|minimal)(?:\s+thinking)?\)$/i;
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
    const selected = selector.selectedModel?.label;
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

export function syncModelPicker(root, footer, prefsOrEnabled, labels, findFooterLeft) {
  const enabled = typeof prefsOrEnabled === 'boolean' ? prefsOrEnabled : prefsOrEnabled?.modelEffortPicker === true;
  const keepNative = typeof prefsOrEnabled === 'object' ? prefsOrEnabled?.keepNativeModelEntry !== false : true;
  const hideTags = typeof prefsOrEnabled === 'object' ? prefsOrEnabled?.hideModelTags === true : false;
  const hideDefaultEffort = typeof prefsOrEnabled === 'object' ? prefsOrEnabled?.hideDefaultEffort === true : false;
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
    root._modelPicker.setConfig(keepNative, hiddenList, hideTags, hideDefaultEffort);
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
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  const sub = document.createElement('div');
  sub.className = 'dk-model-sub';
  sub.popover = 'manual';
  sub.setAttribute('role', 'menu');
  const tip = document.createElement('div');
  tip.className = 'dk-model-tip';
  tip.popover = 'manual';
  tip.setAttribute('role', 'tooltip');
  panel.append(options, status, sub, tip);
  root.prepend(button, panel);
  button.popoverTargetElement = panel;

  const tierOrder = { off: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, extra: 6, max: 7 };
  const tierRe = /^(.*?)\s*\((off|low|medium|high|extra|xhigh|max|minimal)(?:\s+thinking)?\)$/i;
  const setFormattedLabel = (el, label) => {
    const match = tierRe.exec(label);
    const textWrap = document.createElement('span');
    textWrap.className = 'dk-mp-text';
    if (!match) {
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
  let currentCaption = resolveCaption(labels);
  let currentUnconfirmed = resolveUnconfirmed(labels);
  let currentKeepNative = keepNative;
  let currentHidden = [...hiddenList];
  let currentHideTags = hideTags;
  let currentHideDefaultEffort = hideDefaultEffort;
  let renderedGroups = new Map();
  let currentSelected = state.selected;
  let openSubRow = null;
  let subCloseTimer = null;

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

  const hideSub = () => {
    clearTimeout(subCloseTimer);
    subCloseTimer = null;
    if (openSubRow) {
      openSubRow.removeAttribute('data-sub-open');
      openSubRow = null;
    }
    if (sub.matches(':popover-open')) sub.hidePopover();
  };
  const scheduleHideSub = () => {
    clearTimeout(subCloseTimer);
    subCloseTimer = setTimeout(hideSub, 150);
  };
  const cancelHideSub = () => {
    clearTimeout(subCloseTimer);
    subCloseTimer = null;
  };
  const showSubFor = (row, group) => {
    cancelHideSub();
    if (!panel.matches(':popover-open') || !group?.isMultiTier) { hideSub(); return; }
    if (openSubRow && openSubRow !== row) openSubRow.removeAttribute('data-sub-open');
    openSubRow = row;
    row.setAttribute('data-sub-open', 'true');
    sub.replaceChildren();
    for (const item of group.items) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'dk-model-sub-item';
      choice.setAttribute('role', 'menuitem');
      choice.dataset.label = item.label;
      choice.setAttribute('aria-label', item.label);
      const isSelected = item.label === currentSelected;
      choice.setAttribute('aria-pressed', String(isSelected));
      choice.disabled = pending !== null;
      const text = document.createElement('span');
      text.textContent = item.tier;
      choice.append(text);
      if (isSelected) {
        const chk = document.createElement('span');
        chk.className = 'dk-mp-end';
        chk.innerHTML = SVG_CHECK;
        choice.append(chk);
      }
      sub.append(choice);
    }
    if (!sub.matches(':popover-open')) sub.showPopover();
    const panelRect = panel.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const subRect = sub.getBoundingClientRect();
    let left = panelRect.right + 4;
    if (left + subRect.width > innerWidth - 6) left = Math.max(6, panelRect.left - subRect.width - 4);
    const top = Math.max(6, Math.min(rowRect.top - 4, innerHeight - subRect.height - 6));
    sub.style.left = left + 'px';
    sub.style.top = top + 'px';
  };

  const applyNativeMode = active => {
    if (!active) {
      close();
      trigger.removeAttribute('data-deck-model-bubble');
      root.style.marginLeft = '6px';
      return;
    }
    const mode = currentKeepNative ? 'bubble' : 'hidden';
    if (trigger.getAttribute('data-deck-model-bubble') !== mode) {
      trigger.setAttribute('data-deck-model-bubble', mode);
    }
    // A replaced native button leaves its 0-width wrapper at the exact spot; drop the
    // strip's own left margin so the capsule starts where the native one did.
    root.style.marginLeft = mode === 'hidden' ? '0px' : '6px';
  };
  const close = () => {
    hideTip();
    hideSub();
    if (panel.matches(':popover-open')) panel.hidePopover();
  };
  const isCurrent = () => findFooterLeft() === footer && trigger.isConnected &&
    footer.querySelector('button[data-testid="model-selector-trigger"]') === trigger;

  applyNativeMode(true);

  const picker = {
    trigger, id: state.conversationId,
    setConfig(nextKeep, nextHidden, nextHideTags = false, nextHideDefaultEffort = false) {
      currentKeepNative = nextKeep;
      currentHidden = Array.isArray(nextHidden) ? [...nextHidden] : [];
      currentHideTags = nextHideTags === true;
      currentHideDefaultEffort = nextHideDefaultEffort === true;
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
        setFormattedLabel(button, next.selected);
      }
      button.removeAttribute('title');
      button.setAttribute('aria-label', currentCaption + ': ' + next.selected);
      panel.setAttribute('aria-label', currentCaption);
      if (pending && next.selected === pending) {
        clearTimeout(expiry);
        pending = null;
        status.textContent = '';
        close();
      }
      const key = JSON.stringify([next.items || next.labels, next.selected, pending, currentHidden, currentHideTags, currentHideDefaultEffort]);
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
      for (const group of groups) {
        group.isMultiTier = !group.disabled && group.items.length >= 2 && group.items.every(item => item.tier !== null);
        group.familyName = group.isMultiTier ? group.name : group.items[0].label;
        if (group.isMultiTier) {
          group.items.sort((a, b) => (tierOrder[a.tier.toLowerCase()] ?? 99) - (tierOrder[b.tier.toLowerCase()] ?? 99));
        }
      }

      const hiddenSet = new Set(currentHidden);
      const filtered = groups.filter(group => !hiddenSet.has(group.familyName));
      const visibleGroups = filtered.length > 0 ? filtered : groups;

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
        const isActiveGroup = group.items.some(item => item.label === next.selected);
        const targetLabel = group.isMultiTier
          ? resolveInheritedLabel(group.items, next.selected)
          : group.items[0].label;
        row.dataset.label = targetLabel;
        row.dataset.family = group.familyName;
        row.setAttribute('aria-label', targetLabel);
        row.setAttribute('aria-pressed', String(isActiveGroup));
        if (group.isMultiTier) row.setAttribute('aria-haspopup', 'menu');
        row.disabled = pending !== null;

        const main = document.createElement('span');
        main.className = 'dk-model-main';
        const nameEl = document.createElement('span');
        nameEl.className = 'dk-mp-name';
        const singleMatch = !group.isMultiTier ? tierRe.exec(group.items[0].label) : null;
        if (group.isMultiTier) {
          nameEl.textContent = group.name;
        } else if (currentHideDefaultEffort && singleMatch) {
          nameEl.textContent = singleMatch[1].trim();
        } else {
          nameEl.textContent = group.items[0].label;
        }
        main.append(nameEl);

        if (group.isMultiTier) {
          const displayTier = group.items.find(item => item.label === targetLabel)?.tier || '';
          if (displayTier && !currentHideDefaultEffort) {
            const eff = document.createElement('span');
            eff.className = 'dk-mp-effort';
            eff.textContent = displayTier;
            main.append(eff);
          }
        }

        appendBadge(main, group);

        const end = document.createElement('span');
        end.className = 'dk-mp-end';
        if (isActiveGroup) end.innerHTML = SVG_CHECK;
        else if (group.isMultiTier) end.innerHTML = SVG_CHEV;
        row.append(main, end);
        options.append(row);
      }
    },
  };
  root._modelPicker = picker;

  const commitSelection = async label => {
    if (!label || pending || !isCurrent()) return;
    const current = read();
    if (!current || current.conversationId !== picker.id || !current.labels.includes(label)) {
      picker.dispose();
      return;
    }
    if (label === current.selected) { close(); return; }
    pending = label;
    status.textContent = '';
    picker.refresh(current, currentCaption, currentUnconfirmed);
    const fail = () => {
      if (root._modelPicker !== picker || pending !== label) return;
      pending = null;
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
    if (event.newState !== 'open') { hideTip(); hideSub(); return; }
    picker.sync();
    if (root._modelPicker !== picker) return;
    const rect = button.getBoundingClientRect();
    const estWidth = Math.min(264, innerWidth - 12);
    panel.style.left = Math.max(6, Math.min(rect.left, innerWidth - estWidth - 6)) + 'px';
    panel.style.bottom = Math.max(6, innerHeight - rect.top + 6) + 'px';
    panel.style.maxHeight = Math.max(48, rect.top - 12) + 'px';
  });
  panel.addEventListener('toggle', event => {
    if (event.newState !== 'open') { hideTip(); hideSub(); }
  });
  options.addEventListener('pointerover', event => {
    const info = event.target.closest('.dk-mp-info[data-tip]');
    if (info) showTipFor(info);
    else hideTip();
    const row = event.target.closest('button.dk-model-row');
    if (!row) return;
    const group = renderedGroups.get(row.dataset.family);
    if (group?.isMultiTier) showSubFor(row, group);
    else hideSub();
  });
  options.addEventListener('pointerout', event => {
    const info = event.target.closest('.dk-mp-info[data-tip]');
    if (info && !info.contains(event.relatedTarget)) hideTip();
  });
  options.addEventListener('focusin', event => {
    const row = event.target.closest('button.dk-model-row');
    if (!row) return;
    const group = renderedGroups.get(row.dataset.family);
    if (group?.isMultiTier) showSubFor(row, group);
    else hideSub();
  });
  options.addEventListener('pointerleave', () => {
    hideTip();
    scheduleHideSub();
  });
  sub.addEventListener('pointerenter', cancelHideSub);
  sub.addEventListener('pointerleave', scheduleHideSub);
  options.addEventListener('click', event => {
    const choice = event.target.closest('button[data-label]');
    if (choice) void commitSelection(choice.dataset.label);
  });
  sub.addEventListener('click', event => {
    const choice = event.target.closest('button[data-label]');
    if (choice) void commitSelection(choice.dataset.label);
  });

  picker.refresh(state, currentCaption, currentUnconfirmed);
}
