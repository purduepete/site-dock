<#
.SYNOPSIS
    Pulls the latest SiteDock, rebuilds, and restarts the logon-task server.

.DESCRIPTION
    Refuses to run with local changes. Pulls fast-forward only, reinstalls
    dependencies when the lockfile changed, and builds before stopping the
    running server, so a failed build leaves the current one serving.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $Root

if (git status --porcelain) { throw 'The checkout has local changes. Commit or discard them first.' }
if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) { throw 'The SiteDock task is not registered. Run scripts\install.ps1 first.' }

$before = git rev-parse HEAD
git pull --ff-only
if ($LASTEXITCODE) { throw 'git pull --ff-only failed.' }
$after = git rev-parse HEAD
if ($before -ne $after -and (git diff --name-only $before $after -- package-lock.json)) {
    npm ci
    if ($LASTEXITCODE) { throw 'npm ci failed.' }
}
npm run build
if ($LASTEXITCODE) { throw 'npm run build failed. The running server was left in place.' }

& (Join-Path $PSScriptRoot 'stop.ps1')
Set-SiteDockWatchdog
Start-SiteDockTask $Root
Write-Host "Updated $($before.Substring(0, 7)) -> $($after.Substring(0, 7))."
