# Agent 安装

Windows；Codex `26.1013.40934` / `26.1021.31345`；Python ≥3.11。本地界面增强插件，非官方市场插件。

```powershell
git clone https://github.com/P1r2y/codsh.git
Set-Location codsh
python install.py
```

默认安装到 `%LOCALAPPDATA%\CodexUsageUI`。已有安装须指定原安装目录：

```powershell
git pull --ff-only
python install.py --destination "<原安装目录>"
```

自动检查商店版、运行进程和已有安装，选择最新原客户端。定位失败时添加 `--source "<包含 ChatGPT.exe 的原客户端 app 目录>"`。仅接受清单支持的版本，并检查加载入口和原生界面结构；不符则停止，不回退旧版本。安装目录须独立于原客户端和仓库。

安装器复制客户端，仅加入主进程和预加载桥；不修改原安装目录或 React 脚本。运行时按摘要复用，新版本另建目录，保留正在运行的旧版本。

用户从托盘完全退出 Codex 后启动：

```powershell
$installation=Join-Path $env:LOCALAPPDATA 'CodexUsageUI' # 自定义安装时替换
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installation 'Start-CodexUsageUI.ps1')
```

不得强制终止用户进程。仅在用户要求时备份并修改桌面原「Codex」快捷方式，指向上述脚本，保留名称和图标，不新增定制版入口。

验收：侧栏额度圆盘、输入框统计、回复同行用量、点击详情、模型切换；切换对话后数据和尾栏随之更新。日志缺项显示未知，不估造。数据读取本机 `CODEX_HOME`，默认 `~/.codex`；额度来自最近日志。

```powershell
& (Join-Path $installation 'Disable-UsagePlugin.ps1') # 停用
& (Join-Path $installation 'Enable-UsagePlugin.ps1')  # 启用
& (Join-Path $installation 'Start-OriginalCodex.ps1') # 完全退出后切回原版
& (Join-Path $installation 'Uninstall-UsagePlugin.ps1') # 删除插件，保留运行时
```

前端约 2 秒热更新；后端或加载桥更新须重启。未启动、未看到界面时如实报告。不得上传客户端、图标、账号、配置、日志、截图或安装记录。

发布包自带构建文件，无需 npm。修改源码后运行 `npm ci --ignore-scripts`、`npm run build`；安装器校验源码摘要，拒绝过期构建。
