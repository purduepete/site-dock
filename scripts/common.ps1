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

function Get-SiteDockProcess([string] $ProcessId) {
    if ($ProcessId -notmatch '^\d+$') { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
    if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -like '*dist*server*main.js*') { return $process }
    return $null
}

function Test-SiteDockHealth([string] $ProcessId, [int] $Port) {
    if (-not (Get-SiteDockProcess $ProcessId)) { return $false }
    try {
        $response = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    }
    catch {
        Write-Verbose "Health check failed: $($_.Exception.Message)"
        return $false
    }
    if ($response.ok -ne $true) { return $false }
    # A different app on this port must not make a failed launch look healthy.
    $listener = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -eq $Port -and $_.OwningProcess -eq [int]$ProcessId })
    return $listener.Count -gt 0
}

function New-SiteDockTaskAction([string] $Root) {
    $engine = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if (-not $engine) { $engine = Get-Command powershell.exe -ErrorAction Stop }
    $hostPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $wrapper = Join-Path $Root 'scripts\start-task.vbs'
    if (-not (Test-Path $hostPath)) { throw 'Windows Script Host is required for the hidden SiteDock task.' }
    if (-not (Test-Path $wrapper)) { throw "$wrapper is missing." }
    New-ScheduledTaskAction -Execute $hostPath -Argument "//B //Nologo `"$wrapper`" `"$($engine.Source)`"" -WorkingDirectory $Root
}

function Set-SiteDockWatchdog([string] $Root = (Split-Path -Parent $PSScriptRoot)) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $logonTriggers = @($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' })
    if ($logonTriggers.Count -eq 0) { throw "$TaskName has no logon trigger. Run scripts\install.ps1 first." }
    $watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -MultipleInstances IgnoreNew -StartWhenAvailable `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $action = New-SiteDockTaskAction $Root
    Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logonTriggers + $watchdog) -Settings $settings -ErrorAction Stop | Out-Null
}

function Start-SiteDockTask([string] $Root) {
    $pidFile = Join-Path $Root 'data\server.pid'
    $port = Get-SiteDockPort $Root
    Enable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
    Start-ScheduledTask -TaskName $TaskName

    $deadline = (Get-Date).AddSeconds(100)
    do {
        if (Test-Path $pidFile) {
            $candidate = (Get-Content $pidFile -Raw).Trim()
            if (Test-SiteDockHealth $candidate $port) {
                Write-Host "SiteDock is healthy on http://127.0.0.1:$port (PID $candidate)."
                return
            }
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "SiteDock did not become healthy. Read $(Join-Path $Root 'data\startup.log') and data\server.err.log; inspect Get-ScheduledTaskInfo -TaskName $TaskName."
}
