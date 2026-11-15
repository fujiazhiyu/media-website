#Requires -RunAsAdministrator
[CmdletBinding()]
param([string]$ServiceName = 'LocalFrame', [string]$NssmPath = '')
$ErrorActionPreference = 'Stop'
if ($ServiceName -notmatch '^[a-zA-Z0-9_-]{1,64}$') { throw 'ServiceName 无效。' }
if (-not $NssmPath) { $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue; if ($cmd) { $NssmPath = $cmd.Source } }
if (-not $NssmPath -or -not (Test-Path -LiteralPath $NssmPath -PathType Leaf)) { throw '找不到 NSSM。请传入 -NssmPath 指定 nssm.exe。' }
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) { Write-Output "服务 $ServiceName 不存在，无需卸载。"; return }
if ($service.Status -ne 'Stopped') { Stop-Service -Name $ServiceName; $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) }
& $NssmPath remove $ServiceName confirm
if ($LASTEXITCODE -ne 0) { throw "卸载失败，NSSM 退出码 $LASTEXITCODE。" }
Write-Output '服务已卸载。媒体源文件、项目、配置、缓存和日志均保留。'
