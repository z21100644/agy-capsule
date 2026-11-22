import { createUpstreamEffort, UPSTREAM_EFFORT_CSS } from './effort_upstream.mjs';
import { motionThemes } from './motion_themes.mjs';

const ORCHESTRATOR_CSS = `
.dk-orch-slot {
  position: relative;
  width: 100%;
  box-sizing: border-box;
  margin: 5px 0 5px;
  padding: 0 8px;
  --orch-dur: 0.16s;
  --orch-burst-dur: 0.30s;
  --orch-icon-dur: 0.18s;
  --orch-loop-scale: 0.8;
  --orch-beam-dur: 2.24s;
}
.dk-orch-slot[data-motion="full"] {
  --orch-dur: 0.58s;
  --orch-burst-dur: 0.90s;
  --orch-icon-dur: 0.62s;
  --orch-loop-scale: 1.35;
  --orch-beam-dur: 3.78s;
}
.dk-orch-slot[hidden] { display: none !important; }
.dk-orch-slot:not([hidden]) + .agy-effort { margin-top: 0; }
.dk-orch-slot[data-style="dock"] {
  padding: 0;
  margin: 5px 0 0;
}
.dk-orch-btn {
  position: relative;
  width: 100%;
  height: 28px;
  border: 0;
  padding: 0;
  margin: 0;
  border-radius: 999px;
  background: transparent;
  font: inherit;
  cursor: pointer;
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  --orch-off-bg: rgba(var(--orch-core-rgb), 0.07);
  --orch-off-border: rgba(var(--orch-core-rgb), 0.24);
  --orch-off-text: color-mix(in srgb, var(--foreground, CanvasText) 74%, var(--orch-accent));
  --orch-surface: var(--popover, var(--card, Canvas));
  --orch-on-surface: color-mix(in srgb, var(--orch-surface) 90%, var(--orch-accent));
}
.dk-orch-btn:focus-visible {
  outline: 2px solid var(--orch-accent);
  outline-offset: 2px;
}
.dk-orch-btn[data-style="dock"]:focus-visible {
  outline-offset: -2px;
}
.dk-orch-btn[aria-disabled="true"] {
  opacity: 0.5;
  cursor: not-allowed;
}
.dk-orch-btn:not([aria-disabled="true"]):active {
  transform: scale3d(0.98, 0.98, 1);
}

/* Monochrome crisp geometric SVG icons (15x15) */
.dk-orch-svg {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  overflow: visible;
}
.dk-orch-svg.ico-prism .ray {
  transform-origin: 10.6px 8px;
  transition: transform var(--orch-icon-dur) cubic-bezier(0.22, 1, 0.36, 1), opacity var(--orch-icon-dur) ease;
}
.dk-orch-btn[aria-checked="true"] .dk-orch-svg.ico-prism .ray-1 { transform: translate3d(0.6px, -0.35px, 0); }
.dk-orch-btn[aria-checked="true"] .dk-orch-svg.ico-prism .ray-2 { transform: translate3d(0.9px, 0, 0); }
.dk-orch-btn[aria-checked="true"] .dk-orch-svg.ico-prism .ray-3 { transform: translate3d(0.6px, 0.35px, 0); }
.dk-orch-svg.ico-gravity .orbit-ring {
  transform-origin: 8px 8px;
  transition: transform var(--orch-icon-dur) cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}
.dk-orch-btn[aria-checked="true"] .dk-orch-svg.ico-gravity .orbit-ring { transform: rotate(180deg); }
.dk-orch-svg.ico-semicircle .seat {
  transform-box: fill-box;
  transform-origin: center;
  transition: fill var(--orch-icon-dur) ease, transform var(--orch-icon-dur) cubic-bezier(0.34, 1.56, 0.64, 1);
}
.dk-orch-btn[aria-checked="true"] .dk-orch-svg.ico-semicircle .seat { fill: currentColor; }

/* Shared nebula star dots (radial-gradient glow, zero box-shadow repaint) */
@keyframes dk-orch-star {
  0% { transform: translate3d(0, 0, 0); opacity: 0; }
  12% { opacity: 1; }
  88% { opacity: 1; }
  100% { transform: translate3d(-180px, 0, 0); opacity: 0; }
}
.dk-orch-sdot {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0%, rgba(var(--orch-glow-rgb, 233, 213, 255), 0.92) 42%, rgba(var(--orch-glow-rgb, 216, 180, 254), 0) 75%);
  animation: dk-orch-star calc(var(--dur, 4.6s) * var(--orch-loop-scale, 0.8)) linear infinite;
  animation-delay: calc(var(--del, 0s) * var(--orch-loop-scale, 0.8));
  will-change: transform, opacity;
  pointer-events: none;
}

/* ── Style 1: Nebula Pill (星云充能胶囊) ── */
@keyframes dk-orch-sweep {
  0% { transform: translate3d(-130%, 0, 0) skewX(-18deg); opacity: 0; }
  20% { opacity: 0.95; }
  100% { transform: translate3d(280%, 0, 0) skewX(-18deg); opacity: 0; }
}
.dk-orch-btn[data-style="nebula"] {
  background: var(--orch-off-bg);
  box-shadow: inset 0 0 0 1px var(--orch-off-border);
  transition: transform 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}
.dk-orch-btn[data-style="nebula"] .dk-orch-glow {
  position: absolute; inset: 0; border-radius: 999px;
  box-shadow: 0 0 15px rgba(var(--orch-core-rgb, 147, 51, 234), 0.48);
  opacity: 0; transition: opacity 0.3s ease; pointer-events: none; will-change: opacity;
}
.dk-orch-btn[data-style="nebula"][aria-checked="true"] .dk-orch-glow { opacity: 1; }
.dk-orch-btn[data-style="nebula"] .dk-orch-clip {
  position: absolute; inset: 0; border-radius: 999px;
  overflow: hidden; transform: translateZ(0); pointer-events: none;
}
.dk-orch-btn[data-style="nebula"] .dk-orch-fill {
  position: absolute; inset: 0; border-radius: 999px;
  background: linear-gradient(90deg, var(--orch-c0, #3b1178) 0%, var(--orch-c1, #6d28d9) 34%, var(--orch-c2, #9333ea) 68%, var(--orch-c3, #c084fc) 100%);
  transform: scale3d(0.01, 1, 1); opacity: 0;
  transition: transform var(--orch-dur) cubic-bezier(0.16, 1, 0.3, 1), opacity var(--orch-dur) ease;
  will-change: transform, opacity;
}
.dk-orch-btn[data-style="nebula"][aria-checked="true"] .dk-orch-fill {
  transform: scale3d(1, 1, 1); opacity: 1;
}
.dk-orch-btn[data-style="nebula"] .dk-orch-sweep {
  position: absolute; top: 0; bottom: 0; left: 0; width: 42%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45), transparent);
  opacity: 0; will-change: transform, opacity;
}
.dk-orch-btn[data-style="nebula"][aria-checked="true"].is-burst .dk-orch-sweep {
  animation: dk-orch-sweep var(--orch-burst-dur) linear forwards;
}
.dk-orch-btn[data-style="nebula"] .dk-orch-stars {
  position: absolute; inset: 0; opacity: 0;
  transition: opacity 0.32s ease; will-change: opacity;
}
.dk-orch-btn[data-style="nebula"][aria-checked="true"] .dk-orch-stars { opacity: 0.9; }
.dk-orch-btn[data-style="nebula"] .dk-orch-label {
  position: relative; z-index: 2;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 500;
  color: var(--orch-off-text); transition: color 0.22s ease;
}
.dk-orch-btn[data-style="nebula"][aria-checked="true"] .dk-orch-label {
  color: #ffffff; text-shadow: 0 0 10px rgba(255, 255, 255, 0.35);
}

/* ── Style 2: Border Beam Capsule (流光边界胶囊) ── */
@keyframes dk-orch-spin { to { transform: translate3d(-50%, -50%, 0) rotate(360deg); } }
@keyframes dk-orch-ring {
  0% { transform: scale3d(0.96, 0.88, 1); opacity: 0.8; }
  100% { transform: scale3d(1.06, 1.48, 1); opacity: 0; }
}
.dk-orch-btn[data-style="beam"] {
  padding: 1.5px;
  background: var(--orch-off-border);
  transition: transform 0.14s ease, background-color 0.25s ease;
}
.dk-orch-btn[data-style="beam"][aria-checked="true"] { background: rgba(var(--orch-core-rgb, 139, 92, 246), 0.42); }
.dk-orch-btn[data-style="beam"] .dk-orch-ring {
  position: absolute; inset: 0; border-radius: 999px;
  border: 1.5px solid rgba(var(--orch-core-rgb, 168, 85, 247), 0.72);
  opacity: 0; pointer-events: none; will-change: transform, opacity;
}
.dk-orch-btn[data-style="beam"][aria-checked="true"].is-burst .dk-orch-ring {
  animation: dk-orch-ring var(--orch-burst-dur) cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.dk-orch-btn[data-style="beam"] .dk-orch-glow {
  position: absolute; inset: 0; border-radius: 999px;
  box-shadow: 0 0 14px -2px rgba(var(--orch-core-rgb, 139, 92, 246), 0.45);
  opacity: 0; transition: opacity 0.28s ease; pointer-events: none;
}
.dk-orch-btn[data-style="beam"][aria-checked="true"] .dk-orch-glow { opacity: 1; }
.dk-orch-btn[data-style="beam"] .dk-orch-clip {
  position: absolute; inset: 0; border-radius: 999px;
  overflow: hidden; transform: translateZ(0); pointer-events: none;
}
.dk-orch-btn[data-style="beam"] .dk-orch-beam {
  position: absolute; left: 50%; top: 50%; width: 340px; height: 340px;
  transform: translate3d(-50%, -50%, 0);
  background: conic-gradient(from 0deg, transparent 0%, transparent 56%, var(--orch-c1, #7c3aed) 72%, var(--orch-c3, #c084fc) 86%, #ffffff 93%, var(--orch-c2, #9333ea) 100%);
  opacity: 0; transition: opacity 0.28s ease; will-change: transform, opacity;
}
.dk-orch-btn[data-style="beam"][aria-checked="true"] .dk-orch-beam {
  opacity: 1; animation: dk-orch-spin var(--orch-beam-dur, 2.24s) linear infinite;
}
.dk-orch-btn[data-style="beam"] .dk-orch-inner {
  position: relative; z-index: 1; width: 100%; height: 100%; border-radius: 999px;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--orch-surface); color: var(--orch-off-text);
  font-size: 12px; font-weight: 500;
  transition: background-color 0.22s ease, color 0.22s ease;
}
.dk-orch-btn[data-style="beam"][aria-checked="true"] .dk-orch-inner {
  background: var(--orch-on-surface); color: var(--orch-accent); font-weight: 600;
}

/* ── Style 3: 3D Helical Flux Capsule (立体螺旋星流胶囊) ── */
.dk-orch-btn[data-style="helix"] {
  background: var(--orch-off-bg);
  box-shadow: inset 0 0 0 1px var(--orch-off-border);
  transition: transform 0.14s cubic-bezier(0.22, 1, 0.36, 1);
}
.dk-orch-btn[data-style="helix"] .dk-orch-glow {
  position: absolute; inset: 0; border-radius: 999px;
  box-shadow: 0 2px 15px -2px rgba(124, 58, 237, 0.56), inset 0 0 0 1px rgba(216, 180, 254, 0.42);
  opacity: 0; transition: opacity 0.35s ease; pointer-events: none; will-change: opacity;
}
.dk-orch-btn[data-style="helix"][aria-checked="true"] .dk-orch-glow { opacity: 1; }
.dk-orch-btn[data-style="helix"] .dk-orch-tube {
  position: absolute; inset: 0; border-radius: 999px;
  overflow: hidden; transform: translateZ(0); pointer-events: none;
}
.dk-orch-btn[data-style="helix"] .dk-orch-depth {
  position: absolute; inset: 0; border-radius: 999px;
  background: radial-gradient(ellipse 75% 135% at 50% 44%, rgba(168, 85, 247, 0.92) 0%, rgba(109, 40, 217, 0.95) 48%, rgba(46, 16, 101, 0.98) 100%);
  opacity: 0; transform: scale3d(0.28, 0.85, 1);
  transition: opacity var(--orch-dur) ease, transform var(--orch-dur) cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
}
.dk-orch-btn[data-style="helix"][aria-checked="true"] .dk-orch-depth {
  opacity: 1; transform: scale3d(1, 1, 1);
}
.dk-orch-btn[data-style="helix"] .dk-orch-specular {
  position: absolute; inset: 0; border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0.08) 28%, transparent 52%, rgba(216, 180, 254, 0.14) 88%, rgba(255, 255, 255, 0.22) 100%);
  opacity: 0.35; transition: opacity 0.32s ease; pointer-events: none; z-index: 3;
}
.dk-orch-btn[data-style="helix"][aria-checked="true"] .dk-orch-specular { opacity: 1; }
.dk-orch-btn[data-style="helix"] .dk-orch-canvas {
  position: absolute; inset: 0; width: 100%; height: 100%;
  display: block; z-index: 2; pointer-events: none;
}
.dk-orch-btn[data-style="helix"] .dk-orch-label {
  position: relative; z-index: 4;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 500; letter-spacing: 0.015em;
  color: var(--orch-off-text); transition: color 0.24s ease;
}
.dk-orch-btn[data-style="helix"][aria-checked="true"] .dk-orch-label {
  color: #ffffff;
  text-shadow: 0 1px 8px rgba(46, 16, 101, 0.85), 0 0 12px rgba(233, 213, 255, 0.65);
}

/* ── Style 4: Unified Command Dock (指挥舱一体卡) ── */
@keyframes dk-orch-dock-flash { 0% { opacity: 0.9; } 100% { opacity: 0; } }
.dk-orch-btn[data-style="dock"] {
  height: 30px;
  border-radius: 8px;
  background: rgba(var(--orch-core-rgb, 139, 92, 246), 0.06);
  box-shadow: inset 0 0 0 1px rgba(var(--orch-core-rgb, 139, 92, 246), 0.42), 0 0 14px -4px rgba(var(--orch-core-rgb, 139, 92, 246), 0.35);
  overflow: hidden;
  transition: transform 0.14s ease;
}
.dk-orch-slot[data-style="dock"]:has(+ .agy-effort) .dk-orch-btn[data-style="dock"] {
  border-radius: 8px 8px 0 0;
  box-shadow: inset 1px 0 0 rgba(var(--orch-core-rgb, 139, 92, 246), 0.42), inset -1px 0 0 rgba(var(--orch-core-rgb, 139, 92, 246), 0.42), inset 0 1px 0 rgba(var(--orch-core-rgb, 139, 92, 246), 0.42), inset 0 -1px 0 rgba(var(--orch-core-rgb, 139, 92, 246), 0.18), 0 -2px 12px -4px rgba(var(--orch-core-rgb, 139, 92, 246), 0.32);
}
.dk-orch-slot[data-style="dock"]:not([hidden]) + .agy-effort {
  margin-top: 0 !important;
}
.dk-orch-slot[data-style="dock"]:not([hidden]) + .agy-effort .ces-ag-effort-row {
  border-radius: 0 0 8px 8px;
  background-color: rgba(var(--orch-core-rgb, 139, 92, 246), 0.06);
  box-shadow: inset 1px 0 0 rgba(var(--orch-core-rgb, 139, 92, 246), 0.42), inset -1px 0 0 rgba(var(--orch-core-rgb, 139, 92, 246), 0.42), inset 0 -1px 0 rgba(var(--orch-core-rgb, 139, 92, 246), 0.42), 0 6px 14px -4px rgba(var(--orch-core-rgb, 139, 92, 246), 0.36) !important;
}
.dk-orch-btn[data-style="dock"] .dk-orch-wave {
  position: absolute; inset: 0;
  background: linear-gradient(90deg, var(--orch-c0, #4c1d95), var(--orch-c1, #7c3aed), var(--orch-c2, #a855f7));
  transform: translate3d(0, -104%, 0);
  transition: transform var(--orch-dur) cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform; pointer-events: none;
}
.dk-orch-btn[data-style="dock"][aria-checked="true"] .dk-orch-wave { transform: translate3d(0, 0, 0); }
.dk-orch-btn[data-style="dock"] .dk-orch-pulse {
  position: absolute; inset: 0; border-radius: inherit;
  box-shadow: inset 0 0 0 1.5px rgba(var(--orch-glow-rgb, 192, 132, 252), 0.92);
  opacity: 0; pointer-events: none; z-index: 4; will-change: opacity;
}
.dk-orch-btn[data-style="dock"][aria-checked="true"].is-burst .dk-orch-pulse {
  animation: dk-orch-dock-flash var(--orch-burst-dur) ease-out forwards;
}
.dk-orch-btn[data-style="dock"] .dk-orch-label {
  position: relative; z-index: 2;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 500;
  color: var(--orch-off-text); transition: color 0.22s ease;
}
.dk-orch-btn[data-style="dock"][aria-checked="true"] .dk-orch-label { color: #ffffff; }
.dk-orch-btn[data-style="dock"] .dk-orch-badge {
  font-size: 10px; line-height: 1; padding: 2px 5px; border-radius: 99px;
  background: rgba(var(--orch-core-rgb, 139, 92, 246), 0.14); color: var(--orch-accent); font-weight: 600;
  transition: background-color 0.22s ease, color 0.22s ease;
}
.dk-orch-btn[data-style="dock"][aria-checked="true"] .dk-orch-badge {
  background: rgba(255, 255, 255, 0.22); color: #ffffff;
}

/* ── Style 5: Liquid Orb Pill (液态流珠胶囊 - 二阶弹簧物理) ── */
.dk-orch-btn[data-style="orb"] {
  background: rgba(128, 128, 145, 0.16);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(var(--orch-core-rgb, 139, 92, 246), 0.18);
  contain: layout style;
}
.dk-orch-btn[data-style="orb"] .dk-orch-glow {
  position: absolute; inset: 0; border-radius: 999px;
  box-shadow: 0 0 14px rgba(var(--orch-core-rgb, 168, 85, 247), 0.45);
  opacity: 0; pointer-events: none; will-change: opacity;
}
.dk-orch-btn[data-style="orb"] .dk-orch-clip {
  position: absolute; inset: 0; border-radius: 999px;
  overflow: hidden; transform: translateZ(0); pointer-events: none;
}
.dk-orch-btn[data-style="orb"] .dk-orch-fill-slide {
  position: absolute; inset: 0; border-radius: 999px;
  background: linear-gradient(90deg, var(--orch-c0, #3b1178) 0%, var(--orch-c1, #6d28d9) 34%, var(--orch-c2, #9333ea) 66%, var(--orch-c3, #c084fc) 100%);
  transform: translate3d(-100%, 0, 0);
  opacity: 0; will-change: transform, opacity;
}
.dk-orch-btn[data-style="orb"] .dk-orch-stars {
  position: absolute; inset: 0; opacity: 0;
  transition: opacity 0.28s ease; pointer-events: none;
}
.dk-orch-btn[data-style="orb"][aria-checked="true"] .dk-orch-stars { opacity: 0.9; }
.dk-orch-btn[data-style="orb"] .dk-orch-orb {
  position: absolute; left: 3px; top: 3px;
  width: 22px; height: 22px; border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.28);
  z-index: 3; transform: translate3d(0, 0, 0);
  will-change: transform; pointer-events: none;
}
.dk-orch-btn[data-style="orb"] .dk-orch-bloom {
  position: absolute; left: 50%; top: 50%;
  width: 96px; height: 32px; border-radius: 999px;
  background: radial-gradient(ellipse at center, rgba(var(--orch-glow-rgb, 233, 213, 255), 0.78) 0%, rgba(var(--orch-core-rgb, 192, 132, 252), 0.32) 45%, transparent 74%);
  opacity: 0; pointer-events: none; z-index: 1;
  transform: translate3d(-50%, -50%, 0) scale3d(0.6, 0.6, 1);
  will-change: transform, opacity;
}
.dk-orch-btn[data-style="orb"] .dk-orch-label {
  position: relative; z-index: 2;
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-weight: 500;
  color: var(--orch-off-text); transition: color 0.18s ease; pointer-events: none;
}
.dk-orch-btn[data-style="orb"][aria-checked="true"] .dk-orch-label {
  color: #ffffff; text-shadow: 0 1px 4px color-mix(in srgb, var(--orch-c0) 45%, transparent);
}

/* ── Style 6: Theme-coupled 3D Orchestrator (Gemini / Claude 6× 3D Engines) ── */
.dk-orch-btn[data-style="theme3d"] {
  background: transparent;
  overflow: hidden;
  transition: transform 0.14s cubic-bezier(0.22, 1, 0.36, 1), border-radius 0.18s ease, box-shadow 0.22s ease;
}
.dk-orch-btn[data-style="theme3d"][data-shape="claude"] {
  border-radius: 9px;
}
.dk-orch-btn[data-style="theme3d"] .dk-orch-canvas {
  position: absolute; inset: 0; width: 100%; height: 100%;
  display: block; z-index: 1; pointer-events: none;
}
.dk-orch-btn[data-style="theme3d"] .dk-orch-label {
  position: relative; z-index: 3;
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 500; letter-spacing: 0.015em;
  color: var(--orch-off-text);
  transition: color 0.22s ease, text-shadow 0.22s ease, letter-spacing 0.22s ease;
}
.dk-orch-btn[data-style="theme3d"][aria-checked="true"] .dk-orch-label {
  color: rgba(255, 255, 255, 0.96);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.56);
  letter-spacing: 0.025em;
}

/* Settings popover 2-tab switcher & multi-row grids */
.ces-set-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 2px;
  margin-bottom: 10px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--foreground, #fff) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--foreground, #fff) 8%, transparent);
}
.ces-set-tab {
  padding: 4px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted-foreground, color-mix(in srgb, var(--foreground, CanvasText) 65%, transparent));
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}
.ces-set-tab[aria-selected="true"] {
  background: var(--card, rgb(28, 28, 34));
  color: var(--foreground, CanvasText);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
}
.ces-set-pane[hidden], .ces-set-group[hidden] { display: none !important; }
.ces-set-opts[data-cols="4"] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}
.ces-set-opts[data-cols="4-row"] {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}
.ces-set-opts[data-cols="5"] {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ces-set-opts[data-cols="5"] .ces-set-opt {
  flex: 1 1 calc(33.33% - 4px);
  min-width: 78px;
}
.ces-set-opts[data-cols="6"] {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.ces-set-opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.ces-set-opt .dk-orch-svg {
  width: 13px;
  height: 13px;
}
.ces-set {
  border-radius: 12px;
  background: var(--card, rgb(19, 19, 23));
  color: var(--foreground, CanvasText);
  border: 1px solid color-mix(in srgb, var(--foreground, #fff) 9%, transparent);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--foreground, #fff) 8%, transparent) inset,
    0 20px 44px -12px rgba(0, 0, 0, 0.24), 0 3px 10px -2px rgba(0, 0, 0, 0.16);
  backdrop-filter: blur(22px);
}
.ces-set-label {
  color: var(--muted-foreground, color-mix(in srgb, var(--foreground, CanvasText) 65%, transparent));
  opacity: 1;
}
.ces-set-opt {
  border: 1px solid color-mix(in srgb, var(--foreground, #fff) 10%, transparent);
  background: color-mix(in srgb, var(--foreground, #fff) 4%, transparent);
  color: var(--secondary-foreground, color-mix(in srgb, var(--foreground, CanvasText) 82%, transparent));
}
.ces-set-opt:hover {
  background: var(--secondary, color-mix(in srgb, var(--foreground, #fff) 9%, transparent));
  border-color: color-mix(in srgb, var(--foreground, #fff) 16%, transparent);
  color: var(--foreground, CanvasText);
}
.ces-set-opt.is-on {
  background: color-mix(in srgb, #8b5cf6 18%, transparent);
  border-color: color-mix(in srgb, #8b5cf6 58%, transparent);
  color: color-mix(in srgb, #8b5cf6 56%, var(--foreground, CanvasText));
  font-weight: 600;
}
.ces-set-opt.is-on:hover {
  background: color-mix(in srgb, #8b5cf6 24%, transparent);
  color: color-mix(in srgb, #8b5cf6 56%, var(--foreground, CanvasText));
}

/* Pause ambient animations when popover is closed or OS prefers reduced motion */
.dk-orch-slot[data-open="false"] .dk-orch-sdot,
.dk-orch-slot[data-open="false"] .dk-orch-beam {
  animation-play-state: paused !important;
}
@media (prefers-reduced-motion: reduce) {
  .dk-orch-sdot, .dk-orch-beam, .dk-orch-sweep, .dk-orch-ring, .dk-orch-pulse {
    animation: none !important;
  }
  .dk-orch-btn, .dk-orch-btn * {
    transition-duration: 0.01s !important;
  }
}
`;

export const EFFORT_BAR_CSS = UPSTREAM_EFFORT_CSS +
' .ces-root:focus-visible, .ces-set button:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }' +
' .ces-set { inset: auto; margin: 0; width: 312px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto; }' +
' .ces-set-opt { text-wrap: balance; min-height: 27px; }' +
' @media (prefers-reduced-motion: reduce) { .ces-star, .ces-energy__sweep { animation-play-state: paused !important; } }' +
ORCHESTRATOR_CSS;

export function effortEffects() {
  return effortEffects.instance ??= createUpstreamEffort();
}

export function mountEffortBar(choose, onVisualChange = null) {
  const effects = effortEffects();
  const element = document.createElement('div');
  element.className = 'agy-effort ces-ag-section';
  element.innerHTML = '<div class="ces-ag-effort-row"><div class="ces-ag-effort-head"><span class="ces-ag-effort-title"></span><span class="ces-ag-effort-value"></span></div><div class="ces-inline"></div></div>';
  const row = element.firstElementChild;
  const container = row.lastElementChild;
  const [caption, valueElement] = row.firstElementChild.children;

  const miniIconSvg = type => {
    if (type === 'prism') {
      return '<svg class="dk-orch-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.2 8H4.6"/><path d="M7.6 4.4L10.6 8L7.6 11.6L4.6 8Z"/><path d="M11.6 4.8H14.8M11.9 8H14.8M11.6 11.2H14.8"/></svg>';
    }
    if (type === 'gravity') {
      return '<svg class="dk-orch-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2.05" fill="currentColor" stroke="none"/><path d="M3.4 4.8A5.6 5.6 0 0 1 11.2 3.4"/><circle cx="11.6" cy="3.8" r="1.1" fill="currentColor" stroke="none"/><path d="M12.6 11.2A5.6 5.6 0 0 1 4.8 12.6"/><circle cx="4.4" cy="12.2" r="1.1" fill="currentColor" stroke="none"/></svg>';
    }
    if (type === 'semicircle') {
      return '<svg class="dk-orch-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="8" cy="12.2" r="1.8" fill="currentColor" stroke="none"/><circle cx="2.2" cy="8.7" r="1.12"/><circle cx="4.5" cy="5.8" r="1.12"/><circle cx="8" cy="4.7" r="1.12"/><circle cx="11.5" cy="5.8" r="1.12"/><circle cx="13.8" cy="8.7" r="1.12"/></svg>';
    }
    return '';
  };

  let groupKey, mounted, open = false, settingsLabels, settingsMenu, settingsListeners, restoreTarget = null;
  const seat = {
    baseName: '',
    currentEffort: '',
    effortLevels: [],
    selectEffort(item) { choose(item.effort); },
  };

  function updateMount() {
    if (open && seat.effortLevels.length && !mounted) {
      mounted = effects.mountCodexEffortSlider({
        container,
        row,
        valueElement,
        seat,
        caption: caption.textContent,
        onVisualChange: info => onVisualChange?.(info),
      });
    }
  }

  function closeSettings(restoreFocus = false) {
    if (!settingsMenu) return;
    settingsListeners.abort();
    settingsMenu.hidePopover();
    settingsMenu.remove();
    settingsMenu = null;
    const focusEl = restoreTarget || container.firstElementChild;
    restoreTarget = null;
    if (restoreFocus) focusEl?.focus({ preventScroll: true });
  }

  function openSettings(x, y, focusBack = null, initialTab = 'slider') {
    if (!settingsLabels?.title) return;
    closeSettings();
    restoreTarget = focusBack;
    const labels = settingsLabels;
    const menu = document.createElement('div');
    settingsMenu = menu;
    menu.className = 'ces-set';
    menu.popover = 'manual';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', labels.title);

    const hasOrchTab = Array.isArray(labels.orchestratorMode) || Array.isArray(labels.orchestratorStyle);
    let activeTab = hasOrchTab && initialTab === 'orch' ? 'orch' : 'slider';

    const tabButtons = [];
    const panes = {};
    const groupNodes = {};
    const choices = [];

    const positionMenu = () => {
      const rect = menu.getBoundingClientRect();
      const panel = element.closest?.('.dk-model-options');
      const panelRect = panel?.getBoundingClientRect?.();
      let left = x, top = y;
      if (panelRect && panelRect.width > 0) {
        const gap = 8;
        const rightX = panelRect.right + gap;
        const leftX = panelRect.left - rect.width - gap;
        left = rightX + rect.width <= innerWidth - 8 ? rightX : leftX >= 8 ? leftX : rightX;
        top = panelRect.bottom - rect.height;
      }
      menu.style.left = Math.round(Math.max(8, Math.min(innerWidth - rect.width - 8, left))) + 'px';
      menu.style.top = Math.round(Math.max(8, Math.min(innerHeight - rect.height - 8, top))) + 'px';
    };

    const renderChoices = (reposition = false) => {
      const prefs = effects.readSettings(window);
      for (const [button, key, value] of choices) {
        const active = prefs[key] === value;
        button.classList.toggle('is-on', active);
        button.setAttribute('aria-pressed', String(active));
      }
      if (groupNodes.geminiTheme) {
        groupNodes.geminiTheme.hidden = !(prefs.theme === 'auto' || prefs.theme === 'gemini');
      }
      if (groupNodes.claudeTheme) {
        groupNodes.claudeTheme.hidden = !(prefs.theme === 'auto' || prefs.theme === 'claude');
      }
      if (groupNodes.codexTheme) {
        groupNodes.codexTheme.hidden = !(prefs.theme === 'auto' || prefs.theme === 'codex');
      }
      if (groupNodes.orchestrator3dStyle) {
        groupNodes.orchestrator3dStyle.hidden = prefs.orchestratorMode !== 'custom3d';
      }
      for (const [tabKey, btn] of tabButtons) {
        const sel = tabKey === activeTab;
        btn.setAttribute('aria-selected', String(sel));
        btn.tabIndex = sel ? 0 : -1;
      }
      for (const [tabKey, pane] of Object.entries(panes)) {
        pane.hidden = tabKey !== activeTab;
      }
      if (reposition) positionMenu();
    };

    const buttonFor = (className, label, iconType, action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      const svg = iconType ? miniIconSvg(iconType) : '';
      if (svg) button.innerHTML = svg + '<span></span>';
      else button.innerHTML = '<span></span>';
      button.lastElementChild.textContent = label;
      button.addEventListener('click', action);
      return button;
    };

    const appendGroups = (hostPane, groupList) => {
      for (const [key, values, colsOverride] of groupList) {
        if (!Array.isArray(labels[key])) continue;
        const group = document.createElement('div');
        group.className = 'ces-set-group';
        group.dataset.group = key;
        group.innerHTML = '<div class="ces-set-label"></div><div class="ces-set-opts" role="group"></div>';
        group.firstElementChild.textContent = labels[key][0];
        const options = group.lastElementChild;
        options.setAttribute('aria-label', labels[key][0]);
        if (colsOverride) options.dataset.cols = colsOverride;
        else if (values.length >= 4) options.dataset.cols = String(values.length);
        values.forEach((value, index) => {
          const iconType = key === 'orchestratorIcon' ? value : '';
          const button = buttonFor('ces-set-opt', labels[key][index + 1] || value, iconType, () => {
            effects.writeSettings({ [key]: value }, window);
            renderChoices(true);
          });
          choices.push([button, key, value]);
          options.append(button);
        });
        groupNodes[key] = group;
        hostPane.append(group);
      }
    };

    if (hasOrchTab) {
      const tabBar = document.createElement('div');
      tabBar.className = 'ces-set-tabs';
      tabBar.setAttribute('role', 'tablist');
      const tabLabels = Array.isArray(labels.tabs) ? labels.tabs : ['滑条', 'Orchestrator'];
      for (const [tabKey, tabLabel] of [['slider', tabLabels[0]], ['orch', tabLabels[1]]]) {
        const tb = document.createElement('button');
        tb.type = 'button';
        tb.className = 'ces-set-tab';
        tb.setAttribute('role', 'tab');
        tb.dataset.tab = tabKey;
        tb.textContent = tabLabel;
        tb.addEventListener('click', () => {
          activeTab = tabKey;
          renderChoices(true);
        });
        tabButtons.push([tabKey, tb]);
        tabBar.append(tb);
      }
      tabBar.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        activeTab = activeTab === 'slider' ? 'orch' : 'slider';
        renderChoices(true);
        tabButtons.find(([k]) => k === activeTab)?.[1]?.focus({ preventScroll: true });
      });
      menu.append(tabBar);
    }

    const sliderPane = document.createElement('div');
    sliderPane.className = 'ces-set-pane';
    sliderPane.dataset.pane = 'slider';
    appendGroups(sliderPane, [
      ['theme', ['auto', 'gemini', 'claude', 'codex'], '4-row'],
      ['geminiTheme', ['physical', 'ribbon', 'nebula']],
      ['claudeTheme', ['matrix', 'bars', 'spark']],
      ['codexTheme', ['nebula', 'beam', 'orb']],
      ['motion', ['fast', 'full']],
      ['ticks', ['highlight', 'dim', 'hidden']],
    ]);
    panes.slider = sliderPane;
    menu.append(sliderPane);

    if (hasOrchTab) {
      const orchPane = document.createElement('div');
      orchPane.className = 'ces-set-pane';
      orchPane.dataset.pane = 'orch';
      appendGroups(orchPane, [
        ['orchestratorMode', ['follow', 'dock', 'custom3d']],
        ['orchestrator3dStyle', ['chamber', 'helix', 'orbital', 'c-matrix', 'c-louver', 'c-spark', 'nebula', 'beam', 'orb'], '6'],
        ['orchestratorIcon', ['prism', 'gravity', 'semicircle', 'none'], '4'],
      ]);
      panes.orch = orchPane;
      menu.append(orchPane);
    }

    renderChoices(false);
    element.append(menu);
    menu.showPopover();
    positionMenu();
    const activePane = panes[activeTab] || menu;
    (activePane.querySelector('.ces-set-opt.is-on') || activePane.querySelector('button') || menu.querySelector('button')).focus({ preventScroll: true });

    settingsListeners = new AbortController();
    const listeners = { capture: true, signal: settingsListeners.signal };
    document.addEventListener('pointerdown', event => {
      if (!event.composedPath().includes(menu)) closeSettings();
    }, listeners);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSettings(true);
    }, listeners);
    const off = effects.onSettingsChange(() => renderChoices(true), window);
    settingsListeners.signal.addEventListener('abort', off, { once: true });
  }

  row.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    openSettings(event.clientX, event.clientY, null, 'slider');
  });
  row.addEventListener('keydown', event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = row.getBoundingClientRect();
    openSettings(rect.left, rect.bottom + 4, null, 'slider');
  });

  return {
    element,
    openSettings,
    setOpen(next) {
      open = next;
      if (open) updateMount();
      else {
        closeSettings();
        mounted?.unmount();
        mounted = null;
      }
    },
    refresh(group, selected, pending, label, localizedSettings) {
      settingsLabels = localizedSettings;
      caption.textContent = label;
      const levels = group.items.map(item => ({ effort: item.label, label: item.tier ?? '' }));
      const nextKey = JSON.stringify([group.name, levels]);
      if (nextKey !== groupKey) {
        closeSettings();
        mounted?.unmount();
        mounted = null;
        groupKey = nextKey;
        seat.baseName = group.name;
        seat.effortLevels = levels;
      }
      seat.currentEffort = group.items.some(item => item.label === pending) ? pending : selected;
      updateMount();
      if (mounted) {
        container.firstElementChild.setAttribute('aria-label', label);
        // Schedule after the upstream pointer/key handler sets its spring target.
        const instance = mounted;
        queueMicrotask(() => { if (instance === mounted) instance.refresh(); });
      }
    },
  };
}

export function mountOrchestratorSwitch(onToggle, onContextMenu) {
  const effects = effortEffects();
  const mt = motionThemes();
  const slot = document.createElement('div');
  slot.className = 'dk-orch-slot';
  slot.hidden = true;
  slot.dataset.open = 'false';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dk-orch-btn';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', 'false');
  button.setAttribute('aria-label', 'Orchestrator');
  slot.append(button);

  const iconMarkup = type => {
    if (type === 'prism') {
      return '<svg class="dk-orch-svg ico-prism" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M1.2 8H4.6"/><path d="M7.6 4.4L10.6 8L7.6 11.6L4.6 8Z"/>' +
        '<path class="ray ray-1" d="M11.6 4.8H14.8"/><path class="ray ray-2" d="M11.9 8H14.8"/><path class="ray ray-3" d="M11.6 11.2H14.8"/></svg>';
    }
    if (type === 'gravity') {
      return '<svg class="dk-orch-svg ico-gravity" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="2.05" fill="currentColor" stroke="none"/>' +
        '<g class="orbit-ring"><path d="M3.4 4.8A5.6 5.6 0 0 1 11.2 3.4"/><circle cx="11.6" cy="3.8" r="1.15" fill="currentColor" stroke="none"/>' +
        '<path d="M12.6 11.2A5.6 5.6 0 0 1 4.8 12.6"/><circle cx="4.4" cy="12.2" r="1.15" fill="currentColor" stroke="none"/></g></svg>';
    }
    if (type === 'semicircle') {
      return '<svg class="dk-orch-svg ico-semicircle" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">' +
        '<circle cx="8" cy="12.2" r="1.8" fill="currentColor" stroke="none"/>' +
        '<circle class="seat s1" cx="2.2" cy="8.7" r="1.12"/><circle class="seat s2" cx="4.5" cy="5.8" r="1.12"/>' +
        '<circle class="seat s3" cx="8" cy="4.7" r="1.12"/><circle class="seat s4" cx="11.5" cy="5.8" r="1.12"/>' +
        '<circle class="seat s5" cx="13.8" cy="8.7" r="1.12"/></svg>';
    }
    return '';
  };

  const starsMarkup = count => {
    const seeds = [
      [22, 32, 6, 4.2, -0.4], [54, 68, 5, 5.2, -1.8], [86, 26, 7, 3.9, -2.5],
      [116, 72, 5, 4.7, -0.9], [144, 40, 6, 4.3, -3.1], [168, 62, 5, 5.0, -1.2],
    ];
    return seeds.slice(0, count).map(([x, y, s, dur, del]) =>
      `<span class="dk-orch-sdot" style="left:${x}px;top:${y}%;width:${s}px;height:${s}px;margin-top:${-s / 2}px;--dur:${dur}s;--del:${del}s"></span>`
    ).join('');
  };

  let style = '', engineKey = 'helix', shape = 'pill', icon = '', motion = 'fast';
  let modelName = '', liveEnergy = 0.85;
  // The style may follow the slider theme, but the color follows the actual main model.
  let palette = mt.resolvePalette(modelName);
  let active = false, open = false, disposed = false;
  let width = 196;
  let engine = null;
  let burstRaf = 0;

  const sysReduced = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const instantTransition = () => sysReduced();

  const surfaceIsLight = () => {
    try {
      const bg = getComputedStyle(document.body).backgroundColor || '';
      const parts = bg.match(/[\d.]+/g);
      if (!parts || parts.length < 3 || (parts.length > 3 && Number(parts[3]) < 0.5)) return false;
      return (0.2126 * Number(parts[0]) + 0.7152 * Number(parts[1]) + 0.0722 * Number(parts[2])) / 255 >= 0.5;
    } catch {
      return false;
    }
  };

  const measureWidth = () => {
    const w = Math.round(button.getBoundingClientRect?.().width || 0);
    if (w >= 48) width = w;
    return width;
  };

  const stopEngine = () => {
    if (burstRaf) { cancelAnimationFrame(burstRaf); burstRaf = 0; }
    if (engine) { engine.destroy(); engine = null; }
  };

  const startTheme3D = canvas => {
    const ctx = canvas?.getContext?.('2d', { alpha: true });
    if (!ctx) return null;
    const H = 28;
    let W = measureWidth();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = nextW => {
      W = Math.max(80, Math.round(nextW || W));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(W);

    let rafId = 0;
    let target = active ? 1 : 0;
    let animP = target;
    let fromP = target;
    let animStart = performance.now();
    let oPhase = 0;
    let oClock = 0;
    let smoothEnergy = Math.max(0.18, liveEnergy);
    let lastTime = performance.now();
    let isLight = surfaceIsLight();
    let lightCheckedAt = performance.now();

    const paint = now => {
      const targetE = Math.max(0.18, liveEnergy);
      const isFull = motion === 'full';
      const p = animP;
      const turningOn = target === 1;
      const reach = turningOn ? mt.easeOutCubic(mt.clamp01(p / 0.72)) : mt.easeInOutCubic(mt.clamp01((p - 0.08) / 0.88));
      const bgRev = turningOn ? mt.easeOutCubic(mt.clamp01(p / 0.55)) : mt.easeInOutCubic(mt.clamp01(p / 0.85));
      const impactU = turningOn ? mt.clamp01((p - 0.62) / 0.38) : 0;
      const impact = turningOn ? Math.sin(impactU * Math.PI) : 0;
      const primaryPal = palette;

      const pop = turningOn && !instantTransition() ? impact * (isFull ? 0.018 : 0.010) : 0;
      button.style.transform = pop > 0.001 ? `scale3d(${(1 + pop).toFixed(4)}, ${(1 + pop).toFixed(4)}, 1)` : '';

      const [cr, cg, cb] = primaryPal.core;
      const eGlow = Math.pow(mt.clamp01(smoothEnergy), 1.3);
      const gAlpha = (0.05 + 0.24 * eGlow + impact * (isFull ? 0.14 : 0.09)) * bgRev;
      button.style.boxShadow = bgRev > 0.02
        ? `0 3px ${Math.round(7 + 9 * eGlow)}px -2px rgba(${cr},${cg},${cb},${gAlpha.toFixed(3)}), inset 0 0 0 1px rgba(255,255,255,${((0.12 + 0.14 * eGlow) * bgRev).toFixed(3)})`
        : 'inset 0 0 0 1px var(--orch-off-border)';

      mt.paintOrchestrator3D(ctx, {
        w: W,
        h: H,
        engineKey,
        primaryPal,
        elementId: primaryPal.id,
        reach,
        bgReveal: bgRev,
        impact,
        impactU,
        oPhase,
        clock: oClock,
        energy: smoothEnergy,
        isLight,
        motion,
      });

      return Math.abs(smoothEnergy - targetE) > 0.004;
    };

    const tick = now => {
      if (!open || slot.hidden) { rafId = 0; return; }
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      if (now - lightCheckedAt >= 800) {
        isLight = surfaceIsLight();
        lightCheckedAt = now;
      }
      const isFull = motion === 'full';
      const dur = target === 1 ? (isFull ? 720 : 260) : (isFull ? 500 : 185);
      if (instantTransition()) {
        animP = target;
      } else if (Math.abs(animP - target) > 0.0005) {
        const u = mt.clamp01((now - animStart) / dur);
        animP = fromP + (target - fromP) * u;
        if (u >= 1) animP = target;
      } else {
        animP = target;
      }
      const targetE = Math.max(0.18, liveEnergy);
      smoothEnergy += (targetE - smoothEnergy) * (1 - Math.exp(-dt * (isFull ? 9 : 16)));
      const loopMul = isFull ? 0.74 : 1.25;
      const phaseBoost = Math.abs(animP - target) > 0.02 ? (isFull ? 1.55 : 2.1) : 1.0;
      oPhase += dt * (0.82 + smoothEnergy * 1.95) * (palette.speedMul || 1) * loopMul * phaseBoost;
      oClock += dt * loopMul;

      const energyMoving = paint(now);
      if (!sysReduced() && (target === 1 || animP > 0.002 || energyMoving)) {
        rafId = requestAnimationFrame(tick);
      } else {
        button.style.transform = '';
        rafId = 0;
      }
    };

    const ensure = () => {
      if (!rafId && open && !slot.hidden && !sysReduced()) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    };

    paint(performance.now());
    if (active) ensure();

    return {
      resize(nextW) {
        if (Math.abs(nextW - W) >= 1) { resize(nextW); paint(performance.now()); }
      },
      setMotion() {
        if (instantTransition()) {
          animP = target; fromP = target; button.style.transform = '';
          paint(performance.now());
        }
        if (target === 1) ensure();
      },
      setContext() {
        paint(performance.now());
        if (target === 1 || animP > 0.002) ensure();
      },
      setOn(next, animate) {
        target = next ? 1 : 0;
        if (!animate || instantTransition() || !open || slot.hidden) {
          animP = target; fromP = target; button.style.transform = '';
          paint(performance.now());
          if (target === 1) ensure();
        } else {
          fromP = animP;
          animStart = performance.now();
          ensure();
        }
      },
      setOpen(isOpen) {
        if (isOpen) {
          resize(measureWidth());
          isLight = surfaceIsLight();
          paint(performance.now());
          if (target === 1 || animP > 0.002) ensure();
        } else if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
          button.style.transform = '';
        }
      },
      destroy() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        button.style.transform = '';
        button.style.boxShadow = '';
      },
    };
  };

  const startHelix = canvas => {
    const ctx = canvas?.getContext?.('2d', { alpha: true });
    if (!ctx) return null;
    const H = 28;
    let W = measureWidth();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = nextW => {
      W = Math.max(80, Math.round(nextW || W));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(W);

    let rafId = 0;
    let target = active ? 1 : 0;
    let progress = target;
    let burst = 0;
    let endImpact = 0;
    let phase = 0;
    let lastTime = performance.now();
    let sparks = [];

    const spawnSparks = () => {
      sparks = [];
      const count = motion === 'full' ? 24 : 10;
      const speedScale = motion === 'full' ? 1 : 1.35;
      const decayBase = motion === 'full' ? 1.15 : 1.9;
      for (let i = 0; i < count; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        sparks.push({
          x: W * 0.5 + (Math.random() - 0.5) * 10,
          vx: dir * (72 + Math.random() * 135) * speedScale,
          angle: Math.random() * Math.PI * 2,
          vAngle: (5.5 + Math.random() * 6.5) * dir,
          radius: 3 + Math.random() * 6.8,
          size: 0.9 + Math.random() * 1.4,
          life: 1,
          decay: decayBase + Math.random() * 0.85,
        });
      }
    };

    const drawRibbon = (side, frontPass, reach, energy, ambient) => {
      const cx = W * 0.5, cy = H * 0.5, len = (W * 0.5 - 11) * reach;
      if (len < 2) return;
      const steps = 24;
      for (let strand = 0; strand < 2; strand++) {
        const basePhase = strand * Math.PI + (side < 0 ? 0.35 : 0);
        for (let i = 0; i < steps; i++) {
          const u0 = i / steps, u1 = (i + 1) / steps, um = (u0 + u1) * 0.5;
          const th0 = u0 * Math.PI * 3.0 - phase + basePhase;
          const th1 = u1 * Math.PI * 3.0 - phase + basePhase;
          const z = Math.cos((th0 + th1) * 0.5);
          if (frontPass ? z < 0 : z >= 0) continue;

          const env0 = Math.sin(Math.min(1, u0 * 1.04) * Math.PI * 0.92 + 0.12);
          const env1 = Math.sin(Math.min(1, u1 * 1.04) * Math.PI * 0.92 + 0.12);
          const ry = 8.2;
          const x0 = cx + side * u0 * len, y0 = cy + Math.sin(th0) * ry * env0;
          const x1 = cx + side * u1 * len, y1 = cy + Math.sin(th1) * ry * env1;

          const headFactor = Math.max(0, 1 - Math.abs(um - 0.88) * 3.2) * energy;
          const depthNorm = (z + 1) * 0.5;
          const baseAlpha = (ambient * 0.28 + energy * 0.72 + headFactor * 0.45) * (0.20 + depthNorm * 0.80);
          const alpha = Math.min(1, baseAlpha * Math.sin(Math.min(1, um) * Math.PI * 0.95 + 0.08));
          if (alpha < 0.015) continue;

          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineCap = 'round';
          ctx.lineWidth = (1.5 + depthNorm * 3.3) * (0.72 + energy * 0.55);
          ctx.strokeStyle = frontPass
            ? `rgba(216, 180, 254, ${(alpha * 0.56).toFixed(3)})`
            : `rgba(124, 58, 237, ${(alpha * 0.44).toFixed(3)})`;
          ctx.stroke();

          if (frontPass) {
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
            ctx.lineWidth = (0.7 + depthNorm * 1.35) * (0.75 + energy * 0.45);
            ctx.strokeStyle = `rgba(255, 250, 255, ${(alpha * 0.94).toFixed(3)})`;
            ctx.stroke();
          }
        }
      }
    };

    const drawNode = (x, y, power, impact) => {
      const r = 6.5 + impact * 9;
      if (power > 0.04) {
        const g = ctx.createRadialGradient(x, y, 0.5, x, y, r);
        g.addColorStop(0, `rgba(255, 255, 255, ${(0.92 * power).toFixed(3)})`);
        g.addColorStop(0.35, `rgba(216, 180, 254, ${(0.55 * power + impact * 0.35).toFixed(3)})`);
        g.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(x, y, 2.0 + impact * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = power > 0.1
        ? `rgba(250, 245, 255, ${(0.45 + power * 0.55).toFixed(3)})`
        : 'rgba(139, 92, 246, 0.32)';
      ctx.fill();
    };

    const paint = () => {
      ctx.clearRect(0, 0, W, H);
      const reach = 1 - Math.pow(1 - progress, 3);
      if (reach > 0.02) { drawRibbon(-1, false, reach, burst, progress); drawRibbon(1, false, reach, burst, progress); }
      if (burst > 0.02) {
        const coreR = 7 + (1 - burst) * 24;
        const cg = ctx.createRadialGradient(W * 0.5, H * 0.5, 1, W * 0.5, H * 0.5, coreR);
        cg.addColorStop(0, `rgba(255, 255, 255, ${(burst * 0.95).toFixed(3)})`);
        cg.addColorStop(0.35, `rgba(216, 180, 254, ${(burst * 0.65).toFixed(3)})`);
        cg.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(W * 0.5, H * 0.5, coreR, 0, Math.PI * 2); ctx.fill();
      }
      for (const p of sparks) {
        const depth = (Math.cos(p.angle) + 1) * 0.5;
        const py = H * 0.5 + Math.sin(p.angle) * p.radius;
        const rad = p.size * (0.65 + depth * 0.7);
        const a = p.life * (0.35 + depth * 0.65);
        const pg = ctx.createRadialGradient(p.x, py, 0, p.x, py, rad * 2.4);
        pg.addColorStop(0, `rgba(255, 255, 255, ${a.toFixed(3)})`);
        pg.addColorStop(0.5, `rgba(216, 180, 254, ${(a * 0.65).toFixed(3)})`);
        pg.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(p.x, py, rad * 2.4, 0, Math.PI * 2); ctx.fill();
      }
      if (reach > 0.02) { drawRibbon(-1, true, reach, burst, progress); drawRibbon(1, true, reach, burst, progress); }
      const nodePower = Math.max(0, (progress - 0.55) / 0.45) * (0.85 + 0.15 * Math.sin(phase * 0.9));
      drawNode(11, H * 0.5, nodePower, endImpact);
      drawNode(W - 11, H * 0.5, nodePower, endImpact);
    };

    const tick = now => {
      if (!open || slot.hidden) { rafId = 0; return; }
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const isFull = motion === 'full';
      const speed = isFull ? (target > progress ? 3.8 : 4.8) : (target > progress ? 13 : 15);
      const prev = progress;
      if (instantTransition()) {
        progress = target;
      } else {
        progress += (target - progress) * (1 - Math.exp(-speed * dt));
        if (Math.abs(target - progress) < 0.002) progress = target;
      }
      if (prev < 0.86 && progress >= 0.86 && target === 1 && !instantTransition()) endImpact = 1;
      burst = Math.max(0, burst - dt * (isFull ? 1.25 : 3.8));
      endImpact = Math.max(0, endImpact - dt * (isFull ? 1.6 : 4.6));
      phase += dt * (isFull ? 1.65 + burst * 6.5 : 3.0 + burst * 7.0);
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.x += p.vx * dt; p.vx *= Math.pow(0.28, dt); p.angle += p.vAngle * dt; p.life -= p.decay * dt;
        if (p.life <= 0 || p.x < 6 || p.x > W - 6) sparks.splice(i, 1);
      }
      paint();
      if (!sysReduced() && (target === 1 || progress > 0.002 || burst > 0.002 || sparks.length > 0)) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    };

    const ensure = () => {
      if (!rafId && open && !slot.hidden && !sysReduced()) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    };

    paint();
    if (active) ensure();

    return {
      resize(nextW) {
        if (Math.abs(nextW - W) >= 1) { resize(nextW); paint(); }
      },
      setMotion() {
        if (instantTransition()) {
          progress = target; burst = 0; endImpact = 0; sparks = [];
          paint();
        }
        if (target === 1) ensure();
      },
      setOn(next, animate) {
        target = next ? 1 : 0;
        if (!animate || instantTransition() || !open || slot.hidden) {
          progress = target; burst = 0; endImpact = 0; sparks = [];
          paint();
          if (target === 1) ensure();
        } else {
          if (next) { burst = 1; spawnSparks(); }
          else { burst = 0.35; }
          ensure();
        }
      },
      setOpen(isOpen) {
        if (isOpen) {
          resize(measureWidth());
          paint();
          if (target === 1 || progress > 0.002) ensure();
        } else if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      },
      destroy() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; },
    };
  };

  const startOrbSpring = () => {
    const orb = button.querySelector('.dk-orch-orb');
    const fill = button.querySelector('.dk-orch-fill-slide');
    const glow = button.querySelector('.dk-orch-glow');
    const bloom = button.querySelector('.dk-orch-bloom');
    if (!orb || !fill || !glow || !bloom) return null;

    let W = measureWidth();
    let target = active ? 1 : 0;
    let pos = target;
    let vel = 0;
    let bloomLife = 0;
    let rafId = 0;
    let lastTime = performance.now();

    const springParams = () => motion === 'full'
      ? { stiffness: 210, damping: 18, stretchCap: 0.38, stretchVel: 0.052, bloomDecay: 0.032, bloomPeak: 1 }
      : { stiffness: 880, damping: 48, stretchCap: 0.16, stretchVel: 0.018, bloomDecay: 0.1, bloomPeak: 0.6 };

    const paint = () => {
      const { stretchCap, stretchVel } = springParams();
      const travel = Math.max(0, W - 28);
      const span = Math.max(0, W - 24);
      const p = Math.max(0, Math.min(1.03, pos));
      const x = pos * travel;
      const sx = 1 + Math.min(stretchCap, Math.abs(vel) * stretchVel);
      const sy = 1 / Math.sqrt(sx);
      orb.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0) scale3d(${sx.toFixed(3)}, ${sy.toFixed(3)}, 1)`;
      const fillTx = -span + Math.min(1, p) * span;
      fill.style.transform = `translate3d(${fillTx.toFixed(2)}px, 0, 0)`;
      fill.style.opacity = Math.max(0, Math.min(1, p * 1.45)).toFixed(3);
      glow.style.opacity = Math.max(0, Math.min(1, p)).toFixed(3);
      if (bloomLife > 0.005) {
        const t = 1 - bloomLife;
        bloom.style.opacity = (bloomLife * 0.85).toFixed(3);
        bloom.style.transform = `translate3d(-50%, -50%, 0) scale3d(${(0.65 + t * 0.95).toFixed(3)}, ${(0.65 + t * 0.75).toFixed(3)}, 1)`;
      } else {
        bloom.style.opacity = '0';
      }
    };

    const tick = now => {
      if (!open || slot.hidden) { rafId = 0; return; }
      const { stiffness, damping, bloomDecay } = springParams();
      let dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      while (dt > 0) {
        const step = Math.min(0.008, dt);
        const accel = (target - pos) * stiffness - vel * damping;
        vel += accel * step;
        pos += vel * step;
        dt -= step;
      }
      if (bloomLife > 0) bloomLife = Math.max(0, bloomLife - bloomDecay);
      if (Math.abs(target - pos) < 0.0008 && Math.abs(vel) < 0.004 && bloomLife <= 0.005) {
        pos = target; vel = 0; bloomLife = 0;
        paint();
        rafId = 0;
        return;
      }
      paint();
      rafId = requestAnimationFrame(tick);
    };

    const ensure = () => {
      if (!rafId && open && !slot.hidden) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    };

    paint();

    return {
      resize(nextW) {
        if (Math.abs(nextW - W) >= 1) { W = nextW; paint(); }
      },
      setMotion() {
        if (instantTransition()) {
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          pos = target; vel = 0; bloomLife = 0;
          paint();
        }
      },
      setOn(next, animate) {
        target = next ? 1 : 0;
        W = measureWidth();
        if (!animate || instantTransition() || !open || slot.hidden) {
          pos = target; vel = 0; bloomLife = 0;
          paint();
        } else {
          if (next) bloomLife = springParams().bloomPeak;
          ensure();
        }
      },
      setOpen(isOpen) {
        if (isOpen) {
          W = measureWidth();
          paint();
        } else if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
          pos = target; vel = 0; bloomLife = 0;
          paint();
        }
      },
      destroy() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; },
    };
  };

  const triggerBurst = () => {
    if (burstRaf) { cancelAnimationFrame(burstRaf); burstRaf = 0; }
    button.classList.remove('is-burst');
    if (!active || instantTransition() || !open || slot.hidden) return;
    burstRaf = requestAnimationFrame(() => {
      burstRaf = 0;
      if (!disposed && active) button.classList.add('is-burst');
    });
  };

  const replayOnOpen = () => {
    if (!active || !open || slot.hidden || instantTransition()) return;
    if (burstRaf) { cancelAnimationFrame(burstRaf); burstRaf = 0; }
    if (engine) {
      engine.setOn(false, false);
      burstRaf = requestAnimationFrame(() => {
        burstRaf = 0;
        if (!disposed && active) engine?.setOn(true, true);
      });
    } else {
      button.classList.remove('is-burst');
      button.setAttribute('aria-checked', 'false');
      burstRaf = requestAnimationFrame(() => {
        burstRaf = 0;
        if (!disposed && active) {
          button.setAttribute('aria-checked', 'true');
          button.classList.add('is-burst');
        }
      });
    }
  };

  const renderMarkup = (replayIfActive = false) => {
    stopEngine();
    slot.dataset.style = style;
    slot.dataset.engine = engineKey;
    slot.dataset.shape = shape;
    slot.dataset.icon = icon;
    slot.dataset.motion = motion;
    button.dataset.style = style;
    button.dataset.engine = engineKey;
    button.dataset.shape = shape;
    button.dataset.icon = icon;
    button.classList.remove('is-burst');
    const svg = iconMarkup(icon);

    if (style === 'theme3d') {
      button.innerHTML =
        '<canvas class="dk-orch-canvas" aria-hidden="true"></canvas>' +
        `<span class="dk-orch-label">${svg}<span>Orchestrator</span></span>`;
      engine = startTheme3D(button.querySelector('.dk-orch-canvas'));
    } else if (style === 'nebula') {
      button.innerHTML =
        '<span class="dk-orch-glow" aria-hidden="true"></span>' +
        '<span class="dk-orch-clip" aria-hidden="true"><span class="dk-orch-fill"></span>' +
        `<span class="dk-orch-stars">${starsMarkup(5)}</span><span class="dk-orch-sweep"></span></span>` +
        `<span class="dk-orch-label">${svg}<span>Orchestrator</span></span>`;
    } else if (style === 'beam') {
      button.innerHTML =
        '<span class="dk-orch-ring" aria-hidden="true"></span>' +
        '<span class="dk-orch-glow" aria-hidden="true"></span>' +
        '<span class="dk-orch-clip" aria-hidden="true"><span class="dk-orch-beam"></span></span>' +
        `<span class="dk-orch-inner">${svg}<span>Orchestrator</span></span>`;
    } else if (style === 'helix') {
      button.innerHTML =
        '<span class="dk-orch-glow" aria-hidden="true"></span>' +
        '<span class="dk-orch-tube" aria-hidden="true"><span class="dk-orch-depth"></span>' +
        '<canvas class="dk-orch-canvas"></canvas><span class="dk-orch-specular"></span></span>' +
        `<span class="dk-orch-label">${svg}<span>Orchestrator</span></span>`;
      engine = startHelix(button.querySelector('.dk-orch-canvas'));
    } else if (style === 'dock') {
      button.innerHTML =
        '<span class="dk-orch-pulse" aria-hidden="true"></span>' +
        '<span class="dk-orch-wave" aria-hidden="true"></span>' +
        `<span class="dk-orch-label">${svg}<span>Orchestrator</span>` +
        `<span class="dk-orch-badge" aria-hidden="true">${active ? 'ON' : 'OFF'}</span></span>`;
    } else {
      button.innerHTML =
        '<span class="dk-orch-glow" aria-hidden="true"></span>' +
        `<span class="dk-orch-clip" aria-hidden="true"><span class="dk-orch-fill-slide"></span><span class="dk-orch-stars">${starsMarkup(4)}</span></span>` +
        '<span class="dk-orch-bloom" aria-hidden="true"></span>' +
        '<span class="dk-orch-orb" aria-hidden="true"></span>' +
        `<span class="dk-orch-label">${svg}<span>Orchestrator</span></span>`;
      engine = startOrbSpring();
    }

    if (replayIfActive) replayOnOpen();
  };

  const applyAdaptivePalette = () => {
    const coreRgb = palette.core.join(', ');
    const glowRgb = palette.glow.join(', ');
    palette.stops.forEach((stop, i) => slot.style.setProperty('--orch-c' + i, stop));
    slot.style.setProperty('--orch-core-rgb', coreRgb);
    slot.style.setProperty('--orch-glow-rgb', glowRgb);
    slot.style.setProperty('--orch-accent', palette.accent);
    if (slot.parentElement) slot.parentElement.style.setProperty('--orch-core-rgb', coreRgb);
  };

  const syncPrefs = (replay = false) => {
    const prefs = effects.readSettings(window);
    const resolved = mt.resolveOrchestratorEngine(prefs, modelName);
    const nextStyle = resolved.kind === 'classic' ? resolved.style : 'theme3d';
    const nextEngineKey = resolved.style;
    const nextShape = resolved.shape || 'pill';
    const nextIcon = prefs.orchestratorIcon || 'prism';
    const nextMotion = prefs.motion || 'fast';
    const nextPalette = mt.resolvePalette(modelName);
    const markupChanged = nextStyle !== style || nextIcon !== icon;
    const engineChanged = nextEngineKey !== engineKey || nextShape !== shape;
    const motionChanged = nextMotion !== motion;
    const paletteChanged = nextPalette !== palette;
    style = nextStyle;
    engineKey = nextEngineKey;
    shape = nextShape;
    icon = nextIcon;
    motion = nextMotion;
    palette = nextPalette;
    slot.dataset.motion = motion;
    slot.dataset.engine = engineKey;
    slot.dataset.shape = shape;
    button.dataset.engine = engineKey;
    button.dataset.shape = shape;
    applyAdaptivePalette();
    if (markupChanged) {
      renderMarkup(replay);
    } else if ((engineChanged || motionChanged) && replay) {
      engine?.setMotion?.();
      if (active && open && !slot.hidden) {
        if (!instantTransition()) replayOnOpen();
        else {
          button.classList.remove('is-burst');
          engine?.setOn(true, false);
        }
      } else {
        engine?.setContext?.();
      }
    } else if (paletteChanged || engineChanged) {
      engine?.setContext?.();
    }
  };

  let resizeObserver = null;
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(entries => {
      const nextW = Math.round(entries[0]?.contentRect?.width || 0);
      if (nextW >= 48) {
        width = nextW;
        engine?.resize(nextW);
      }
    });
    resizeObserver.observe(button);
  }

  const offPrefs = effects.onSettingsChange(() => syncPrefs(true), window);
  syncPrefs(false);

  button.addEventListener('click', () => {
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    onToggle();
  });
  button.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    onContextMenu?.(event.clientX, event.clientY, button, 'orch');
  });
  button.addEventListener('keydown', event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = button.getBoundingClientRect();
    onContextMenu?.(rect.left, rect.bottom + 4, button, 'orch');
  });

  return {
    element: slot,
    button,
    setContext(nextModel, nextEnergy) {
      const prevModel = modelName;
      if (typeof nextModel === 'string' && nextModel) modelName = nextModel;
      if (typeof nextEnergy === 'number' && Number.isFinite(nextEnergy)) liveEnergy = nextEnergy;
      if (modelName !== prevModel) {
        syncPrefs(false);
      } else {
        engine?.setContext?.();
      }
    },
    setState({ visible, disabled, ariaDisabled, checked, modelName: nextModel, energy: nextEnergy }) {
      const wasHidden = slot.hidden;
      const prevActive = active;
      if (typeof nextModel === 'string' && nextModel && nextModel !== modelName) {
        modelName = nextModel;
        syncPrefs(false);
      }
      if (typeof nextEnergy === 'number' && Number.isFinite(nextEnergy)) liveEnergy = nextEnergy;
      slot.hidden = !visible;
      button.disabled = Boolean(disabled);
      button.setAttribute('aria-disabled', String(Boolean(ariaDisabled)));
      active = Boolean(checked);
      button.setAttribute('aria-checked', String(active));
      const badge = button.querySelector('.dk-orch-badge');
      if (badge) badge.textContent = active ? 'ON' : 'OFF';
      const animate = !wasHidden && open && prevActive !== active;
      if (engine) engine.setOn(active, animate);
      else if (animate) triggerBurst();
      else if (!active) button.classList.remove('is-burst');
      if (wasHidden && visible && open) {
        measureWidth();
        engine?.setOpen(true);
      }
    },
    setOpen(next) {
      open = Boolean(next);
      slot.dataset.open = String(open);
      if (open && !slot.hidden) measureWidth();
      engine?.setOpen(open && !slot.hidden);
      if (!open) button.classList.remove('is-burst');
    },
    dispose() {
      disposed = true;
      stopEngine();
      resizeObserver?.disconnect();
      resizeObserver = null;
      offPrefs?.();
    },
  };
}

// Static settings thumbnail uses the same track geometry and Neon nebula palette, without a frame loop.
export const EFFORT_TRACK_MARKUP = '<div class="ces-inline" data-energy="1" style="--ces-energy:1"><div class="ces-track" style="--ces-fill:calc(100% - 14px);--ces-fill-bg:linear-gradient(90deg,#3d0d26,#7a193f,#a82c52,#bd534a)"><div class="ces-fill" style="width:var(--ces-fill);background:var(--ces-fill-bg)"><span class="pv-nebula" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></div><div class="ces-knob"></div></div></div>';
