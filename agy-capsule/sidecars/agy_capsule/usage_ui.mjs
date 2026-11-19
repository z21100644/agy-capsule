// Usage history for the sidebar statistics. Self-contained so the page can embed it with
// toString(); the composer footer never loads it.
export function createUsagePresentation(formatTokens, escapeHtml) {
  const dictionaries = {
    en: {
      usageActivity: 'Token activity',
      usageScopeTip: "Adds up the model requests recorded in this computer's conversation files: uncached input, cache reads, cache writes and output. Deleted conversations are not counted, and this is not a bill. Days follow the local time zone; weeks start on Monday.",
      usageDaily: 'Daily', usageWeekly: 'Weekly',
      usageToday: 'Today', usageThisWeek: 'This week', usageThisMonth: 'This month', usageAllTime: 'All time',
      usageLess: 'Less', usageMore: 'More', usageRequests: '{n} request(s)', usageSince: 'Since {date}',
      usageLoading: 'Reading local conversations…', usageEmpty: 'No usage recorded yet.', usageUnread: '{n} conversation file(s) could not be read.',
      usageByModel: 'Usage by model', usageDay: 'Day', usageWeek: 'Week', usageMonth: 'Month', usageOlder: 'Earlier', usageNewer: 'Later',
      usageUnknownModel: 'Unknown model', usageOtherModels: 'Other models', usageNoneInRange: 'No usage in this period.',
      usageUncached: 'Uncached input', usageCacheRead: 'Cache read', usageCacheWrite: 'Cache write', usageOutput: 'Output',
    },
    'zh-CN': {
      usageActivity: 'Token 活动',
      usageScopeTip: '汇总本机对话文件里记录的模型请求：非缓存输入、缓存读取、缓存写入和输出。已删除的对话不计入，也不等于账单。按本机时区划分日期，每周从周一开始。',
      usageDaily: '每日', usageWeekly: '每周',
      usageToday: '今日', usageThisWeek: '本周', usageThisMonth: '本月', usageAllTime: '累计',
      usageLess: '少', usageMore: '多', usageRequests: '{n} 次请求', usageSince: '始于 {date}',
      usageLoading: '正在读取本机对话…', usageEmpty: '暂无用量记录。', usageUnread: '{n} 个对话文件未能读取。',
      usageByModel: '按模型统计', usageDay: '日', usageWeek: '周', usageMonth: '月', usageOlder: '更早', usageNewer: '更晚',
      usageUnknownModel: '未知模型', usageOtherModels: '其他模型', usageNoneInRange: '这段时间没有用量。',
      usageUncached: '非缓存输入', usageCacheRead: '缓存读取', usageCacheWrite: '缓存写入', usageOutput: '输出',
    },
    'zh-TW': {
      usageActivity: 'Token 活動',
      usageScopeTip: '彙總本機對話檔案裡記錄的模型請求：非快取輸入、快取讀取、快取寫入和輸出。已刪除的對話不計入，也不等於帳單。依本機時區劃分日期，每週從週一開始。',
      usageDaily: '每日', usageWeekly: '每週',
      usageToday: '今日', usageThisWeek: '本週', usageThisMonth: '本月', usageAllTime: '累計',
      usageLess: '少', usageMore: '多', usageRequests: '{n} 次請求', usageSince: '始於 {date}',
      usageLoading: '正在讀取本機對話…', usageEmpty: '尚無用量記錄。', usageUnread: '{n} 個對話檔案未能讀取。',
      usageByModel: '按模型統計', usageDay: '日', usageWeek: '週', usageMonth: '月', usageOlder: '更早', usageNewer: '更晚',
      usageUnknownModel: '未知模型', usageOtherModels: '其他模型', usageNoneInRange: '這段時間沒有用量。',
      usageUncached: '非快取輸入', usageCacheRead: '快取讀取', usageCacheWrite: '快取寫入', usageOutput: '輸出',
    },
  };
  const WEEKS = 53;
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
  const tokensOf = (bucket = {}) => (bucket.uncached || 0) + (bucket.cacheRead || 0) + (bucket.cacheWrite || 0) + (bucket.output || 0);
  const exact = value => Number(value || 0).toLocaleString('en-US');
  const requestsText = (count, t) => t.usageRequests.replace('{n}', exact(count));

  function usageTotals(data = {}, today = localDay()) {
    const week = weekStart(today);
    const month = today.slice(0, 7);
    const totals = { today: 0, week: 0, month: 0, all: tokensOf(data.undated), requests: data.undated?.requests || 0, since: '' };
    for (const day of data.days || []) {
      const tokens = tokensOf(day);
      totals.all += tokens;
      totals.requests += day.requests || 0;
      totals.since ||= day.date;
      if (day.date > today) continue;
      if (day.date === today) totals.today += tokens;
      if (day.date >= week) totals.week += tokens;
      if (day.date.slice(0, 7) === month) totals.month += tokens;
    }
    return totals;
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
        return { from: date, to: date, tokens: tokensOf(day), requests: day?.requests || 0, future: date > today };
      });
      const sum = key => days.reduce((total, day) => total + day[key], 0);
      const cells = scale === 'week' ? [{ from, to: addDays(from, 6), tokens: sum('tokens'), requests: sum('requests'), future: false }] : days;
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
    const total = (key, value) => `<div class="usage-total" title="${exact(value)} tokens"><span>${escapeHtml(t[key])}</span><b>${formatTokens(value)}</b></div>`;
    const span = item => (item.from === item.to ? item.from : `${item.from} – ${item.to}`);
    const cell = item => (item.future ? '<i class="usage-cell" data-future></i>'
      : `<i class="usage-cell" data-level="${item.level}" title="${escapeHtml(item.tokens ? `${span(item)} · ${exact(item.tokens)} tokens · ${requestsText(item.requests, t)}` : span(item))}"></i>`);
    const since = [totals.since && t.usageSince.replace('{date}', totals.since), requestsText(totals.requests, t)].filter(Boolean).join(' · ');
    return head
      + `<div class="usage-totals">${total('usageToday', totals.today)}${total('usageThisWeek', totals.week)}${total('usageThisMonth', totals.month)}${total('usageAllTime', totals.all)}</div>`
      + `<div class="usage-heat" data-scale="${view.scale}" role="img" aria-label="${escapeHtml(t.usageActivity)}">`
      + view.columns.map(column => `<div class="usage-heat-col">${column.month ? `<span class="usage-heat-month">${escapeHtml(monthName.format(toDate(column.month + '-01')))}</span>` : ''}${column.cells.map(cell).join('')}</div>`).join('')
      + '</div>'
      + `<div class="usage-foot"><span>${escapeHtml(since)}</span><span class="usage-legend">${escapeHtml(t.usageLess)}${[0, 1, 2, 3, 4].map(level => `<i class="usage-cell" data-level="${level}"></i>`).join('')}${escapeHtml(t.usageMore)}</span></div>`
      + unread;
  }

  const PALETTE = ['#388bfd', '#e86a24', '#00b386', '#d4940a', '#a371f7', '#e06c75'];
  const SPANS = { day: 14, week: 12, month: 12 };
  const addMonths = (month, count) => {
    const date = toDate(month + '-01');
    date.setUTCMonth(date.getUTCMonth() + count);
    return toDay(date).slice(0, 7);
  };
  // One page of bars, oldest first: 14 days, 12 weeks or 12 months, ending `shift` pages before today.
  function usagePeriods(today, period, shift) {
    const count = SPANS[period];
    if (period === 'month') {
      const last = addMonths(today.slice(0, 7), count * shift);
      return Array.from({ length: count }, (_, index) => {
        const month = addMonths(last, index - count + 1);
        return { from: month + '-01', to: addDays(addMonths(month, 1) + '-01', -1), name: month, label: String(Number(month.slice(5))) };
      });
    }
    const step = period === 'week' ? 7 : 1;
    const last = addDays(period === 'week' ? weekStart(today) : today, step * count * shift);
    return Array.from({ length: count }, (_, index) => {
      const from = addDays(last, step * (index - count + 1));
      const to = addDays(from, step - 1);
      return { from, to, name: from === to ? from : `${from} – ${to}`, label: period === 'week' ? `${Number(from.slice(5, 7))}/${Number(from.slice(8))}` : String(Number(from.slice(8))) };
    });
  }
  // Stacked bars for one page and the models behind them. A model's colour follows its all-time
  // rank, so it keeps that colour from page to page; models beyond the palette share the last slot.
  function modelView(data = {}, { today = localDay(), period = 'day', shift = 0 } = {}) {
    const days = data.days || [];
    const allTime = new Map();
    for (const day of days) for (const model of day.models || []) allTime.set(model.name, (allTime.get(model.name) || 0) + tokensOf(model));
    const ranked = [...allTime].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).map(([name]) => name);
    const series = [...PALETTE, 'rgba(142, 142, 147, 0.55)'].map((color, index) => ({ name: index < PALETTE.length ? ranked[index] : null, color, requests: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 }));
    const bars = usagePeriods(today, period, Math.min(0, shift)).map(span => ({ ...span, tokens: 0, requests: 0, parts: series.map(() => 0) }));
    for (const day of days) {
      const bar = bars.find(span => span.from <= day.date && day.date <= span.to);
      if (!bar) continue;
      for (const model of day.models || []) {
        const slot = Math.min(ranked.indexOf(model.name), PALETTE.length);
        const tokens = tokensOf(model);
        bar.parts[slot] += tokens;
        bar.tokens += tokens;
        bar.requests += model.requests || 0;
        for (const key of ['requests', 'uncached', 'cacheRead', 'cacheWrite', 'output']) series[slot][key] += model[key] || 0;
      }
    }
    const [first, last] = [bars[0], bars.at(-1)];
    const [start, end] = period === 'month' ? [first.name, last.name] : [first.from, last.to];
    return {
      bars, series,
      max: Math.max(...bars.map(bar => bar.tokens)),
      tokens: bars.reduce((sum, bar) => sum + bar.tokens, 0),
      requests: bars.reduce((sum, bar) => sum + bar.requests, 0),
      models: series.map(entry => ({ ...entry, tokens: tokensOf(entry) })).filter(entry => entry.tokens > 0).sort((a, b) => b.tokens - a.tokens),
      range: `${start} – ${end.slice(0, 4) === start.slice(0, 4) ? end.slice(5) : end}`,
      older: days.length > 0 && first.from > days[0].date,
      newer: shift < 0,
    };
  }
  function modelsHtml(data, { today = localDay(), period = 'day', shift = 0, language = 'en' } = {}) {
    const t = dictionaries[language] || dictionaries.en;
    const head = `<div class="usage-head"><span class="usage-title" title="${escapeHtml(t.usageScopeTip)}">${escapeHtml(t.usageByModel)}</span><span class="usage-seg" role="group">`
      + [['day', t.usageDay], ['week', t.usageWeek], ['month', t.usageMonth]].map(([value, label]) => `<button type="button" data-usage-period="${value}" aria-pressed="${value === period}">${escapeHtml(label)}</button>`).join('')
      + '</span></div>';
    const note = text => `<div class="usage-note">${escapeHtml(text)}</div>`;
    if (!data) return head + note(t.usageLoading);
    if (!(data.days || []).length) return head + note(t.usageEmpty);
    const view = modelView(data, { today, period, shift });
    const nameOf = entry => (entry.name === null ? t.usageOtherModels : entry.name || t.usageUnknownModel);
    const step = (delta, label, enabled) => `<button type="button" data-usage-shift="${delta}" aria-label="${escapeHtml(label)}"${enabled ? '' : ' disabled'}>${delta < 0 ? '‹' : '›'}</button>`;
    // Week labels are wider than a bar, so every other one is left out.
    const stride = period === 'week' ? 2 : 1;
    const bar = (item, index) => {
      const weight = view.max > 0 ? Math.round(item.tokens / view.max * 1000) : 0;
      const lines = item.tokens ? [`${item.name} · ${exact(item.tokens)} tokens · ${requestsText(item.requests, t)}`, ...item.parts.map((tokens, slot) => (tokens ? `${nameOf(view.series[slot])}: ${exact(tokens)}` : '')).filter(Boolean)] : [item.name];
      return `<div class="usage-bar" title="${escapeHtml(lines.join('\n'))}"><span style="flex:${1000 - weight} 0 0"></span>`
        + (item.tokens ? `<span class="usage-bar-stack" style="flex:${weight} 0 0">${item.parts.map((tokens, slot) => (tokens ? `<i style="flex:${Math.max(1, Math.round(tokens / item.tokens * 1000))} 0 0;background:${view.series[slot].color}"></i>` : '')).join('')}</span>` : '')
        + ((view.bars.length - 1 - index) % stride === 0 ? `<span class="usage-bar-x">${escapeHtml(item.label)}</span>` : '')
        + '</div>';
    };
    const row = entry => `<div class="usage-model" title="${escapeHtml(`${t.usageUncached} ${exact(entry.uncached)} · ${t.usageCacheRead} ${exact(entry.cacheRead)} · ${t.usageCacheWrite} ${exact(entry.cacheWrite)} · ${t.usageOutput} ${exact(entry.output)} · ${requestsText(entry.requests, t)}`)}">`
      + `<span class="usage-dot" style="background:${entry.color}"></span><span class="usage-model-name">${escapeHtml(nameOf(entry))}</span>`
      + `<span class="usage-model-share">${Math.round(entry.tokens / view.tokens * 100)}%</span><span class="usage-model-tokens">${formatTokens(entry.tokens)}</span></div>`;
    return head
      + `<div class="usage-nav">${step(-1, t.usageOlder, view.older)}<span class="usage-range">${escapeHtml(view.range)}</span>${step(1, t.usageNewer, view.newer)}`
      + `<span class="usage-nav-total" title="${exact(view.tokens)} tokens">${formatTokens(view.tokens)} · ${escapeHtml(requestsText(view.requests, t))}</span></div>`
      + `<div class="usage-bars" role="img" aria-label="${escapeHtml(t.usageByModel)}">${view.bars.map(bar).join('')}</div>`
      + (view.models.length ? `<div class="usage-models">${view.models.map(row).join('')}</div>` : note(t.usageNoneInRange));
  }
  return { dictionaries, localDay, usageTotals, activityView, activityHtml, modelView, modelsHtml };
}
