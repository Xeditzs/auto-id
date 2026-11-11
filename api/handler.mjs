import { createApp } from '../src/server.mjs';

let handler;
export default async function autoid(req, res) {
  if (!handler) {
    const { DATABASE_URL, PUBLIC_ORIGIN, VERCEL_PROJECT_PRODUCTION_URL } = process.env;
    const origin = PUBLIC_ORIGIN || (VERCEL_PROJECT_PRODUCTION_URL && `https://${VERCEL_PROJECT_PRODUCTION_URL}`);
    if (!DATABASE_URL || !origin || !origin.startsWith('https://')) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('AutoID deployment needs DATABASE_URL and an HTTPS PUBLIC_ORIGIN.');
      return;
    }
    const app = createApp({ connectionString: DATABASE_URL, origin, trustVercel: process.env.VERCEL === '1' });
    handler = app.listeners('request')[0];
  }
  await handler(req, res);
}
