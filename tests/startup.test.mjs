import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { test } from 'node:test';

const powershell = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
const fixtureSource = `
const fs = require('node:fs');
const http = require('node:http');
const attempt = Number(fs.existsSync('data/attempts') ? fs.readFileSync('data/attempts', 'utf8') : 0) + 1;
fs.writeFileSync('data/attempts', String(attempt));
const mode = fs.readFileSync('data/mode', 'utf8');
console.log('stdout attempt ' + attempt);
console.error('stderr attempt ' + attempt);
if (mode === 'fail' || (mode === 'fail-once' && attempt === 1)) process.exit(7);
fs.writeFileSync('data/server.lock', String(process.pid));
if (mode === 'no-listener') setInterval(() => {}, 1000);
else http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: mode !== 'unhealthy' }));
}).listen(Number(process.env.SITEDOCK_PORT), '127.0.0.1');
`;

async function fixture(t, mode = 'healthy') {
    const root = await mkdtemp(join(tmpdir(), 'sitedock-startup-'));
    const childPids = new Set();
    t.after(async () => {
        try {
            const pid = Number(await readFile(join(root, 'data', 'server.pid'), 'utf8'));
            if (pid !== process.pid) childPids.add(pid);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        for (const pid of childPids) {
            try {
                process.kill(pid);
            } catch (error) {
                if (error.code !== 'ESRCH') throw error;
            }
        }
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    });
    for (const directory of ['scripts', 'data', join('dist', 'server')]) {
        await mkdir(join(root, directory), { recursive: true });
    }
    for (const name of ['start-hidden.ps1', 'common.ps1', 'stop.ps1', 'start-task.vbs']) {
        await copyFile(resolve('scripts', name), join(root, 'scripts', name));
    }
    const listener = createServer();
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
    await writeFile(join(root, '.env'), `SITEDOCK_PORT=${port}\n`);
    await writeFile(join(root, 'data', 'mode'), mode);
    await writeFile(join(root, 'dist', 'server', 'main.js'), fixtureSource);
    return {
        root,
        port,
        childPids,
        read: (name) => readFile(join(root, 'data', name), 'utf8'),
        write: (name, text) => writeFile(join(root, 'data', name), text),
        async run(extra = []) {
            return runPowerShell([
                '-File',
                join(root, 'scripts', 'start-hidden.ps1'),
                '-StartupTimeoutSeconds',
                '2',
                '-RetryDelaySeconds',
                '0',
                ...extra,
            ]);
        },
    };
}

function runCommand(executable, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { windowsHide: true });
        let output = '';
        child.stdout.on('data', (data) => {
            output += data;
        });
        child.stderr.on('data', (data) => {
            output += data;
        });
        child.on('error', reject);
        child.on('exit', (code) => resolve({ code, output }));
    });
}

function runPowerShell(args) {
    return runCommand(powershell, ['-NoProfile', '-NonInteractive', ...args]);
}

test('Windows startup and recovery', { skip: process.platform !== 'win32', timeout: 180_000 }, async (t) => {
    await t.test('hidden GUI wrapper returns startup success and failure codes', async (t) => {
        const f = await fixture(t);
        const wrapper = join(f.root, 'scripts', 'start-task.vbs');
        const host = join(process.env.WINDIR, 'System32', 'wscript.exe');
        const result = await runCommand(host, ['//B', '//Nologo', wrapper, powershell]);
        assert.equal(result.code, 0, result.output);
        assert.match(await f.read('startup.log'), /Healthy on port/);
        const failed = await fixture(t, 'fail');
        const failure = await runCommand(host, [
            '//B',
            '//Nologo',
            join(failed.root, 'scripts', 'start-task.vbs'),
            powershell,
        ]);
        assert.notEqual(failure.code, 0, failure.output);
        assert.equal(await failed.read('attempts'), '3');
        assert.match(await failed.read('startup.log'), /STARTUP FAILED/);
    });
    await t.test('starts healthy, preserves prior logs, and leaves healthy process unchanged', async (t) => {
        const f = await fixture(t);
        await f.write('server.log', 'previous stdout');
        await f.write('server.err.log', 'previous stderr');
        const result = await f.run();
        assert.equal(result.code, 0, result.output);
        assert.equal(await f.read('server.log.1'), 'previous stdout');
        assert.equal(await f.read('server.err.log.1'), 'previous stderr');
        const pid = (await f.read('server.pid')).trim();
        const log = await f.read('startup.log');
        assert.match(log, /Healthy on port/);
        assert.equal((await f.run()).code, 0);
        assert.equal((await f.read('server.pid')).trim(), pid);
        assert.equal(await f.read('startup.log'), log);
        const response = await fetch(`http://127.0.0.1:${f.port}/api/health`);
        assert.deepEqual(await response.json(), { ok: true });
    });
    await t.test('recovers stale lock without killing an unrelated process', async (t) => {
        const f = await fixture(t);
        await f.write('server.lock', String(process.pid));
        await f.write('server.pid', '99999999');
        const result = await f.run();
        assert.equal(result.code, 0, result.output);
        assert.notEqual(Number(await f.read('server.pid')), process.pid);
        assert.match(await f.read('startup.log'), /Removing stale server.lock/);
    });
    await t.test('retries an immediate crash and retains its diagnostic output', async (t) => {
        const f = await fixture(t, 'fail-once');
        const result = await f.run();
        assert.equal(result.code, 0, result.output);
        assert.equal(await f.read('attempts'), '2');
        assert.match(await f.read('server.err.log.1'), /stderr attempt 1/);
        assert.match(await f.read('startup.log'), /Attempt 1 failed/);
    });
    await t.test('permanent failures exit nonzero after exactly 3 attempts', async (t) => {
        const f = await fixture(t, 'fail');
        const result = await f.run();
        assert.notEqual(result.code, 0, result.output);
        assert.equal(await f.read('attempts'), '3');
        assert.match(await f.read('startup.log'), /STARTUP FAILED/);
        assert.match(await f.read('server.err.log.2'), /stderr attempt 1/);
        await assert.rejects(f.read('server.pid'), { code: 'ENOENT' });
    });
    await t.test('recovers a later crash on the next invocation', async (t) => {
        const f = await fixture(t);
        assert.equal((await f.run()).code, 0);
        const previousPid = Number(await f.read('server.pid'));
        process.kill(previousPid);
        await pause(300);
        const result = await f.run();
        assert.equal(result.code, 0, result.output);
        assert.notEqual(Number(await f.read('server.pid')), previousPid);
        assert.equal(await f.read('attempts'), '2');
    });
    await t.test('replaces a live unhealthy process and bounds retained logs', async (t) => {
        const f = await fixture(t);
        assert.equal((await f.run()).code, 0);
        const previousPid = Number(await f.read('server.pid'));
        f.childPids.add(previousPid);
        // The running fixture retains its mode; the replacement reads the new value.
        await f.write('mode', 'unhealthy');
        process.kill(previousPid);
        const unhealthy = spawn(process.execPath, ['--env-file=.env', 'dist\\server\\main.js'], {
            cwd: f.root,
            windowsHide: true,
            stdio: 'ignore',
        });
        f.childPids.add(unhealthy.pid);
        await f.write('server.pid', String(unhealthy.pid));
        for (let attempt = 0; attempt < 30; attempt++) {
            try {
                if (Number(await f.read('server.lock')) === unhealthy.pid) break;
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            await pause(100);
        }
        await f.write('mode', 'healthy');
        for (let index = 1; index <= 5; index++) await f.write(`server.err.log.${index}`, `old ${index}`);
        const result = await f.run();
        assert.equal(result.code, 0, result.output);
        assert.match(await f.read('startup.log'), /Recovering unhealthy SiteDock PID/);
        assert.notEqual(Number(await f.read('server.pid')), unhealthy.pid);
        assert.equal(await f.read('server.err.log.5'), 'old 4');
        await assert.rejects(f.read('server.err.log.6'), { code: 'ENOENT' });
    });
    await t.test('a different listener cannot satisfy startup health', async (t) => {
        const f = await fixture(t, 'no-listener');
        const listener = createHttpServer((request, response) => {
            response.setHeader('content-type', 'application/json');
            response.end('{"ok":true}');
        });
        await new Promise((resolve) => listener.listen(f.port, '127.0.0.1', resolve));
        t.after(
            () =>
                new Promise((resolve) => {
                    listener.closeAllConnections();
                    listener.close(resolve);
                })
        );
        const result = await f.run(['-MaxAttempts', '1']);
        assert.notEqual(result.code, 0, result.output);
        assert.match(await f.read('startup.log'), /failed its health check within 2 seconds/);
        await assert.rejects(f.read('server.pid'), { code: 'ENOENT' });
    });
    await t.test('intentional stop disables recovery before stopping Node and removes PID files', async (t) => {
        const f = await fixture(t);
        assert.equal((await f.run()).code, 0);
        const stop = join(f.root, 'scripts', 'stop.ps1').replaceAll("'", "''");
        const script = `
      $ErrorActionPreference = 'Stop'
      $calls = [System.Collections.Generic.List[string]]::new()
      function Get-ScheduledTask { [pscustomobject]@{ TaskName = 'SiteDock' } }
      function Disable-ScheduledTask { $calls.Add('disable') }
      function Stop-ScheduledTask { $calls.Add('stop') }
      & '${stop}'
      if (($calls -join ',') -ne 'disable,stop') { throw 'Recovery was not disabled first' }
    `;
        const result = await runPowerShell(['-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
        assert.equal(result.code, 0, result.output);
        await assert.rejects(f.read('server.pid'), { code: 'ENOENT' });
        await assert.rejects(f.read('server.lock'), { code: 'ENOENT' });
    });
    await t.test('watchdog repeats indefinitely, retries failures, and preserves the logon identity', async () => {
        const common = resolve('scripts', 'common.ps1').replaceAll("'", "''");
        const script = `
      $ErrorActionPreference = 'Stop'
      . '${common}'
      function Get-ScheduledTask { [pscustomobject]@{ Triggers = @(
        [pscustomobject]@{ UserId = 'owner'; CimClass = @{ CimClassName = 'MSFT_TaskLogonTrigger' } },
        [pscustomobject]@{ CimClass = @{ CimClassName = 'MSFT_TaskTimeTrigger' } }
      ) } }
      function New-ScheduledTaskTrigger {
        param([switch]$Once, $At, $RepetitionInterval)
        if ($RepetitionInterval.TotalMinutes -ne 1) { throw 'Wrong interval' }
        [pscustomobject]@{ Watchdog = $true }
      }
      function New-ScheduledTaskSettingsSet {
        param([switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries,
          $ExecutionTimeLimit, $MultipleInstances, [switch]$StartWhenAvailable, $RestartCount, $RestartInterval)
        if ($RestartCount -ne 3 -or $RestartInterval.TotalMinutes -ne 1 -or
          $ExecutionTimeLimit.TotalMinutes -ne 3 -or $MultipleInstances -ne 'IgnoreNew' -or
          -not $StartWhenAvailable) { throw 'Wrong settings' }
        @{}
      }
      function New-SiteDockTaskAction { [pscustomobject]@{ HiddenWrapper = $true } }
      function Set-ScheduledTask {
        param($TaskName, $Action, $Trigger, $Settings)
        if ($Trigger.Count -ne 2 -or $Trigger[0].UserId -ne 'owner' -or
          -not $Trigger[1].Watchdog -or -not $Action.HiddenWrapper) { throw 'Wrong triggers or action' }
      }
      Set-SiteDockWatchdog
    `;
        const result = await runPowerShell(['-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
        assert.equal(result.code, 0, result.output);
    });
});
