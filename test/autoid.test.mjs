import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import jsQR from 'jsqr';
import { care, dateAt } from '../src/care.mjs';
import { createApp } from '../src/server.mjs';

const qrRequire = createRequire(import.meta.resolve('qrcode'));
const { PNG } = qrRequire('pngjs');
const today = '2026-11-11';
const day = 86_400_000;

function documents(offset) {
  return ['registration', 'insurance', 'emissions'].map(type => ({ type, expiry: dateAt(Date.parse(today) + offset * day) }));
}

test('score respects document and service boundaries and missing records', () => {
  const vehicle = { last_service_km: 1000, interval_km: 5000, odometer: 5499 };
  assert.equal(care(vehicle, documents(31), today).score, 100);
  assert.equal(care({ ...vehicle, odometer: 5500 }, documents(30), today).score, 50);
  assert.equal(care({ ...vehicle, odometer: 5999 }, documents(0), today).score, 50);
  assert.equal(care({ ...vehicle, odometer: 6000 }, documents(-1), today).score, 0);
  assert.equal(care(vehicle, [], today).score, 40);
  assert.equal(care({ ...vehicle, odometer: 6001 }, [], today).service.remaining, -1);
});

async function reservePort() {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('HTTP workflows and persisted owner data', async t => {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const directory = await mkdtemp(join(tmpdir(), 'autoid-test-'));
  const connectionString = process.env.AUTOID_TEST_DATABASE_URL;
  const databasePath = join(directory, 'test.sqlite');
  let clock = Date.parse(today);
  let server;
  async function start(demo = true) {
    server = createApp({ origin, databasePath, connectionString, demo, now: () => clock });
    await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  }
  async function stop() {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  await start();
  async function request(path, { cookie, body, expected = 200, from = origin } = {}) {
    const headers = { Connection: 'close' };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) {
      headers.Origin = from;
      headers['Content-Type'] = 'application/json';
    }
    const result = await fetch(origin + '/api' + path, {
      headers, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = /^(image\/|application\/pdf)/.test(result.headers.get('Content-Type'))
      ? Buffer.from(await result.arrayBuffer()) : await result.json();
    assert.equal(result.status, expected, `${path}: ${JSON.stringify(Buffer.isBuffer(payload) ? 'PNG' : payload)}`);
    return { result, payload, cookie: result.headers.get('Set-Cookie')?.split(';')[0] };
  }
  const account = { name: 'Test Owner', email: 'owner@example.test', password: 'a-long-passphrase' };
  const sample = { name: 'Test Sedan', plate: 'ka 01 ab 1234', model_year: 2022, odometer: 5000, last_service_km: 0, interval_km: 5000 };
  let owner, other, vehicle, originalKey, privateNotification;
  await t.test('registration, session cookie and owner-only vehicle access', async () => {
    await request('/dashboard', { expected: 401 });
    await request('/register', { body: account, from: 'https://foreign.example', expected: 403 });
    const registered = await request('/register', { body: account });
    owner = registered.cookie;
    assert.match(registered.result.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax/);
    await request('/register', { body: account, expected: 409 });
    await request('/login', { body: { ...account, password: 'wrong-passphrase' }, expected: 401 });
    other = (await request('/register', { body: { ...account, email: 'other@example.test' } })).cookie;
    await request('/vehicles', { cookie: owner, body: { ...sample, odometer: -1 }, expected: 400 });
    const created = await request('/vehicles', { cookie: owner, body: sample, expected: 201 });
    const dashboard = (await request('/dashboard', { cookie: owner })).payload;
    vehicle = dashboard.vehicles[0];
    originalKey = vehicle.qr;
    assert.equal(vehicle.id, created.payload.id);
    assert.equal(vehicle.plate, 'KA 01 AB 1234');
    assert.equal((await request('/dashboard', { cookie: other })).payload.vehicles.length, 0);
    await request(`/vehicles/${vehicle.id}/qr.png`, { cookie: other, expected: 404 });
    await request(`/vehicles/${vehicle.id}/documents`, { cookie: other, body: {}, expected: 404 });
    await request('/vehicles', { cookie: owner, body: sample, expected: 409 });
  });
  await t.test('private document validation and deduplicated reminder transitions', async () => {
    const path = `/vehicles/${vehicle.id}/documents`;
    const record = { type: 'insurance', reference: 'PRIVATE-001', expiry: '2026-11-12' };
    await request(path, { cookie: owner, body: { ...record, expiry: '2026-02-30' }, expected: 400 });
    await request(path, { cookie: owner, body: record });
    const first = (await request('/dashboard', { cookie: owner })).payload;
    const again = (await request('/dashboard', { cookie: owner })).payload;
    assert.equal(first.vehicles[0].documents[0].reference, 'PRIVATE-001');
    assert.equal(first.vehicles[0].score, 10);
    assert.equal(first.notifications.length, 2);
    assert.equal(again.notifications.length, 2);
    clock += 2 * day;
    const later = (await request('/dashboard', { cookie: owner })).payload;
    assert.equal(later.vehicles[0].score, 0);
    assert.equal(later.notifications.filter(item => item.kind === 'document').length, 2);
  });
  await t.test('generated QR decodes to a minimal public profile and delivers private reports', async () => {
    const image = (await request(`/vehicles/${vehicle.id}/qr.png`, { cookie: owner })).payload;
    const png = PNG.sync.read(image);
    assert.equal(jsQR(Uint8ClampedArray.from(png.data), png.width, png.height).data, origin + '/p/' + originalKey);
    assert.deepEqual((await request('/p/' + originalKey)).payload, { name: sample.name, model_year: sample.model_year });
    await request(`/p/${originalKey}/report`, { body: { kind: 'emergency', message: 'x' }, expected: 400 });
    for (const kind of ['parking', 'emergency']) {
      await request(`/p/${originalKey}/report`, { body: { kind, message: 'Please check the rear of the vehicle.' }, expected: 201 });
    }
    const inbox = (await request('/dashboard', { cookie: owner })).payload;
    privateNotification = inbox.notifications.find(item => item.kind === 'emergency');
    assert.equal(privateNotification.body, 'Please check the rear of the vehicle.');
    assert.ok(inbox.notifications.some(item => item.kind === 'parking'));
    assert.equal((await request('/dashboard', { cookie: other })).payload.unread, 0);
    await request('/notifications/' + privateNotification.id, { cookie: other, body: {}, expected: 404 });
    await request('/notifications/' + privateNotification.id, { cookie: owner, body: {} });
    const updated = (await request('/dashboard', { cookie: owner })).payload;
    assert.equal(updated.notifications.find(item => item.id === privateNotification.id).seen, 1);
  });
  await t.test('PDF validation, private access and removal', async () => {
    const path = `/vehicles/${vehicle.id}/files/insurance`;
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    const attachment = { name: 'policy.pdf', content: bytes.toString('base64'), reference: 'PRIVATE-001', expiry: '2027-01-01' };
    await request(path, { cookie: owner, body: { ...attachment, content: Buffer.from('%PDF-invalid').toString('base64') }, expected: 400 });
    await request(path, { cookie: other, body: attachment, expected: 404 });
    await request(path, { cookie: owner, body: attachment });
    await request(path, { expected: 401 });
    await request(path, { cookie: other, expected: 404 });
    const download = await request(path, { cookie: owner });
    assert.deepEqual(download.payload, bytes);
    assert.match(download.result.headers.get('Content-Disposition'), /^attachment/);
    const snapshot = (await request('/dashboard', { cookie: owner })).payload.vehicles[0];
    assert.equal(snapshot.files[0].name, 'policy.pdf');
    assert.equal(snapshot.files[0].bytes, undefined);
    const replacement = { ...attachment, name: 'renewed-policy.pdf' };
    await request(path, { cookie: owner, body: replacement });
    const renewed = await request(path, { cookie: owner });
    assert.match(renewed.result.headers.get('Content-Disposition'), /renewed-policy\.pdf/);
    await request(`/vehicles/${vehicle.id}/files/other`, { cookie: owner, body: attachment });
    await request(path, { cookie: owner, body: { action: 'remove' } });
    await request(path, { cookie: owner, expected: 404 });
  });
  await t.test('parking limits leave a separate emergency allowance and inbox filter', async () => {
    const path = `/p/${originalKey}/report`;
    const body = { kind: 'parking', message: 'Example parking report.' };
    for (let i = 0; i < 7; i++) await request(path, { body, expected: 201 });
    await request(path, { body, expected: 429 });
    await request(path, { body: { ...body, kind: 'emergency' }, expected: 201 });
    const filtered = (await request('/inbox?emergency=true', { cookie: owner })).payload;
    assert.equal(filtered.items.length, 2);
    assert.ok(filtered.items.every(entry => entry.kind === 'emergency'));
  });
  await t.test('service update, QR rotation and revocation', async () => {
    const prefix = `/vehicles/${vehicle.id}`;
    await request(prefix + '/care', { cookie: owner, body: { odometer: 4999, last_service_km: 0, interval_km: 5000 }, expected: 400 });
    await request(prefix + '/care', { cookie: owner, body: { odometer: 5100, last_service_km: 5100, interval_km: 5000, serviced_on: today } });
    await request(prefix + '/qr', { cookie: other, body: { action: 'replace' }, expected: 404 });
    await request(prefix + '/qr', { cookie: owner, body: { action: 'replace' } });
    const updated = (await request('/dashboard', { cookie: owner })).payload.vehicles[0];
    assert.equal(updated.service.remaining, 5000);
    assert.deepEqual(updated.serviceHistory[0], { mileage: 5100, serviced_on: today });
    assert.notEqual(updated.qr, originalKey);
    await request('/p/' + originalKey, { expected: 404 });
    await request('/p/' + updated.qr);
    await request(prefix + '/qr', { cookie: owner, body: { action: 'revoke' } });
    await request('/p/' + updated.qr, { expected: 404 });
    await request(`/p/${updated.qr}/report`, { body: { kind: 'parking', message: 'This link is retired.' }, expected: 404 });
    await request(prefix + '/qr.png', { cookie: owner, expected: 404 });
  });
  await t.test('private sample sessions, logout and restart persistence', async () => {
    if (!connectionString) {
      const sampleOne = (await request('/demo', { body: {} })).cookie;
      const sampleTwo = (await request('/demo', { body: {} })).cookie;
      const one = (await request('/dashboard', { cookie: sampleOne })).payload;
      const two = (await request('/dashboard', { cookie: sampleTwo })).payload;
      assert.equal(one.vehicles[0].score, 70);
      assert.notEqual(one.vehicles[0].qr, two.vehicles[0].qr);
    }
    const secondSession = (await request('/login', { body: account })).cookie;
    await request('/sessions/revoke-others', { cookie: owner, body: {} });
    await request('/dashboard', { cookie: secondSession, expected: 401 });
    await request('/logout', { cookie: owner, body: {} });
    await request('/dashboard', { cookie: owner, expected: 401 });
    await stop();
    await start(false);
    await request('/demo', { body: {}, expected: 404 });
    const signedBackIn = (await request('/login', { body: account })).cookie;
    const data = (await request('/dashboard', { cookie: signedBackIn })).payload;
    assert.equal(data.vehicles[0].qr, null);
    assert.equal(data.vehicles[0].documents[0].reference, 'PRIVATE-001');
    const download = await request(`/vehicles/${vehicle.id}/files/other`, { cookie: signedBackIn });
    assert.equal(download.payload.subarray(0, 5).toString(), '%PDF-');
    assert.equal(data.notifications.find(item => item.id === privateNotification.id).seen, 1);
  });
  await t.test('single-use recovery code resets password and revokes sessions', async () => {
    const first = (await request('/login', { body: account })).cookie;
    const codePath = '/sessions/recovery-code';
    await request(codePath, { cookie: first, body: { password: 'wrong-passphrase' }, expected: 400 });
    const { code } = (await request(codePath, { cookie: first, body: { password: account.password } })).payload;
    const change = { email: account.email, code, password: 'replacement-password' };
    await request('/recover', { body: change });
    await request('/recover', { body: change, expected: 401 });
    await request('/dashboard', { cookie: first, expected: 401 });
    await request('/login', { body: account, expected: 401 });
    await request('/login', { body: { ...account, password: change.password } });
  });

});
