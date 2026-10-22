import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadConfiguration } from '../dist/config/environment.js';

test('readiness times out when an established database connection silently stops forwarding', {
  timeout: 20000,
}, async () => {
  const configuration = loadConfiguration();
  const databaseUrl = new URL(configuration.databaseUrl);
  const databasePort = Number(databaseUrl.port || 5432);
  assert.equal(databaseUrl.hostname, '127.0.0.1', 'This test requires the local database.');
  assert.equal(databaseUrl.search, '', 'This test requires a canonical local database URL.');
  let forwarding = true;
  const sockets = new Set();
  let child;
  let childLog = '';

  const proxy = net.createServer((downstream) => {
    const upstream = net.createConnection({
      host: '127.0.0.1',
      port: databasePort,
    });
    for (const socket of [downstream, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    }
    downstream.on('data', (data) => {
      if (forwarding) upstream.write(data);
    });
    upstream.on('data', (data) => downstream.write(data));
    downstream.on('error', () => upstream.destroy());
    upstream.on('error', () => downstream.destroy());
    downstream.on('close', () => upstream.destroy());
    upstream.on('close', () => downstream.destroy());
  });

  try {
    await new Promise((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const reservation = net.createServer();
    await new Promise((resolve, reject) => {
      reservation.once('error', reject);
      reservation.listen(0, '127.0.0.1', resolve);
    });
    const apiPort = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    databaseUrl.port = String(proxy.address().port);

    child = spawn(process.execPath, [fileURLToPath(new URL('../dist/main.js', import.meta.url))], {
      env: { ...process.env, DATABASE_URL: databaseUrl.href, API_PORT: String(apiPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    for (const output of [child.stdout, child.stderr]) {
      output.on('data', (data) => { childLog = (childLog + data.toString()).slice(-4000); });
    }
    const origin = `http://127.0.0.1:${apiPort}`;
    let connected = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      assert.equal(child.exitCode, null, 'The test API exited before readiness.');
      try {
        const response = await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(500) });
        if (response.status === 200) {
          connected = true;
          break;
        }
      } catch {
        // Wait for this test's API to initialize its connection through the proxy.
      }
      await delay(100);
    }
    const diagnostic = childLog
      .replaceAll(databaseUrl.href, '[redacted URL]')
      .replaceAll(configuration.databaseUrl, '[redacted URL]')
      .replaceAll(decodeURIComponent(databaseUrl.password), '[redacted password]');
    assert.ok(connected, `The test API could not connect through the local proxy. ${diagnostic}`);

    // Leave TCP sockets established but discard outbound SQL. PostgreSQL never
    // receives the query, so its statement_timeout cannot rescue this request.
    forwarding = false;
    const started = performance.now();
    const response = await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(8000) });
    assert.equal(response.status, 503);
    assert.ok(performance.now() - started < 7500, 'Readiness did not fail within its bounded wait.');
    assert.equal((await fetch(`${origin}/api/health`)).status, 200);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});
