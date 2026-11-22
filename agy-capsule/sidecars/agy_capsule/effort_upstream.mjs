// Slider UI and motion engine adapted from LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider.
// Copyright (c) 2026 月上寒. MIT; see ../../THIRD-PARTY-NOTICES.md.
// Upstream c45c3fccaba43d238bce22d5023d7233e4be5ec1, lib/client.js (UI only).
// Animation replay and canvas geometry optimizations adapted from upstream 70ebd41.
import { motionThemes } from './motion_themes.mjs';

export function createUpstreamEffort() {
  var mt = motionThemes();
  var globalRoot = globalThis;
  var TRACK_HEIGHT = 28;
  var KNOB_SIZE = 28;
  var KNOB_RADIUS = KNOB_SIZE / 2;
  var BASE_SPEEDUP = 4;

  // Antigravity 默认三档模型 (Low / Medium / High) 无 Off 档，因此能量起点为 0、中点为 0.5；
  // 若遇到首档为 Off 的四档模型 (Off / Low / High / Max)，energyStopsFor 会自动返回 { start: 1/3, end: 2/3 }。
  var ENERGY_START = 0;
  var ENERGY_END = 0.5;
  var MIN_HEIGHT_SLOTS = 2;

  var AG_EFFORT_LABELS = {
    off: "Off",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra",
    max: "Max"
  };

  // Claude 专属主题常量（6×60 点阵、1.6s 从右至左扫掠、Capsule 胶囊滑块）
  var CLAUDE_CELL = 28 / 6; // ≈ 4.67px
  var CLAUDE_ROWS = 6;
  var CLAUDE_SWEEP_MS = 1600;
  var CLAUDE_KNOB_W = 24;
  var CLAUDE_KNOB_H = 30;
  var CLAUDE_KNOB_R = 7;

  function isClaudeModel(name) {
    if (!name || typeof name !== "string") return false;
    return /claude/i.test(name);
  }

  // ── 连续物理运动参数 ────────────────────────────────────────────────────────
  // full: 慢速 ~520ms 滑行 + 星尘渐亮；fast: 快速 ~160ms 滑行（默认）；quick: 系统减弱动态效果时的无过渡跳格
  var MOTION = Object.freeze({
    maxSpeed: 2.6,
    accel: 20,
    decel: 14,
    snapEps: 0.0015,
    velEps: 0.01
  });

  var MOTION_REDUCED = Object.freeze({
    maxSpeed: 1e6,
    accel: 1e9,
    decel: 1e9,
    snapEps: 1e-4,
    velEps: 1e6
  });

  var MOTION_FAST = Object.freeze({
    maxSpeed: 8.5,
    accel: 95,
    decel: 75,
    snapEps: 0.002,
    velEps: 0.04
  });

  var RELEASE_PROJECT_S = 0.09;
  var POINTER_SPEED_EMA = 0.45;
  var POINTER_STALE_S = 0.05;
  var POINTER_SPEED_TAU = 0.035;

  var SETTINGS_KEY = "agy-capsule.effort-bar.v1";
  var SETTINGS_EVENT = "agy-capsule:effort-bar";
  var SETTINGS_VERSION = 1;

  var SETTINGS_SCHEMA = Object.freeze([
    { key: "theme", defaultValue: "auto", options: [{ value: "auto" }, { value: "gemini" }, { value: "claude" }, { value: "codex" }] },
    { key: "geminiTheme", defaultValue: "physical", options: [{ value: "physical" }, { value: "ribbon" }, { value: "nebula" }] },
    { key: "claudeTheme", defaultValue: "matrix", options: [{ value: "matrix" }, { value: "bars" }, { value: "spark" }] },
    { key: "codexTheme", defaultValue: "nebula", options: [{ value: "nebula" }, { value: "beam" }, { value: "orb" }] },
    { key: "orchestratorMode", defaultValue: "follow", options: [{ value: "follow" }, { value: "dock" }, { value: "custom3d" }] },
    { key: "orchestrator3dStyle", defaultValue: "helix", options: [{ value: "chamber" }, { value: "helix" }, { value: "orbital" }, { value: "c-matrix" }, { value: "c-louver" }, { value: "c-spark" }, { value: "nebula" }, { value: "beam" }, { value: "orb" }] },
    { key: "orchestratorIcon", defaultValue: "prism", options: [{ value: "prism" }, { value: "gravity" }, { value: "semicircle" }, { value: "none" }] },
    Object.freeze({
      key: "motion",
      label: "动画速度",
      defaultValue: "fast",
      options: Object.freeze([
        Object.freeze({ value: "fast", label: "快速", hint: "~160ms 快速滑行" }),
        Object.freeze({ value: "full", label: "慢速", hint: "~520ms 慢速滑行 + 星尘渐亮" })
      ])
    }),
    Object.freeze({
      key: "ticks",
      label: "已到达档位的刻度点",
      defaultValue: "highlight",
      options: Object.freeze([
        Object.freeze({ value: "highlight", label: "亮白显示", hint: "默认 · 已滑过档位高亮" }),
        Object.freeze({ value: "dim", label: "全部同色", hint: "所有刻度点保持柔和半透明" }),
        Object.freeze({ value: "hidden", label: "隐藏", hint: "不显示任何刻度点" })
      ])
    })
  ]);

  var SIDECAR_TO_LOCAL = Object.freeze({
    effortTheme: "theme",
    geminiTheme: "geminiTheme",
    claudeTheme: "claudeTheme",
    codexTheme: "codexTheme",
    orchestratorMode: "orchestratorMode",
    orchestrator3dStyle: "orchestrator3dStyle",
    orchestratorIcon: "orchestratorIcon",
    effortMotion: "motion",
    effortTicks: "ticks",
  });
  var LOCAL_TO_SIDECAR = Object.freeze({
    theme: "effortTheme",
    geminiTheme: "geminiTheme",
    claudeTheme: "claudeTheme",
    codexTheme: "codexTheme",
    orchestratorMode: "orchestratorMode",
    orchestrator3dStyle: "orchestrator3dStyle",
    orchestratorIcon: "orchestratorIcon",
    motion: "effortMotion",
    ticks: "effortTicks",
  });

  var pendingHostPatch = null;
  var pendingHostRev = 0;

  function schemaDefaults() {
    var out = { v: SETTINGS_VERSION };
    for (var i = 0; i < SETTINGS_SCHEMA.length; i += 1) {
      var item = SETTINGS_SCHEMA[i];
      out[item.key] = item.defaultValue;
    }
    return out;
  }

  function normalizeSettings(raw) {
    var base = schemaDefaults();
    if (!raw || typeof raw !== "object") return base;
    for (var i = 0; i < SETTINGS_SCHEMA.length; i += 1) {
      var item = SETTINGS_SCHEMA[i];
      var candidate = raw[item.key];
      var matched = false;
      for (var j = 0; j < item.options.length; j += 1) {
        if (item.options[j].value === candidate) {
          matched = true;
          break;
        }
      }
      if (matched) base[item.key] = candidate;
    }
    return base;
  }

  function resolveStorage(win) {
    var w = win || (typeof window !== "undefined" ? window : globalRoot);
    try {
      if (w && w.localStorage) return w.localStorage;
    } catch (err) {
      // 沙箱或隐私上下文禁用 localStorage 时降级为内存模式
    }
    return null;
  }

  function readSettings(win) {
    var store = resolveStorage(win);
    if (!store) return schemaDefaults();
    try {
      var text = store.getItem(SETTINGS_KEY);
      if (!text) return schemaDefaults();
      return normalizeSettings(JSON.parse(text));
    } catch (err) {
      return schemaDefaults();
    }
  }

  function writeSettings(patch, win, options) {
    var w = win || (typeof window !== "undefined" ? window : globalRoot);
    var current = readSettings(w);
    var merged = Object.assign({}, current, patch || {});
    var next = normalizeSettings(merged);
    if (!(options && options.fromSidecar) && patch && typeof patch === "object") {
      var sidecarDelta = null;
      var keys = Object.keys(patch);
      for (var i = 0; i < keys.length; i += 1) {
        var k = keys[i];
        var sk = LOCAL_TO_SIDECAR[k];
        if (!sk) continue;
        if (!sidecarDelta) sidecarDelta = {};
        sidecarDelta[sk] = next[k];
      }
      if (sidecarDelta) {
        pendingHostPatch = Object.assign({}, pendingHostPatch || {}, sidecarDelta);
        pendingHostRev += 1;
      }
    }
    var store = resolveStorage(w);
    if (store) {
      try {
        store.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch (err) {
        // 忽略配额或权限异常
      }
    }
    try {
      if (w && typeof w.dispatchEvent === "function" && typeof w.CustomEvent === "function") {
        w.dispatchEvent(new w.CustomEvent(SETTINGS_EVENT, { detail: next }));
      }
    } catch (err) {
      // 忽略无 CustomEvent 构造器的测试环境
    }
    return next;
  }

  function readPendingPatch() {
    if (!pendingHostPatch) return null;
    return { rev: pendingHostRev, patch: Object.assign({}, pendingHostPatch) };
  }

  function ackPendingPatch(rev) {
    if (pendingHostPatch && rev === pendingHostRev) {
      pendingHostPatch = null;
    }
  }

  function applySidecarPrefs(prefs, win) {
    if (!prefs || typeof prefs !== "object") return false;
    if (pendingHostPatch) return false;
    var w = win || (typeof window !== "undefined" ? window : globalRoot);
    var current = readSettings(w);
    var mapped = {};
    var changed = false;
    var sKeys = Object.keys(SIDECAR_TO_LOCAL);
    for (var i = 0; i < sKeys.length; i += 1) {
      var sk = sKeys[i];
      if (!(sk in prefs)) continue;
      var lk = SIDECAR_TO_LOCAL[sk];
      mapped[lk] = prefs[sk];
    }
    if (!Object.keys(mapped).length) return false;
    var next = normalizeSettings(Object.assign({}, current, mapped));
    var nKeys = Object.keys(LOCAL_TO_SIDECAR);
    for (var j = 0; j < nKeys.length; j += 1) {
      var key = nKeys[j];
      if (next[key] !== current[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    writeSettings(next, w, { fromSidecar: true });
    return true;
  }

  function onSettingsChange(listener, win) {
    var w = win || (typeof window !== "undefined" ? window : globalRoot);
    if (!w || typeof w.addEventListener !== "function") return function () {};
    function handleCustom(ev) {
      listener(ev && ev.detail ? normalizeSettings(ev.detail) : readSettings(w));
    }
    function handleStorage(ev) {
      if (!ev || (ev.key !== SETTINGS_KEY)) return;
      listener(readSettings(w));
    }
    w.addEventListener(SETTINGS_EVENT, handleCustom);
    w.addEventListener("storage", handleStorage);
    return function () {
      w.removeEventListener(SETTINGS_EVENT, handleCustom);
      w.removeEventListener("storage", handleStorage);
    };
  }

  function prefersReducedMotion(win) {
    var w = win || (typeof window !== "undefined" ? window : globalRoot);
    try {
      if (w && typeof w.matchMedia === "function") {
        var mq = w.matchMedia("(prefers-reduced-motion: reduce)");
        if (mq && mq.matches) return true;
      }
    } catch (err) {
      // 忽略不支持 matchMedia 的环境
    }
    return false;
  }

  function motionMode(win, explicitSettings) {
    if (prefersReducedMotion(win)) return "quick";
    var s = explicitSettings || readSettings(win);
    return s.motion || "fast";
  }

  function motionParamsForMode(mode) {
    if (mode === "quick") return MOTION_REDUCED;
    if (mode === "full") return MOTION;
    return MOTION_FAST;
  }

  // ── 数学、物理与刻度换算 ────────────────────────────────────────────────────
  function clamp01(value) {
    var num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    if (num >= 1) return 1;
    return num;
  }

  function clampAbs(value, limit) {
    var lim = Math.max(0, Number(limit) || 0);
    var num = Number(value) || 0;
    if (num > lim) return lim;
    if (num < -lim) return -lim;
    return num;
  }

  function pctFromIndex(index, count) {
    var n = Number(count) || 0;
    if (n <= 1) return 0;
    var idx = Math.max(0, Math.min(n - 1, Math.round(Number(index) || 0)));
    return idx / (n - 1);
  }

  function indexFromPct(pct, count) {
    var n = Number(count) || 0;
    if (n <= 1) return 0;
    var p = clamp01(pct);
    return Math.max(0, Math.min(n - 1, Math.round(p * (n - 1))));
  }

  /**
   * 迟滞棘轮分档器（Hysteresis Detent）：
   * - 向新档位方向推进过 1/3 格宽即刻预览下一档；
   * - 往回退则需要退过 2/3 格宽（留出 [1/3, 2/3] 迟滞带），防止手指停在边界附近时左右抖动。
   */
  function detentTargetIndex(currentIndex, ptrPct, count) {
    var n = Number(count) || 0;
    if (n <= 1) return 0;
    var p = clamp01(ptrPct);
    if (typeof currentIndex !== "number" || currentIndex < 0 || currentIndex >= n) {
      return indexFromPct(p, n);
    }
    var step = 1 / (n - 1);
    var forwardThreshold = 1 / 3;
    var idx = currentIndex;
    var curCenter = idx * step;
    if (p >= curCenter) {
      while (idx < n - 1 && p >= (idx + forwardThreshold) * step - 1e-9) {
        idx += 1;
      }
    } else {
      while (idx > 0 && p <= (idx - forwardThreshold) * step + 1e-9) {
        idx -= 1;
      }
    }
    return idx;
  }

  function knobOffsetOf(pct, radiusPx) {
    var p = clamp01(pct);
    var r = typeof radiusPx === "number" && Number.isFinite(radiusPx) ? radiusPx : KNOB_RADIUS;
    return "calc(" + r + "px + (100% - " + (r * 2) + "px) * " + p + ")";
  }

  function motionSettled(state, params) {
    if (!state) return true;
    var cfg = params || MOTION;
    var dist = Math.abs((Number(state.target) || 0) - (Number(state.x) || 0));
    var vel = Math.abs(Number(state.v) || 0);
    return dist <= cfg.snapEps && vel <= cfg.velEps;
  }

  /**
   * 连续物理步进器：基于刹车距离 v^2 / (2 * decel) 平滑追赶 target，无过冲回弹
   */
  function motionStep(state, dtSeconds, params) {
    if (!state) return;
    var cfg = params || MOTION;
    var dt = Number(dtSeconds);
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (dt > 0.05) dt = 0.05;

    var target = clamp01(state.target);
    var x = clamp01(state.x);
    var v = Number(state.v) || 0;
    var diff = target - x;
    var dist = Math.abs(diff);

    if (dist <= cfg.snapEps && Math.abs(v) <= cfg.velEps) {
      state.x = target;
      state.v = 0;
      state.a = 0;
      return;
    }

    var dir = diff >= 0 ? 1 : -1;
    var movingTowards = v * dir >= 0;
    var stopDist = (v * v) / (2 * cfg.decel);
    var a = 0;

    if (!movingTowards) {
      a = dir * cfg.accel;
    } else if (stopDist >= dist) {
      a = -dir * cfg.decel;
    } else {
      a = dir * cfg.accel;
    }

    var nextV = clampAbs(v + a * dt, cfg.maxSpeed);
    var nextX = x + nextV * dt;

    // 防止单步跨越目标造成振荡
    if ((target - x) * (target - nextX) <= 0 && Math.abs(nextV) <= cfg.maxSpeed) {
      state.x = target;
      state.v = 0;
      state.a = 0;
      return;
    }

    if (nextX <= 0) {
      state.x = 0;
      state.v = Math.max(0, nextV);
      state.a = a;
      return;
    }
    if (nextX >= 1) {
      state.x = 1;
      state.v = Math.min(0, nextV);
      state.a = a;
      return;
    }

    state.x = nextX;
    state.v = nextV;
    state.a = a;
  }

  function decayPointerSpeed(rawSpeed, idleSeconds) {
    var v = Number(rawSpeed) || 0;
    var idle = Number(idleSeconds) || 0;
    if (idle <= POINTER_STALE_S) return v;
    var decay = Math.exp(-(idle - POINTER_STALE_S) / POINTER_SPEED_TAU);
    var out = v * decay;
    return Math.abs(out) < 1e-4 ? 0 : out;
  }

  function releaseIndexFor(ptrPct, rawSpeed, idleSeconds, count) {
    var v = decayPointerSpeed(rawSpeed, idleSeconds);
    var projected = clamp01((Number(ptrPct) || 0) + v * RELEASE_PROJECT_S);
    return indexFromPct(projected, count);
  }

  // ── 22 颗黄金分割确定性星尘与色彩引擎（对齐 dsh-codex-effort-slider 右向左横穿星空） ──
  var PARTICLE_COUNT = 22;
  var STARFIELD_DURATION_MEAN = 1.5;
  var STARFIELD_DURATION_SPREAD = 0.08;
  var STARFIELD_MIN = 0.5;
  var GOLDEN_RATIO = 0.6180339887498949;
  var MAX_SPEED_FACTOR = 2;
  var REDUCED_MOTION_SLOWDOWN = 2.6;

  /** 确定性伪随机 [0,1)：不用 Math.random，每次渲染完全一致且可离线断言 */
  function starHash01(index, salt) {
    var value = ((index + 1) * (salt || 1) * 2654435761) % 4294967296;
    return ((value >>> 8) % 1000) / 1000;
  }

  /**
   * 22 颗星尘粒子（形态 = 3px 圆点；运动 = 从右向左连续横穿已填充轨道，不消失、不上下飘动）：
   * - 相位：黄金比低差异序列（任意前缀均匀铺开）
   * - 高度：与相位排名解耦的确定性哈希排列，且相位相邻两星高度至少差 MIN_HEIGHT_SLOTS 槽
   */
  var PARTICLES = (function buildParticles() {
    var count = PARTICLE_COUNT;
    var minSlots = 3;
    var out = [];
    var i;
    for (i = 0; i < count; i += 1) {
      var b = STARFIELD_MIN + (1 - STARFIELD_MIN) * starHash01(i, 61);
      out.push({
        id: i,
        y: 0,
        phase: ((i + 1) * GOLDEN_RATIO) % 1,
        threshold: i / count,
        brightness: Math.round(b * 1000) / 1000
      });
    }
    var byPhase = [];
    for (i = 0; i < count; i += 1) byPhase.push(i);
    byPhase.sort(function (a, b) {
      return out[a].phase - out[b].phase;
    });
    var slots = null;
    for (var salt = 71; salt < 4000 && slots === null; salt += 1) {
      var candidate = [];
      for (i = 0; i < count; i += 1) candidate.push(i);
      candidate.sort(function (a, b) {
        var ha = starHash01(a, salt);
        var hb = starHash01(b, salt);
        return ha === hb ? a - b : ha - hb;
      });
      var ok = true;
      for (var k = 1; k < count && ok; k += 1) {
        if (Math.abs(candidate[k] - candidate[k - 1]) < minSlots) ok = false;
      }
      if (ok) slots = candidate;
    }
    if (slots === null) {
      slots = [];
      for (i = 0; i < count; i += 1) slots.push((i * 5) % count);
    }
    for (var rank = 0; rank < count; rank += 1) {
      var yVal = 8 + (slots[rank] / (count - 1)) * 84;
      out[byPhase[rank]].y = Math.round(yVal * 100) / 100;
    }
    for (i = 0; i < count; i += 1) {
      Object.freeze(out[i]);
    }
    return Object.freeze(out);
  })();

  function isOffLevel(text) {
    if (text === null || text === undefined) return false;
    if (typeof text === "object") {
      return isOffLevel(text.id || text.name || text.effort || text.label || "");
    }
    var s = String(text).trim().toLowerCase();
    if (!s) return false;
    return (
      s === "off" ||
      s === "none" ||
      s === "disabled" ||
      s === "0" ||
      s === "关闭" ||
      s === "关" ||
      s === "不推理" ||
      s === "无"
    );
  }

  /* ── Claude Ultracode 像素点阵抖动引擎 ──────────────────────────────── */
  function hash01(a, b, c) {
    var h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 1274126177;
    h = (h ^ (h >>> 13)) * 1274126177;
    h = h ^ (h >>> 16);
    return ((h >>> 0) % 100000) / 100000;
  }

  function ditherAlphaAt(x, w, col, row) {
    var t = clamp01(x / Math.max(1, w));
    var ramp = 0.92 + 0.08 * t;
    var jitter = 0.25 + 0.75 * hash01(col, row, 7);
    return clamp01(ramp * jitter);
  }

  function fillRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }

  function valueNoise(col, row, timeSec, speed, seed) {
    var tt = timeSec * speed + hash01(col, row, seed) * 17;
    var step = Math.floor(tt);
    var f = tt - step;
    var e = f * f * (3 - 2 * f);
    var a = hash01(col, row, (step % 997) + seed * 11);
    var b = hash01(col, row, ((step + 1) % 997) + seed * 11);
    return a + (b - a) * e;
  }

  var mergeCache = null;
  var mergeCacheKey = "";
  function getMergeMap(cols, rows) {
    var key = cols + "x" + rows;
    if (mergeCache && mergeCacheKey === key) return mergeCache;
    var map = new Uint8Array(cols * rows);
    for (var r = 0; r < rows; r += 1) {
      for (var c = 0; c < cols; c += 1) {
        var i = r * cols + c;
        if (map[i]) continue;
        var h = hash01(c, r, 91);
        if (h < 0.02 && c + 1 < cols && r + 1 < rows && !map[i + 1] && !map[i + cols] && !map[i + cols + 1]) {
          map[i] = 1; map[i + 1] = 2; map[i + cols] = 2; map[i + cols + 1] = 2;
        } else if (h < 0.06 && c + 1 < cols && !map[i + 1]) {
          map[i] = 3; map[i + 1] = 2;
        } else if (h < 0.08 && r + 1 < rows && !map[i + cols]) {
          map[i] = 4; map[i + cols] = 2;
        }
      }
    }
    mergeCache = map;
    mergeCacheKey = key;
    return map;
  }

  function surfaceIsDark(win, doc) {
    try {
      var d = doc || (typeof document !== "undefined" ? document : null);
      var w = win || (typeof window !== "undefined" ? window : globalRoot);
      if (!d || !d.body || !w) return true;
      if (d.documentElement && d.documentElement.classList.contains("dark")) return true;
      if (d.body && d.body.classList.contains("dark")) return true;
      var bg = (w.getComputedStyle && w.getComputedStyle(d.body).backgroundColor) || "";
      var parts = bg.match(/[\d.]+/g);
      if (!parts || parts.length < 3) return true;
      if (parts.length > 3 && Number(parts[3]) < 0.5) return true;
      var luminance = (0.2126 * Number(parts[0]) + 0.7152 * Number(parts[1]) + 0.0722 * Number(parts[2])) / 255;
      return luminance < 0.5;
    } catch (err) {
      return true;
    }
  }

  function replayCssAnimations(el, classes, names, includeSubtree = false) {
    var alreadyActive = el.classList.contains(classes[0]);
    el.classList.add(...classes);
    if (!alreadyActive) return;
    var animations = el.getAnimations?.({ subtree: includeSubtree }) ?? [];
    for (var animation of animations) {
      if (!names.includes(animation.animationName)) continue;
      animation.currentTime = 0;
      animation.play();
    }
  }

  /**
   * Claude 点阵绘制。intensity ∈ [0,1] 连续控制特效强度（中档约 0.35，最高档 1）：
   * - 底晕 wash 透明度按 intensity 缩放；
   * - 像素密度：按每格固定哈希做确定性稀疏剔除，intensity 越低保留越少（不会随帧闪烁）；
   * - 像素亮度：整体 alpha 乘以 (0.45 + 0.55 * intensity)。
   * intensity = 1 时三项系数均为 1，输出与旧版完全一致。
   */
  function paintDither(ctx, w, h, dark, progress, timeSec, intensity, pal) {
    if (!ctx) return;
    var strength = typeof intensity === "number" ? clamp01(intensity) : 1;
    ctx.clearRect(0, 0, w, h);
    if (strength <= 0 || w <= 0) return;
    var isCustomClaude = Boolean(pal && pal.core && pal.back && pal.glow);
    // 密度阈值：strength=1 → 1.0（全保留）；strength=0.35 → ~0.51（约一半格子）
    var keepRatio = strength >= 1 ? 1 : 0.25 + 0.75 * strength;
    var alphaMul = 0.45 + 0.55 * strength;
    var k = 1 - progress;
    var s1 = Math.max(0, Math.min(1, k - 0.08));
    var s2 = Math.max(s1, Math.min(1, k + 0.18));
    var wash = ctx.createLinearGradient(0, 0, w, 0);
    if (isCustomClaude) {
      var wb = pal.back;
      var wc = pal.core;
      if (dark) {
        wash.addColorStop(0, "rgba(" + wb[0] + "," + wb[1] + "," + wb[2] + ",0)");
        wash.addColorStop(s1, "rgba(" + wb[0] + "," + wb[1] + "," + wb[2] + ",0)");
        wash.addColorStop(s2, "rgba(" + wb[0] + "," + wb[1] + "," + wb[2] + ",0.35)");
        wash.addColorStop(1, "rgba(" + wc[0] + "," + wc[1] + "," + wc[2] + ",0.68)");
      } else {
        wash.addColorStop(0, "rgba(" + wc[0] + "," + wc[1] + "," + wc[2] + ",0)");
        wash.addColorStop(s1, "rgba(" + wc[0] + "," + wc[1] + "," + wc[2] + ",0)");
        wash.addColorStop(s2, "rgba(" + wc[0] + "," + wc[1] + "," + wc[2] + ",0.42)");
        wash.addColorStop(1, "rgba(" + wb[0] + "," + wb[1] + "," + wb[2] + ",0.86)");
      }
    } else if (dark) {
      wash.addColorStop(0, "rgba(112, 78, 162, 0)");
      wash.addColorStop(s1, "rgba(112, 78, 162, 0)");
      wash.addColorStop(s2, "rgba(118, 84, 169, 0.3)");
      wash.addColorStop(1, "rgba(116, 84, 170, 0.75)");
    } else {
      wash.addColorStop(0, "rgba(142, 118, 192, 0)");
      wash.addColorStop(s1, "rgba(142, 118, 192, 0)");
      wash.addColorStop(s2, "rgba(142, 118, 192, 0.45)");
      wash.addColorStop(1, "rgba(142, 118, 192, 1)");
    }
    ctx.globalAlpha = strength;
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);

    var dotCol = isCustomClaude ? (dark ? pal.core : pal.back) : (dark ? [208, 192, 246] : [150, 130, 205]);
    var hiCol = isCustomClaude ? pal.glow : (dark ? [220, 204, 255] : [247, 243, 255]);
    var cell = h / 6 > 0 ? h / 6 : CLAUDE_CELL;
    var cols = Math.ceil(w / cell);
    var rows = 6;

    for (var col = 0; col < cols; col += 1) {
      var x = col * cell;
      var t = clamp01(x / Math.max(1, w));
      var fade = clamp01((t - 0.02) / 0.48);
      for (var row = 0; row < rows; row += 1) {
        // 确定性稀疏：同一格在同一强度下始终同样保留/剔除，避免拖动时整片闪烁
        if (keepRatio < 1 && hash01(col, row, 101) > keepRatio) continue;
        var base = ditherAlphaAt(x, w, col, row) * alphaMul;
        if (base < 0.05) continue;
        var front = 1 - progress;
        var edgeJit = (hash01(col, row, 31) - 0.5) * 0.05;
        if (t < front + edgeJit) continue;
        var appear = (0.35 + 0.65 * clamp01((t - front - edgeJit) / 0.04)) * (dark ? 1 : alphaMul);

        var rowWaves = 3 + Math.floor(hash01(0, row, 47) * 5);
        var rowSpeed = 5.0 + 10.0 * hash01(0, row, 43);
        var rowPhase = hash01(0, row, 53) * Math.PI * 2;
        var rowWaves2 = 2 + Math.floor(hash01(0, row, 61) * 4);
        var rowSpeed2 = rowSpeed * (rowWaves2 / rowWaves);
        var rowPhase2 = hash01(0, row, 71) * Math.PI * 2;

        var u1 = ((t * rowWaves * Math.PI * 2 + timeSec * rowSpeed + rowPhase) / (Math.PI * 2)) % 1;
        if (u1 < 0) u1 += 1;
        var u2 = ((t * rowWaves2 * Math.PI * 2 + timeSec * rowSpeed2 + rowPhase2) / (Math.PI * 2)) % 1;
        if (u2 < 0) u2 += 1;

        var p1 = Math.pow(1 - u1, 2.6 + 3.4 * hash01(col, row, 17));
        var p2 = Math.pow(1 - u2, 3.4);
        var pulse = Math.max(p1, p2 * (0.55 + 0.45 * hash01(col, row, 19))) * 0.85;

        if (!dark) {
          var lt = clamp01((t - 0.05) / 0.2);
          if (lt <= 0) continue;
          var lmap = getMergeMap(cols, rows);
          var mi = row * cols + col;
          var mv = lmap[mi];
          if (mv === 2) continue;
          if (hash01(col, row, 95) < 0.03) continue;
          var wide = mv === 3 || mv === 1;
          var tall = mv === 4 || mv === 1;
          var y2 = row * cell;
          var u = hash01(col, row, 93);
          var sp = 22 + 66 * t;
          var off = (u - 0.42) * sp;
          if (off > 0) off *= 1.1;
          var lr, lg, lb;
          if (isCustomClaude) {
            lr = Math.max(40, Math.min(242, Math.round(pal.core[0] + off * 0.45 + 14 * pulse)));
            lg = Math.max(40, Math.min(238, Math.round(pal.core[1] + off * 0.45 + 14 * pulse)));
            lb = Math.max(40, Math.min(242, Math.round(pal.core[2] + off * 0.45 + 10 * pulse)));
          } else {
            var br = 187 - 32 * t;
            var bg = 184 - 46 * t;
            var bb = 206 + 4 * t;
            lr = br + off;
            lg = bg + (off < 0 ? off : off * 1.05);
            lb = bb + (off < 0 ? off : off * 0.65);
            lr = Math.max(124, Math.min(240, Math.round(lr + 12 * pulse)));
            lg = Math.max(100, Math.min(232, Math.round(lg + 12 * pulse)));
            lb = Math.max(180, Math.min(252, Math.round(lb + 8 * pulse)));
          }
          var lw = cell * (wide ? 2 : 1) * 0.88;
          var lh = cell * (tall ? 2 : 1) * 0.88;
          var flicker = valueNoise(col, row, timeSec, 0.9, 83);
          var density = clamp01((t - 0.12) / 0.35);
          var threshold = 0.2 + 0.8 * density;
          var presence = density > 0.9 ? 1 : clamp01((threshold - flicker) / 0.2);
          if (presence <= 0.01) continue;
          var lAlpha = clamp01(lt * appear * presence * (0.7 + 0.3 * (1 - flicker)) * (0.85 + 0.15 * hash01(col, row, 29)));
          ctx.globalAlpha = lAlpha;
          ctx.fillStyle = "rgb(" + lr + "," + lg + "," + lb + ")";
          fillRoundRect(ctx, x + 0.5, y2 + 0.5, lw, lh, 1);
          // 流光脉冲是点阵“流动”的唯一来源：亮度不随强度衰减（中档只靠点更少、底色更淡、速度更慢来区分）
          var whiteAmt = clamp01(pulse * (0.35 + 0.65 * t)) * (0.55 + 0.45 * hash01(col, row, 71));
          if (progress < 0.999) {
            var flash = clamp01(1 - (t - front) / 0.16) * (0.55 + 0.45 * hash01(col, row, 73));
            whiteAmt = Math.max(whiteAmt, flash);
          }
          if (whiteAmt > 0.03) {
            // 除回 alphaMul，让高光核心亮度与 High 一致
            ctx.globalAlpha = Math.min(1, (lAlpha / alphaMul) * (0.12 + 0.88 * whiteAmt));
            ctx.fillStyle = "rgb(" + hiCol[0] + "," + hiCol[1] + "," + hiCol[2] + ")";
            var ins = lw * 0.14;
            fillRoundRect(ctx, x + 0.5 + ins, y2 + 0.5 + ins, lw - ins * 2, lh - ins * 2, 0.7);
          }
          continue;
        }

        var flick = valueNoise(col, row, timeSec, 1.5, 5);
        var gap = 0.6 + 0.4 * clamp01((flick - (1 - fade) * 0.5) / 0.3);
        var vis = clamp01((t - 0.2) / 0.18);
        var ghost = 0.06 * clamp01((flick - 0.5) / 0.5) * (1 - vis);
        var baseAlpha = 0.04 + 0.96 * vis + ghost;
        var gridAlpha = clamp01(base * baseAlpha * gap * appear * 1.15 * (0.9 + 0.1 * hash01(col, row, 29)));
        if (gridAlpha < 0.008) continue;
        var y = row * cell;
        var size = cell * 0.72;
        ctx.globalAlpha = Math.min(1, gridAlpha * 0.55);
        ctx.fillStyle = "rgb(" + dotCol[0] + "," + dotCol[1] + "," + dotCol[2] + ")";
        fillRoundRect(ctx, x + 0.5, y + 0.5, size, size, 1.1);

        // 同浅色模式：流光亮度不随强度衰减
        var whiteAmtDark = clamp01(pulse * (0.35 + 0.65 * t)) * (0.55 + 0.45 * hash01(col, row, 71));
        if (progress < 0.999) {
          var flashDark = clamp01(1 - (t - front) / 0.16) * (0.55 + 0.45 * hash01(col, row, 73));
          whiteAmtDark = Math.max(whiteAmtDark, flashDark);
        }
        if (whiteAmtDark > 0.03) {
          ctx.globalAlpha = Math.min(1, (gridAlpha / alphaMul) * (0.1 + 0.72 * whiteAmtDark));
          ctx.fillStyle = "rgb(" + hiCol[0] + "," + hiCol[1] + "," + hiCol[2] + ")";
          fillRoundRect(ctx, x + 0.5, y + 0.5, size, size, 0.7);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 根据档位列表自动推导能量起点与中点：
   * - 若首档为 Off（如 4 档 Off / Low / High / Max），则第 1 档 (Low) 为纯蓝无星尘起点：
   *   start = 1 / (count - 1), end = (start + 1) / 2
   * - 若首档不是 Off（如 Antigravity 的 3 档 Low / Medium / High），则第 0 档 (Low) 为纯蓝起点：
   *   start = 0, end = 0.5
   */
  function energyStopsFor(levels) {
    var list = Array.isArray(levels) ? levels : [];
    var n = list.length;
    if (n <= 1) return { start: 0, end: 0.5, hasOffFirst: false };
    var first = list[0];
    var firstLabel = first && typeof first === "object" ? (first.effort || first.label || first.id || "") : String(first || "");
    var hasOffFirst = isOffLevel(firstLabel);
    var start = hasOffFirst ? 1 / (n - 1) : 0;
    var end = (start + 1) / 2;
    return { start: start, end: end, hasOffFirst: hasOffFirst };
  }

  function energyForPct(pct, startOverride) {
    var p = clamp01(pct);
    var start = typeof startOverride === "number" && Number.isFinite(startOverride) ? clamp01(startOverride) : ENERGY_START;
    if (p <= start || start >= 1) return 0;
    return clamp01((p - start) / (1 - start));
  }

  /**
   * 位置 → 粒子横穿速率倍数：
   * Medium (energy=0.5) 对应 1×（约 3.0s 横穿），High/Max (energy=1.0) 对应 2×（约 1.5s 横穿），左端下限 0.35×
   */
  function speedFor(pct, startOverride) {
    var e = energyForPct(pct, startOverride);
    return Math.min(MAX_SPEED_FACTOR, Math.max(0.35, 2 * e));
  }

  /**
   * Claude 点阵特效强度（随位置连续变化，与 Codex 能量曲线同源）：
   * energy=0 (Low) → 0 无特效；energy=0.5 (Medium) → ≈0.35 少量点阵；energy=1 (High) → 1 全量。
   * 采用 e^1.5 曲线：低端起势柔和，靠近 High 时加速饱和。
   */
  function claudeIntensityFor(pct, startOverride) {
    var e = energyForPct(pct, startOverride);
    if (e <= 0) return 0;
    return Math.round(Math.pow(e, 1.5) * 1000) / 1000;
  }

  /**
   * Claude 点阵流动速度倍率（以 High = 1 为基准）：Medium = 0.5（慢一倍），下限 0.175。
   * 直接复用 Codex 的 speedFor（Medium 1× / High 2×）再除以 2 归一化。
   */
  function claudeSpeedFor(pct, startOverride) {
    return speedFor(pct, startOverride) / MAX_SPEED_FACTOR;
  }

  /** 位置 → 可见粒子数量（随能量从 0 渐增至 22 颗） */
  function particleCountFor(pct, startOverride) {
    return Math.round(energyForPct(pct, startOverride) * PARTICLES.length);
  }

  function starCountFor(pct, startOverride) {
    return particleCountFor(pct, startOverride);
  }

  /**
   * 第 index 颗粒子的亮度/大小系数（落在 [STARFIELD_MIN, 1]，越亮越大）：
   * - 单参数调用 starBrightnessFor(indexOrStar)：返回该星固有亮度 [0.5, 1]
   * - 双参数调用 starBrightnessFor(starOrIndex, energy)：当 energy 尚未达到该星出现序号时返回 0，已出现则返回固有亮度
   */
  function starBrightnessFor(starOrIndex, energy) {
    var idx = typeof starOrIndex === "number"
      ? starOrIndex
      : (starOrIndex && typeof starOrIndex.id === "number" ? starOrIndex.id : 0);
    var baseB = STARFIELD_MIN + (1 - STARFIELD_MIN) * starHash01(idx, 61);
    if (energy === undefined) {
      return Math.round(baseB * 1000) / 1000;
    }
    var e = clamp01(energy);
    var visibleCount = Math.round(e * PARTICLES.length);
    if (e <= 0 || idx >= visibleCount) return 0;
    return Math.round(baseB * 1000) / 1000;
  }

  /**
   * 第 index 颗粒子从右向左横穿轨道的时长（秒）：
   * 最高档约 1.5s、中档约 3.0s、低端约 8.6s，各星之间仅差 ±8% 防止追尾成团
   */
  function starDurationFor(starOrIndex, speedFactor) {
    var idx = typeof starOrIndex === "number"
      ? starOrIndex
      : (starOrIndex && typeof starOrIndex.id === "number" ? starOrIndex.id : 0);
    var speed = Math.min(
      MAX_SPEED_FACTOR,
      Math.max(0.35, typeof speedFactor === "number" && Number.isFinite(speedFactor) ? speedFactor : MAX_SPEED_FACTOR)
    );
    var spread = 1 - STARFIELD_DURATION_SPREAD + 2 * STARFIELD_DURATION_SPREAD * starHash01(idx, 29);
    return (STARFIELD_DURATION_MEAN * MAX_SPEED_FACTOR) / speed * spread;
  }

  /**
   * 第 index 颗粒子的负相位延迟（秒）：
   * 按黄金比低差异序列铺开，只与粒子序号与当前周期有关，与当前可见颗数无关
   */
  function starDelayFor(starOrIndex, duration) {
    var idx = typeof starOrIndex === "number"
      ? starOrIndex
      : (starOrIndex && typeof starOrIndex.id === "number" ? starOrIndex.id : 0);
    var particle = PARTICLES[idx];
    var phase = particle && typeof particle.phase === "number" ? particle.phase : 0;
    var dur = typeof duration === "number" && duration > 0 ? duration : starDurationFor(idx, MAX_SPEED_FACTOR);
    var jitter = starHash01(idx, 53) * 0.03;
    return -((phase + jitter) % 1) * dur;
  }

  /**
   * 星星层总不透明度：独立于星云层，保证中档 (energy=0.5) 也有 0.8 的清晰度，最高档为 1.0
   */
  function starLayerOpacityFor(energyOrPct, startOverride) {
    var e = typeof startOverride === "number" ? energyForPct(energyOrPct, startOverride) : clamp01(energyOrPct);
    if (e <= 0) return 0;
    return Math.round((0.6 + 0.4 * e) * 1000) / 1000;
  }

  function parseHexRgb(hex) {
    var clean = String(hex || "").replace(/^#/, "");
    var num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function mixHex(hexA, hexB, t) {
    var ratio = clamp01(t);
    var a = parseHexRgb(hexA);
    var b = parseHexRgb(hexB);
    var r = Math.round(a[0] + (b[0] - a[0]) * ratio);
    var g = Math.round(a[1] + (b[1] - a[1]) * ratio);
    var bl = Math.round(a[2] + (b[2] - a[2]) * ratio);
    return (
      "#" +
      ((1 << 24) | (r << 16) | (g << 8) | bl)
        .toString(16)
        .slice(1)
    );
  }

  /**
   * 填充区末端主色：
   * - pct <= start          : #4d93f8 (Codex 纯蓝)
   * - start < pct <= end    : #4d93f8 -> #9333ea (蓝紫过渡)
   * - end < pct <= 1        : #9333ea -> #4c1d95 (深紫星云)
   */
  function fillColorFor(pct, startOverride, endOverride, themeOrClaude, pal) {
    var p = clamp01(pct);
    var start = typeof startOverride === "number" && Number.isFinite(startOverride) ? startOverride : ENERGY_START;
    var end = typeof endOverride === "number" && Number.isFinite(endOverride) ? endOverride : ENERGY_END;
    var theme = themeOrClaude === true ? "claude" : (typeof themeOrClaude === "string" ? themeOrClaude : "codex");
    if (theme === "gemini" && pal && pal.stops) {
      if (p <= start + 1e-6) return pal.stops[0];
      if (p <= end + 1e-6) {
        var gspan1 = Math.max(1e-6, end - start);
        return mixHex(pal.stops[0], pal.stops[2] || pal.stops[1], (p - start) / gspan1);
      }
      var gspan2 = Math.max(1e-6, 1 - end);
      return mixHex(pal.stops[2] || pal.stops[1], pal.stops[pal.stops.length - 1], (p - end) / gspan2);
    }
    if (theme === "claude") {
      var cMid = (pal && pal.accent) || "#e07b53";
      var cEnd = (pal && pal.stops && pal.stops[2]) || "#bc5a2e";
      if (p <= start + 1e-6) return "#71717a";
      if (p <= end + 1e-6) {
        var cspan1 = Math.max(1e-6, end - start);
        return mixHex("#71717a", cMid, (p - start) / cspan1);
      }
      var cspan2 = Math.max(1e-6, 1 - end);
      return mixHex(cMid, cEnd, (p - end) / cspan2);
    }
    if (p <= start + 1e-6) return "#4d93f8";
    if (p <= end + 1e-6) {
      var span1 = Math.max(1e-6, end - start);
      return mixHex("#4d93f8", "#9333ea", (p - start) / span1);
    }
    var span2 = Math.max(1e-6, 1 - end);
    return mixHex("#9333ea", "#4c1d95", (p - end) / span2);
  }

  /**
   * 填充区线性渐变背景：
   * 让轨道左侧始终保留蓝色起点，随滑块向右推进依次展开蓝紫过渡与深紫星云
   */
  function fillBackgroundFor(pct, startOverride, endOverride, themeOrClaude, pal) {
    var p = clamp01(pct);
    var start = typeof startOverride === "number" && Number.isFinite(startOverride) ? startOverride : ENERGY_START;
    var end = typeof endOverride === "number" && Number.isFinite(endOverride) ? endOverride : ENERGY_END;
    var theme = themeOrClaude === true ? "claude" : (typeof themeOrClaude === "string" ? themeOrClaude : "codex");
    if (theme === "gemini" && pal && pal.stops) {
      var st = pal.stops;
      if (p <= start + 1e-6) return st[1] || st[0];
      return "linear-gradient(90deg, " + st[0] + " 0%, " + st[1] + " 38%, " + st[2] + " 74%, " + st[3] + " 100%)";
    }
    if (theme === "claude") {
      var baseRgb = (pal && pal.core) || [224, 123, 83];
      var rgbaPrefix = "rgba(" + baseRgb[0] + ", " + baseRgb[1] + ", " + baseRgb[2] + ", ";
      if (p <= 0.05) return rgbaPrefix + "0.15)";
      return "linear-gradient(90deg, " + rgbaPrefix + "0.25) 0%, " + fillColorFor(p, start, end, "claude", pal) + " 100%)";
    }
    if (p <= start + 1e-6) return "#4d93f8";
    var endColor = fillColorFor(p, start, end, false);
    if (p <= end + 1e-6) {
      var stopBlue = start > 0 ? Math.round((start / p) * 100) : 0;
      if (stopBlue <= 0) {
        return "linear-gradient(90deg, #4d93f8 0%, " + endColor + " 100%)";
      }
      return "linear-gradient(90deg, #4d93f8 0%, #4d93f8 " + stopBlue + "%, " + endColor + " 100%)";
    }
    var stopStart = start > 0 ? Math.round((start / p) * 100) : 0;
    var stopMid = Math.round((end / p) * 100);
    if (stopStart <= 0) {
      return "linear-gradient(90deg, #4d93f8 0%, #9333ea " + stopMid + "%, " + endColor + " 100%)";
    }
    return (
      "linear-gradient(90deg, #4d93f8 0%, #4d93f8 " +
      stopStart +
      "%, #9333ea " +
      stopMid +
      "%, " +
      endColor +
      " 100%)"
    );
  }

  /**
   * 档位文字着色：
   * - 单档位锁定模型或 Off 档位保持官方默认灰（返回 ""）
   * - Codex 风格：首档蓝 #4d93f8、中档蓝紫 #6c78f7、高档亮紫 #8b5cf6
   * - Claude / Gemini 风格：按当前模型/元素调色板柔和渐进
   */
  function valueColorFor(label, index, count, isMax, hasOffFirst, themeOrClaude, baseName) {
    if (isOffLevel(label)) return "";
    var n = Number(count) || 0;
    if (n <= 1) return "";
    var settings = readSettings();
    var theme = typeof themeOrClaude === "string"
      ? themeOrClaude
      : themeOrClaude === true
        ? "claude"
        : (baseName ? mt.resolveThemeFamily(baseName, settings.theme) : "codex");
    if (theme === "claude" || theme === "gemini") {
      var pal = mt.resolvePalette(baseName || (theme === "claude" ? "Claude Opus" : "Gemini Flash"), theme);
      var lowHex = pal.accentLow || (theme === "claude" ? "#b59385" : "#4d93f8");
      var midHex = pal.accent || (theme === "claude" ? "#e07b53" : "#a78bfa");
      var maxHex = pal.accentMax || (theme === "claude" ? "#f4a37f" : "#8b5cf6");
      if (isMax || index === n - 1) return maxHex;
      var cIdx = typeof index === "number" && index >= 0 ? index : 0;
      var cFirstActive = hasOffFirst ? 1 : 0;
      if (cIdx <= cFirstActive) return lowHex;
      if (n === 3 && cIdx === 1) return midHex;
      var cDenom = Math.max(1, n - 1 - cFirstActive);
      var cT = clamp01((cIdx - cFirstActive) / cDenom);
      return mixHex(lowHex, maxHex, cT);
    }
    if (isMax || index === n - 1) return "#8b5cf6";
    var idx = typeof index === "number" && index >= 0 ? index : 0;
    var firstActive = hasOffFirst ? 1 : 0;
    if (idx <= firstActive) return "#4d93f8";
    var denom = Math.max(1, n - 1 - firstActive);
    var t = clamp01((idx - firstActive) / denom);
    return mixHex("#4d93f8", "#8b5cf6", t);
  }

  function extractEffortKey(item) {
    if (item === null || item === undefined) return "";
    if (typeof item === "string") return item;
    if (typeof item === "object") {
      return String(item.effort || item.id || item.value || item.key || item.label || "");
    }
    return String(item);
  }

  function extractEffortDisplayLabel(item, effortKey, seat) {
    if (item && typeof item === "object" && typeof item.label === "string") {
      return item.label;
    }
    if (seat && typeof seat.formatEffortLabel === "function") {
      try {
        var formatted = seat.formatEffortLabel(effortKey);
        if (formatted) return String(formatted);
      } catch (err) {
        // 忽略格式化异常
      }
    }
    var lower = String(effortKey || "").toLowerCase();
    if (AG_EFFORT_LABELS[lower]) return AG_EFFORT_LABELS[lower];
    return String(effortKey || "");
  }

  function mountCodexEffortSlider(options) {
    var opts = options || {};
    var container = opts.container;
    var seat = opts.seat;
    var doc = opts.document || (container && container.ownerDocument) || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (doc && doc.defaultView) || (typeof window !== "undefined" ? window : globalRoot);

    if (!container || !doc) {
      return { unmount: function () {}, refresh: function () {} };
    }

    // 清空宿主容器并构建 DOM 树（对齐 dsh-codex-effort-slider 四层结构：fill / energy+sweep / stars+dot / knob）
    container.innerHTML = "";
    var rootEl = doc.createElement("div");
    rootEl.className = "ces-root";
    rootEl.setAttribute("role", "slider");
    rootEl.setAttribute("aria-label", opts.caption);

    var trackEl = doc.createElement("div");
    trackEl.className = "ces-track";
    trackEl.setAttribute("data-ces-part", "track");

    var fillEl = doc.createElement("div");
    fillEl.className = "ces-fill";
    fillEl.setAttribute("data-ces-part", "fill");
    trackEl.appendChild(fillEl);

    var energyEl = doc.createElement("div");
    energyEl.className = "ces-energy";
    energyEl.setAttribute("data-ces-part", "energy");
    var sweepEl = doc.createElement("div");
    sweepEl.className = "ces-energy__sweep";
    sweepEl.setAttribute("data-ces-part", "sweep");
    energyEl.appendChild(sweepEl);
    trackEl.appendChild(energyEl);

    var starsEl = doc.createElement("div");
    starsEl.className = "ces-stars";
    starsEl.setAttribute("data-ces-part", "stars");

    var starNodes = [];
    for (var sIdx = 0; sIdx < PARTICLES.length; sIdx += 1) {
      var p = PARTICLES[sIdx];
      var starEl = doc.createElement("span");
      starEl.className = "ces-star";
      starEl.setAttribute("data-ces-part", "star");
      starEl.style.top = p.y + "%";
      starEl.style.display = "none";

      var dotEl = doc.createElement("span");
      dotEl.className = "ces-star__dot";
      dotEl.setAttribute("data-ces-part", "particle");
      var bStr = p.brightness.toFixed(3);
      dotEl.setAttribute("data-brightness", bStr);
      dotEl.style.setProperty("--ces-b", bStr);
      starEl.appendChild(dotEl);

      starsEl.appendChild(starEl);
      starNodes.push({ el: starEl, dot: dotEl, meta: p });
    }
    trackEl.appendChild(starsEl);

    var ticksEl = doc.createElement("div");
    ticksEl.className = "ces-ticks";
    ticksEl.setAttribute("data-ces-part", "ticks");
    trackEl.appendChild(ticksEl);

    var claudeCanvasEl = doc.createElement("canvas");
    claudeCanvasEl.className = "ces-claude-canvas";
    claudeCanvasEl.setAttribute("data-ces-part", "claude-canvas");
    claudeCanvasEl.width = 280;
    claudeCanvasEl.height = TRACK_HEIGHT;
    trackEl.appendChild(claudeCanvasEl);

    var knobEl = doc.createElement("div");
    knobEl.className = "ces-knob";
    knobEl.setAttribute("data-ces-part", "knob");
    var knobNotchEl = doc.createElement("div");
    knobNotchEl.className = "ces-knob-notch";
    knobEl.appendChild(knobNotchEl);
    trackEl.appendChild(knobEl);

    rootEl.appendChild(trackEl);
    container.appendChild(rootEl);

    // ── 内部状态机 ──────────────────────────────────────────────────────────
    var destroyed = false;
    var activeSettings = readSettings(win);
    var rafId = null;
    var lastFrameMs = 0;

    var claudeRafId = null;
    var claudeAnimStart = 0;
    // 点阵流动相位（秒）：按「帧间隔 × 当前速度倍率」累加，而不是 elapsed × 倍率，
    // 这样拖动中速度连续变化时波纹不会因倍率突变而跳帧/倒退
    var claudeFlowTime = 0;
    var claudeClock = 0;
    var claudeLastTs = 0;
    // applyVisualPct 提供绘制状态，ResizeObserver 提供尺寸；绘制帧无需读取档位快照。
    var claudeIntensity = 0;
    var claudeEnergy = 0;
    var claudeSpeed = 0;
    var claudeFill = 0;
    var claudeTheme = "codex";
    var claudeSubTheme = "matrix";
    var claudePal = mt.CODEX_PALETTE;
    var claudeMotion = activeSettings.motion || "fast";
    var claudeTrackWidth = claudeCanvasEl.width;
    var claudeTrackHeight = claudeCanvasEl.height;
    var claudeThemeCheckedAt = -Infinity;
    var claudeIsDark = true;
    var claudeContext;
    var trackResizeObserver = typeof win?.ResizeObserver === "function"
      ? new win.ResizeObserver(function (entries) {
          if (destroyed) return;
          var rect = entries[0].contentRect;
          if (rememberClaudeTrackSize(rect) && claudeIntensity > 0) startClaudeCanvasAnimation();
        })
      : null;
    trackResizeObserver?.observe(trackEl);

    var dragging = false;
    var hasDragged = false;
    var buttonDown = false;
    var draftPct = null;
    var draftIndex = null;
    var snapIndex = null;
    var detentIndex = -1;
    var lastShownMax = null;

    var lastPtrPct = null;
    var lastPtrMs = 0;
    var ptrSpeed = 0;

    var motionState = null;
    var tickNodes = [];
    var lastRenderedTickCount = -1;
    var lastAppliedEnergy = -1;
    var lastAppliedSlowdown = -1;

    function nowMs() {
      if (win && win.performance && typeof win.performance.now === "function") {
        return win.performance.now();
      }
      return Date.now();
    }

    function readSeatSnapshot() {
      var rawLevels = (seat && Array.isArray(seat.effortLevels) ? seat.effortLevels : []).slice();
      var levels = rawLevels.map(function (item) {
        var key = extractEffortKey(item);
        return {
          raw: item,
          effort: key,
          label: extractEffortDisplayLabel(item, key, seat)
        };
      });
      var count = levels.length;
      var curEffort = extractEffortKey(seat && seat.currentEffort);
      var officialIndex = 0;
      for (var i = 0; i < count; i += 1) {
        if (String(levels[i].effort).toLowerCase() === String(curEffort).toLowerCase()) {
          officialIndex = i;
          break;
        }
      }
      var locked = Boolean((seat && seat.locked) || count <= 1);
      // Models without an explicit tier use full effects without exposing a synthetic tier to the host.
      var visualMax = count === 1 && levels[0].label === "";
      var stops = energyStopsFor(levels);
      var baseName = (seat && seat.baseName) || (seat && seat.modelName) || "";
      var theme = mt.resolveThemeFamily(baseName, activeSettings.theme);
      var pal = mt.resolvePalette(baseName, theme);
      var isClaude = theme === "claude";
      return {
        baseName: baseName,
        isClaude: isClaude,
        theme: theme,
        pal: pal,
        element: pal.id,
        levels: levels,
        count: count,
        officialIndex: officialIndex,
        locked: locked,
        visualMax: visualMax,
        energyStart: stops.start,
        energyEnd: stops.end,
        hasOffFirst: stops.hasOffFirst
      };
    }

    function currentShownIndex(snap) {
      if (dragging && draftIndex !== null) return draftIndex;
      if (snapIndex !== null) return snapIndex;
      return snap.officialIndex;
    }

    function ensureMotion(snap) {
      if (!motionState) {
        var initPct = pctFromIndex(currentShownIndex(snap), snap.count);
        motionState = {
          x: initPct,
          v: 0,
          a: 0,
          target: initPct
        };
      }
      return motionState;
    }

    function syncHeaderAndTrigger(snap, showIdx, energy, pct) {
      var count = snap.count;
      var safeIdx = Math.max(0, Math.min(Math.max(0, count - 1), showIdx));
      var levelItem = snap.levels[safeIdx];
      var label = levelItem ? levelItem.label : "";
      var isMax = snap.visualMax || (!snap.locked && count > 1 && safeIdx === count - 1 && !isOffLevel(label));
      var accentRgb = (snap.pal && snap.pal.core) ? snap.pal.core.join(", ") : "139, 92, 246";
      var motionTag = activeSettings.motion || "fast";

      // Preview the same max-tier effect on drag, tap, and keyboard changes.
      if (lastShownMax !== null && isMax !== lastShownMax) {
        if (isMax) triggerMaxEffects(snap.pal, snap.isClaude);
        else clearMaxEffects();
      }
      lastShownMax = isMax;

      var rowEl =
        opts.row ||
        (container.closest &&
          (container.closest(".ces-ag-effort-row") ||
            container.closest('[data-ces-effort-row="true"]') ||
            container.closest('[role="menuitem"]')));

      if (rowEl) {
        if (rowEl.getAttribute("data-ces-effort-row") !== "true") {
          rowEl.setAttribute("data-ces-effort-row", "true");
        }
        if (rowEl.getAttribute("data-motion") !== motionTag) {
          rowEl.setAttribute("data-motion", motionTag);
        }
        if (rowEl.style && typeof rowEl.style.setProperty === "function") {
          rowEl.style.setProperty("--ces-accent-rgb", accentRgb);
        }
        if (isMax) {
          if (rowEl.getAttribute("data-ces-max") !== "true") {
            rowEl.setAttribute("data-ces-max", "true");
          }
        } else if (rowEl.hasAttribute("data-ces-max")) {
          rowEl.removeAttribute("data-ces-max");
        }
      }

      var valEl = opts.valueElement;
      if (valEl) {
        if (valEl.textContent !== label) {
          valEl.textContent = label;
          // 无论是 Claude 还是 Gemini / Codex，文字切换时统一触发顺滑向上翻转动效
          if (label && !prefersReducedMotion(win)) {
            if (valEl.__cesRiseTimer) {
              clearTimeout(valEl.__cesRiseTimer);
              valEl.__cesRiseTimer = null;
            }
            replayCssAnimations(valEl, ["ces-text-rise", "is-claude-changing"], ["ces-claude-rise"]);
            valEl.__cesRiseTimer = setTimeout(function () {
              if (valEl && valEl.classList) {
                valEl.classList.remove("ces-text-rise");
                valEl.classList.remove("is-claude-changing");
              }
              valEl.__cesRiseTimer = null;
            }, motionTag === "full" ? 380 : 240);
          }
        }
        var vColor = snap.locked ? "" : valueColorFor(label, safeIdx, count, isMax, snap.hasOffFirst, snap.theme, snap.baseName) || "";
        if (valEl.style && valEl.style.color !== vColor) {
          valEl.style.color = vColor;
        }
      }

      if (typeof opts.onVisualChange === "function") {
        try {
          opts.onVisualChange({
            index: safeIdx,
            count: count,
            label: label,
            effort: levelItem ? levelItem.effort : "",
            isMax: isMax,
            locked: snap.locked,
            baseName: snap.baseName,
            theme: snap.theme,
            element: snap.element,
            energy: typeof energy === "number" ? energy : 0,
            pct: typeof pct === "number" ? pct : 0
          });
        } catch (err) {
          // 忽略外部视觉回调错误
        }
      }
    }

    function renderTicks(snap, effectivePct) {
      var settings = activeSettings;
      var tickMode = settings.ticks || "highlight";
      var count = snap.count;

      if (tickMode === "hidden" || count <= 1) {
        if (ticksEl.style.display !== "none") {
          ticksEl.style.display = "none";
        }
        return;
      }
      if (ticksEl.style.display !== "") {
        ticksEl.style.display = "";
      }

      if (lastRenderedTickCount !== count) {
        ticksEl.innerHTML = "";
        tickNodes = [];
        for (var i = 0; i < count; i += 1) {
          var tick = doc.createElement("span");
          tick.className = "ces-tick";
          tick.setAttribute("data-ces-part", "tick");
          var tickPct = pctFromIndex(i, count);
          tick.style.left = knobOffsetOf(tickPct, KNOB_RADIUS);
          ticksEl.appendChild(tick);
          tickNodes.push({ el: tick, pct: tickPct });
        }
        lastRenderedTickCount = count;
      }

      for (var j = 0; j < tickNodes.length; j += 1) {
        var node = tickNodes[j];
        var reached = effectivePct + 1e-4 >= node.pct;
        var nextTickClass = tickMode === "dim" ? "ces-tick is-dim" : reached ? "ces-tick is-on" : "ces-tick";
        if (node.el.className !== nextTickClass) {
          node.el.className = nextTickClass;
        }
      }
    }

    function stopClaudeCanvasAnimation() {
      if (claudeRafId !== null && win && typeof win.cancelAnimationFrame === "function") {
        win.cancelAnimationFrame(claudeRafId);
      }
      claudeRafId = null;
    }

    function rememberClaudeTrackSize(rect) {
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      var height = Math.round(rect.height);
      if (rect.width === claudeTrackWidth && height === claudeTrackHeight) return false;
      claudeTrackWidth = rect.width;
      claudeTrackHeight = height;
      return true;
    }

    function stepClaudeCanvas(nowTs) {
      claudeRafId = null;
      if (destroyed || claudeIntensity <= 0) return;
      var now = typeof nowTs === "number" && nowTs > 0 ? nowTs : nowMs();
      var elapsed = Math.max(0, now - claudeAnimStart);
      var reducedMotion = prefersReducedMotion(win);
      var sweepMs = claudeMotion === "full" ? CLAUDE_SWEEP_MS : 640;
      var progress = reducedMotion ? 1 : Math.min(1, elapsed / sweepMs);
      // 相位按帧累加：dt 上限 50ms，防止切后台回来后一次性跳很远
      var frameDt = claudeLastTs > 0 ? Math.min(0.05, Math.max(0, (now - claudeLastTs) / 1000)) : 0;
      claudeLastTs = now;
      var flowMul = claudeMotion === "full" ? 0.74 : 1.25;
      claudeClock += frameDt * flowMul;
      if (claudeTheme === "gemini") {
        claudeFlowTime += frameDt * mt.speedForElement(claudePal, claudeEnergy) * flowMul;
      } else {
        claudeFlowTime += frameDt * claudeSpeed * ((claudePal && claudePal.speedMul) || 1) * flowMul;
      }
      if (now - claudeThemeCheckedAt >= 500) {
        claudeIsDark = surfaceIsDark(win, doc);
        claudeThemeCheckedAt = now;
      }
      if (!trackResizeObserver) rememberClaudeTrackSize(trackEl.getBoundingClientRect?.());
      // 画布像素宽度 = 已填充宽度（圆钮中心），与 CSS width: var(--ces-fill) 对齐
      var tw = Math.max(1, Math.round(KNOB_RADIUS + (claudeTrackWidth - KNOB_RADIUS * 2) * claudeFill));
      var dpr = Math.min((win && win.devicePixelRatio) || 1, 2);
      var pxW = Math.max(1, Math.round(tw * dpr));
      var pxH = Math.max(1, Math.round(claudeTrackHeight * dpr));
      if (claudeCanvasEl.width !== pxW) claudeCanvasEl.width = pxW;
      if (claudeCanvasEl.height !== pxH) claudeCanvasEl.height = pxH;
      if (claudeContext === undefined) claudeContext = claudeCanvasEl.getContext?.("2d") ?? null;
      if (claudeContext) {
        if (typeof claudeContext.setTransform === "function") {
          claudeContext.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        if (claudeTheme === "gemini") {
          claudeContext.clearRect(0, 0, tw, claudeTrackHeight);
          mt.paintGeminiSlider(claudeContext, claudePal, claudeSubTheme, tw, claudeTrackHeight, claudeFlowTime, claudeClock, claudeEnergy, { glass: true, glassStrength: 0.62 });
        } else if (claudeSubTheme === "bars" || claudeSubTheme === "spark") {
          claudeContext.clearRect(0, 0, tw, claudeTrackHeight);
          claudeContext.globalAlpha = 0.35 + 0.65 * progress;
          mt.paintClaudeSlider(claudeContext, claudePal, claudeSubTheme, tw, claudeTrackHeight, claudeFlowTime * 0.72, claudeClock, claudeEnergy, { fillBase: true, glass: true, glassStrength: 0.54 });
          claudeContext.globalAlpha = 1;
        } else {
          paintDither(claudeContext, tw, claudeTrackHeight, claudeIsDark, progress, claudeFlowTime, claudeIntensity, claudePal);
        }
      }
      if (!reducedMotion && win && typeof win.requestAnimationFrame === "function") {
        claudeRafId = win.requestAnimationFrame(stepClaudeCanvas);
      }
    }

    function startClaudeCanvasAnimation() {
      if (destroyed || claudeRafId !== null) return;
      if (win && typeof win.requestAnimationFrame === "function") {
        claudeRafId = win.requestAnimationFrame(stepClaudeCanvas);
      } else {
        stepClaudeCanvas(nowMs());
      }
    }

    function applyVisualPct(snap, effectivePct, showIdx) {
      var p = snap.visualMax ? 1 : clamp01(effectivePct);
      var count = snap.count;
      var safeIdx = Math.max(0, Math.min(Math.max(0, count - 1), showIdx));
      var levelItem = snap.levels[safeIdx];
      var label = levelItem ? levelItem.label : "";

      var theme = snap.theme || "codex";
      var elementTag = snap.element || "codex";
      var accentRgb = (snap.pal && snap.pal.core) ? snap.pal.core.join(", ") : "139, 92, 246";
      var motionTag = activeSettings.motion || "fast";
      if (rootEl.getAttribute("data-theme") !== theme) rootEl.setAttribute("data-theme", theme);
      if (trackEl.getAttribute("data-theme") !== theme) trackEl.setAttribute("data-theme", theme);
      if (rootEl.getAttribute("data-element") !== elementTag) rootEl.setAttribute("data-element", elementTag);
      if (rootEl.getAttribute("data-motion") !== motionTag) rootEl.setAttribute("data-motion", motionTag);
      rootEl.style.setProperty("--ces-accent-rgb", accentRgb);
      if (container && container.setAttribute) {
        if (container.getAttribute("data-theme") !== theme) container.setAttribute("data-theme", theme);
        if (container.getAttribute("data-element") !== elementTag) container.setAttribute("data-element", elementTag);
        if (container.style) container.style.setProperty("--ces-accent-rgb", accentRgb);
      }

      // Keep the unlocked slider reachable by keyboard in agy-capsule’s popover.
      var nextTabIndex = snap.locked ? "-1" : "0";
      if (rootEl.getAttribute("tabindex") !== nextTabIndex) rootEl.setAttribute("tabindex", nextTabIndex);
      if (rootEl.getAttribute("aria-valuemin") !== "0") rootEl.setAttribute("aria-valuemin", "0");
      var nextValMax = String(Math.max(0, count - 1));
      if (rootEl.getAttribute("aria-valuemax") !== nextValMax) rootEl.setAttribute("aria-valuemax", nextValMax);
      var nextValNow = String(safeIdx);
      if (rootEl.getAttribute("aria-valuenow") !== nextValNow) rootEl.setAttribute("aria-valuenow", nextValNow);
      if (label) {
        if (rootEl.getAttribute("aria-valuetext") !== label) rootEl.setAttribute("aria-valuetext", label);
      } else if (rootEl.hasAttribute("aria-valuetext")) rootEl.removeAttribute("aria-valuetext");
      var nextDisabled = snap.locked ? "true" : "false";
      if (rootEl.getAttribute("aria-disabled") !== nextDisabled) rootEl.setAttribute("aria-disabled", nextDisabled);

      if (snap.locked && !snap.visualMax) {
        if (!trackEl.classList.contains("is-locked")) trackEl.classList.add("is-locked");
      } else if (trackEl.classList.contains("is-locked")) {
        trackEl.classList.remove("is-locked");
      }
      trackEl.style.cursor = snap.visualMax ? "not-allowed" : "";

      var offsetCss = knobOffsetOf(p, KNOB_RADIUS);
      var fillBg = fillBackgroundFor(p, snap.energyStart, snap.energyEnd, theme, snap.pal);
      trackEl.style.setProperty("--ces-fill", offsetCss);
      trackEl.style.setProperty("--ces-fill-bg", fillBg);
      fillEl.style.width = offsetCss;
      fillEl.style.background = fillBg;
      energyEl.style.width = offsetCss;
      starsEl.style.width = offsetCss;
      knobEl.style.left = offsetCss;

      var animateTrack = !snap.locked || snap.visualMax;
      var energy = animateTrack ? energyForPct(p, snap.energyStart) : 0;
      var usesCanvas = theme === "claude" || theme === "gemini";
      var prevSub = claudeSubTheme;
      var prevTheme = claudeTheme;
      claudeTheme = theme;
      claudePal = snap.pal;
      claudeSubTheme = theme === "gemini" ? (activeSettings.geminiTheme || "physical") : (activeSettings.claudeTheme || "matrix");
      claudeMotion = motionTag;
      claudeEnergy = energy;
      claudeIntensity = usesCanvas && animateTrack
        ? (theme === "claude" ? claudeIntensityFor(p, snap.energyStart) : (energy > 0 ? energy : 0))
        : 0;
      claudeSpeed = claudeSpeedFor(p, snap.energyStart);
      claudeFill = p;
      if (claudeIntensity > 0) {
        if (claudeCanvasEl.style.display !== "block" || prevSub !== claudeSubTheme || prevTheme !== claudeTheme) {
          claudeCanvasEl.style.display = "block";
          claudeAnimStart = nowMs();
          claudeLastTs = 0;
          claudeThemeCheckedAt = -Infinity;
        }
        startClaudeCanvasAnimation();
      } else {
        if (claudeCanvasEl.style.display !== "none") {
          claudeCanvasEl.style.display = "none";
        }
        stopClaudeCanvasAnimation();
      }

      var modeNow = motionMode(win, activeSettings);
      var slowdown = modeNow === "quick" ? REDUCED_MOTION_SLOWDOWN : modeNow === "full" ? 1.35 : 0.8;
      if (Math.abs(energy - lastAppliedEnergy) > 1e-5 || slowdown !== lastAppliedSlowdown) {
        lastAppliedEnergy = energy;
        lastAppliedSlowdown = slowdown;

        var energyOn = energy > 0 ? "1" : "0";
        var energyStr = String(Math.round(energy * 1000) / 1000);
        if (rootEl.getAttribute("data-energy") !== energyOn) rootEl.setAttribute("data-energy", energyOn);
        rootEl.style.setProperty("--ces-energy", energyStr);
        if (container && container.setAttribute) {
          if (container.getAttribute("data-energy") !== energyOn) container.setAttribute("data-energy", energyOn);
          if (container.style) container.style.setProperty("--ces-energy", energyStr);
        }

        var starLayerOpacity = starLayerOpacityFor(energy);
        trackEl.style.setProperty("--ces-star-opacity", String(starLayerOpacity));
        starsEl.style.opacity = String(starLayerOpacity);

        var visibleCount = Math.round(energy * PARTICLES.length);
        var speedFactor = speedFor(p, snap.energyStart);
        starsEl.setAttribute("data-count", String(visibleCount));

        for (var i = 0; i < starNodes.length; i += 1) {
          var sNode = starNodes[i];
          var dur = starDurationFor(i, speedFactor) * slowdown;
          var delay = starDelayFor(i, dur);
          sNode.el.style.display = i < visibleCount ? "" : "none";
          sNode.el.style.animationDuration = dur.toFixed(3) + "s";
          sNode.el.style.animationDelay = delay.toFixed(3) + "s";
        }
      }

      renderTicks(snap, p);
      syncHeaderAndTrigger(snap, safeIdx, energy, p);
    }

    function stopFrames() {
      if (rafId !== null && win && typeof win.cancelAnimationFrame === "function") {
        win.cancelAnimationFrame(rafId);
      }
      rafId = null;
      lastFrameMs = 0;
    }

    function stepFrame(ts) {
      rafId = null;
      if (destroyed) return;
      var snap = readSeatSnapshot();
      var m = ensureMotion(snap);
      var mode = motionMode(win, activeSettings);
      var params = motionParamsForMode(mode);

      var now = typeof ts === "number" && ts > 0 ? ts : nowMs();
      var dt = lastFrameMs > 0 ? (now - lastFrameMs) / 1000 : 1 / 60;
      lastFrameMs = now;

      motionStep(m, dt, params);
      var showIdx = currentShownIndex(snap);
      applyVisualPct(snap, m.x, showIdx);

      if (!motionSettled(m, params)) {
        startFrames();
      } else {
        m.x = clamp01(m.target);
        m.v = 0;
        m.a = 0;
        if (!dragging) {
          snapIndex = null;
        }
        applyVisualPct(snap, m.x, currentShownIndex(snap));
      }
    }

    function startFrames() {
      if (destroyed || rafId !== null) return;
      if (win && typeof win.requestAnimationFrame === "function") {
        rafId = win.requestAnimationFrame(stepFrame);
      } else {
        stepFrame(nowMs());
      }
    }

    function clearMaxEffects() {
      var valEl = opts.valueElement;
      if (valEl && valEl.classList && valEl.classList.contains("is-glowing")) {
        valEl.classList.remove("is-glowing");
        if (valEl.__cesGlowTimer) {
          clearTimeout(valEl.__cesGlowTimer);
          valEl.__cesGlowTimer = null;
        }
      }
    }

    function triggerMaxEffects(pal, isClaude) {
      if (prefersReducedMotion(win)) return;

      // 到达最高档时的模糊光斑爆散（随快速/慢速调整时长，并匹配当前元素色）
      var valEl = opts.valueElement;
      if (valEl && valEl.classList) {
        var glowColor = (pal && pal.core)
          ? "rgba(" + pal.core[0] + ", " + pal.core[1] + ", " + pal.core[2] + ", 0.9)"
          : (isClaude ? "rgba(224, 123, 83, 0.9)" : "rgba(168, 85, 247, 0.9)");
        if (valEl.style && typeof valEl.style.setProperty === "function") {
          valEl.style.setProperty("--ces-glow-color", glowColor);
        }
        replayCssAnimations(valEl, ["is-glowing"], ["ces-text-bloom", "ces-glow-flash"], true);
        if (valEl.__cesGlowTimer) {
          clearTimeout(valEl.__cesGlowTimer);
        }
        valEl.__cesGlowTimer = setTimeout(function () {
          if (valEl && valEl.classList) valEl.classList.remove("is-glowing");
          valEl.__cesGlowTimer = null;
        }, activeSettings.motion === "full" ? 480 : 300);
      }
    }

    function commitAtIndex(targetIndex, reason) {
      var snap = readSeatSnapshot();
      if (snap.locked || snap.count <= 1) return;
      var clampedIdx = Math.max(0, Math.min(snap.count - 1, targetIndex));
      var item = snap.levels[clampedIdx];
      if (!item) return;

      if (seat && typeof seat.selectEffort === "function") {
        try {
          seat.selectEffort(item.raw !== undefined ? item.raw : item.effort, clampedIdx);
        } catch (err) {
        }
      }
      if (typeof opts.onCommit === "function") {
        try {
          opts.onCommit(item, clampedIdx, reason);
        } catch (err) {
          // 忽略外部回调异常
        }
      }
    }

    function pctAtClientX(clientX) {
      var rect = trackEl.getBoundingClientRect ? trackEl.getBoundingClientRect() : null;
      if (!rect || !(rect.width > 0)) return null;
      var usable = Math.max(1, rect.width - KNOB_RADIUS * 2);
      var raw = (clientX - rect.left - KNOB_RADIUS) / usable;
      return clamp01(raw);
    }

    function moveToClientX(clientX, isInitialDown) {
      var snap = readSeatSnapshot();
      if (snap.locked || snap.count <= 0) return;

      var ptrPct = pctAtClientX(clientX);
      if (ptrPct === null) ptrPct = pctFromIndex(snap.officialIndex, snap.count);

      var now = nowMs();
      if (lastPtrPct !== null && lastPtrMs > 0) {
        var dt = (now - lastPtrMs) / 1000;
        if (dt > 1e-4 && dt < 0.25) {
          var instSpeed = (ptrPct - lastPtrPct) / dt;
          ptrSpeed = ptrSpeed * (1 - POINTER_SPEED_EMA) + instSpeed * POINTER_SPEED_EMA;
        }
      } else {
        ptrSpeed = 0;
      }
      lastPtrPct = ptrPct;
      lastPtrMs = now;

      var mode = motionMode(win, activeSettings);
      // 统一按 1/2 中点就近切档，不使用 1/3 棘轮阈值
      var nowIndex = indexFromPct(ptrPct, snap.count);
      var targetPct = ptrPct;

      draftPct = ptrPct;
      draftIndex = nowIndex;

      var m = ensureMotion(snap);
      if (isInitialDown && mode !== "quick") {
        // 按下轨道点击档位时保留当前位置并从原位平滑滑向目标，不再瞬移
        m.target = pctFromIndex(nowIndex, snap.count);
        applyVisualPct(snap, m.x, nowIndex);
        startFrames();
      } else {
        m.target = targetPct;
        m.x = targetPct;
        m.v = 0;
        m.a = 0;
        stopFrames();
        applyVisualPct(snap, m.x, nowIndex);
      }
    }

    function endDrag(clientX, cancelled = false) {
      if (!dragging) return;
      var snap = readSeatSnapshot();
      var ptrPct = draftPct !== null ? draftPct : pctFromIndex(snap.officialIndex, snap.count);
      if (typeof clientX === "number") {
        var p = pctAtClientX(clientX);
        if (p !== null) ptrPct = p;
      }

      var mode = motionMode(win, activeSettings);
      // 统一按 1/2 中点落点确定档位，不叠加松手甩动惯性
      var finalIndex = cancelled ? snap.officialIndex : indexFromPct(ptrPct, snap.count);

      var wasDragged = hasDragged;
      dragging = false;
      hasDragged = false;
      buttonDown = false;
      draftPct = null;
      draftIndex = null;
      detentIndex = -1;
      lastPtrPct = null;
      ptrSpeed = 0;
      snapIndex = finalIndex;

      if (!cancelled && finalIndex !== snap.officialIndex) {
        commitAtIndex(finalIndex, "release");
      }

      var m = ensureMotion(snap);
      m.target = pctFromIndex(finalIndex, snap.count);

      if (mode === "quick") {
        m.x = m.target;
        m.v = 0;
        m.a = 0;
        snapIndex = null;
        stopFrames();
        applyVisualPct(readSeatSnapshot(), m.x, finalIndex);
      } else {
        if (wasDragged) {
          m.x = ptrPct;
          m.v = 0;
          m.a = 0;
        }
        applyVisualPct(readSeatSnapshot(), m.x, finalIndex);
        startFrames();
      }
    }

    function swallowEvent(ev) {
      if (!ev) return;
      if (typeof ev.stopPropagation === "function") ev.stopPropagation();
    }

    var downClientX = NaN;

    function onPointerDown(ev) {
      if (ev && typeof ev.button === "number" && ev.button !== 0) return;
      var snap = readSeatSnapshot();
      if (snap.locked || snap.count <= 1) return;
      swallowEvent(ev);
      if (typeof ev.preventDefault === "function") ev.preventDefault();

      dragging = true;
      hasDragged = false;
      downClientX = Number(ev && ev.clientX);
      buttonDown = true;
      detentIndex = snap.officialIndex;
      snapIndex = null;
      lastPtrPct = null;

      try {
        if (trackEl.setPointerCapture && ev.pointerId !== undefined) {
          trackEl.setPointerCapture(ev.pointerId);
        }
      } catch (err) {
        // 忽略不支持 pointerCapture 的环境
      }

      moveToClientX(ev.clientX, true);
    }

    function onPointerMove(ev) {
      if (!dragging) return;
      if (ev && ev.buttons === 0 && !buttonDown) return;
      swallowEvent(ev);
      var cx = Number(ev && ev.clientX);
      if (!hasDragged && (!Number.isFinite(downClientX) || !Number.isFinite(cx) || Math.abs(cx - downClientX) >= 1)) {
        hasDragged = true;
      }
      moveToClientX(ev.clientX, false);
    }

    function onPointerUp(ev) {
      if (!dragging) return;
      swallowEvent(ev);
      endDrag(ev && typeof ev.clientX === "number" ? ev.clientX : undefined);
      try {
        if (trackEl.releasePointerCapture && ev && ev.pointerId !== undefined) {
          trackEl.releasePointerCapture(ev.pointerId);
        }
      } catch (err) {
        // 忽略释放失败
      }
    }

    function onPointerCancel(ev) {
      if (!dragging) return;
      swallowEvent(ev);
      endDrag(undefined, true);
    }

    function onKeyDown(ev) {
      var snap = readSeatSnapshot();
      if (snap.locked || snap.count <= 1) return;
      var key = ev && ev.key;
      var curIdx = currentShownIndex(snap);
      var nextIdx = null;
      if (key === "ArrowLeft" || key === "ArrowDown") {
        nextIdx = Math.max(0, curIdx - 1);
      } else if (key === "ArrowRight" || key === "ArrowUp") {
        nextIdx = Math.min(snap.count - 1, curIdx + 1);
      } else if (key === "Home") {
        nextIdx = 0;
      } else if (key === "End") {
        nextIdx = snap.count - 1;
      } else {
        return;
      }
      swallowEvent(ev);
      if (typeof ev.preventDefault === "function") ev.preventDefault();

      snapIndex = nextIdx;
      commitAtIndex(nextIdx, "key");
      var m = ensureMotion(snap);
      m.target = pctFromIndex(nextIdx, snap.count);

      if (motionMode(win, activeSettings) === "quick") {
        m.x = m.target;
        m.v = 0;
        m.a = 0;
        snapIndex = null;
        stopFrames();
        applyVisualPct(readSeatSnapshot(), m.x, nextIdx);
      } else {
        applyVisualPct(readSeatSnapshot(), m.x, nextIdx);
        startFrames();
      }
    }

    // 阻断 click / mouseup 冒泡到外层 MenuItem，防止拖动松手时意外关闭官方菜单
    function onBlockMenuClose(ev) {
      swallowEvent(ev);
    }

    trackEl.addEventListener("pointerdown", onPointerDown);
    trackEl.addEventListener("pointermove", onPointerMove);
    trackEl.addEventListener("pointerup", onPointerUp);
    trackEl.addEventListener("pointercancel", onPointerCancel);
    trackEl.addEventListener("lostpointercapture", onPointerCancel);
    trackEl.addEventListener("click", onBlockMenuClose);
    trackEl.addEventListener("mouseup", onBlockMenuClose);
    rootEl.addEventListener("keydown", onKeyDown);

    function syncFromExternal() {
      if (destroyed || dragging) return;
      var snap = readSeatSnapshot();
      var m = ensureMotion(snap);
      var targetIdx = snap.officialIndex;
      var targetPct = pctFromIndex(targetIdx, snap.count);
      m.target = targetPct;

      if (
        snap.locked ||
        motionMode(win, activeSettings) === "quick" ||
        motionSettled(m, motionParamsForMode(motionMode(win, activeSettings)))
      ) {
        m.x = targetPct;
        m.v = 0;
        m.a = 0;
        snapIndex = null;
        stopFrames();
        applyVisualPct(snap, m.x, targetIdx);
      } else {
        applyVisualPct(snap, m.x, targetIdx);
        startFrames();
      }
    }

    var offSeat =
      seat && typeof seat.subscribe === "function"
        ? seat.subscribe(function () {
            syncFromExternal();
          })
        : function () {};

    var offSettings = onSettingsChange(function (next) {
      activeSettings = next;
      var snap = readSeatSnapshot();
      var m = ensureMotion(snap);
      applyVisualPct(snap, m.x, currentShownIndex(snap));
    }, win);

    // 首次同步渲染
    var initSnap = readSeatSnapshot();
    var initMotion = ensureMotion(initSnap);
    initMotion.x = pctFromIndex(initSnap.officialIndex, initSnap.count);
    initMotion.target = initMotion.x;
    applyVisualPct(initSnap, initMotion.x, initSnap.officialIndex);

    return {
      unmount: function () {
        destroyed = true;
        stopFrames();
        stopClaudeCanvasAnimation();
        trackResizeObserver?.disconnect();
        clearMaxEffects();
        var valEl = opts.valueElement;
        if (valEl && valEl.__cesRiseTimer) {
          clearTimeout(valEl.__cesRiseTimer);
          valEl.__cesRiseTimer = null;
        }
        valEl?.classList.remove("ces-text-rise", "is-claude-changing");
        if (typeof offSeat === "function") offSeat();
        if (typeof offSettings === "function") offSettings();
        trackEl.removeEventListener("pointerdown", onPointerDown);
        trackEl.removeEventListener("pointermove", onPointerMove);
        trackEl.removeEventListener("pointerup", onPointerUp);
        trackEl.removeEventListener("pointercancel", onPointerCancel);
        trackEl.removeEventListener("lostpointercapture", onPointerCancel);
        trackEl.removeEventListener("click", onBlockMenuClose);
        trackEl.removeEventListener("mouseup", onBlockMenuClose);
        rootEl.removeEventListener("keydown", onKeyDown);
        if (rootEl.parentNode === container) {
          container.removeChild(rootEl);
        }
      },
      refresh: function () {
        syncFromExternal();
      }
    };
  }

  return { mountCodexEffortSlider, readSettings, writeSettings, onSettingsChange, valueColorFor, applySidecarPrefs, readPendingPatch, ackPendingPatch };
}

export const UPSTREAM_EFFORT_CSS = `
@keyframes ces-sweep {
  0% { transform: translateX(100%); }
  100% { transform: translateX(-100%); }
}
@keyframes ces-star-sweep {
  0% { transform: translate3d(0, 0, 0); opacity: 0; }
  6% { opacity: 1; }
  94% { opacity: 1; }
  100% { transform: translate3d(-100%, 0, 0); opacity: 0; }
}
.ces-inline {
  width: 100%;
  box-sizing: border-box;
  padding-top: 6px;
  user-select: none !important;
  -webkit-user-select: none !important;
}
.ces-root,
.ces-root:focus,
.ces-root:focus-visible,
.ces-root:focus-within {
  position: relative;
  width: 100%;
  box-sizing: border-box;
  box-shadow: none !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  -webkit-tap-highlight-color: transparent !important;
}
.ces-track {
  position: relative;
  width: 100%;
  height: 28px;
  border-radius: 999px;
  background: rgba(128, 128, 145, 0.18);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.24), inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  cursor: pointer;
  touch-action: none;
  box-sizing: border-box;
  transition: opacity 0.15s ease, box-shadow 0.2s ease, border-radius 0.18s ease;
}
.ces-inline[data-energy='1'] .ces-track,
.ces-root[data-energy='1'] .ces-track {
  box-shadow: 0 0 calc(var(--ces-energy, 0) * 14px) rgba(var(--ces-accent-rgb, 168, 85, 247), 0.42), inset 0 1px 2px rgba(0, 0, 0, 0.24);
}
.ces-inline[data-energy='0'] .ces-star,
.ces-inline[data-energy='0'] .ces-energy__sweep,
.ces-root[data-energy='0'] .ces-star,
.ces-root[data-energy='0'] .ces-energy__sweep {
  animation-play-state: paused;
}
.ces-track.is-locked {
  opacity: 0.45;
  cursor: not-allowed;
  filter: saturate(0.25);
}
.ces-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: var(--ces-fill, 14px);
  border-radius: 14px 0 0 14px;
  background: var(--ces-fill-bg, #4d93f8);
  pointer-events: none;
  will-change: width, background;
}
.ces-energy {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: var(--ces-fill, 14px);
  border-radius: 14px 0 0 14px;
  overflow: hidden;
  pointer-events: none;
  opacity: var(--ces-energy, 0);
  transition: opacity 0.2s ease;
  background: linear-gradient(90deg, #3b1178 0%, #6d28d9 30%, #9333ea 62%, #c084fc 100%);
}
.ces-root {
  --ces-sweep-dur: 1.92s;
}
.ces-root[data-motion='full'] {
  --ces-sweep-dur: 3.24s;
}
.ces-energy__sweep {
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 18%, rgba(255, 255, 255, 0.30) 50%, transparent 82%);
  transform: translateX(100%);
  animation: ces-sweep var(--ces-sweep-dur, 1.92s) linear infinite;
  pointer-events: none;
}
.ces-stars {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: var(--ces-fill, 14px);
  border-radius: 14px 0 0 14px;
  opacity: var(--ces-star-opacity, 0);
  transition: opacity 0.2s ease;
  pointer-events: none;
  overflow: hidden;
}
.ces-star {
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  margin-top: -1.5px;
  pointer-events: none;
  animation-name: ces-star-sweep;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
.ces-star__dot {
  position: absolute;
  left: 100%;
  top: 0;
  width: 3px;
  height: 3px;
  margin-left: -1.5px;
  border-radius: 50%;
  background: #f5f3ff;
  box-shadow: 0 0 5px rgba(216, 180, 254, 0.95);
  opacity: var(--ces-b, 1);
  transform: scale(var(--ces-b, 1));
}
.ces-ticks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ces-tick {
  position: absolute;
  top: 50%;
  width: 3px;
  height: 3px;
  margin: -1.5px 0 0 -1.5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.28);
  pointer-events: none;
  transition: background-color 0.12s ease;
}
.ces-tick.is-on {
  background: rgba(255, 255, 255, 0.65);
}
.ces-tick.is-dim {
  background: rgba(255, 255, 255, 0.28);
}
.ces-knob {
  position: absolute;
  top: 50%;
  left: var(--ces-fill, 14px);
  width: 28px;
  height: 28px;
  margin: -14px 0 0 -14px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.34), 0 0 0 0.5px rgba(0, 0, 0, 0.06);
  pointer-events: none;
  will-change: left;
}
/* ── Gemini 元素主题适配 (data-theme='gemini') ── */
.ces-root[data-theme='gemini'] .ces-stars,
.ces-root[data-theme='gemini'] .ces-energy,
.ces-inline[data-theme='gemini'] .ces-stars,
.ces-inline[data-theme='gemini'] .ces-energy {
  display: none !important;
}
.ces-root[data-theme='gemini'] .ces-claude-canvas,
.ces-inline[data-theme='gemini'] .ces-claude-canvas {
  border-radius: 14px 0 0 14px;
}
.ces-root[data-theme='gemini'][data-energy='1'] .ces-claude-canvas,
.ces-inline[data-theme='gemini'][data-energy='1'] .ces-claude-canvas {
  display: block;
}
/* ── Claude 专属主题适配 (data-theme='claude') ── */
.ces-root[data-theme='claude'] .ces-stars,
.ces-root[data-theme='claude'] .ces-energy,
.ces-inline[data-theme='claude'] .ces-stars,
.ces-inline[data-theme='claude'] .ces-energy {
  display: none !important;
}
.ces-root[data-theme='claude'] .ces-track,
.ces-inline[data-theme='claude'] .ces-track {
  height: 28px;
  border-radius: 9px;
  background: rgba(128, 128, 145, 0.16);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.ces-root[data-theme='claude'] .ces-fill,
.ces-inline[data-theme='claude'] .ces-fill {
  border-radius: 9px 0 0 9px;
}
.ces-root[data-theme='claude'][data-energy='1'] .ces-track,
.ces-inline[data-theme='claude'][data-energy='1'] .ces-track {
  box-shadow: 0 0 14px rgba(var(--ces-accent-rgb, 224, 123, 83), 0.42), inset 0 1px 2px rgba(0, 0, 0, 0.22);
}
.ces-root[data-theme='claude'] .ces-knob,
.ces-inline[data-theme='claude'] .ces-knob {
  width: 24px;
  height: 30px;
  margin: -15px 0 0 -12px;
  border-radius: 7px;
  background: #ffffff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4), 0 0 0 0.5px rgba(0, 0, 0, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ces-knob-notch {
  display: none;
  width: 2px;
  height: 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.28);
}
.ces-root[data-theme='claude'] .ces-knob-notch,
.ces-inline[data-theme='claude'] .ces-knob-notch {
  display: block;
}
.ces-claude-canvas {
  position: absolute;
  left: 0;
  top: 0;
  width: var(--ces-fill, 0px);
  height: 100%;
  border-radius: 9px 0 0 9px;
  display: none;
  pointer-events: none;
}
.ces-root[data-theme='claude'][data-energy='1'] .ces-claude-canvas,
.ces-inline[data-theme='claude'][data-energy='1'] .ces-claude-canvas {
  display: block;
}
@keyframes ces-claude-rise {
  0% { transform: translateY(85%) scale(0.96); opacity: 0; }
  55% { opacity: 1; }
  80% { transform: translateY(-6%) scale(1.01); }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
.ces-ag-effort-row {
  --ces-rise-dur: 0.20s;
  --ces-glow-dur: 0.28s;
}
.ces-ag-effort-row[data-motion='full'] {
  --ces-rise-dur: 0.34s;
  --ces-glow-dur: 0.45s;
}
.ces-ag-effort-value.is-claude-changing,
.ces-ag-effort-value.ces-text-rise {
  animation: ces-claude-rise var(--ces-rise-dur, 0.24s) cubic-bezier(0.2, 0.85, 0.25, 1) forwards;
}
/* 当同时触发文字向上翻转与 High 光斑爆散时，以 CSS 复合动画并发执行，防止相互覆盖打断 */
.ces-ag-effort-value.is-claude-changing.is-glowing,
.ces-ag-effort-value.ces-text-rise.is-glowing {
  animation: ces-claude-rise var(--ces-rise-dur, 0.24s) cubic-bezier(0.2, 0.85, 0.25, 1) forwards, ces-text-bloom var(--ces-glow-dur, 0.36s) cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
/* Antigravity 原生模型菜单底部专属「推理等级」区域 */
.ces-ag-section,
.ces-ag-section:focus,
.ces-ag-section:focus-visible,
.ces-ag-section * {
  user-select: none !important;
  -webkit-user-select: none !important;
  -webkit-tap-highlight-color: transparent !important;
}
.ces-ag-section {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 100%;
  box-sizing: border-box;
}
.ces-ag-effort-row {
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px 8px 8px;
  border-radius: 6px;
  transition: box-shadow 0.2s ease, background-color 0.2s ease;
}
.ces-ag-effort-row:hover {
  background-color: rgba(128, 128, 145, 0.08);
}
.ces-ag-effort-row[data-ces-max='true'], [data-ces-effort-row='true'][data-ces-max='true'] {
  box-shadow: inset 0 0 0 1px rgba(var(--ces-accent-rgb, 139, 92, 246), 0.42), 0 0 14px -4px rgba(var(--ces-accent-rgb, 139, 92, 246), 0.42) !important;
  background-color: rgba(var(--ces-accent-rgb, 139, 92, 246), 0.06);
}
.ces-ag-effort-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
  line-height: 16px;
}
.ces-ag-effort-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: inherit;
  font-weight: 500;
  opacity: 0.9;
}
/* ── 'High' 档位文字到达最高档时的模糊光斑爆散 ── */
.ces-ag-effort-value {
  position: relative;
  z-index: 1;
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  transition: color 0.15s ease;
}
.ces-ag-effort-value::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 52px;
  height: 26px;
  border-radius: 999px;
  transform: translate(-50%, -50%) scale(0.6);
  background: radial-gradient(ellipse at center, var(--ces-glow-color, rgba(168, 85, 247, 0.85)) 0%, var(--ces-glow-color, rgba(168, 85, 247, 0.45)) 45%, rgba(168, 85, 247, 0) 75%);
  filter: blur(8px);
  pointer-events: none;
  opacity: 0;
  z-index: -1;
}
@keyframes ces-glow-flash {
  0% {
    opacity: 0.95;
    transform: translate(-50%, -50%) scale(0.65);
    filter: blur(6px);
  }
  25% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.15);
    filter: blur(8px);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.5);
    filter: blur(14px);
  }
}
@keyframes ces-text-bloom {
  0% { text-shadow: 0 0 8px var(--ces-glow-color, #c084fc); }
  30% { text-shadow: 0 0 14px var(--ces-glow-color, #c084fc), 0 0 3px #ffffff; }
  100% { text-shadow: none; }
}
.ces-ag-effort-value.is-glowing {
  animation: ces-text-bloom var(--ces-glow-dur, 0.36s) cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.ces-ag-effort-value.is-glowing::after {
  animation: ces-glow-flash var(--ces-glow-dur, 0.36s) cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@media (prefers-reduced-motion: reduce) {
  .ces-panel-shaking { animation: none !important; }
  .ces-ag-effort-value.is-glowing { animation: none !important; }
  .ces-ag-effort-value.is-glowing::after { animation: none !important; }
  .ces-ag-effort-value.ces-text-rise { animation: none !important; }
  .ces-ag-effort-value.is-claude-changing { animation: none !important; }
}
/* 右键 / 长按 设置浮层 */
.ces-set {
  position: fixed;
  z-index: 2147483646;
  width: 268px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(24, 24, 28, 0.96);
  color: #f4f4f6;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px;
  box-sizing: border-box;
  user-select: none;
}
.ces-set-group:not(:last-child) {
  margin-bottom: 10px;
}
.ces-set-label {
  margin-bottom: 5px;
  font-size: 11px;
  opacity: 0.72;
}
.ces-set-opts {
  display: flex;
  gap: 4px;
}
.ces-set-opt {
  flex: 1;
  padding: 5px 6px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #d4d4d8;
  font-size: 11.5px;
  cursor: pointer;
  text-align: center;
  transition: all 0.12s ease;
}
.ces-set-opt:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}
.ces-set-opt.is-on {
  background: rgba(139, 92, 246, 0.28);
  border-color: rgba(139, 92, 246, 0.75);
  color: #ffffff;
  font-weight: 600;
}
`;
