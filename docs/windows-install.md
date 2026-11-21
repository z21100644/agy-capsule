# Windows 安装指南 / Windows Installation Guide

[中文](#中文) | [English](#english)

## 中文

本指南包含在 Windows 上使用 agy-capsule 的全部步骤：下载、安装插件、让底栏胶囊显示出来、启用插件，以及之后的更新、卸载和排查。

> **想让 AI 代装？** 在 Antigravity 里新开一个对话，发这句话给它：
>
> ```text
> 请按 https://github.com/Lumidarin/agy-capsule/blob/main/docs/windows-install.md 帮我安装 agy-capsule。
> ```
>
> 它会完成第 1～2 步。之后你只需要自己完成[第 3 步](#第-3-步启用插件)。AI 没法替你重启 Antigravity，因为它自己就运行在 Antigravity 里。

### 给 AI 助手的说明

如果你是替用户安装的 AI 助手，请按以下要求操作：

1. 准备最新版代码：
   - 用户已有 agy-capsule 的 git 文件夹时，只有同时满足以下条件才复用它：`git remote get-url origin` 指向 `https://github.com/Lumidarin/agy-capsule`、当前在 `main` 分支、`git status --porcelain` 没有输出。满足就运行 `git pull --ff-only origin main`，再确认 `git rev-parse HEAD` 与 `git rev-parse FETCH_HEAD` 输出相同；不同说明本地有额外提交，改用下一条的新目录，不要重置用户的分支。
   - 不满足，或者没有现成的文件夹，就把仓库 `git clone` 到一个新的空目录（例如 `%USERPROFILE%\agy-capsule`，已被占用就换个名字）。不要改动用户原来的文件夹。
   - 没有 git 的话，重新下载 main 分支的 zip 并解压到新目录。不要使用「下载」里已有的旧解压文件夹，那可能是旧版。
   - 拿不到最新代码时就停下，把报错告诉用户，不要用旧代码安装。
2. 在这个文件夹里运行下面的命令安装插件，确认输出里有「已安装/更新 agy-capsule」。不要运行 `install.bat`：它装完后会询问是否添加调试参数，可能一直等待输入。

   ```powershell
   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\manage-plugin.ps1 -Action install
   ```
3. 再运行下面的命令，给 Antigravity 快捷方式加上调试参数：

   ```powershell
   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\enable-cdp.ps1
   ```

   根据输出判断结果，不要只看退出码：
   - 逐行报告：列出带「已更新」或「已设置」的快捷方式路径，告诉用户以后从这些快捷方式打开 Antigravity；带「无法修改（请用管理员 PowerShell 重试）」的行原样转告。
   - 只有没有任何快捷方式被标为「已更新」或「已设置」时（例如出现「没有找到 Antigravity 快捷方式」，或者每个快捷方式都是「无法修改」），才说明插件已经装好、侧栏可以正常使用，只是底栏胶囊还没配置好，可以按本指南「底栏胶囊不显示」一节处理。
   - 不要自行用管理员权限运行。
4. 不要修改插件文件、Antigravity 安装目录和 Antigravity 的设置，也不要自行安装其他软件。
5. 不要退出或重启 Antigravity。完成后，用用户的语言告诉他接下来要自己完成第 3 步。如果哪一步失败了，就把报错原样告诉用户。

### 自己安装

下面的第 1～3 步是给自己动手安装的人看的。让 AI 代装的话，只需要自己完成第 3 步。

### 第 1 步：下载

两种方式任选一种：

- **用 git**（以后更新最方便）：打开 **PowerShell**，运行
  ```powershell
  git clone https://github.com/Lumidarin/agy-capsule.git $env:USERPROFILE\agy-capsule
  ```
- **下载压缩包**：打开[仓库主页](https://github.com/Lumidarin/agy-capsule)，点绿色的 **Code → Download ZIP**，然后右键解压。

### 第 2 步：运行安装脚本

在 agy-capsule 文件夹里双击 `install.bat`。装完后，如果 Antigravity 快捷方式还没带调试参数，脚本会询问是否加上，直接回车即可。

如果快捷方式已经带了参数，或者没找到快捷方式，窗口会一闪而过，这是正常的。想看清安装结果的话，在 agy-capsule 文件夹的地址栏输入 `powershell` 并回车，再运行 `.\install.bat`，窗口会留着；看到「已安装/更新 agy-capsule 到 …」就说明装好了。底栏胶囊需要这个参数，详见下面的[底栏胶囊不显示](#底栏胶囊不显示)。

### 第 3 步：启用插件

1. **完全退出** Antigravity，再从带参数的快捷方式打开。没能加上参数的话，照常打开 Antigravity 也可以，侧栏统计正常，底栏胶囊见下面的「底栏胶囊不显示」。
2. 在 Antigravity 的 **Plugins** 面板启用 **agy-capsule**。
3. 在对话顶部点 **… → Extensions → agy-capsule**，打开侧栏。

### 怎么确认成功

- 侧栏能看到上下文和 token 统计。
- 输入框下方出现底栏胶囊，侧栏顶部没有「底栏胶囊未启用」的提示。

### 更新与卸载

| 操作 | 方法 |
|---|---|
| 更新 | 先拉取（`git pull`）或重新下载新版代码，再双击 `update.bat` |
| 卸载 | 双击 `uninstall.bat` |

插件装在 <code>%USERPROFILE%\.gemini\config\plugins\agy-capsule</code>，安装或更新时会清掉旧版残留文件；卸载只删除插件目录，保留设置。更新后插件会自动重启并重连侧栏，无需手动操作；从不支持自动重载的旧版首次更新时，需手动重启插件一次。

### 底栏胶囊不显示

底栏胶囊通过 Antigravity 的调试端口挂到输入框下方。新版 Antigravity 默认不再打开这个端口，这时侧栏统计照常，但胶囊不出现，侧栏顶部会显示「底栏胶囊未启用」。打开方法：

- **一键设置**：安装时跳过了询问，或之后参数丢了，可在 agy-capsule 文件夹里运行下面的命令。它会给桌面、开始菜单和任务栏上的 Antigravity 快捷方式加上 `--remote-debugging-port=0`；加 `-Undo` 可撤销。

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\enable-cdp.ps1
  ```
- **手动设置**：在快捷方式「属性 → 目标」末尾加上 ` --remote-debugging-port=0`。
- **没有可用的快捷方式**：如果一个快捷方式都没找到，或者只有改不了的公共快捷方式，先给自己建一个：找到 `Antigravity.exe`（通常在 `%LOCALAPPDATA%\Programs\antigravity`），右键选「发送到 → 桌面快捷方式」（Windows 11 先点「显示更多选项」），再按上面的手动设置给它加参数。完全退出 Antigravity 后用这个新快捷方式打开。

改完后要**完全退出** Antigravity 再从快捷方式打开。没有窗口在运行时，点 `antigravity://` 链接或在资源管理器里「用 Antigravity 打开」会绕过快捷方式，不会带上参数。自动更新后，Antigravity 可能沿用带 `--remote-debugging-port=0` 的开始菜单快捷方式。只有重启没带参数时，底栏胶囊才会因调试端口未开启而消失。如果更新重建了快捷方式并清除了参数，先再运行一次脚本补回参数，然后完全退出并从快捷方式重新打开。

### 遇到问题

- **Antigravity 换了安装位置**：先从新位置打开一次 Antigravity，再双击 `update.bat`，让插件记住新的启动路径；不用另装 Node。如果插件仍然启动失败，完全退出 Antigravity，再打开一次。
- **侧栏打不开或一片空白**：请[提交 issue](https://github.com/Lumidarin/agy-capsule/issues)，附上日志文件 <code>%USERPROFILE%\.gemini\antigravity\sidecar_data\agy-capsule\agy_capsule\logs\sidecar.log</code>。把这个路径粘贴到资源管理器的地址栏就能打开。
- **侧栏顶部有提示**：按提示操作即可。解决不了的话，提 issue 时附上提示的截图。

### 注意事项

- **安全说明**：调试端口只监听本机。端口打开期间，本机上的其他程序也可以通过它控制 Antigravity 窗口，请只在你信任的个人电脑上使用。旧版 Antigravity 本来就默认打开它。

---

## English

This guide covers everything needed to use agy-capsule on Windows: downloading, installing the plugin, showing the footer capsule, enabling the plugin, and later updating, uninstalling and troubleshooting.

> **Want an AI to install it?** Start a new conversation in Antigravity and send it this:
>
> ```text
> Please install agy-capsule for me following https://github.com/Lumidarin/agy-capsule/blob/main/docs/windows-install.md
> ```
>
> It will handle steps 1–2. Then you only need to do [Step 3](#step-3-enable-the-plugin) yourself. The AI can't restart Antigravity for you, because it runs inside Antigravity.

### For AI assistants

If you are an AI assistant installing this for the user:

1. Get the latest code:
   - Reuse an existing agy-capsule git folder only if all of these hold: `git remote get-url origin` points to `https://github.com/Lumidarin/agy-capsule`, the current branch is `main`, and `git status --porcelain` prints nothing. If so, run `git pull --ff-only origin main`, then check that `git rev-parse HEAD` and `git rev-parse FETCH_HEAD` print the same commit. If they differ, the local branch has extra commits: use a new folder as in the next item instead, and don't reset the user's branch.
   - Otherwise, or if there is no existing folder, `git clone` the repository into a new empty folder (for example `%USERPROFILE%\agy-capsule`; pick another name if it's taken). Don't touch the user's existing folder.
   - If git isn't available, download and unzip a fresh copy of the main branch zip into a new folder. Don't reuse an old unzipped folder in Downloads; it may be outdated.
   - If you can't get the latest code, stop and show the user the error. Don't install from old code.
2. In that folder, run the command below to install the plugin and confirm the output says "Installed/updated agy-capsule". Don't run `install.bat`: after installing it asks whether to add the debugging switch and may wait for input indefinitely.

   ```powershell
   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\manage-plugin.ps1 -Action install
   ```
3. Then run the command below to add the debugging switch to the Antigravity shortcuts:

   ```powershell
   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\enable-cdp.ps1
   ```

   Judge the result from the output, not just the exit code:
   - Report line by line: list the shortcut paths marked "Updated" or "Already set" and tell the user to open Antigravity from those shortcuts from now on; pass on any "Could not update (try an administrator PowerShell)" lines as-is.
   - Only when no shortcut is marked "Updated" or "Already set" (for example "No Antigravity shortcuts found", or every shortcut shows "Could not update") explain that the plugin is installed and the sidebar works, but the footer capsule isn't set up yet; they can follow the "Footer capsule doesn't appear" section of this guide.
   - Don't elevate to administrator yourself.
4. Don't modify the plugin files, the Antigravity installation folder or Antigravity's settings, and don't install any other software.
5. Don't quit or restart Antigravity. When you're done, tell the user, in their language, to do Step 3 themselves. If any step fails, show the user the error as-is.

### Install it yourself

Steps 1–3 below are for installing it yourself. If an AI installs it for you, you only need to do Step 3.

### Step 1: Download

Pick one:

- **With git** (easiest to update later): open **PowerShell** and run
  ```powershell
  git clone https://github.com/Lumidarin/agy-capsule.git $env:USERPROFILE\agy-capsule
  ```
- **As a zip**: on the [repository page](https://github.com/Lumidarin/agy-capsule), click the green **Code → Download ZIP**, then right-click the zip and extract it.

### Step 2: Run the installer

Double-click `install.bat` in the agy-capsule folder. If an Antigravity shortcut doesn't have the debugging switch yet, the script then asks whether to add it. Press Enter to accept.

If the shortcuts already have the switch or none were found, the window just flashes and closes; that's normal. To see the result, type `powershell` in the agy-capsule folder's address bar, press Enter, and run `.\install.bat`; the window stays open. "Installed/updated agy-capsule at …" means it worked. The footer capsule needs that switch; see [Footer capsule doesn't appear](#footer-capsule-doesnt-appear) below.

### Step 3: Enable the plugin

1. **Quit Antigravity completely**, then open it from a shortcut that has the switch. If the switch couldn't be added, opening Antigravity normally is fine: the sidebar works, and for the footer capsule see "Footer capsule doesn't appear" below.
2. Enable **agy-capsule** in Antigravity's **Plugins** panel.
3. Open **… → Extensions → agy-capsule** from the conversation header to show the sidebar.

### How to verify

- The sidebar shows context and token stats.
- The footer capsule appears under the input box, and there is no "Footer capsule is off" banner at the top of the sidebar.

### Updating and uninstalling

| Action | How |
|---|---|
| Update | Pull (`git pull`) or download the latest code, then double-click `update.bat` |
| Uninstall | Double-click `uninstall.bat` |

The plugin lives in <code>%USERPROFILE%\.gemini\config\plugins\agy-capsule</code>; install and update remove stale files from older versions, and uninstall removes the plugin directory but keeps your preferences. After an update the plugin restarts itself and reconnects the sidebar, with nothing to do by hand. The first update from an older version without automatic reload needs one manual plugin restart.

### Footer capsule doesn't appear

The footer capsule attaches under the input box through Antigravity's debugging port. Newer Antigravity versions no longer open this port by default. Sidebar stats keep working, the capsule doesn't appear, and the sidebar shows "Footer capsule is off" at the top. To turn the port on:

- **One step**: if you skipped the prompt during install or the switch was lost later, run this from the agy-capsule folder. It adds `--remote-debugging-port=0` to the Antigravity shortcuts on your desktop, Start menu and taskbar. Add `-Undo` to revert.

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\enable-cdp.ps1
  ```
- **By hand**: add ` --remote-debugging-port=0` to the end of the shortcut's **Properties → Target**.
- **No usable shortcut**: if no shortcut was found, or only all-users shortcuts you can't change, create your own: find `Antigravity.exe` (usually in `%LOCALAPPDATA%\Programs\antigravity`), right-click it and choose **Send to → Desktop (create shortcut)** (on Windows 11, click **Show more options** first), then add the switch to it by hand as above. Quit Antigravity completely and open it from the new shortcut.

Afterwards, **quit Antigravity completely** and open it from a shortcut. Opening an `antigravity://` link or using Explorer's "Open with Antigravity" when no Antigravity window is open bypasses the shortcut and omits the flag. After an automatic update, Antigravity may restart from its existing Start menu shortcut with `--remote-debugging-port=0`. Only a restart without the flag will leave the debug port closed and the footer capsule missing. If the update recreated the shortcut and removed the flag, run the script again to restore it, then quit Antigravity completely and reopen it from the shortcut.

### Troubleshooting

- **You moved Antigravity**: open Antigravity once from its new location, then run `update.bat` again so the plugin picks up the new path. No separate Node installation is needed. If the plugin still fails to start, quit Antigravity completely and reopen it.
- **The sidebar won't open or is blank**: please [open an issue](https://github.com/Lumidarin/agy-capsule/issues) and attach the log file <code>%USERPROFILE%\.gemini\antigravity\sidecar_data\agy-capsule\agy_capsule\logs\sidecar.log</code>. Paste that path into File Explorer's address bar to open it.
- **The sidebar shows a notice**: follow what it says. If that doesn't fix it, attach a screenshot of the notice to your issue.

### Notes

- **Security**: the debugging port only listens on this computer. While it's open, other programs on this computer can also control Antigravity windows; use it only on a computer you trust. Older Antigravity versions opened it by default anyway.
