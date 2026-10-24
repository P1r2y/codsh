# Agent 安装说明：Codex 额度显示与底部统计栏

本文用于指导 agent 安装本仓库的本地界面增强插件。插件显示侧栏剩余额度圆盘、输入框下方统计栏，以及回复末尾的用量信息。

## 1. 核对运行环境

- 仅支持 Windows 桌面客户端。清单及安装器目前锁定 Codex 客户端版本 `26.1013.40934`。
- 需要 Python 3.11 或更新版本、Windows PowerShell；使用仓库方式安装时还需要 Git。插件运行时使用客户端自带的 Electron/Node，无需额外安装 npm 依赖。
- 这是本地增强加载器，不是官方插件市场插件。安装器从用户已安装的客户端创建独立副本，向副本加入加载器；官方安装目录不应被修改。
- 不承诺兼容其它客户端版本。安装器遇到版本不符或找不到唯一的补丁入口会停止；此时向用户报告实际版本，不能删除版本检查或强行替换字符串。

获取源码：

```powershell
git clone https://github.com/P1r2y/codsh.git
Set-Location .\codsh
python --version
```

不要用 `python install.py` 安装到仓库目录，也不要将官方客户端文件加入 Git。

## 2. 安装独立副本

默认从当前用户安装的 `OpenAI.Codex` Windows 应用包定位原客户端，并构建到 `%LOCALAPPDATA%\CodexUsageUI`：

```powershell
python install.py
```

若自动定位失败，先核实实际安装路径，再通过参数指定 **包含 `ChatGPT.exe` 和 `resources\app.asar` 的目录**：

```powershell
python install.py --source "<原客户端的 app 目录>" --destination "$env:LOCALAPPDATA\CodexUsageUI"
```

`--source` 与 `--destination` 必须是彼此独立的目录，不能相同，也不能互为父子目录。输出目录已有未登记的 `app` 时，安装器会拒绝覆盖；不要擅自删除那个目录，应让用户选择独立的新位置。

安装器会校验原始 `app.asar` 的构建前后 SHA-256，并为副本更新可执行文件资源与匹配的 ASAR 摘要。安装记录保存在输出目录的 `installation.json`，该文件属于本机数据，不能提交到 GitHub。

## 3. 启动与验收

默认安装目录的启动命令：

```powershell
$installation = Join-Path $env:LOCALAPPDATA 'CodexUsageUI'
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installation 'Start-CodexUsageUI.ps1')
```

若安装到了自定义位置，将 `$installation` 改为实际输出目录。

启动前让用户从托盘完全退出已有的 Codex。启动器遇到正在运行的客户端会提示并退出，agent 不得为此强制结束用户进程或中断正在进行的工作。若安装任务就在当前 Codex 会话中完成，先完成文件安装，再交给用户自行退出并启动副本。

使用官方快捷方式启动原客户端，不会自动加载这个增强插件；无需替换用户已有快捷方式。

启动副本后检查：

1. 侧栏出现额度圆盘；悬停或点击可以查看剩余额度及重置时间。
2. 打开有本地日志的会话，输入框下方出现统计栏；已有记录的回复末尾显示本轮用量。
3. 当前会话继续生成时，检查统计是否更新。缺少日志或速度字段时应显示暂无数据，不能编造数值。

额度和统计来自本机 `CODEX_HOME`，未设置时使用用户目录下的 `.codex`。插件读取 `sessions` 和 `archived_sessions` 中的日志计数事件，不会额外请求余额接口；额度可能是旧记录，到重置时刻应等待新记录，不能直接推定已经恢复。它显示的是订阅剩余额度，不是现金余额。

## 4. 启用、停用与切回原版

```powershell
& (Join-Path $installation 'Enable-UsagePlugin.ps1')
& (Join-Path $installation 'Disable-UsagePlugin.ps1')
```

加载器约每 2 秒同步开关；停用后应移除增强界面。更新已安装的插件文件时，前端代码按摘要重新加载；后端或加载器变更需要退出并重启副本。

切回官方客户端：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $installation 'Start-OriginalCodex.ps1')
```

先完全退出副本，再启动原版。原版升级后，副本不会自动适配；先核对新版本，再决定是否更新。

卸载插件可运行输出目录的 `Uninstall-UsagePlugin.ps1`。它会停用并删除副本内的 `plugins\codex-usage`，不会删除官方客户端，也不会删除用户的 `.codex` 目录。副本运行时仍保留；如用户要求进一步清理，只处理已核实的安装输出目录。

## Agent 的边界

- 只安装本仓库的插件与加载器，不上传客户端副本、账号文件、个人路径记录、聊天日志或截图。
- 不读取或索取 API key、Cookie、访问令牌来完成本插件安装。
- 不改写原版安装目录、账号数据、会话记录或用户原有启动入口。
- 分别报告已安装、已启动、已看到界面和仍待用户验证的步骤；未启动副本时不能声称已完成界面验证。
