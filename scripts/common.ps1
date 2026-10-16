# Shared by install.ps1 and update.ps1. Dot-source it; it defines functions only.

$TaskName = 'SiteDock'

function Get-SiteDockPort([string] $Root) {
    $envFile = Join-Path $Root '.env'
    if (Test-Path $envFile) {
        $line = Get-Content $envFile | Where-Object { $_ -match '^\s*SITEDOCK_PORT\s*=\s*(\d+)\s*$' } | Select-Object -First 1
        if ($line -and $line -match '(\d+)\s*$') { return [int]$Matches[1] }
    }
    return 8790
}

function Start-SiteDockTask([string] $Root) {
    $pidFile = Join-Path $Root 'data\server.pid'
    $port = Get-SiteDockPort $Root
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $TaskName

    # The launcher exits immediately, so the task state proves nothing. Check the PID and the listener.
    $serverPid = $null
    foreach ($attempt in 1..30) {
        Start-Sleep -Milliseconds 500
        $candidate = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($candidate -and (Get-Process -Id $candidate -ErrorAction SilentlyContinue)) { $serverPid = $candidate; break }
    }
    if (-not $serverPid) {
        throw "SiteDock did not start. Read $(Join-Path $Root 'data\server.err.log') and Get-ScheduledTaskInfo -TaskName $TaskName."
    }

    $healthy = $false
    foreach ($attempt in 1..30) {
        try {
            $response = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
            if ($response.ok) { $healthy = $true; break }
        }
        catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $healthy) {
        throw "SiteDock (PID $serverPid) is running but http://127.0.0.1:$port/api/health did not answer. Read $(Join-Path $Root 'data\server.err.log')."
    }

    $consoles = @(Get-CimInstance Win32_Process -Filter "Name='conhost.exe'" | Where-Object ParentProcessId -eq ([int]$serverPid))
    $drawn = @($consoles | Where-Object { $_.CommandLine -notmatch '0x4' })
    if ($drawn.Count -gt 0) { Write-Warning "SiteDock has a console that may be visible: $($drawn.CommandLine -join '; ')" }

    Write-Host "SiteDock is healthy on http://127.0.0.1:$port (PID $serverPid)."
}
