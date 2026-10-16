<#
.SYNOPSIS
    Disables automatic recovery, stops SiteDock, and removes its lock and PID.

.DESCRIPTION
    Reads the PID from data\server.lock, confirms it is a SiteDock node process,
    stops that one process by ID, and removes the lock it leaves behind.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'common.ps1')
$LockFile = Join-Path $Root 'data\server.lock'
$PidFile = Join-Path $Root 'data\server.pid'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Disable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
}

$processIds = @(
    foreach ($file in @($LockFile, $PidFile)) {
        if (Test-Path $file) { (Get-Content $file -Raw).Trim() }
    }
) | Select-Object -Unique
foreach ($processId in $processIds) {
    if (Get-SiteDockProcess $processId) {
        Stop-Process -Id ([int]$processId) -Force
        foreach ($attempt in 1..20) {
            if (-not (Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue)) { break }
            Start-Sleep -Milliseconds 250
        }
        if (Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue) { throw "SiteDock (PID $processId) did not stop." }
        Write-Host "Stopped SiteDock (PID $processId)."
    }
}
foreach ($file in @($LockFile, $PidFile)) {
    if (Test-Path $file) { Remove-Item $file -Force }
}
Write-Host 'SiteDock is stopped. Automatic recovery is disabled until the task is enabled again.'
