# Agent 安装

Windows 上的 Codex 本地界面增强插件，需 Python 3.11 或更新版本。支持的客户端版本为 `26.1013.40934`、`26.1021.31345`、`26.1027.30824`、`26.1103.32239`、`26.1106.51428` 和 `26.1117.41037`。安装器检查原生加载入口和界面标记。升级后，从托盘退出并重新打开 Codex 即可使用新运行时。

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

验收：侧栏额度圆盘、work 输入框统计、回复同行用量、点击详情、模型切换；chat 隐藏底栏；切换对话后数据和尾栏随之更新。日志缺项显示未知，不估造。数据读取本机 `CODEX_HOME`，默认 `~/.codex`；额度优先同步原生账户通知，全局日志备用，不依赖当前会话。

历史统计缓存在项目 `.codex/codsh-usage-cache.json`，不含正文或系统提示词；只读取新增日志。缓存由独立线程处理，内存最多保留 4 个项目、32 MiB 内容；单文件上限 16 MiB。日志变化触发刷新，隐藏窗口暂停；缓存无效或项目不可写时回读原日志。

每个窗口在内存中保留最近 6 个对话的回复位置和统计按钮。整批挂载历史回复时，插件在列表上统一查找回复标记。同一批页面更新中移动过的容器会复用查找结果。切回仍保留的页面时复用回复位置，单条回复发生变化时只更新受影响的行。

性能优化只调整插件自身的行为，流式回复等原生动效由客户端控制。即使这一轮的用量记录尚未到达，插件也会跳过段落和代码高亮中的常规内容更新。生成回复或运行工具时，插件等当前轮结束后再定位这一轮的统计按钮。生成期间和长历史对话优先显示阅读区域附近的统计，向上滚动即可查看旧回复的用量。

回复操作栏里的复制、反馈、朗读和更多按钮在鼠标移开后也会显示。用量数据更新时复用输入框和侧栏额度按钮的位置。侧栏的位置或可见性变化时重新定位。实时速度直接更新已有数字的文本节点。数字位数变化时沿用原有的文字基线，按钮宽度由浏览器排版。单位或按钮排列变化时重新测量。

```powershell
& (Join-Path $installation 'Disable-UsagePlugin.ps1') # 停用
& (Join-Path $installation 'Enable-UsagePlugin.ps1')  # 启用
& (Join-Path $installation 'Start-OriginalCodex.ps1') # 完全退出后切回原版
& (Join-Path $installation 'Uninstall-UsagePlugin.ps1') # 删除插件，保留运行时
```

前端约 2 秒热更新；后端或加载桥更新须重启。未启动、未看到界面时如实报告。不得上传客户端、图标、账号、配置、日志、截图或安装记录。

发布包自带构建文件，无需 npm。修改源码后运行 `npm ci --ignore-scripts`、`npm run build`；安装器校验源码摘要，拒绝过期构建。
