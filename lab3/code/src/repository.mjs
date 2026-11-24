import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { encode, Fault, requireThat } from './model.mjs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const insertLog = `INSERT OR IGNORE INTO audit(
  operation,instant,actor_id,hotel_id,action,target,result,old_value,new_value,detail,restricted
) VALUES(?,?,?,?,?,?,?,?,?,?,?)`;

const orderQuery = `SELECT o.*,t.hotel_id,t.name AS type_name,t.code AS type_code,
  t.photo,t.capacity,h.name AS hotel_name,h.city,h.location
  FROM orders o JOIN types t ON t.id=o.type_id JOIN hotels h ON h.id=t.hotel_id`;

export class Repository {
  constructor(path = ':memory:', clock = Date.now) {
    this.connection = new DatabaseSync(path);
    this.clock = clock;
    this.connection.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
    this.connection.exec(schema);
  }

  get(sql, ...parameters) {
    return this.connection.prepare(sql).get(...parameters);
  }

  all(sql, ...parameters) {
    return this.connection.prepare(sql).all(...parameters);
  }

  run(sql, ...parameters) {
    return this.connection.prepare(sql).run(...parameters);
  }

  transaction(work, mode = 'IMMEDIATE') {
    this.connection.exec(mode === 'IMMEDIATE' ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      const result = work();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  log(meta, result, detail = '') {
    this.run(
      insertLog,
      meta.operation,
      meta.now,
      meta.actor?.id ?? null,
      meta.hotelId ?? null,
      meta.action,
      meta.target ?? '',
      result,
      encode(meta.before),
      encode(result === 'ok' ? meta.after : meta.before),
      detail,
      Number(Boolean(meta.restricted)),
    );
  }

  change(meta, work) {
    const entry = { operation: randomUUID(), ...meta };
    try {
      return this.transaction(() => {
        entry.now ??= this.clock();
        const result = work(entry);
        if (!entry.skip) this.log(entry, 'ok');
        return result;
      });
    } catch (error) {
      entry.now ??= this.clock();
      const detail = error instanceof Fault ? error.message : '事务写入失败，已回滚';
      try {
        this.transaction(() => this.log(entry, 'failed', detail));
      } catch (auditError) {
        console.error('无法保存失败记录:', auditError.message);
      }
      throw error;
    }
  }

  order(id) {
    const row = this.get(orderQuery + ' WHERE o.id=?', id);
    requireThat(row, 'NOT_FOUND', '预订记录不存在', 404);
    return row;
  }

  listOrders(where, parameters) {
    return this.all(
      orderQuery + ' WHERE ' + where.join(' AND ') + ' ORDER BY o.arrival,o.id DESC LIMIT 150',
      ...parameters,
    );
  }

  snapshot(id) {
    return {
      ...this.order(id),
      prices: this.all('SELECT night,unit FROM order_prices WHERE order_id=? ORDER BY night', id),
      rooms: this.all(
        `SELECT a.id,r.number,r.state,a.checked_in,a.checked_out
        FROM allocations a JOIN rooms r ON r.id=a.room_id WHERE a.order_id=? ORDER BY r.number`,
        id,
      ),
    };
  }

  close() {
    this.connection.close();
  }
}
