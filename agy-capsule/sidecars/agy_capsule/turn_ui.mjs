// Self-contained so it can be embedded in the shared renderer runtime.
export function createTurnPresentation(formatTokens) {
  const dictionaries = {
    en: {
      turnMetrics: 'Last turn', showTurnMetrics: 'Turn metrics', turnRequests: 'Requests', turnWrite: 'Write', turnThinking: 'Think', turnElapsed: 'Elapsed',
      turnLabel: 'Turn', turnReqsLabel: 'Reqs', turnReqsShort: 'Re',
      turnScopeTip: 'Totals for the current turn since your latest user message.',
      childTurnScopeTip: 'Totals for this subagent’s latest execution.',
      childTurnElapsedTip: 'Time since this execution started, including model waits and tool execution.',
      turnRequestsTip: 'Model requests sent in this turn (including retries).',
      turnWriteTip: 'Total reply and tool-call tokens generated in this turn.',
      turnThinkingTip: 'Total thinking tokens generated in this turn.',
      turnElapsedTip: 'Total elapsed time for this turn, including model waits and tool execution.',
      turnKnownTip: 'Recorded', turnMissingTip: 'Attempts missing usage',
    },
    'zh-CN': {
      turnMetrics: '本轮', showTurnMetrics: '本轮统计', turnRequests: '请求数', turnWrite: '写入', turnThinking: '思考', turnElapsed: '耗时',
      turnLabel: '本轮', turnReqsLabel: '请求', turnReqsShort: '请',
      turnScopeTip: '从最近一条用户消息开始，整轮对话的累计统计。',
      childTurnScopeTip: '该子 Agent 最近一次执行的累计统计。',
      childTurnElapsedTip: '从本次执行开始计时，包含模型等待与工具执行。',
      turnRequestsTip: '本轮发出的模型请求次数（含重试）。',
      turnWriteTip: '本轮所有请求累计生成的回复与工具调用 token。',
      turnThinkingTip: '本轮所有请求累计生成的思考 token。',
      turnElapsedTip: '从发出消息到本轮结束的总耗时（含模型等待与工具执行）。',
      turnKnownTip: '已记录', turnMissingTip: '缺少用量的尝试数',
    },
    'zh-TW': {
      turnMetrics: '本輪', showTurnMetrics: '本輪統計', turnRequests: '請求數', turnWrite: '寫入', turnThinking: '思考', turnElapsed: '耗時',
      turnLabel: '本輪', turnReqsLabel: '請求', turnReqsShort: '請',
      turnScopeTip: '從最近一條使用者訊息開始，整輪對話的累計統計。',
      childTurnScopeTip: '此子 Agent 最近一次執行的累計統計。',
      childTurnElapsedTip: '從本次執行開始計時，包含模型等待與工具執行。',
      turnRequestsTip: '本輪發出的模型請求次數（含重試）。',
      turnWriteTip: '本輪所有請求累計產生的回覆與工具呼叫 token。',
      turnThinkingTip: '本輪所有請求累計產生的思考 token。',
      turnElapsedTip: '從發出訊息到本輪結束的總耗時（含模型等待與工具執行）。',
      turnKnownTip: '已記錄', turnMissingTip: '缺少用量的嘗試數',
    },
  };
  function turnMetricsMarkup(className = 'generation-block') {
    const col = (key, label) => `<div class="turn-bar-item" data-turn-row="${key}"><span class="turn-bar-line" aria-hidden="true"></span><span class="turn-bar-label" data-i18n="${label}"></span>${key === 'requests' ? '<span class="turn-bar-short" data-i18n="turnReqsShort" aria-hidden="true">Re</span>' : ''}<span class="turn-bar-val" data-turn-metric="${key}">—</span></div>`;
    return `<div class="${className}" data-turn-metrics-block hidden><div class="turn-bar-list">${col('elapsed', 'turnLabel')}${col('requests', 'turnReqsLabel')}${col('thinking', 'turnThinking')}${col('write', 'turnWrite')}</div></div>`;
  }
  function turnMetricsText(data = {}, t = dictionaries.en, nowMs = Date.now()) {
    let rawElapsed = data.duration;
    if ((['running', 'queued'].includes(data.state) || (!data.executionId && data.state === 'unknown')) && data.startedAtMs > 0) rawElapsed = nowMs >= data.startedAtMs ? (nowMs - data.startedAtMs) / 1000 : null;
    const durationText = value => {
      if (!Number.isFinite(value) || value < 0) return '—';
      const seconds = Math.floor(value);
      if (seconds < 60) return seconds + 's';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 10) return seconds % 60 ? `${minutes}m${seconds % 60}s` : `${minutes}m`;
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      const remMin = minutes % 60;
      return hours < 10 && remMin ? `${hours}h${remMin}m` : `${hours}h`;
    };
    const elapsed = durationText(rawElapsed);
    const reqCount = Number.isFinite(data.requestCount) ? data.requestCount : null;
    const partial = key => data[key] === null ? `\n${t.turnKnownTip}: ${formatTokens(data.knownTotals?.[key])}\n${t.turnMissingTip}: ${data.missingUsageRequests || 0}` : '';
    const requestsTitle = `${t.turnRequestsTip}\n${t.turnKnownTip}: ${data.knownRequestCount ?? 0}`;
    return {
      heading: t.turnMetrics,
      requests: reqCount == null ? '—' : String(reqCount),
      write: formatTokens(data.write), thinking: formatTokens(data.thinking), elapsed,
      requestsTitle,
      writeTitle: t.turnWriteTip + partial('write'), thinkingTitle: t.turnThinkingTip + partial('thinking'),
      elapsedTitle: data.executionId ? `${t.childTurnScopeTip}\n${t.childTurnElapsedTip}` : `${t.turnScopeTip}\n${t.turnElapsedTip}`,
    };
  }
  function renderTurnMetrics(root, data, labels, prefs = {}, nowMs = Date.now()) {
    const view = turnMetricsText(data || {}, labels, nowMs);
    for (const block of root.querySelectorAll('[data-turn-metrics-block]')) {
      block.hidden = prefs.showTurnMetrics === false || !data;
      for (const node of block.querySelectorAll('[data-turn-metric]')) node.textContent = view[node.dataset.turnMetric];
      for (const row of block.querySelectorAll('[data-turn-row]')) row.title = view[row.dataset.turnRow + 'Title'];
    }
    return view;
  }
  return { dictionaries, turnMetricsMarkup, turnMetricsText, renderTurnMetrics };
}
