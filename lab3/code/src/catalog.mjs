import {
  StayPlan,
  QUOTE_MS,
  day,
  decode,
  encode,
  integer,
  nightsBetween,
  requireThat,
  text,
  today,
  token,
} from './model.mjs';

export const PHOTOS = [
  'wood-twin.jpg',
  'wood-room.jpg',
  'room-river.jpg',
  'room-city.jpg',
  'room-deluxe.jpg',
  'warm-twin.jpg',
];

export function typeDetails(db, id) {
  const item = db.get(
    `SELECT t.*,h.code AS hotel_code,h.name AS hotel_name,h.city,h.location
    FROM types t JOIN hotels h ON h.id=t.hotel_id WHERE t.id=?`,
    id,
  );
  requireThat(item, 'NOT_FOUND', '房型不存在', 404);
  return item;
}

export function catalogSearch(db, filters) {
  const sample = new StayPlan({ ...filters, typeId: 1 });
  const now = db.clock();
  requireThat(
    sample.arrival >= today(now) && now < sample.cutoff,
    'PAST_STAY',
    '请选择尚未超过当日接待截止的行程',
  );
  const clauses = [
    'n.night>=?',
    'n.night<?',
    'n.stopped=0',
    'n.price IS NOT NULL',
    't.capacity * ?>=?',
    `NOT EXISTS (
      SELECT 1 FROM blocks b WHERE b.hotel_id=h.id AND b.active=1
      AND (b.type_id IS NULL OR b.type_id=t.id) AND b.start<=n.night AND b.end>n.night
    )`,
  ];
  const params = [sample.arrival, sample.departure, sample.quantity, sample.guests];
  if (filters.city) {
    clauses.push('h.city=?');
    params.push(text(filters.city, '城市'));
  }
  if (filters.type) {
    clauses.push('instr(t.name,?)>0');
    params.push(text(filters.type, '房型名称'));
  }
  const lower = filters.min ? integer(filters.min, '最低总价', 0) : 0;
  const upper = filters.max ? integer(filters.max, '最高总价', 0) : 1000000000;
  requireThat(lower <= upper, 'PRICE_RANGE', '最低总价不能大于最高总价');
  return db.all(
    `SELECT t.id,t.name,t.capacity,t.description,t.photo,h.name AS hotel_name,
    h.city,h.location,h.id AS hotel_id,MIN(n.capacity-n.reserved) AS available,
    SUM(n.price)*? AS total
    FROM offers n JOIN types t ON n.type_id=t.id JOIN hotels h ON h.id=t.hotel_id
    WHERE ${clauses.join(' AND ')}
    GROUP BY t.id HAVING COUNT(*)=? AND MIN(n.capacity-n.reserved)>=?
    AND total BETWEEN ? AND ? ORDER BY total,t.id LIMIT 150`,
    sample.quantity,
    ...params,
    sample.length,
    sample.quantity,
    lower,
    upper,
  );
}

export class PriceQuote {
  constructor(plan, prices, available, item) {
    this.plan = plan;
    this.prices = prices;
    this.available = available;
    this.total = prices.reduce((sum, row) => sum + row.unit * plan.quantity, 0);
    this.item = item;
  }
}

export function buildQuote(db, plan, held = null) {
  const item = typeDetails(db, plan.typeId);
  requireThat(plan.guests <= item.capacity * plan.quantity, 'CAPACITY', '入住人数超出所选客房容量');
  const block = db.get(
    `SELECT reason FROM blocks
    WHERE hotel_id=? AND active=1 AND (type_id IS NULL OR type_id=?) AND start<? AND end>?`,
    item.hotel_id,
    plan.typeId,
    plan.departure,
    plan.arrival,
  );
  requireThat(!block, 'BLOCKED', '行程遇到暂停接待日期', 409);

  const offers = db.all(
    `SELECT night,price,capacity,reserved,stopped FROM offers
    WHERE type_id=? AND night>=? AND night<? ORDER BY night`,
    plan.typeId,
    plan.arrival,
    plan.departure,
  );
  requireThat(offers.length === plan.length, 'NO_OFFER', '行程含未开放报价的日期', 409);
  let available = Number.POSITIVE_INFINITY;
  const prices = [];
  for (const row of offers) {
    requireThat(!row.stopped && row.price !== null, 'NO_OFFER', row.night + '停售或尚未定价', 409);
    const own =
      held && held.typeId === plan.typeId && row.night >= held.arrival && row.night < held.departure
        ? held.quantity
        : 0;
    available = Math.min(available, row.capacity - row.reserved + own);
    prices.push({ night: row.night, unit: row.price });
  }
  requireThat(available >= plan.quantity, 'SOLD_OUT', '至少一晚余量少于所选间数', 409);
  return new PriceQuote(plan, prices, available, item);
}

export function storeQuote(db, actor, quote, order = null, instant = db.clock()) {
  const id = token();
  const expires = instant + QUOTE_MS;
  db.run(
    `INSERT INTO quote(id,customer_id,order_id,order_version,plan,prices,expires_at)
    VALUES(?,?,?,?,?,?,?)`,
    id,
    actor.id,
    order?.id ?? null,
    order?.version ?? null,
    encode(quote.plan),
    encode(quote.prices),
    expires,
  );
  return { id, expires, ...quote };
}

export function readQuote(db, id, actor, plan, order, now) {
  const row = db.get('SELECT * FROM quote WHERE id=? AND customer_id=?', text(id, '报价编号'), actor.id);
  requireThat(row && row.expires_at > now, 'QUOTE_EXPIRED', '报价已失效，请重新获取', 409);
  requireThat(
    row.plan === encode(plan) && row.order_id === (order?.id ?? null),
    'QUOTE_SCOPE',
    '报价与当前住宿安排不一致，请重新获取',
    409,
  );
  requireThat(
    row.order_version === (order?.version ?? null),
    'STALE_VERSION',
    '订单已经改变，请重新获取改期报价',
    409,
  );
  return decode(row.prices);
}

export function adjustInventory(db, oldPlan, newPlan) {
  const deltas = new Map();
  for (const [plan, sign] of [
    [oldPlan, -1],
    [newPlan, 1],
  ]) {
    if (!plan) continue;
    for (const night of plan.nights) {
      const key = plan.typeId + ':' + night;
      const prior = deltas.get(key)?.delta ?? 0;
      deltas.set(key, { id: plan.typeId, night, delta: prior + sign * plan.quantity });
    }
  }
  for (const { id, night, delta } of deltas.values()) {
    if (delta === 0) continue;
    const saved = db.run(
      `UPDATE offers SET reserved=reserved+?
      WHERE type_id=? AND night=? AND reserved+? BETWEEN 0 AND capacity`,
      delta,
      id,
      night,
      delta,
    );
    requireThat(saved.changes === 1, 'INVENTORY_CONFLICT', night + '库存已变化，请重新核对', 409);
  }
}

export function checkedInterval(start, end, max = 366) {
  const from = day(start);
  const to = day(end);
  requireThat(to > from && nightsBetween(from, to) <= max, 'DATE', '日期范围无效');
  return { from, to };
}
