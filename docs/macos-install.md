# macOS 安装指南 / macOS Installation Guide

[中文](#中文) | [English](#english)

## 中文

本指南包含在 Mac 上使用 agy-capsule 的全部步骤：下载、安装插件、让底栏胶囊显示出来、启用插件，以及之后的更新、卸载和排查。

> **不熟悉终端？** 在 Antigravity 里新开一个对话，发这句话给它：
>
> ```text
> 请按 https://github.com/Lumidarin/agy-capsule/blob/main/docs/macos-install.md 帮我安装 agy-capsule。
> ```
>
> 它会替你完成第 1～3 步。之后你只需要自己完成[第 4 步](#第-4-步启用插件)。AI 没法替你重启 Antigravity，因为它自己就运行在 Antigravity 里。

### 给 AI 助手的说明

如果你是替用户安装的 AI 助手，请按以下要求操作：

1. 准备最新版代码：
   - 用户已有 agy-capsule 的 git 文件夹时，只有同时满足以下条件才复用它：`git remote get-url origin` 指向 `https://github.com/Lumidarin/agy-capsule`、当前在 `main` 分支、`git status --porcelain` 没有输出。满足就运行 `git pull --ff-only origin main`，再确认 `git rev-parse HEAD` 与 `git rev-parse FETCH_HEAD` 输出相同；不同说明本地有额外提交，改用下一条的新目录，不要重置用户的分支。
   - 不满足，或者没有现成的文件夹，就把仓库 `git clone` 到一个新的空目录（例如 `~/agy-capsule`，已被占用就换个名字）。不要改动用户原来的文件夹。
   - 没有 git 的话，重新下载 main 分支的 zip 并解压到新目录。不要使用「下载」里已有的旧解压文件夹，那可能是旧版。
   - 拿不到最新代码时就停下，把报错告诉用户，不要用旧代码安装。
2. 在这个文件夹里运行 `sh install.sh`，确认输出里有「已安装/更新 agy-capsule」。
3. 运行第 3 步「方法一」的 `osacompile` 命令，生成 `Antigravity-CDP` 启动图标。
4. 不要修改插件文件、原版 `Antigravity.app` 和 Antigravity 的设置，也不要自行安装其他软件。
5. 不要退出或重启 Antigravity。完成后，用用户的语言告诉他接下来要自己做第 4 步。如果哪一步失败了，就把报错原样告诉用户。

### 自己安装

下面的第 1～4 步是给自己动手安装的人看的。让 AI 代装的话，只需要自己完成第 4 步。

### 第 1 步：下载

两种方式任选一种：

- **用 git**（以后更新最方便）：打开「终端」，运行
  ```sh
  git clone https://github.com/Lumidarin/agy-capsule.git ~/agy-capsule
  ```
- **下载压缩包**：打开 [仓库主页](https://github.com/Lumidarin/agy-capsule)，点绿色的 **Code → Download ZIP**，然后双击解压。

### 第 2 步：用终端运行安装脚本

> **注意：不要双击 `install.sh`。** macOS 双击 `.sh` 只会用文本编辑器打开它，脚本并不会运行，插件也就没有装上。

1. 按 `Cmd + 空格`，搜索并打开 **终端**。
2. 输入 `cd `（`cd` 后面有一个空格），把 agy-capsule 文件夹拖进终端窗口，按回车。用 git 下载的话，直接输入 `cd ~/agy-capsule` 也可以。
3. 输入下面这行并按回车：
   ```sh
   sh install.sh
   ```
   看到「已安装/更新 agy-capsule 到 …」就说明装好了。

### 第 3 步：做一个带参数的启动图标（让底栏胶囊显示）

输入框下方的底栏胶囊，需要 Antigravity 带上 `--remote-debugging-port=0` 参数启动才能显示。不做这一步，侧栏统计照样能用，只是底栏胶囊不会出现。

macOS 的替身（快捷方式）不能像 Windows 那样直接附带启动参数，所以需要自己做一个**带参数的启动图标**。只用做一次，以后都从这个图标打开 Antigravity。下面三种方法任选一种。

#### 方法一：终端一行命令（最快，也适合让 AI 代做）

在终端运行：

```sh
osacompile -o /Applications/Antigravity-CDP.app -e 'do shell script "open -a Antigravity --args --remote-debugging-port=0"'
```

运行后，「应用程序」文件夹里会多出一个 `Antigravity-CDP`。

#### 方法二：用「自动操作」（所有 macOS 版本可用）

1. 按 `Cmd + 空格`，搜索并打开 **自动操作**（Automator）。
2. 点击 **新建文稿**，类型选择 **应用程序**。
3. 在左侧搜索 **运行 Shell 脚本**，把它拖到右侧区域。
4. 清空文本框里原有的内容（默认通常是 `cat`），换成下面这一行：

   ```sh
   open -a "Antigravity" --args --remote-debugging-port=0
   ```

5. 按 `Cmd + S` 保存，名字随便起（例如 `Antigravity-CDP`），保存到 **应用程序** 文件夹。

#### 方法三：用「快捷指令」（需要 macOS 14 Sonoma 或更新版本）

1. 打开 **快捷指令** App，先到 **设置 → 高级** 中勾选 **允许运行脚本**（不勾选会运行失败）。
2. 新建一个快捷指令，添加 **运行 Shell 脚本** 操作，填入同一行命令：

   ```sh
   open -a "Antigravity" --args --remote-debugging-port=0
   ```

3. 点菜单栏 **文件 → 添加到程序坞**。

> **可选：换成原版图标**
> 在「应用程序」文件夹里选中原版 `Antigravity`，按 `Cmd + I`，点信息窗口左上角的小图标，再按 `Cmd + C`。然后选中新做的 `Antigravity-CDP`，按 `Cmd + I`，点左上角的小图标，再按 `Cmd + V`。也可以把新图标拖到程序坞（Dock）里，方便点击。

### 第 4 步：启用插件

1. 按 `Cmd + Q` **完全退出** Antigravity。点窗口左上角的红色按钮只会关掉窗口，程序还在后台运行，这时再打开不会带上参数。
2. 用第 3 步做的启动器打开 Antigravity：方法一生成的是「应用程序」里的 **Antigravity-CDP**；方法二是你保存时起的名字；方法三是你添加到程序坞的那个快捷指令。
3. 在 Antigravity 的 **Plugins** 面板里启用 **agy-capsule**。
4. 在对话顶部点 **… → Extensions → agy-capsule**，打开侧栏。

### 怎么确认成功

- 侧栏能看到上下文和 token 统计。
- 输入框下方出现底栏胶囊，侧栏顶部没有「底栏胶囊未启用」的提示。
- 底栏胶囊没出现时，可以在终端运行下面的命令作为排查线索。第一行的数字是文件里记录的端口，可能来自上一次启动，不能证明这次已经打开；判断是否成功仍以底栏胶囊是否出现为准：

  ```sh
  cat ~/Library/Application\ Support/Antigravity/DevToolsActivePort
  ```

### 更新与卸载

- **更新**：用 git 下载的，在 agy-capsule 文件夹里运行 `git pull`，再运行 `sh update.sh`。用压缩包下载的，重新下载并解压，然后在新文件夹里运行 `sh update.sh`。插件会自动重启，不用重新启用；从不支持自动重载的旧版首次更新时，需手动重启插件一次。
- **卸载**：在 agy-capsule 文件夹里运行 `sh uninstall.sh`。插件设置会保留。

### 遇到问题

- **Plugins 面板里找不到插件**：先确认第 2 步是在终端里运行的，不是双击运行的。然后在终端运行 `ls ~/.gemini/config/plugins`，输出里应该有 `agy-capsule`。
- **侧栏打不开或一片空白**：请[提交 issue](https://github.com/Lumidarin/agy-capsule/issues)，附上日志文件 `~/.gemini/antigravity/sidecar_data/agy-capsule/agy_capsule/logs/sidecar.log`。在访达里按 `Cmd + Shift + G`，粘贴这个路径，就能找到这个文件。
- **侧栏顶部有提示**：按提示操作即可。解决不了的话，提 issue 时附上提示的截图。

### 注意事项

- **程序坞出现两个图标是正常的**：新图标只负责带参数拉起真正的 Antigravity，拉起后自己就退出了，运行中的仍然是原版图标。建议把原来常驻程序坞的图标移除，以后只点新图标，免得点错。
- **不经过新图标的启动不会带参数**：例如没有 Antigravity 窗口运行时点 `antigravity://` 链接，或从访达「打开方式」冷启动。如果 Antigravity 自动更新后重启没带参数，底栏胶囊也不会加载。底栏胶囊消失时，按 `Cmd + Q` 彻底退出，再用新图标打开一次即可，不需要更新插件。
- **不要修改 `Antigravity.app` 内部的文件**：会破坏应用签名，导致应用无法打开，而且更新后也会被还原。
- **安全说明**：调试端口只监听本机。用 `--remote-debugging-port=0` 时，系统会自动分配一个空闲的本机端口，不会占用固定端口。端口打开期间，本机上的其他程序也可以通过它控制 Antigravity 窗口，请只在你信任的个人电脑上使用。

---

## English

This guide covers everything needed to use agy-capsule on a Mac: downloading, installing the plugin, showing the footer capsule, enabling the plugin, and later updating, uninstalling and troubleshooting.

> **Not comfortable with Terminal?** Start a new conversation in Antigravity and send it this:
>
> ```text
> Please install agy-capsule for me following https://github.com/Lumidarin/agy-capsule/blob/main/docs/macos-install.md
> ```
>
> It will handle steps 1–3. Then you only need to do [Step 4](#step-4-enable-the-plugin) yourself. The AI can't restart Antigravity for you, because it runs inside Antigravity.

### For AI assistants

If you are an AI assistant installing this for the user:

1. Get the latest code:
   - Reuse an existing agy-capsule git folder only if all of these hold: `git remote get-url origin` points to `https://github.com/Lumidarin/agy-capsule`, the current branch is `main`, and `git status --porcelain` prints nothing. If so, run `git pull --ff-only origin main`, then check that `git rev-parse HEAD` and `git rev-parse FETCH_HEAD` print the same commit. If they differ, the local branch has extra commits: use a new folder as in the next item instead, and don't reset the user's branch.
   - Otherwise, or if there is no existing folder, `git clone` the repository into a new empty folder (for example `~/agy-capsule`; pick another name if it's taken). Don't touch the user's existing folder.
   - If git isn't available, download and unzip a fresh copy of the main branch zip into a new folder. Don't reuse an old unzipped folder in Downloads; it may be outdated.
   - If you can't get the latest code, stop and show the user the error. Don't install from old code.
2. In that folder, run `sh install.sh` and confirm the output says "Installed/updated agy-capsule".
3. Run the `osacompile` command from Step 3, Option 1 to create the `Antigravity-CDP` launcher.
4. Don't modify the plugin files, the original `Antigravity.app` or Antigravity's settings, and don't install any other software.
5. Don't quit or restart Antigravity. When you're done, tell the user, in their language, to do Step 4 themselves. If any step fails, show the user the error as-is.

### Install it yourself

Steps 1–4 below are for installing it yourself. If an AI installs it for you, you only need to do Step 4.

### Step 1: Download

Pick one:

- **With git** (easiest to update later): open **Terminal** and run
  ```sh
  git clone https://github.com/Lumidarin/agy-capsule.git ~/agy-capsule
  ```
- **As a zip**: on the [repository page](https://github.com/Lumidarin/agy-capsule), click the green **Code → Download ZIP**, then double-click the zip to unpack it.

### Step 2: Run the installer in Terminal

> **Don't double-click `install.sh`.** On macOS, double-clicking a `.sh` file only opens it in a text editor. The script doesn't run, so the plugin isn't installed.

1. Press `Cmd + Space`, search for **Terminal** and open it.
2. Type `cd ` (with a trailing space), drag the agy-capsule folder into the Terminal window, and press Return. If you used git, typing `cd ~/agy-capsule` works too.
3. Type the line below and press Return:
   ```sh
   sh install.sh
   ```
   "Installed/updated agy-capsule at …" means it worked.

### Step 3: Create a launcher with the debugging flag (for the footer capsule)

The footer capsule under the input box only appears when Antigravity starts with `--remote-debugging-port=0`. Without this step the sidebar stats still work; only the footer capsule is missing.

macOS aliases can't pass command-line flags the way Windows shortcuts do, so create a **launcher icon** once and open Antigravity from it from now on. Pick any of the three options below.

#### Option 1: One Terminal command (fastest, and easy for an AI to do)

Run this in Terminal:

```sh
osacompile -o /Applications/Antigravity-CDP.app -e 'do shell script "open -a Antigravity --args --remote-debugging-port=0"'
```

An `Antigravity-CDP` app appears in your Applications folder.

#### Option 2: Automator app (works on all macOS versions)

1. Press `Cmd + Space`, search for **Automator**, and open it.
2. Click **New Document** and choose **Application**.
3. Search for **Run Shell Script** on the left and drag it into the workflow area on the right.
4. Replace the default text in the script box (usually `cat`) with:

   ```sh
   open -a "Antigravity" --args --remote-debugging-port=0
   ```

5. Press `Cmd + S`, give it a name (for example, `Antigravity-CDP`), and save it to your **Applications** folder.

#### Option 3: Shortcuts (requires macOS 14 Sonoma or later)

1. Open the **Shortcuts** app, go to **Settings → Advanced**, and enable **Allow Running Scripts** (required, or the shortcut will fail).
2. Create a new shortcut, add the **Run Shell Script** action, and paste the same command:

   ```sh
   open -a "Antigravity" --args --remote-debugging-port=0
   ```

3. From the menu bar, choose **File → Add to Dock**.

> **Optional: reuse the Antigravity icon**
> Select the original `Antigravity` app in Applications and press `Cmd + I`. Click the small icon in the top-left corner of the Info window and press `Cmd + C`. Then select your new `Antigravity-CDP` app, press `Cmd + I`, click its top-left icon, and press `Cmd + V`. You can also drag the launcher into your Dock for quick access.

### Step 4: Enable the plugin

1. Press `Cmd + Q` to **quit** Antigravity completely. The red close button only closes the window; the app keeps running in the background, and reopening it then won't pass the flag.
2. Open Antigravity with the launcher from Step 3: Option 1 creates **Antigravity-CDP** in Applications; Option 2 uses the name you saved it under; Option 3 is the shortcut you added to the Dock.
3. Enable **agy-capsule** in Antigravity's **Plugins** panel.
4. Open **… → Extensions → agy-capsule** from the conversation header to show the sidebar.

### How to verify

- The sidebar shows context and token stats.
- The footer capsule appears under the input box, and there is no "Footer capsule is off" banner at the top of the sidebar.
- If the footer capsule doesn't appear, the command below is a troubleshooting clue. The number on the first line is the port recorded in the file, which may come from an earlier launch, so it doesn't prove the port is open now; the capsule appearing is what confirms success:

  ```sh
  cat ~/Library/Application\ Support/Antigravity/DevToolsActivePort
  ```

### Updating and uninstalling

- **Update**: if you used git, run `git pull` in the agy-capsule folder, then `sh update.sh`. If you used a zip, download and unpack it again, then run `sh update.sh` in the new folder. The plugin restarts itself; there's no need to enable it again. The first update from an older version without automatic reload needs one manual plugin restart.
- **Uninstall**: run `sh uninstall.sh` in the agy-capsule folder. Your preferences are kept.

### Troubleshooting

- **The plugin isn't in the Plugins panel**: make sure Step 2 was run in Terminal, not by double-clicking. Then run `ls ~/.gemini/config/plugins` in Terminal; the output should include `agy-capsule`.
- **The sidebar won't open or is blank**: please [open an issue](https://github.com/Lumidarin/agy-capsule/issues) and attach the log file `~/.gemini/antigravity/sidecar_data/agy-capsule/agy_capsule/logs/sidecar.log`. In Finder, press `Cmd + Shift + G` and paste that path to find it.
- **The sidebar shows a notice**: follow what it says. If that doesn't fix it, attach a screenshot of the notice to your issue.

### Notes

- **Seeing a second Antigravity icon in the Dock is normal**: the launcher only starts Antigravity with the flag and then exits, leaving the real Antigravity icon running. You can remove the original pinned icon from the Dock so you don't click it by mistake.
- **Launches that bypass the launcher won't carry the flag**: for example, opening an `antigravity://` link or using Finder's "Open With" when no window is running. If Antigravity restarts without the flag after an automatic update, the footer capsule won't load either. If the capsule disappears, press `Cmd + Q` and reopen via the launcher. No plugin update is needed.
- **Don't edit files inside `Antigravity.app`**: doing so breaks its code signature so the app won't open, and updates overwrite the changes anyway.
- **Security**: the debugging port listens on localhost only. With `--remote-debugging-port=0` the OS picks a free local port, so no fixed port is taken. While it's open, other programs on this computer can also control Antigravity windows; use it only on a computer you trust.
