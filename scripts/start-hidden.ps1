<#
.SYNOPSIS
    Starts the SiteDock server as a hidden background process, then exits.

.DESCRIPTION
    The logon task runs this launcher instead of node directly. Both of node's
    streams are redirected to files, so the long-lived process gets a headless
    console and no window is drawn, even when Windows Terminal is the default
    terminal.

    Checks health, recovers stale locks and failed processes, preserves prior
    logs, and retries failed startup. Also runs every minute as a watchdog.
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 3)][int] $MaxAttempts = 3,
    [ValidateRange(1, 20)][int] $StartupTimeoutSeconds = 15,
    [ValidateRange(0, 5)][int] $RetryDelaySeconds = 3
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'common.ps1')
$DataDir = Join-Path $Root 'data'
$LockFile = Join-Path $DataDir 'server.lock'
$PidFile = Join-Path $DataDir 'server.pid'
$LogPath = Join-Path $DataDir 'server.log'
$ErrorLogPath = Join-Path $DataDir 'server.err.log'
$Entry = Join-Path $Root 'dist\server\main.js'
$StartupLog = Join-Path $DataDir 'startup.log'
$Port = Get-SiteDockPort $Root

function Write-StartupLog([string] $Message) {
    if ((Test-Path $StartupLog) -and (Get-Item $StartupLog).Length -ge 1MB) {
        Move-Item $StartupLog "$StartupLog.1" -Force
    }
    Add-Content -Path $StartupLog -Value "$(Get-Date -Format o) $Message"
}

function Move-ServerLogs {
    foreach ($path in @($LogPath, $ErrorLogPath)) {
        if (Test-Path "$path.5") { Remove-Item "$path.5" -Force }
        foreach ($index in 4..1) {
            if (Test-Path "$path.$index") { Move-Item "$path.$index" "$path.$($index + 1)" }
        }
        if (Test-Path $path) { Move-Item $path "$path.1" }
    }
}

function Stop-SiteDockProcess([string] $ProcessId) {
    if (Get-SiteDockProcess $ProcessId) {
        Stop-Process -Id ([int]$ProcessId) -Force
        $deadline = (Get-Date).AddSeconds(5)
        while (Get-Process -Id ([int]$ProcessId) -ErrorAction SilentlyContinue) {
            if ((Get-Date) -ge $deadline) { throw "PID $ProcessId did not stop." }
            Start-Sleep -Milliseconds 100
        }
    }
}

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null

try {
    if (-not (Test-Path $Entry)) { throw "$Entry is missing. Run npm run build first." }
    # Serialize manual launches and task invocations without leaving a stale mutex file.
    $guard = [IO.File]::Open((Join-Path $DataDir 'startup.guard'), 'OpenOrCreate', 'ReadWrite', 'None')
    try {
        $existingPids = @(
            foreach ($file in @($LockFile, $PidFile)) {
                if (Test-Path $file) { (Get-Content $file -Raw).Trim() }
            }
        ) | Select-Object -Unique
        foreach ($existingPid in $existingPids) {
            if (Test-SiteDockHealth $existingPid $Port) {
                Set-Content -Path $PidFile -Value $existingPid
                return
            }
        }
        foreach ($existingPid in $existingPids) {
            if (Get-SiteDockProcess $existingPid) {
                # Confirm a failed health check before interrupting a live server.
                Start-Sleep -Seconds 2
                if (Test-SiteDockHealth $existingPid $Port) {
                    Set-Content -Path $PidFile -Value $existingPid
                    return
                }
                Write-StartupLog "Recovering unhealthy SiteDock PID $existingPid."
                Stop-SiteDockProcess $existingPid
            }
        }
        foreach ($attempt in 1..$MaxAttempts) {
            $proc = $null
            try {
                foreach ($file in @($LockFile, $PidFile)) {
                    if (Test-Path $file) {
                        Write-StartupLog "Removing stale $([IO.Path]::GetFileName($file))."
                        Remove-Item $file -Force
                    }
                }
                Move-ServerLogs
                Write-StartupLog "Startup attempt $attempt/$MaxAttempts."
                $node = (Get-Command node.exe -ErrorAction Stop).Source
                $proc = Start-Process -FilePath $node -ArgumentList '--env-file-if-exists=.env', 'dist\server\main.js' `
                    -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
                    -RedirectStandardOutput $LogPath -RedirectStandardError $ErrorLogPath
                Set-Content -Path $PidFile -Value $proc.Id
                $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
                do {
                    $proc.Refresh()
                    if ($proc.HasExited) { throw "Node PID $($proc.Id) exited with code $($proc.ExitCode)." }
                    if (Test-SiteDockHealth "$($proc.Id)" $Port) {
                        Write-StartupLog "Healthy on port $Port (PID $($proc.Id))."
                        return
                    }
                    Start-Sleep -Milliseconds 500
                } while ((Get-Date) -lt $deadline)
                throw "Node PID $($proc.Id) failed its health check within $StartupTimeoutSeconds seconds."
            }
            catch {
                Write-StartupLog "Attempt $attempt failed: $($_.Exception.Message)"
                if ($proc) { Stop-SiteDockProcess "$($proc.Id)" }
                foreach ($file in @($LockFile, $PidFile)) {
                    if (Test-Path $file) { Remove-Item $file -Force }
                }
                if ($attempt -eq $MaxAttempts) { throw }
                Start-Sleep -Seconds $RetryDelaySeconds
            }
        }
    }
    finally { $guard.Dispose() }
}
catch {
    Write-StartupLog "STARTUP FAILED: $($_.Exception.Message)"
    Write-Error $_ -ErrorAction Continue
    exit 1
}
