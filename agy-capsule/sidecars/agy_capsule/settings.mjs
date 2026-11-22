import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_SETTINGS = Object.freeze({ language: 'en', settingsLanguage: 'zh-CN', uiSkin: 'native', panelLayout: 'natural', density: 'compact', quotaIndicator: 'ring', cacheIndicator: 'icon', cacheHitFormat: 'percent', labelCase: 'lowercase', resetFormat: 'compact', popAnimation: false, contextLayout: 'columns', turnLayout: 'columns', contextMarker: 'square', turnMarker: 'square', showContextBreakdown: true, columnLabel: true, columnValue: true, columnPercent: false, columnOrder: 'label,value,percent', highlightContextHover: false, highlightActiveModel: false, modelEffortPicker: false, showEffortBar: false, hideModelTags: false, hideDefaultEffort: false, customizeModelList: false, hiddenModels: Object.freeze([]), hideUnavailableQuota: true, showQuotaDividers: true, showCacheWarnings: true, cacheWarnMin: 3, cacheColdMin: 4, showContextWarnings: true, showRequestErrors: true, notifyCdpRestart: true, notifyUpdates: true, showSpeed: true, speedAnimation: false, showRequestMetrics: true, compactTelemetryBar: false, telemetryBarPosition: 'bottom', showTurnMetrics: false, showQueueWarnings: true, queueWarnSec: 30, showUsageActivity: false, showModelUsage: false, effortMotion: 'fast', effortTicks: 'highlight', showModelDots: true, effortTheme: 'auto', geminiTheme: 'physical', claudeTheme: 'matrix', codexTheme: 'nebula', orchestratorMode: 'follow', orchestrator3dStyle: 'helix', orchestratorIcon: 'prism' });
const choices = {
  language: ['en', 'zh-CN', 'zh-TW'],
  settingsLanguage: ['en', 'zh-CN', 'zh-TW'],
  uiSkin: ['native', 'frosted'],
  panelLayout: ['natural', 'matched'],
  density: ['compact', 'standard', 'spacious'],
  quotaIndicator: ['ring', 'bar'],
  cacheIndicator: ['icon', 'ring', 'bar'],
  cacheHitFormat: ['percent', 'ring', 'both'],
  labelCase: ['lowercase', 'titlecase'],
  resetFormat: ['compact', 'localized'],
  popAnimation: [true, false],
  contextLayout: ['columns', 'rows'],
  turnLayout: ['columns', 'rows'],
  contextMarker: ['square', 'dot'],
  turnMarker: ['square', 'dot'],
  showContextBreakdown: [true, false],
  columnLabel: [true, false],
  columnValue: [true, false],
  columnPercent: [true, false],
  columnOrder: ['label,value,percent', 'label,percent,value', 'value,label,percent', 'value,percent,label', 'percent,label,value', 'percent,value,label'],
  highlightContextHover: [true, false],
  modelEffortPicker: [true, false],
  showEffortBar: [true, false],
  hideModelTags: [true, false],
  hideDefaultEffort: [true, false],
  customizeModelList: [true, false],
  highlightActiveModel: [true, false],
  hideUnavailableQuota: [true, false],
  showQuotaDividers: [true, false],
  showCacheWarnings: [true, false],
  showContextWarnings: [true, false],
  showRequestErrors: [true, false],
  notifyCdpRestart: [true, false],
  notifyUpdates: [true, false],
  showSpeed: [true, false],
  speedAnimation: [true, false],
  showRequestMetrics: [true, false],
  compactTelemetryBar: [true, false],
  telemetryBarPosition: ['bottom', 'top'],
  showTurnMetrics: [true, false],
  showQueueWarnings: [true, false],
  showUsageActivity: [true, false],
  showModelUsage: [true, false],
  effortMotion: ['fast', 'full'],
  effortTicks: ['highlight', 'dim', 'hidden'],
  showModelDots: [true, false],
  effortTheme: ['auto', 'gemini', 'claude', 'codex'],
  geminiTheme: ['physical', 'ribbon', 'nebula'],
  claudeTheme: ['matrix', 'bars', 'spark'],
  codexTheme: ['nebula', 'beam', 'orb'],
  orchestratorMode: ['follow', 'dock', 'custom3d'],
  orchestrator3dStyle: ['chamber', 'helix', 'orbital', 'c-matrix', 'c-louver', 'c-spark', 'nebula', 'beam', 'orb'],
  orchestratorIcon: ['prism', 'gravity', 'semicircle', 'none'],
};
const numericRanges = {
  cacheWarnMin: [1, 998],
  cacheColdMin: [2, 999],
  queueWarnSec: [1, 999],
};

export function validateSettings(raw) {
  const validChoices = Object.entries(choices)
    .filter(([key, values]) => values.includes(raw?.[key]))
    .map(([key]) => [key, raw[key]]);
  const validNumbers = Object.entries(numericRanges)
    .filter(([key, [min, max]]) => typeof raw?.[key] === 'number' && Number.isInteger(raw[key]) && raw[key] >= min && raw[key] <= max)
    .map(([key]) => [key, raw[key]]);
  const validLists = Array.isArray(raw?.hiddenModels)
    ? [['hiddenModels', [...new Set(raw.hiddenModels.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))].slice(0, 200)]]
    : [];
  return Object.fromEntries([...validChoices, ...validNumbers, ...validLists]);
}

export function normalizeSettings(raw = {}) {
  const valid = validateSettings(raw);
  const legacyReqKeys = ['showRequestSpeed', 'showOutput', 'showTtft', 'showTotalTime'];
  const hasLegacyReq = legacyReqKeys.some(key => typeof raw?.[key] === 'boolean');
  const migrated = typeof raw?.showRequestMetrics === 'boolean' ? {}
    : hasLegacyReq ? { showRequestMetrics: legacyReqKeys.some(key => raw?.[key] === true) }
    : typeof raw?.showGenerationDetails === 'boolean' ? { showRequestMetrics: raw.showGenerationDetails } : {};
  // Read old style-only settings once without restoring a selectable preset.
  const legacyStyle = raw?.panelStyle === 'modern' ? { density: 'standard', quotaIndicator: 'bar' } : {};
  const next = { ...DEFAULT_SETTINGS, ...legacyStyle, ...migrated, ...valid };
  if (next.cacheColdMin <= next.cacheWarnMin) {
    if (next.cacheWarnMin < 999) next.cacheColdMin = next.cacheWarnMin + 1;
    else next.cacheWarnMin = next.cacheColdMin - 1;
  }
  if (next.showSpeed === false) next.speedAnimation = false;
  next.hiddenModels = [...(next.hiddenModels || [])];
  return next;
}

export function createSettingsStore(filePath = join(homedir(), '.gemini', 'config', 'agy-capsule', 'settings.json')) {
  let cached = { ...DEFAULT_SETTINGS };
  let lastStat = '';
  function read() {
    try {
      // An atomic replacement can keep both size and a coarse mtime; its inode still changes.
      const stat = statSync(filePath, { bigint: true });
      const key = `${stat.ino}:${stat.size}:${stat.mtimeNs}`;
      if (key !== lastStat) {
        const raw = JSON.parse(readFileSync(filePath, 'utf8'));
        cached = normalizeSettings(raw);
        lastStat = key;
      }
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
        cached = { ...DEFAULT_SETTINGS };
        lastStat = '';
      }
    }
    return { ...cached, hiddenModels: [...(cached.hiddenModels || [])] };
  }
  function update(patch) {
    const current = read();
    const valid = validateSettings(patch);
    if ('cacheColdMin' in valid && !('cacheWarnMin' in valid) && valid.cacheColdMin <= current.cacheWarnMin) {
      valid.cacheWarnMin = Math.max(1, valid.cacheColdMin - 1);
    } else if ('cacheWarnMin' in valid && !('cacheColdMin' in valid) && valid.cacheWarnMin >= current.cacheColdMin) {
      valid.cacheColdMin = Math.min(999, valid.cacheWarnMin + 1);
    }
    const next = normalizeSettings({ ...current, ...valid });
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
    renameSync(tmp, filePath);
    lastStat = '';
    return read();
  }
  return { read, update };
}
