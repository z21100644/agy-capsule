# agy-capsule

[中文](./README.md) | **English**

Context usage, multi-model quotas, cache status and generation speed in the Antigravity composer footer. Hover a capsule to see its panel; click it to pin the panel open.

<p align="center">
  <img src="assets/readme/hero.gif" width="100%" alt="Hovering the context, quota and request-failure capsules in turn to open their panels" />
</p>

Promo video (v1.4, also on [Bilibili](https://www.bilibili.com/video/BV1bayvz5Ey1/)):

https://github.com/user-attachments/assets/3857a452-9fac-42b0-8f26-57759af8fefc

<details>
<summary>Earlier promo video (v1.1)</summary>

Also on [Bilibili](https://www.bilibili.com/video/BV1ggsy6rEQM/):

https://github.com/user-attachments/assets/9f5bf1c6-1284-4e17-a380-defdee83f60c

</details>

Almost every feature in this plugin is highly customizable, from a minimal footer to a full-featured monitor — items marked with `☑` below can be freely toggled or configured in sidebar [Settings](#settings).

## Context

Shows context usage, cache hit rate and cache status. The limit is read live for the current session and model.

☑ **Cache expiry alert**: The capsule icon turns yellow at 3 minutes after the last turn and red at 4 by default, meaning the `Cache` has expired. Both thresholds can be customized inline in Settings (up to 998 / 999 minutes). The panel's Cache row updates with it.

☑ **Context overload alert**: The capsule number turns yellow above 75% and red above 90%.

☑ **Generation speed**: Shows the speed of this turn's latest request, updated each time a request completes.

☑ **Speed effects**: A dot that breathes while the model is generating. Red below 10 tok/s, yellow from 10 to under 25, green at 25 and above. After generation stops it keeps its color for 15 seconds, then grays out.

☑ **Context breakdown**: Splits the context into turn0 (first turn), read, think and write, showing each value and share. Choose rows or columns. Rows can use square or dot markers; columns let you toggle name, value and percent and reorder them.

- **Breakdown hover highlight (off by default)**: Pointing at a segment of the progress bar or at an item of the breakdown keeps that segment and its item lit and dims the rest. It works in the sidebar and in a pinned footer panel.

☑ **Last request**: Shows the range from first token to the end of the latest request (e.g. `4.5s–8.6s`) and its generation speed.

- **Compact status bar (off by default)**: Merges the panel's Cache row and Last request row into one bar: cache hit rate, time to first token (TTFT) and generation speed. It sits along the bottom edge of the panel (the default) or at the top, where it is a plain row over a thin line without the tint. As the cache nears expiry, the time left takes the hit rate's place; once it has expired, the ring becomes a dashed red outline. The bolt icon takes the speed's color, with the same tiers as Speed effects. With Last request off, or before any request is recorded, the bar shows the cache alone. While it is on, the Cache indicator and Cache hit rate settings no longer affect the panels.

☑ **Turn metrics**: Shows this turn's elapsed time, requests, thinking and write.

## Quota

Shows the remaining 5-hour and weekly quotas and their reset countdowns for the current pool or all pools.

**Vertex AI (Google Cloud pay-as-you-go):** When no subscription quota is returned and Antigravity confirms the account uses Cloud pay-as-you-go billing, the entire quota capsule is hidden.

☑ **Highlight active model**: Highlights the pool of the selected model and dims the others.

☑ **Hide absent quota windows**: For example, AI Pro users' Argon pool has no 5-hour quota, so that empty window is hidden.

- **Quota group dividers (on by default)**: Draws a thin line between quota pools in the footer panel and in a narrow sidebar.

## Error & first-token wait alerts

Shared on the third footer capsule (request failures take priority when both are active):

☑ **Request failure alert**: Appears in red only when a request fails; hover or click it to see the raw error and an explanation. Request timeouts and connection failures are shown separately; a timeout does not mean the turn stopped. Other reasons include quota exhaustion, rate limiting (429), authentication errors, service busy and unknown errors.

☑ **First-token wait alert**: An amber capsule appears when a wait reaches the threshold (default `30s`, range `1–999s`). `Wait×2 40s` means two intervals reached the threshold this turn, including a current estimate of 40 seconds. Active tools and streaming stop the live clock. Earlier slow waits remain visible in the panel.

## Models

Turn off **Revert to native model capsule** at the top of the Models tab to replace the footer’s model button with a panel that matches the native look. Click a model to keep your current effort level. Reverting pauses the features on this tab without changing your saved choices.

☑ **Hide model tags**: Hides tag badges such as `New` and `Notice` inside the dropdown.

☑ **Hide default effort**: Hides effort previews in the model dropdown list (the footer button and hover effort submenu still show tiers, and direct clicks still inherit your current effort).

☑ **Model dots**: Shows colored dots next to model names.

☑ **Customize models**: Automatically expands the list of available models so you can toggle individual models on or off (at least one model always remains visible).

☑ **Effort slider and Orchestrator capsule**: Keeps the menu open when you switch models and replaces hover submenus with a slider. Click or use the arrow keys to switch tiers immediately. Drag to preview tiers, then release to apply the selection. Shows the Orchestrator capsule when the host supports it. Right-click the slider to change animation, tick marks, or style. Turn it off to restore hover submenus.

## Usage history

An optional section at the bottom of the sidebar’s Statistics page.

☑ **Token activity**: Shows today's, this week's, this month's and all-time usage, and an activity map of the past year that switches between Daily (one cell per day) and Weekly (one cell per week); a darker cell means more usage. A narrow sidebar keeps only the most recent weeks. Point at a summary total or a cell to see its request count and the split across uncached input, cache reads, cache writes and output.

☑ **Usage by model**: Stacked bars that split usage by model family, by Day (14 days a page), Week (12 weeks) or Month (12 months); ‹ › page back to earlier periods. Below the bars, each model family on the page is listed with its tokens and share; effort-tier suffixes are grouped under their model family by default, and pointing at a model shows its four-part token breakdown plus per-tier usage.

## Language and appearance

☑ **Settings language**: English, Simplified Chinese, Traditional Chinese. The language of the settings page.

☑ **Display language**: English, Simplified Chinese, Traditional Chinese. The language of the panels. (Both language settings only affect agy-capsule's own interface and don't translate Antigravity itself.)

- **Panel skin**: Native (default) or frosted. Frosted changes only the material of the footer panels: translucent over a blurred backdrop. Colors still come from the host theme variables, so light and dark themes are followed automatically.

☑ **Panel height**: Natural height sizes each panel to its content; matched height gives every panel the same height.

☑ **Panel spacing**: Compact, standard, spacious.

☑ **Label casing**: Lowercase, title case.

☑ **Quota indicator**: Ring, bar.

☑ **Cache indicator**: Icon, ring, bar. Ring and bar fill linearly over time since the last activity, turning yellow then red, and stay full once expired.

- **Cache hit rate**: Percent (default), ring, or both. The ring's arc is the hit rate itself, so it can replace the percentage or sit next to it. It is independent of the Cache indicator, which tracks expiry.

☑ **Reset countdown**: Compact, localized.

- **Panel pop-in animation (off by default)**: Panels fade and rise slightly as they open. It never plays while the system asks for reduced motion.

### Chinese localization for Antigravity

To translate Antigravity itself, choose one of these third-party patches. Each was tested separately on **Windows with Antigravity 2.34.0**. The agy-capsule sidebar and footer both kept their own language settings.

- **Recommended**: [Antigravity-Chinese-Localization v2.34.0](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization/releases/tag/v2.34.0).
- **Also tested and compatible**: [antigravity2-cn (commit `f7a0c4e`)](https://github.com/qqxpee/antigravity2-cn/tree/f7a0c4ebe088917bdc5121ac9b3bbad1c89b6059).

If you run into a compatibility issue, please [report it on GitHub](https://github.com/Lumidarin/agy-capsule/issues). Include your Antigravity, agy-capsule, and localization patch versions, and where the problem appears so we can reproduce and follow up.

## Settings

Open **… → Extensions → agy-capsule** from the conversation header, then use the Statistics, Settings, and Models tabs at the top.

The **Settings** tab shows the installed version, an **Update alerts** switch (on by default), and a **Check updates** button. Turning alerts off stops background checks but leaves manual checks available. When a new release is available, the card shows the installed and new versions. Click **Update** to download, verify, and reload the plugin without restarting Antigravity or losing your settings. Click **Release notes** to open the GitHub release, or × to dismiss. If an update fails, the card shows why and offers **Retry**, **Manual update**, and **Copy diagnostics**. Use **Copy AI prompt** to send the update steps and diagnostics to an AI assistant.

Preferences live in <code>~/.gemini/config/agy-capsule/settings.json</code> (<code>%USERPROFILE%\.gemini\config\agy-capsule\settings.json</code> on Windows). Updates and uninstalls keep them; options missing from older files fall back to defaults.

## Installation

### Windows

Follow the [Windows installation guide](./docs/windows-install.md#english). It covers downloading, installing, the footer capsule setup, updating, uninstalling and troubleshooting.

To have an AI install it, send this to Antigravity:

```text
Please install agy-capsule for me following https://github.com/Lumidarin/agy-capsule/blob/main/docs/windows-install.md
```

### macOS

Follow the [macOS installation guide](./docs/macos-install.md#english). It covers downloading, installing, the footer capsule setup, updating, uninstalling and troubleshooting.

If you don't use Terminal, send this to Antigravity and let it install for you:

```text
Please install agy-capsule for me following https://github.com/Lumidarin/agy-capsule/blob/main/docs/macos-install.md
```

### Linux

From the repository folder, run `sh install.sh` to install, `sh update.sh` to update (pull the latest code first) and `sh uninstall.sh` to uninstall. The plugin lives in <code>~/.gemini/config/plugins/agy-capsule</code>. Enable it in the **Plugins** panel afterwards. The footer capsule needs Antigravity started with `--remote-debugging-port=0`.

### FAQ

> **The capsule disappeared after an Antigravity update — do I need to update agy-capsule?**
> **No.** On Windows, Antigravity may restart after an automatic update through its existing Start menu shortcut with `--remote-debugging-port=0`. Only if the restart omits the debugging flag will the capsule disappear because the debug port is closed. Sidebar stats are unaffected. Just **quit Antigravity completely and reopen it from the shortcut with the flag (or your macOS launcher)** to restore the capsule. Once the capsule has worked on your machine before, agy-capsule recognizes this automatically: the sidebar banner clarifies no plugin update is needed (on Windows it also checks whether the installer wiped your shortcut switch and offers a one-click restore button), and an optional one-shot desktop notification alerts you once per launch (on by default in Settings).

## Metric definitions

- **Generation speed** = total output ÷ (TTFT + streaming time). It includes the wait for the first token.
- **Last request** covers only the most recent model request, not the whole turn; missing values show `—`.
- **Turn metrics** start at your latest message; elapsed time includes queueing, waiting and tool execution.
- **Cache expiry alerts are only a guide**: the cache state (yellow at 3 minutes, expired at 4 by default; configurable in Settings) is estimated locally from the time since the last turn; actual cache hits depend on the server.
- **First-token wait alert** combines reported request TTFT with local step timing. The live estimate may start when processing the message begins or after a previous step finishes; it does not use the time the message was queued. The cause is unknown. The count resets when processing the next message begins.
- **Usage history** adds up the uncached input, cache reads, cache writes and output that each model request recorded in the current product folder's local conversation databases. Totals include cache reads (which usually dominate long conversations and do not convert directly to quota consumption) and are not a bill. Only conversations in the current product folder are counted; deleted conversations are excluded (so all-time totals drop if chats are removed), and a response stored in more than one conversation file counts once. Days follow the local time zone and weeks start on Monday. Point at a summary total or activity cell to see the four-part breakdown. Conversations are read incrementally only while at least one usage option is on and the sidebar statistics are open: idle closed databases without a non-empty `-wal` are opened with `immutable=1` to avoid leaving stray `-wal`/`-shm` files, while active or recently modified databases use plain read-only with before/after `.db`/`-wal` fingerprint verification (discarding torn mid-read writes for the next scan). Totals stay in memory and are neither written to disk nor sent anywhere. Usage by model prefers `model_display_name`, falling back to `response_model` (or "Unknown model"), and merges effort-tier suffixes into their model family by default (tier splits appear in the hover tooltip); with more than 6 model families, those with the least all-time usage are combined as "Other models".

<details>
<summary>Details</summary>

**Last request**

- The speed's numerator is total output: response (including tool-call instructions) plus thinking. Incomplete or zero timings produce no speed.
- TTFT and streaming time come from Antigravity's records, and request duration is their sum, excluding tool execution. TTFT's timer start and first-token boundary are unverified, so it is not a prefill-only measurement.

**Turn metrics**

- Starts at the latest sent user message, including queueing; each new message resets the totals.
- Elapsed time uses wall-clock boundaries, including waits and tools. It advances locally while running and freezes at a known end; if a cancellation has no clear timestamp it shows unknown.
- Requests include recorded retries, excluding pure preflight and injected responses; unrecorded backend calls are not guaranteed to be covered.

</details>

## Development tests

Run the Node tests from the repository root. Playwright is not required:

```sh
node --test "test/*.test.mjs"
```

Browser regression tests are optional. With Playwright and Chromium installed, run `node test/browser-regressions.mjs` separately.

## Other environments

- **Subagent conversations**: Subagent conversations include all footer capsule features except quota (with a read-only model badge, and turn metrics counted per latest execution). Each capsule stays hidden when its own data is unavailable; it never substitutes data from the parent conversation.
- **Cloud projects**: Cloud project conversations already show the footer capsules (context, speed, latest request, etc.), though the Antigravity host does not yet expose the plugin sidebar in cloud windows. Settings are shared with local windows and can be adjusted from any local project's sidebar.
- **Antigravity CLI (`agy`)**: If you also use `agy` in the terminal, check out the companion project **[agy-capsule-cli](https://github.com/Lumidarin/agy-capsule-cli)** — a customizable statusline for Antigravity CLI with per-item toggles, custom colors, and an [online configurator](https://lumidarin.github.io/agy-capsule-cli/).

## Next stops

Directions we may explore later, with no committed timeline:

- **WSL and SSH remote windows**: Show capsules in WSL and SSH remote windows.

## Contributing

Issues and pull requests are welcome. See the [contribution guide](./CONTRIBUTING.md#english).

## Notices

1. **Inspired by @z21100644 ([PR #1](https://github.com/Lumidarin/agy-capsule/pull/1))**: Thanks for the ideas behind multilingual support, parts of the panel design, click-to-pin, active-model highlighting, generation metrics and speed effects, consistent `K` / `M` token formatting, cache and quota tooltips, context overload alerts, request error classification, and hiding absent quota windows. This version also drew on style isolation, SQLite read caching, incremental CDP updates, installation and maintenance, and Sidecar auto-reload, reimplemented to fit this project. It does not include seven-category context estimates or attachment scanning. Separate settings and display languages, independent appearance controls, the request failure capsule, the new footer's collapse order, turn metrics, and Sidebar interactions were designed separately for this release.
2. **Inspired by @Krwaby123 ([PR #2](https://github.com/Lumidarin/agy-capsule/pull/2))**: Thanks for reporting quota panel overflow with page-translation extensions and proposing shared column alignment with widths that adapt to longer translations. This version uses a different grid across quota groups and marks percentages and countdowns as not translatable. Chinese countdowns are still available in Settings.
3. **Inspired by [antigravity-Codex-Claude-effort-slider](https://github.com/LLYSH-HANNARI/antigravity-Codex-Claude-effort-slider)**: Thanks for the approach of reading host model options from the Antigravity model button's React fiber tree and submitting a model + effort pair in one step. Reimplemented here on top of agy-capsule's CDP injector with Antigravity 2.33 and new-conversation support, hover effort submenus, effort inheritance, and customizable model visibility.
   The optional effort bar incorporates its slider visuals and animations with the author's permission. Model selection still uses agy-capsule's integration. See the [third-party license](agy-capsule/THIRD-PARTY-NOTICES.md).
4. **Inspired by [wycocoyu/agy-context-dashboard](https://github.com/wycocoyu/agy-context-dashboard) (MIT)**: The daily / weekly activity map and usage-by-model bars of the usage history follow the idea of that project's usage window, reimplemented to fit this project: it reads the local conversation databases directly, without calling the local API or keeping a ledger of its own.

## License

[MIT](./LICENSE)
