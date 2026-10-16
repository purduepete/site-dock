<#
.SYNOPSIS
    Installs SiteDock on this computer as a hidden logon task behind Tailscale HTTPS.

.DESCRIPTION
    Run from a normal (non-elevated) PowerShell window, signed in as the account that
    owns the checkout. Re-running is safe.

    1. Imports favorites and the owner login sent with Taildrop, if present.
    2. Writes .env with this machine's Tailscale HTTPS origin.
    3. Installs dependencies and builds.
    4. Registers the SiteDock logon task, starts it, and verifies the server.
    5. Routes Tailscale HTTPS to the server, refusing to replace another app's route.

.PARAMETER HttpsPort
    Tailscale HTTPS port. 443 gives a URL without a port.

.PARAMETER ImportFrom
    Folder holding sitedock-favorites.json and sitedock-owner.json from Taildrop.

.EXAMPLE
    pwsh -NoProfile -File scripts\install.ps1
#>
[CmdletBinding()]
param(
    [int] $Port = 8790,
    [int] $HttpsPort = 443,
    [string] $ImportFrom = (Join-Path $HOME 'Downloads'),
    [switch] $SkipTailscale
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'common.ps1')
Set-Location $Root
$DataDir = Join-Path $Root 'data'

function Step([string] $Message) { Write-Host "`n== $Message" -ForegroundColor Cyan }

Step 'Checking prerequisites'
$nodeVersion = [version]((node --version).TrimStart('v'))
if ($nodeVersion -lt [version]'22.12.0') { throw "Node $nodeVersion is too old. SiteDock needs 22.12 or later." }
$tailscale = (Get-Command tailscale.exe -ErrorAction SilentlyContinue)?.Source
if (-not $tailscale -and (Test-Path 'C:\Program Files\Tailscale\tailscale.exe')) { $tailscale = 'C:\Program Files\Tailscale\tailscale.exe' }
if (-not $tailscale -and -not $SkipTailscale) { throw 'tailscale.exe was not found. Install Tailscale or pass -SkipTailscale.' }
Write-Host "node $nodeVersion; tailscale $(if ($tailscale) { $tailscale } else { 'skipped' })"

# Check the route before writing anything, so a conflict leaves this machine unchanged.
$remoteOrigin = $null
if ($tailscale) {
    $dnsName = ((& $tailscale status --json | ConvertFrom-Json).Self.DNSName).TrimEnd('.')
    $remoteOrigin = if ($HttpsPort -eq 443) { "https://$dnsName" } else { "https://${dnsName}:$HttpsPort" }
}
if ($tailscale -and -not $SkipTailscale) {
    Step "Checking Tailscale HTTPS port $HttpsPort"
    $serve = & $tailscale serve status --json | ConvertFrom-Json
    $web = if ($serve -and $serve.PSObject.Properties['Web']) { $serve.Web.PSObject.Properties[("{0}:{1}" -f $dnsName, $HttpsPort)] } else { $null }
    if ($web) {
        $proxies = @($web.Value.Handlers.PSObject.Properties | ForEach-Object { $_.Value.Proxy })
        $ours = "http://127.0.0.1:$Port"
        if ($proxies | Where-Object { $_ -and $_ -ne $ours }) {
            throw "Tailscale HTTPS $HttpsPort already serves $($proxies -join ', '). Re-run with -HttpsPort set to a free port, such as 9443."
        }
    }
    Write-Host "port $HttpsPort is free or already SiteDock's"
}

Step 'Importing data sent with Taildrop'
New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
foreach ($name in 'favorites', 'owner') {
    $source = Join-Path $ImportFrom "sitedock-$name.json"
    $target = Join-Path $DataDir "$name.json"
    if (-not (Test-Path $source)) { Write-Host "no $source; keeping current $name data"; continue }
    if (Test-Path $target) {
        Write-Warning "$target already exists. Leaving it and the Taildrop copy in place. Delete one to choose."
        continue
    }
    Move-Item $source $target
    Write-Host "imported $name.json"
}

Step 'Writing .env'
$envLines = @("SITEDOCK_PORT=$Port")
if ($remoteOrigin) { $envLines += "SITEDOCK_REMOTE_ORIGIN=$remoteOrigin" }
Set-Content -Path (Join-Path $Root '.env') -Value $envLines -Encoding ascii
$envLines | ForEach-Object { Write-Host $_ }

Step 'Installing dependencies and building'
npm ci
if ($LASTEXITCODE) { throw 'npm ci failed.' }
npm run build
if ($LASTEXITCODE) { throw 'npm run build failed.' }

Step 'Registering the SiteDock logon task'
& (Join-Path $PSScriptRoot 'stop.ps1')
$action = New-SiteDockTaskAction $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -MultipleInstances IgnoreNew
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'SiteDock favorites dashboard (hidden node server on 127.0.0.1).' | Out-Null
Set-SiteDockWatchdog
Start-SiteDockTask $Root

if ($tailscale -and -not $SkipTailscale) {
    Step 'Routing Tailscale HTTPS'
    & $tailscale serve --bg "--https=$HttpsPort" "http://127.0.0.1:$Port"
    if ($LASTEXITCODE) { throw 'tailscale serve failed. It may need an admin approval or Serve enabled for the tailnet.' }
    & $tailscale serve status
}

Step 'Done'
if (-not (Test-Path (Join-Path $DataDir 'owner.json'))) {
    Write-Warning 'No owner login yet. In a terminal outside VS Code, run: npm run owner -- setup'
}
if ($remoteOrigin) { Write-Host "Open $remoteOrigin/" -ForegroundColor Green }
