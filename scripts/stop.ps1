<#
.SYNOPSIS
    Stops the running SiteDock server and removes its lock.

.DESCRIPTION
    Reads the PID from data\server.lock, confirms it is a SiteDock node process,
    stops that one process by ID, and removes the lock it leaves behind.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$LockFile = Join-Path $Root 'data\server.lock'

if (-not (Test-Path $LockFile)) {
    Write-Host 'SiteDock is not running (no server.lock).'
    return
}

$lockPid = (Get-Content $LockFile -Raw).Trim()
$process = if ($lockPid -match '^\d+$') { Get-CimInstance Win32_Process -Filter "ProcessId=$lockPid" -ErrorAction SilentlyContinue }
if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -like '*dist*server*main.js*') {
    Stop-Process -Id $lockPid -Force
    foreach ($attempt in 1..20) {
        if (-not (Get-Process -Id $lockPid -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 250
    }
    if (Get-Process -Id $lockPid -ErrorAction SilentlyContinue) { throw "SiteDock (PID $lockPid) did not stop." }
    Write-Host "Stopped SiteDock (PID $lockPid)."
}
else {
    Write-Host "server.lock named PID $lockPid, which is not a running SiteDock process."
}
Remove-Item $LockFile -Force
