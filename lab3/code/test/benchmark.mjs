import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { addDays, CONFIRMATION_MS } from '../src/model.mjs';
import { Repository } from '../src/repository.mjs';
import { createWorkspace } from '../src/server.mjs';

const HOTELS = 100;
const NIGHTS = 90;
const ORDERS = 5000;
const CLIENTS = 10;
const REQUESTS_PER_CLIENT = 10;
const ARRIVAL = '2026-11-25';
const CLOCK = Date.parse('2026-11-24T10:00:00+08:00');
const ROOM_TYPES = [
  { name: '明亮双床房', capacity: 2 },
  { name: '观景大床房', capacity: 2 },
  { name: '家庭套房', capacity: 4 },
];

function catalogFixture() {
  return Array.from({ length: HOTELS }, (_, hotel) => ({
    id: hotel + 1,
    city: hotel % 2 === 0 ? '武汉' : '南京',
    types: ROOM_TYPES.map((category, type) => ({
      ...category,
      id: hotel * ROOM_TYPES.length + type + 1,
      offers: Array.from({ length: NIGHTS }, (_, night) => ({
        night: addDays(ARRIVAL, night),
        capacity: 2 + (hotel + night + type * 2) % 6,
        price: 19000 + (hotel % 20) * 1250 + 4500 * type + 540 * (night % 7),
        stopped: Number(night < 60 && (hotel + night + type * 2) % 31 === 0),
      })),
    })),
  }));
}

function fill(db, hotels) {
  const account = db.connection.prepare("INSERT INTO accounts(id,username,name,role,digest) VALUES(1,?,?,'guest',?)");
  const hotel = db.connection.prepare('INSERT INTO hotels VALUES(?,?,?,?,?,?)');
  const type = db.connection.prepare('INSERT INTO types VALUES(?,?,?,?,?,?,?)');
  const offer = db.connection.prepare('INSERT INTO offers(type_id,night,capacity,price,stopped) VALUES(?,?,?,?,?)');
  const order = db.connection.prepare(`INSERT INTO orders(
    customer_id,type_id,arrival,departure,quantity,guests,guest_name,state,total,created_at,changed_at,deadline
  ) VALUES(1,?,?,?,?,?,'查询基准','confirmed',?,?,?,?)`);
  const price = db.connection.prepare('INSERT INTO order_prices VALUES(?,?,?)');
  const reserve = db.connection.prepare('UPDATE offers SET reserved=reserved+? WHERE type_id=? AND night=?');
  const categories = hotels.flatMap(item => item.types);
  db.transaction(() => {
    account.run('benchmark', '查询基准', 'login disabled for benchmark');
    for (const property of hotels) {
      hotel.run(property.id, 'HOT' + property.id, '泊序测试酒店 ' + property.id,
        property.city, '性能测试数据', 'wood-room.jpg');
      for (const category of property.types) {
        type.run(category.id, property.id, 'ROOM' + category.id, category.name,
          category.capacity, '性能测试用房型', 'wood-twin.jpg');
        for (const night of category.offers) {
          offer.run(category.id, night.night, night.capacity, night.price, night.stopped);
        }
      }
    }
    for (let index = 0; index < ORDERS; index++) {
      const category = categories[index % categories.length];
      const night = category.offers[65 + Math.floor(index / categories.length)];
      const quantity = 1 + index % 2;
      const booking = order.run(category.id, night.night, addDays(night.night, 1), quantity,
        quantity, night.price * quantity, CLOCK, CLOCK, CLOCK + CONFIRMATION_MS);
      price.run(booking.lastInsertRowid, night.night, night.price);
      reserve.run(quantity, category.id, night.night);
    }
  });
  return categories.length;
}

function scenario(index, hotels) {
  const category = ROOM_TYPES[index % ROOM_TYPES.length];
  const offset = index * 3;
  const length = 1 + index % 5;
  const quantity = 1 + index % 3;
  const filters = {
    arrival: addDays(ARRIVAL, offset),
    departure: addDays(ARRIVAL, offset + length),
    guests: index % 3 === 2 ? quantity * 3 : quantity * category.capacity - index % 2,
    quantity,
    type: index % 3 === 2 ? '' : category.name,
    city: index % 2 === 0 ? '武汉' : '南京',
    min: (19400 + 1750 * (index % 3)) * length * quantity,
    max: (32400 + 3750 * index) * length * quantity,
  };
  const expected = [];
  for (const property of hotels.filter(hotel => hotel.city === filters.city)) {
    for (const type of property.types) {
      if (!type.name.includes(filters.type) || type.capacity * quantity < filters.guests) continue;
      const quotedNights = type.offers.slice(offset, offset + length);
      const total = quotedNights.reduce((value, night) => value + night.price, 0) * quantity;
      const available = Math.min(...quotedNights.map(night => night.capacity));
      if (quotedNights.some(night => night.stopped)
        || available < quantity || total < filters.min || total > filters.max) continue;
      expected.push([type.id, available, total]);
    }
  }
  expected.sort((a, b) => a[2] - b[2] || a[0] - b[0]);
  assert.ok(expected.length > 0, '基准场景必须至少有一个命中结果');
  return { filters, expected };
}

async function request(origin, query) {
  const start = performance.now();
  try {
    const response = await fetch(origin + '/api/catalog?' + new URLSearchParams(query.filters), {
      signal: AbortSignal.timeout(5000),
    });
    assert.ok(response.ok, String(response.status));
    const { items } = await response.json();
    assert.deepEqual(items.map(item => [item.id, item.available, item.total]), query.expected);
    return { correct: true, ms: performance.now() - start };
  } catch (error) {
    return { correct: false, ms: performance.now() - start, error: error.message.split('\n')[0] };
  }
}

async function main() {
  const folder = mkdtempSync(join(tmpdir(), 'boxu-catalog-'));
  const db = new Repository(join(folder, 'benchmark.db'), () => CLOCK);
  let server;
  try {
    const hotels = catalogFixture();
    const roomTypes = fill(db, hotels);
    const queries = Array.from({ length: CLIENTS }, (_, index) => scenario(index, hotels));
    server = createWorkspace(db);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    const baseline = await request(origin, queries[0]);
    assert.ok(baseline.correct, '基准查询自检失败: ' + baseline.error);
    const results = (await Promise.all(queries.map(async query => {
      const samples = [];
      for (let index = 0; index < REQUESTS_PER_CLIENT; index++) {
        samples.push(await request(origin, query));
      }
      return samples;
    }))).flat();
    const times = results.map(result => result.ms).sort((a, b) => a - b);
    const passing = results.filter(result => result.correct && result.ms <= 2000).length;
    console.log(JSON.stringify({
      runtime: process.version,
      sqlite: db.get('SELECT sqlite_version() AS version').version,
      cpu: cpus()[0].model,
      visibleCores: availableParallelism(),
      memoryGiB: +(totalmem() / 2 ** 30).toFixed(2),
      network: 'local HTTP loopback',
      hotels: HOTELS,
      roomTypes,
      nightlyOffers: roomTypes * NIGHTS,
      orders: ORDERS,
      clients: CLIENTS,
      requests: results.length,
      correctlyReturnedWithin2s: passing,
      correct: results.filter(result => result.correct).length,
      medianMs: +((times[49] + times[50]) / 2).toFixed(2),
      p95Ms: +times[94].toFixed(2),
      maxMs: +times.at(-1).toFixed(2),
      queryConditions: queries.map(query => ({ ...query.filters, matches: query.expected.length })),
      failures: [...new Set(results.filter(result => !result.correct).map(result => result.error))],
    }, null, 2));
    assert.ok(passing >= 95, '正确且两秒内返回的请求少于95次');
  } finally {
    if (server?.listening) {
      await new Promise(resolve => server.close(resolve));
    }
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
}

await main();
