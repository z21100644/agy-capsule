// Shared presentation only. Token counts and breakdown arithmetic stay unchanged.
import { createTurnPresentation } from './turn_ui.mjs';

export function createPresentation(turnFactory = createTurnPresentation) {
  const dictionaries = {
    en: {
      cache: 'Cache', turn0: 'Turn0', read: 'Read', think: 'Think', write: 'Write',
      used: 'used', fiveHours: '5 Hours', weekly: 'Weekly', soon: 'soon', active: 'Active',
      settings: 'Display settings', language: "Display language",
      cdpTitle: 'Footer capsule is off',
      cdpBody: "agy-capsule can't reach Antigravity's debugging port, so it can't show the capsule under the input box. Newer Antigravity versions don't open this port by default. Sidebar stats still work.",
      cdpHow: 'How to enable', cdpScript: 'One step (Windows): in the folder you downloaded agy-capsule to, run', cdpManual: 'Or by hand: add this to the end of the Target field of your Antigravity shortcut', cdpRestart: 'Then quit Antigravity completely and open it again.',
      cdpRestartTitle: "Footer capsule didn't load this launch (no plugin update needed)",
      cdpRestartBodyShortcutOk: "Your shortcut still has the debugging switch. Antigravity's auto-update restarts without using your shortcut — just quit Antigravity completely and reopen it from your shortcut. No agy-capsule update needed.",
      cdpRestartBodyShortcutMissing: "Antigravity's update likely recreated your shortcut and cleared the debugging switch (no agy-capsule update needed). Restore the switch below, then quit Antigravity completely and reopen it from your shortcut.",
      cdpRestartBodyGeneric: "The footer capsule worked here before, so you don't need to update agy-capsule. Antigravity's auto-update restarts without your shortcut — quit Antigravity completely and reopen it from your shortcut or launcher icon.",
      cdpRestartHow: 'Troubleshooting & manual setup',
      cdpFixShortcutBtn: 'Restore shortcut switch', cdpFixShortcutBusy: 'Restoring…',
      cdpFixShortcutDone: 'Shortcut restored. Quit Antigravity completely and reopen it from your shortcut.',
      cdpFixShortcutAdmin: 'Some all-users shortcuts need administrator permission. Run the script below in an elevated PowerShell.',
      cdpNotifyTitle: 'agy-capsule: No plugin update needed',
      cdpNotifyBodyOk: 'Antigravity restarted without your shortcut (e.g. after a client update). Quit Antigravity completely and reopen from your shortcut to restore the footer capsule.',
      cdpNotifyBodyMissing: 'An Antigravity update cleared your shortcut switch (no plugin update needed). Open the agy-capsule sidebar to restore it in one click, then restart from your shortcut.',
      notifyCdpRestart: 'Restart recovery notice',
      cdpRestartPreview: 'Notify once if a client update restart skips the shortcut',
      sidebarStats: 'Statistics', sidebarSettings: 'Settings', sidebarNavigation: 'Sidebar view',
      settingsLanguage: 'Settings language', highlightActiveModel: 'Highlight active model',
      hideUnavailableQuota: 'Hide absent quota windows',
      showQuotaDividers: 'Quota group dividers',
      showCacheWarnings: 'Cache expiry alert',
      cacheWarnMin: 'Yellow alert (min)', cacheColdMin: 'Red alert (min)',
      showContextWarnings: 'Context overload alert', showRequestErrors: 'Request failure capsule',
      showQueueWarnings: 'Server queue alert', queueWarnSec: 'Queue alert threshold (s)',
      queueShort: 'Queue', queueHeading: 'Server queue',
      queueDetail: '{count} request(s) in this turn waited over {sec}s for the first token; it may be queued on the server.',
      queueLiveNow: 'Current wait: {sec}s.',
      queueDiagnostic: 'Slow waits this turn: {list} (threshold {sec}s)',
      highContextTip: 'Context usage is high. Consider compacting or starting a new chat.',
      overflowContextTip: 'Latest request exceeded the model context limit.',
      requestFailure: 'Request failure', retryAfter: 'Server-reported retry wait:',
      error_quota_exhausted: 'Quota exhausted', error_rate_limited: 'Rate limited', error_network_error: 'Disconnected', error_auth_error: 'Authentication error', error_service_unavailable: 'Service busy', error_unknown: 'Unknown reason',
      detail_quota_exhausted: 'The request reported quota exhaustion. Switch to an available model or wait for its quota reset.',
      detail_rate_limited: 'The request was rate limited. Wait and retry.',
      detail_network_error: 'The request connection failed or timed out. Check the connection and retry.',
      detail_auth_error: 'The request failed authentication or permission checks. Check sign-in and account access.',
      detail_service_unavailable: 'The model service is temporarily unavailable. Retry later or switch models.',
      detail_unknown: 'The model request failed, but the reported information does not identify a known cause.',
      showSpeed: 'Generation speed', showRequestMetrics: 'Last request', showUsageActivity: 'Token activity',
      speedAnimation: 'Effects',
      saveFailed: 'Could not save. Please try again.',
      panelAuthFailed: 'This panel is not authorized and cannot display statistics. Close it and reopen agy-capsule from Antigravity. (S1)',
      healthCode: 'Code', healthSidebarTitle: 'Sidebar statistics unavailable', healthStatsTitle: 'Check sidebar statistics', healthFooterTitle: 'Footer capsule paused',
      healthS2: 'The plugin backend is not responding. The figures below may be out of date. Close and reopen the sidebar. If that does not help, quit Antigravity completely and restart it.',
      healthS3: 'The conversation data folder could not be found. Sidebar statistics are unavailable. Antigravity may have changed where it stores conversations. Update agy-capsule to the latest version; if this still appears, ask your AI assistant to open a GitHub issue at Lumidarin/agy-capsule with code S3.',
      healthS4: 'Conversation data could not be read. Sidebar statistics may be inaccurate. Quit Antigravity completely and restart it.',
      healthS5: 'The agy-capsule sidebar could not start because Antigravity did not supply authorization. Update both Antigravity and agy-capsule. If it still fails, ask your AI assistant to open a GitHub issue at Lumidarin/agy-capsule with code S5.',
      healthF2: 'The plugin could not verify that this window belongs to Antigravity, so it did not attach the footer. Antigravity may have changed its internals. Update agy-capsule to the latest version; if this still appears, ask your AI assistant to open a GitHub issue at Lumidarin/agy-capsule with code F2. Sidebar statistics still work.',
      healthF3: 'If you are in a conversation but cannot see the footer capsule, the Antigravity layout may have changed. Update agy-capsule to the latest version; if this still appears, ask your AI assistant to open a GitHub issue at Lumidarin/agy-capsule with code F3. Sidebar statistics still work.',
      healthF4: 'The footer capsule could not attach. Quit Antigravity completely and restart it. If it still fails, ask your AI assistant to open a GitHub issue at Lumidarin/agy-capsule with code F4. Sidebar statistics still work.',
      newChat: 'New conversation', cached: 'cached',
      cachedInput: 'Cached input', lastActivity: 'Last recorded activity', cacheWarning: 'Approaching the {m}m reminder threshold', cacheCold: '{m}m threshold reached; cache may be cold',
      context: 'Context details', quota: 'Model quotas',
      contextUsed: 'Used', contextLimit: 'Limit', contextRemaining: 'Remaining', uncachedInput: 'Uncached input', ofLimit: '{pct} of context limit', resetAt: 'Resets', resetUnknown: 'Reset time not reported',
      contextScope: 'Current request input context (excludes its new output).',
      turn0Tip: 'Starting context baseline for this cycle (system prompt and carried history).',
      readTip: 'Added context input (user messages, read files, and tool outputs).',
      writeTip: 'Prior model replies and tool calls kept in current context (excludes latest reply).',
      thinkTip: 'Prior model thinking kept in current context (excludes latest reply).',
      output: "Total output", reply: 'Response / tool calls', thinking: 'Thinking',
      totalTime: "Request duration", streamTime: 'Stream',
      speedTip: "Generation speed = total output ÷ request duration (TTFT + stream).",
      outputTip: "Output of latest request",
      ttftTip: "First-token wait to total duration of the latest request.",
      totalTimeTip: "Request duration (TTFT + stream); excludes tool execution.",
      appearanceSection: 'Appearance', featuresSection: 'Features',
      languageScopeNote: "These only change agy-capsule's own panels. They don't translate Antigravity itself.",
      speedPairTip: 'Capsule speed: last completed request in the current turn (— until ready). Effects: breathing dot while running; holds speed color 15s after stopping (≥25 green, 10–25 yellow, <10 red).',
      requestSectionTip: 'Shows Last request (TTFT–total duration and generation speed of the latest recorded call) in panels. Independent of capsule speed.',
      turnSectionTip: 'Aggregates requests, elapsed wall time, write, and thinking tokens from your latest user message to completion.',
      uiSkin: 'Panel skin', nativeSkin: 'Native', frostedSkin: 'Frosted',
      panelLayout: 'Panel height', naturalLayout: 'Natural', matchedLayout: 'Matched',
      popAnimation: 'Panel pop-in animation',
      density: 'Panel spacing', compact: 'Compact', standard: 'Standard', spacious: 'Spacious',
      quotaIndicator: 'Quota indicator', cacheIndicator: 'Cache indicator', cacheIndicatorIcon: 'Icon', ring: 'Ring', bar: 'Bar',
      cacheHitFormat: 'Cache hit rate', cacheHitPercent: 'Percent', cacheHitBoth: 'Percent and ring',
      labelCase: 'Label casing', lowercase: 'Lowercase', titlecase: 'Title case',
      contextLayout: 'Context breakdown', turnLayout: 'Turn metrics style', layoutColumns: 'Columns', layoutRows: 'Rows', contextMarker: 'Context marker', turnMarker: 'Turn marker', showContextBreakdown: 'Context breakdown', markerSquare: 'Square', markerDot: 'Dot',
      highlightContextHover: 'Breakdown hover highlight',
      columnLabel: 'Names in columns', columnValue: 'Values in columns', columnPercent: 'Percentages in columns', fieldName: 'Name', fieldValue: 'Value', fieldPercent: '%', fieldDragTip: 'Drag to reorder; the switch hides or shows this line.',
      resetFormat: 'Reset countdown', compactTime: 'Compact', localizedTime: 'Localized', localizedTimeSample: '4 hr 55 min',
      resetDay: '{n} d', resetHour: '{n} hr', resetMinute: '{n} min', resetMinuteOnly: '{n} min', resetJoin: ' ',
    },
    'zh-CN': {
      cache: '缓存', turn0: '首轮', read: '读取', think: '思考', write: '写入',
      used: '已用', fiveHours: '5小时', weekly: '每周', soon: '即将重置', active: '当前',
      settings: '显示设置', language: "显示语言",
      cdpTitle: '底栏胶囊未启用',
      cdpBody: '插件连不上 Antigravity 的调试端口，无法在输入框下方显示胶囊。新版 Antigravity 默认不开这个端口。侧栏统计不受影响。',
      cdpHow: '设置方法', cdpScript: '一键设置（Windows）：在下载 agy-capsule 的文件夹里运行', cdpManual: '或手动：在 Antigravity 快捷方式的「目标」末尾加上', cdpRestart: '然后完全退出 Antigravity，再重新打开。',
      cdpRestartTitle: '底栏胶囊本次未加载（无需更新插件）',
      cdpRestartBodyShortcutOk: '检测到快捷方式参数仍在，无需更新或重装 agy-capsule。Antigravity 自动更新后自行重启不会经过快捷方式，只需完全退出 Antigravity，再从桌面或开始菜单快捷方式重新打开即可恢复。',
      cdpRestartBodyShortcutMissing: 'Antigravity 更新可能重建了快捷方式并清除了调试参数（无需更新 agy-capsule）。点击下方按钮补回参数后，完全退出 Antigravity 并从快捷方式重新打开即可恢复。',
      cdpRestartBodyGeneric: '之前已启用过底栏胶囊，无需更新或重装 agy-capsule。Antigravity 自动更新后自行重启不会经过快捷方式，只需完全退出 Antigravity，再从快捷方式或启动图标重新打开即可恢复。',
      cdpRestartHow: '排查与手动配置',
      cdpFixShortcutBtn: '一键补回快捷方式参数', cdpFixShortcutBusy: '正在补回…',
      cdpFixShortcutDone: '已补回快捷方式参数。请完全退出 Antigravity，再从快捷方式重新打开即可恢复。',
      cdpFixShortcutAdmin: '部分全局快捷方式需要管理员权限，请以管理员身份运行下方脚本补回。',
      cdpNotifyTitle: 'agy-capsule：无需更新插件',
      cdpNotifyBodyOk: '本次启动未经过快捷方式（常见于客户端更新后自动重启）。完全退出 Antigravity 并从快捷方式重新打开即可恢复底栏胶囊。',
      cdpNotifyBodyMissing: '客户端更新清除了快捷方式调试参数（无需更新插件）。可在侧栏 agy-capsule 一键补回，再完全退出从快捷方式重开。',
      notifyCdpRestart: '更新重启失效提醒',
      cdpRestartPreview: '客户端更新重启未走快捷方式时，弹一次系统提醒',
      sidebarStats: '统计', sidebarSettings: '设置', sidebarNavigation: 'Sidebar 页面',
      settingsLanguage: '设置语言', highlightActiveModel: '突出当前模型',
      hideUnavailableQuota: '隐藏不存在的配额窗口',
      showQuotaDividers: '配额组分隔线',
      showCacheWarnings: '缓存过期提醒',
      cacheWarnMin: '变黄时间（分钟）', cacheColdMin: '变红时间（分钟）',
      showContextWarnings: '上下文过载提醒', showRequestErrors: '请求失败胶囊',
      showQueueWarnings: '服务器排队预警', queueWarnSec: '排队预警阈值（秒）',
      queueShort: '排队', queueHeading: '服务器排队',
      queueDetail: '本轮有 {count} 次请求等待首字超过 {sec}s，可能正在服务器排队。',
      queueLiveNow: '当前已等待 {sec}s。',
      queueDiagnostic: '本轮超阈等待：{list}（阈值 {sec}s）',
      highContextTip: '上下文占用较高，建议压缩或开启新对话。',
      overflowContextTip: '最近一次请求已超出上下文上限。',
      requestFailure: '请求失败', retryAfter: '服务端报告的重试等待：',
      error_quota_exhausted: '额度耗尽', error_rate_limited: '429 限流', error_network_error: '断连', error_auth_error: '验证异常', error_service_unavailable: '服务繁忙', error_unknown: '未知原因',
      detail_quota_exhausted: '请求报告额度耗尽。可切换其他可用模型，或等待额度重置。',
      detail_rate_limited: '本次模型请求受到频率限制，请稍后重试。',
      detail_network_error: '本次模型请求连接失败或超时，请检查连接后重试。',
      detail_auth_error: '本次请求未通过验证或权限检查，请检查登录状态和账号权限。',
      detail_service_unavailable: '模型服务暂不可用，可稍后重试或切换其他模型。',
      detail_unknown: '本次模型请求失败，但报告的信息不足以识别已知原因。',
      showSpeed: '生成速度', showRequestMetrics: '最近请求', showUsageActivity: 'Token 活动',
      speedAnimation: '动效',
      saveFailed: '保存失败，请重试。',
      panelAuthFailed: '此面板未获授权，无法显示统计。请关闭侧栏，再从 Antigravity 中重新打开 agy-capsule。（S1）',
      healthCode: '代码', healthSidebarTitle: '侧栏统计不可用', healthStatsTitle: '侧栏统计需要留意', healthFooterTitle: '底栏胶囊已暂停',
      healthS2: '插件后台没有响应，下面的数据可能已过时。请关闭侧栏后重新打开；仍不行请完全退出并重启 Antigravity。',
      healthS3: '找不到对话数据目录，侧栏暂时无法统计。Antigravity 可能更改了存储位置。请先把 agy-capsule 更新到最新版；已是最新版仍出现，请让 AI 助手到 GitHub 的 Lumidarin/agy-capsule 提交 issue，并附上代码 S3。',
      healthS4: '读取对话数据失败，侧栏统计可能不准。通常完全退出并重启 Antigravity 即可恢复。',
      healthS5: 'agy-capsule 侧栏没能启动：Antigravity 没有提供授权信息。请把 Antigravity 和 agy-capsule 都更新到最新版；仍不行请让 AI 助手到 GitHub 的 Lumidarin/agy-capsule 提交 issue，并附上代码 S5。',
      healthF2: '没能确认这是 Antigravity 自己的窗口，因此没有加载底栏胶囊。Antigravity 可能更改了内部格式。请先把 agy-capsule 更新到最新版；已是最新版仍出现，请让 AI 助手到 GitHub 的 Lumidarin/agy-capsule 提交 issue，并附上代码 F2。侧栏统计不受影响。',
      healthF3: '如果你正在对话页面却看不到底栏胶囊，可能是 Antigravity 界面改版了。请先把 agy-capsule 更新到最新版；已是最新版仍出现，请让 AI 助手到 GitHub 的 Lumidarin/agy-capsule 提交 issue，并附上代码 F3。侧栏统计不受影响。',
      healthF4: '底栏胶囊加载失败。请完全退出并重启 Antigravity；仍不行请让 AI 助手到 GitHub 的 Lumidarin/agy-capsule 提交 issue，并附上代码 F4。侧栏统计不受影响。',
      newChat: '新对话', cached: '缓存',
      cachedInput: '缓存输入', lastActivity: '最近记录距今', cacheWarning: '接近 {m} 分钟提醒阈值', cacheCold: '已达 {m} 分钟阈值，缓存可能已冷却',
      context: '上下文明细', quota: '模型配额',
      contextUsed: '已用', contextLimit: '上限', contextRemaining: '剩余', uncachedInput: '非缓存输入', ofLimit: '占上限 {pct}', resetAt: '重置时间', resetUnknown: '未提供重置时间',
      contextScope: '最近一次请求的输入上下文（不含刚生成的输出）。',
      turn0Tip: '当前周期起始输入基线，包含系统提示词与初始历史。',
      readTip: '对话中新增的输入内容，包括用户消息、读取的文件与工具返回结果。',
      writeTip: '留在当前上下文中的累计回复与工具调用（不含最近一次生成）。',
      thinkTip: '留在当前上下文中的累计思考输出（不含最近一次生成）。',
      output: "总输出", reply: '回复/调用', thinking: '思考',
      totalTime: "请求耗时", streamTime: '流式耗时',
      speedTip: "生成速度 = 总输出 ÷ 单次请求总耗时（首字等待 + 流式输出）。",
      outputTip: "最近一次请求输出",
      ttftTip: "首字等待耗时 – 单次请求总耗时（已包含首字等待）。",
      totalTimeTip: "请求总耗时（首字等待 + 流式输出，不含工具执行）。",
      appearanceSection: '外观', featuresSection: '功能',
      languageScopeNote: '只影响 agy-capsule 自己的界面，不会翻译 Antigravity 本身。',
      speedPairTip: '底栏速度：本轮最近一次已完成请求的速度（未完成显示 —）。动效：运行中圆点呼吸，结束后保色 15 秒再变灰（≥25 绿、10–25 黄、<10 红）。',
      requestSectionTip: '在面板展示最近一次请求的 TTFT–总耗时与生成速度，与底栏胶囊独立。',
      turnSectionTip: '从最近一条用户消息到结束，按整轮累计请求数、耗时、写入与思考。',
      uiSkin: '面板风格', nativeSkin: '原生', frostedSkin: '磨砂',
      panelLayout: '面板高度', naturalLayout: '自然高度', matchedLayout: '对齐高度',
      popAnimation: '面板弹出动画',
      density: '面板间距', compact: '紧凑', standard: '标准', spacious: '舒展',
      quotaIndicator: '额度图形', cacheIndicator: '缓存图形', cacheIndicatorIcon: '图标', ring: '圆环', bar: '进度条',
      cacheHitFormat: '缓存命中率', cacheHitPercent: '百分比', cacheHitBoth: '百分比和圆环',
      labelCase: '面板大小写', lowercase: '全小写', titlecase: '首字母大写',
      contextLayout: '上下文明细', turnLayout: '本轮统计样式', layoutColumns: '竖线', layoutRows: '横条', contextMarker: '上下文标记', turnMarker: '本轮标记', showContextBreakdown: '上下文明细', markerSquare: '方块', markerDot: '圆点',
      highlightContextHover: '明细悬停高亮',
      columnLabel: '竖线显示名称', columnValue: '竖线显示数值', columnPercent: '竖线显示百分比', fieldName: '名称', fieldValue: '数值', fieldPercent: '百分比', fieldDragTip: '拖动调整顺序，开关控制这一行显示或隐藏。',
      resetFormat: '重置倒计时', compactTime: '简写', localizedTime: '本地化', localizedTimeSample: '4小时55分',
      resetDay: '{n}天', resetHour: '{n}小时', resetMinute: '{n}分', resetMinuteOnly: '{n}分钟', resetJoin: '',
    },
    'zh-TW': {
      cache: '快取', turn0: '首輪', read: '讀取', think: '思考', write: '寫入',
      used: '已用', fiveHours: '5小時', weekly: '每週', soon: '即將重設', active: '目前',
      settings: '顯示設定', language: "顯示語言",
      cdpTitle: '底欄膠囊未啟用',
      cdpBody: '外掛連不上 Antigravity 的偵錯連接埠，無法在輸入框下方顯示膠囊。新版 Antigravity 預設不開這個連接埠。側欄統計不受影響。',
      cdpHow: '設定方法', cdpScript: '一鍵設定（Windows）：在下載 agy-capsule 的資料夾裡執行', cdpManual: '或手動：在 Antigravity 捷徑的「目標」末尾加上', cdpRestart: '然後完全結束 Antigravity，再重新開啟。',
      cdpRestartTitle: '底欄膠囊本次未載入（無需更新外掛）',
      cdpRestartBodyShortcutOk: '偵測到捷徑參數仍在，無需更新或重裝 agy-capsule。Antigravity 自動更新後自行重啟不會經過捷徑，只需完全結束 Antigravity，再從桌面或開始功能表捷徑重新開啟即可恢復。',
      cdpRestartBodyShortcutMissing: 'Antigravity 更新可能重建了捷徑並清除了偵錯參數（無需更新 agy-capsule）。點擊下方按鈕補回參數後，完全結束 Antigravity 並從捷徑重新開啟即可恢復。',
      cdpRestartBodyGeneric: '先前已啟用過底欄膠囊，無需更新或重裝 agy-capsule。Antigravity 自動更新後自行重啟不會經過捷徑，只需完全結束 Antigravity，再從捷徑或啟動圖示重新開啟即可恢復。',
      cdpRestartHow: '排查與手動設定',
      cdpFixShortcutBtn: '一鍵補回捷徑參數', cdpFixShortcutBusy: '正在補回…',
      cdpFixShortcutDone: '已補回捷徑參數。請完全結束 Antigravity，再從捷徑重新開啟即可恢復。',
      cdpFixShortcutAdmin: '部分全域捷徑需要系統管理員權限，請以管理員身分執行下方腳本補回。',
      cdpNotifyTitle: 'agy-capsule：無需更新外掛',
      cdpNotifyBodyOk: '本次啟動未經過捷徑（常見於用戶端更新後自動重啟）。完全結束 Antigravity 並從捷徑重新開啟即可恢復底欄膠囊。',
      cdpNotifyBodyMissing: '用戶端更新清除了捷徑偵錯參數（無需更新外掛）。可在側欄 agy-capsule 一鍵補回，再完全結束從捷徑重開。',
      notifyCdpRestart: '更新重啟失效提醒',
      cdpRestartPreview: '用戶端更新重啟未走捷徑時，彈一次系統提醒',
      sidebarStats: '統計', sidebarSettings: '設定', sidebarNavigation: 'Sidebar 頁面',
      settingsLanguage: '設定語言', highlightActiveModel: '突出目前模型',
      hideUnavailableQuota: '隱藏不存在的配額視窗',
      showQuotaDividers: '配額組分隔線',
      showCacheWarnings: '快取過期提醒',
      cacheWarnMin: '變黃時間（分鐘）', cacheColdMin: '變紅時間（分鐘）',
      showContextWarnings: '上下文過載提醒', showRequestErrors: '請求失敗膠囊',
      showQueueWarnings: '伺服器排隊預警', queueWarnSec: '排隊預警閾值（秒）',
      queueShort: '排隊', queueHeading: '伺服器排隊',
      queueDetail: '本輪有 {count} 次請求等待首字超過 {sec}s，可能正在伺服器排隊。',
      queueLiveNow: '目前已等待 {sec}s。',
      queueDiagnostic: '本輪超閾等待：{list}（閾值 {sec}s）',
      highContextTip: '上下文佔用較高，建議壓縮或開啟新對話。',
      overflowContextTip: '最近一次請求已超出上下文上限。',
      requestFailure: '請求失敗', retryAfter: '服務端回報的重試等待：',
      error_quota_exhausted: '額度耗盡', error_rate_limited: '429 限流', error_network_error: '斷連', error_auth_error: '驗證異常', error_service_unavailable: '服務繁忙', error_unknown: '未知原因',
      detail_quota_exhausted: '請求回報額度耗盡。可切換其他可用模型，或等待額度重設。',
      detail_rate_limited: '本次模型請求受到頻率限制，請稍後重試。',
      detail_network_error: '本次模型請求連線失敗或逾時，請檢查連線後重試。',
      detail_auth_error: '本次請求未通過驗證或權限檢查，請檢查登入狀態和帳號權限。',
      detail_service_unavailable: '模型服務暫不可用，可稍後重試或切換其他模型。',
      detail_unknown: '本次模型請求失敗，但回報的資訊不足以識別已知原因。',
      showSpeed: '生成速度', showRequestMetrics: '最近請求', showUsageActivity: 'Token 活動',
      speedAnimation: '動效',
      saveFailed: '儲存失敗，請重試。',
      panelAuthFailed: '此面板未獲授權，無法顯示統計。請關閉側欄，再從 Antigravity 中重新開啟 agy-capsule。（S1）',
      healthCode: '代碼', healthSidebarTitle: '側欄統計無法使用', healthStatsTitle: '請留意側欄統計', healthFooterTitle: '底欄膠囊已暫停',
      healthS2: '外掛程式沒有回應，下方的資料可能已過時。請關閉側欄後重新開啟；若仍無效，請完全結束並重新啟動 Antigravity。',
      healthS3: '找不到對話資料夾，側欄暫時無法統計。Antigravity 可能更改了儲存位置。請先將 agy-capsule 更新至最新版；若已是最新版仍出現，請讓 AI 助理到 GitHub 的 Lumidarin/agy-capsule 提交 issue，並附上代碼 S3。',
      healthS4: '讀取對話資料失敗，側欄統計可能不準確。通常完全結束並重新啟動 Antigravity 即可恢復。',
      healthS5: 'agy-capsule 側欄未能啟動：Antigravity 沒有提供授權資訊。請將 Antigravity 和 agy-capsule 都更新至最新版；若仍無效，請讓 AI 助理到 GitHub 的 Lumidarin/agy-capsule 提交 issue，並附上代碼 S5。',
      healthF2: '無法確認這是 Antigravity 自己的視窗，因此沒有載入底欄膠囊。Antigravity 可能變更了內部格式。請先將 agy-capsule 更新至最新版；若已是最新版仍出現，請讓 AI 助理到 GitHub 的 Lumidarin/agy-capsule 提交 issue，並附上代碼 F2。側欄統計不受影響。',
      healthF3: '如果你在對話頁面卻看不到底欄膠囊，可能是 Antigravity 的介面改版了。請先將 agy-capsule 更新至最新版；若已是最新版仍出現，請讓 AI 助理到 GitHub 的 Lumidarin/agy-capsule 提交 issue，並附上代碼 F3。側欄統計不受影響。',
      healthF4: '底欄膠囊載入失敗。請完全結束並重新啟動 Antigravity；若仍無效，請讓 AI 助理到 GitHub 的 Lumidarin/agy-capsule 提交 issue，並附上代碼 F4。側欄統計不受影響。',
      newChat: '新對話', cached: '快取',
      cachedInput: '快取輸入', lastActivity: '最近記錄距今', cacheWarning: '接近 {m} 分鐘提醒閾值', cacheCold: '已達 {m} 分鐘閾值，快取可能已冷卻',
      context: '上下文明細', quota: '模型配額',
      contextUsed: '已用', contextLimit: '上限', contextRemaining: '剩餘', uncachedInput: '非快取輸入', ofLimit: '佔上限 {pct}', resetAt: '重設時間', resetUnknown: '未提供重設時間',
      contextScope: '最近一次請求的輸入上下文（不含剛產生的輸出）。',
      turn0Tip: '目前週期起始輸入基線，包含系統提示詞與初始歷史。',
      readTip: '對話中新增的輸入內容，包括使用者訊息、讀取的檔案與工具回傳結果。',
      writeTip: '留在目前上下文中的累計回覆與工具呼叫（不含最近一次生成）。',
      thinkTip: '留在目前上下文中的累計思考輸出（不含最近一次生成）。',
      output: "總輸出", reply: '回覆/呼叫', thinking: '思考',
      totalTime: "請求耗時", streamTime: '串流耗時',
      speedTip: "生成速度 = 總輸出 ÷ 單次請求總耗時（首字等待 + 串流輸出）。",
      outputTip: "最近一次請求輸出",
      ttftTip: "首字等待耗時 – 單次請求總耗時（已包含首字等待）。",
      totalTimeTip: "請求總耗時（首字等待 + 串流輸出，不含工具執行）。",
      appearanceSection: '外觀', featuresSection: '功能',
      languageScopeNote: '只影響 agy-capsule 自己的介面，不會翻譯 Antigravity 本身。',
      speedPairTip: '底欄速度：本輪最近一次已完成請求的速度（未完成顯示 —）。動效：執行中圓點呼吸，結束後保色 15 秒再變灰（≥25 綠、10–25 黃、<10 紅）。',
      requestSectionTip: '於面板展示最近一次請求的 TTFT–總耗時與生成速度，與底欄膠囊獨立。',
      turnSectionTip: '從最近一條使用者訊息到結束，依整輪累計請求數、耗時、寫入與思考。',
      uiSkin: '面板風格', nativeSkin: '原生', frostedSkin: '磨砂',
      panelLayout: '面板高度', naturalLayout: '自然高度', matchedLayout: '對齊高度',
      popAnimation: '面板彈出動畫',
      density: '面板間距', compact: '緊湊', standard: '標準', spacious: '舒展',
      quotaIndicator: '額度圖形', cacheIndicator: '快取圖形', cacheIndicatorIcon: '圖示', ring: '圓環', bar: '進度條',
      cacheHitFormat: '快取命中率', cacheHitPercent: '百分比', cacheHitBoth: '百分比和圓環',
      labelCase: '面板大小寫', lowercase: '全小寫', titlecase: '首字母大寫',
      contextLayout: '上下文明細', turnLayout: '本輪統計樣式', layoutColumns: '豎線', layoutRows: '橫條', contextMarker: '上下文標記', turnMarker: '本輪標記', showContextBreakdown: '上下文明細', markerSquare: '方塊', markerDot: '圓點',
      highlightContextHover: '明細懸停凸顯',
      columnLabel: '豎線顯示名稱', columnValue: '豎線顯示數值', columnPercent: '豎線顯示百分比', fieldName: '名稱', fieldValue: '數值', fieldPercent: '百分比', fieldDragTip: '拖動調整順序，開關控制這一行顯示或隱藏。',
      resetFormat: '重設倒數', compactTime: '簡寫', localizedTime: '在地化', localizedTimeSample: '4小時55分',
      resetDay: '{n}天', resetHour: '{n}小時', resetMinute: '{n}分', resetMinuteOnly: '{n}分鐘', resetJoin: '',
    },
  };
  function locale(prefs = {}, candidates = []) {
    if (dictionaries[prefs.language]) return prefs.language;
    for (const raw of candidates) {
      const value = String(raw || '').toLowerCase().replace(/_/g, '-');
      if (!value) continue;
      if (value.startsWith('zh')) return /hant|tw|hk|mo/.test(value) ? 'zh-TW' : 'zh-CN';
      if (value.startsWith('en')) return 'en';
    }
    return 'en';
  }
  function systemLocale(prefs) {
    return locale(prefs, [navigator.language, ...(navigator.languages || [])]);
  }
  function formatTokens(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const n = Math.max(0, Number(value));
    if (n < 1000) return String(Math.round(n));
    const k = Math.round(n / 100) / 10;
    if (k < 100) return k.toFixed(1) + 'K';
    const kInt = Math.round(n / 1000);
    if (kInt < 1000) return kInt + 'K';
    const m = Math.round(n / 100000) / 10;
    return m >= 100 ? Math.round(n / 1000000) + 'M' : m.toFixed(1) + 'M';
  }
  const { dictionaries: turnDictionaries, ...turnMethods } = turnFactory(formatTokens);
  for (const language of Object.keys(dictionaries)) Object.assign(dictionaries[language], turnDictionaries[language]);
  function cacheThresholds(prefs = {}) {
    const rawWarn = Number(prefs?.cacheWarnMin);
    const rawCold = Number(prefs?.cacheColdMin);
    let warnMin = Number.isInteger(rawWarn) && rawWarn >= 1 && rawWarn <= 998 ? rawWarn : 3;
    let coldMin = Number.isInteger(rawCold) && rawCold >= 2 && rawCold <= 999 ? rawCold : 4;
    if (coldMin <= warnMin) coldMin = Math.min(999, warnMin + 1);
    return { warnMin, coldMin, warnSec: warnMin * 60, coldSec: coldMin * 60 };
  }
  function makeCacheRingSvg(progress, color, size = 14, label = '') {
    const clamped = Math.max(0, Math.min(1, Number(progress || 0)));
    const r = 6.5;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - clamped);
    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 18 18"' + (label ? ' role="img" aria-label="' + label + '"' : '') + ' style="transform: rotate(-90deg); flex-shrink: 0;">' +
      '<circle cx="9" cy="9" r="' + r + '" fill="none" stroke="rgba(142,142,147,0.28)" stroke-width="2.4"/>' +
      (clamped > 0
        ? '<circle cx="9" cy="9" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linecap="round" ' +
          'stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '"/>'
        : '') +
      '</svg>'
    );
  }
  function cacheTooltip(data = {}, t = dictionaries.en, nowMs = Date.now(), prefs = {}) {
    const context = Number(data.contextTokens) || 0;
    if (context <= 0) return `0 / 0 ${t.cached} · ${t.newChat}`;
    const timestamp = Number(data.lastStepEpochMs);
    const seconds = Number.isFinite(timestamp) && timestamp > 0 ? Math.max(0, Math.floor((nowMs - timestamp) / 1000)) : null;
    const minutes = seconds === null ? null : Math.floor(seconds / 60);
    const age = minutes === null ? '—' : minutes < 1 ? '<1m' : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
    const { warnSec, coldSec, coldMin } = cacheThresholds(prefs);
    const warn = prefs?.showCacheWarnings !== false && seconds !== null;
    const state = !warn ? '' : seconds >= coldSec ? t.cacheCold.replace('{m}', String(coldMin)) : seconds >= warnSec ? t.cacheWarning.replace('{m}', String(coldMin)) : '';
    return `${t.cachedInput}: ${formatTokens(data.cachedIn ?? 0)} / ${formatTokens(context)} tokens · ${t.lastActivity}: ${age}${state ? ' · ' + state : ''}`;
  }
  function cacheView(data = {}, prefs = {}, nowMs = Date.now()) {
    const ctx = data.contextTokens || 0;
    const cached = data.cachedIn || 0;
    const hitPct = ctx > 0 ? Math.round((cached / ctx) * 100) : 0;
    const warn = prefs?.showCacheWarnings !== false;
    const { warnSec, coldSec } = cacheThresholds(prefs);
    const indicator = ['ring', 'bar'].includes(prefs?.cacheIndicator) ? prefs.cacheIndicator : 'icon';
    // Optional ring for the hit rate itself, in the number's place or next to it. It is separate from
    // the expiry indicator above; standing alone, it carries the number as its accessible name.
    const hitFormat = ['ring', 'both'].includes(prefs?.cacheHitFormat) ? prefs.cacheHitFormat : 'percent';
    const hitRingSvg = hitFormat === 'percent' ? '' : makeCacheRingSvg(hitPct / 100, 'currentColor', 14, hitFormat === 'ring' ? hitPct + '%' : '');
    const ts = Number(data.lastStepEpochMs);
    const hasAge = ctx > 0 && Number.isFinite(ts) && ts > 0;
    const elapsedSec = warn && hasAge ? Math.max(0, (nowMs - ts) / 1000) : 0;
    const idleSec = Math.floor(elapsedSec);
    const progress = warn && hasAge && coldSec > 0 ? Math.min(1, elapsedSec / coldSec) : 0;
    const progressPct = progress >= 1 ? '100%' : (progress * 100).toFixed(1) + '%';
    if (idleSec >= coldSec) {
      const progressColor = '#e06c75';
      const iconSvg = indicator === 'bar' ? ''
        : indicator === 'ring' ? makeCacheRingSvg(1, progressColor)
        : '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#e06c75" stroke-width="2" stroke-linecap="round"><line x1="2.2" y1="2.2" x2="9.8" y2="9.8"/><line x1="9.8" y1="2.2" x2="2.2" y2="9.8"/></svg>';
      return {
        status: 'cold', indicator, progress: 1, progressPct: '100%', progressColor,
        iconSvg, hitRingSvg,
        valColor: '', valDeco: 'line-through', valOp: '0.5', text: hitPct + '%', countdown: '',
        ctxIconColor: 'rgba(208, 122, 128, 0.88)',
      };
    }
    if (idleSec >= warnSec) {
      const progressColor = '#d4940a';
      const remMin = Math.max(1, Math.ceil((coldSec - idleSec) / 60));
      const iconSvg = indicator === 'bar' ? ''
        : indicator === 'ring' ? makeCacheRingSvg(progress, progressColor)
        : '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#d4940a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="4.8"/><polyline points="6 3.5 6 6 7.8 7.2"/></svg>';
      return {
        status: 'warning', indicator, progress, progressPct, progressColor,
        iconSvg, hitRingSvg,
        valColor: '#d4940a', valDeco: 'none', valOp: '1', text: hitPct + '%', countdown: '~' + remMin + 'm',
        ctxIconColor: 'rgba(206, 168, 92, 0.88)',
      };
    }
    const progressColor = '#4ea84e';
    const iconSvg = indicator === 'bar' ? ''
      : indicator === 'ring' ? makeCacheRingSvg(progress, progressColor)
      : '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 6.5 4.8 9.2 10 3"/></svg>';
    return {
      status: 'fresh', indicator, progress, progressPct, progressColor,
      iconSvg, hitRingSvg,
      valColor: '', valDeco: 'none', valOp: '1', text: hitPct + '%', countdown: '',
      ctxIconColor: '',
    };
  }
  function contextBreakdown(data = {}) {
    const maxCtx = data.maxContextTokens || 0;
    const ctx = data.contextTokens || 0;
    const cached = data.cachedIn || 0;
    const out = data.totalOutputTokens || 0;
    const think = data.totalThinkingTokens || 0;
    const turn0 = data.turn0Tokens || 0;
    const read = Math.max(0, ctx - turn0 - out - think);
    const hasMax = maxCtx > 0;
    const usedPctNum = hasMax ? Math.round((ctx / maxCtx) * 100) : 0;
    const usedPctExact = hasMax ? Math.min(100, (ctx / maxCtx) * 100) : 0;
    const compSum = read + out + think + turn0;
    const scale = compSum > 0 ? usedPctExact / compSum : 0;
    const pctStr = (val) => (hasMax ? Math.round((val / maxCtx) * 100) + '%' : (ctx === 0 ? '0%' : '--%'));
    const usedPct = hasMax ? usedPctNum + '%' : (ctx === 0 ? '0%' : '--%');
    return {
      ctx, maxCtx, cached, turn0, read, think, out,
      usedPct,
      usedFrac: formatTokens(ctx) + ' / ' + (hasMax ? formatTokens(maxCtx) : '--'),
      segTurn0W: (turn0 * scale).toFixed(2) + '%',
      segReadW: (read * scale).toFixed(2) + '%',
      segThinkW: (think * scale).toFixed(2) + '%',
      segOutW: (out * scale).toFixed(2) + '%',
      turn0Pct: pctStr(turn0),
      readPct: pctStr(read),
      thinkPct: pctStr(think),
      outPct: pctStr(out),
      turn0K: formatTokens(turn0),
      readK: formatTokens(read),
      thinkK: formatTokens(think),
      outK: formatTokens(out),
    };
  }
  function contextTooltips(data = {}, t = dictionaries.en) {
    const { ctx: context, maxCtx: limit, cached, turn0, read, think, out: write } = contextBreakdown(data);
    const row = (key, value) => `${t[key]}: ${formatTokens(value)} tokens${limit > 0 ? ` · ${t.ofLimit.replace('{pct}', Math.round(value / limit * 100) + '%')}` : ''}\n${t[key + 'Tip']}`;
    return {
      overview: `${t.contextScope}\n${t.contextUsed} ${formatTokens(context)} / ${t.contextLimit} ${limit > 0 ? formatTokens(limit) : '—'} · ${t.contextRemaining} ${limit > 0 ? formatTokens(Math.max(0, limit - context)) : '—'}\n${t.cachedInput} ${formatTokens(cached)} · ${t.uncachedInput} ${formatTokens(data.uncachedIn ?? Math.max(0, context - cached))}`,
      turn0: row('turn0', turn0), read: row('read', read), write: row('write', write), think: row('think', think),
    };
  }
  function renderContextTooltips(root, data, t) {
    const tips = contextTooltips(data, t);
    for (const node of root.querySelectorAll('[data-context-tip]')) node.title = tips[node.dataset.contextTip];
  }
  function quotaTooltip(data, t = dictionaries.en) {
    const date = data.resetTime ? new Date(data.resetTime) : null;
    const pad = n => String(n).padStart(2, '0');
    return date && Number.isFinite(date.getTime())
      ? `${t.resetAt} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
      : t.resetUnknown;
  }
  function applyQuotaTooltips(root, t) {
    for (const row of root.querySelectorAll('[data-quota-tooltip]')) row.title = quotaTooltip(JSON.parse(row.dataset.quotaTooltip), t);
  }
  function quotaColor(frac) {
    const clamped = Math.max(0, Math.min(1, Number(frac || 0)));
    const pctLeft = Math.round(clamped * 100);
    return pctLeft <= 10 ? '#ef4444' : pctLeft <= 25 ? '#f59e0b' : '#4ea84e';
  }
  function makeRingSvg(frac, size = 16) {
    const clamped = Math.max(0, Math.min(1, Number(frac || 0)));
    const r = 6.5;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - clamped);
    const color = quotaColor(clamped);
    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 18 18" style="transform: rotate(-90deg); flex-shrink: 0;">' +
      '<circle cx="9" cy="9" r="' + r + '" fill="none" stroke="rgba(142,142,147,0.28)" stroke-width="2.2"/>' +
      '<circle cx="9" cy="9" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + offset.toFixed(2) + '"/>' +
      '</svg>'
    );
  }
  function formatGroupTitle(raw) {
    const s = String(raw || '').trim();
    if (s === 'Gemini Models') return 'Gemini';
    if (s.toLowerCase().startsWith('claude')) return 'Claude';
    return s;
  }
  function formatBucketLabel(bucket = {}, t = dictionaries.en) {
    if (bucket.window === 'weekly') return t.weekly;
    if (bucket.window === '5h') return t.fiveHours;
    return String(bucket.displayName || bucket.window || '')
      .replace(/\s*limit\b/gi, '')
      .replace(/\b5h(?:ours)?\b/gi, '5 Hours')
      .trim();
  }
  function activeGroupColor(group = {}) {
    // Weekly exhaustion overrides 5h; zero is not a missing window.
    const knownBuckets = (group.buckets || []).filter(b => Number.isFinite(b.remainingFraction));
    const weeklyBucket = knownBuckets.find(b => b.window === 'weekly');
    const activeBucket = knownBuckets.find(b => b.window === '5h') || weeklyBucket;
    const activeFraction = weeklyBucket && Math.round(weeklyBucket.remainingFraction * 100) <= 0 ? 0 : activeBucket?.remainingFraction;
    return activeBucket ? quotaColor(activeFraction) : 'var(--muted-foreground, #8e8e93)';
  }
  function quotaView(groups = [], prefs = {}, t = dictionaries.en, now = Date.now()) {
    if (!Array.isArray(groups) || groups.length === 0) return [];
    const windowOrder = { '5h': 0, weekly: 1 };
    return groups.map(g => {
      const rawName = String(g.displayName || '').trim().toLowerCase();
      const title = formatGroupTitle(g.displayName);
      const descMatch = String(g.description || '').match(/models within this group:\s*([^\n.]+)/i);
      const modelsInGroup = descMatch ? descMatch[1].toLowerCase() : '';
      let q5h = '--%';
      let qWk = '--%';
      const sorted = [...(g.buckets || [])].sort(
        (a, b) => (windowOrder[a.window] ?? 2) - (windowOrder[b.window] ?? 2)
      );
      const buckets = sorted.map(b => {
        const label = formatBucketLabel(b, t);
        const labelKey = b.window === 'weekly' ? 'weekly' : b.window === '5h' ? 'fiveHours' : '';
        const resetShort = formatReset(b.resetTime, prefs, now);
        const pctLeft = Math.round((b.remainingFraction || 0) * 100);
        if (b.window === '5h') q5h = pctLeft + '%';
        if (b.window === 'weekly') qWk = pctLeft + '%';
        return {
          window: b.window,
          remainingFraction: b.remainingFraction,
          label,
          labelKey,
          resetShort,
          pctLeft,
          barWidth: Math.max(0, Math.min(100, pctLeft)),
          color: quotaColor(pctLeft / 100),
          tooltip: { pool: title, window: b.window, displayName: b.displayName, remainingFraction: b.remainingFraction, resetTime: b.resetTime },
        };
      });
      return { title, rawName, modelsInGroup, activeColor: activeGroupColor(g), q5h, qWk, buckets };
    });
  }
  function alertView(data = {}, prefs = {}, t = dictionaries.en, nowMs = Date.now(), running = false) {
    const kind = data.requestError?.kind || 'none';
    const ratio = data.maxContextTokens > 0 ? (data.contextTokens || 0) / data.maxContextTokens : 0;
    const contextTone = prefs.showContextWarnings === false ? '' : kind === 'context_overflow' || ratio >= .9 ? 'error' : ratio >= .75 ? 'warning' : '';
    const contextTip = !contextTone ? '' : kind === 'context_overflow' ? t.overflowContextTip : t.highContextTip;
    const errorVisible = prefs.showRequestErrors !== false && ['quota_exhausted', 'rate_limited', 'network_error', 'auth_error', 'service_unavailable', 'unknown'].includes(kind);
    if (errorVisible) {
      const label = t['error_' + kind];
      const wait = data.requestError?.retryAfterSec;
      const detail = t['detail_' + kind] + (kind === 'rate_limited' && typeof wait === 'number' ? ` ${t.retryAfter} ${wait}s` : '');
      const diagnostic = data.requestError?.diagnostic || '';
      return { contextTone, contextTip, mode: 'error', visible: true, label, heading: label, detail, diagnostic, queueCount: 0, liveWaitSec: 0 };
    }
    const rawQueueSec = Number(prefs.queueWarnSec);
    const thresholdSec = Number.isInteger(rawQueueSec) && rawQueueSec >= 1 && rawQueueSec <= 999 ? rawQueueSec : 30;
    const queueEnabled = prefs.showQueueWarnings !== false;
    const turnQueue = data.turnQueue || null;
    const slowWaits = Array.isArray(turnQueue?.waits)
      ? turnQueue.waits.filter(v => Number.isFinite(v) && v >= thresholdSec)
      : [];
    const canLiveWait = Boolean(turnQueue && !turnQueue.turnTerminal && Number.isFinite(turnQueue.waitingSinceMs) && turnQueue.waitingSinceMs > 0 && (running || turnQueue.hasPendingPlanner));
    const liveWaitSec = canLiveWait ? Math.max(0, (nowMs - turnQueue.waitingSinceMs) / 1000) : 0;
    const liveExceeded = canLiveWait && liveWaitSec >= thresholdSec;
    const queueCount = slowWaits.length + (liveExceeded ? 1 : 0);
    if (queueEnabled && queueCount > 0) {
      const liveInt = Math.floor(liveWaitSec);
      const mult = queueCount > 1 ? `×${queueCount}` : '';
      const label = liveExceeded
        ? `${t.queueShort}${mult} ${liveInt}s`
        : `${t.queueShort}${mult}`;
      const heading = `${t.queueHeading}${mult ? ' ' + mult : ''}`;
      const baseDetail = t.queueDetail.replace('{count}', String(queueCount)).replace('{sec}', String(thresholdSec));
      const detail = liveExceeded ? `${baseDetail} ${t.queueLiveNow.replace('{sec}', String(liveInt))}` : baseDetail;
      const list = [...slowWaits.map(v => Math.round(v) + 's'), ...(liveExceeded ? [liveInt + 's+'] : [])].join(', ');
      const diagnostic = t.queueDiagnostic.replace('{list}', list).replace('{sec}', String(thresholdSec));
      return { contextTone, contextTip, mode: 'queue', visible: true, label, heading, detail, diagnostic, queueCount, liveWaitSec };
    }
    return { contextTone, contextTip, mode: 'none', visible: false, label: '', heading: '', detail: '', diagnostic: '', queueCount: 0, liveWaitSec: 0 };
  }
  function renderAlerts(root, data, prefs, t, nowMs = Date.now(), running = false) {
    const view = alertView(data, prefs, t, nowMs, running);
    root.dataset.contextTone = view.contextTone;
    if (view.contextTip) for (const node of root.querySelectorAll('[data-context-tip="overview"]')) node.title += '\n' + view.contextTip;
    for (const node of root.querySelectorAll('[data-request-error]')) {
      node.textContent = view[node.dataset.requestError];
    }
    const group = root.querySelector('[data-el="grpError"]');
    if (group) {
      group.hidden = !view.visible;
      group.dataset.alertMode = view.mode;
      const prefix = view.mode === 'queue' ? t.queueHeading : t.requestFailure;
      group.querySelector('.dk-pill').setAttribute('aria-label', `${prefix}: ${view.label}`);
      group.querySelector('.dk-pill').title = [view.heading || view.label, view.detail, view.diagnostic].filter(Boolean).join('\n');
    }
    return view;
  }
  function generationText(g = {}, t = dictionaries.en) {
    const seconds = n => n !== null && n !== undefined && Number.isFinite(n) ? n.toFixed(1) + 's' : '—';
    const split = g.reply !== null && g.reply !== undefined && g.thinking !== null && g.thinking !== undefined
      ? `${t.reply} ${formatTokens(g.reply)} + ${t.thinking} ${formatTokens(g.thinking)}` : '';
    const ttft = seconds(g.ttft);
    const totalTime = seconds(g.duration);
    const timing = ttft !== '—' && totalTime !== '—' ? `${ttft}–${totalTime}` : ttft;
    const outputLine = g.output !== null && g.output !== undefined
      ? `\n${t.outputTip}: ${formatTokens(g.output)} tokens${split ? ` (${split})` : ''}`
      : '';
    const timingTitle = `${t.ttftTip}\nTTFT ${ttft} · ${t.streamTime} ${seconds(g.streaming)} · ${t.totalTime} ${totalTime}`;
    const totalTimeTitle = `${t.totalTimeTip}\nTTFT ${ttft} · ${t.streamTime} ${seconds(g.streaming)} · ${t.totalTime} ${totalTime}`;
    return {
      speed: g.tps !== null && g.tps !== undefined ? g.tps.toFixed(1) + ' tok/s' : '—',
      output: formatTokens(g.output),
      ttft,
      totalTime,
      timing,
      speedTitle: `${t.speedTip}${outputLine}`,
      outputTitle: `${t.outputTip}: ${formatTokens(g.output)} tokens${split ? ` (${split})` : ''}`,
      ttftTitle: t.ttftTip,
      totalTimeTitle,
      timingTitle,
    };
  }
  function generationMarkup() {
    return `<div data-generation-group="request"><div class="generation-grid"><div class="generation-row" data-generation-row="timing"><span>TTFT</span><span data-generation="timing">—</span></div><div class="generation-row" data-generation-row="speed"><span data-generation="speed">—</span></div></div></div>`;
  }
  function renderGeneration(root, generation, labels, prefs = {}) {
    const view = generationText(generation || {}, labels);
    for (const key of ['timing', 'speed']) {
      for (const node of root.querySelectorAll(`[data-generation="${key}"]`)) {
        node.hidden = false;
        if (node.textContent !== view[key]) node.textContent = view[key];
        if (node.title !== view[key + 'Title']) node.title = view[key + 'Title'];
      }
      for (const row of root.querySelectorAll(`[data-generation-row="${key}"]`)) {
        row.hidden = false;
        row.title = view[key + 'Title'];
      }
    }
    for (const block of root.querySelectorAll('[data-generation-block]')) block.hidden = prefs.showRequestMetrics === false || !generation || generation.requestIndex == null;
    return view;
  }
  function appearance(prefs = {}) {
    return { uiSkin: prefs.uiSkin === 'frosted' ? 'frosted' : 'native', panelLayout: prefs.panelLayout || 'natural', density: prefs.density || 'compact', quotaIndicator: prefs.quotaIndicator || 'ring', cacheIndicator: ['ring', 'bar'].includes(prefs.cacheIndicator) ? prefs.cacheIndicator : 'icon', cacheHitFormat: ['ring', 'both'].includes(prefs.cacheHitFormat) ? prefs.cacheHitFormat : 'percent', labelCase: prefs.labelCase || 'lowercase', resetFormat: prefs.resetFormat === 'localized' ? 'localized' : 'compact', contextLayout: prefs.contextLayout === 'rows' ? 'rows' : 'columns', turnLayout: prefs.turnLayout === 'rows' ? 'rows' : 'columns', contextMarker: prefs.contextMarker === 'dot' ? 'dot' : 'square', turnMarker: prefs.turnMarker === 'dot' ? 'dot' : 'square', showContextBreakdown: String(prefs.showContextBreakdown !== false), columnLabel: String(prefs.columnLabel !== false), columnValue: String(prefs.columnValue !== false), columnPercent: String(prefs.columnPercent === true), showQuotaDividers: String(prefs.showQuotaDividers !== false), popAnimation: String(prefs.popAnimation === true), highlightContextHover: String(prefs.highlightContextHover === true) };
  }
  function formatReset(isoStr, prefs = {}, now = Date.now()) {
    if (!isoStr) return '';
    const diffMs = new Date(isoStr).getTime() - now;
    if (!Number.isFinite(diffMs)) return '';
    const t = dictionaries[systemLocale(prefs)] || dictionaries.en;
    if (diffMs <= 0) return t.soon;
    const totalMin = Math.floor(diffMs / 60000);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    if (appearance(prefs).resetFormat === 'localized') {
      const unit = (key, n) => t[key].replace('{n}', n);
      if (d > 0) return unit('resetDay', d) + t.resetJoin + unit('resetHour', h);
      if (h > 0) return unit('resetHour', h) + t.resetJoin + unit('resetMinute', m);
      return unit('resetMinuteOnly', Math.max(1, m));
    }
    if (d > 0) return d + 'd ' + String(h).padStart(2, '0') + 'h';
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    return Math.max(1, m) + 'm';
  }
  function apply(root, prefs = {}) {
    root.style.colorScheme = '';
    for (const key of ['--background', '--foreground', '--card', '--muted-foreground', '--secondary', '--secondary-foreground', '--border']) {
      if (root.style.getPropertyValue(key) !== '') root.style.removeProperty(key);
    }
    const visual = appearance(prefs);
    for (const [key, value] of Object.entries(visual)) root.dataset[key] = value;
    const fieldOrder = String(prefs.columnOrder || 'label,value,percent').split(',');
    for (const field of ['label', 'value', 'percent']) root.style.setProperty('--agy-order-' + field, String(Math.max(0, fieldOrder.indexOf(field))));
    const scale = { compact: [4, 6, 8, 10], standard: [6, 8, 10, 12], spacious: [8, 11, 12, 14] }[visual.density] || [4, 6, 8, 10];
    for (const [index, key] of ['--agy-row-gap', '--agy-section-gap', '--agy-pad-y', '--agy-pad-x'].entries()) root.style.setProperty(key, scale[index] + 'px');
    root.dataset.highlightActiveModel = prefs.highlightActiveModel === true ? 'true' : 'false';
    const language = systemLocale(prefs);
    root.dataset.language = language;
    const t = dictionaries[language];
    const settingsLanguage = dictionaries[prefs.settingsLanguage] ? prefs.settingsLanguage : 'zh-CN';
    const settings = root.querySelector('.settings');
    if (settings) settings.lang = settingsLanguage;
    for (const node of root.querySelectorAll('[data-i18n]')) {
      const dict = node.closest('.settings') ? dictionaries[settingsLanguage] : t;
      const value = dict[node.dataset.i18n];
      if (value && node.textContent !== value) node.textContent = value;
    }
    for (const node of root.querySelectorAll('[data-stats-i18n]')) {
      const value = t[node.dataset.statsI18n];
      if (value && node.textContent !== value) node.textContent = value;
    }
    applyQuotaTooltips(root, t);
    return t;
  }
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return { version: 73, dictionaries, locale, systemLocale, apply, appearance, formatReset, escapeHtml, formatTokens, cacheThresholds, makeCacheRingSvg, cacheTooltip, cacheView, contextBreakdown, contextTooltips, renderContextTooltips, quotaTooltip, applyQuotaTooltips, quotaColor, makeRingSvg, formatGroupTitle, formatBucketLabel, activeGroupColor, quotaView, alertView, renderAlerts, generationText, generationMarkup, renderGeneration, ...turnMethods };
}

export const getPresentationScript = () => `if (globalThis.__agyCapsulePresentation?.version !== 73) globalThis.__agyCapsulePresentation = (${createPresentation.toString()})(${createTurnPresentation.toString()});`;
