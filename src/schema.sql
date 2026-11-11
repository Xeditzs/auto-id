PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, plate TEXT NOT NULL, model_year INTEGER NOT NULL,
  odometer INTEGER NOT NULL CHECK(odometer >= 0), last_service_km INTEGER NOT NULL CHECK(last_service_km BETWEEN 0 AND odometer),
  interval_km INTEGER NOT NULL CHECK(interval_km > 0), qr TEXT UNIQUE,
  UNIQUE(owner_id, plate)
);
CREATE TABLE IF NOT EXISTS documents (
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('registration', 'insurance', 'emissions')),
  reference TEXT NOT NULL, expiry TEXT NOT NULL,
  PRIMARY KEY(vehicle_id, type)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0 CHECK(seen IN (0, 1)), dedupe TEXT,
  UNIQUE(vehicle_id, dedupe)
);
CREATE INDEX IF NOT EXISTS vehicles_owner ON vehicles(owner_id);
CREATE INDEX IF NOT EXISTS notifications_vehicle ON notifications(vehicle_id, created);

CREATE TABLE IF NOT EXISTS document_files (
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('registration','insurance','emissions','other')),
  name TEXT NOT NULL, bytes BLOB NOT NULL, uploaded INTEGER NOT NULL,
  PRIMARY KEY(vehicle_id, type)
);
CREATE TABLE IF NOT EXISTS service_events (
  id INTEGER PRIMARY KEY, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  mileage INTEGER NOT NULL, serviced_on TEXT NOT NULL, UNIQUE(vehicle_id, mileage, serviced_on)
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_codes (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  digest TEXT NOT NULL
);
