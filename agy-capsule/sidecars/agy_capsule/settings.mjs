import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_SETTINGS = Object.freeze({ language: 'en', settingsLanguage: 'zh-CN', uiSkin: 'native', panelLayout: 'natural', density: 'compact', quotaIndicator: 'ring', cacheIndicator: 'icon', cacheHitFormat: 'percent', labelCase: 'lowercase', resetFormat: 'compact', popAnimation: false, contextLayout: 'columns', turnLayout: 'columns', contextMarker: 'square', turnMarker: 'square', showContextBreakdown: true, columnLabel: true, columnValue: true, columnPercent: false, columnOrder: 'label,value,percent', highlightContextHover: false, highlightActiveModel: false, hideUnavailableQuota: true, showQuotaDividers: true, showCacheWarnings: true, cacheWarnMin: 3, cacheColdMin: 4, showContextWarnings: true, showRequestErrors: true, notifyCdpRestart: true, showSpeed: true, speedAnimation: false, showRequestMetrics: true, showTurnMetrics: false, showUsageActivity: false, showQueueWarnings: true, queueWarnSec: 30 });
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
  highlightActiveModel: [true, false],
  hideUnavailableQuota: [true, false],
  showQuotaDividers: [true, false],
  showCacheWarnings: [true, false],
  showContextWarnings: [true, false],
  showRequestErrors: [true, false],
  notifyCdpRestart: [true, false],
  showSpeed: [true, false],
  speedAnimation: [true, false],
  showRequestMetrics: [true, false],
  showTurnMetrics: [true, false],
  showUsageActivity: [true, false],
  showQueueWarnings: [true, false],
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
  return Object.fromEntries([...validChoices, ...validNumbers]);
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
  return next;
}

export function createSettingsStore(filePath = join(homedir(), '.gemini', 'config', 'agy-capsule', 'settings.json')) {
  let cached = { ...DEFAULT_SETTINGS };
  let lastStat = '';
  function read() {
    try {
      // An atomic replacement can keep both size and a coarse mtime; its inode still changes.
      const stat = statSync(filePath, { bigint: true });
      const key = `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
      if (key !== lastStat) {
        const raw = JSON.parse(readFileSync(filePath, 'utf8'));
        cached = normalizeSettings(raw);
        lastStat = key;
      }
    } catch {
      cached = { ...DEFAULT_SETTINGS };
      lastStat = '';
    }
    return { ...cached };
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
