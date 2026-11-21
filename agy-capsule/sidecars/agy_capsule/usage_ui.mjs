// Sidebar usage history: token activity summary and heatmap.
// Kept self-contained so the sidebar script can embed it directly beside presentation helpers.
export function createUsagePresentation(formatTokens, escapeHtml) {
  const dictionaries = {
    en: {
      usageActivity: 'Token activity',
      usageScopeTip: 'Local conversations in this product folder: uncached input, cache reads, cache writes and output. Totals include cache reads (no direct conversion to quota), exclude deleted chats and are not a bill. Days follow local time; weeks start Monday.',
      usageDaily: 'Daily', usageWeekly: 'Weekly',
      usageToday: 'Today', usageThisWeek: 'This week', usageThisMonth: 'This month', usageAllTime: 'All time',
      usageAllTimeNote: 'Current local conversations only (deleted chats are excluded).',
      usageUncached: 'Uncached', usageCacheRead: 'Cache read', usageCacheWrite: 'Cache write', usageOutput: 'Output',
      usageLess: 'Less', usageMore: 'More', usageRequests: '{n} request(s)', usageSince: 'Since {date}',
      usageLoading: 'Reading local conversations…', usageEmpty: 'No usage recorded yet.', usageUnread: '{n} conversation file(s) could not be read.',
      usageByModel: 'Usage by model', usageDay: 'Day', usageWeek: 'Week', usageMonth: 'Month', usageOlder: 'Older', usageNewer: 'Newer',
      usageUnknownModel: 'Unknown model', usageOtherModels: 'Other models', usageDefaultTier: 'Default', usageNoneInRange: 'No usage in this period.',
    },
    'zh-CN': {
      usageActivity: 'Token 活动',
      usageScopeTip: '汇总当前产品目录的本机对话：非缓存输入、缓存读取、缓存写入和输出。合计包含缓存读取（与额度消耗无直接换算），不含已删对话，不等于账单。按本机时区划分日期，每周从周一开始。',
      usageDaily: '每日', usageWeekly: '每周',
      usageToday: '今日', usageThisWeek: '本周', usageThisMonth: '本月', usageAllTime: '累计',
      usageAllTimeNote: '仅统计现存本机对话（删除对话后数字会相应减少）。',
      usageUncached: '非缓存输入', usageCacheRead: '缓存读取', usageCacheWrite: '缓存写入', usageOutput: '输出',
      usageLess: '少', usageMore: '多', usageRequests: '{n} 次请求', usageSince: '始于 {date}',
      usageLoading: '正在读取本机对话…', usageEmpty: '暂无用量记录。', usageUnread: '{n} 个对话文件未能读取。',
      usageByModel: '按模型统计', usageDay: '日', usageWeek: '周', usageMonth: '月', usageOlder: '更早', usageNewer: '更晚',
      usageUnknownModel: '未知模型', usageOtherModels: '其他模型', usageDefaultTier: '默认', usageNoneInRange: '这段时间没有用量。',
    },
    'zh-TW': {
      usageActivity: 'Token 活動',
      usageScopeTip: '彙總目前產品目錄的本機對話：非快取輸入、快取讀取、快取寫入和輸出。合計包含快取讀取（與額度消耗無直接換算），不含已刪對話，不等於帳單。依本機時區劃分日期，每週從週一開始。',
      usageDaily: '每日', usageWeekly: '每週',
      usageToday: '今日', usageThisWeek: '本週', usageThisMonth: '本月', usageAllTime: '累計',
      usageAllTimeNote: '僅統計現存本機對話（刪除對話後數字會相應減少）。',
      usageUncached: '非快取輸入', usageCacheRead: '快取讀取', usageCacheWrite: '快取寫入', usageOutput: '輸出',
      usageLess: '少', usageMore: '多', usageRequests: '{n} 次請求', usageSince: '始於 {date}',
      usageLoading: '正在讀取本機對話…', usageEmpty: '尚無用量記錄。', usageUnread: '{n} 個對話檔案未能讀取。',
      usageByModel: '按模型統計', usageDay: '日', usageWeek: '週', usageMonth: '月', usageOlder: '更早', usageNewer: '更晚',
      usageUnknownModel: '未知模型', usageOtherModels: '其他模型', usageDefaultTier: '預設', usageNoneInRange: '這段時間沒有用量。',
    },
  };
  const WEEKS = 53;
  const COUNTERS = ['uncached', 'cacheRead', 'cacheWrite', 'output'];
  const pad = value => String(value).padStart(2, '0');
  // Calendar days are moved around as UTC dates, so a daylight-saving change never shifts one.
  const toDate = day => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))));
  const toDay = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const addDays = (day, count) => {
    const date = toDate(day);
    date.setUTCDate(date.getUTCDate() + count);
    return toDay(date);
  };
  const weekStart = day => addDays(day, -((toDate(day).getUTCDay() + 6) % 7)); // weeks start on Monday
  function localDay(epochMs = Date.now()) {
    const date = new Date(epochMs);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  const emptyParts = () => ({ requests: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
  const addParts = (target, source = {}) => {
    target.requests += source.requests || 0;
    for (const key of COUNTERS) target[key] += source[key] || 0;
  };
  const tokensOf = (bucket = {}) => (bucket.uncached || 0) + (bucket.cacheRead || 0) + (bucket.cacheWrite || 0) + (bucket.output || 0);
  const exact = value => Number(value || 0).toLocaleString('en-US');
  const requestsText = (count, t) => t.usageRequests.replace('{n}', exact(count));
  const breakdownLine = (bucket, t) => `${t.usageUncached} ${exact(bucket.uncached)} · ${t.usageCacheRead} ${exact(bucket.cacheRead)} · ${t.usageCacheWrite} ${exact(bucket.cacheWrite)} · ${t.usageOutput} ${exact(bucket.output)}`;

  function usageTotals(data = {}, today = localDay()) {
    const week = weekStart(today);
    const month = today.slice(0, 7);
    const parts = { today: emptyParts(), week: emptyParts(), month: emptyParts(), all: emptyParts() };
    if (data.undated) addParts(parts.all, data.undated);
    let since = '';
    for (const day of data.days || []) {
      addParts(parts.all, day);
      since ||= day.date;
      if (day.date > today) continue;
      if (day.date === today) addParts(parts.today, day);
      if (day.date >= week) addParts(parts.week, day);
      if (day.date.slice(0, 7) === month) addParts(parts.month, day);
    }
    return {
      today: tokensOf(parts.today),
      week: tokensOf(parts.week),
      month: tokensOf(parts.month),
      all: tokensOf(parts.all),
      requests: parts.all.requests,
      since,
      parts,
    };
  }
  // Four steps on a square-root scale, so that one heavy day does not flatten all the others.
  const heatLevel = (tokens, max) => (tokens > 0 && max > 0 ? Math.max(1, Math.ceil(Math.sqrt(tokens / max) * 4)) : 0);
  // The last weeks as columns, oldest first; the weekly view has one cell per column.
  function activityView(data = {}, { today = localDay(), scale = 'day', weeks = WEEKS } = {}) {
    const byDate = new Map((data.days || []).map(day => [day.date, day]));
    const first = addDays(weekStart(today), -7 * (weeks - 1));
    const columns = [];
    let max = 0;
    for (let week = 0; week < weeks; week++) {
      const from = addDays(first, week * 7);
      const days = Array.from({ length: 7 }, (_, offset) => {
        const date = addDays(from, offset);
        const day = byDate.get(date);
        return {
          from: date, to: date,
          tokens: tokensOf(day),
          requests: day?.requests || 0,
          uncached: day?.uncached || 0,
          cacheRead: day?.cacheRead || 0,
          cacheWrite: day?.cacheWrite || 0,
          output: day?.output || 0,
          future: date > today,
        };
      });
      const sum = key => days.reduce((total, day) => total + day[key], 0);
      const cells = scale === 'week'
        ? [{
          from, to: addDays(from, 6),
          tokens: sum('tokens'), requests: sum('requests'),
          uncached: sum('uncached'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), output: sum('output'),
          future: false,
        }]
        : days;
      for (const cell of cells) max = Math.max(max, cell.tokens);
      // A column is labelled with a month when its week is the first to start in it.
      columns.push({ month: week > 0 && from.slice(0, 7) !== addDays(from, -7).slice(0, 7) ? from.slice(0, 7) : '', cells });
    }
    for (const column of columns) for (const cell of column.cells) cell.level = heatLevel(cell.tokens, max);
    return { scale: scale === 'week' ? 'week' : 'day', columns };
  }
  function activityHtml(data, { today = localDay(), scale = 'day', language = 'en' } = {}) {
    const t = dictionaries[language] || dictionaries.en;
    const head = `<div class="usage-head"><span class="usage-title" title="${escapeHtml(t.usageScopeTip)}">${escapeHtml(t.usageActivity)}</span><span class="usage-seg" role="group">`
      + [['day', t.usageDaily], ['week', t.usageWeekly]].map(([value, label]) => `<button type="button" data-usage-scale="${value}" aria-pressed="${value === scale}">${escapeHtml(label)}</button>`).join('')
      + '</span></div>';
    if (!data) return head + `<div class="usage-note">${escapeHtml(t.usageLoading)}</div>`;
    // Totals are incomplete while a conversation could not be read; say so instead of hiding it.
    const unread = data.unread > 0 ? `<div class="usage-note">${escapeHtml(t.usageUnread.replace('{n}', exact(data.unread)))}</div>` : '';
    const totals = usageTotals(data, today);
    if (!totals.requests) return head + `<div class="usage-note">${escapeHtml(t.usageEmpty)}</div>` + unread;
    const view = activityView(data, { today, scale });
    const monthName = new Intl.DateTimeFormat(language, { month: 'short', timeZone: 'UTC' });
    const totalTip = (value, part, extra = '') => {
      const lines = value > 0
        ? [`${exact(value)} tokens · ${requestsText(part.requests, t)}`, breakdownLine(part, t)]
        : ['0 tokens'];
      if (extra) lines.push(extra);
      return lines.join('\n');
    };
    const total = (key, value, part, extra = '') => `<div class="usage-total" title="${escapeHtml(totalTip(value, part, extra))}"><span>${escapeHtml(t[key])}</span><b>${formatTokens(value)}</b></div>`;
    const span = item => (item.from === item.to ? item.from : `${item.from} – ${item.to}`);
    const cellTip = item => (item.tokens
      ? `${span(item)} · ${exact(item.tokens)} tokens · ${requestsText(item.requests, t)}\n${breakdownLine(item, t)}`
      : span(item));
    const cell = item => (item.future ? '<i class="usage-cell" data-future></i>'
      : `<i class="usage-cell" data-level="${item.level}" title="${escapeHtml(cellTip(item))}"></i>`);
    const since = [totals.since && t.usageSince.replace('{date}', totals.since), requestsText(totals.requests, t)].filter(Boolean).join(' · ');
    return head
      + `<div class="usage-totals">${total('usageToday', totals.today, totals.parts.today)}${total('usageThisWeek', totals.week, totals.parts.week)}${total('usageThisMonth', totals.month, totals.parts.month)}${total('usageAllTime', totals.all, totals.parts.all, t.usageAllTimeNote)}</div>`
      + `<div class="usage-heat" data-scale="${view.scale}" role="img" aria-label="${escapeHtml(t.usageActivity)}">`
      + view.columns.map(column => `<div class="usage-heat-col">${column.month ? `<span class="usage-heat-month">${escapeHtml(monthName.format(toDate(column.month + '-01')))}</span>` : ''}${column.cells.map(cell).join('')}</div>`).join('')
      + '</div>'
      + `<div class="usage-foot"><span>${escapeHtml(since)}</span><span class="usage-legend">${escapeHtml(t.usageLess)}${[0, 1, 2, 3, 4].map(level => `<i class="usage-cell" data-level="${level}"></i>`).join('')}${escapeHtml(t.usageMore)}</span></div>`
      + unread;
  }

  const PALETTE = ['#388bfd', '#e86a24', '#00b386', '#d4940a', '#a371f7', '#e06c75'];
  const SPANS = { day: 14, week: 12, month: 12 };
  const TIER_LABEL = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', extra: 'Extra', max: 'Max', thinking: 'Thinking' };
  const PAREN_TIER_RE = /^(.*?)\s*\((?:thinking[\s,/-]+)?(off|minimal|low|medium|high|xhigh|extra|max)(?:\s+thinking)?\)$/i;
  const PAREN_THINK_RE = /^(.*?)\s*\((thinking)\)$/i;
  const SLUG_TIER_RE = /^([^\s()]+?)(?:-thinking)?-(off|minimal|low|medium|high|xhigh|extra|max)(?:-thinking)?$/i;
  const SLUG_THINK_RE = /^([^\s()]+)-(thinking)$/i;

  // Groups effort variants under their model family while keeping the tier for hover details.
  // Also strips trailing effort tiers from fallback response_model slugs and aligns their key
  // with display names when both appear in the history.
  function splitModelName(raw) {
    const trimmed = String(raw || '').trim().replace(/^models\//i, '').trim();
    if (!trimmed) return { key: '', family: '', tier: '', isDisplay: false };
    let family = trimmed;
    let tier = '';
    let match = PAREN_TIER_RE.exec(trimmed) || PAREN_THINK_RE.exec(trimmed);
    if (match && match[1].trim()) {
      family = match[1].trim();
      tier = TIER_LABEL[match[2].toLowerCase()] || match[2];
    } else if (!/\s/.test(trimmed)) {
      match = SLUG_TIER_RE.exec(trimmed) || SLUG_THINK_RE.exec(trimmed);
      if (match && match[1].length >= 2) {
        family = match[1];
        tier = TIER_LABEL[match[2].toLowerCase()] || match[2];
      }
    }
    const key = family.toLowerCase().replace(/[\s._-]+/g, '-');
    const isDisplay = /\s|[A-Z]/.test(family);
    return { key, family, tier, isDisplay };
  }

  const addMonths = (month, count) => {
    const date = toDate(month + '-01');
    date.setUTCMonth(date.getUTCMonth() + count);
    return toDay(date).slice(0, 7);
  };
  // One page of bars, oldest first: 14 days, 12 weeks or 12 months, ending `shift` pages before today.
  function usagePeriods(today, period, shift) {
    const unit = SPANS[period] ? period : 'day';
    const count = SPANS[unit];
    if (unit === 'month') {
      const last = addMonths(today.slice(0, 7), count * shift);
      return Array.from({ length: count }, (_, index) => {
        const month = addMonths(last, index - count + 1);
        return { from: month + '-01', to: addDays(addMonths(month, 1) + '-01', -1), name: month, label: String(Number(month.slice(5))) };
      });
    }
    const step = unit === 'week' ? 7 : 1;
    const last = addDays(unit === 'week' ? weekStart(today) : today, step * count * shift);
    return Array.from({ length: count }, (_, index) => {
      const from = addDays(last, step * (index - count + 1));
      const to = addDays(from, step - 1);
      return { from, to, name: from === to ? from : `${from} – ${to}`, label: unit === 'week' ? `${Number(from.slice(5, 7))}/${Number(from.slice(8))}` : String(Number(from.slice(8))) };
    });
  }
  // Stacked bars for one page and the model families behind them. A family's colour follows its
  // all-time rank so it stays the same from page to page; families beyond the palette share the
  // last slot, while effort tiers stay available for hover details.
  function modelView(data = {}, { today = localDay(), period = 'day', shift = 0 } = {}) {
    const unit = SPANS[period] ? period : 'day';
    const days = (data.days || []).filter(day => !(day.date > today));
    const allTime = new Map();
    const familyLabel = new Map();
    for (const day of days) {
      for (const model of day.models || []) {
        const parsed = splitModelName(model.name);
        allTime.set(parsed.key, (allTime.get(parsed.key) || 0) + tokensOf(model));
        const existing = familyLabel.get(parsed.key);
        if (!existing || (parsed.isDisplay && !existing.isDisplay) || (parsed.isDisplay === existing.isDisplay && parsed.family < existing.family)) {
          familyLabel.set(parsed.key, { name: parsed.family, isDisplay: parsed.isDisplay });
        }
      }
    }
    const ranked = [...allTime].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).map(([key]) => key);
    const slotOf = new Map(ranked.map((key, index) => [key, Math.min(index, PALETTE.length)]));
    const series = [...PALETTE, 'rgba(142, 142, 147, 0.55)'].map((color, index) => {
      const key = index < PALETTE.length ? ranked[index] : null;
      return {
        key,
        name: key === null ? null : (key === undefined ? undefined : familyLabel.get(key)?.name ?? ''),
        color,
        ...emptyParts(),
        tiersMap: new Map(),
        familiesMap: new Map(),
      };
    });
    const bars = usagePeriods(today, unit, Math.min(0, shift)).map(span => ({ ...span, tokens: 0, requests: 0, parts: series.map(() => 0) }));
    const pageParts = emptyParts();
    for (const day of days) {
      const bar = bars.find(span => span.from <= day.date && day.date <= span.to);
      if (!bar) continue;
      for (const model of day.models || []) {
        const parsed = splitModelName(model.name);
        const slot = slotOf.get(parsed.key);
        const tokens = tokensOf(model);
        bar.parts[slot] += tokens;
        bar.tokens += tokens;
        bar.requests += model.requests || 0;
        addParts(pageParts, model);
        const entry = series[slot];
        addParts(entry, model);
        if (slot < PALETTE.length) {
          const tierBucket = entry.tiersMap.get(parsed.tier) ?? entry.tiersMap.set(parsed.tier, emptyParts()).get(parsed.tier);
          addParts(tierBucket, model);
        } else {
          const famName = familyLabel.get(parsed.key)?.name ?? '';
          const famBucket = entry.familiesMap.get(parsed.key) ?? entry.familiesMap.set(parsed.key, { name: famName, ...emptyParts() }).get(parsed.key);
          addParts(famBucket, model);
        }
      }
    }
    const finalize = entry => {
      const tiers = [...entry.tiersMap.entries()]
        .map(([tier, bucket]) => ({ tier, tokens: tokensOf(bucket), ...bucket }))
        .filter(item => item.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens || (a.tier < b.tier ? -1 : a.tier > b.tier ? 1 : 0));
      const families = [...entry.familiesMap.values()]
        .map(bucket => ({ ...bucket, tokens: tokensOf(bucket) }))
        .filter(item => item.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return {
        key: entry.key, name: entry.name, color: entry.color,
        requests: entry.requests, uncached: entry.uncached, cacheRead: entry.cacheRead, cacheWrite: entry.cacheWrite, output: entry.output,
        tokens: tokensOf(entry),
        tiers,
        families,
      };
    };
    const [first, last] = [bars[0], bars.at(-1)];
    const [start, end] = unit === 'month' ? [first.name, last.name] : [first.from, last.to];
    const finalized = series.map(finalize);
    return {
      bars,
      series: finalized,
      max: Math.max(...bars.map(bar => bar.tokens)),
      tokens: tokensOf(pageParts),
      requests: pageParts.requests,
      parts: pageParts,
      models: finalized
        .filter(entry => entry.tokens > 0)
        .sort((a, b) => (a.name === null) - (b.name === null) || b.tokens - a.tokens),
      range: `${start} – ${end.slice(0, 4) === start.slice(0, 4) ? end.slice(5) : end}`,
      older: days.length > 0 && first.from > days[0].date,
      newer: shift < 0,
    };
  }
  function modelsHtml(data, { today = localDay(), period = 'day', shift = 0, language = 'en', showUnread = true } = {}) {
    const unit = SPANS[period] ? period : 'day';
    const t = dictionaries[language] || dictionaries.en;
    const head = `<div class="usage-head"><span class="usage-title" title="${escapeHtml(t.usageScopeTip)}">${escapeHtml(t.usageByModel)}</span><span class="usage-seg" role="group">`
      + [['day', t.usageDay], ['week', t.usageWeek], ['month', t.usageMonth]].map(([value, label]) => `<button type="button" data-usage-period="${value}" aria-pressed="${value === unit}">${escapeHtml(label)}</button>`).join('')
      + '</span></div>';
    const note = text => `<div class="usage-note">${escapeHtml(text)}</div>`;
    if (!data) return head + note(t.usageLoading);
    const unread = showUnread && data.unread > 0 ? note(t.usageUnread.replace('{n}', exact(data.unread))) : '';
    if (!(data.days || []).length) return head + note(t.usageEmpty) + unread;
    const view = modelView(data, { today, period: unit, shift });
    const nameOf = entry => (entry.name === null ? t.usageOtherModels : entry.name || t.usageUnknownModel);
    const step = (delta, label, enabled) => `<button type="button" data-usage-shift="${delta}" aria-label="${escapeHtml(label)}"${enabled ? '' : ' disabled'}>${delta < 0 ? '‹' : '›'}</button>`;
    // Week labels are wider than a bar, so every other one is left out.
    const stride = unit === 'week' ? 2 : 1;
    const bar = (item, index) => {
      const weight = view.max > 0 ? Math.round(item.tokens / view.max * 1000) : 0;
      const lines = item.tokens ? [`${item.name} · ${exact(item.tokens)} tokens · ${requestsText(item.requests, t)}`, ...item.parts.map((tokens, slot) => (tokens ? `${nameOf(view.series[slot])}: ${exact(tokens)}` : '')).filter(Boolean)] : [item.name];
      return `<div class="usage-bar" title="${escapeHtml(lines.join('\n'))}"><span style="flex:${1000 - weight} 0 0"></span>`
        + (item.tokens ? `<span class="usage-bar-stack" style="flex:${weight} 0 0">${item.parts.map((tokens, slot) => (tokens ? `<i style="flex:${Math.max(1, Math.round(tokens / item.tokens * 1000))} 0 0;background:${view.series[slot].color}"></i>` : '')).join('')}</span>` : '')
        + ((view.bars.length - 1 - index) % stride === 0 ? `<span class="usage-bar-x">${escapeHtml(item.label)}</span>` : '')
        + '</div>';
    };
    const rowTip = entry => {
      const lines = [`${breakdownLine(entry, t)} · ${requestsText(entry.requests, t)}`];
      if (entry.name === null && entry.families.length) {
        for (const fam of entry.families) {
          const pct = Math.round(fam.tokens / entry.tokens * 100);
          lines.push(`${fam.name || t.usageUnknownModel}: ${exact(fam.tokens)} (${pct}%) · ${requestsText(fam.requests, t)}`);
        }
      } else if (entry.tiers.some(item => item.tier)) {
        for (const item of entry.tiers) {
          const pct = Math.round(item.tokens / entry.tokens * 100);
          lines.push(`${item.tier || t.usageDefaultTier}: ${exact(item.tokens)} (${pct}%) · ${requestsText(item.requests, t)}`);
        }
      }
      return lines.join('\n');
    };
    const row = entry => `<div class="usage-model" title="${escapeHtml(rowTip(entry))}">`
      + `<span class="usage-dot" style="background:${entry.color}"></span><span class="usage-model-name">${escapeHtml(nameOf(entry))}</span>`
      + `<span class="usage-model-share">${Math.round(entry.tokens / view.tokens * 100)}%</span><span class="usage-model-tokens">${formatTokens(entry.tokens)}</span></div>`;
    const totalTip = view.tokens > 0
      ? `${exact(view.tokens)} tokens · ${requestsText(view.requests, t)}\n${breakdownLine(view.parts, t)}`
      : '0 tokens';
    return head
      + `<div class="usage-nav">${step(-1, t.usageOlder, view.older)}<span class="usage-range" title="${escapeHtml(view.range)}">${escapeHtml(view.range)}</span>${step(1, t.usageNewer, view.newer)}`
      + `<span class="usage-nav-total" title="${escapeHtml(totalTip)}">${formatTokens(view.tokens)} · ${escapeHtml(requestsText(view.requests, t))}</span></div>`
      + `<div class="usage-bars" role="img" aria-label="${escapeHtml(t.usageByModel)}">${view.bars.map(bar).join('')}</div>`
      + (view.models.length ? `<div class="usage-models">${view.models.map(row).join('')}</div>` : note(t.usageNoneInRange))
      + unread;
  }
  return { dictionaries, localDay, usageTotals, activityView, activityHtml, splitModelName, modelView, modelsHtml };
}
