import { STATE, addDays, day, integer, requireManage, requireRole, requireThat, text } from './model.mjs';

function range(input) {
  const from = input.from ? day(input.from) : null;
  const to = input.to ? day(input.to) : null;
  requireThat(!from || !to || from <= to, 'DATE', '起始日期须不晚于结束日期');
  return { from, to };
}

function visibleHotel(actor, input) {
  const where = [];
  const parameters = [];
  if (actor.role === 'staff') {
    where.push('EXISTS (SELECT 1 FROM grants g WHERE g.account_id=? AND g.hotel_id=h.id)');
    parameters.push(actor.id);
  }
  if (input.hotelId) {
    where.push('h.id=?');
    parameters.push(integer(input.hotelId, '酒店'));
  }
  if (input.city) {
    where.push('h.city=?');
    parameters.push(text(input.city, '城市'));
  }
  return { where, parameters };
}

export function myOrders(db, actor) {
  requireRole(actor, 'guest');
  return db.listOrders(['o.customer_id=?'], [actor.id]);
}

export function operationsOrders(db, actor, input) {
  requireRole(actor, 'admin', 'staff');
  if (input.hotelId) requireManage(db, actor, integer(input.hotelId, '酒店'));
  const { where, parameters } = visibleHotel(actor, input);
  const { from, to } = range(input);
  if (from) {
    where.push('o.arrival>=?');
    parameters.push(from);
  }
  if (to) {
    where.push('o.arrival<=?');
    parameters.push(to);
  }
  if (input.state) {
    requireThat(Object.values(STATE).includes(input.state), 'STATE', '无效订单状态');
    where.push('o.state=?');
    parameters.push(input.state);
  }
  return db.listOrders(where.length ? where : ['1=1'], parameters);
}

export function occupancy(db, actor, input) {
  requireRole(actor, 'admin', 'staff');
  if (input.hotelId) requireManage(db, actor, integer(input.hotelId, '酒店'));
  const { where, parameters } = visibleHotel(actor, input);
  const { from, to } = range(input);
  requireThat(from && to, 'DATE', '请选择统计起止日期');
  const end = addDays(to, 1);
  where.push('o.arrival<?', 'o.departure>?');
  return db.get(
    `SELECT COUNT(*) AS orders,
    COALESCE(SUM(o.state='cancelled'),0) AS cancelled,
    CAST(COALESCE(SUM(CASE WHEN o.state!='cancelled' THEN
      (julianday(MIN(o.departure,?))-julianday(MAX(o.arrival,?)))*o.quantity
      ELSE 0 END),0) AS INTEGER) AS room_nights
    FROM orders o JOIN types t ON t.id=o.type_id JOIN hotels h ON h.id=t.hotel_id
    WHERE ${where.join(' AND ')}`,
    end,
    from,
    ...parameters,
    end,
    from,
  );
}

export function hotelsFor(db, actor) {
  requireRole(actor, 'admin', 'staff');
  if (actor.role === 'admin') return db.all('SELECT * FROM hotels ORDER BY city,name');
  return db.all(
    `SELECT h.*,g.audit FROM hotels h JOIN grants g ON g.hotel_id=h.id
    WHERE g.account_id=? ORDER BY h.city,h.name`,
    actor.id,
  );
}

export function typesFor(db, actor, hotelId) {
  requireManage(db, actor, hotelId);
  return db.all('SELECT * FROM types WHERE hotel_id=? ORDER BY name', hotelId);
}

export function accountList(db, actor) {
  requireRole(actor, 'admin');
  return {
    accounts: db.all('SELECT id,username,name,role,enabled FROM accounts ORDER BY role,username'),
    grants: db.all(`SELECT g.*,h.name AS hotel_name,a.name AS account_name FROM grants g
      JOIN hotels h ON h.id=g.hotel_id JOIN accounts a ON a.id=g.account_id ORDER BY a.name,h.name`),
  };
}

export function auditList(db, actor, input) {
  requireRole(actor, 'admin', 'staff');
  const where = ['1=1'];
  const parameters = [];
  const { from, to } = range(input);
  if (actor.role === 'staff') {
    const grant = input.hotelId
      ? db.get(
          'SELECT 1 FROM grants WHERE account_id=? AND audit=1 AND hotel_id=?',
          actor.id,
          integer(input.hotelId, '酒店'),
        )
      : db.get('SELECT 1 FROM grants WHERE account_id=? AND audit=1', actor.id);
    requireThat(grant, 'AUDIT_FORBIDDEN', '该酒店未授予独立日志查看权限', 403);
    where.push(
      'l.restricted=0',
      `EXISTS (SELECT 1 FROM grants g
      WHERE g.account_id=? AND g.audit=1 AND g.hotel_id=l.hotel_id)`,
    );
    parameters.push(actor.id);
  }
  if (from) {
    where.push('l.instant>=?');
    parameters.push(Date.parse(from + 'T00:00:00+08:00'));
  }
  if (to) {
    where.push('l.instant<?');
    parameters.push(Date.parse(addDays(to, 1) + 'T00:00:00+08:00'));
  }
  if (input.hotelId) {
    where.push('l.hotel_id=?');
    parameters.push(integer(input.hotelId, '酒店'));
  }
  if (input.target) {
    where.push('instr(l.target,?)>0');
    parameters.push(text(input.target, '对象'));
  }
  if (input.operator) {
    where.push("instr(COALESCE(a.name,'系统'),?)>0");
    parameters.push(text(input.operator, '操作人'));
  }
  if (input.result) {
    requireThat(['ok', 'failed'].includes(input.result), 'INPUT', '无效操作结果');
    where.push('l.result=?');
    parameters.push(input.result);
  }
  return db.all(
    `SELECT l.*,COALESCE(a.name,'系统') AS operator,h.name AS hotel_name FROM audit l
    LEFT JOIN accounts a ON a.id=l.actor_id LEFT JOIN hotels h ON h.id=l.hotel_id
    WHERE ${where.join(' AND ')} ORDER BY l.instant DESC,l.id DESC LIMIT 150`,
    ...parameters,
  );
}
