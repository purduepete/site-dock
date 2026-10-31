# SiteDock

First entry holds the dock shell and controls until session and favorites reads finish, then reveals them together over 600ms. Sign-in and initial errors show the shell immediately. Refresh and navigation keep it visible. Embedded sites stay hidden until they load; after 4 seconds, a slow site can be opened in a new tab.

## SolutionDeploy handoff

Target favorites/groups/revisions and owner records use the dedicated `site_dock`
PostgreSQL database. See [the PostgreSQL cutover procedure](deploy/postgresql/README.md).
`STORAGE_BACKEND=postgresql` requires `DATABASE_URL` in private shared secrets and
schema version 1. Startup validates the ledger without DDL or file fallback.
Production sets `SITEDOCK_AUTH_MODE=gateway`: Cloudflare Access protects the public
route, and the tailnet route relies on Tailscale ACLs. SiteDock does not read identity
headers from either proxy. Its HTTP server binds only to `127.0.0.1`; configure each
exact HTTPS proxy origin in `SITEDOCK_REMOTE_ORIGINS` as a comma-separated list.
The existing `SITEDOCK_REMOTE_ORIGIN` setting remains supported. Local development
keeps owner-password login unless `SITEDOCK_AUTH_MODE=gateway` is set explicitly.

`deploy\application.json` describes the `jimbrownhome` checkout and `SiteDock`
task. It requires Node 22.12 or newer, builds with `npm ci` and `npm run build`,
and starts `dist\server\main.js` directly on `127.0.0.1:8790` with exact remote
origins `https://site-dock.jimlertech.com` and
`https://jimbrownhome1.tail8ad282.ts.net:8790`. Readiness is `/api/health`
returning `ok: true`.

The 2026-10-17 hosting audit (3:16 PM local) confirms the exact `SiteDock` task
name, `C:\Files\Dev\main\site-dock` task working directory, and loopback port 8790. Both build commands run at the staged release root
(`workingDirectory: "."`). TypeScript's root is the repository, so the server
build writes `dist\server\main.js`; Vite writes `frontend\dist`.
Committed `.env.example` and `.env.development` contain nonsecret defaults, while
the actual `.env` remains private state. The existing development launcher still
loads `.env.development`; packaging must preserve that development contract.

Verify the source task's effective data directory before migration. Copy
`favorites.json`, `owner.json`, their available `.bak` files, and `.env` using the
manifest inventory after stopping the source writer. Preserve the owner hash
record with restricted permissions in archived source backups and import it
unchanged into PostgreSQL. Source `.env` is archived as
`secrets\source\app.env`, separate from runtime `secrets\app.env`.
Before activation, prepare the runtime file in a secure terminal outside VS Code
from the reviewed frozen export, preserving needed service settings and adding
the target `DATABASE_URL`. Exclude all keys declared in `launch.environment`.
There is no automatic credential merge. Restrict access to the runtime account
and administrators; verify readability, database identity and readiness through
the reviewed activation checks. Explicit lifecycle environment takes precedence,
including the configured origin and data directory. Embedded-app tokens remain
in each browser's SiteDock-origin local storage and never enter the server or
database. Keep the existing user-facing origin unchanged to preserve those tokens;
changing the origin requires signing in to each embedded app again on each device.

The manifest deliberately excludes `server.lock`, `owner.lock`, `server.pid`,
pending atomic-write files, and launcher ownership markers. Inspect those on the
source before migration, never copy them as active ownership. The PostgreSQL
runtime uses database transactions and skips legacy directory ACL/lock operations.
Legacy log files are retained under shared logs; the
generic lifecycle writes new stdout/stderr there, outside the release. It must
launch the entrypoint directly and must not reuse the old launcher's mutable
path defaults.

The entrypoint polls private `SOLUTIONDEPLOY_STOP_FILE` every 250 ms.
Creating `{run}\stop.request` uses the same shutdown path as SIGINT/SIGTERM:
stop accepting requests, wait for HTTP work and the storage write queue, then
close the PostgreSQL pool (or release the legacy file lock) and exit. Remove a previous stop request before each launch and
wait for exit before replacing a release. Windows process termination does not
guarantee a write drain.

A local favorites dashboard with a vertical sidebar and an embedded page area. Favorites are shared across browsers through a local JSON file. One owner account protects the dashboard.

## Styling

SiteDock follows the existing app styling: self-hosted Roboto Flex, square corners, slate midnight surfaces, thin themed scrollbars, and stroke icons. Accents use Web Portfolio's Steel Blue (`#6b8cae`), with its darker Midnight Blue (`#2f477b`) for readable light-theme links and selection text. Buttons and the logo use flat Steel Blue fills with dark text. Light and dark themes follow the system preference unless you choose one explicitly. SiteDock changes its own chrome; embedded websites keep their own styling.

The font is bundled from `@fontsource-variable/roboto-flex` with its open-source license. No remote font request is needed. The prepaint script and active theme hook both update the iOS `theme-color`.

Initial session and favorites loading shows a themed spinner only after 250ms. The spinner and initial content fade in over 0.6s; reduced motion disables fades and rotation. Previously visited frames stay mounted when switching sites. Embedded sites show no spinner and fade in after their load event. If a site is still loading after 4 seconds, SiteDock offers to open it in a new tab. Returning after sign-in reloads the frame. Reloading a revealed site keeps the short reveal without replaying its first entrance.

The favorites rail expands and collapses over 300ms on desktop. Drag-resizing stays immediate.
On phones, the list slides in and out over 300ms and stays visible until the closing slide finishes.
Reduced motion disables both transitions. Embedded pages stay mounted throughout.

## This installation

- Production: `https://jimbrownhome.tail8ad282.ts.net:9443/` on jimbrownhome (443 there belongs to another app), started at logon by the `SiteDock` scheduled task.
- Previous host: `https://jimbrownlaptop.tail8ad282.ts.net/`, retired after the move.
- Local: `http://127.0.0.1:8790` on the host.
- Logs: `data\server.log` and `data\server.err.log`, with the previous 5 copies numbered `.1` (newest) through `.5`. Startup attempts and failures are timestamped in `data\startup.log` (rotated at 1 MiB to `.1`). The running PID is in `data\server.lock` and `data\server.pid`.
- Owner setup: `npm run owner -- setup`, in a terminal outside VS Code. There is no default credential.

Validation includes server and frontend tests, Microsoft Edge integration tests, TypeScript checks, production build, development UI/API proxy, and Tailscale HTTPS health. Browser checks rendered Ferry Tracker, SmartDevices, and FitTrack's token-entry screen, and opened ESPN in a separate tab. The UI checks cover custom dropdown placement, groups across browsers and sidebar sizes, modal confirmation and focus restoration, flat action colors, and the 44px desktop toolbar. Source-app authenticated sessions and a second device still require your checks.

`npm run test:startup` exercises the legacy Windows launcher with isolated servers.
Successful starts use its 15-second readiness budget; the foreign-listener test
keeps a 2-second failure deadline. Readiness requires the configured loopback
listener (remote port 0) to belong to the server PID, even when Windows misreports
its TCP state. Failed test runs include the startup log in their diagnostics.

## Requirements

- Node.js 22.12 or later.
- Windows for the documented hosting commands.
- Windows Script Host with VBScript enabled for the hidden scheduled-task wrapper.
- Tailscale on the host and client devices for remote access.

## Install as a service (Windows)

`scripts\install.ps1` sets up a machine in one step. Run it from a normal, non-elevated `pwsh` window as the account that owns the checkout:

```powershell
git clone https://github.com/purduepete/site-dock C:\Files\Dev\main\site-dock
Set-Location C:\Files\Dev\main\site-dock
pwsh -NoProfile -File scripts\install.ps1
```

It checks Node and Tailscale, then refuses to continue if Tailscale HTTPS 443 already routes to another app. Use `-HttpsPort 9443` in that case. It imports `sitedock-favorites.json` and `sitedock-owner.json` from Downloads (sent with `tailscale file cp`) without overwriting existing data, and writes `.env` with this machine's Tailscale origin. It then runs `npm ci` and the build, and registers a `SiteDock` logon task with a repeating 1-minute health check. The task runs `scripts\start-hidden.ps1`, which starts node with no console window and clears a `server.lock` left by a reboot or crash. The installer starts the task, waits for `/api/health`, and adds the Tailscale HTTPS route. Re-running it is safe.

| Action | Command                                                                           |
| ------ | --------------------------------------------------------------------------------- |
| Update | `npm run update` (pull fast-forward, build, restart; refuses local changes)       |
| Stop   | `pwsh -File scripts\stop.ps1`                                                     |
| Start  | `Enable-ScheduledTask -TaskName SiteDock; Start-ScheduledTask -TaskName SiteDock` |
| Status | `Invoke-RestMethod http://127.0.0.1:8790/api/health`                              |

The launcher requires a live SiteDock process, a successful `/api/health` response, and ownership of the configured listening port before reporting success. Each invocation tries up to 3 launches with a 15-second health window and 3-second pauses. Failures return a nonzero task result. Task Scheduler retries failures up to 3 times at 1-minute intervals; the repeating health trigger also recovers later crashes or an unhealthy server. A healthy process keeps its PID and logs. Recovery checks a live server twice before stopping it. Overlapping launches are serialized, and previous logs are preserved before each attempt.

The task uses `wscript.exe` and `scripts\start-task.vbs` to run the PowerShell launcher without a console window, including under Windows Terminal. The wrapper waits for the health-checked launcher and returns its exit code to Task Scheduler. Node still runs separately with both output streams redirected.

`scripts\stop.ps1` disables the task before stopping the server, so the watchdog cannot undo an intentional stop. Enable the task to resume automatic startup and recovery. Recovery requires the owning Windows account to remain logged on. It checks the local server, not Tailscale connectivity.

Existing installations receive watchdog settings through `npm run update`. To apply the settings without rebuilding or restarting a healthy server, run as the owning account:

```powershell
. .\scripts\common.ps1
Set-SiteDockWatchdog
Start-SiteDockTask (Get-Location).Path
```

The owning account must be allowed to modify, enable, and disable the `SiteDock` scheduled task. A task originally registered by another administrator may grant that account read-only access; an administrator must repair that task's permissions once. Keep the protected `data` directory restricted to the owner.

For a failed launch, read `data\startup.log`, `data\server.err.log`, and the numbered previous logs, then inspect `Get-ScheduledTaskInfo -TaskName SiteDock`. Run `npm run test:startup` for isolated Windows startup/recovery regression tests.

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
Set-Location C:\Files\Dev\main\site-dock
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
- Add and Edit open a centered modal. Save keeps the existing validation and conflict checks; Close editor or Escape dismisses unsaved form input and returns focus to the control that opened it. Save errors and concurrent-change choices remain visible inside the modal.
- To change group order, open the Group dropdown and choose Reorder groups.... Move groups with the up/down buttons, then choose Save order. Both the dropdown and Alt+G switcher use the shared saved order across browsers. All sites stays first. Cancel or Escape discards an unsaved rearrangement.
- Use the Group dropdown above the favorites to choose All sites or a named group. Choose Create group... to add a group in a modal. To add an existing site to groups, choose All sites, use its Edit control, check every desired group, and save. The same checkboxes are available when adding a favorite. Uncheck all groups to keep a site only in All sites. A site appears once in All sites and in every selected group, sharing one URL, display preference, and mounted page. Group names are unique without regard to capitalization, with up to 50 groups of 50 characters each. Empty groups remain available. Each named group holds up to 10 sites; All sites has no limit. A group checkbox shows "(full)" and is disabled once its group has 10 sites, and adding a favorite from a full group leaves that group unchecked. Groups saved with more than 10 sites before the limit existed keep them and can still be reordered or edited, but cannot grow until they drop below the limit. The server enforces the same rule. Renaming and deleting groups are not included.
- Groups and assignments are saved with the shared favorites using the same revision/conflict protection. Existing single-group assignments are read as one-element membership lists without rewriting the data until the next save. Favorites without assignments appear in All sites. The selected group is saved only in this browser. The dropdown stays available as a compact arrow in the 50px rail; hover shows the current group.
- Use the up/down arrows to reorder favorites with a pointer or keyboard. There are no drag handles.
- Arrow ordering applies to the visible group, preserving other groups' positions. Alt+1 through Alt+9 activate the first 9 visible favorites in the current group order, and Alt+0 activates the 10th, using the same embedded/external behavior as clicking. Favorites past the 10th in All sites have no shortcut. The sidebar shows each shortcut, and the collapsed rail shows the number on a small badge at each icon's corner. Shortcuts match the physical number key, so the top-row digits, the numpad digits (with Num Lock on or off), and macOS Option+number all work. They are inactive while editing, creating a group, confirming deletion, or using a text field or dropdown. Repeated key presses are ignored.
- On iPhone and iPad, the editor, Create group and group switcher modals open with focus on their heading so the software keyboard stays closed; desktop browsers still focus the first field, and tapping a field edits it as usual.
- Alt+G opens the group switcher. Type to filter, use the Up and Down arrows or press Alt+G again to move to the next group, then press Enter or click to switch. Each group shows its site count across all favorites. Escape or a click outside closes it and returns focus to where you were.
- Keys pressed inside an embedded site go to that site, not SiteDock. For apps you control, add the key forwarder so Alt+0..9 and Alt+G work while the app has focus:

    ```html
    <script src="https://<your-sitedock-host>/sitedock-keys.js"></script>
    ```

    The script only runs when the page is framed. It ignores keys typed in text fields and posts to the exact SiteDock origin it was loaded from (or the `data-sitedock-origin` attribute when you inline it), never to `*`. SiteDock accepts a forwarded key only from the active frame's window and only when the message origin matches that favorite's saved origin. If the app's Content-Security-Policy blocks the script, add the SiteDock origin to its `script-src` or inline the file with `data-sitedock-origin` set. Sites you don't control (news sites, for example) and nested frames inside an embedded app can't forward keys. A forwarded key that selects a separate-tab favorite may have its new tab blocked, because browser user activation does not cross frames; SiteDock then focuses the Open button so Enter opens it.

- Safari on iPad and iPhone erases a cross-site embedded page's localStorage when Safari or the home-screen app closes, so apps that keep a sign-in token there ask for it again. Apps you control can hand their token to SiteDock and get it back on the next load. Use `sitedock-token.js` (it exposes `SiteDockToken.get()`, `.save(token)`, and `.clear()`, each returning a promise) or bundle an equivalent helper, as FitTrack does:

    ```html
    <script src="https://<your-sitedock-host>/sitedock-token.js"></script>
    ```

    SiteDock stores the token in its own localStorage on that device, keyed by the frame's origin. It never sends tokens to the SiteDock server, so each device signs in to each app once. SiteDock answers only frames it mounted for an embedded favorite, only when the message comes from that frame's window with the favorite's saved origin, and only while you're signed in to SiteDock. Replies go to that exact origin. Pages on SiteDock's own origin are refused. Edit a favorite and choose Forget saved sign-in to remove its stored token. When you delete a favorite or move it to another origin from this browser, SiteDock drops the token once no favorite uses that origin. Signing out of SiteDock keeps saved tokens on the device.

- Theme uses a palette icon button that opens a Light/Midnight/System pill, matching Home Automation. Display preferences use custom button/listbox dropdowns. Primary actions use flat colors.
- Control hints use custom square, theme-aware boxes rather than browser tooltips. Longer group and editor help opens from an Info button by hover, keyboard focus, or tap. Escape, outside clicks, and focus leaving dismiss help; boxes stay within the viewport and work inside modals.
- On iPhone and iPad, action hints stay hidden, including with a mouse or trackpad. Info buttons open help only when tapped or activated; screen-reader descriptions remain available.
- Deletion requires confirmation in a styled modal; Cancel and Escape leave the favorite unchanged.
- A compact 44px desktop toolbar gives the embedded page the remaining space. Phone controls retain 44px touch targets.
- Resize the sidebar to change how much space the selected page receives.
- Click the S logo to toggle the desktop sidebar between its saved width and a 50px rail with clickable favicons, shortcut-number badges, and full-name tooltips. Missing or blocked favicons use initials in a circle. Icons are requested directly by your browser from the site's standard favicon or touch-icon paths, without a referrer or third-party icon service. SiteDock remembers which path worked for each site (for 7 days); failed searches are kept only in memory and retried after sign-in. Each page load adds a fresh cache-busting value to icon requests so a reload picks up changed icons. Switching groups reuses the same image URLs and loaded images for the rest of the session. A site must allow its icon to be loaded from another origin; a `Cross-Origin-Resource-Policy: same-origin` header on the icon (helmet's default) makes SiteDock show initials. The choice is saved in this browser. Embedded pages stay mounted and favorite shortcuts still work. On phones the existing favorites drawer is unchanged.
- Embedded pages remain mounted when switching favorites or groups. Switching groups selects the first visible favorite if the current one isn't in that group. An empty group leaves the page area empty. Browsers can still discard pages under memory pressure, and hidden pages may continue running media or timers.
- Reload returns an embedded page to its saved favorite URL. Browser cross-origin rules prevent SiteDock from reading that page's current address.
- Open-in-tab works independently of the embedded display preference.
- Deleting a favorite, changing its URL or mode, signing out, or detecting an expired session removes its mounted page.
- Dark/light/system theme, sidebar width, and last selection are browser-local preferences.

The initial list contains the 4 supplied URLs. It is seeded only for a new data store. An intentionally emptied list stays empty.

### Browser restrictions

SiteDock respects each site's framing and sign-in restrictions. It cannot guarantee that arbitrary websites work inside a frame.

- ESPN disallows embedding in SiteDock and starts in external mode.
- Ferry Tracker opens through its HTTPS public hostname, so SiteDock can embed it.
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
Set-Location C:\Files\Dev\main\site-dock
$serverPid = [int](Get-Content .\data\server.lock)
Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" |
    Select-Object ProcessId, ExecutablePath, CommandLine
# After confirming this is SiteDock's Node process:
Stop-Process -Id $serverPid
```

Verify that the PID has exited before removing its stale `data\server.lock`. Then `npm start` can restart the server. Removing the Tailscale route is a separate operation; stopping Node does not remove it.

## Theme preferences

Theme settings offer System, Light and Midnight. Midnight is the default. System follows OS changes live.
The `sitedock.theme` storage key accepts `system`, `light` and `midnight`; legacy `dark` values migrate to Midnight.
The self-hosted font keeps Fontsource's `Roboto Flex Variable` family name.
