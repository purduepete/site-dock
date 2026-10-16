<#
.SYNOPSIS
    Starts the SiteDock server as a hidden background process, then exits.

.DESCRIPTION
    The logon task runs this launcher instead of node directly. Both of node's
    streams are redirected to files, so the long-lived process gets a headless
    console and no window is drawn, even when Windows Terminal is the default
    terminal.

    The server refuses to start while data\server.lock exists. A reboot or a
    killed process leaves that lock behind, so a lock whose PID is no longer a
    running SiteDock node process is removed before starting.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $Root 'data'
$LockFile = Join-Path $DataDir 'server.lock'
$PidFile = Join-Path $DataDir 'server.pid'
$LogPath = Join-Path $DataDir 'server.log'
$ErrorLogPath = Join-Path $DataDir 'server.err.log'
$Entry = Join-Path $Root 'dist\server\main.js'

function Get-SiteDockProcess([string] $ProcessId) {
    if ($ProcessId -notmatch '^\d+$') { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -like '*dist*server*main.js*') { return $process }
    return $null
}

if (-not (Test-Path $Entry)) {
    throw "$Entry is missing. Run npm run build first."
}
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null

if (Test-Path $LockFile) {
    $lockPid = (Get-Content $LockFile -Raw -ErrorAction SilentlyContinue).Trim()
    if (Get-SiteDockProcess $lockPid) {
        Set-Content -Path $PidFile -Value $lockPid
        Write-Host "SiteDock is already running (PID $lockPid)."
        return
    }
    Remove-Item $LockFile -Force
    Write-Host "Removed a stale server.lock (PID $lockPid is not running SiteDock)."
}

$node = (Get-Command node.exe).Source
$proc = Start-Process -FilePath $node -ArgumentList '--env-file-if-exists=.env', 'dist\server\main.js' `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $LogPath -RedirectStandardError $ErrorLogPath

Set-Content -Path $PidFile -Value $proc.Id
Write-Host "SiteDock started (PID $($proc.Id), hidden). Logs: $LogPath"
