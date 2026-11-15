#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$ServiceName = 'LocalFrame',
    [string]$ProjectPath = (Split-Path -Parent $PSScriptRoot),
    [string]$NssmPath = '',
    [string]$NodePath = ''
)
$ErrorActionPreference = 'Stop'
if (-not $NssmPath) { $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue; if ($cmd) { $NssmPath = $cmd.Source } }
if (-not $NssmPath -or -not (Test-Path -LiteralPath $NssmPath -PathType Leaf)) { throw 'NSSM 未安装。请从 https://nssm.cc/download 手动下载并解压，传入 -NssmPath；脚本不会安装系统软件。' }
if (-not $NodePath) { $cmd = Get-Command node.exe -ErrorAction SilentlyContinue; if ($cmd) { $NodePath = $cmd.Source } }
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw '找不到 node.exe。请安装 Node.js LTS 或传入 -NodePath。' }
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$NssmPath = (Resolve-Path -LiteralPath $NssmPath).Path
if ($ServiceName -notmatch '^[a-zA-Z0-9_-]{1,64}$') { throw 'ServiceName 只允许字母、数字、下划线和横线。' }
if (-not (Test-Path -LiteralPath (Join-Path $ProjectPath 'server.js'))) { throw '项目目录缺少 server.js。' }
if (-not (Test-Path -LiteralPath (Join-Path $ProjectPath 'config.json'))) { throw '请先创建 config.json，并在控制台测试 npm start。' }
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) { throw '服务已存在。请先检查现有服务；脚本不会覆盖。' }
$logsPath = Join-Path $ProjectPath 'logs'
New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
function Invoke-Nssm { & $NssmPath @args; if ($LASTEXITCODE -ne 0) { throw "NSSM 操作失败，退出码 $LASTEXITCODE。请检查服务配置。" } }
Invoke-Nssm install $ServiceName $NodePath
Invoke-Nssm set $ServiceName AppParameters ('"' + (Join-Path $ProjectPath 'server.js') + '"')
Invoke-Nssm set $ServiceName AppDirectory $ProjectPath
Invoke-Nssm set $ServiceName DisplayName 'Local Frame 本地媒体浏览器'
Invoke-Nssm set $ServiceName Description '只读本地媒体网站；配置根目录与独立缩略图缓存。'
Invoke-Nssm set $ServiceName Start SERVICE_AUTO_START
Invoke-Nssm set $ServiceName AppStdout (Join-Path $logsPath 'stdout.log')
Invoke-Nssm set $ServiceName AppStderr (Join-Path $logsPath 'stderr.log')
Invoke-Nssm set $ServiceName AppRotateFiles 1
Invoke-Nssm set $ServiceName AppRotateOnline 1
Invoke-Nssm set $ServiceName AppRotateBytes 10485760
Invoke-Nssm set $ServiceName AppExit Default Restart
Invoke-Nssm set $ServiceName AppRestartDelay 5000
Invoke-Nssm set $ServiceName AppStopMethodConsole 5000
Invoke-Nssm set $ServiceName AppKillProcessTree 1
Write-Output "服务 $ServiceName 已注册（尚未启动）。请先检查登录账户和目录权限，然后运行 Start-Service $ServiceName。"
Write-Output "日志目录：$logsPath"
