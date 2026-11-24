import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { identify, login, logout, register } from '../src/accounts.mjs';
import { catalogSearch } from '../src/catalog.mjs';
import { auditList, myOrders, occupancy, operationsOrders } from '../src/insight.mjs';
import { HOUR, CONFIRMATION_MS, QUOTE_MS, StayPlan } from '../src/model.mjs';
import { Operations } from '../src/operations.mjs';
import { Repository } from '../src/repository.mjs';
import { Reservations } from '../src/reservation.mjs';
import { seedDemo } from '../src/seed.mjs';
import { createWorkspace } from '../src/server.mjs';

const base = Date.parse('2026-11-06T10:00:00+08:00');
const standard = {
  typeId: 1,
  arrival: '2026-11-06',
  departure: '2026-11-09',
  quantity: 2,
  guests: 4,
};
const guest = { id: 1, role: 'guest' };
const other = { id: 2, role: 'guest' };
const desk = { id: 3, role: 'staff' };
const auditor = { id: 4, role: 'staff' };
const admin = { id: 5, role: 'admin' };

function fixture(t, path = ':memory:') {
  let instant = base;
  const db = new Repository(path, () => instant);
  t.after(() => db.close());
  seedDemo(db);
  const reservations = new Reservations(db);
  const operations = new Operations(db, reservations);
  function submit(plan = standard, actor = guest) {
    const quote = reservations.quote(actor, plan);
    const payload = { ...plan, guestName: '测试住客', quoteId: quote.id, requestKey: randomUUID() };
    return { quote, payload, result: reservations.commit(actor, payload) };
  }
  function editDay(night, changes) {
    const current = db.get('SELECT * FROM offers WHERE type_id=1 AND night=?', night);
    return operations.saveDay(desk, 1, { ...current, ...changes });
  }
  function occupied(type = 1) {
    return db
      .all('SELECT reserved FROM offers WHERE type_id=? ORDER BY night LIMIT 4', type)
      .map((row) => row.reserved);
  }
  return {
    db,
    reservations,
    operations,
    submit,
    editDay,
    occupied,
    set: (value) => {
      instant = value;
    },
  };
}

test('校验非法日期并排除退房日', () => {
  assert.deepEqual(new StayPlan(standard).nights, ['2026-11-06', '2026-11-07', '2026-11-08']);
  assert.throws(() => new StayPlan({ ...standard, arrival: '2026-02-29' }), { code: 'DATE' });
  assert.throws(() => new StayPlan({ ...standard, departure: standard.arrival }), { code: 'DATE' });
});

test('组合查询取最少余量并保留准确的多间逐晚报价', (t) => {
  const f = fixture(t);
  const items = catalogSearch(f.db, { ...standard, city: '武汉', type: '双床', min: 160000, max: 175000 });
  assert.equal(items.length, 1);
  assert.equal(items[0].available, 2);
  assert.equal(items[0].total, 170000);
  const { quote, result } = f.submit();
  assert.deepEqual(
    quote.prices.map((price) => price.unit),
    [26000, 28000, 31000],
  );
  assert.equal(result.order.total, 170000);
  assert.deepEqual(f.occupied(), [2, 2, 2, 0]);
  f.editDay('2026-11-06', { price: 50000 });
  assert.equal(f.db.snapshot(result.id).prices[0].unit, 26000);
});

test('缺价、停售及任一晚房量不足均拦截整段行程', (t) => {
  const f = fixture(t);
  for (const [change, code] of [
    [{ price: null }, 'NO_OFFER'],
    [{ price: 28000, stopped: true }, 'NO_OFFER'],
    [{ price: 28000, stopped: false, capacity: 1 }, 'SOLD_OUT'],
  ]) {
    f.editDay('2026-11-07', change);
    assert.equal(catalogSearch(f.db, { ...standard, type: '明亮双床房' }).length, 0);
    assert.throws(() => f.reservations.quote(guest, standard), { code });
  }
  assert.deepEqual(f.occupied(), [0, 0, 0, 0]);
});

test('逐晚改价让顾客重新接受，继续之前不预占房间', (t) => {
  const f = fixture(t);
  const quote = f.reservations.quote(guest, standard);
  const original = { ...standard, quoteId: quote.id, requestKey: 'original', guestName: '测试住客' };
  f.editDay('2026-11-06', { price: 30000 });
  const repriced = f.reservations.commit(guest, original);
  assert.equal(repriced.outcome, 'repriced');
  assert.equal(repriced.previousTotal, 170000);
  assert.equal(repriced.quote.total, 178000);
  assert.deepEqual(f.occupied(), [0, 0, 0, 0]);
  assert.equal(JSON.stringify(f.reservations.commit(guest, original)), JSON.stringify(repriced));
  assert.throws(() => f.reservations.commit(guest, { ...original, quoteId: repriced.quote.id }), {
    code: 'KEY_REUSED',
  });
  f.editDay('2026-11-07', { price: 32000 });
  const again = f.reservations.commit(guest, {
    ...original,
    quoteId: repriced.quote.id,
    requestKey: 'accept-1',
  });
  assert.equal(again.quote.total, 186000);
  assert.equal(f.db.get('SELECT COUNT(*) AS n FROM orders').n, 0);
  const saved = f.reservations.commit(guest, {
    ...original,
    quoteId: again.quote.id,
    requestKey: 'accept-2',
  });
  assert.equal(saved.order.total, 186000);
  assert.deepEqual(f.occupied(), [2, 2, 2, 0]);
});

test('报价绑定身份、行程并在有效期结束时失效', (t) => {
  const f = fixture(t);
  const q = f.reservations.quote(guest, standard);
  const input = { ...standard, quoteId: q.id, requestKey: 'key', guestName: '测试住客' };
  assert.throws(() => f.reservations.commit(other, input), { code: 'QUOTE_EXPIRED' });
  assert.throws(() => f.reservations.commit(guest, { ...input, quantity: 1, guests: 2 }), {
    code: 'QUOTE_SCOPE',
  });
  f.set(base + QUOTE_MS);
  assert.throws(() => f.reservations.commit(guest, input), { code: 'QUOTE_EXPIRED' });
});

test('相同请求重放与相同行程的另订决策相互独立', (t) => {
  const f = fixture(t);
  const plan = { ...standard, quantity: 1, guests: 2 };
  const { payload, result } = f.submit(plan);
  assert.equal(JSON.stringify(f.reservations.commit(guest, payload)), JSON.stringify(result));
  const newRequest = { ...payload, requestKey: 'another', guestName: '另一住客' };
  const warning = f.reservations.commit(guest, newRequest);
  assert.equal(warning.outcome, 'duplicate');
  assert.deepEqual(
    warning.orders.map((item) => item.id),
    [result.id],
  );
  assert.equal(f.db.get('SELECT COUNT(*) AS n FROM orders').n, 1);
  const second = f.reservations.commit(guest, {
    ...newRequest,
    requestKey: 'continue',
    decisionId: warning.decisionId,
  });
  assert.notEqual(second.id, result.id);
  assert.deepEqual(f.occupied(), [2, 2, 2, 0]);
});

test('改期按净量更新交叠夜晚，新版本独立开始确认期', (t) => {
  const f = fixture(t);
  const order = f.submit().result.order;
  f.set(base + 5 * 60000);
  const changed = { ...standard, arrival: '2026-11-07', departure: '2026-11-10' };
  const quote = f.reservations.quote(guest, changed, order.id);
  const result = f.reservations.commit(
    guest,
    { ...changed, quoteId: quote.id, requestKey: 'amend', guestName: order.guest_name },
    order.id,
  );
  assert.deepEqual(f.occupied(), [0, 2, 2, 2]);
  assert.equal(result.order.deadline, base + 25 * 60000);
  assert.equal(result.order.version, 2);
  f.set(base + CONFIRMATION_MS);
  assert.equal(f.reservations.expireVersion(order.id, order.version), false);
  assert.equal(f.db.order(order.id).state, 'pending');
});

test('仅改姓名保留原订单价格、状态与截止时刻', (t) => {
  const f = fixture(t);
  const order = f.submit().result.order;
  f.editDay('2026-11-06', { price: 39000 });
  f.set(base + 3 * 60000);
  const corrected = f.reservations.edit(
    guest,
    order.id,
    { version: order.version, guestName: '新姓名' },
    '更正入住人',
  );
  assert.equal(corrected.guest_name, '新姓名');
  assert.equal(corrected.deadline, order.deadline);
  assert.equal(corrected.state, order.state);
  assert.equal(corrected.total, 170000);
  assert.deepEqual(corrected.prices, order.prices);
  assert.equal(corrected.version, order.version + 1);
});

test('20分钟确认截止使用包含边界，到期只释放一次', (t) => {
  const f = fixture(t);
  const first = f.submit().result.order;
  const second = f.submit({ ...standard, typeId: 2 }).result.order;
  f.set(base + CONFIRMATION_MS - 1000);
  assert.equal(
    f.operations.handleOrder(desk, first.id, '酒店确认', { version: first.version }).state,
    'confirmed',
  );
  f.set(base + CONFIRMATION_MS);
  assert.throws(() => f.operations.handleOrder(desk, second.id, '酒店确认', { version: second.version }));
  assert.equal(f.db.order(second.id).state, 'cancelled');
  assert.deepEqual(f.occupied(2), [0, 0, 0, 0]);
  assert.equal(f.reservations.expireDue(), 0);
  assert.deepEqual(f.occupied(), [2, 2, 2, 0]);
});

test('日内17:59可以取消，18:00开始拒绝普通取消', (t) => {
  const f = fixture(t);
  const first = f.submit().result.order;
  const second = f.submit({ ...standard, typeId: 2 }).result.order;
  const a = f.operations.handleOrder(desk, first.id, '酒店确认', first);
  const b = f.operations.handleOrder(desk, second.id, '酒店确认', second);
  f.set(base + 8 * HOUR - 60000);
  assert.equal(f.reservations.edit(guest, a.id, a, '取消预订').state, 'cancelled');
  f.set(base + 8 * HOUR);
  assert.throws(() => f.reservations.edit(guest, b.id, b, '取消预订'), { code: 'CUTOFF' });
  assert.equal(f.db.order(b.id).state, 'confirmed');
  assert.deepEqual(f.occupied(2), [2, 2, 2, 0]);
});

test('数据库中途写入异常使三晚库存与新订单一同回滚', (t) => {
  const f = fixture(t);
  const q = f.reservations.quote(guest, standard);
  f.db.connection.exec(`CREATE TRIGGER fail_middle BEFORE UPDATE OF reserved ON offers
    WHEN NEW.night='2026-11-07' BEGIN SELECT RAISE(ABORT,'受控中途故障'); END`);
  assert.throws(
    () =>
      f.reservations.commit(guest, {
        ...standard,
        quoteId: q.id,
        requestKey: 'failure',
        guestName: '测试住客',
      }),
    /受控中途故障/,
  );
  assert.equal(f.db.get('SELECT COUNT(*) AS n FROM orders').n, 0);
  assert.equal(f.db.get("SELECT COUNT(*) AS n FROM audit WHERE result='failed'").n, 1);
  assert.deepEqual(f.occupied(), [0, 0, 0, 0]);
});

test('成功审计写不成时回滚，失败日志保留实际原值', (t) => {
  const f = fixture(t);
  f.db.connection.exec(`CREATE TRIGGER fail_success BEFORE INSERT ON audit WHEN NEW.result='ok'
    BEGIN SELECT RAISE(ABORT,'受控日志故障'); END`);
  assert.throws(() => f.editDay('2026-11-06', { price: 67000 }), /受控日志故障/);
  assert.equal(f.db.get("SELECT price FROM offers WHERE type_id=1 AND night='2026-11-06'").price, 26000);
  const failed = f.db.get("SELECT * FROM audit WHERE result='failed'");
  assert.equal(failed.old_value, failed.new_value);
  assert.equal(JSON.parse(failed.old_value).price, 26000);
});

test('整单分房要求不同且同型的房号，退房后全部转为待清洁', (t) => {
  const f = fixture(t);
  const order = f.submit().result.order;
  const valid = f.operations.handleOrder(desk, order.id, '酒店确认', order);
  assert.throws(
    () => f.operations.handleOrder(desk, order.id, '整体分房', { version: valid.version, roomIds: [1, 1] }),
    { code: 'ROOM_SET' },
  );
  assert.throws(
    () => f.operations.handleOrder(desk, order.id, '整体分房', { version: valid.version, roomIds: [1, 6] }),
    { code: 'ROOM_TYPE' },
  );
  const active = f.operations.handleOrder(desk, order.id, '整体分房', {
    version: valid.version,
    roomIds: [1, 2],
  });
  assert.deepEqual(
    active.rooms.map((room) => room.number),
    ['201', '202'],
  );
  assert.throws(() => f.reservations.edit(guest, order.id, active, '取消预订'), { code: 'STATE' });
  const finished = f.operations.handleOrder(desk, order.id, '整单退房', active);
  assert.equal(finished.state, 'completed');
  assert.deepEqual(
    finished.rooms.map((room) => room.state),
    ['cleaning', 'cleaning'],
  );
  assert.equal(f.operations.roomAction(desk, 1, { event: 'clean' }).state, 'free');
});

test('停业日期挡住旧报价提交，但保留曾经成交的订单和协调记录', (t) => {
  const f = fixture(t);
  const order = f.submit().result.order;
  const quote = f.reservations.quote(other, { ...standard, typeId: 2 });
  f.operations.closure(desk, 1, { start: '2026-11-07', end: '2026-11-08', reason: '维修通道' });
  assert.throws(
    () =>
      f.reservations.commit(other, {
        ...standard,
        typeId: 2,
        quoteId: quote.id,
        requestKey: 'old',
        guestName: '其他客人',
      }),
    { code: 'BLOCKED' },
  );
  assert.equal(f.db.order(order.id).state, 'pending');
  const coordination = f.operations.cases(desk, 1).cases[0];
  assert.equal(coordination.order_id, order.id);
  assert.equal(f.operations.resolve(desk, coordination.id, { result: '顾客要求保留行程' }).actor_id, desk.id);
  assert.ok(catalogSearch(f.db, { ...standard, arrival: '2026-11-08', departure: '2026-11-09' }).length);
});

test('权限同时限制订单归属、酒店业务、独立日志授权及授权撤销', (t) => {
  const f = fixture(t);
  const order = f.submit().result.order;
  assert.throws(() => f.reservations.orderFor(other, order.id), { code: 'FORBIDDEN' });
  assert.equal(myOrders(f.db, other).length, 0);
  assert.throws(() => f.operations.listRooms(desk, 2), { code: 'FORBIDDEN' });
  assert.throws(() => auditList(f.db, desk, {}), { code: 'AUDIT_FORBIDDEN' });
  assert.equal(auditList(f.db, auditor, { hotelId: 1 }).length, 1);
  f.operations.setGrant(admin, { accountId: auditor.id, hotelId: 1, manage: true, audit: false });
  assert.throws(() => auditList(f.db, auditor, { hotelId: 1 }), { code: 'AUDIT_FORBIDDEN' });
  assert.ok(auditList(f.db, admin, {}).some((item) => item.restricted === 1));
  assert.ok(auditList(f.db, auditor, {}).every((item) => item.restricted === 0));
});

test('订单筛选使用当前计划入住日，间夜统计只计算交叠住宿夜', (t) => {
  const f = fixture(t);
  const order = f.submit().result.order;
  assert.equal(operationsOrders(f.db, admin, { from: '2026-11-06', to: '2026-11-06' }).length, 1);
  const range = { from: '2026-11-07', to: '2026-11-08', hotelId: 1 };
  assert.deepEqual({ ...occupancy(f.db, admin, range) }, { orders: 1, cancelled: 0, room_nights: 4 });
  f.reservations.edit(guest, order.id, order, '取消预订');
  assert.deepEqual({ ...occupancy(f.db, admin, range) }, { orders: 1, cancelled: 1, room_nights: 0 });
  assert.equal(occupancy(f.db, admin, { from: '2026-11-09', to: '2026-11-09' }).orders, 0);
});

test('新连接可还原提交后的房量、成交价和操作日志', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'bosu-persist-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'test.db');
  const f = fixture(t, path);
  const order = f.submit().result.order;
  const reopened = new Repository(path, () => base);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.snapshot(order.id), f.db.snapshot(order.id));
  assert.equal(reopened.get('SELECT COUNT(*) AS n FROM audit').n, 1);
  assert.equal(
    reopened.get("SELECT reserved FROM offers WHERE type_id=1 AND night='2026-11-07'").reserved,
    2,
  );
});

test('顾客注册与密码匹配，已注销的会话不能再次读取账号', (t) => {
  const f = fixture(t);
  const password = ' spaced-password ';
  const account = register(f.db, { username: 'new-guest', name: '新用户', password });
  assert.equal(account.actor.role, 'guest');
  assert.equal(identify(f.db, account.cookie).name, '新用户');
  logout(f.db, account.cookie);
  assert.equal(identify(f.db, account.cookie), null);
  assert.throws(() => login(f.db, { username: 'new-guest', password: password.trim() }), { code: 'LOGIN' });
  assert.throws(() => register(f.db, { username: 'new-guest', name: '另一个人', password }), {
    code: 'USERNAME',
  });
});

test('20个并发HTTP下单请求竞争最后一间，整笔提交只有一份', async (t) => {
  const f = fixture(t);
  const plan = { ...standard, quantity: 1, guests: 2 };
  const server = createWorkspace(f.db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  f.editDay('2026-11-07', { capacity: 1 });
  const secret = f.db.get('SELECT digest FROM accounts WHERE id=1').digest;
  const attempts = [];
  for (let index = 1; index <= 20; index += 1) {
    const unique = 'race' + index;
    f.db.run("INSERT INTO accounts(username,name,role,digest) VALUES(?,?,'guest',?)", unique, unique, secret);
    const current = login(f.db, { username: unique, password: 'bosu-demo' });
    const quote = f.reservations.quote(current.actor, plan);
    attempts.push({ cookie: current.cookie, quoteId: quote.id, requestKey: unique });
  }
  const address = 'http://127.0.0.1:' + server.address().port;
  const results = await Promise.all(
    attempts.map(async ({ cookie, ...request }) => {
      const response = await fetch(address + '/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ ...request, ...plan, guestName: '抢订测试' }),
      });
      return { status: response.status, body: await response.json() };
    }),
  );
  assert.equal(
    results.filter((result) => result.status === 200 && result.body.outcome === 'saved').length,
    1,
  );
  assert.equal(results.filter((result) => result.body.code === 'SOLD_OUT').length, 19);
  assert.deepEqual(f.occupied(), [1, 1, 1, 0]);
});

test('同一标识并发提交通过持久结果重放', async (t) => {
  const f = fixture(t);
  const server = createWorkspace(f.db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const session = login(f.db, { username: 'guest', password: 'bosu-demo' });
  const quote = f.reservations.quote(guest, standard);
  const address = 'http://127.0.0.1:' + server.address().port;
  const results = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const response = await fetch(address + '/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
        body: JSON.stringify({ ...standard, guestName: '重发测试', quoteId: quote.id, requestKey: 'repeat' }),
      });
      assert.equal(response.status, 200);
      return (await response.json()).id;
    }),
  );
  assert.equal(new Set(results).size, 1);
  assert.deepEqual(f.occupied(), [2, 2, 2, 0]);
});
