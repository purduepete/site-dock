import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { sourceEntry, validateTransferProof, verifySourceBytes } from './source-proof.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const data = Buffer.from('synthetic fixture only');
const makeProof = overrides => ({
  planHash: 'a'.repeat(64), stateDeclarationSHA256: 'b'.repeat(64),
  operationId: 'test-export', sourceHost: 'jimbrownhome', fence: { stopped: true },
  directories: [], files: [{ target: 'backups\\source\\owner.json', kind: 'secret', bytes: data.length, sha256: sha(data) }],
  ...overrides,
});
const validate = proof => {
  const bytes = Buffer.from(JSON.stringify(proof));
  return validateTransferProof(bytes, sha(bytes), 'site-dock');
};

test('transfer proof binds exact bytes, metadata and owner target without database access', () => {
  const proof = validate(makeProof());
  const entry = sourceEntry(proof, 'owner.json', ['secret']);
  verifySourceBytes(entry, data);
  assert.throws(() => verifySourceBytes(entry, Buffer.from('changed')), /do not match/);
  assert.throws(() => validateTransferProof(Buffer.from('{}'), 'c'.repeat(64), 'site-dock'), /SHA-256 mismatch/);
  assert.throws(() => validate(makeProof({ sourceHost: 'another-host' })), /metadata/);
  assert.throws(() => validate(makeProof({ appId: 'ferry-tracker' })), /metadata/);
  assert.throws(() => validate(makeProof({ fence: null })), /metadata/);
  assert.throws(() => sourceEntry(makeProof({ files: [{ ...entry, target: '..\\owner.json' }] }), 'owner.json', ['secret']), /exactly one/);
  assert.throws(() => sourceEntry(makeProof({ files: [entry, entry] }), 'owner.json', ['secret']), /exactly one/);
  assert.throws(() => sourceEntry(makeProof({ files: [{ ...entry, kind: 'file' }] }), 'owner.json', ['secret']), /Invalid/);
});
