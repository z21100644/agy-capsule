# agy-capsule

[中文](./README.md) | **English**

Context usage, multi-model quotas, cache status and generation speed in the Antigravity composer footer. Hover a capsule to see its panel; click it to pin the panel open.

<p align="center">
  <img src="assets/readme/hero.gif" width="100%" alt="Hovering the context, quota and request-failure capsules in turn to open their panels" />
</p>

Promo video (v1.1, also on [Bilibili](https://www.bilibili.com/video/BV1ggsy6rEQM/)):

https://github.com/user-attachments/assets/9f5bf1c6-1284-4e17-a380-defdee83f60c

For a simpler footer like 1.0, turn off Generation speed, Last request, Turn metrics, Request failure capsule, and Server queue alert in the sidebar [Settings](#settings). Turn off Context breakdown as well if you only want the key numbers.

## Context

Shows context usage, cache hit rate and cache status. The limit is read live for the current session and model. **Everything below is optional.**

- **Cache expiry alert**: The capsule icon turns yellow at 3 minutes after the last turn and red at 4 by default, meaning the `Cache` has expired. Both thresholds can be customized inline in Settings (up to 998 / 999 minutes). The panel's Cache row updates with it.

- **Context overload alert**: The capsule number turns yellow above 75% and red above 90%.

- **Generation speed**: Shows the speed of this turn's latest request, updated each time a request completes.

- **Speed effects**: A dot that breathes while the model is generating. Red below 10 tok/s, yellow from 10 to under 25, green at 25 and above. After generation stops it keeps its color for 15 seconds, then grays out.

- **Context breakdown**: Splits the context into turn0 (first turn), read, think and write, showing each value and share. Choose rows or columns. Rows can use square or dot markers; columns let you toggle name, value and percent and reorder them.
- **Last request**: Shows the range from first token to the end of the latest request (e.g. `4.5s–8.6s`) and its generation speed.
- **Turn metrics (off by default)**: Shows this turn's elapsed time, requests, thinking and write.

## Quota

Shows the remaining 5-hour and weekly quotas and their reset countdowns for the current pool or all pools.

**Vertex AI (Google Cloud pay-as-you-go):** When no subscription quota is returned and Antigravity confirms the account uses Cloud pay-as-you-go billing, the entire quota capsule is hidden.

**Everything below is optional.**

- **Highlight active model**: Highlights the pool of the selected model and dims the others.
- **Hide absent quota windows (on by default)**: For example, AI Pro users' Argon pool has no 5-hour quota, so that empty window is hidden.
- **Quota group dividers (on by default)**: Draws a thin line between quota pools in the footer panel and in a narrow sidebar.

## Error & queue alerts

**Both are optional** and share the third footer capsule (request failures take priority when both are active):

- **Request failure capsule**: Appears in red only when a request fails; hover or click it to see the raw error and an explanation in the panel. Reasons shown: quota exhausted, rate limited (429), disconnected, authentication error, service busy and unknown.
- **Server queue alert**: Appears in amber when waiting for the model's first token during Working exceeds the threshold (default `30s`, configurable `1–999s` at the end of Settings), ticking live while waiting. Scoped to the current turn only, showing `×N` when multiple requests exceed the threshold (e.g. `Queue×2 40s` / `Queue×2`), with per-wait details in its panel. Active local tools and streaming responses do not trigger false alerts.

## Language and appearance

- **Settings language**: English, Simplified Chinese, Traditional Chinese. The language of the settings page.

- **Display language**: English, Simplified Chinese, Traditional Chinese. The language of the panels.

  Both language settings only affect agy-capsule's own interface. They don't translate Antigravity itself.

- **Panel skin**: Native (default) or frosted. Frosted changes only the material of the footer panels: translucent over a blurred backdrop. Colors still come from the host theme variables, so light and dark themes are followed automatically.

- **Panel height**: Natural height sizes each panel to its content; matched height gives every panel the same height.

- **Panel spacing**: Compact, standard, spacious.

- **Label casing**: Lowercase, title case.

- **Quota indicator**: Ring, bar.

- **Cache indicator**: Icon, ring, bar. Ring and bar fill linearly over time since the last activity, turning yellow then red, and stay full once expired.

- **Cache hit rate**: Percent (default), ring, or both. The ring's arc is the hit rate itself, so it can replace the percentage or sit next to it. It is independent of the Cache indicator, which tracks expiry.

- **Reset countdown**: Compact, localized.

- **Panel pop-in animation (off by default)**: Panels fade and rise slightly as they open. It never plays while the system asks for reduced motion.

## Settings

Open **… → Extensions → agy-capsule** from the conversation header, then switch between the Statistics and Settings tabs at the top.

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
> **No.** Antigravity's auto-update restarts itself without going through your shortcut (or your macOS launcher), so the debugging port isn't open for that launch. Just **quit Antigravity completely and reopen it from your shortcut** to restore the capsule. Once the capsule has worked on your machine before, agy-capsule recognizes this automatically: the sidebar banner clarifies no plugin update is needed (on Windows it also checks whether the installer wiped your shortcut switch and offers a one-click restore button), and an optional one-shot desktop notification alerts you once per launch (on by default in Settings).

## Metric definitions

- **Generation speed** = total output ÷ (TTFT + streaming time). It includes the wait for the first token.
- **Last request** covers only the most recent model request, not the whole turn; missing values show `—`.
- **Turn metrics** start at your latest message; elapsed time includes queueing, waiting and tool execution.
- **Cache expiry alerts are only a guide**: the cache state (yellow at 3 minutes, expired at 4 by default; configurable in Settings) is estimated locally from the time since the last turn; actual cache hits depend on the server.
- **Server queue alert**: combines recorded per-turn request TTFTs with live pre-first-token waiting time while working (excluding active local tools and streaming responses), resetting automatically on each new user message.

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

## Contributing

Issues and pull requests are welcome. See the [contribution guide](./CONTRIBUTING.md#english).

## Notices

1. **Inspired by @z21100644 ([PR #1](https://github.com/Lumidarin/agy-capsule/pull/1))**: Thanks for the ideas behind multilingual support, parts of the panel design, click-to-pin, active-model highlighting, generation metrics and speed effects, consistent `K` / `M` token formatting, cache and quota tooltips, context overload alerts, request error classification, and hiding absent quota windows. This version also drew on style isolation, SQLite read caching, incremental CDP updates, installation and maintenance, and Sidecar auto-reload, reimplemented to fit this project. It does not include seven-category context estimates or attachment scanning. Separate settings and display languages, independent appearance controls, the request failure capsule, the new footer's collapse order, turn metrics, and Sidebar interactions were designed separately for this release.
2. **Inspired by @Krwaby123 ([PR #2](https://github.com/Lumidarin/agy-capsule/pull/2))**: Thanks for reporting quota panel overflow with page-translation extensions and proposing shared column alignment with widths that adapt to longer translations. This version uses a different grid across quota groups and marks percentages and countdowns as not translatable. Chinese countdowns are still available in Settings.

## License

[MIT](./LICENSE)
