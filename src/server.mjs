import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { openDatabase } from './database.mjs';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { care, dateAt, documentTypes } from './care.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const derive = promisify(scrypt);
const dayMs = 86_400_000;
const token = () => randomBytes(24).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const dummyHash = '00000000000000000000000000000000:' + '0'.repeat(128);
const assets = new Map([
  ['/app.js', ['public/app.js', 'text/javascript']],
  ['/styles.css', ['public/styles.css', 'text/css']],
  ['/vehicle.jpg', ['public/vehicle.jpg', 'image/jpeg']],
  ['/qr-decoder.js', ['node_modules/jsqr/dist/jsQR.js', 'text/javascript']]
]);
const reportTypes = { parking: 'Parking issue', emergency: 'Emergency concern' };
const fileLimit = 2 * 1024 * 1024;
const saveDocument = `INSERT INTO documents VALUES (?, ?, ?, ?) ON CONFLICT(vehicle_id, type)
  DO UPDATE SET reference=excluded.reference, expiry=excluded.expiry`;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function requireValue(condition, message, status = 400) {
  if (!condition) throw new HttpError(status, message);
}
function field(value, label, max, min = 1) {
  requireValue(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max,
    `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
function number(value, label, min, max) {
  requireValue(Number.isInteger(value) && value >= min && value <= max, `${label} must be a whole number from ${min} to ${max}.`);
  return value;
}
function emailField(value) {
  const email = field(value, 'Email', 254).toLowerCase();
  requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
  return email;
}
function expiryField(value) {
  requireValue(typeof value === 'string' && /^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && dateAt(Date.parse(value)) === value, 'Enter a valid expiry date.');
  return value;
}
async function pdfFile(data) {
  const name = field(data.name, 'Filename', 120);
  requireValue(/\.pdf$/i.test(name) && !/[\\/\u0000-\u001f\u007f]/.test(name), 'Choose a PDF with a valid filename.');
  requireValue(typeof data.content === 'string' && data.content.length <= Math.ceil(fileLimit / 3) * 4,
    'Choose a PDF up to 2 MB.', 413);
  const bytes = Buffer.from(data.content, 'base64');
  requireValue(bytes.length <= fileLimit, 'Choose a PDF up to 2 MB.', 413);
  requireValue(bytes.toString('base64') === data.content && bytes.subarray(0, 5).toString() === '%PDF-',
    'That file is not a valid PDF.');
  try {
    const pdf = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
    if (pdf.getPageCount() < 1) throw new Error('Empty document');
  } catch {
    throw new HttpError(400, 'Choose a readable PDF without password protection.');
  }
  return { name, bytes };
}
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
}
function passwordField(password) {
  requireValue(typeof password === 'string' && password.length >= 10 && password.length <= 128,
    'Password must contain 10–128 characters.');
  return password;
}
async function jsonBody(req, limit = 8192) {
  requireValue(req.headers['content-type']?.split(';')[0] === 'application/json', 'Send JSON data.', 415);
  requireValue(Number(req.headers['content-length'] || 0) <= limit, 'Request is too large.', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    requireValue(size <= limit, 'Request is too large.', 413);
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks)); } catch { throw new HttpError(400, 'Invalid JSON.'); }
  requireValue(data && typeof data === 'object' && !Array.isArray(data), 'Expected a JSON object.');
  return data;
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

export function createApp({ databasePath = ':memory:', origin = 'http://localhost:3000', demo = false, now = Date.now, connectionString, trustVercel = false } = {}) {
  const publicUrl = new URL(origin);
  requireValue(['http:', 'https:'].includes(publicUrl.protocol) && !publicUrl.username && !publicUrl.password
    && publicUrl.href === publicUrl.origin + '/', 'PUBLIC_ORIGIN must be an HTTP(S) origin without a path.');
  origin = publicUrl.origin;
  const secure = publicUrl.protocol === 'https:';
  const db = openDatabase(databasePath, connectionString);
  const { get, all, run } = db;
  const demoAvailable = demo && !connectionString;
  function clientKey(req) {
    const forwarded = req.headers['x-vercel-forwarded-for'];
    return digest(trustVercel && typeof forwarded === 'string' && isIP(forwarded)
      ? forwarded : req.socket.remoteAddress || 'unknown');
  }
  async function throttle(key, max, duration) {
    const time = now();
    // The counter and check share one atomic statement across hosted instances.
    const result = await run(`INSERT INTO rate_limits VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        hits=CASE WHEN rate_limits.expires <= ? THEN 1 ELSE rate_limits.hits+1 END,
        expires=CASE WHEN rate_limits.expires <= ? THEN excluded.expires ELSE rate_limits.expires END
      WHERE rate_limits.expires <= ? OR rate_limits.hits < ?`, key, time + duration, time, time, time, max);
    requireValue(result.changes, 'Too many attempts. Try again later.', 429);
    if (Math.random() < 0.02) await run('DELETE FROM rate_limits WHERE expires <= ?', time);
  }
  function cookie(res, value, age) {
    res.setHeader('Set-Cookie', `autoid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`);
  }
  async function signIn(res, id, password) {
    const value = token();
    await run('DELETE FROM sessions WHERE expires <= ?', now());
    const writes = [];
    if (password) {
      writes.push(['UPDATE users SET password=password WHERE id=? AND password=?', [id, password],
        changes => requireValue(changes, 'Email or password is incorrect.', 401)]);
    }
    writes.push(['INSERT INTO sessions VALUES (?, ?, ?)', [digest(value), id, now() + dayMs * 7]]);
    await db.batch(writes);
    cookie(res, value, 604800);
  }
  function getSession(req) {
    const value = /(?:^|;\s*)autoid=([\w-]{32})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    return value ? digest(value) : '';
  }
  async function ownerVehicle(id, ownerId) {
    const vehicle = await get('SELECT * FROM vehicles WHERE id = ? AND owner_id = ?', id, ownerId);
    requireValue(vehicle, 'Vehicle not found.', 404);
    return vehicle;
  }
  function notify(id, kind, title, body, key = null) {
    return run('INSERT INTO notifications (vehicle_id, kind, title, body, created, dedupe) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(vehicle_id, dedupe) DO NOTHING',
      id, kind, title, body, now(), key);
  }
  async function dashboard(user) {
    const today = dateAt(now());
    const vehicles = [];
    for (const { owner_id, ...vehicle } of await all('SELECT * FROM vehicles WHERE owner_id = ? ORDER BY id', user.id)) {
      const documents = await all('SELECT type, reference, expiry FROM documents WHERE vehicle_id = ?', vehicle.id);
      const result = care(vehicle, documents, today);
      for (const check of result.checks) {
        const document = documents.find(item => item.type === check.type);
        if (document && ['Due soon', 'Expired'].includes(check.status)) {
          await notify(vehicle.id, 'document', `${check.label} · ${check.status.toLowerCase()}`,
            `Expiry date: ${document.expiry}. Update this record after renewal.`,
            `${check.type}:${document.expiry}:${check.status}`);
        }
      }
      if (result.service.status !== 'On track') {
        const due = vehicle.last_service_km + vehicle.interval_km;
        await notify(vehicle.id, 'service', `Scheduled service · ${result.service.status.toLowerCase()}`,
          `Service threshold: ${due.toLocaleString('en-IN')} km.`, `service:${due}:${result.service.status}`);
      }
      const files = await all('SELECT type, name, uploaded FROM document_files WHERE vehicle_id=?', vehicle.id);
      const serviceHistory = await all('SELECT mileage, serviced_on FROM service_events WHERE vehicle_id=? ORDER BY serviced_on DESC, id DESC LIMIT 20', vehicle.id);
      vehicles.push({ ...vehicle, documents, files, serviceHistory, ...result });
    }
    const notifications = await all(`SELECT n.id, n.vehicle_id, n.kind, n.title, n.body, n.created, n.seen, v.name AS vehicle
      FROM notifications n JOIN vehicles v ON v.id = n.vehicle_id WHERE v.owner_id = ?
      ORDER BY n.created DESC, n.id DESC LIMIT 100`, user.id);
    const unread = (await get(`SELECT COUNT(*) AS count FROM notifications n JOIN vehicles v ON v.id=n.vehicle_id
      WHERE v.owner_id=? AND n.seen=0`, user.id)).count;
    return { user, vehicles, notifications, unread: Number(unread), today, origin };
  }
  async function seedDemo() {
    const password = await passwordHash(token());
    db.exec('BEGIN IMMEDIATE');
    try {
      const id = run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', 'Aarav Sharma', `demo-${token()}@autoid.invalid`, password).lastInsertRowid;
      const vehicle = run(`INSERT INTO vehicles (owner_id,name,plate,model_year,odometer,last_service_km,interval_km,qr)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, 'Hyundai Creta', 'KA 01 AB 2408', 2023, 24820, 20000, 5000, token()).lastInsertRowid;
      for (const [type, days] of [['registration', 260], ['insurance', 14], ['emissions', 100]]) {
        run('INSERT INTO documents VALUES (?, ?, ?, ?)', vehicle, type, `DEMO-${type.toUpperCase()}-01`, dateAt(now() + days * dayMs));
      }
      notify(vehicle, 'parking', 'Parking issue', 'Sample report: the vehicle is close to the driveway entrance.', null);
      db.exec('COMMIT');
      return id;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  async function route(req, res) {
    const requestUrl = new URL(req.url, origin);
    const path = trustVercel && requestUrl.pathname === '/api/handler'
      ? requestUrl.searchParams.get('__autoid_path') || '/api/handler' : requestUrl.pathname;
    const method = req.method;
    if (!['GET', 'HEAD'].includes(method)) {
      requireValue(req.headers.origin === origin, 'Open AutoID from its configured address and try again.', 403);
    }
    if (method === 'GET' && path === '/api/config') return send(res, 200, { demo: demoAvailable });
    if (method === 'POST' && path === '/api/recover') {
      await throttle(`recover:${clientKey(req)}`, 10, 15 * 60_000);
      const data = await jsonBody(req);
      const email = emailField(data.email);
      const password = passwordField(data.password);
      const code = field(data.code, 'Recovery code', 32, 32);
      const user = await get('SELECT id FROM users WHERE email=?', email);
      requireValue(user, 'Email or recovery code is incorrect.', 401);
      const hash = await passwordHash(password);
      await db.batch([
        ['UPDATE users SET password=? WHERE id=?', [hash, user.id]],
        ['DELETE FROM recovery_codes WHERE user_id=? AND digest=?', [user.id, digest(code)],
          changes => requireValue(changes, 'Email or recovery code is incorrect.', 401)],
        ['DELETE FROM sessions WHERE user_id=?', [user.id]]
      ]);
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && ['/api/register', '/api/login', '/api/demo'].includes(path)) {
      await throttle(`auth:${path}:${clientKey(req)}`, 30, 15 * 60_000);
      const data = await jsonBody(req);
      if (path === '/api/demo') {
        requireValue(demoAvailable, 'Demo is disabled.', 404);
        await signIn(res, await seedDemo());
      } else {
        const email = emailField(data.email);
        const password = passwordField(data.password);
        if (path === '/api/register') {
          const name = field(data.name, 'Name', 70);
          const hash = await passwordHash(password);
          const result = await get('INSERT INTO users (name, email, password) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING RETURNING id', name, email, hash);
          requireValue(result, 'An account already uses this email.', 409);
          await signIn(res, result.id);
        } else {
          const user = await get('SELECT id,password FROM users WHERE email = ?', email);
          const stored = user?.password || dummyHash;
          const attempt = await passwordHash(password, stored.split(':')[0]);
          requireValue(timingSafeEqual(Buffer.from(stored), Buffer.from(attempt)) && user, 'Email or password is incorrect.', 401);
          await signIn(res, user.id, stored);
        }
      }
      return send(res, 200, { ok: true });
    }
    const publicMatch = /^\/api\/p\/([\w-]{32})(\/report)?$/.exec(path);
    if (publicMatch && method === 'GET' && !publicMatch[2]) {
      const vehicle = await get('SELECT name, model_year FROM vehicles WHERE qr = ?', publicMatch[1]);
      requireValue(vehicle, 'This vehicle link is unavailable or has been replaced.', 404);
      return send(res, 200, vehicle);
    }
    if (publicMatch && method === 'POST' && publicMatch[2]) {
      const data = await jsonBody(req);
      requireValue(typeof data.kind === 'string' && Object.hasOwn(reportTypes, data.kind), 'Choose a report type.');
      const message = field(data.message, 'Message', 400, 5);
      const vehicle = await get('SELECT id FROM vehicles WHERE qr = ?', publicMatch[1]);
      requireValue(vehicle, 'This vehicle link is unavailable or has been replaced.', 404);
      await throttle(`report-ip:${data.kind}:${clientKey(req)}`, 15, 15 * 60_000);
      await throttle(`report-vehicle:${data.kind}:${vehicle.id}`, 8, 15 * 60_000);
      const result = await run(`INSERT INTO notifications (vehicle_id,kind,title,body,created)
        SELECT id,?,?,?,? FROM vehicles WHERE id=? AND qr=?`, data.kind, reportTypes[data.kind], message, now(), vehicle.id, publicMatch[1]);
      requireValue(result.changes, 'This vehicle link is unavailable or has been replaced.', 404);
      return send(res, 201, { ok: true });
    }
    if (path.startsWith('/api/')) {
      const session = getSession(req);
      const user = await get(`SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token=? AND s.expires>?`, session, now());
      requireValue(user, 'Sign in to continue.', 401);
      if (method === 'POST' && path === '/api/logout') {
        await run('DELETE FROM sessions WHERE token = ?', session);
        cookie(res, '', 0);
        return send(res, 200, { ok: true });
      }
      if (method === 'POST' && path === '/api/sessions/revoke-others') {
        await run('DELETE FROM sessions WHERE user_id=? AND token<>?', user.id, session);
        return send(res, 200, { ok: true });
      }
      if (method === 'POST' && path === '/api/sessions/recovery-code') {
        await throttle(`recovery-code:${user.id}`, 8, 15 * 60_000);
        const data = await jsonBody(req);
        const { password: stored } = await get('SELECT password FROM users WHERE id=?', user.id);
        const attempt = await passwordHash(passwordField(data.password), stored.split(':')[0]);
        requireValue(timingSafeEqual(Buffer.from(stored), Buffer.from(attempt)), 'Current password is incorrect.');
        const code = token();
        await db.batch([
          ['UPDATE users SET password=password WHERE id=? AND password=?', [user.id, stored],
            changes => requireValue(changes, 'Current password changed. Sign in again.', 401)],
          [`INSERT INTO recovery_codes VALUES (?,?)
            ON CONFLICT(user_id) DO UPDATE SET digest=excluded.digest`, [user.id, digest(code)]]
        ]);
        return send(res, 200, { code });
      }
      if (method === 'GET' && path === '/api/dashboard') return send(res, 200, await dashboard(user));
      if (method === 'GET' && path === '/api/inbox') {
        const before = Number(requestUrl.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
        const emergency = requestUrl.searchParams.get('emergency') === 'true';
        requireValue(Number.isSafeInteger(before) && before > 0, 'Invalid inbox cursor.');
        const rows = await all(`SELECT n.id, n.kind, n.title, n.body, n.created, n.seen, v.name AS vehicle
          FROM notifications n JOIN vehicles v ON v.id=n.vehicle_id
          WHERE v.owner_id=? AND n.id<CAST(? AS BIGINT) ${emergency ? "AND n.kind='emergency'" : ''}
          ORDER BY n.id DESC LIMIT 26`, user.id, before);
        return send(res, 200, { items: rows.slice(0, 25), next: rows.length > 25 ? rows[24].id : null });
      }
      if (method === 'POST' && path === '/api/vehicles') {
        const data = await jsonBody(req);
        const name = field(data.name, 'Make and model', 70);
        const plate = field(data.plate, 'Registration plate', 18, 3).toUpperCase().replace(/\s+/g, ' ');
        requireValue(/^[A-Z0-9 -]+$/.test(plate) && /[A-Z0-9]/.test(plate), 'Use letters, numbers, spaces or hyphens for the plate.');
        const year = number(data.model_year, 'Model year', 1950, new Date(now()).getUTCFullYear() + 1);
        const odometer = number(data.odometer, 'Odometer', 0, 2_000_000);
        const last = number(data.last_service_km, 'Last service', 0, odometer);
        const interval = number(data.interval_km, 'Service interval', 100, 100_000);
        const result = await get(`INSERT INTO vehicles (owner_id,name,plate,model_year,odometer,last_service_km,interval_km,qr)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_id, plate) DO NOTHING RETURNING id`, user.id, name, plate, year, odometer, last, interval, token());
        requireValue(result, 'This plate is already in your garage.', 409);
        return send(res, 201, { id: result.id });
      }
      const fileMatch = /^\/api\/vehicles\/(\d+)\/files\/(registration|insurance|emissions|other)$/.exec(path);
      if (fileMatch) {
        const vehicle = await ownerVehicle(Number(fileMatch[1]), user.id);
        const type = fileMatch[2];
        if (method === 'GET') {
          const file = await get('SELECT name, bytes FROM document_files WHERE vehicle_id=? AND type=?', vehicle.id, type);
          requireValue(file, 'PDF not found.', 404);
          const name = encodeURIComponent(file.name.replace(/[\uD800-\uDFFF]/g, '_')).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16));
          res.setHeader('Content-Disposition', `attachment; filename="document.pdf"; filename*=UTF-8''${name}`);
          return send(res, 200, Buffer.from(file.bytes), 'application/pdf');
        }
        if (method === 'POST') {
          await throttle(`file:${user.id}`, 20, 15 * 60_000);
          const data = await jsonBody(req, 2_810_000);
          if (data.action === 'remove') {
            await run('DELETE FROM document_files WHERE vehicle_id=? AND type=?', vehicle.id, type);
            return send(res, 200, { ok: true });
          }
          const { name, bytes } = await pdfFile(data);
          const writes = [];
          if (type !== 'other') {
            const reference = field(data.reference, 'Document reference', 100);
            const expiry = expiryField(data.expiry);
            writes.push([saveDocument, [vehicle.id, type, reference, expiry]]);
          }
          writes.push([`INSERT INTO document_files VALUES (?,?,?,?,?) ON CONFLICT(vehicle_id,type)
            DO UPDATE SET name=excluded.name, bytes=excluded.bytes, uploaded=excluded.uploaded`, [vehicle.id, type, name, bytes, now()]]);
          await db.batch(writes);
          return send(res, 200, { ok: true });
        }
      }
      const vehicleMatch = /^\/api\/vehicles\/(\d+)\/(qr\.png|qr|care|documents)$/.exec(path);
      if (vehicleMatch) {
        const vehicle = await ownerVehicle(Number(vehicleMatch[1]), user.id);
        const action = vehicleMatch[2];
        if (method === 'GET' && action === 'qr.png') {
          requireValue(vehicle.qr, 'This QR is inactive.', 404);
          const image = await QRCode.toBuffer(`${origin}/p/${vehicle.qr}`, { width: 320, margin: 4, errorCorrectionLevel: 'M' });
          return send(res, 200, image, 'image/png');
        }
        if (method === 'POST') {
          const data = await jsonBody(req);
          if (action === 'qr') {
            requireValue(['replace', 'revoke'].includes(data.action), 'Choose replace or revoke.');
            await run('UPDATE vehicles SET qr=? WHERE id=?', data.action === 'replace' ? token() : null, vehicle.id);
          } else if (action === 'care') {
            const current = await ownerVehicle(vehicle.id, user.id);
            const odometer = number(data.odometer, 'Odometer', current.odometer, 2_000_000);
            const last = number(data.last_service_km, 'Last service', 0, odometer);
            const interval = number(data.interval_km, 'Service interval', 100, 100_000);
            const writes = [[`UPDATE vehicles SET odometer=?, last_service_km=?, interval_km=?
              WHERE id=? AND odometer=? AND last_service_km=? AND interval_km=?`,
            [odometer, last, interval, vehicle.id, current.odometer, current.last_service_km, current.interval_km],
            changes => requireValue(changes, 'Vehicle changed on another device. Refresh and try again.', 409)]];
            if (data.serviced_on !== undefined) {
              const date = expiryField(data.serviced_on);
              requireValue(date <= dateAt(now()), 'Service date cannot be in the future.');
              writes.push(['INSERT INTO service_events (vehicle_id,mileage,serviced_on) VALUES (?,?,?) ON CONFLICT DO NOTHING', [vehicle.id, last, date]]);
            }
            await db.batch(writes);
          } else if (action === 'documents') {
            requireValue(typeof data.type === 'string' && Object.hasOwn(documentTypes, data.type), 'Choose a document type.');
            const reference = field(data.reference, 'Document reference', 100);
            const expiry = expiryField(data.expiry);
            await run(saveDocument, vehicle.id, data.type, reference, expiry);
          } else {
            throw new HttpError(405, 'Method not allowed.');
          }
          return send(res, 200, { ok: true });
        }
      }
      const notificationMatch = /^\/api\/notifications\/(\d+|all)$/.exec(path);
      if (method === 'POST' && notificationMatch) {
        const ownerScope = 'vehicle_id IN (SELECT id FROM vehicles WHERE owner_id=?)';
        if (notificationMatch[1] === 'all') await run(`UPDATE notifications SET seen=1 WHERE ${ownerScope}`, user.id);
        else {
          const result = await run(`UPDATE notifications SET seen=1 WHERE ${ownerScope} AND id=?`, user.id, Number(notificationMatch[1]));
          requireValue(result.changes, 'Notification not found.', 404);
        }
        return send(res, 200, { ok: true });
      }
      throw new HttpError(404, 'Endpoint not found.');
    }
    if (method === 'GET') {
      const asset = assets.get(path) || ((path === '/' || path === '/scan' || /^\/p\/[\w-]{32}$/.test(path)) ? ['public/index.html', 'text/html'] : null);
      if (asset) {
        let body;
        try { body = readFileSync(resolve(root, asset[0])); } catch (error) {
          if (error.code === 'ENOENT') throw new HttpError(404, 'File not found.');
          throw error;
        }
        return send(res, 200, body, `${asset[1]}${asset[1].startsWith('text/') ? '; charset=utf-8' : ''}`);
      }
    }
    throw new HttpError(404, 'Page not found.');
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    await route(req, res).catch(error => {
      if (!error.status) console.error(error);
      if (error.status === 413 && !trustVercel) res.setHeader('Connection', 'close');
      if (!res.headersSent && !res.destroyed) send(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Try again.' });
    });
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  server.on('close', () => db.close());
  return server;
}
