# agy-capsule

Real-time context window usage, multi-model quota, cache status, generation speed, and turn telemetry plugin for Antigravity.

## Composer Footer & Popovers

Injects a shadow-DOM metrics strip into the Antigravity composer footer via the local DevTools (CDP) endpoint:

- **Enhanced model capsule** (optional, off by default): Native-styled model & effort selector supporting both existing and new conversations (Antigravity 2.33 selector provider with 2.32 fallback). Hover multi-tier models to select an effort tier from the side flyout, or click a model row directly to inherit the current effort (`XHigh`/`Extra`/`Max` downgrades to `High` when unsupported). Can either keep the native trigger as a compact `⋯` bubble or replace it in place, and falls back to the native button if the host interface changes or narrow-width collapse activates.
- **Context capsule**: Live context usage percentage (`0 / --` before the first turn), optional **Generation speed** (latest completed request in the current turn), and optional **Effects** (breathing dot while generating: red `<10 tok/s`, yellow `10–25 tok/s`, green `≥25 tok/s`; retains speed color for 15s after completion before graying out).
- **Quota capsule**: Matched model pool quotas (`5 Hours` and `Weekly`) across `Gemini`, `Claude`, `Argon`, and `Carbon`, with reset countdowns. When no subscription quota is returned and Antigravity confirms the account uses Cloud pay-as-you-go billing, the entire quota capsule is hidden.
- **Third capsule — Request failure & First-token wait alert** (both optional; request failure takes priority):
  - **Request failure**: Appears in red when a request fails, classifying `Quota exhausted`, `Rate limited` (429 + retry wait when reported), `Disconnected`, `Authentication error`, `Service busy`, or `Unknown reason` with raw diagnostics in its panel.
  - **First-token wait alert**: An amber capsule appears when a wait reaches the threshold (default `30s`, range `1–999s`). `Wait×2 40s` means two intervals reached the threshold this turn, including a current estimate of 40 seconds. Active tools and streaming stop the live clock. Earlier slow waits remain visible in the panel.
- **Hover & click-to-pin**: Hover any capsule to open its popover panel; click to pin it open (click again, click outside, or press `Escape` to close).
- **4-level narrow-width progressive fallback**: When composer width shrinks, degrades in stages (collapses Turbo selector / hides speed and error label → hides secondary quota window → hides quota and context percentages down to icon-only → ellipsis-truncates the model selector and hides remaining capsules if space is exhausted) to preserve hover access without overlap.

## Sidebar (`… → Extensions → agy-capsule`)

Provides **Statistics** and **Settings** tabs at the top (settings live exclusively in the Sidebar; the composer footer displays capsules and popovers). Theme always follows host CSS variables (`Source Han Sans` with local system-UI font fallbacks).

- **Languages** (`en` / `zh-CN` / `zh-TW`): Independent **Display language** (`en` default, for stats/panels) and **Settings language** (`zh-CN` default, for the Settings UI).
- **Appearance**:
  - **Panel skin**: `native` (default) or `frosted` (footer panels only: the host `--card` color made translucent over a blurred backdrop; colors still come from the host theme variables, with no light/dark detection)
  - **Panel height**: `natural` (default) or `matched`
  - **Panel spacing**: `compact` (default), `standard`, or `spacious`
  - **Label casing**: `lowercase` (default) or `titlecase`
  - **Quota indicator**: `ring` (default) or `bar`
  - **Cache indicator**: `icon` (default), `ring`, or `bar` (linear progress over elapsed idle time: green → yellow → full red)
  - **Cache hit rate**: `percent` (default), `ring`, or `both` (a ring whose arc is the hit rate replaces the percentage in the Cache row or sits next to it; independent of the expiry-progress Cache indicator)
  - **Reset countdown**: `compact` (default) or `localized`
  - **Panel pop-in animation**: `false` (panels fade and rise slightly as they open; never plays while the system asks for reduced motion)
- **Features** (unified section):
  - **Enhanced model capsule**: `false` — with **Keep native button** (`true`), **Hide model tags** (`false`), **Hide default effort** (`false`), and **Customize models** (`false`, persists `hiddenModels` in `settings.json`)
    - **Effort bar**: `false` — replaces hover submenus with an animated slider and keeps the menu open after selecting a model. Right-click the slider for animation, tick mark, and style options.
  - **Highlight active model**: `false` (dims non-active quota pools when enabled)
  - **Hide absent quota windows**: `true` (hides empty windows such as Argon's missing 5h window on AI Pro)
  - **Quota group dividers**: `true` (thin line between quota pools in the footer panel and in a narrow sidebar, where pools are stacked rather than shown as cards)
  - **Cache expiry alert**: `true` with configurable yellow/red thresholds (`cacheWarnMin`: `3m`, `1–998`; `cacheColdMin`: `4m`, `2–999`; synced with panel Cache row)
  - **Context overload alert**: `true` (capsule text turns yellow above 75% and red above 90%)
  - **Request failure alert**: `true`
  - **Restart recovery notice**: `true` (if the debug port is unavailable after a launch without the debugging flag and the footer capsule previously worked, shows a sidebar notice with Windows shortcut detection / one-click restore and sends at most one desktop notification per session)
  - **Generation speed** (`true`) + **Effects** (`false`; automatically forced off when speed is disabled)
  - **Context breakdown**: `true`; `columns` (default) or `rows`, `square` (default) or `dot` markers, with toggleable and drag-reorderable column fields (`Name`: `true`, `Value`: `true`, `%`: `false`; default order `label,value,percent`)
  - **Breakdown hover highlight**: `false` (pointing at a segment of the progress bar or at a breakdown item keeps that segment and its item lit and dims the rest; CSS only; works in the sidebar and in a pinned footer panel)
  - **Last request**: `true` (shows `TTFT–total duration` range and generation speed)
  - **Compact status bar**: `false`; `bottom` (default) or `top` (replaces the panels' Cache row and Last request row with one bar: hit-rate ring and percentage, TTFT, speed; `bottom` docks it along the panel's lower edge, `top` makes it a flat first row over a hairline; near expiry the time left stands in for the percentage, a cold cache is a dashed red ring, and the bolt icon takes the speed tier's color; a single cache row when there is no request to show or Last request is off; `cacheIndicator` and `cacheHitFormat` have no effect on the panels while it is on; nothing is computed for it while it is off)
  - **Turn metrics**: `false`; `columns` (default) or `rows`, `square` (default) or `dot` markers
  - **First-token wait alert**: `true` with configurable threshold (`queueWarnSec`: `30s`, `1–999`)
- **Usage history** (dedicated section at the bottom of Settings, with `?` scope tooltip):
  - **Token activity**: `false` (sidebar statistics only: today / this week / this month / all-time usage and a daily or weekly activity map of the past year, with four-part breakdowns on hover; nothing is read while it is off)
  - **Usage by model**: `false` (sidebar statistics only: stacked bars per model family by day, week or month with paging to earlier periods, and a per-family list with tokens, share, four-part breakdown and per-tier hover split; shares the scan above, and nothing is read while both are off)

## Telemetry & Metric Definitions

- **Ground-truth SQLite telemetry**: Reads exact API token counts (`uncached_input`, `cached_input`, `output_tokens`, `thinking_tokens`) from the current host's `conversations/<id>.db` and resolves context limits from model metadata. Custom data roots are identified via `ANTIGRAVITY_EXECUTABLE_DATA_DIR`. Without a host path, the plugin looks for that chat ID under `~/.gemini/{antigravity,antigravity-ide,antigravity-cli}`.
- **Compaction-aware breakdown**: Computes active context usage from the latest billed turn (`uncached_input + cached_input`) and resets 4-category accumulation (`Turn0`, `Read`, `Think`, `Write`) at the latest compaction checkpoint (`step_type = 23` or token-drop fallback).
- **Generation speed**: `total output ÷ (TTFT + streaming time)` for the latest completed model request (`output = reply + thinking`; excludes tool execution; missing or zero timings yield `—`).
- **Last request**: Covers only the most recent recorded model request (`TTFT–request duration` and speed); unrelated to full-turn totals.
- **Turn metrics**: Aggregates elapsed wall-clock time (including queueing, waits, and tool execution), request count (recorded retries included; pure preflight/injected responses excluded), `Write`, and `Think` tokens starting from the latest sent user message.
- **Cache expiry estimate**: The warning / cold status (default `3m` / `4m`, configurable in Settings) is estimated locally from elapsed time since the last recorded step; actual cache hits depend on the server.
- **First-token wait alert** combines reported request TTFT with local step timing. The live estimate may start when processing the message begins or after a previous step finishes; it does not use the time the message was queued. The cause is unknown. The count resets when processing the next message begins.
- **Usage history**: Sums `input_tokens` (uncached), `cache_read_tokens`, `cache_write_tokens` and `output_tokens` of every recorded model request across `conversations/*.db` in the current product data folder, dated in the local time zone (weeks start on Monday). Totals include cache reads (usually dominant in long chats, with no direct conversion to quota consumption) and are not a bill; deleted conversations are excluded, and a response stored in several files counts once with a deterministic tie-breaker. Databases are read incrementally with event-loop yields and only while at least one usage option is on and Statistics is open; idle closed databases without a non-empty `-wal` are opened with `immutable=1`, while active or recently modified databases use plain read-only with before/after `.db`/`-wal` fingerprint verification (discarding torn mid-read changes for the next scan). Models prefer `model_display_name` with fallback to `response_model` (or "Unknown model") and strip effort-tier suffixes to group by model family by default (tier splits appear on hover; beyond 6 families, the smallest share "Other models"). Totals stay in memory only.

## Install / Update / Uninstall

Run the scripts from the repository root:

| Action | Windows | macOS / Linux |
|---|---|---|
| Install | `install.bat` | `sh install.sh` |
| Update | `update.bat` *(pull latest code first)* | `sh update.sh` *(pull latest code first)* |
| Uninstall | `uninstall.bat` | `sh uninstall.sh` |

- Install and update sync this plugin directory to `~/.gemini/config/plugins/agy-capsule` (`%USERPROFILE%\.gemini\config\plugins\agy-capsule` on Windows) and prune stale files from prior versions.
- Preferences are stored separately at `~/.gemini/config/agy-capsule/settings.json` (`%USERPROFILE%\.gemini\config\agy-capsule\settings.json` on Windows) and are preserved across updates and uninstalls (missing keys fall back to defaults).
- **Self-reload watcher**: Polls installed runtime files every 1s (honoring `.update-in-progress` batch markers) and cleans up/exits after a 1.5s quiet period so Antigravity restarts the sidecar and reconnects open sidebars automatically. Updating from older versions without this watcher requires one manual plugin restart.

## Credits & Notices

- Selected features and visual/engineering ideas (multi-language support, panel visuals, active-model highlighting, click-to-pin, generation speed/effects, cache & quota tooltips, overload alerts, error classification, absent window hiding, style isolation, SQLite snapshot caching, incremental CDP pushes, and install maintenance) were adapted and reimplemented from [z21100644's PR #1](https://github.com/Lumidarin/agy-capsule/pull/1). Separate display/settings languages, independent appearance controls, the third failure capsule, narrow-width fallback order, turn metrics, and sidebar interactions were designed independently; 7-category context estimates and attachment scanning were not adopted.
- Quota popover overflow under browser/page translation extensions was reported with a proposed fix in [Krwaby123's PR #2](https://github.com/Lumidarin/agy-capsule/pull/2), resolved here via column alignment and no-translate attributes.
- Reading host model options from the Antigravity model trigger's React fiber tree for one-step model/effort selection was inspired by [antigravity-Codex-Claude-effort-slider](https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider), reimplemented here via the CDP injector with Antigravity 2.33 / new-chat support, hover effort submenus, effort inheritance, and model list customization.
- The optional effort bar incorporates its slider visuals and animations with the author's permission. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- The usage history's daily / weekly activity map and usage-by-model bars follow the idea of the usage window in [wycocoyu/agy-context-dashboard](https://github.com/wycocoyu/agy-context-dashboard) (MIT), reimplemented here on the local conversation databases instead of the local API and without a ledger of its own.

## License

[MIT](../LICENSE)
