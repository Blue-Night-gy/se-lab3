import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { identify, login, logout, register } from './accounts.mjs';
import { catalogSearch, PHOTOS } from './catalog.mjs';
import {
  accountList,
  auditList,
  hotelsFor,
  myOrders,
  occupancy,
  operationsOrders,
  typesFor,
} from './insight.mjs';
import { Fault, integer, requireThat, today } from './model.mjs';
import { Operations } from './operations.mjs';
import { Repository } from './repository.mjs';
import { Reservations } from './reservation.mjs';
import { seedDemo } from './seed.mjs';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const media = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};
const security = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function answer(response, status, result, headers = {}) {
  response.writeHead(status, {
    ...security,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(result));
}

async function body(request) {
  requireThat(
    request.headers['content-type']?.split(';')[0].trim() === 'application/json',
    'MEDIA',
    '请求应使用JSON',
    415,
  );
  if (request.headers.origin) {
    requireThat(request.headers.origin === 'http://' + request.headers.host, 'ORIGIN', '拒绝跨站提交', 403);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    requireThat(size <= 32 * 1024, 'SIZE', '请求内容过长', 413);
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new Fault('JSON', 'JSON请求格式错误');
  }
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'JSON', '请求须为JSON对象');
  return value;
}

function staticFile(request, response, url) {
  requireThat(['GET', 'HEAD'].includes(request.method), 'METHOD', '此地址只支持读取', 405);
  const key = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const path = resolve(root, '.' + key);
  requireThat(
    path.startsWith(resolve(root) + sep) &&
      media[extname(path)] &&
      statSync(path, {
        throwIfNoEntry: false,
      })?.isFile(),
    'NOT_FOUND',
    '页面不存在',
    404,
  );
  const cache = extname(path) === '.jpg' || extname(path) === '.woff2' ? 'public, max-age=3600' : 'no-cache';
  response.writeHead(200, { ...security, 'Content-Type': media[extname(path)], 'Cache-Control': cache });
  response.end(request.method === 'HEAD' ? undefined : readFileSync(path));
}

function route(method, path, work) {
  const match = '^' + path.replace(/:(\w+)/g, '(?<$1>\\d+)') + '$';
  return { method, path: new RegExp(match), work };
}

function routes(db, reservations, operations) {
  const get = (path, work) => route('GET', path, work);
  const post = (path, work) => route('POST', path, work);
  return [
    get('/session', ({ actor }) => ({ actor, today: today(db.clock()) })),
    post('/session', ({ value }) => login(db, value)),
    post('/register', ({ value }) => register(db, value)),
    post('/logout', ({ cookie }) => ({ actor: null, cookie: logout(db, cookie) })),
    get('/room-types', () =>
      db.all(`SELECT t.id,t.name,h.name AS hotel_name
      FROM types t JOIN hotels h ON h.id=t.hotel_id ORDER BY h.city,h.name,t.name`),
    ),
    get('/catalog', ({ query }) => {
      reservations.expireDue();
      return {
        items: catalogSearch(db, query),
        cities: db.all('SELECT DISTINCT city FROM hotels ORDER BY city').map((row) => row.city),
        today: today(db.clock()),
      };
    }),
    post('/quotes', ({ actor, value }) => reservations.quote(actor, value)),
    post('/orders', ({ actor, value }) => reservations.commit(actor, value)),
    get('/orders', ({ actor }) => {
      reservations.expireDue();
      return myOrders(db, actor);
    }),
    get('/orders/:id', ({ actor, id }) => reservations.orderFor(actor, id)),
    post('/orders/:id/quotes', ({ actor, id, value }) => reservations.quote(actor, value, id)),
    post('/orders/:id/amend', ({ actor, id, value }) => reservations.commit(actor, value, id)),
    post('/orders/:id/correct', ({ actor, id, value }) => reservations.edit(actor, id, value, '更正入住人')),
    post('/orders/:id/cancel', ({ actor, id, value }) => reservations.edit(actor, id, value, '取消预订')),
    get('/ops/orders', ({ actor, query }) => {
      reservations.expireDue();
      return operationsOrders(db, actor, query);
    }),
    post('/ops/orders/:id/confirm', ({ actor, id, value }) =>
      operations.handleOrder(actor, id, '酒店确认', value),
    ),
    post('/ops/orders/:id/check-in', ({ actor, id, value }) =>
      operations.handleOrder(actor, id, '整体分房', value),
    ),
    post('/ops/orders/:id/check-out', ({ actor, id, value }) =>
      operations.handleOrder(actor, id, '整单退房', value),
    ),
    get('/ops/hotels', ({ actor }) => ({ hotels: hotelsFor(db, actor), photos: PHOTOS })),
    post('/ops/hotels', ({ actor, value }) => operations.saveHotel(actor, value)),
    get('/ops/hotels/:id/types', ({ actor, id }) => typesFor(db, actor, id)),
    post('/ops/hotels/:id/types', ({ actor, id, value }) => operations.saveType(actor, id, value)),
    get('/ops/hotels/:id/rooms', ({ actor, id }) => operations.listRooms(actor, id)),
    post('/ops/rooms/:id', ({ actor, id, value }) => operations.roomAction(actor, id, value)),
    post('/ops/types/:id/rooms', ({ actor, id, value }) => operations.saveRoom(actor, id, value)),
    get('/ops/types/:id/offers', ({ actor, id, query }) =>
      operations.offerCalendar(actor, id, query.start, query.end),
    ),
    post('/ops/types/:id/offers', ({ actor, id, value }) => operations.saveDay(actor, id, value)),
    get('/ops/hotels/:id/cases', ({ actor, id }) => operations.cases(actor, id)),
    post('/ops/hotels/:id/closures', ({ actor, id, value }) => operations.closure(actor, id, value)),
    post('/ops/closures/:id/end', ({ actor, id }) => operations.endClosure(actor, id)),
    post('/ops/cases/:id', ({ actor, id, value }) => operations.resolve(actor, id, value)),
    get('/ops/occupancy', ({ actor, query }) => {
      reservations.expireDue();
      return occupancy(db, actor, query);
    }),
    get('/ops/accounts', ({ actor }) => accountList(db, actor)),
    post('/ops/accounts', ({ actor, value }) => operations.saveAccount(actor, value)),
    post('/ops/grants', ({ actor, value }) => operations.setGrant(actor, value)),
    get('/ops/audit', ({ actor, query }) => auditList(db, actor, query)),
  ];
}

export function createWorkspace(db) {
  const reservations = new Reservations(db);
  const operations = new Operations(db, reservations);
  const endpoints = routes(db, reservations, operations);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://local');
      if (!url.pathname.startsWith('/api/')) {
        staticFile(request, response, url);
        return;
      }
      const pathname = url.pathname.slice('/api'.length);
      for (const endpoint of endpoints) {
        const match = endpoint.path.exec(pathname);
        if (endpoint.method !== request.method || !match) continue;
        const cookie = request.headers.cookie;
        const value = request.method === 'POST' ? await body(request) : null;
        const result = endpoint.work({
          actor: identify(db, cookie),
          cookie,
          value,
          query: Object.fromEntries(url.searchParams),
          id: match.groups?.id ? integer(match.groups.id, '编号') : null,
        });
        if (result && 'cookie' in result)
          answer(response, 200, { actor: result.actor }, { 'Set-Cookie': result.cookie });
        else answer(response, 200, result);
        return;
      }
      throw new Fault('NOT_FOUND', '请求地址不存在', 404);
    } catch (error) {
      const known = error instanceof Fault;
      if (!known) console.error(error);
      if (!response.headersSent && !response.destroyed)
        answer(response, known ? error.status : 500, {
          code: known ? error.code : 'INTERNAL',
          message: known ? error.message : '未能完成操作，请稍后重试',
        });
    }
  });
  const expiry = setInterval(() => {
    try {
      reservations.expireDue();
    } catch (error) {
      console.error('未能扫描到期订单:', error.message);
    }
  }, 15000);
  expiry.unref();
  server.once('close', () => clearInterval(expiry));
  return server;
}

function startup() {
  const options = new Map(
    process.argv
      .slice(2)
      .filter((value) => value.includes('='))
      .map((value) => value.split(/=(.*)/s, 2)),
  );
  const directory = resolve(options.get('--data') ?? 'data');
  mkdirSync(directory, { recursive: true });
  const db = new Repository(resolve(directory, 'bosu.db'));
  seedDemo(db);
  const server = createWorkspace(db);
  const port = integer(options.get('--port') ?? 8788, '端口', 0, 65535);
  server.listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(() => db.close()));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) startup();
