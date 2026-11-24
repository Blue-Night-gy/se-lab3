PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('guest','staff','admin')),
  digest TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS hotels (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  location TEXT NOT NULL,
  photo TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hotel_city ON hotels(city,id);
CREATE TABLE IF NOT EXISTS types (
  id INTEGER PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity>0),
  description TEXT NOT NULL,
  photo TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS type_hotel ON types(hotel_id,id);
CREATE TABLE IF NOT EXISTS grants (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  audit INTEGER NOT NULL DEFAULT 0 CHECK(audit IN (0,1)),
  PRIMARY KEY(account_id,hotel_id)
);
CREATE TABLE IF NOT EXISTS offers (
  type_id INTEGER NOT NULL REFERENCES types(id),
  night TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity>=0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=capacity),
  price INTEGER CHECK(price>0),
  stopped INTEGER NOT NULL DEFAULT 0 CHECK(stopped IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(type_id,night)
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  type_id INTEGER NOT NULL REFERENCES types(id),
  number TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'free' CHECK(state IN ('free','occupied','cleaning','repair')),
  UNIQUE(type_id,number)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES accounts(id),
  type_id INTEGER NOT NULL REFERENCES types(id),
  arrival TEXT NOT NULL,
  departure TEXT NOT NULL CHECK(departure>arrival),
  quantity INTEGER NOT NULL CHECK(quantity>0),
  guests INTEGER NOT NULL CHECK(guests>0),
  guest_name TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','confirmed','staying','completed','cancelled')),
  version INTEGER NOT NULL DEFAULT 1,
  total INTEGER NOT NULL CHECK(total>=0),
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS order_customer ON orders(customer_id, state, type_id, arrival, departure, quantity);
CREATE INDEX IF NOT EXISTS order_expiry ON orders(state,deadline);
CREATE INDEX IF NOT EXISTS order_type_dates ON orders(type_id,arrival,departure);
CREATE TABLE IF NOT EXISTS order_prices (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  night TEXT NOT NULL,
  unit INTEGER NOT NULL CHECK(unit>0),
  PRIMARY KEY(order_id,night)
);
CREATE TABLE IF NOT EXISTS quote (
  id TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES accounts(id),
  order_id INTEGER REFERENCES orders(id),
  order_version INTEGER,
  plan TEXT NOT NULL,
  prices TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  customer_id INTEGER NOT NULL REFERENCES accounts(id),
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  PRIMARY KEY(customer_id,key)
);
CREATE TABLE IF NOT EXISTS duplicate_decisions (
  id TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES accounts(id),
  plan TEXT NOT NULL,
  matches TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS allocations (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  checked_in INTEGER NOT NULL,
  checked_out INTEGER,
  UNIQUE(order_id,room_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS active_room ON allocations(room_id) WHERE checked_out IS NULL;
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  type_id INTEGER REFERENCES types(id),
  room_id INTEGER REFERENCES rooms(id),
  start TEXT NOT NULL,
  end TEXT NOT NULL CHECK(end>start),
  reason TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  actor_id INTEGER NOT NULL REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS block_scope ON blocks(hotel_id,active,start,end,type_id);
CREATE TABLE IF NOT EXISTS coordination (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  block_id INTEGER NOT NULL REFERENCES blocks(id),
  result TEXT,
  actor_id INTEGER REFERENCES accounts(id),
  resolved_at INTEGER,
  UNIQUE(order_id,block_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  operation TEXT NOT NULL UNIQUE,
  instant INTEGER NOT NULL,
  actor_id INTEGER REFERENCES accounts(id),
  hotel_id INTEGER REFERENCES hotels(id),
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('ok','failed')),
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  detail TEXT NOT NULL,
  restricted INTEGER NOT NULL DEFAULT 0 CHECK(restricted IN (0,1))
);
CREATE INDEX IF NOT EXISTS audit_scope ON audit(hotel_id,instant);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  expires_at INTEGER NOT NULL
);
