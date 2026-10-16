import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { loadConfig } from './config.js';
import { readOwner, writeOwner } from './storage.js';

async function secret(prompt: string): Promise<string> {
  if (!stdin.isTTY) throw new Error('Password entry requires an interactive terminal.');
  stdout.write(prompt);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => { stdin.off('keypress', onKey); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Canceled.')); }
      else if (key.name === 'return' || key.name === 'enter') { finish(); resolve(value); }
      else if (key.name === 'backspace') value = Array.from(value).slice(0, -1).join('');
      else if (text && !/[\x00-\x1f\x7f]/.test(text) && value.length < 1024) value += text;
    };
    stdin.on('keypress', onKey);
  });
}

try {
  const action = process.argv[2];
  if (action !== 'setup' && action !== 'reset') throw new Error('Usage: node dist/server/owner.js setup|reset');
  const config = loadConfig();
  let exists = false;
  try { await readOwner(config.dataDir); exists = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (action === 'setup' && exists) throw new Error('Owner already exists. Use reset.');
  if (action === 'reset' && !exists) throw new Error('Owner does not exist. Use setup.');
  if (!stdin.isTTY) throw new Error('Owner setup/reset requires an interactive terminal.');
  const rl = createInterface({ input: stdin, output: stdout });
  const username = await rl.question('Username: ');
  rl.close();
  const password = await secret('Password (12 to 1024 characters): ');
  const confirmation = await secret('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  await writeOwner(config.dataDir, username, password, { setup: action === 'setup' });
  console.log('Owner saved. Existing sessions are invalid on their next request.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Owner setup failed.');
  process.exitCode = 1;
}
