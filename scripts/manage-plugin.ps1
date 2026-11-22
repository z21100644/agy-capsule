param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('install', 'uninstall')]
    [string]$Action,
    [string]$PluginsDirectory = (Join-Path $env:USERPROFILE '.gemini\config\plugins')
)

$ErrorActionPreference = 'Stop'
# Messages print as an [English] block, then a [中文] block.
# Keep this file UTF-8 with BOM so Windows PowerShell 5.1 reads the Chinese correctly.
function Format-Bilingual([string[]]$english, [string[]]$chinese) { (@('[English]') + $english + @('[中文]') + $chinese) -join [Environment]::NewLine }
function Say([string[]]$english, [string[]]$chinese) { Write-Host (Format-Bilingual $english $chinese) }

function Get-CustomNodeCommand([string]$manifestPath) {
    try {
        $command = (Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json).command
    } catch { return }
    # Keep only a fully qualified Windows Node path, not a bare or drive-relative command.
    if ($command -is [string] -and $command -match '^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/])(?:.*[\\/])?node\.exe\z') {
        return $command
    }
}

function Set-InstalledSidecarCommand([string]$manifestPath, [string]$customNode) {
    if ($customNode) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $manifest.command = $customNode
        [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
        return
    }
    # Read the host's UTF-8 wrapper as text: cmd.exe can misread non-ASCII paths in it.
    try {
        $wrapper = Get-Content -LiteralPath (Join-Path $env:APPDATA 'Antigravity\bin\agy-node.cmd') -Encoding UTF8 -Raw
    } catch {
        Say 'Could not read agy-node.cmd; keeping the default node command.' '无法读取 agy-node.cmd，保留默认的 node 启动方式。'
        return
    }
    if ($wrapper -notmatch '(?im)^[ \t]*"(?<exe>(?:[a-z]:\\|\\\\)[^"\r\n]*\\Antigravity\.exe)"[ \t]+%\*[ \t]*\r?$') {
        Say 'Could not identify Antigravity.exe in agy-node.cmd; keeping the default node command.' '无法从 agy-node.cmd 识别 Antigravity.exe 路径，保留默认的 node 启动方式。'
        return
    }
    $exe = $Matches.exe
    if ($exe -notmatch '[^\x00-\x7f]') { return }
    if (-not [IO.File]::Exists($exe)) {
        Say "Antigravity.exe not found at $exe; keeping the default node command." "找不到 $exe，保留默认的 node 启动方式。"
        return
    }

    # Direct Electron launches need the SDK loader normally supplied for "node".
    $loader = Join-Path $env:USERPROFILE '.gemini\antigravity\lib\node_modules\sidecar_sdk\register_loader.js'
    if (-not [IO.File]::Exists($loader)) {
        Say "SDK loader not found at $loader; keeping the default node command. Open Antigravity, then run update.bat again." "找不到 SDK 加载器 $loader，保留默认的 node 启动方式。请先打开 Antigravity，再运行 update.bat。"
        return
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifest.command = $exe
    $manifest.args = @("--import=$(([uri]$loader).AbsoluteUri)") + $manifest.args
    if (-not $manifest.env) { $manifest | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) }
    $manifest.env | Add-Member -NotePropertyName ELECTRON_RUN_AS_NODE -NotePropertyValue '1' -Force
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    Say 'Non-ASCII install path: the plugin will use Antigravity directly, without a separate Node installation.' 'Antigravity 安装路径含非 ASCII 字符，插件将直接用 Antigravity 启动，无需另装 Node。'
}

$pluginRoot = [IO.Path]::GetFullPath($PluginsDirectory).TrimEnd('\', '/')
$destination = [IO.Path]::GetFullPath((Join-Path $pluginRoot 'agy-capsule'))

# Validate the exact recursive-copy/delete target; never traverse a plugin link.
if ((Split-Path -Parent $destination) -ne $pluginRoot -or (Split-Path -Leaf $destination) -ne 'agy-capsule') {
    throw (Format-Bilingual "Invalid plugin destination: $destination" "插件目标路径无效：$destination")
}
if ((Test-Path -LiteralPath $destination) -and ((Get-Item -LiteralPath $destination -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw (Format-Bilingual "Plugin destination is a link. Remove the link manually first: $destination" "插件目标路径是一个链接，请先手动删除这个链接：$destination")
}

if ($Action -eq 'uninstall') {
    if (Test-Path -LiteralPath $destination) {
        Remove-Item -LiteralPath $destination -Recurse -Force
        $removedEn = "Removed agy-capsule from $destination"; $removedZh = "已从 $destination 移除 agy-capsule"
    } else {
        $removedEn = "Not installed: $destination"; $removedZh = "未安装：$destination"
    }
    Say @($removedEn, 'Preferences were kept. Reload open Antigravity pages to clear any remaining UI.') @($removedZh, '已保留设置。重新加载已打开的 Antigravity 页面即可清除残留界面。')
    exit 0
}

$source = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\agy-capsule')).Path
if (-not (Test-Path -LiteralPath (Join-Path $source 'plugin.json'))) {
    throw (Format-Bilingual "Source plugin manifest missing: $source\plugin.json" "缺少源插件清单：$source\plugin.json")
}
if ($source -eq $destination) { throw (Format-Bilingual 'Source and destination must be different directories.' '源目录和目标目录不能相同。') }
$installedSidecar = Join-Path $destination 'sidecars\agy_capsule\sidecar.json'
$customNode = Get-CustomNodeCommand $installedSidecar
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$marker = Join-Path $destination '.update-in-progress'
Set-Content -LiteralPath $marker -Value 'Updating agy-capsule' -Encoding ASCII
try {
    & robocopy.exe $source $destination /MIR /XJ /XF .update-in-progress /NFL /NDL /NJH /NJS /NP /R:2 /W:1
    if ($LASTEXITCODE -ge 8) { throw (Format-Bilingual "Plugin copy failed (robocopy exit code $LASTEXITCODE)." "插件复制失败（robocopy 退出码 $LASTEXITCODE）。") }
    Set-InstalledSidecarCommand $installedSidecar $customNode
} finally {
    Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
}
Say @("Installed/updated agy-capsule at $destination", 'Enable it in Antigravity Plugins on first install. Updates auto-restart a running reload-enabled version.') @("已安装/更新 agy-capsule 到 $destination", '首次安装需在 Antigravity 的 Plugins 面板中启用。更新后，支持自动重载的插件会自动重启。')
exit 0
