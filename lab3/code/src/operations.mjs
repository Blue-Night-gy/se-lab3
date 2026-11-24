import {
  STATE,
  checkVersion,
  day,
  integer,
  passwordDigest,
  requireManage,
  requireRole,
  requireThat,
  text,
} from './model.mjs';
import { PHOTOS, checkedInterval, typeDetails } from './catalog.mjs';

function hotel(db, id) {
  const item = db.get('SELECT * FROM hotels WHERE id=?', id);
  requireThat(item, 'NOT_FOUND', '酒店不存在', 404);
  return item;
}

function room(db, id) {
  const item = db.get(
    `SELECT r.*,t.hotel_id,t.name AS type_name FROM rooms r
    JOIN types t ON t.id=r.type_id WHERE r.id=?`,
    id,
  );
  requireThat(item, 'NOT_FOUND', '客房不存在', 404);
  return item;
}

function loadBlock(db, id) {
  const item = db.get('SELECT * FROM blocks WHERE id=?', id);
  requireThat(item, 'NOT_FOUND', '停售区间不存在', 404);
  return item;
}

function checkCode(code) {
  requireThat(/^[A-Z0-9-]{2,16}$/.test(code), 'INPUT', '编号须为2至16位大写字母、数字或短横线');
  return code;
}

function photo(value) {
  return PHOTOS.includes(value) ? value : PHOTOS[0];
}

function createBlock(db, actor, { hotelId, typeId, roomId = null, start, end, reason }) {
  const { from, to } = checkedInterval(start, end);
  const result = db.run(
    `INSERT INTO blocks(hotel_id,type_id,room_id,start,end,reason,actor_id)
    VALUES(?,?,?,?,?,?,?)`,
    hotelId,
    typeId,
    roomId,
    from,
    to,
    text(reason, '原因', 200),
    actor.id,
  );
  const id = Number(result.lastInsertRowid);
  db.run(
    `INSERT INTO coordination(order_id,block_id)
    SELECT o.id,? FROM orders o JOIN types t ON t.id=o.type_id
    WHERE t.hotel_id=? AND (? IS NULL OR o.type_id=?) AND o.arrival<? AND o.departure>?
    AND o.state IN ('pending','confirmed','staying')`,
    id,
    hotelId,
    typeId,
    typeId,
    to,
    from,
  );
  return loadBlock(db, id);
}

export class Operations {
  constructor(db, reservations) {
    this.db = db;
    this.reservations = reservations;
  }

  handleOrder(actor, id, action, input) {
    return this.reservations.withFreshOrders(() =>
      this.db.change({ actor, action, target: '预订 ' + id }, (log) => {
        const now = log.now;
        const order = this.db.order(id);
        log.hotelId = order.hotel_id;
        requireManage(this.db, actor, order.hotel_id);
        this.reservations.checkDeadline(order, now);
        checkVersion(order, input.version);
        log.before = this.db.snapshot(id);
        const commands = {
          酒店确认: () => this.confirm(order, now),
          整体分房: () => this.checkIn(order, input.roomIds, now),
          整单退房: () => this.checkOut(order, now),
        };
        commands[action]();
        log.after = this.db.snapshot(id);
        return log.after;
      }),
    );
  }

  confirm(order, now) {
    requireThat(order.state === STATE.pending && now < order.deadline, 'STATE', '订单已不在确认期', 409);
    this.transition(order.id, STATE.confirmed, now);
  }

  transition(id, state, now) {
    this.db.run('UPDATE orders SET state=?,changed_at=?,version=version+1 WHERE id=?', state, now, id);
  }

  checkIn(order, values, now) {
    requireThat(order.state === STATE.confirmed, 'STATE', '只有已确认订单可以办理入住', 409);
    requireThat(
      Array.isArray(values) && values.length === order.quantity,
      'ROOM_SET',
      '请选择与预订间数相同的房号',
    );
    const ids = values.map((value) => integer(value, '房号'));
    requireThat(new Set(ids).size === order.quantity, 'ROOM_SET', '所选房号不能重复');
    for (const id of ids) {
      const item = room(this.db, id);
      requireThat(
        item.hotel_id === order.hotel_id && item.type_id === order.type_id,
        'ROOM_TYPE',
        '房号须属于同酒店同房型',
      );
      requireThat(item.state === 'free', 'ROOM_BUSY', item.number + '目前不可分配', 409);
    }
    for (const id of ids) {
      this.db.run('INSERT INTO allocations(order_id,room_id,checked_in) VALUES(?,?,?)', order.id, id, now);
      this.db.run("UPDATE rooms SET state='occupied' WHERE id=?", id);
    }
    this.transition(order.id, STATE.staying, now);
  }

  checkOut(order, now) {
    requireThat(order.state === STATE.staying, 'STATE', '只有已入住订单可以办理退房', 409);
    const active = this.db.all(
      'SELECT id,room_id FROM allocations WHERE order_id=? AND checked_out IS NULL',
      order.id,
    );
    requireThat(active.length === order.quantity, 'ALLOCATION', '活动分房记录不完整', 409);
    for (const record of active) {
      this.db.run('UPDATE allocations SET checked_out=? WHERE id=?', now, record.id);
      this.db.run("UPDATE rooms SET state='cleaning' WHERE id=?", record.room_id);
    }
    this.transition(order.id, STATE.completed, now);
  }

  listRooms(actor, hotelId) {
    requireManage(this.db, actor, hotelId);
    return this.db.all(
      `SELECT r.*,t.name AS type_name FROM rooms r JOIN types t ON t.id=r.type_id
      WHERE t.hotel_id=? ORDER BY t.name,r.number`,
      hotelId,
    );
  }

  roomAction(actor, id, input) {
    this.reservations.expireDue();
    return this.db.change({ actor, action: '维护客房', target: '客房 ' + id }, (log) => {
      const current = room(this.db, id);
      log.hotelId = current.hotel_id;
      requireManage(this.db, actor, current.hotel_id);
      log.before = current;
      const actions = { clean: ['cleaning', 'free'], repair: ['free', 'repair'], reopen: ['repair', 'free'] };
      const transition = actions[input.event];
      requireThat(transition && current.state === transition[0], 'ROOM_STATE', '当前房态不可执行该操作', 409);
      if (input.event === 'repair') {
        createBlock(this.db, actor, {
          ...input,
          hotelId: current.hotel_id,
          typeId: current.type_id,
          roomId: id,
        });
      }
      if (input.event === 'reopen') this.db.run('UPDATE blocks SET active=0 WHERE room_id=?', id);
      this.db.run('UPDATE rooms SET state=? WHERE id=?', transition[1], id);
      log.after = room(this.db, id);
      return log.after;
    });
  }

  offerCalendar(actor, typeId, start, end) {
    const item = typeDetails(this.db, typeId);
    requireManage(this.db, actor, item.hotel_id);
    const { from, to } = checkedInterval(start, end, 93);
    return this.db.all(
      `SELECT * FROM offers WHERE type_id=? AND night>=? AND night<? ORDER BY night`,
      typeId,
      from,
      to,
    );
  }

  saveDay(actor, typeId, input) {
    return this.db.change({ actor, action: '维护日售', target: '房型 ' + typeId }, (log) => {
      const item = typeDetails(this.db, typeId);
      log.hotelId = item.hotel_id;
      requireManage(this.db, actor, item.hotel_id);
      const night = day(input.night);
      log.target += ' · ' + night;
      const current = this.db.get('SELECT * FROM offers WHERE type_id=? AND night=?', typeId, night);
      log.before = current;
      const version = integer(input.version, '日售版本', 0);
      requireThat(version === (current?.version ?? 0), 'STALE_VERSION', '日售记录已改变，请刷新', 409);
      const capacity = integer(input.capacity, '库存', 0, 1000);
      requireThat(capacity >= (current?.reserved ?? 0), 'CAPACITY', '库存在用，不得降到占用量以下', 409);
      const price = input.price === null ? null : integer(input.price, '单价（分）', 1, 10000000);
      this.db.run(
        `INSERT INTO offers(type_id,night,capacity,price,stopped)
        VALUES(?,?,?,?,?) ON CONFLICT(type_id,night) DO UPDATE SET
        capacity=excluded.capacity,price=excluded.price,stopped=excluded.stopped,version=version+1`,
        typeId,
        night,
        capacity,
        price,
        Number(input.stopped === true),
      );
      log.after = this.db.get('SELECT * FROM offers WHERE type_id=? AND night=?', typeId, night);
      return log.after;
    });
  }

  closure(actor, hotelId, input) {
    this.reservations.expireDue();
    return this.db.change({ actor, action: '设置停业', hotelId, target: '酒店 ' + hotelId }, (log) => {
      requireManage(this.db, actor, hotelId);
      hotel(this.db, hotelId);
      const typeId = input.typeId ? integer(input.typeId, '房型') : null;
      if (typeId) requireThat(typeDetails(this.db, typeId).hotel_id === hotelId, 'TYPE', '房型不属于该酒店');
      log.after = createBlock(this.db, actor, { ...input, hotelId, typeId });
      return log.after;
    });
  }

  endClosure(actor, id) {
    return this.db.change({ actor, action: '解除停业', target: '暂停接待 ' + id }, (log) => {
      const item = loadBlock(this.db, id);
      log.hotelId = item.hotel_id;
      requireManage(this.db, actor, item.hotel_id);
      requireThat(!item.room_id, 'ROOM', '房间停业通过结束维修解除');
      log.before = item;
      this.db.run('UPDATE blocks SET active=0 WHERE id=?', id);
      log.after = loadBlock(this.db, id);
      return log.after;
    });
  }

  cases(actor, hotelId) {
    requireManage(this.db, actor, hotelId);
    return {
      blocks: this.db.all('SELECT * FROM blocks WHERE hotel_id=? ORDER BY id DESC', hotelId),
      cases: this.db.all(
        `SELECT c.*,b.reason,b.start,b.end,o.guest_name,o.state,
        a.name AS handler FROM coordination c JOIN blocks b ON b.id=c.block_id
        JOIN orders o ON o.id=c.order_id LEFT JOIN accounts a ON a.id=c.actor_id
        WHERE b.hotel_id=? ORDER BY c.result IS NOT NULL,c.id DESC`,
        hotelId,
      ),
    };
  }

  resolve(actor, id, input) {
    return this.db.change({ actor, action: '保存协调结果', target: '协调 ' + id }, (log) => {
      const item = this.db.get(
        `SELECT c.*,b.hotel_id FROM coordination c
        JOIN blocks b ON b.id=c.block_id WHERE c.id=?`,
        id,
      );
      requireThat(item, 'NOT_FOUND', '协调记录不存在', 404);
      log.hotelId = item.hotel_id;
      requireManage(this.db, actor, item.hotel_id);
      log.before = item;
      this.db.run(
        'UPDATE coordination SET result=?,actor_id=?,resolved_at=? WHERE id=?',
        text(input.result, '联系情况与处理结果', 350),
        actor.id,
        log.now,
        id,
      );
      log.after = this.db.get('SELECT * FROM coordination WHERE id=?', id);
      return log.after;
    });
  }

  saveHotel(actor, input) {
    return this.db.change({ actor, action: '维护酒店', target: '酒店资料' }, (log) => {
      requireRole(actor, 'admin');
      const code = checkCode(text(input.code, '酒店编号'));
      const values = [
        code,
        text(input.name, '酒店名称'),
        text(input.city, '城市'),
        text(input.location, '位置', 150),
        photo(input.photo),
      ];
      const id = input.id ? integer(input.id, '酒店') : null;
      const conflict = this.db.get('SELECT id FROM hotels WHERE code=?', code);
      requireThat(!conflict || conflict.id === id, 'DUPLICATE_CODE', '酒店编号已使用', 409);
      if (id) {
        log.before = hotel(this.db, id);
        this.db.run('UPDATE hotels SET code=?,name=?,city=?,location=?,photo=? WHERE id=?', ...values, id);
      } else {
        this.db.run('INSERT INTO hotels(code,name,city,location,photo) VALUES(?,?,?,?,?)', ...values);
      }
      log.after = this.db.get('SELECT * FROM hotels WHERE code=?', code);
      log.hotelId = log.after.id;
      log.target = code;
      return log.after;
    });
  }

  saveType(actor, hotelId, input) {
    return this.db.change({ actor, action: '维护房型', hotelId, target: '房型资料' }, (log) => {
      requireManage(this.db, actor, hotelId);
      hotel(this.db, hotelId);
      const code = checkCode(text(input.code, '房型编号'));
      const fields = [
        code,
        text(input.name, '房型名称'),
        integer(input.capacity, '单房容量', 1, 8),
        text(input.description, '房型描述', 200),
        photo(input.photo),
      ];
      const id = input.id ? integer(input.id, '房型') : null;
      const conflict = this.db.get('SELECT id FROM types WHERE code=?', code);
      requireThat(!conflict || conflict.id === id, 'DUPLICATE_CODE', '房型编号已使用', 409);
      if (id) {
        const current = typeDetails(this.db, id);
        requireThat(current.hotel_id === hotelId, 'FORBIDDEN', '房型不属于该酒店', 403);
        log.before = current;
        this.db.run(
          'UPDATE types SET code=?,name=?,capacity=?,description=?,photo=? WHERE id=?',
          ...fields,
          id,
        );
      } else {
        this.db.run(
          'INSERT INTO types(hotel_id,code,name,capacity,description,photo) VALUES(?,?,?,?,?,?)',
          hotelId,
          ...fields,
        );
      }
      log.target = code;
      log.after = this.db.get('SELECT * FROM types WHERE code=?', code);
      return log.after;
    });
  }

  saveRoom(actor, typeId, input) {
    const item = typeDetails(this.db, typeId);
    return this.db.change(
      { actor, action: '新增客房', hotelId: item.hotel_id, target: '房型 ' + typeId },
      (log) => {
        requireManage(this.db, actor, item.hotel_id);
        const number = text(input.number, '房号', 16);
        requireThat(
          !this.db.get(
            `SELECT 1 FROM rooms r JOIN types t ON t.id=r.type_id
        WHERE t.hotel_id=? AND r.number=?`,
            item.hotel_id,
            number,
          ),
          'DUPLICATE_ROOM',
          '此酒店已存在该房号',
          409,
        );
        const saved = this.db.run('INSERT INTO rooms(type_id,number) VALUES(?,?)', typeId, number);
        log.after = room(this.db, Number(saved.lastInsertRowid));
        return log.after;
      },
    );
  }

  saveAccount(actor, input) {
    return this.db.change({ actor, action: '维护账号', restricted: true, target: '平台账号' }, (log) => {
      requireRole(actor, 'admin');
      const username = text(input.username, '登录账号', 40);
      const name = text(input.name, '显示姓名', 40);
      requireThat(['guest', 'staff', 'admin'].includes(input.role), 'ROLE', '无效角色');
      const current = this.db.get(
        'SELECT id,username,name,role,enabled FROM accounts WHERE username=?',
        username,
      );
      const enabled = input.enabled !== false;
      requireThat(
        current?.id !== actor.id || (enabled && input.role === 'admin'),
        'ACCOUNT',
        '不能停用或降级正在使用的管理员账号',
      );
      log.target = username;
      log.before = current;
      if (current) {
        this.db.run(
          'UPDATE accounts SET name=?,role=?,enabled=? WHERE id=?',
          name,
          input.role,
          Number(enabled),
          current.id,
        );
        if (input.password)
          this.db.run('UPDATE accounts SET digest=? WHERE id=?', passwordDigest(input.password), current.id);
        if (current.role === 'staff' && input.role !== 'staff') {
          this.db.run('DELETE FROM grants WHERE account_id=?', current.id);
        }
        if (!enabled || input.password || input.role !== current.role) {
          this.db.run('DELETE FROM sessions WHERE account_id=?', current.id);
        }
      } else {
        this.db.run(
          'INSERT INTO accounts(username,name,role,digest,enabled) VALUES(?,?,?,?,?)',
          username,
          name,
          input.role,
          passwordDigest(input.password),
          Number(enabled),
        );
      }
      log.after = this.db.get(
        'SELECT id,username,name,role,enabled FROM accounts WHERE username=?',
        username,
      );
      return log.after;
    });
  }

  setGrant(actor, input) {
    return this.db.change(
      { actor, action: '调整酒店与日志权限', restricted: true, target: '平台授权' },
      (log) => {
        requireRole(actor, 'admin');
        const accountId = integer(input.accountId, '账号');
        const hotelId = integer(input.hotelId, '酒店');
        log.hotelId = hotelId;
        log.target = '账号 ' + accountId + ' · 酒店 ' + hotelId;
        const staff = this.db.get('SELECT role FROM accounts WHERE id=?', accountId);
        requireThat(staff?.role === 'staff', 'ROLE', '请选择酒店工作人员账号');
        hotel(this.db, hotelId);
        log.before = this.db.get(
          'SELECT * FROM grants WHERE account_id=? AND hotel_id=?',
          accountId,
          hotelId,
        );
        if (input.manage === true) {
          this.db.run(
            `INSERT INTO grants VALUES(?,?,?) ON CONFLICT(account_id,hotel_id)
          DO UPDATE SET audit=excluded.audit`,
            accountId,
            hotelId,
            Number(input.audit === true),
          );
        } else {
          this.db.run('DELETE FROM grants WHERE account_id=? AND hotel_id=?', accountId, hotelId);
        }
        log.after = this.db.get('SELECT * FROM grants WHERE account_id=? AND hotel_id=?', accountId, hotelId);
        return log.after ?? null;
      },
    );
  }
}
