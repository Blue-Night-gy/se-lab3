import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const CONFIRMATION_MS = 20 * 60000;
export const QUOTE_MS = 15 * 60000;
export const BEIJING = 8 * HOUR;

export const STATE = Object.freeze({
  pending: 'pending',
  confirmed: 'confirmed',
  staying: 'staying',
  completed: 'completed',
  cancelled: 'cancelled',
});

export class Fault extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function requireThat(condition, code, message, status) {
  if (!condition) throw new Fault(code, message, status);
}

export function text(value, label, max = 80) {
  requireThat(
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max,
    'INPUT',
    label + '无效',
  );
  return value.trim();
}

export function integer(value, label, min = 1, max = 1000000000) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  requireThat(
    Number.isSafeInteger(value) && value >= min && value <= max,
    'INPUT',
    label + '须为' + min + '至' + max + '之间的整数',
  );
  return value;
}

export function day(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'DATE', '请输入有效的住宿日期');
  const instant = Date.parse(value + 'T00:00:00Z');
  requireThat(Number.isFinite(instant) && isoDay(instant) === value, 'DATE', '住宿日期无效');
  return value;
}

export function isoDay(instant) {
  return new Date(instant).toISOString().slice(0, 10);
}

export function today(now) {
  return isoDay(now + BEIJING);
}

export function addDays(value, amount) {
  return isoDay(Date.parse(value) + amount * DAY);
}

export function nightsBetween(start, end) {
  return (Date.parse(end) - Date.parse(start)) / DAY;
}

export class StayPlan {
  constructor(value) {
    this.typeId = integer(value.typeId, '房型');
    this.arrival = day(value.arrival);
    this.departure = day(value.departure);
    this.quantity = integer(value.quantity, '预订间数', 1, 12);
    this.guests = integer(value.guests, '入住人数', 1, 48);
    requireThat(this.length > 0 && this.length <= 45, 'DATE', '住宿须为1至45晚');
  }

  get length() {
    return nightsBetween(this.arrival, this.departure);
  }

  get nights() {
    return Array.from({ length: this.length }, (_, index) => addDays(this.arrival, index));
  }

  get cutoff() {
    return Date.parse(this.arrival) + 18 * HOUR - BEIJING;
  }

  sameAllocation(other) {
    return (
      this.typeId === other.typeId &&
      this.arrival === other.arrival &&
      this.departure === other.departure &&
      this.quantity === other.quantity
    );
  }
}

export function stayFrom(order) {
  return new StayPlan({
    typeId: order.type_id,
    arrival: order.arrival,
    departure: order.departure,
    quantity: order.quantity,
    guests: order.guests,
  });
}

export const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const token = () => randomBytes(24).toString('base64url');
export const encode = (value) => JSON.stringify(value ?? null);
export const decode = (value) => JSON.parse(value ?? 'null');

export function passwordDigest(password) {
  requireThat(
    typeof password === 'string' &&
      password.length >= 8 &&
      password.length <= 128 &&
      password.trim().length > 0,
    'INPUT',
    '密码须为8至128位',
  );
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 32).toString('hex');
}

export function passwordMatches(password, digest) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, encoded] = digest.split(':');
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(encoded, 'hex'));
}

export function requireRole(actor, ...roles) {
  requireThat(actor, 'LOGIN_REQUIRED', '请先登录', 401);
  requireThat(roles.includes(actor.role), 'FORBIDDEN', '当前账号没有此操作权限', 403);
}

export function requireManage(db, actor, hotelId) {
  requireRole(actor, 'staff', 'admin');
  if (actor.role === 'admin') return;
  requireThat(
    db.get('SELECT 1 FROM grants WHERE account_id=? AND hotel_id=?', actor.id, hotelId),
    'FORBIDDEN',
    '当前账号无权处理该酒店',
    403,
  );
}

export function requireOwner(actor, order) {
  requireRole(actor, 'guest');
  requireThat(actor.id === order.customer_id, 'FORBIDDEN', '无权访问该预订', 403);
}

export function requireEditable(order, now) {
  requireThat([STATE.pending, STATE.confirmed].includes(order.state), 'STATE', '当前订单不可修改或取消', 409);
  requireThat(now < stayFrom(order).cutoff, 'CUTOFF', '已到入住日18:00的修改和取消截止时刻', 409);
}

export function checkVersion(order, version) {
  requireThat(
    integer(version, '订单版本') === order.version,
    'STALE_VERSION',
    '订单已经改变，请刷新后重试',
    409,
  );
}
