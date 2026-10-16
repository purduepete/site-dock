# SiteDock

A local favorites dashboard with a vertical sidebar and an embedded page area. Favorites are shared across browsers through a local JSON file. One owner account protects the dashboard.

## Styling

SiteDock follows the existing app styling: self-hosted Roboto Flex, square corners, slate midnight surfaces, thin themed scrollbars, and stroke icons. Accents use Web Portfolio's Steel Blue (`#6b8cae`), with its darker Midnight Blue (`#2f477b`) for readable light-theme links and selection text. Buttons and the logo use flat Steel Blue fills with dark text. Light and dark themes follow the system preference unless you choose one explicitly. SiteDock changes its own chrome; embedded websites keep their own styling.

The font is bundled from `@fontsource-variable/roboto-flex` with its open-source license. No remote font request is needed. The prepaint script and active theme hook both update the iOS `theme-color`.

## This installation

- Production: `https://jimbrownhome.tail8ad282.ts.net:9443/` on jimbrownhome (443 there belongs to another app), started at logon by the `SiteDock` scheduled task.
- Previous host: `https://jimbrownlaptop.tail8ad282.ts.net/`, retired after the move.
- Local: `http://127.0.0.1:8790` on the host.
- Logs: `data\server.log` and `data\server.err.log`. The running PID is in `data\server.lock`.
- Owner setup: `npm run owner -- setup`, in a terminal outside VS Code. There is no default credential.

Validation includes server and frontend tests, Microsoft Edge integration tests, TypeScript checks, production build, development UI/API proxy, and Tailscale HTTPS health. Browser checks rendered Ferry Tracker, SmartDevices, and FitTrack's token-entry screen, and opened ESPN in a separate tab. The UI checks cover custom dropdown placement, groups across browsers and sidebar sizes, modal confirmation and focus restoration, flat action colors, and the 44px desktop toolbar. Source-app authenticated sessions and a second device still require your checks.

## Requirements

- Node.js 22.12 or later.
- Windows for the documented hosting commands.
- Tailscale on the host and client devices for remote access.

## Install as a service (Windows)

`scripts\install.ps1` sets up a machine in one step. Run it from a normal, non-elevated `pwsh` window as the account that owns the checkout:

```powershell
git clone https://github.com/purduepete/sitedock C:\Files\Dev\main\sitedock
Set-Location C:\Files\Dev\main\sitedock
pwsh -NoProfile -File scripts\install.ps1
```

It checks Node and Tailscale, then refuses to continue if Tailscale HTTPS 443 already routes to another app. Use `-HttpsPort 9443` in that case. It imports `sitedock-favorites.json` and `sitedock-owner.json` from Downloads (sent with `tailscale file cp`) without overwriting existing data, and writes `.env` with this machine's Tailscale origin. It then runs `npm ci` and the build, and registers a `SiteDock` logon task. The task runs `scripts\start-hidden.ps1`, which starts node with no console window and clears a `server.lock` left by a reboot or crash. The installer starts the task, waits for `/api/health`, and adds the Tailscale HTTPS route. Re-running it is safe.

| Action | Command |
|---|---|
| Update | `npm run update` (pull fast-forward, build, restart; refuses local changes) |
| Stop | `pwsh -File scripts\stop.ps1` |
| Start | `Start-ScheduledTask -TaskName SiteDock` |
| Status | `Invoke-RestMethod http://127.0.0.1:8790/api/health` |

Nothing restarts SiteDock after a crash. Start the task again and read `data\server.err.log`.

Sending data from the old host:

```powershell
Copy-Item data\favorites.json $env:TEMP\sitedock-favorites.json
Copy-Item data\owner.json $env:TEMP\sitedock-owner.json
tailscale file cp $env:TEMP\sitedock-favorites.json $env:TEMP\sitedock-owner.json jimbrownhome:
```

Web Options only allows framing from listed SiteDock origins (`backend/src/app.ts` in that repo). Update that list when SiteDock changes host.

## Install and configure

Run commands from the project root:

```powershell
Set-Location C:\Files\Dev\main\sitedock
npm ci
Copy-Item .env.example .env
```

Edit `.env` to set the port and this computer's exact Tailscale HTTPS origin. `.env` and runtime data are excluded from Git. The default local port is 8790.

```text
SITEDOCK_PORT=8790
SITEDOCK_REMOTE_ORIGIN=https://jimbrownlaptop.tail8ad282.ts.net
```

Use the actual host name reported by `tailscale status --json` when moving the app to another computer. Do not include a trailing path. Changing the port also requires updating the Tailscale route.

Create the owner account in a terminal outside the chat transcript:

```powershell
npm run owner -- setup
```

Choose a password of at least 12 characters. The prompt hides password input. Do not put passwords in command arguments, environment files, or chat. Setup and the server must use the same data directory.

## Build and run

```powershell
npm run build
npm start
```

Open `http://localhost:8790`. The server listens on loopback, rather than a LAN address. Keep this terminal open while using the app; Ctrl+C stops it. A separately launched background instance can keep running after the terminal closes. For automatic startup at logon, use `scripts\install.ps1` (see above).

The server can show the login screen before an account exists, but signing in requires completing local setup. There is no default password or remotely accessible account-creation endpoint.

## Tailscale HTTPS

Confirm the current configuration before changing it:

```powershell
tailscale serve status
tailscale serve --bg --https=443 http://127.0.0.1:8790
tailscale serve status
```

These commands assume port 443 on this node is available. Preserve existing routes if another app is already using it. Tailscale may require an administrator approval or enabling Serve for your tailnet. Do not enable Funnel. SiteDock does not need public internet access.

Open the configured HTTPS origin from a device on your tailnet and log in. Tailscale access rules and the SiteDock owner password both apply. Forwarded headers are accepted only with the configured host and HTTPS scheme. Direct requests to an unconfigured hostname are rejected.

Remove only SiteDock's route when you no longer need it:

```powershell
tailscale serve --https=443 off
```

Do not use `tailscale serve reset` if the node has other routes.

## Favorites and page behavior

- Add a name, an HTTP(S) URL, and an embedded or external display preference.
- Use the Group dropdown above the favorites to choose All sites or a named group. Choose Create group... to add a group in a modal. To add an existing site to groups, choose All sites, use its Edit control, check every desired group, and save. The same checkboxes are available when adding a favorite. Uncheck all groups to keep a site only in All sites. A site appears once in All sites and in every selected group, sharing one URL, display preference, and mounted page. Group names are unique without regard to capitalization, with up to 50 groups of 50 characters each. Empty groups remain available. Renaming and deleting groups are not included.
- Groups and assignments are saved with the shared favorites using the same revision/conflict protection. Existing single-group assignments are read as one-element membership lists without rewriting the data until the next save. Favorites without assignments appear in All sites. The selected group is saved only in this browser. The dropdown stays available as a compact arrow in the 50px rail; hover shows the current group.
- Use the up/down arrows to reorder favorites with a pointer or keyboard. There are no drag handles.
- Arrow ordering applies to the visible group, preserving other groups' positions. Ctrl+1 through Ctrl+9 activate the first 9 visible favorites in the current group order, using the same embedded/external behavior as clicking. The sidebar shows each shortcut. Shortcuts are inactive while editing, creating a group, confirming deletion, or using a text field or dropdown. Repeated key presses are ignored.
- Browser shortcuts can take priority: Edge and Chrome reserve Ctrl+number for tab selection. A regular website cannot guarantee overriding them. Keys pressed inside cross-origin embedded sites do not reach SiteDock. Focus the dashboard sidebar to use shortcuts where the browser permits them.
- Theme and display preferences use custom button/listbox dropdowns. Primary actions use flat colors.
- Deletion requires confirmation in a styled modal; Cancel and Escape leave the favorite unchanged.
- A compact 44px desktop toolbar gives the embedded page the remaining space. Phone controls retain 44px touch targets.
- Resize the sidebar to change how much space the selected page receives.
- Click the S logo to toggle the desktop sidebar between its saved width and a 50px rail with clickable favicons and full-name tooltips. Missing or blocked favicons use initials in a circle. Icons are requested directly by your browser from the site's standard favicon or touch-icon paths, without a referrer or third-party icon service. The choice is saved in this browser. Embedded pages stay mounted and favorite shortcuts still work. On phones the existing favorites drawer is unchanged.
- Embedded pages remain mounted when switching favorites or groups. Switching groups selects the first visible favorite if the current one isn't in that group. An empty group leaves the page area empty. Browsers can still discard pages under memory pressure, and hidden pages may continue running media or timers.
- Reload returns an embedded page to its saved favorite URL. Browser cross-origin rules prevent SiteDock from reading that page's current address.
- Open-in-tab works independently of the embedded display preference.
- Deleting a favorite, changing its URL or mode, signing out, or detecting an expired session removes its mounted page.
- Dark/light/system theme, sidebar width, and last selection are browser-local preferences.

The initial list contains the 4 supplied URLs. It is seeded only for a new data store. An intentionally emptied list stays empty.

### Browser restrictions

SiteDock respects each site's framing and sign-in restrictions. It cannot guarantee that arbitrary websites work inside a frame.

- ESPN disallows embedding in SiteDock and starts in external mode.
- The HTTP favorite at `http://100.114.72.86:8787/` opens externally when SiteDock is accessed through HTTPS. Local HTTP access may permit embedding.
- The two other supplied HTTPS apps are embedding candidates. Their complete pages, redirects, and sign-ins need browser testing.
- Third-party cookie restrictions can prevent embedded sign-ins even when a page renders. Use external mode if needed.
- Frames have scripts, forms, and popup permissions, but cannot navigate SiteDock's top-level page. SiteDock's configured origins cannot be added as favorites.
- Source sites keep their own accounts and cookies. Logging out of SiteDock does not log out of those sites or close tabs opened separately.

SiteDock never fetches or rewrites favorite pages on the server. It does not strip source security headers or relax browser protections.

## Sessions and password reset

Sessions last at most 7 days. Restarting the server clears every session. Local HTTP and remote HTTPS sign-ins are separate.

Reset the owner password locally:

```powershell
npm run owner -- reset
```

Existing sessions are rejected on their next authenticated request because the persisted credential version changes. Open dashboards check again when receiving focus. If the account file cannot be read or validated, access fails closed.

Failed logins share a bounded owner-account cooldown. Wait for the reported cooldown before trying again.

## Data, backups, and conflicts

Runtime data defaults to `data` beneath the project root. Use `SITEDOCK_DATA_DIR` to choose another private local directory. Keep it outside static hosting and restrict access to your Windows user.

Stop the server before copying the entire data directory for a consistent backup. It contains the shared favorites and password hash. Treat account files as private. To restore, stop the server, restore the directory from a known-good backup, and restart.

Writes are serialized and use same-directory temporary files followed by atomic replacement. A last-good backup is retained. Corrupt files and write failures produce errors; they do not silently reset your favorites. Use the reported file path and a known-good backup to recover rather than deleting data.

Every update carries a revision. If another browser saved first, SiteDock returns a conflict and asks you to reconcile before retrying. Pending form text is kept. Only one server may use a data directory at a time.

## Development and validation

```powershell
npm run dev
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Stop the production instance before running development mode; both use port 8790 and the same data directory. The development UI at `http://127.0.0.1:5173` proxies `/api` to the local server. The development script loads `.env.development` to allow that exact origin. Production serves the built UI and API from the same origin. Development host/port origin checks must remain explicit.

Browser integration tests use installed Microsoft Edge and temporary data, not the real owner account. They must not write to production favorites.

Before relying on remote use, verify from a second device:

1. Tailscale HTTPS opens and requires a SiteDock login.
2. Favorites and their order match after reopening the dashboard.
3. The HTTPS app pages render, and their sign-ins work or have a usable external-tab path.
4. ESPN and the HTTP-only favorite open externally.

## Troubleshooting

- **Connection refused:** check whether the Node process is running and whether the configured port matches the route.
- **Host or origin rejected:** use an exact configured local address or Tailscale HTTPS origin. Do not expose the loopback server through an arbitrary proxy.
- **Blank embedded page:** use open-in-tab, then change its display mode to external. Header checks alone cannot prove a page will render.
- **Permission or rename failure:** check data-directory permissions and file locks. A failed save must remain visible; do not assume the edit persisted.
- **Server already running:** use its recorded process ID to inspect it. Stop only that process if appropriate. Do not kill all Node processes.
- **Stale server lock after forced termination:** inspect `data\server.lock`, verify that its recorded PID is no longer running, then remove that exact lock file before restarting. Never remove a lock while its server is alive. A forced Windows process termination may skip normal lock cleanup.
- **Missing owner account:** complete local setup. There is no online password recovery.

To inspect the production process and stop this instance, run:

```powershell
Set-Location C:\Files\Dev\main\sitedock
$serverPid = [int](Get-Content .\data\server.lock)
Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" |
    Select-Object ProcessId, ExecutablePath, CommandLine
# After confirming this is SiteDock's Node process:
Stop-Process -Id $serverPid
```

Verify that the PID has exited before removing its stale `data\server.lock`. Then `npm start` can restart the server. Removing the Tailscale route is a separate operation; stopping Node does not remove it.
