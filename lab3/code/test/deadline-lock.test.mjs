import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Operations } from '../src/operations.mjs';
import { Repository } from '../src/repository.mjs';
import { Reservations } from '../src/reservation.mjs';
import { seedDemo } from '../src/seed.mjs';

async function holdWriteLock(path) {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE');
    process.stdout.write('locked');
    setTimeout(() => { db.exec('COMMIT'); db.close(); }, 520);
  `,
      path,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const exit = once(child, 'exit');
  const [message] = await Promise.race([once(child.stdout, 'data'), exit]);
  assert.equal(String(message), 'locked');
  return { exit };
}

test('跨进程写锁等待跨过截止时，以取得锁后的时间判断', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'bosu-deadline-'));
  const path = join(folder, 'race.db');
  const morning = Date.parse('2026-11-24T10:00:00+08:00');
  let now = morning;
  let anchor = null;
  const db = new Repository(path, () => (anchor === null ? now : now + performance.now() - anchor));
  t.after(() => {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  seedDemo(db);
  const reservations = new Reservations(db);
  const operations = new Operations(db, reservations);
  const customer = { id: 1, role: 'guest' };
  const staff = { id: 3, role: 'staff' };
  function make(typeId) {
    const plan = { typeId, arrival: '2026-11-24', departure: '2026-11-25', quantity: 1, guests: 1 };
    const quote = reservations.quote(customer, plan);
    return reservations.commit(customer, {
      ...plan,
      requestKey: 'type-' + typeId,
      quoteId: quote.id,
      guestName: '住客',
    }).order;
  }
  async function at(boundary, check) {
    const { exit: released } = await holdWriteLock(path);
    now = boundary - 130;
    anchor = performance.now();
    try {
      check();
    } finally {
      anchor = null;
      const [code] = await released;
      assert.equal(code, 0);
    }
  }

  const waiting = make(1);
  const editable = make(2);
  const confirmed = operations.handleOrder(staff, editable.id, '酒店确认', { version: editable.version });
  await at(waiting.deadline, () => {
    assert.throws(() => operations.handleOrder(staff, waiting.id, '酒店确认', { version: waiting.version }), {
      code: 'DEADLINE',
    });
    assert.equal(db.order(waiting.id).state, 'cancelled');
  });
  await at(Date.parse('2026-11-24T18:00:00+08:00'), () => {
    assert.throws(
      () => reservations.edit(customer, confirmed.id, { version: confirmed.version }, '取消预订'),
      { code: 'CUTOFF' },
    );
    assert.equal(db.order(confirmed.id).state, 'confirmed');
  });
});
