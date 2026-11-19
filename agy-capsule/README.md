# agy-capsule

Real-time context window usage, multi-model quota, cache status, generation speed, and turn telemetry plugin for Antigravity.

## Composer Footer & Popovers

Injects a shadow-DOM metrics strip into the Antigravity composer footer via the local DevTools (CDP) endpoint:

- **Context capsule**: Live context usage percentage (`0 / --` before the first turn), optional **Generation speed** (latest completed request in the current turn), and optional **Effects** (breathing dot while generating: red `<10 tok/s`, yellow `10–25 tok/s`, green `≥25 tok/s`; retains speed color for 15s after completion before graying out).
- **Quota capsule**: Matched model pool quotas (`5 Hours` and `Weekly`) across `Gemini`, `Claude`, `Argon`, and `Carbon`, with reset countdowns. When no subscription quota is returned and Antigravity confirms the account uses Cloud pay-as-you-go billing, the entire quota capsule is hidden.
- **Third capsule — Request failure & Server queue alert** (both optional; request failure takes priority):
  - **Request failure**: Appears in red when a request fails, classifying `Quota exhausted`, `Rate limited` (429 + retry wait when reported), `Disconnected`, `Authentication error`, `Service busy`, or `Unknown reason` with raw diagnostics in its panel.
  - **Server queue alert**: Appears in amber when waiting for the first token in the current turn exceeds the threshold (`30s` default, configurable `1–999s`), showing live wait seconds and `×N` for repeated slow waits in the same turn (`Queue 35s`, `Queue×2 40s`, `Queue×2`) with wait details in its panel. Active local tools and streaming responses are excluded.
- **Hover & click-to-pin**: Hover any capsule to open its popover panel; click to pin it open (click again, click outside, or press `Escape` to close).
- **4-level narrow-width progressive fallback**: When composer width shrinks, degrades in stages (collapses Turbo selector / hides speed and error label → hides secondary quota window → hides quota and context percentages down to icon-only → ellipsis-truncates the model selector and hides remaining capsules if space is exhausted) to preserve hover access without overlap.

## Sidebar (`… → Extensions → agy-capsule`)

Provides **Statistics** and **Settings** tabs at the top (settings live exclusively in the Sidebar; the composer footer displays capsules and popovers). Theme always follows host CSS variables (`Source Han Sans` with local system-UI font fallbacks).

- **Languages** (`en` / `zh-CN` / `zh-TW`): Independent **Display language** (`en` default, for stats/panels) and **Settings language** (`zh-CN` default, for the Settings UI).
- **Appearance**:
  - **Panel height**: `natural` (default) or `matched`
  - **Panel spacing**: `compact` (default), `standard`, or `spacious`
  - **Label casing**: `lowercase` (default) or `titlecase`
  - **Quota indicator**: `ring` (default) or `bar`
  - **Cache indicator**: `icon` (default), `ring`, or `bar` (linear progress over elapsed idle time: green → yellow → full red)
  - **Reset countdown**: `compact` (default) or `localized`
  - **Panel pop-in animation**: `false` (panels fade and rise slightly as they open; never plays while the system asks for reduced motion)
- **Features** (unified section):
  - **Highlight active model**: `false` (dims non-active quota pools when enabled)
  - **Hide absent quota windows**: `true` (hides empty windows such as Argon's missing 5h window on AI Pro)
  - **Quota group dividers**: `true` (thin line between quota pools in the footer panel and in a narrow sidebar, where pools are stacked rather than shown as cards)
  - **Cache expiry alert**: `true` with configurable yellow/red thresholds (`cacheWarnMin`: `3m`, `1–998`; `cacheColdMin`: `4m`, `2–999`; synced with panel Cache row)
  - **Context overload alert**: `true` (capsule text turns yellow above 75% and red above 90%)
  - **Request failure capsule**: `true`
  - **Restart recovery notice**: `true` (when a previously-enabled footer capsule fails to attach after a launch that skipped the shortcut — e.g. Antigravity auto-update — shows a targeted sidebar notice with Windows shortcut detection / one-click restore, and sends at most one desktop notification per session)
  - **Generation speed** (`true`) + **Effects** (`false`; automatically forced off when speed is disabled)
  - **Context breakdown**: `true`; `columns` (default) or `rows`, `square` (default) or `dot` markers, with toggleable and drag-reorderable column fields (`Name`: `true`, `Value`: `true`, `%`: `false`; default order `label,value,percent`)
  - **Last request**: `true` (shows `TTFT–total duration` range and generation speed)
  - **Turn metrics**: `false`; `columns` (default) or `rows`, `square` (default) or `dot` markers
  - **Server queue alert**: `true` with configurable threshold (`queueWarnSec`: `30s`, `1–999`) at the end of Settings

## Telemetry & Metric Definitions

- **Ground-truth SQLite telemetry**: Reads exact API token counts (`uncached_input`, `cached_input`, `output_tokens`, `thinking_tokens`) from the current host's `conversations/<id>.db` and resolves context limits from model metadata. Custom data roots are identified via `ANTIGRAVITY_EXECUTABLE_DATA_DIR`. Without a host path, the plugin looks for that chat ID under `~/.gemini/{antigravity,antigravity-ide,antigravity-cli}`.
- **Compaction-aware breakdown**: Computes active context usage from the latest billed turn (`uncached_input + cached_input`) and resets 4-category accumulation (`Turn0`, `Read`, `Think`, `Write`) at the latest compaction checkpoint (`step_type = 23` or token-drop fallback).
- **Generation speed**: `total output ÷ (TTFT + streaming time)` for the latest completed model request (`output = reply + thinking`; excludes tool execution; missing or zero timings yield `—`).
- **Last request**: Covers only the most recent recorded model request (`TTFT–request duration` and speed); unrelated to full-turn totals.
- **Turn metrics**: Aggregates elapsed wall-clock time (including queueing, waits, and tool execution), request count (recorded retries included; pure preflight/injected responses excluded), `Write`, and `Think` tokens starting from the latest sent user message.
- **Cache expiry estimate**: The warning / cold status (default `3m` / `4m`, configurable in Settings) is estimated locally from elapsed time since the last recorded step; actual cache hits depend on the server.
- **Server queue alert**: Combines recorded per-turn request TTFTs with live pre-first-token waits while working (ignoring active local tools and streaming responses), resetting when a new user message starts a new turn.

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

## License

[MIT](../LICENSE)
