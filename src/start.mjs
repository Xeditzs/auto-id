import { resolve } from 'node:path';
import { createApp } from './server.mjs';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const origin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
process.umask(0o077);
const server = createApp({
  origin,
  databasePath: resolve(process.env.DATABASE_PATH || 'data/autoid.sqlite'),
  demo: process.env.DEMO_MODE === 'true' || (process.env.DEMO_MODE === undefined && host === '127.0.0.1' && origin === `http://localhost:${port}`)
});
server.listen(port, host, () => console.log(`AutoID is ready at ${origin}`));
