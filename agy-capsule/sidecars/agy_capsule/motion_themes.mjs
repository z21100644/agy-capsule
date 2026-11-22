// Shared elemental & editorial motion themes for Effort Bar, Orchestrator, and Sidebar preview.
// Self-contained factory so deck_injector.mjs and server.mjs can serialize createMotionThemes.toString().

export function createMotionThemes() {
  var GEMINI_PALETTES = Object.freeze({
    neon: Object.freeze({
      id: 'neon',
      family: 'gemini',
      stops: Object.freeze(['#3d0d26', '#7a193f', '#a82c52', '#bd534a']),
      accent: '#e14d67',
      accentLow: '#c9788b',
      accentMax: '#f06a82',
      back: Object.freeze([135, 42, 76]),
      core: Object.freeze([228, 92, 118]),
      glow: Object.freeze([248, 198, 192]),
      sec: Object.freeze([224, 146, 108]),
      speedMul: 1.0,
    }),
    argon: Object.freeze({
      id: 'argon',
      family: 'gemini',
      stops: Object.freeze(['#19163c', '#342c7a', '#533ba6', '#6f58ba']),
      accent: '#7c5ce6',
      accentLow: '#7982d9',
      accentMax: '#9d86f5',
      back: Object.freeze([74, 56, 152]),
      core: Object.freeze([148, 126, 232]),
      glow: Object.freeze([214, 218, 250]),
      sec: Object.freeze([118, 132, 224]),
      speedMul: 0.9,
    }),
    hydrogen: Object.freeze({
      id: 'hydrogen',
      family: 'gemini',
      stops: Object.freeze(['#0d2e45', '#155275', '#217c9e', '#3c9cb5']),
      accent: '#38a3c7',
      accentLow: '#5a99b5',
      accentMax: '#5ec6e6',
      back: Object.freeze([32, 108, 142]),
      core: Object.freeze([96, 192, 218]),
      glow: Object.freeze([204, 238, 248]),
      sec: Object.freeze([212, 128, 166]),
      speedMul: 1.55,
    }),
    carbon: Object.freeze({
      id: 'carbon',
      family: 'gemini',
      stops: Object.freeze(['#151518', '#1f1f24', '#2b2b32', '#383840']),
      accent: '#c78c3c',
      accentLow: '#9e8d76',
      accentMax: '#e0ab58',
      back: Object.freeze([88, 72, 48]),
      core: Object.freeze([206, 162, 92]),
      glow: Object.freeze([238, 222, 186]),
      sec: Object.freeze([192, 118, 66]),
      speedMul: 0.95,
    }),
    flash: Object.freeze({
      id: 'flash',
      family: 'gemini',
      stops: Object.freeze(['#3a2d0a', '#6e5412', '#a37b18', '#cca024']),
      accent: '#eab308',
      accentLow: '#c9a230',
      accentMax: '#facc15',
      back: Object.freeze([138, 102, 18]),
      core: Object.freeze([234, 184, 36]),
      glow: Object.freeze([254, 244, 188]),
      sec: Object.freeze([248, 212, 72]),
      speedMul: 1.45,
    }),
  });

  var CLAUDE_PALETTES = Object.freeze({
    opus: Object.freeze({
      id: 'opus',
      family: 'claude',
      stops: Object.freeze(['#3a1d10', '#843b1c', '#bc5a2e', '#e07b53']),
      accent: '#e07b53',
      accentLow: '#b59385',
      accentMax: '#f4a37f',
      back: Object.freeze([152, 72, 38]),
      core: Object.freeze([224, 123, 83]),
      glow: Object.freeze([255, 226, 206]),
      sec: Object.freeze([238, 152, 108]),
      speedMul: 0.94,
    }),
    sonnet: Object.freeze({
      id: 'sonnet',
      family: 'claude',
      stops: Object.freeze(['#33221d', '#6e3c2e', '#9c5640', '#ba7256']),
      accent: '#d47c5d',
      accentLow: '#a8968f',
      accentMax: '#e8a287',
      back: Object.freeze([132, 74, 56]),
      core: Object.freeze([212, 134, 102]),
      glow: Object.freeze([248, 224, 210]),
      sec: Object.freeze([224, 152, 118]),
      speedMul: 1.08,
    }),
    haiku: Object.freeze({
      id: 'haiku',
      family: 'claude',
      stops: Object.freeze(['#1a2d2d', '#2b5452', '#3f7874', '#5b9690']),
      accent: '#5ea8a0',
      accentLow: '#8ba3a0',
      accentMax: '#88cdc5',
      back: Object.freeze([52, 104, 100]),
      core: Object.freeze([112, 184, 176]),
      glow: Object.freeze([212, 242, 238]),
      sec: Object.freeze([132, 204, 196]),
      speedMul: 1.35,
    }),
  });

  var CODEX_PALETTE = Object.freeze({
    id: 'codex',
    family: 'codex',
    stops: Object.freeze(['#2563eb', '#6d28d9', '#5b21b6', '#4c1d95']),
    accent: '#8b5cf6',
    accentLow: '#4d93f8',
    accentMax: '#8b5cf6',
    back: Object.freeze([82, 48, 162]),
    core: Object.freeze([139, 92, 246]),
    glow: Object.freeze([224, 231, 255]),
    sec: Object.freeze([96, 165, 250]),
    speedMul: 1.0,
  });

  // Pre-seeded deterministic particle sets for 3D Orchestrator engines
  var HELIX_PARTICLES = [];
  var ORBIT_STARS = [];
  var CHAMBER_QUANTA = [];
  var SPARK_ORBIT = [];
  var IMPACT_SPARKS = [];
  var idx;
  for (idx = 0; idx < 26; idx += 1) {
    HELIX_PARTICLES.push({
      arm: idx % 2 === 0 ? -1 : 1,
      strand: (idx >> 1) % 2,
      phase: (idx * 0.6180339887) % 1,
      speed: 0.22 + ((idx * 37) % 100) / 420,
      radialOff: ((idx * 53) % 100) / 100 - 0.5,
      size: 0.85 + ((idx * 29) % 100) / 145,
    });
  }
  for (idx = 0; idx < 42; idx += 1) {
    ORBIT_STARS.push({
      phase: (idx / 42) * Math.PI * 2,
      lane: (idx % 3) - 1,
      speed: 0.82 + ((idx * 29) % 100) / 260,
      spreadY: (((idx * 47) % 100) / 100 - 0.5) * 3.8,
      size: 0.72 + ((idx * 19) % 100) / 115,
      tail: 0.08 + ((idx * 41) % 100) / 680,
      dir: idx % 5 === 0 ? -1 : 1,
    });
  }
  for (idx = 0; idx < 22; idx += 1) {
    CHAMBER_QUANTA.push({
      phase: (idx * 0.6180339887) % 1,
      angleOff: ((idx * 83) % 360) * (Math.PI / 180),
      speed: 0.34 + ((idx * 23) % 100) / 280,
      radiusFrac: 0.3 + ((idx * 43) % 70) / 100,
      size: 0.95 + ((idx * 17) % 100) / 115,
    });
  }
  for (idx = 0; idx < 24; idx += 1) {
    SPARK_ORBIT.push({
      phase: (idx / 24) * Math.PI * 2,
      lane: (idx % 3) - 1,
      speed: 0.72 + ((idx * 31) % 100) / 280,
      size: idx % 3 === 0 ? 3.1 : 1.5,
      isStar: idx % 3 === 0,
      spin: (idx % 2 === 0 ? 1 : -1) * (0.6 + ((idx * 19) % 50) / 70),
      yOff: (((idx * 43) % 100) / 100 - 0.5) * 3.2,
    });
  }
  for (idx = 0; idx < 16; idx += 1) {
    IMPACT_SPARKS.push({
      arm: idx % 2 === 0 ? -1 : 1,
      angle: ((idx * 71) % 360) * (Math.PI / 180),
      dist: 9 + ((idx * 19) % 15),
      size: 0.85 + ((idx * 13) % 10) / 12,
    });
  }

  function clamp01(v) {
    var n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n >= 1) return 1;
    return n;
  }

  function easeOutCubic(t) {
    var u = clamp01(t);
    return 1 - Math.pow(1 - u, 3);
  }

  function easeInOutCubic(t) {
    var u = clamp01(t);
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  }

  function hash1(n) {
    var s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
  }

  function hash2(a, b, s) {
    var v = Math.sin(a * 127.1 + b * 311.7 + (s || 0) * 74.7) * 43758.5453123;
    return v - Math.floor(v);
  }

  function classifyModel(name) {
    var raw = String(name || '').replace(/^Orchestrator\s*→\s*/i, '').trim();
    if (!raw) return { family: 'codex', element: 'codex' };
    if (/claude/i.test(raw)) {
      if (/sonnet/i.test(raw)) return { family: 'claude', element: 'sonnet' };
      if (/haiku/i.test(raw)) return { family: 'claude', element: 'haiku' };
      return { family: 'claude', element: 'opus' };
    }
    if (/\bneon\b/i.test(raw)) return { family: 'gemini', element: 'neon' };
    if (/\bargon\b/i.test(raw)) return { family: 'gemini', element: 'argon' };
    if (/\bhydrogen\b/i.test(raw)) return { family: 'gemini', element: 'hydrogen' };
    if (/\bcarbon\b/i.test(raw)) return { family: 'gemini', element: 'carbon' };
    if (/gemini|\bflash\b/i.test(raw)) return { family: 'gemini', element: 'flash' };
    return { family: 'codex', element: 'codex' };
  }

  function resolveThemeFamily(baseName, themePref) {
    if (themePref === 'gemini' || themePref === 'claude' || themePref === 'codex') return themePref;
    return classifyModel(baseName).family;
  }

  function resolvePalette(baseName, themePref) {
    var cls = classifyModel(baseName);
    if (cls.family === 'gemini') {
      return GEMINI_PALETTES[cls.element] || GEMINI_PALETTES.flash;
    }
    if (cls.family === 'claude') {
      return CLAUDE_PALETTES[cls.element] || CLAUDE_PALETTES.opus;
    }
    if (themePref === 'claude') return CLAUDE_PALETTES.opus;
    return CODEX_PALETTE;
  }

  function dotColorFor(baseName) {
    return resolvePalette(baseName).accent;
  }

  function resolveExecPalette(primaryPal) {
    var pal = primaryPal || CODEX_PALETTE;
    if (pal.family !== 'gemini') return pal;
    // Keep the second core distinct without borrowing another model's hue.
    return { ...pal, core: pal.core.map((channel, i) => Math.round(channel * 0.65 + pal.glow[i] * 0.35)) };
  }

  function resolveOrchestratorEngine(prefs, baseName) {
    var p = prefs || {};
    var mode = p.orchestratorMode || 'follow';
    if (mode === 'dock' || mode === 'classic') {
      return { kind: 'classic', style: 'dock', shape: 'pill' };
    }
    if (mode === 'custom3d') {
      var custom = p.orchestrator3dStyle || 'helix';
      if (custom === 'nebula' || custom === 'beam' || custom === 'orb') {
        return { kind: 'classic', style: custom, shape: 'pill' };
      }
      var isClaude3d = custom === 'c-matrix' || custom === 'c-louver' || custom === 'c-spark';
      return { kind: '3d', style: custom, shape: isClaude3d ? 'claude' : 'pill' };
    }
    var themePref = p.theme || p.effortTheme || 'auto';
    var family = resolveThemeFamily(baseName, themePref);
    if (family === 'gemini') {
      var g = p.geminiTheme || 'physical';
      var gk = g === 'physical' ? 'chamber' : g === 'ribbon' ? 'helix' : 'orbital';
      return { kind: '3d', style: gk, shape: 'pill' };
    }
    if (family === 'claude') {
      var c = p.claudeTheme || 'matrix';
      var ck = c === 'matrix' ? 'c-matrix' : c === 'bars' ? 'c-louver' : 'c-spark';
      return { kind: '3d', style: ck, shape: 'claude' };
    }
    var cx = p.codexTheme;
    if (cx !== 'nebula' && cx !== 'beam' && cx !== 'orb') cx = 'nebula';
    return { kind: 'classic', style: cx, shape: 'pill' };
  }

  function speedForElement(pal, energy) {
    var e = clamp01(energy);
    var id = pal && pal.id;
    if (id === 'neon') return 0.36 + e * 1.15;
    if (id === 'argon') return 0.30 + e * 0.92;
    if (id === 'hydrogen') return 0.68 + e * 1.65;
    if (id === 'flash') return 0.58 + e * 1.45;
    if (id === 'carbon') return 0.34 + e * 0.96;
    return (0.42 + e * 1.15) * ((pal && pal.speedMul) || 1.0);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rad = Math.max(0, Math.min(r || 0, Math.abs(w) * 0.5, Math.abs(h) * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  function drawFourPointStar(ctx, cx, cy, r, rot) {
    if (!ctx.save || !ctx.translate || !ctx.rotate) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    var inner = r * 0.28;
    for (var i = 0; i < 8; i += 1) {
      var ang = (i * Math.PI) / 4;
      var rad = i % 2 === 0 ? r : inner;
      var px = Math.cos(ang) * rad;
      var py = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function fillBaseGradient(ctx, w, h, stops, flow, shift) {
    var g = ctx.createLinearGradient(0, 0, Math.max(1, w), 0);
    var n = stops.length;
    for (var i = 0; i < n; i += 1) {
      var basePos = i / (n - 1);
      var wobble = i > 0 && i < n - 1 && shift ? Math.sin(flow * 0.9 + i * 2.1) * shift : 0;
      g.addColorStop(clamp01(basePos + wobble), stops[i]);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function drawGlassSheen(ctx, w, h, coreRgb, strength, isQuartz) {
    var s = strength === undefined ? 0.65 : strength;
    if (isQuartz) {
      var wall = ctx.createLinearGradient(0, 0, 0, h);
      wall.addColorStop(0, 'rgba(0,0,0,0.16)');
      wall.addColorStop(0.16, 'rgba(0,0,0,0)');
      wall.addColorStop(0.84, 'rgba(0,0,0,0)');
      wall.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, w, h);
    }
    var topArc = ctx.createLinearGradient(0, 1, 0, h * 0.42);
    topArc.addColorStop(0, 'rgba(255,255,255,' + ((isQuartz ? 0.22 : 0.18) * s).toFixed(3) + ')');
    topArc.addColorStop(0.35, 'rgba(255,255,255,' + ((isQuartz ? 0.08 : 0.05) * s).toFixed(3) + ')');
    topArc.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = topArc;
    ctx.fillRect(0, 1, w, h * 0.42);

    if (coreRgb) {
      var bot = ctx.createLinearGradient(0, h, 0, h * 0.68);
      bot.addColorStop(0, 'rgba(' + coreRgb[0] + ',' + coreRgb[1] + ',' + coreRgb[2] + ',' + ((isQuartz ? 0.2 : 0.16) * s).toFixed(3) + ')');
      bot.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bot;
      ctx.fillRect(0, h * 0.68, w, h * 0.32);
    }
  }

  // ── GEMINI 5 ELEMENTS × 3 THEMES SLIDER RENDERER ──
  function paintGeminiSlider(ctx, pal, geminiTheme, w, h, flow, clock, energy, opts) {
    if (!ctx || w <= 0 || h <= 0) return;
    var p = pal || GEMINI_PALETTES.flash;
    var e = clamp01(energy);
    var variant = geminiTheme === 'ribbon' ? 1 : geminiTheme === 'nebula' ? 2 : 0;
    var gr = p.glow[0], gg = p.glow[1], gb = p.glow[2];
    var cr = p.core[0], cg = p.core[1], cb = p.core[2];
    var sr = p.sec[0], sg = p.sec[1], sb = p.sec[2];

    fillBaseGradient(ctx, w, h, p.stops, p.id === 'carbon' ? clock * 0.25 : flow * (p.id === 'hydrogen' ? 0.6 : 1), p.id === 'carbon' ? 0.02 : 0.035);
    if (!ctx.save || !ctx.stroke || !ctx.arc) return;

    var i, s, x, y, u, px, py, vis, r, lg, rad, pass;

    if (p.id === 'neon') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      if (variant === 0) {
        if (ctx.createRadialGradient) {
          for (i = 0; i < 4; i += 1) {
            var ncx = ((flow * (34 + i * 9) + i * w * 0.28) % (w + 90)) - 45;
            var ncy = h * (0.38 + 0.24 * Math.sin(clock * 1.1 + i * 1.9));
            rad = ctx.createRadialGradient(ncx, ncy, 0, ncx, ncy, h * (1.1 + 0.4 * e));
            rad.addColorStop(0, 'rgba(' + gr + ',' + gg + ',' + gb + ',' + (0.10 + 0.16 * e).toFixed(3) + ')');
            rad.addColorStop(0.55, 'rgba(' + sr + ',' + sg + ',' + sb + ',' + (0.08 * e).toFixed(3) + ')');
            rad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = rad;
            ctx.fillRect(0, 0, w, h);
          }
        }
        var pulseX = ((flow * 88) % (w + 110)) - 55;
        var pg = ctx.createLinearGradient(pulseX - 34, 0, pulseX + 20, 0);
        pg.addColorStop(0, 'rgba(255,255,255,0)');
        pg.addColorStop(0.65, 'rgba(' + gr + ',' + gg + ',' + gb + ',' + (0.10 + 0.22 * e).toFixed(3) + ')');
        pg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = pg;
        ctx.fillRect(0, 0, w, h);
        var topG = ctx.createLinearGradient(0, 0, 0, h * 0.34);
        topG.addColorStop(0, 'rgba(' + gr + ',' + gg + ',' + gb + ',' + (0.16 + 0.20 * e).toFixed(3) + ')');
        topG.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = topG;
        ctx.fillRect(0, 0, w, h * 0.34);
      } else if (variant === 1) {
        for (s = 0; s < 2; s += 1) {
          var phN = flow * (2.6 + s * 0.7) + s * Math.PI;
          var ampN = h * (0.16 + 0.11 * e);
          var colN = s === 0 ? p.glow : p.sec;
          for (pass = 0; pass < 2; pass += 1) {
            ctx.beginPath();
            for (x = 0; x <= w; x += 4) {
              y = h * 0.5 + Math.sin(x * 0.04 - phN) * ampN + Math.sin(x * 0.085 - phN * 1.3) * 1.2;
              if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.lineWidth = pass === 0 ? (2.2 + 1.6 * e) : (0.9 + 0.35 * e);
            ctx.strokeStyle = pass === 0
              ? 'rgba(' + colN[0] + ',' + colN[1] + ',' + colN[2] + ',' + (0.12 + 0.16 * e).toFixed(3) + ')'
              : 'rgba(' + gr + ',' + gg + ',' + gb + ',' + (0.26 + 0.34 * e).toFixed(3) + ')';
            ctx.stroke();
          }
        }
        var visN1 = 3 + e * 9;
        for (i = 0; i < 13; i += 1) {
          vis = clamp01(visN1 - i);
          if (vis <= 0.01) continue;
          px = ((flow * (48 + hash1(i) * 38) + hash1(i + 10) * w) % (w + 16)) - 8;
          py = h * (0.22 + 0.56 * hash1(i + 30)) + Math.sin(clock * 3.2 + i) * 1.6;
          ctx.fillStyle = 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.24 + 0.38 * e) * vis).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(px, py, 0.85 + hash1(i + 50) * 1.0, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        var visN2 = 4 + e * 10;
        ctx.lineCap = 'round';
        for (i = 0; i < 15; i += 1) {
          vis = clamp01(visN2 - i);
          if (vis <= 0.01) continue;
          var lane = (i % 3) / 2;
          var lenN = 9 + hash1(i + 3) * 18 * (0.45 + 0.65 * e);
          px = ((flow * (56 + hash1(i) * 46) + hash1(i + 17) * (w + 60)) % (w + 60)) - 30;
          py = h * (0.24 + lane * 0.52) + Math.sin(clock * 2.2 + i) * 1.2;
          lg = ctx.createLinearGradient(px - lenN, py, px, py);
          lg.addColorStop(0, 'rgba(255,255,255,0)');
          lg.addColorStop(0.7, 'rgba(' + sr + ',' + sg + ',' + sb + ',' + ((0.18 + 0.26 * e) * vis).toFixed(3) + ')');
          lg.addColorStop(1, 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.36 + 0.36 * e) * vis).toFixed(3) + ')');
          ctx.strokeStyle = lg;
          ctx.lineWidth = 1.2 + hash1(i + 9) * 1.0;
          ctx.beginPath(); ctx.moveTo(px - lenN, py); ctx.lineTo(px, py); ctx.stroke();
        }
      }
      ctx.restore();
    } else if (p.id === 'argon') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      if (variant === 0) {
        if (ctx.createRadialGradient) {
          for (i = 0; i < 3; i += 1) {
            var acx = ((flow * (20 + i * 8) + i * w * 0.36) % (w + 100)) - 50;
            var acy = h * (0.36 + 0.28 * Math.sin(clock * 0.85 + i * 2.3));
            rad = ctx.createRadialGradient(acx, acy, 0, acx, acy, h * 1.25);
            rad.addColorStop(0, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (0.10 + 0.16 * e).toFixed(3) + ')');
            rad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = rad;
            ctx.fillRect(0, 0, w, h);
          }
        }
        for (var aIdx = 0; aIdx < 2; aIdx += 1) {
          var arcVis = aIdx === 0 ? 1 : clamp01((e - 0.42) / 0.38);
          if (arcVis <= 0.01) continue;
          var drift = flow * (2.2 + aIdx * 0.8);
          for (pass = 0; pass < 2; pass += 1) {
            ctx.beginPath();
            for (s = 0; s <= 20; s += 1) {
              u = s / 20;
              var jitter = Math.sin(u * 14 - drift * 1.5 + aIdx * 4) * 2.8 + Math.sin(u * 29 - drift * 2.4 + aIdx * 2) * 1.5 + Math.cos(u * 45 + drift) * 0.9;
              y = h * (0.5 + (aIdx === 0 ? -0.05 : 0.07)) + jitter * Math.sin(u * Math.PI) * (0.35 + 0.72 * e);
              if (s === 0) ctx.moveTo(u * w, y); else ctx.lineTo(u * w, y);
            }
            ctx.lineWidth = pass === 0 ? (2.3 + 1.3 * e) : (0.9 + 0.25 * e);
            ctx.strokeStyle = pass === 0
              ? 'rgba(' + cr + ',' + cg + ',' + cb + ',' + ((0.14 + 0.20 * e) * arcVis).toFixed(3) + ')'
              : 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.28 + 0.42 * e) * arcVis).toFixed(3) + ')';
            ctx.stroke();
          }
        }
      } else if (variant === 1) {
        for (var layer = 0; layer < 3; layer += 1) {
          var phA = flow * (1.05 + layer * 0.3) + layer * 2.1;
          ctx.beginPath();
          ctx.moveTo(0, h);
          for (x = 0; x <= w; x += 5) {
            y = h * (0.48 + layer * 0.08) + Math.sin(x * 0.028 - phA) * (h * (0.14 + 0.1 * e)) + Math.cos(x * 0.055 - phA * 0.7) * (h * 0.07);
            ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h);
          ctx.closePath();
          var ag = ctx.createLinearGradient(0, 0, 0, h);
          var colA = layer === 0 ? p.glow : layer === 1 ? p.core : p.sec;
          ag.addColorStop(0, 'rgba(' + colA[0] + ',' + colA[1] + ',' + colA[2] + ',' + (0.09 + 0.18 * e).toFixed(3) + ')');
          ag.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = ag;
          ctx.fill();
        }
      } else {
        var visA = 5 + e * 14;
        for (i = 0; i < 20; i += 1) {
          vis = clamp01(visA - i);
          if (vis <= 0.01) continue;
          px = ((flow * (24 + hash1(i) * 32) + hash1(i + 20) * (w + 30)) % (w + 30)) - 15;
          py = h * (0.18 + 0.64 * hash1(i + 40)) + Math.sin(clock * 1.8 + i) * 1.2;
          var tail = 4 + hash1(i + 60) * 10 * e;
          r = 0.9 + hash1(i + 80) * 1.1;
          lg = ctx.createLinearGradient(px - tail, py, px, py);
          lg.addColorStop(0, 'rgba(255,255,255,0)');
          lg.addColorStop(1, 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.28 + 0.36 * e) * vis).toFixed(3) + ')');
          ctx.strokeStyle = lg; ctx.lineWidth = r;
          ctx.beginPath(); ctx.moveTo(px - tail, py); ctx.lineTo(px, py); ctx.stroke();
          ctx.fillStyle = 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.42 + 0.42 * e) * vis).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(px, py, r * 0.66, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    } else if (p.id === 'hydrogen') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      if (variant === 0) {
        var visHL = 3 + e * 7;
        for (i = 0; i < 11; i += 1) {
          vis = clamp01(visHL - i);
          if (vis <= 0.01) continue;
          var lenH = 14 + hash1(i + 15) * 26 * (0.45 + 0.65 * e);
          px = ((flow * (82 + hash1(i + 5) * 72) + hash1(i + 25) * (w + 80)) % (w + 80)) - 40;
          py = h * (0.16 + 0.68 * hash1(i + 35));
          lg = ctx.createLinearGradient(px - lenH, py, px, py);
          lg.addColorStop(0, 'rgba(255,255,255,0)');
          lg.addColorStop(1, 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.14 + 0.28 * e) * vis).toFixed(3) + ')');
          ctx.strokeStyle = lg; ctx.lineWidth = 0.9;
          ctx.beginPath(); ctx.moveTo(px - lenH, py); ctx.lineTo(px, py); ctx.stroke();
        }
        var visHB = 5 + e * 12;
        for (i = 0; i < 18; i += 1) {
          vis = clamp01(visHB - i);
          if (vis <= 0.01) continue;
          px = ((flow * (48 + hash1(i + 50) * 52) + hash1(i + 60) * (w + 24)) % (w + 24)) - 12;
          py = h * (0.2 + 0.6 * hash1(i + 70)) + Math.sin(clock * 3.8 + i * 1.7) * 1.8;
          r = 1.3 + hash1(i + 80) * 1.9;
          ctx.strokeStyle = 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.24 + 0.38 * e) * vis).toFixed(3) + ')';
          ctx.lineWidth = 0.85;
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,' + ((0.24 + 0.34 * e) * vis).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(px - r * 0.32, py - r * 0.32, Math.max(0.45, r * 0.24), 0, Math.PI * 2); ctx.fill();
        }
      } else if (variant === 1) {
        for (var k = 0; k < 3; k += 1) {
          var phH = flow * (3.0 + k * 0.7) + k * 2.0;
          ctx.beginPath();
          for (x = 0; x <= w; x += 4) {
            y = h * 0.5 + Math.sin(x * 0.048 - phH) * (h * (0.16 + 0.1 * e)) + Math.sin(x * 0.095 - phH * 1.3 + k) * (h * 0.07);
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.lineWidth = k === 0 ? (2.3 + 1.3 * e) : (0.95 + 0.35 * e);
          ctx.strokeStyle = k === 0
            ? 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (0.14 + 0.18 * e).toFixed(3) + ')'
            : 'rgba(' + gr + ',' + gg + ',' + gb + ',' + (0.20 + 0.30 * e).toFixed(3) + ')';
          ctx.stroke();
        }
      } else {
        if (ctx.createRadialGradient) {
          for (i = 0; i < 5; i += 1) {
            var hcx = ((flow * (36 + i * 10) + i * w * 0.24) % (w + 110)) - 55;
            var hcy = h * (0.3 + 0.4 * Math.sin(clock * 1.4 + i * 1.5));
            rad = ctx.createRadialGradient(hcx, hcy, 0, hcx, hcy, h * 1.25);
            var colH = i % 2 === 1 ? p.sec : p.core;
            rad.addColorStop(0, 'rgba(' + colH[0] + ',' + colH[1] + ',' + colH[2] + ',' + (0.14 + 0.24 * e).toFixed(3) + ')');
            rad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = rad; ctx.fillRect(0, 0, w, h);
          }
        }
        var visHM = 5 + e * 12;
        for (i = 0; i < 18; i += 1) {
          vis = clamp01(visHM - i);
          if (vis <= 0.01) continue;
          px = ((flow * (48 + hash1(i) * 38) + hash1(i + 12) * w) % (w + 16)) - 8;
          py = h * (0.2 + 0.6 * hash1(i + 34)) + Math.cos(clock * 2.6 + i) * 1.5;
          ctx.fillStyle = 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.28 + 0.42 * e) * vis).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(px, py, 0.8 + hash1(i + 56) * 0.9, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    } else if (p.id === 'carbon') {
      if (variant === 0) {
        var hexR = h > 30 ? 8.0 : (h > 24 ? 7.0 : 5.6);
        var dx = hexR * 1.5;
        var dy = hexR * Math.sqrt(3);
        var wave1 = ((flow * 68) % (w + 140)) - 70;
        var wave2 = ((flow * 68 + (w + 140) * 0.5) % (w + 140)) - 70;
        ctx.save();
        ctx.lineWidth = 0.9;
        for (var col = -1; col * dx < w + hexR * 2; col += 1) {
          for (var row = -1; row * dy < h + hexR * 2; row += 1) {
            var hx = col * dx;
            var hy = row * dy + (col & 1 ? dy * 0.5 : 0);
            var d1 = Math.abs(hx - wave1);
            var d2 = Math.abs(hx - wave2);
            var prox = Math.max(Math.exp(-(d1 * d1) / (2 * 28 * 28)), Math.exp(-(d2 * d2) / (2 * 22 * 22)) * 0.65);
            var gl = prox * (0.68 + 0.32 * hash1(col * 31 + row * 17)) * (0.18 + 0.62 * e);
            ctx.beginPath();
            for (var ha = 0; ha < 6; ha += 1) {
              var vx = hx + Math.cos((Math.PI / 3) * ha) * (hexR - 0.5);
              var vy = hy + Math.sin((Math.PI / 3) * ha) * (hexR - 0.5);
              if (ha === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
            }
            ctx.closePath();
            if (gl > 0.07) {
              ctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + Math.min(0.24, gl * 0.24).toFixed(3) + ')';
              ctx.fill();
            }
            ctx.strokeStyle = gl > 0.07
              ? 'rgba(' + gr + ',' + gg + ',' + gb + ',' + Math.min(0.68, 0.1 + gl * 0.65).toFixed(3) + ')'
              : 'rgba(255,255,255,0.08)';
            ctx.stroke();
          }
        }
        ctx.restore();
      } else if (variant === 1) {
        ctx.save();
        for (x = -h; x < w + h; x += 6) {
          ctx.strokeStyle = 'rgba(255,255,255,0.07)';
          ctx.lineWidth = 2.0;
          ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); ctx.stroke();
          ctx.strokeStyle = 'rgba(0,0,0,0.28)';
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(x + 3, 0); ctx.lineTo(x + 3 + h, h); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'screen';
        for (var b = 0; b < 2; b += 1) {
          var bx = ((flow * (64 + b * 16) + b * w * 0.55) % (w + 120)) - 60;
          lg = ctx.createLinearGradient(bx - 32, 0, bx + 24, h);
          lg.addColorStop(0, 'rgba(255,255,255,0)');
          lg.addColorStop(0.5, 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((b === 0 ? 0.26 : 0.15) * (0.35 + 0.65 * e)).toFixed(3) + ')');
          lg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = lg;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        if (ctx.createRadialGradient) {
          for (i = 0; i < 4; i += 1) {
            var ccx = ((flow * (25 + i * 9) + i * w * 0.28) % (w + 100)) - 50;
            var ccy = h * (0.46 + 0.22 * Math.sin(clock * 1.0 + i * 2.1));
            rad = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, h * 1.3);
            rad.addColorStop(0, 'rgba(' + sr + ',' + sg + ',' + sb + ',' + (0.14 + 0.24 * e).toFixed(3) + ')');
            rad.addColorStop(0.55, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (0.06 + 0.1 * e).toFixed(3) + ')');
            rad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = rad; ctx.fillRect(0, 0, w, h);
          }
        }
        var visCE = 5 + e * 13;
        for (i = 0; i < 19; i += 1) {
          vis = clamp01(visCE - i);
          if (vis <= 0.01) continue;
          px = ((flow * (28 + hash1(i) * 38) + hash1(i + 11) * (w + 20)) % (w + 20)) - 10;
          py = h * (0.2 + 0.6 * hash1(i + 23)) + Math.sin(clock * 3.0 + i * 2) * 1.8;
          var flk = 0.58 + 0.42 * Math.sin(clock * 5.8 + i * 3.1);
          ctx.fillStyle = 'rgba(' + gr + ',' + gg + ',' + gb + ',' + (flk * (0.26 + 0.42 * e) * vis).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(px, py, 0.8 + hash1(i + 41) * 1.1, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    } else {
      // ⚡ Flash (fallback lightning element for Gemini Flash / Pro / generic Gemini)
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      if (variant === 0) {
        var cyc = ((flow * 0.65) % 1 + 1) % 1;
        var seed = Math.floor(flow * 0.65);
        var boltA = Math.pow(Math.sin(clamp01(cyc / 0.58) * Math.PI), 1.35) * (0.34 + 0.56 * e);
        if (boltA > 0.02) {
          for (pass = 0; pass < 2; pass += 1) {
            ctx.beginPath();
            for (s = 0; s <= 14; s += 1) {
              u = s / 14;
              y = h * 0.5 + (hash2(seed, s, 41) - 0.5) * 2 * (h * 0.34) * Math.sin(u * Math.PI);
              if (s === 0) ctx.moveTo(u * w, y); else ctx.lineTo(u * w, y);
            }
            ctx.lineWidth = pass === 0 ? (2.6 + 1.4 * e) : 1.05;
            ctx.strokeStyle = pass === 0
              ? 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (boltA * 0.32).toFixed(3) + ')'
              : 'rgba(' + gr + ',' + gg + ',' + gb + ',' + (boltA * 0.82).toFixed(3) + ')';
            ctx.stroke();
          }
        }
        // Subtle blue-gold ion micro-sparks trailing along the charge channel
        var visFS = 3 + e * 8;
        for (i = 0; i < 11; i += 1) {
          vis = clamp01(visFS - i);
          if (vis <= 0.01) continue;
          px = ((flow * (58 + hash1(i) * 44) + hash1(i + 19) * (w + 20)) % (w + 20)) - 10;
          py = h * (0.2 + 0.6 * hash1(i + 31)) + Math.sin(clock * 4.2 + i) * 1.4;
          var colF = i % 2 === 0 ? p.glow : p.sec;
          ctx.fillStyle = 'rgba(' + colF[0] + ',' + colF[1] + ',' + colF[2] + ',' + ((0.22 + 0.34 * e) * vis).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(px, py, 0.75 + hash1(i + 47) * 0.9, 0, Math.PI * 2); ctx.fill();
        }
      } else if (variant === 1) {
        for (s = 0; s < 2; s += 1) {
          var phF = flow * (3.0 + s * 0.75) + s * Math.PI;
          var colF1 = s === 0 ? p.glow : p.sec;
          for (pass = 0; pass < 2; pass += 1) {
            ctx.beginPath();
            for (x = 0; x <= w; x += 3) {
              var rawF = Math.sin(x * 0.048 - phF);
              var shaped = (rawF < 0 ? -1 : 1) * Math.pow(Math.abs(rawF), 0.72);
              y = h * 0.5 + shaped * (h * (0.17 + 0.12 * e));
              if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.lineWidth = pass === 0 ? (2.2 + 1.2 * e) : (s === 0 ? 1.15 : 0.85);
            ctx.strokeStyle = pass === 0
              ? 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (0.12 + 0.16 * e).toFixed(3) + ')'
              : 'rgba(' + colF1[0] + ',' + colF1[1] + ',' + colF1[2] + ',' + ((s === 0 ? 0.34 : 0.22) + 0.32 * e).toFixed(3) + ')';
            ctx.stroke();
          }
        }
      } else {
        var visFN = 5 + e * 11;
        ctx.lineCap = 'round';
        for (i = 0; i < 16; i += 1) {
          vis = clamp01(visFN - i);
          if (vis <= 0.01) continue;
          var lenF = 8 + hash2(i, 4, 15) * 14 * (0.45 + 0.65 * e);
          px = ((flow * (52 + hash2(i, 1, 3) * 48) + hash2(i, 2, 7) * (w + 30)) % (w + 30)) - 15;
          py = h * (0.18 + 0.64 * hash2(i, 3, 11)) + Math.sin(clock * 2.8 + i) * 1.2;
          var cFN = i % 3 === 0 ? p.sec : p.glow;
          lg = ctx.createLinearGradient(px - lenF, py, px, py);
          lg.addColorStop(0, 'rgba(255,255,255,0)');
          lg.addColorStop(1, 'rgba(' + cFN[0] + ',' + cFN[1] + ',' + cFN[2] + ',' + ((0.30 + 0.42 * e) * vis).toFixed(3) + ')');
          ctx.strokeStyle = lg; ctx.lineWidth = 1.1 + hash1(i + 7) * 0.7;
          ctx.beginPath(); ctx.moveTo(px - lenF, py); ctx.lineTo(px, py); ctx.stroke();
        }
      }
      ctx.restore();
    }

    if (!opts || opts.glass !== false) {
      drawGlassSheen(ctx, w, h, p.core, opts && typeof opts.glassStrength === 'number' ? opts.glassStrength : 0.62, true);
    }
  }

  // ── CLAUDE 3 MODELS × 3 THEMES SLIDER RENDERER ──
  function paintClaudeSlider(ctx, pal, claudeTheme, w, h, flow, clock, energy, opts) {
    if (!ctx || w <= 0 || h <= 0) return;
    var p = pal || CLAUDE_PALETTES.opus;
    var e = clamp01(energy);
    var gr = p.glow[0], gg = p.glow[1], gb = p.glow[2];
    var cr = p.core[0], cg = p.core[1], cb = p.core[2];
    var suite = claudeTheme === 'bars' ? 1 : claudeTheme === 'spark' ? 2 : 0;

    if (!opts || opts.fillBase !== false) {
      fillBaseGradient(ctx, w, h, p.stops, flow * 0.5, 0.02);
    }

    if (suite === 0) {
      var rows = h >= 24 ? 6 : 5;
      var cell = h / rows;
      var cols = Math.ceil(w / cell);
      var keep = 0.34 + 0.66 * e;
      for (var row = 0; row < rows; row += 1) {
        var rW = 2.6 + Math.floor(hash2(0, row, 47) * 3);
        var rS = 0.75 + hash2(0, row, 43) * 0.9;
        var rP = hash2(0, row, 53);
        for (var col = 0; col < cols; col += 1) {
          var x = col * cell;
          var t = x / Math.max(1, w);
          if (hash2(col, row, 101) > keep * (0.35 + 0.75 * t)) continue;
          var u = ((t * rW + flow * rS + rP) % 1 + 1) % 1;
          var pulse = Math.pow(1 - u, 2.8 + 2.2 * hash2(col, row, 17));
          var sz = cell * 0.72;
          var y = row * cell;
          ctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + ((0.14 + 0.32 * t) * (0.55 + 0.45 * e)).toFixed(3) + ')';
          roundRectPath(ctx, x + 0.45, y + 0.45, sz, sz, 1.0);
          ctx.fill();
          var hi = pulse * (0.32 + 0.68 * t) * (0.45 + 0.55 * e);
          if (hi > 0.05) {
            var ins = sz * 0.14;
            ctx.fillStyle = 'rgba(' + gr + ',' + gg + ',' + gb + ',' + Math.min(0.74, hi * 0.78).toFixed(3) + ')';
            roundRectPath(ctx, x + 0.45 + ins, y + 0.45 + ins, sz - ins * 2, sz - ins * 2, 0.7);
            ctx.fill();
          }
        }
      }
    } else if (suite === 1) {
      if (ctx.save) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
      }
      var step = h >= 24 ? 5.5 : 5.0;
      var bCols = Math.floor(w / step);
      for (var bi = 0; bi < bCols; bi += 1) {
        var bx = bi * step + 1.8;
        var bu = bi / Math.max(1, bCols);
        var w1 = Math.sin(bu * 11 - flow * 2.4);
        var w2 = Math.cos(bu * 21 + flow * 1.45 + hash2(bi, 1, 7) * 2);
        var amp = 0.28 + 0.72 * ((w1 * 0.6 + w2 * 0.4 + 1) * 0.5);
        var barH = Math.max(3.2, h * (0.24 + 0.54 * amp * (0.45 + 0.55 * e)));
        var alpha = (0.14 + 0.36 * amp) * (0.45 + 0.55 * bu) * (0.5 + 0.5 * e);
        ctx.fillStyle = 'rgba(' + gr + ',' + gg + ',' + gb + ',' + alpha.toFixed(3) + ')';
        roundRectPath(ctx, bx, (h - barH) * 0.5, 2.1, barH, 1.05);
        ctx.fill();
      }
      if (ctx.restore) ctx.restore();
    } else {
      if (ctx.save) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
      }
      if (ctx.createRadialGradient) {
        var mx = ((flow * 48) % (w + 90)) - 45;
        var mg = ctx.createRadialGradient(mx, h * 0.5, 0, mx, h * 0.5, h * 1.45);
        mg.addColorStop(0, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (0.16 + 0.16 * e).toFixed(3) + ')');
        mg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = mg;
        ctx.fillRect(0, 0, w, h);
      }
      var visS = 6 + e * 12;
      for (var si = 0; si < 18; si += 1) {
        var vis = clamp01(visS - si);
        if (vis <= 0.01) continue;
        var spd = 24 + hash2(si, 2, 11) * 34;
        var px = w - (((flow * spd + hash2(si, 3, 19) * (w + 26)) % (w + 26)) - 13);
        var py = h * (0.2 + 0.6 * hash2(si, 4, 29)) + Math.sin(clock * 2.2 + si) * 1.4;
        ctx.fillStyle = 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.28 + 0.44 * e) * vis).toFixed(3) + ')';
        if (si % 3 === 0) {
          var sr2 = (h >= 24 ? 2.4 : 2.1) + hash2(si, 5, 37) * 1.8 * (0.65 + 0.4 * e);
          drawFourPointStar(ctx, px, py, sr2, clock * (si % 2 ? 0.75 : -0.75) + si);
        } else {
          var sq = 1.5 + hash2(si, 6, 41) * 1.3;
          roundRectPath(ctx, px - sq * 0.5, py - sq * 0.5, sq, sq, 0.65);
          ctx.fill();
        }
      }
      if (ctx.restore) ctx.restore();
    }

    if (!opts || opts.glass !== false) {
      drawGlassSheen(ctx, w, h, p.core, opts && typeof opts.glassStrength === 'number' ? opts.glassStrength : 0.56, false);
    }
  }

  // ── CODEX SLIDER PREVIEW RENDERER (used in Sidebar live preview) ──
  function paintCodexSlider(ctx, w, h, flow, clock, energy) {
    if (!ctx || w <= 0 || h <= 0) return;
    var e = clamp01(energy);
    fillBaseGradient(ctx, w, h, CODEX_PALETTE.stops, flow * 0.4, 0.02);
    if (!ctx.save || !ctx.arc) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    var sx = w - (((flow * 58) % (w + 80)) - 40);
    var sg = ctx.createLinearGradient(sx - 28, 0, sx + 28, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, 'rgba(255,255,255,' + (0.08 + 0.16 * e).toFixed(3) + ')');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, h);
    for (var i = 0; i < 16; i += 1) {
      var vis = clamp01(4 + e * 12 - i);
      if (vis <= 0.01) continue;
      var px = w - (((flow * (28 + hash2(i, 1, 5) * 30) + hash2(i, 2, 9) * w) % (w + 16)) - 8);
      var py = h * (0.18 + 0.64 * hash2(i, 3, 13));
      ctx.fillStyle = 'rgba(240,244,255,' + ((0.36 + 0.46 * e) * vis).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px, py, 0.85 + hash2(i, 4, 17) * 1.0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    drawGlassSheen(ctx, w, h, CODEX_PALETTE.core, 0.48, false);
  }

  // ── ALL 6 3D ORCHESTRATOR ENGINES ──
  // engineKey: 'chamber' | 'helix' | 'orbital' | 'c-matrix' | 'c-louver' | 'c-spark'
  function paintOrchestrator3D(ctx, opts) {
    if (!ctx || !opts) return;
    var w = opts.w, h = opts.h;
    if (!(w > 0 && h > 0)) return;
    var engineKey = opts.engineKey || 'helix';
    var isClaude3d = engineKey === 'c-matrix' || engineKey === 'c-louver' || engineKey === 'c-spark';
    var primaryPal = opts.primaryPal || CODEX_PALETTE;
    var execPal = isClaude3d ? primaryPal : (opts.execPal || resolveExecPalette(primaryPal));
    var reach = clamp01(opts.reach);
    var bgRev = clamp01(opts.bgReveal);
    var impact = clamp01(opts.impact || 0);
    var impactU = clamp01(opts.impactU || 0);
    var oPhase = Number(opts.oPhase) || 0;
    var clock = Number(opts.clock) || 0;
    var energy = clamp01(opts.energy === undefined ? 0.85 : opts.energy);
    var isLight = Boolean(opts.isLight);
    var isFull = opts.motion === 'full';
    var elementId = opts.elementId || primaryPal.id;

    var cx = w * 0.5;
    var cy = h * 0.5;
    var inset = Math.min(14, w * 0.12);
    var halfL = Math.max(8, cx - inset);
    var fullL = Math.max(16, w - inset * 2);
    var cylR = h * 0.34;
    var cornerR = isClaude3d ? 9 : h * 0.5;
    var cr = primaryPal.core[0], cg = primaryPal.core[1], cb = primaryPal.core[2];
    var gr = primaryPal.glow[0], gg = primaryPal.glow[1], gb = primaryPal.glow[2];
    var br = primaryPal.back[0], bgc = primaryPal.back[1], bb = primaryPal.back[2];
    var flowDir = (engineKey === 'chamber' || engineKey === 'helix') ? 1 : engineKey === 'c-matrix' ? -1 : 0;
    var mixRgb = function (aCol, bCol, tMix) {
      var m = clamp01(tMix);
      return [
        Math.round(aCol[0] + (bCol[0] - aCol[0]) * m),
        Math.round(aCol[1] + (bCol[1] - aCol[1]) * m),
        Math.round(aCol[2] + (bCol[2] - aCol[2]) * m),
      ];
    };

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = isLight ? 'rgba(0,0,0,0.042)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 0, w, h);

    // Dormant subtle endpoint pins when OFF
    var restA = (1 - bgRev) * 0.42;
    if (restA > 0.01 && ctx.stroke) {
      var pins = [
        { x: inset, col: primaryPal.core },
        { x: w - inset, col: execPal.core },
      ];
      for (var pi = 0; pi < pins.length; pi += 1) {
        ctx.strokeStyle = 'rgba(' + pins[pi].col[0] + ',' + pins[pi].col[1] + ',' + pins[pi].col[2] + ',' + restA.toFixed(3) + ')';
        ctx.lineWidth = 1.2;
        if (isClaude3d) {
          roundRectPath(ctx, pins[pi].x - 2.4, cy - 2.4, 4.8, 4.8, 1.3);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(pins[pi].x, cy, 2.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    if (bgRev <= 0.005 && reach <= 0.005) {
      drawGlassSheen(ctx, w, h, null, 0.32, !isClaude3d);
      return;
    }

    // Directional chamber backdrop (rightward for chamber/helix, leftward for c-matrix, center-out for orbits/louver)
    if (reach > 0.005) {
      ctx.save();
      if (flowDir === 1) {
        var spanR = Math.max(h, w * Math.max(reach, bgRev * 0.24));
        roundRectPath(ctx, 0, 0, spanR, h, cornerR);
      } else if (flowDir === -1) {
        var spanL = Math.max(h, w * Math.max(reach, bgRev * 0.24));
        roundRectPath(ctx, w - spanL, 0, spanL, h, cornerR);
      } else {
        var spanHalf = Math.max(12, cx * Math.max(reach, bgRev * 0.24));
        roundRectPath(ctx, cx - spanHalf, 0, spanHalf * 2, h, cornerR);
      }
      ctx.clip();
      ctx.globalAlpha = bgRev;
      fillBaseGradient(ctx, w, h, primaryPal.stops, oPhase * 0.35, 0.025);
      if (!isClaude3d && execPal !== primaryPal) {
        var execG = ctx.createLinearGradient(cx, 0, w, 0);
        execG.addColorStop(0, 'rgba(0,0,0,0)');
        execG.addColorStop(1, 'rgba(' + execPal.core[0] + ',' + execPal.core[1] + ',' + execPal.core[2] + ',0.24)');
        ctx.fillStyle = execG;
        ctx.fillRect(cx, 0, w * 0.5, h);
      }
      var veil = (engineKey === 'chamber' ? 0.10 : 0.16) + (1 - energy) * 0.34;
      ctx.fillStyle = 'rgba(8, 10, 20, ' + veil.toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    var arm, s, i, u, a, d, z;

    if (engineKey === 'chamber') {
      // ── 1. 3D 磁约束腔 (Gemini Physical — flows left → right) ──
      var drawRingHalf = function (rxPos, rScale, alpha, col, isFront) {
        if (!ctx.ellipse) return;
        ctx.beginPath();
        if (isFront) ctx.ellipse(rxPos, cy, 3.0 * rScale, cylR * 0.92 * rScale, 0, -Math.PI * 0.5, Math.PI * 0.5);
        else ctx.ellipse(rxPos, cy, 3.0 * rScale, cylR * 0.92 * rScale, 0, Math.PI * 0.5, Math.PI * 1.5);
        ctx.lineWidth = isFront ? 1.35 : 0.85;
        ctx.strokeStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + alpha.toFixed(3) + ')';
        ctx.stroke();
      };
      var rings = [];
      for (i = 0; i < 4; i += 1) {
        u = ((oPhase * 0.24 + i / 4) % 1 + 1) % 1;
        if (u <= reach) rings.push(u);
      }
      ctx.save();
      for (i = 0; i < rings.length; i += 1) {
        u = rings[i];
        var rf = Math.sin(u * Math.PI) * bgRev * (0.20 + 0.26 * energy);
        var rScale = 0.80 + 0.20 * Math.sin(u * Math.PI);
        drawRingHalf(inset + u * fullL, rScale, rf * 0.55, mixRgb(primaryPal.back, execPal.back, u), false);
      }
      if (reach > 0.05) {
        var evL = clamp01(reach / 0.25) * bgRev;
        drawRingHalf(inset + 4, 0.74, 0.24 * evL, primaryPal.back, false);
      }
      if (reach > 0.7) {
        var evR = clamp01((reach - 0.7) / 0.3) * bgRev;
        drawRingHalf(w - inset - 4, 0.74, 0.24 * evR, execPal.back, false);
      }
      ctx.restore();

      // Middle 3D element-specific physical field (sweeps left → right)
      var fSpan = fullL * reach;
      if (fSpan > 2) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(inset, 0, fSpan, h);
        ctx.clip();
        if (elementId === 'argon' || elementId === 'flash') {
          var isFlash = elementId === 'flash';
          for (var ai = 0; ai < 2; ai += 1) {
            var isF = ai === 1;
            var av = ai === 0 ? 1 : clamp01((energy - 0.25) / 0.45);
            if (av <= 0.01) continue;
            ctx.globalCompositeOperation = isF ? 'screen' : 'source-over';
            ctx.beginPath();
            var segs = isFlash ? 16 : 24;
            var seedF = Math.floor(oPhase * 1.4);
            for (s = 0; s <= segs; s += 1) {
              u = s / segs;
              var ax = inset + u * fullL;
              var env = Math.sin(u * Math.PI);
              var yOff = isFlash
                ? (hash2(seedF + ai * 7, s, 41) - 0.5) * 2 * (cylR * 0.85)
                : (Math.sin(u * 13 - oPhase * (2.6 + ai * 0.9) * 1.4 + ai * 3.1) * 3.8 + Math.sin(u * 27 - oPhase * 2.1 + ai) * 1.8);
              var ay = cy + (isF ? 1.0 : -1.2) + yOff * env * (0.4 + 0.62 * energy);
              if (s === 0) ctx.moveTo(ax, ay); else ctx.lineTo(ax, ay);
            }
            ctx.lineWidth = isF ? (0.95 + 0.3 * energy) : 0.85;
            ctx.strokeStyle = isF
              ? 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.30 + 0.42 * energy) * av * bgRev).toFixed(3) + ')'
              : 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (0.30 * bgRev).toFixed(3) + ')';
            ctx.stroke();
          }
        } else if (elementId === 'hydrogen') {
          var visQ = 8 + energy * 14;
          for (var passH = 0; passH < 2; passH += 1) {
            var isFH = passH === 1;
            ctx.globalCompositeOperation = isFH ? 'screen' : 'source-over';
            for (i = 0; i < CHAMBER_QUANTA.length; i += 1) {
              var qv = clamp01(visQ - i);
              if (qv <= 0.01) continue;
              var q = CHAMBER_QUANTA[i];
              u = ((q.phase + oPhase * q.speed * 0.42) % 1 + 1) % 1;
              var qx = inset + u * fullL;
              var qAng = u * Math.PI * 5 - oPhase * 2.2 + q.angleOff;
              z = Math.cos(qAng);
              if (isFH ? z < 0 : z >= 0) continue;
              var qy = cy + Math.sin(qAng) * cylR * q.radiusFrac;
              d = (z + 1) * 0.5;
              ctx.strokeStyle = 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((isFH ? 0.42 : 0.16) * Math.sin(u * Math.PI) * qv * bgRev).toFixed(3) + ')';
              ctx.lineWidth = isFH ? 0.9 : 0.65;
              ctx.beginPath(); ctx.arc(qx, qy, q.size * (0.65 + 0.5 * d), 0, Math.PI * 2); ctx.stroke();
            }
          }
        } else if (elementId === 'carbon') {
          ctx.globalCompositeOperation = 'screen';
          var wu = ((oPhase * 0.36) % 1 + 1) % 1;
          var wx = inset + wu * fullL;
          var wCol = mixRgb(primaryPal.glow, execPal.glow, wu);
          var wg = ctx.createLinearGradient(wx - 24, 0, wx + 24, 0);
          wg.addColorStop(0, 'rgba(0,0,0,0)');
          wg.addColorStop(0.5, 'rgba(' + wCol[0] + ',' + wCol[1] + ',' + wCol[2] + ',' + ((0.16 + 0.24 * energy) * bgRev).toFixed(3) + ')');
          wg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = wg; ctx.fillRect(wx - 24, 0, 48, h);
        } else {
          ctx.globalCompositeOperation = 'screen';
          var ch = 4.5 + 3.5 * energy;
          var cg2 = ctx.createLinearGradient(0, cy - ch, 0, cy + ch);
          cg2.addColorStop(0, 'rgba(0,0,0,0)');
          cg2.addColorStop(0.5, 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.12 + 0.18 * energy) * bgRev).toFixed(3) + ')');
          cg2.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = cg2;
          ctx.fillRect(inset, cy - ch, fullL, ch * 2);
          var nu = ((oPhase * 0.34) % 1 + 1) % 1;
          var nx = inset + nu * fullL;
          var ng = ctx.createLinearGradient(nx - 26, 0, nx + 26, 0);
          ng.addColorStop(0, 'rgba(0,0,0,0)');
          ng.addColorStop(0.5, 'rgba(' + gr + ',' + gg + ',' + gb + ',' + ((0.14 + 0.18 * energy) * bgRev).toFixed(3) + ')');
          ng.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = ng;
          ctx.fillRect(nx - 26, cy - ch, 52, ch * 2);
        }
        ctx.restore();
      }

      // Front rings (left → right)
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (i = 0; i < rings.length; i += 1) {
        u = rings[i];
        var rf2 = Math.sin(u * Math.PI) * bgRev * (0.24 + 0.34 * energy);
        var rScale2 = 0.80 + 0.20 * Math.sin(u * Math.PI);
        drawRingHalf(inset + u * fullL, rScale2, rf2, mixRgb(primaryPal.glow, execPal.glow, u), true);
      }
      if (reach > 0.03 && reach < 0.985) {
        var lockA = Math.sin(reach * Math.PI) * 0.7;
        var lxR = inset + reach * fullL;
        drawRingHalf(lxR, 1.0, lockA * 0.42, mixRgb(primaryPal.core, execPal.core, reach), false);
        drawRingHalf(lxR, 1.0, lockA, mixRgb(primaryPal.glow, execPal.glow, reach), true);
      }
      if (reach > 0.05) {
        var evL2 = clamp01(reach / 0.25) * bgRev;
        drawRingHalf(inset + 4, 0.74, (0.26 + 0.20 * energy) * evL2, primaryPal.glow, true);
      }
      if (reach > 0.7) {
        var evR2 = clamp01((reach - 0.7) / 0.3) * bgRev;
        drawRingHalf(w - inset - 4, 0.74, (0.28 + 0.22 * energy + impact * 0.35) * evR2, execPal.glow, true);
      }
      ctx.restore();
    } else if (engineKey === 'helix') {
      // ── 2. 3D 螺旋星流胶囊 (Gemini Ribbon — flows left → right) ──
      var turns = 3.6;
      var helixPt = function (strand, uu) {
        var hx = inset + uu * fullL;
        var rEnv = 0.40 + 0.58 * Math.sin(uu * Math.PI);
        var th = uu * turns * Math.PI * 2 - oPhase * 2.2 + strand * Math.PI;
        return { x: hx, y: cy + Math.sin(th) * cylR * rEnv, z: Math.cos(th) };
      };
      var drawHPass = function (isFront) {
        var steps = 84;
        var du = reach / steps;
        if (du <= 0.0002) return;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.globalCompositeOperation = isFront ? 'screen' : 'source-over';
        for (s = 0; s < 2; s += 1) {
          var sVis = s === 0 ? 1 : clamp01((energy - 0.1) / 0.4);
          if (sVis <= 0.01) continue;
          for (i = 0; i < steps; i += 1) {
            var u0 = i * du, u1 = (i + 1) * du, um = (u0 + u1) * 0.5;
            var p0 = helixPt(s, u0), p1 = helixPt(s, u1);
            var zm = (p0.z + p1.z) * 0.5;
            if (isFront ? zm < 0 : zm >= 0) continue;
            var tFade = reach < 0.99 ? clamp01((reach - um) / 0.12) : 1;
            var aBase = bgRev * sVis * tFade;
            if (aBase <= 0.01) continue;
            if (!isFront) {
              d = (zm + 1) * 0.5;
              var bc = mixRgb(primaryPal.back, execPal.back, um);
              ctx.strokeStyle = 'rgba(' + bc[0] + ',' + bc[1] + ',' + bc[2] + ',' + ((0.16 + 0.24 * d) * (0.55 + 0.45 * energy) * aBase).toFixed(3) + ')';
              ctx.lineWidth = 0.85 + d * 1.1;
              ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
            } else {
              var cc = mixRgb(primaryPal.core, execPal.core, um);
              var gc = mixRgb(primaryPal.glow, execPal.glow, um);
              ctx.strokeStyle = 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',' + ((0.12 + 0.18 * zm) * (0.45 + 0.55 * energy) * aBase).toFixed(3) + ')';
              ctx.lineWidth = 2.0 + zm * (1.8 + 1.0 * energy);
              ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
              ctx.strokeStyle = 'rgba(' + gc[0] + ',' + gc[1] + ',' + gc[2] + ',' + ((0.24 + 0.48 * zm) * (0.45 + 0.55 * energy) * aBase).toFixed(3) + ')';
              ctx.lineWidth = 0.72 + zm * (0.8 + 0.35 * energy);
              ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
            }
          }
        }
        ctx.restore();
      };
      var drawHParts = function (isFront) {
        var visC = 6 + energy * 16;
        ctx.save();
        ctx.globalCompositeOperation = isFront ? 'screen' : 'source-over';
        for (i = 0; i < HELIX_PARTICLES.length; i += 1) {
          var pv = clamp01(visC - i);
          if (pv <= 0.01) continue;
          var pt = HELIX_PARTICLES[i];
          u = ((pt.phase + oPhase * pt.speed * 0.65) % 1 + 1) % 1;
          if (u > reach) continue;
          var hp = helixPt(pt.strand, u);
          if (isFront ? hp.z < 0 : hp.z >= 0) continue;
          var pCol = isFront ? mixRgb(primaryPal.glow, execPal.glow, u) : mixRgb(primaryPal.core, execPal.core, u);
          var ds = 0.55 + 0.45 * ((hp.z + 1) * 0.5);
          var py = hp.y + pt.radialOff * 3.4 * Math.sin(u * Math.PI);
          var ef = Math.sin(clamp01(u / Math.max(0.05, reach)) * Math.PI);
          a = (isFront ? 0.52 : 0.2) * ds * ef * pv * bgRev;
          if (a <= 0.01) continue;
          ctx.fillStyle = 'rgba(' + pCol[0] + ',' + pCol[1] + ',' + pCol[2] + ',' + a.toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(hp.x, py, pt.size * ds * (0.72 + 0.32 * energy), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      };
      if (reach > 0.01) { drawHPass(false); drawHParts(false); }
      var axG = ctx.createLinearGradient(0, cy - 4.5, 0, cy + 4.5);
      axG.addColorStop(0, 'rgba(0,0,0,0)');
      axG.addColorStop(0.5, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + ((0.06 + 0.08 * energy) * bgRev).toFixed(3) + ')');
      axG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = axG; ctx.fillRect(inset, cy - 4.5, fullL, 9);
      if (reach > 0.01) { drawHPass(true); drawHParts(true); }
      if (reach > 0.04 && reach < 0.985 && ctx.createRadialGradient) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        var tipA = Math.sin(reach * Math.PI) * 0.55;
        var tipCol = mixRgb(primaryPal.glow, execPal.glow, reach);
        for (s = 0; s < 2; s += 1) {
          var tip = helixPt(s, reach);
          var tg = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 7);
          tg.addColorStop(0, 'rgba(255,255,255,' + tipA.toFixed(3) + ')');
          tg.addColorStop(0.45, 'rgba(' + tipCol[0] + ',' + tipCol[1] + ',' + tipCol[2] + ',' + (tipA * 0.5).toFixed(3) + ')');
          tg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(tip.x, tip.y, 7, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    } else if (engineKey === 'orbital') {
      // ── 3. 3D 双核 ∞ 星轨 (Gemini Nebula) ──
      var orbitPos = function (alpha, lane, spY) {
        var spanX = halfL * 0.95 * reach;
        var spanY = cylR * (0.76 + lane * 0.14) * (0.35 + 0.65 * reach);
        return {
          x: cx + Math.sin(alpha) * spanX,
          y: cy + Math.sin(alpha * 2 + lane * 0.35) * spanY + spY * reach,
          z: Math.cos(alpha + lane * 0.4),
        };
      };
      var drawGuide = function (isFront) {
        ctx.save(); ctx.globalCompositeOperation = isFront ? 'screen' : 'source-over';
        for (i = 0; i < 60; i += 1) {
          var p0 = orbitPos((i / 60) * Math.PI * 2, 0, 0);
          var p1 = orbitPos(((i + 1) / 60) * Math.PI * 2, 0, 0);
          var zm = (p0.z + p1.z) * 0.5;
          if (isFront ? zm < 0 : zm >= 0) continue;
          var gp = p0.x < cx ? primaryPal : execPal;
          d = isFront ? zm : (zm + 1) * 0.5;
          a = (isFront ? (0.06 + 0.14 * d) : (0.05 + 0.07 * d)) * (0.45 + 0.55 * energy) * bgRev;
          ctx.strokeStyle = 'rgba(' + gp.glow[0] + ',' + gp.glow[1] + ',' + gp.glow[2] + ',' + a.toFixed(3) + ')';
          ctx.lineWidth = isFront ? (0.8 + 0.6 * d) : 0.65;
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
        ctx.restore();
      };
      var drawStars = function (isFront) {
        var visC = 12 + energy * 30;
        ctx.save(); ctx.globalCompositeOperation = isFront ? 'screen' : 'source-over'; ctx.lineCap = 'round';
        for (i = 0; i < ORBIT_STARS.length; i += 1) {
          var sv = clamp01(visC - i);
          if (sv <= 0.01) continue;
          var st = ORBIT_STARS[i];
          var al = st.phase + oPhase * st.speed * 0.85 * st.dir;
          var pn = orbitPos(al, st.lane, st.spreadY);
          if (isFront ? pn.z < 0 : pn.z >= 0) continue;
          var sp = pn.x < cx ? primaryPal : execPal;
          d = (pn.z + 1) * 0.5;
          var radS = st.size * (0.55 + 0.62 * d) * (0.78 + 0.28 * energy);
          var sa = (isFront ? (0.28 + 0.48 * pn.z) : (0.10 + 0.18 * d)) * sv * bgRev;
          if (sa <= 0.01) continue;
          var pp2 = orbitPos(al - st.tail * (0.6 + 0.75 * energy) * st.dir, st.lane, st.spreadY);
          var tg2 = ctx.createLinearGradient(pp2.x, pp2.y, pn.x, pn.y);
          tg2.addColorStop(0, 'rgba(255,255,255,0)');
          tg2.addColorStop(1, 'rgba(' + sp.glow[0] + ',' + sp.glow[1] + ',' + sp.glow[2] + ',' + (sa * 0.78).toFixed(3) + ')');
          ctx.strokeStyle = tg2; ctx.lineWidth = radS * 1.05;
          ctx.beginPath(); ctx.moveTo(pp2.x, pp2.y); ctx.lineTo(pn.x, pn.y); ctx.stroke();
          ctx.fillStyle = isFront
            ? 'rgba(255,255,255,' + Math.min(0.85, sa * 1.15).toFixed(3) + ')'
            : 'rgba(' + sp.core[0] + ',' + sp.core[1] + ',' + sp.core[2] + ',' + sa.toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(pn.x, pn.y, radS * 0.7, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      };
      if (reach > 0.02) {
        drawGuide(false); drawStars(false);
        if (ctx.createRadialGradient) {
          var cPulse = reach < 0.95 ? Math.sin(reach * Math.PI) * 0.45 : (0.08 + 0.08 * energy);
          ctx.save(); ctx.globalCompositeOperation = 'screen';
          var ncg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 13 + 9 * (1 - reach));
          ncg.addColorStop(0, 'rgba(255,255,255,' + (cPulse * bgRev).toFixed(3) + ')');
          ncg.addColorStop(0.5, 'rgba(' + gr + ',' + gg + ',' + gb + ',' + (cPulse * 0.45 * bgRev).toFixed(3) + ')');
          ncg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = ncg; ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        drawGuide(true); drawStars(true);
      }
    } else if (engineKey === 'c-matrix') {
      // ── 4. 3D 曲面点阵屏 (Claude Matrix — flows right → left) ──
      var mRows = h >= 28 ? 6 : 5;
      var mCols = Math.max(8, Math.floor((w - 12) / 5.2));
      var colW = (w - 12) / mCols;
      var maxColIdx = Math.max(1, mCols - 1);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (var mc = 0; mc < mCols; mc += 1) {
        var colT = mc / maxColIdx; // 0 = left, 1 = right
        var dn = 1 - colT; // 0 = right edge (launch origin), 1 = left edge (arrival)
        if (dn > reach) continue;
        var scanF = reach < 0.99 ? clamp01(1 - (reach - dn) / 0.14) : 0;
        var mx = 6 + mc * colW;
        for (var mr = 0; mr < mRows; mr += 1) {
          var phi = ((mr + 0.5) / mRows - 0.5) * 2.35;
          z = Math.cos(phi);
          var my = cy + Math.sin(phi) * (h * 0.45);
          var cellH = (h / mRows) * 0.72 * z;
          var rSpd = 0.65 + hash2(0, mr, 43) * 0.65;
          u = ((colT * 2.4 + oPhase * rSpd + hash2(0, mr, 53)) % 1 + 1) % 1;
          var pl = Math.pow(1 - u, 3.0);
          a = (0.08 + 0.24 * z * (0.4 + 0.6 * energy) + pl * 0.36 * z * energy + scanF * 0.45) * bgRev;
          ctx.fillStyle = (pl > 0.45 || scanF > 0.3)
            ? 'rgba(' + gr + ',' + gg + ',' + gb + ',' + Math.min(0.76, a).toFixed(3) + ')'
            : 'rgba(' + cr + ',' + cg + ',' + cb + ',' + Math.min(0.55, a).toFixed(3) + ')';
          roundRectPath(ctx, mx, my - cellH * 0.5, colW * 0.7, cellH, 0.95);
          ctx.fill();
        }
      }
      ctx.restore();
    } else if (engineKey === 'c-louver') {
      // ── 5. 3D 动态光栅 (Claude Bars) ──
      var lCnt = 34;
      var lStep = (w - 24) / (lCnt - 1);
      ctx.save();
      for (i = 0; i < lCnt; i += 1) {
        var ld = Math.abs(i - (lCnt - 1) * 0.5) / ((lCnt - 1) * 0.5);
        if (ld > reach) continue;
        var rise = easeOutCubic(clamp01((reach - ld) / 0.18));
        var lx = 12 + i * lStep;
        z = Math.cos(ld * 9.5 - oPhase * 2.4);
        d = (z + 1) * 0.5;
        var bh = (3.8 + (h * 0.56) * (0.28 + 0.72 * d) * (0.5 + 0.5 * energy)) * rise;
        var bw = 1.05 + 1.2 * d;
        a = (0.14 + 0.46 * d) * (0.45 + 0.55 * energy) * bgRev;
        ctx.globalCompositeOperation = z >= 0 ? 'screen' : 'source-over';
        ctx.fillStyle = z >= 0
          ? 'rgba(' + gr + ',' + gg + ',' + gb + ',' + a.toFixed(3) + ')'
          : 'rgba(' + br + ',' + bgc + ',' + bb + ',' + (a * 0.75).toFixed(3) + ')';
        roundRectPath(ctx, lx - bw * 0.5, cy - bh * 0.5, bw, bh, bw * 0.5);
        ctx.fill();
      }
      ctx.restore();
    } else {
      // ── 6. 3D ✦ 星花轨 (Claude Spark) ──
      var spPos = function (alpha, lane, yOff) {
        return {
          x: cx + Math.sin(alpha) * (halfL * 0.92) * reach,
          y: cy + Math.sin(alpha * 2 + lane * 0.35) * cylR * (0.72 + lane * 0.14) * (0.35 + 0.65 * reach) + yOff * reach,
          z: Math.cos(alpha + lane * 0.4),
        };
      };
      for (var spPass = 0; spPass < 2; spPass += 1) {
        var isFSp = spPass === 1;
        ctx.save();
        ctx.globalCompositeOperation = isFSp ? 'screen' : 'source-over';
        var visSp = 9 + energy * 15;
        for (i = 0; i < SPARK_ORBIT.length; i += 1) {
          var vsp = clamp01(visSp - i);
          if (vsp <= 0.01) continue;
          var spItem = SPARK_ORBIT[i];
          var pos = spPos(spItem.phase + oPhase * spItem.speed * 0.8, spItem.lane, spItem.yOff);
          if (isFSp ? pos.z < 0 : pos.z >= 0) continue;
          d = (pos.z + 1) * 0.5;
          a = (isFSp ? (0.28 + 0.48 * pos.z) : (0.12 + 0.18 * d)) * vsp * bgRev;
          ctx.fillStyle = isFSp
            ? 'rgba(' + gr + ',' + gg + ',' + gb + ',' + a.toFixed(3) + ')'
            : 'rgba(' + cr + ',' + cg + ',' + cb + ',' + a.toFixed(3) + ')';
          var sz = spItem.size * (0.58 + 0.56 * d) * (0.78 + 0.28 * energy);
          if (spItem.isStar) drawFourPointStar(ctx, pos.x, pos.y, sz, clock * spItem.spin + i);
          else { roundRectPath(ctx, pos.x - sz * 0.5, pos.y - sz * 0.5, sz, sz, 0.7); ctx.fill(); }
        }
        ctx.restore();
      }
      if (reach < 0.92) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = 'rgba(' + gr + ',' + gg + ',' + gb + ',' + (Math.sin(reach * Math.PI) * 0.62 * bgRev).toFixed(3) + ')';
        drawFourPointStar(ctx, cx, cy, 3.8 + (1 - reach) * 4.5, clock * 1.4);
        ctx.restore();
      }
    }

    // Endpoint cores + arrival impact scatter
    var launchCoreS = easeOutCubic(clamp01(reach / 0.25));
    var arriveCoreS = easeOutCubic(clamp01((reach - 0.70) / 0.30));
    var leftCoreS = flowDir === 1 ? launchCoreS : arriveCoreS;
    var rightCoreS = flowDir === -1 ? launchCoreS : arriveCoreS;
    if (leftCoreS > 0.01 || rightCoreS > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      var ends = [
        { x: inset, pal: primaryPal, cs: leftCoreS, imp: flowDir === 1 ? 0 : impact },
        { x: w - inset, pal: execPal, cs: rightCoreS, imp: flowDir === -1 ? 0 : impact },
      ];
      for (var ei = 0; ei < 2; ei += 1) {
        var nd = ends[ei];
        if (nd.cs <= 0.01) continue;
        var pls = 0.9 + 0.1 * Math.sin(oPhase * 1.35 + ei * Math.PI);
        var hr = (4.8 + 3.6 * energy + nd.imp * (isFull ? 5.2 : 3.2)) * pls * nd.cs;
        if (ctx.createRadialGradient) {
          var hg = ctx.createRadialGradient(nd.x, cy, 0, nd.x, cy, Math.max(1, hr));
          hg.addColorStop(0, 'rgba(255,255,255,' + ((0.50 + 0.28 * energy + nd.imp * 0.24) * nd.cs).toFixed(3) + ')');
          hg.addColorStop(0.42, 'rgba(' + nd.pal.glow[0] + ',' + nd.pal.glow[1] + ',' + nd.pal.glow[2] + ',' + ((0.26 + 0.22 * energy) * nd.cs).toFixed(3) + ')');
          hg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = hg;
          ctx.beginPath(); ctx.arc(nd.x, cy, Math.max(1, hr), 0, Math.PI * 2); ctx.fill();
        }
        if (isClaude3d) {
          ctx.fillStyle = 'rgba(255,255,255,' + ((0.52 + 0.34 * energy) * nd.cs).toFixed(3) + ')';
          if (engineKey === 'c-spark') {
            drawFourPointStar(ctx, nd.x, cy, (2.4 + 1.0 * energy) * nd.cs, clock * (ei === 0 ? 0.9 : -0.9));
          } else if (engineKey === 'c-louver') {
            var ebh = (5.5 + 3.6 * energy) * nd.cs;
            roundRectPath(ctx, nd.x - 1.1, cy - ebh * 0.5, 2.2, ebh, 1.1); ctx.fill();
          } else {
            var es = (3.2 + 1.1 * energy) * nd.cs;
            roundRectPath(ctx, nd.x - es * 0.5, cy - es * 0.5, es, es, 1.1); ctx.fill();
          }
        }
      }
      if (impact > 0.02 && !isClaude3d && arriveCoreS > 0.01) {
        var sparkLimit = isFull ? IMPACT_SPARKS.length : 8;
        for (i = 0; i < sparkLimit; i += 1) {
          var spk = IMPACT_SPARKS[i];
          var ox = flowDir === 1 ? (w - inset) : spk.arm === -1 ? inset : (w - inset);
          var spPal = flowDir === 1 ? execPal : spk.arm === -1 ? primaryPal : execPal;
          var dist = spk.dist * (isFull ? 1 : 0.72) * easeOutCubic(impactU);
          ctx.fillStyle = 'rgba(' + spPal.glow[0] + ',' + spPal.glow[1] + ',' + spPal.glow[2] + ',' + (impact * 0.56).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(ox + Math.cos(spk.angle) * dist, cy + Math.sin(spk.angle) * dist * 0.65, spk.size * (1 - impactU * 0.45), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    drawGlassSheen(ctx, w, h, primaryPal.core, 0.50 + 0.42 * bgRev, !isClaude3d);
  }

  // ── CLASSIC ORCHESTRATOR PREVIEW RENDERER (adaptive to active model palette) ──
  function paintOrchestratorClassic(ctx, opts) {
    if (!ctx || !opts) return;
    var w = opts.w, h = opts.h;
    if (!(w > 0 && h > 0)) return;
    var style = opts.style || 'nebula';
    var pal = opts.primaryPal || CODEX_PALETTE;
    var cr = pal.core[0], cg = pal.core[1], cb = pal.core[2];
    var gr = pal.glow[0], gg = pal.glow[1], gb = pal.glow[2];
    var reach = clamp01(opts.reach);
    var bgRev = clamp01(opts.bgReveal);
    var oPhase = Number(opts.oPhase) || 0;
    var isLight = Boolean(opts.isLight);
    var cx = w * 0.5, cy = h * 0.5;
    var cornerR = style === 'dock' ? 7 : h * 0.5;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (isLight ? '0.075' : '0.09') + ')';
    ctx.fillRect(0, 0, w, h);

    if (style === 'beam') {
      ctx.save();
      roundRectPath(ctx, 1, 1, w - 2, h - 2, cornerR);
      ctx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (0.28 + 0.50 * bgRev).toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      if (bgRev > 0.05) {
        var ang = oPhase * 1.4;
        var bx = cx + Math.cos(ang) * (w * 0.46);
        var by = cy + Math.sin(ang) * (h * 0.45);
        if (ctx.createRadialGradient) {
          var bg = ctx.createRadialGradient(bx, by, 0, bx, by, 38);
          bg.addColorStop(0, 'rgba(255,255,255,' + (0.78 * bgRev).toFixed(3) + ')');
          bg.addColorStop(0.45, 'rgba(' + gr + ',' + gg + ',' + gb + ',' + (0.52 * bgRev).toFixed(3) + ')');
          bg.addColorStop(1, 'rgba(' + cr + ',' + cg + ',' + cb + ',0)');
          ctx.strokeStyle = bg;
          ctx.lineWidth = 2.2;
          ctx.stroke();
        }
      }
      ctx.restore();
      return;
    }

    if (reach > 0.01) {
      ctx.save();
      if (style === 'dock') {
        var yTop = -h * (1 - reach);
        roundRectPath(ctx, 0, yTop, w, h, cornerR);
        ctx.clip();
      } else if (style === 'orb') {
        roundRectPath(ctx, 0, 0, Math.max(h, w * reach), h, cornerR);
        ctx.clip();
      } else {
        var span = Math.max(12, cx * reach);
        roundRectPath(ctx, cx - span, 0, span * 2, h, cornerR);
        ctx.clip();
      }
      ctx.globalAlpha = bgRev;
      fillBaseGradient(ctx, w, h, pal.stops, 0, 0);
      ctx.globalCompositeOperation = 'screen';
      if (style === 'nebula' || style === 'orb') {
        for (var i = 0; i < 6; i += 1) {
          var sx = w - (((oPhase * (22 + i * 6) + i * 38) % (w + 20)) - 10);
          var sy = h * (0.24 + ((i * 37) % 52) / 100);
          ctx.fillStyle = 'rgba(' + gr + ',' + gg + ',' + gb + ',' + (0.76 * bgRev).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(sx, sy, 1.3 + (i % 2) * 0.5, 0, Math.PI * 2); ctx.fill();
        }
      }
      var swx = ((oPhase * 52) % (w + 70)) - 35;
      var swg = ctx.createLinearGradient(swx - 24, 0, swx + 24, 0);
      swg.addColorStop(0, 'rgba(255,255,255,0)');
      swg.addColorStop(0.5, 'rgba(255,255,255,' + (0.28 * bgRev).toFixed(3) + ')');
      swg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = swg; ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    if (style === 'orb') {
      var orbX = 3 + (w - h) * reach + (h - 6) * 0.5;
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(orbX, cy, (h - 6) * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  return {
    GEMINI_PALETTES: GEMINI_PALETTES,
    CLAUDE_PALETTES: CLAUDE_PALETTES,
    CODEX_PALETTE: CODEX_PALETTE,
    clamp01: clamp01,
    easeOutCubic: easeOutCubic,
    easeInOutCubic: easeInOutCubic,
    classifyModel: classifyModel,
    resolveThemeFamily: resolveThemeFamily,
    resolvePalette: resolvePalette,
    dotColorFor: dotColorFor,
    resolveExecPalette: resolveExecPalette,
    resolveOrchestratorEngine: resolveOrchestratorEngine,
    speedForElement: speedForElement,
    roundRectPath: roundRectPath,
    drawFourPointStar: drawFourPointStar,
    drawGlassSheen: drawGlassSheen,
    paintGeminiSlider: paintGeminiSlider,
    paintClaudeSlider: paintClaudeSlider,
    paintCodexSlider: paintCodexSlider,
    paintOrchestrator3D: paintOrchestrator3D,
    paintOrchestratorClassic: paintOrchestratorClassic,
  };
}

export function motionThemes() {
  return motionThemes.instance ??= createMotionThemes();
}
