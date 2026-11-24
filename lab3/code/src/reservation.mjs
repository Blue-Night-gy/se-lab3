import {
  CONFIRMATION_MS,
  QUOTE_MS,
  STATE,
  StayPlan,
  checkVersion,
  decode,
  encode,
  fingerprint,
  integer,
  requireEditable,
  requireManage,
  requireOwner,
  requireRole,
  requireThat,
  stayFrom,
  text,
  today,
  token,
} from './model.mjs';
import { adjustInventory, buildQuote, readQuote, storeQuote } from './catalog.mjs';

function priceTotal(prices, quantity) {
  return prices.reduce((sum, row) => sum + row.unit * quantity, 0);
}

function savePrices(db, id, prices) {
  db.run('DELETE FROM order_prices WHERE order_id=?', id);
  for (const { night, unit } of prices) {
    db.run('INSERT INTO order_prices(order_id,night,unit) VALUES(?,?,?)', id, night, unit);
  }
}

function similarOrders(db, actor, plan) {
  return db.all(
    `SELECT id,guest_name,state FROM orders WHERE customer_id=? AND type_id=?
    AND arrival=? AND departure=? AND quantity=? AND state IN ('pending','confirmed') ORDER BY id`,
    actor.id,
    plan.typeId,
    plan.arrival,
    plan.departure,
    plan.quantity,
  );
}

function duplicateKey(plan) {
  return encode([plan.typeId, plan.arrival, plan.departure, plan.quantity]);
}

export class Reservations {
  constructor(db) {
    this.db = db;
  }

  expireVersion(id, version, now = this.db.clock()) {
    return this.db.change({ now, action: '确认到期', target: '预订 ' + id }, (entry) => {
      const order = this.db.order(id);
      if (order.state !== STATE.pending || order.version !== version || order.deadline > now) {
        entry.skip = true;
        return false;
      }
      entry.hotelId = order.hotel_id;
      entry.before = this.db.snapshot(id);
      adjustInventory(this.db, stayFrom(order), null);
      this.db.run(
        `UPDATE orders SET state='cancelled',changed_at=?,version=version+1,reason=? WHERE id=?`,
        now,
        '酒店20分钟内未确认',
        id,
      );
      entry.after = this.db.snapshot(id);
      return true;
    });
  }

  expireDue(now = this.db.clock()) {
    const candidates = this.db.all(
      `SELECT id,version FROM orders
      WHERE state='pending' AND deadline<=? ORDER BY deadline,id`,
      now,
    );
    for (const item of candidates) this.expireVersion(item.id, item.version, now);
    return candidates.length;
  }

  withFreshOrders(work) {
    this.expireDue();
    try {
      return work();
    } catch (error) {
      if (error.code === 'DEADLINE') this.expireDue();
      throw error;
    }
  }

  checkDeadline(order, now) {
    requireThat(
      order.state !== STATE.pending || order.deadline > now,
      'DEADLINE',
      '订单已到确认截止时间，已取消并释放房量',
      409,
    );
  }

  quote(actor, value, orderId = null) {
    requireRole(actor, 'guest');
    const plan = new StayPlan(value);
    return this.withFreshOrders(() =>
      this.db.transaction(() => {
        const now = this.db.clock();
        requireThat(
          plan.arrival >= today(now) && now < plan.cutoff,
          'PAST_STAY',
          '请选择尚未超过当日接待截止的行程',
        );
        const previous = orderId === null ? null : this.db.order(orderId);
        if (previous) {
          requireOwner(actor, previous);
          this.checkDeadline(previous, now);
          requireEditable(previous, now);
        }
        return storeQuote(
          this.db,
          actor,
          buildQuote(this.db, plan, previous && stayFrom(previous)),
          previous,
          now,
        );
      }),
    );
  }

  commit(actor, payload, orderId = null) {
    requireRole(actor, 'guest');
    const key = text(payload.requestKey, '提交标识', 120);
    const plan = new StayPlan(payload);
    const guest = text(payload.guestName, '入住人');
    const signature = fingerprint([orderId, plan, guest, payload.quoteId, payload.decisionId ?? null]);
    const operation = fingerprint([actor.id, key, signature]);
    return this.withFreshOrders(() =>
      this.db.change(
        {
          actor,
          operation,
          action: orderId ? '调整住宿' : '提交预订',
          target: orderId ? '预订 ' + orderId : '房型 ' + plan.typeId,
        },
        (entry) => {
          const now = entry.now;
          const prior = this.db.get(
            'SELECT fingerprint,result FROM submissions WHERE customer_id=? AND key=?',
            actor.id,
            key,
          );
          if (prior) {
            requireThat(prior.fingerprint === signature, 'KEY_REUSED', '提交标识不可用于不同内容', 409);
            entry.skip = true;
            return decode(prior.result);
          }
          requireThat(plan.arrival >= today(now) && now < plan.cutoff, 'PAST_STAY', '所选住宿已过接待截止');
          const order = orderId ? this.db.order(orderId) : null;
          if (order) {
            requireOwner(actor, order);
            this.checkDeadline(order, now);
            requireEditable(order, now);
            entry.before = this.db.snapshot(orderId);
          }
          const oldPrices = readQuote(this.db, payload.quoteId, actor, plan, order, now);
          const fresh = buildQuote(this.db, plan, order && stayFrom(order));
          entry.hotelId = fresh.item.hotel_id;
          if (order && order.hotel_id !== fresh.item.hotel_id) entry.restricted = true;
          const finish = (result) => {
            this.db.run('INSERT INTO submissions VALUES(?,?,?,?)', actor.id, key, signature, encode(result));
            return result;
          };
          if (encode(oldPrices) !== encode(fresh.prices)) {
            entry.action = '重新报价';
            entry.after = { total: fresh.total, prices: fresh.prices };
            return finish({
              outcome: 'repriced',
              previousTotal: priceTotal(oldPrices, plan.quantity),
              oldPrices,
              quote: storeQuote(this.db, actor, fresh, order, now),
            });
          }

          if (!order) {
            const decision = this.checkDuplicate(actor, plan, payload.decisionId, now);
            if (decision) {
              entry.action = '重复行程提示';
              entry.after = { matches: decision.orders.map((item) => item.id) };
              return finish(decision);
            }
          }

          const id = orderId
            ? this.writeAmendment(order, plan, guest, fresh, now)
            : this.writeNew(actor, plan, guest, fresh, now);
          entry.target = '预订 ' + id;
          entry.after = this.db.snapshot(id);
          return finish({ outcome: 'saved', id, order: entry.after });
        },
      ),
    );
  }

  checkDuplicate(actor, plan, decisionId, now) {
    const orders = similarOrders(this.db, actor, plan);
    if (orders.length === 0) return null;
    const match = encode(orders.map((item) => item.id));
    const planKey = duplicateKey(plan);
    const accepted =
      decisionId &&
      this.db.get(
        `SELECT 1 FROM duplicate_decisions
      WHERE id=? AND customer_id=? AND plan=? AND matches=? AND expires_at>?`,
        decisionId,
        actor.id,
        planKey,
        match,
        now,
      );
    if (accepted) {
      this.db.run('DELETE FROM duplicate_decisions WHERE id=?', decisionId);
      return null;
    }
    const id = token();
    this.db.run(
      'INSERT INTO duplicate_decisions VALUES(?,?,?,?,?)',
      id,
      actor.id,
      planKey,
      match,
      now + QUOTE_MS,
    );
    return { outcome: 'duplicate', decisionId: id, orders };
  }

  writeNew(actor, plan, guest, quote, now) {
    const result = this.db.run(
      `INSERT INTO orders(
      customer_id,type_id,arrival,departure,quantity,guests,guest_name,state,total,
      created_at,changed_at,deadline) VALUES(?,?,?,?,?,?,?,'pending',?,?,?,?)`,
      actor.id,
      plan.typeId,
      plan.arrival,
      plan.departure,
      plan.quantity,
      plan.guests,
      guest,
      quote.total,
      now,
      now,
      now + CONFIRMATION_MS,
    );
    const id = Number(result.lastInsertRowid);
    adjustInventory(this.db, null, plan);
    savePrices(this.db, id, quote.prices);
    return id;
  }

  writeAmendment(order, plan, guest, quote, now) {
    const previous = stayFrom(order);
    requireThat(!plan.sameAllocation(previous), 'UNCHANGED', '行程未变，请通过入住人更正操作修改');
    adjustInventory(this.db, previous, plan);
    savePrices(this.db, order.id, quote.prices);
    this.db.run(
      `UPDATE orders SET type_id=?,arrival=?,departure=?,quantity=?,guests=?,
      guest_name=?,state='pending',total=?,changed_at=?,deadline=?,version=version+1
      WHERE id=?`,
      plan.typeId,
      plan.arrival,
      plan.departure,
      plan.quantity,
      plan.guests,
      guest,
      quote.total,
      now,
      now + CONFIRMATION_MS,
      order.id,
    );
    return order.id;
  }

  edit(actor, orderId, input, action) {
    return this.withFreshOrders(() =>
      this.db.change({ actor, action, target: '预订 ' + orderId }, (entry) => {
        const now = entry.now;
        const order = this.db.order(orderId);
        entry.hotelId = order.hotel_id;
        requireOwner(actor, order);
        this.checkDeadline(order, now);
        checkVersion(order, input.version);
        requireEditable(order, now);
        entry.before = this.db.snapshot(orderId);
        if (action === '取消预订') {
          adjustInventory(this.db, stayFrom(order), null);
          this.db.run(
            `UPDATE orders SET state='cancelled',version=version+1,changed_at=?,reason=?
          WHERE id=?`,
            now,
            '顾客取消，费用 ¥0',
            orderId,
          );
        } else {
          const name = text(input.guestName, '入住人');
          this.db.run(
            `UPDATE orders SET guest_name=?,version=version+1,changed_at=?
          WHERE id=?`,
            name,
            now,
            orderId,
          );
        }
        entry.after = this.db.snapshot(orderId);
        return entry.after;
      }),
    );
  }

  orderFor(actor, orderId) {
    const id = integer(orderId, '预订编号');
    this.expireDue();
    const order = this.db.order(id);
    if (actor?.role === 'guest') requireOwner(actor, order);
    else requireManage(this.db, actor, order.hotel_id);
    return this.db.snapshot(id);
  }
}
