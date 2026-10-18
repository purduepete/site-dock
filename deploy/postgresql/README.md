# PostgreSQL storage and cutover

The target uses its own `site_dock` database on `jimbrownhome1`. Its framework roles
are `sd_site_dock_owner`, `sd_site_dock_migrator`, and `sd_site_dock_runtime`.
Production sets
`STORAGE_BACKEND=postgresql`; `DATABASE_URL` comes from protected shared `app.env`.
Missing credentials, connection failure, or a schema-version mismatch abort startup.
There is no file-storage fallback. The existing source continues to default to
`files` until its cutover.

Source `.env` is archived at `secrets\source\app.env`, while the launcher reads
the separate operator-prepared runtime `secrets\app.env`. Before activation,
prepare that runtime file in a secure terminal outside VS Code using the
reviewed frozen export. Retain needed service settings and add the target
database URL; exclude all keys declared in `launch.environment`. No automatic
credential merge occurs. Restrict access to the service account and
administrators. Reviewed activation checks must verify runtime-account
readability, target database identity, schema compatibility and readiness.

`001_initial.sql` creates JSONB favorites/groups/revision and owner records,
`public.solutiondeploy_schema`, and an import-provenance table. Ordered arrays
remain ordered. Updates lock the favorites singleton and condition the write on
its current revision. Existing validation, group caps, reorder restrictions,
owner salt/hash/version representation, and password checks remain in application
code. The owner CLI uses the selected storage backend.

Startup only reads schema version 1 for `site-dock`. It never creates tables or
seeds PostgreSQL. The framework checks the reviewed SQL SHA separately and owns
provisioning, restricted runtime versus migration identities, custom-format
backup/restore, and database isolation. Runtime DML belongs on the two app tables;
ledger/provenance should be runtime SELECT-only.

## Import procedure, pending independent review and production approval

Remote URLs must name `jimbrownhome1` and include `hostaddr=<approved-private-IPv4>`,
`sslmode=verify-full`, `sslrootcert=<URL-encoded absolute local Windows CA path>`,
and `gssencmode=disable`. Both runtime and importer explicitly connect to the
pinned IP while verifying TLS against `jimbrownhome1` using that CA and
`rejectUnauthorized=true`. Extra/duplicate query parameters and other remote
hosts or noncanonical addresses outside RFC1918 and 100.64/10 are rejected.
Framework activation compares the private pin with its exact approved registry
address. Node pg has no GSS encryption implementation;
`gssencmode=disable` is validated and omitted from the driver configuration.
Query-free loopback URLs retain existing behavior.

1. Stop and fence the old `SiteDock` task and the new runtime.
2. Produce a reviewed source tree containing `data\favorites.json` and
   `data\owner.json`, or their manifest `backups\source` target paths.
   Keep the exact paths recorded in `transfer.json`. Preserve `.bak` files and the source transfer proof under
   protected backup storage. Do not copy PID/lock/pending files into runtime state.
3. Review the exact migration/import scripts independently before executing
   anything against a database. Provision the isolated database and explicitly
   apply `001_initial.sql` with the migration identity. Existing objects are a
   conflict, never silently adopted or overwritten.
4. Build the release. Set `DATABASE_URL` through the private operator environment.
   Run from the release root only after approval:

   ```powershell
   node deploy\postgresql\import.mjs `
     --source-dir C:\Protected\snapshot `
     --expected-source-sha256 <reviewed-combined-sha256> `
     --source-index C:\Protected\snapshot\transfer.json `
     --expected-index-sha256 <reviewed-index-sha256> `
     --execute
   ```

   The required combined hash is SHA-256 over the exact favorites file bytes
   followed immediately by the exact owner file bytes. Both index arguments are
   mandatory. Before opening PostgreSQL the script checks the exact proof hash,
   source host, plan/declaration hashes, operation/fence metadata, and both matching
   `files` entries' targets, kinds, byte counts and SHA values. The approved proof
   hash binds the export to the reviewed plan and application.
   Neither credentials nor owner-record values are
   logged. The script does not load dotenv or start the app.
5. The import requires empty target tables, validates source documents, imports
   both records in one transaction, and compares JSONB document equality,
   including array order and revision. Owner hash/salt/version remain unchanged.
   It records nonsecret counts and source SHA in import provenance.
6. A failed import rolls back. Preserve failure output, keep the target fenced,
   and obtain review before retry/resume. There is no automatic overwrite.
7. Before activation, verify sign-in with the preserved owner, revision-conflict
   behavior, owner reset invalidation, API results, cross-database denial, and a
   custom-format backup restore into an approved isolated database. Implementation
   tests used fake pools only, with no database writes.

The PostgreSQL runtime never acquires the old data-directory writer lock or
rewrites its ACLs. It launches directly and drains pending request/storage work
before closing the pool. Logs, private environment files, stop requests, archived
source JSON and backup artifacts stay on disk. Sessions stay in memory and
embedded-app tokens stay in browser local storage.

Production sets `SITEDOCK_AUTH_MODE=gateway`. Cloudflare Access authenticates
public-route requests; a Tailscale Serve route can provide private access under
Tailscale ACLs. The app listens only on `127.0.0.1` and does not trust forwarded
identity headers. Set `SITEDOCK_REMOTE_ORIGINS` to the exact HTTPS origin of each
configured proxy route so host and CSRF origin checks accept the Cloudflare and
tailnet URLs. The existing `SITEDOCK_REMOTE_ORIGIN` variable remains supported.
The deployment manifest lists `https://site-dock.jimlertech.com`,
`https://sitedock.jimlertech.com`, and
`https://jimbrownhome1.tail8ad282.ts.net:8790`.
The owner record is still imported and preserved, while password login stays
available in the default `owner` mode for local use. Embedded-app tokens remain
in each browser's local storage and are never sent to SiteDock's server. Keep the
existing user-facing origin unchanged through routing cutover to preserve them;
changing the origin requires signing in to each embedded app again on each device.

After PostgreSQL accepts target writes, use compatible code rollback against the
current database. Never resume stale source JSON automatically.

## Later managed-host moves

`managedState` is empty because all structured durable state is in PostgreSQL.
The framework moves that database through its reviewed backup/restore path.
A managed move never reruns the legacy JSON importer or uses the legacy `state`
inventory. Provision runtime `app.env` separately on the destination with its
target database credentials; it is never transferred.

## Opt-in disposable integration test

After independent review of `001_initial.sql` and
`server\postgres.integration.ts`, prepare a fresh empty `sd_test_sitedock`
database in the parent's disposable PostgreSQL 18 container. Set only
`SOLUTIONDEPLOY_PG_TEST_URL` through the private environment and run
`npm run test:postgres` from this repository root.
The suite refuses other database names, non-loopback hosts and URL query
overrides; it never falls back to `DATABASE_URL`. It checks the actual database
identity and empty public schema before applying the reviewed SQL.
It tests ordered JSONB roundtrip, conflicting/concurrent revisions, rollback,
owner-password verification and version changes. It drops nothing.
Use a newly prepared empty test database for another run.

`npm run test:postgres:import` is a separate reviewed action against a newly empty
`sd_test_sitedock` database. It creates synthetic JSON/owner records and matching
`transfer.json` only under a unique repository `.run\pg-import-*` directory,
invokes the actual CLI, and verifies proof/source hash rejection before writes,
ordered favorites/groups, revision, exact owner credentials, password verification,
provenance and replay refusal. It removes only its own fixture directory and
drops no database objects. Recreate the disposable database between suites.
