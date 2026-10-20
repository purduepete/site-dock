import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { test } from 'node:test';
import { Client } from 'pg';
import { postgresConnection } from './postgresConnection.js';

const remote =
    'postgresql://test_user:test_password@jimbrownhome1/site_dock?hostaddr=192.168.2.14&sslmode=verify-full&sslrootcert=C%3A%5CProtected%5Cpg-ca.pem&gssencmode=disable';
test('actual pg client pins TCP address and verified DNS TLS identity without connecting', () => {
    const config = postgresConnection(remote, () => rootCertificates[0]);
    const client = new Client(config);
    assert.equal(client.host, '192.168.2.14');
    assert.deepEqual(client.ssl, { ca: rootCertificates[0], servername: 'jimbrownhome1', rejectUnauthorized: true });
    assert.equal(config.connectionString, undefined);
    assert.equal(config.database, 'site_dock');
    for (const address of ['10.2.3.4', '172.16.2.3', '100.64.2.3']) {
        assert.equal(
            postgresConnection(remote.replace('192.168.2.14', address), () => rootCertificates[0]).host,
            address
        );
    }
});
test('loopback behavior remains and remote policy bypasses fail before network access', () => {
    const local = 'postgresql://test:password@127.0.0.1:45678/sd_test_sitedock';
    assert.deepEqual(postgresConnection(local), { connectionString: local });
    for (const invalid of [
        remote.replace('192.168.2.14', '8.8.8.8'),
        remote.replace('verify-full', 'require'),
        remote.replace('jimbrownhome1/', 'public.example/'),
        `${remote}&host=evil`,
        `${remote}&hostaddr=192.168.2.14`,
        remote.replace('gssencmode=disable', 'gssencmode=prefer'),
        remote.replace('C%3A%5CProtected%5Cpg-ca.pem', 'relative.pem'),
        remote.replace('C%3A%5CProtected%5Cpg-ca.pem', '%5C%5Cserver%5Cshare%5Cca.pem'),
        remote.replace('hostaddr=192.168.2.14', 'hostaddr=192.168.2.14,192.168.2.15'),
        ...['127.0.0.1', '224.0.0.1', '192.168.02.14', '192.168.2.999', '100.128.0.1', '172.32.0.1', '169.254.1.1'].map(
            (address) => remote.replace('192.168.2.14', address)
        ),
    ])
        assert.throws(() => postgresConnection(invalid, () => rootCertificates[0]));
    assert.throws(() => postgresConnection(remote, () => 'invalid certificate'), /CA certificate/);
    assert.throws(
        () =>
            postgresConnection(remote, () => {
                throw new Error('private path');
            }),
        /CA certificate/
    );
});
