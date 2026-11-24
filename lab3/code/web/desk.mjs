import {
  action,
  api,
  button,
  checkbox,
  dateRange,
  days,
  e,
  field,
  heading,
  hidden,
  money,
  notice,
  orderStates,
  ref,
  roles,
  routeUrl,
  section,
  select,
  status,
  table,
  when,
} from './ui.mjs';

const links = {
  staff: [
    ['desk', '前台订单'],
    ['calendar', '房量日历'],
    ['rooms', '客房状态'],
    ['coordination', '异常协调'],
    ['types', '房型资料'],
    ['audit', '操作日志'],
  ],
  admin: [
    ['desk', '订单查询'],
    ['statistics', '间夜统计'],
    ['hotels', '酒店名录'],
    ['accounts', '账号与授权'],
    ['audit', '操作日志'],
  ],
};

export function linksFor(role, view) {
  return `<nav aria-label="工作台导航">${links[role]
    .map(
      ([target, title]) =>
        `<a href="#${target}"${view === target ? ' aria-current="page"' : ''}>${title}</a>`,
    )
    .join('')}</nav>`;
}

function hotelOptions(hotels, full = false) {
  return [...(full ? [['', '全部授权酒店']] : []), ...hotels.map((hotel) => [hotel.id, hotel.name])];
}

function typeOptions(types, full = false) {
  return [...(full ? [['', '全店房型']] : []), ...types.map((type) => [type.id, type.name])];
}

async function hotelScope(state) {
  const { hotels, photos } = await api('/ops/hotels');
  const hotelId = Number(state.ops.hotelId) || hotels[0]?.id;
  return { hotels, photos, hotelId, hotel: hotels.find((item) => item.id === hotelId) };
}

async function maintenanceContext(state) {
  const scope = await hotelScope(state);
  if (!scope.hotelId) return scope;
  const types = await api('/ops/hotels/' + scope.hotelId + '/types');
  return {
    ...scope,
    types,
    typeId: types.find((item) => item.id === Number(state.ops.typeId))?.id ?? types[0]?.id,
  };
}

function frame(title, intro, content) {
  return `<div class="frame desk">${heading(title, intro)}<div id="feedback" aria-live="polite"></div>${content}</div>`;
}

async function deskOrders(state) {
  const { hotels } = await hotelScope(state);
  const filters = state.ops.orders ?? {};
  const orders = await api(routeUrl('/ops/orders', filters));
  const states = [['', '全部状态'], ...Object.entries(orderStates)];
  const form = `<form class="filters" data-form="orders-filter">
    ${select('hotelId', '酒店', hotelOptions(hotels, true), filters.hotelId)}
    ${field('city', filters.city, '城市')}${field('from', filters.from, '计划入住起日', 'date')}
    ${field('to', filters.to, '计划入住止日', 'date')}${select('state', '当前状态', states, filters.state)}
    ${button('筛选')}</form>`;
  return frame(
    state.actor.role === 'admin' ? '平台订单查询' : '前台订单',
    '按当前行程的计划入住日期筛选。',
    form +
      table(
        ['预订编号', '入住人', '酒店与房型', '入住及退房', '间数', '状态', '办理'],
        orders.map((item) => [
          ref(item.id),
          e(item.guest_name),
          e(item.hotel_name + ' · ' + item.type_name),
          e(dateRange(item.arrival, item.departure)),
          e(item.quantity),
          status(item.state),
          `<a href="#desk/${item.id}">打开预订 →</a>`,
        ]),
      ),
  );
}

async function deskOrder(id) {
  const item = await api('/orders/' + id);
  let operation = '';
  if (item.state === 'pending') {
    operation = `<p>确认截止时间为 ${when(item.deadline)}（北京时间）。确认后沿用原逐晚占用。</p>
      <form data-form="desk-order">${hidden('id', item.id)}${hidden('version', item.version)}${hidden('event', 'confirm')}
      ${button('酒店确认')}</form>`;
  }
  if (item.state === 'confirmed') {
    const all = await api('/ops/hotels/' + item.hotel_id + '/rooms');
    const eligible = all.filter((room) => room.type_id === item.type_id && room.state === 'free');
    operation = `<p>应选择 ${item.quantity} 个同房型空闲房号。</p>${
      eligible.length
        ? `
      <form data-form="desk-order" data-required-rooms="${item.quantity}" class="stack">${hidden('id', item.id)}${hidden('version', item.version)}
        ${hidden('event', 'check-in')}<fieldset class="room-picker"><legend>可分配房号</legend>${eligible
          .map(
            (room) =>
              `<label><input class="form-check-input" type="checkbox" name="roomIds" value="${room.id}"><strong>${e(room.number)}</strong><small>空闲</small></label>`,
          )
          .join('')}</fieldset>
        <div class="allocation-actions"><output aria-live="polite">已选 0 / ${item.quantity} 间</output>
        <button type="submit" class="btn btn-primary" disabled>办理整体入住</button></div></form>`
        : notice('当前没有可分配的空闲房，请在客房状态页检查。')
    }`;
  }
  if (item.state === 'staying') {
    operation = `<p>整单退房后，${item.rooms.length} 间客房一起转为待清洁。</p>
      <form data-form="desk-order">${hidden('id', item.id)}${hidden('version', item.version)}${hidden('event', 'check-out')}
      ${button('办理整单退房')}</form>`;
  }
  const history = table(
    ['房号', '房态', '实际入住', '实际退房'],
    item.rooms.map((room) => [
      e(room.number),
      status(room.state),
      when(room.checked_in),
      room.checked_out ? when(room.checked_out) : '—',
    ]),
  );
  const summary = `<dl class="details"><div><dt>状态</dt><dd>${status(item.state)}</dd></div>
    <div><dt>入住人</dt><dd>${e(item.guest_name)}</dd></div>
    <div><dt>住宿安排</dt><dd>${e(dateRange(item.arrival, item.departure))} · ${item.quantity}间</dd></div>
    <div><dt>成交总价</dt><dd>${money(item.total)}</dd></div></dl>`;
  return frame(
    ref(item.id),
    item.hotel_name + ' · ' + item.type_name,
    `<a class="back" href="#desk">← 返回订单列表</a><div class="two-col">
    <div>${section('预订信息', summary)}${item.rooms.length ? section('分房记录', history) : ''}</div>
    <aside>${section('订单办理', operation || '<p>当前订单已办结。</p>')}</aside></div>`,
  );
}

async function calendar(state, scope) {
  if (!scope.typeId) return notice('请先在房型资料中添加房型。');
  const { start = state.today, end = days(state.today, 10) } = state.ops.calendar ?? {};
  const offers = await api(routeUrl('/ops/types/' + scope.typeId + '/offers', { start, end }));
  const selected = offers.find((item) => item.night === state.ops.night);
  const value = selected ?? { version: 0, capacity: '', price: null, stopped: false, night: '' };
  return `<form class="filters" data-form="calendar-filter">${select('typeId', '房型', typeOptions(scope.types), scope.typeId)}
    ${field('start', start, '起始日', 'date', 'required')}${field('end', end, '结束日（不含）', 'date', 'required')}
    ${button('查看日售')}</form>
    <div class="two-col"><div>${table(
      ['住宿夜', '库存', '已占', '余量', '每间价', '状态', '操作'],
      offers.map((item) => [
        e(item.night),
        item.capacity,
        item.reserved,
        item.capacity - item.reserved,
        item.price === null ? '未定价' : money(item.price),
        item.stopped ? '停售' : '可售',
        action('offer-select', '编辑', item.night, 'text'),
      ]),
    )}</div>
    <aside>${section(
      selected ? '编辑日售' : '新增日售',
      `<form class="stack" data-form="save-offer">
      ${hidden('typeId', scope.typeId)}${hidden('version', value.version)}
      ${field('night', value.night, '住宿夜', 'date', selected ? 'readonly required' : 'required')}
      ${field('capacity', value.capacity, '库存总量', 'number', 'min="0" required')}
      ${field('price', value.price === null ? '' : value.price / 100, '每间价（元，可空）', 'number', 'min="0.01" step="0.01"')}
      ${checkbox('stopped', '停售', value.stopped)}<div class="actions">${button('保存日售')}
      ${selected ? action('offer-select', '切换新增', '', 'secondary') : ''}</div></form>`,
    )}</aside></div>`;
}

async function rooms(state, scope) {
  const list = await api('/ops/hotels/' + scope.hotelId + '/rooms');
  const selected = list.find((room) => room.id === Number(state.ops.roomId));
  const roomForm =
    selected &&
    `<form class="stack" data-form="room-event">${hidden('id', selected.id)}${hidden('event', 'repair')}
    ${field('start', state.today, '维修起始日', 'date', 'required')}${field('end', days(state.today, 1), '恢复日', 'date', 'required')}
    ${field('reason', '', '维修原因', 'text', 'required')}${button('登记维修')}</form>`;
  const controls = (room) =>
    ({
      free: action('room-select', '登记维修', room.id, 'text'),
      cleaning: action('room-clean', '清洁完成', room.id, 'text'),
      repair: action('room-reopen', '结束维修', room.id, 'text'),
    })[room.state] ?? '';
  return `<div class="two-col"><div class="room-grid">${
    list
      .map(
        (room) => `<article><strong>${e(room.number)}</strong>
    <p>${e(room.type_name)}</p><div>${status(room.state)}${controls(room)}</div></article>`,
      )
      .join('') || notice('尚未录入客房。')
  }</div>
    <aside>${selected ? section('维修 · ' + selected.number, roomForm) : ''}
      ${
        scope.types.length
          ? section(
              '新增客房',
              `<form class="stack" data-form="add-room">
      ${select('typeId', '所属房型', typeOptions(scope.types))}${field('number', '', '房号', 'text', 'required')}
      ${button('保存房号')}</form>`,
            )
          : ''
      }</aside></div>`;
}

async function coordination(state, scope) {
  const listing = await api('/ops/hotels/' + scope.hotelId + '/cases');
  const cases = table(
    ['订单编号', '入住人', '影响日期', '原因', '状态与结果'],
    listing.cases.map((item) => [
      `<a href="#desk/${item.order_id}">${ref(item.order_id)}</a>`,
      e(item.guest_name),
      e(dateRange(item.start, item.end)),
      e(item.reason),
      `<div>${status(item.state)}${
        item.result
          ? `<p>${e(item.handler)} · ${e(item.result)}</p>`
          : `<form class="inline-form" data-form="resolve">${hidden('id', item.id)}
        ${field('result', '', '联系情况与结果', 'text', 'required')}${button('保存', 'secondary')}</form>`
      }</div>`,
    ]),
  );
  const blocks = table(
    ['暂停接待日期', '影响范围', '原因', '状态'],
    listing.blocks.map((block) => [
      e(dateRange(block.start, block.end)),
      e(scope.types.find((type) => type.id === block.type_id)?.name ?? '全店'),
      e(block.reason),
      block.active
        ? block.room_id
          ? '随维修解除'
          : action('end-closure', '解除暂停', block.id, 'text')
        : '已解除',
    ]),
  );
  return `<div class="two-col"><div>${section('受影响预订', cases)}${section('暂停接待记录（结束日不含）', blocks)}</div>
    <aside>${section(
      '登记暂停接待',
      `<form class="stack" data-form="closure">${hidden('hotelId', scope.hotelId)}
      ${select('typeId', '影响范围', typeOptions(scope.types, true))}
      ${field('start', state.today, '起始日', 'date', 'required')}${field('end', days(state.today, 1), '恢复接待日', 'date', 'required')}
      ${field('reason', '', '原因', 'text', 'required')}${button('保存停售并生成协调清单')}</form>`,
    )}</aside></div>`;
}

function typeEditor(state, scope) {
  const selected = scope.types.find((item) => item.id === Number(state.ops.editType));
  const form = `<form class="stack" data-form="type-save">${hidden('hotelId', scope.hotelId)}${hidden('id', selected?.id)}
    ${field('code', selected?.code, '房型编号', 'text', 'required')}${field('name', selected?.name, '房型名称', 'text', 'required')}
    ${field('capacity', selected?.capacity ?? 2, '每间容量', 'number', 'min="1" max="8" required')}
    ${field('description', selected?.description, '房型说明', 'text', 'required')}
    ${select(
      'photo',
      '示意照片',
      scope.photos.map((name) => [name, name]),
      selected?.photo,
    )}
    <div class="actions">${button('保存房型')}${selected ? action('type-select', '新增', '', 'secondary') : ''}</div></form>`;
  return `<div class="two-col"><div>${table(
    ['编号', '房型', '容量', '编辑'],
    scope.types.map((item) => [
      e(item.code),
      e(item.name),
      e(item.capacity) + '人',
      action('type-select', '编辑', item.id, 'text'),
    ]),
  )}
    </div><aside>${section(selected ? '编辑房型' : '新增房型', form)}</aside></div>`;
}

async function scopedView(state, view) {
  const scope = await maintenanceContext(state);
  if (!scope.hotelId) return frame('酒店工作台', '', notice('当前账号未获酒店管理授权。'));
  const views = {
    calendar: ['房量日历', '按房型维护每天的库存、单价及停售状态。', calendar],
    rooms: ['客房状态', '维修期间暂停该房型在受影响日期的销售。', rooms],
    coordination: ['异常协调', '已有订单保留，工作人员在此记录联系和协调结果。', coordination],
    types: ['房型资料', '维护可售房型的容量与位置说明。', typeEditor],
  };
  const [title, intro, render] = views[view];
  return frame(
    title,
    intro,
    `<form class="filters hotel-selector" data-form="choose-hotel">
    ${select('hotelId', '当前酒店', hotelOptions(scope.hotels), scope.hotelId)}${button('切换酒店', 'secondary')}</form>` +
      (await render(state, scope)),
  );
}

async function statistics(state) {
  const { hotels } = await hotelScope(state);
  const filters = state.ops.statistics ?? { from: state.today, to: days(state.today, 6) };
  const value = await api(routeUrl('/ops/occupancy', filters));
  const metrics = [
    ['涉及预订', value.orders],
    ['已取消', value.cancelled],
    ['有效间夜', value.room_nights],
  ];
  return frame(
    '住宿间夜统计',
    '日期按北京时间，起止日均计入范围。',
    `
    <form class="filters" data-form="stats-filter">${select('hotelId', '酒店', hotelOptions(hotels, true), filters.hotelId)}
      ${field('city', filters.city, '城市')}${field('from', filters.from, '统计起日', 'date', 'required')}
      ${field('to', filters.to, '统计止日', 'date', 'required')}${button('统计')}</form>
    <div class="metrics">${metrics
      .map(([label, count]) => `<article><h2>${label}</h2><strong>${count}</strong></article>`)
      .join('')}</div>
    <p class="note">只累计当前行程落在范围内的住宿夜，每晚乘以间数；取消单的间夜为0。</p>`,
  );
}

async function hotelEditor(state) {
  const { hotels, photos } = await hotelScope(state);
  const selected = hotels.find((item) => item.id === Number(state.ops.editHotel));
  const rows = hotels.map((item) => [
    e(item.code),
    e(item.name),
    e(item.city),
    e(item.location),
    action('hotel-select', '编辑', item.id, 'text'),
  ]);
  return frame(
    '酒店名录',
    '维护酒店的唯一编号、城市与位置。',
    `<div class="two-col"><div>
    ${table(['编号', '酒店', '城市', '位置', '操作'], rows)}</div>
    <aside>${section(
      selected ? '编辑酒店' : '新增酒店',
      `<form class="stack" data-form="hotel-save">${hidden('id', selected?.id)}
      ${field('code', selected?.code, '酒店编号', 'text', 'required')}${field('name', selected?.name, '酒店名称', 'text', 'required')}
      ${field('city', selected?.city, '城市', 'text', 'required')}${field('location', selected?.location, '位置', 'text', 'required')}
      ${select(
        'photo',
        '示意照片',
        photos.map((name) => [name, name]),
        selected?.photo,
      )}
      <div class="actions">${button('保存酒店')}${selected ? action('hotel-select', '新增', '', 'secondary') : ''}</div></form>`,
    )}</aside></div>`,
  );
}

async function accounts(state) {
  const { hotels } = await hotelScope(state);
  const { accounts: users, grants } = await api('/ops/accounts');
  const actor = users.find((item) => item.id === Number(state.ops.account));
  const byStaff = users
    .filter((item) => item.role === 'staff')
    .map((item) => [item.id, item.name + ' · ' + item.username]);
  return frame(
    '账号与授权',
    '酒店管理权与查看酒店日志的权限单独设置。',
    `<div class="two-col"><div>
    ${section(
      '平台账号',
      table(
        ['账号', '姓名', '角色', '状态', '操作'],
        users.map((item) => [
          e(item.username),
          e(item.name),
          e(roles[item.role]),
          item.enabled ? '启用' : '停用',
          action('account-select', '编辑', item.id, 'text'),
        ]),
      ),
    )}
    ${section(
      '酒店授权',
      table(
        ['工作人员', '酒店', '业务权限', '日志权限', '操作'],
        grants.map((item) => [
          e(item.account_name),
          e(item.hotel_name),
          '可管理',
          item.audit ? '可查看' : '未授予',
          action('grant-revoke', '撤销', item.account_id + '/' + item.hotel_id, 'text'),
        ]),
      ),
    )}</div>
    <aside>${section(
      actor ? '编辑账号' : '新增账号',
      `<form class="stack" data-form="save-account">
      ${field('username', actor?.username, '登录账号', 'text', actor ? 'readonly required' : 'required')}
      ${field('name', actor?.name, '姓名', 'text', 'required')}${select('role', '角色', Object.entries(roles), actor?.role)}
      ${field('password', '', actor ? '新密码（留空不改）' : '密码', 'password', actor ? 'minlength="8"' : 'minlength="8" required')}
      ${checkbox('enabled', '账号启用', actor?.enabled ?? true)}
      <div class="actions">${button('保存账号')}${actor ? action('account-select', '新增', '', 'secondary') : ''}</div></form>`,
    )}
      ${
        byStaff.length && hotels.length
          ? section(
              '设置酒店授权',
              `<form class="stack" data-form="save-grant">
        ${select('accountId', '工作人员', byStaff)}${select('hotelId', '酒店', hotelOptions(hotels))}
        ${checkbox('audit', '同时允许查看该酒店业务日志')}${button('授予或更新')}</form>`,
            )
          : ''
      }</aside></div>`,
  );
}

async function logs(state) {
  const { hotels } = await hotelScope(state);
  const filters = state.ops.audit ?? {};
  let records = [];
  let refusal = null;
  try {
    records = await api(routeUrl('/ops/audit', filters));
  } catch (error) {
    if (error.code !== 'AUDIT_FORBIDDEN') throw error;
    refusal = notice(error.message, 'error');
  }
  const controls = `<form class="filters" data-form="audit-filter">
    ${select('hotelId', '酒店', hotelOptions(hotels, true), filters.hotelId)}
    ${field('from', filters.from, '操作起日', 'date')}${field('to', filters.to, '操作止日', 'date')}
    ${field('target', filters.target, '对象')}${field('operator', filters.operator, '操作人')}
    ${select(
      'result',
      '操作结果',
      [
        ['', '全部'],
        ['ok', '成功'],
        ['failed', '失败'],
      ],
      filters.result,
    )}
    ${button('查询日志')}</form>`;
  return frame(
    '操作日志',
    '按北京时间检索授权范围内的业务记录。',
    controls +
      (refusal ??
        table(
          ['时间与操作人', '酒店', '对象', '操作', '结果', '变更内容'],
          records.map((item) => [
            e(when(item.instant) + ' · ' + item.operator),
            e(item.hotel_name ?? '平台'),
            e(item.target),
            e(item.action),
            item.result === 'ok' ? '成功' : '失败',
            `<details><summary>查看</summary><p>${e(item.detail)}</p><pre>${e(item.old_value)}</pre><pre>${e(item.new_value)}</pre></details>`,
          ]),
        )),
  );
}

export function deskView(state, view, id) {
  if (!state.actor || state.actor.role === 'guest')
    return frame(
      '酒店工作台',
      '',
      notice('请使用工作人员或平台账号登录。') + '<a class="btn btn-primary" href="#login">登录工作台</a>',
    );
  if (view === 'desk') return id ? deskOrder(id) : deskOrders(state);
  if (['calendar', 'rooms', 'coordination', 'types'].includes(view)) return scopedView(state, view);
  if (view === 'statistics') return statistics(state);
  if (view === 'hotels') return hotelEditor(state);
  if (view === 'accounts') return accounts(state);
  if (view === 'audit') return logs(state);
  return deskOrders(state);
}

export async function deskAction(state, actionName, value) {
  const selections = {
    'offer-select': 'night',
    'room-select': 'roomId',
    'type-select': 'editType',
    'hotel-select': 'editHotel',
    'account-select': 'account',
  };
  if (actionName in selections) {
    state.ops[selections[actionName]] = value;
    return null;
  }
  if (['room-clean', 'room-reopen'].includes(actionName)) {
    await api('/ops/rooms/' + value, { event: actionName === 'room-clean' ? 'clean' : 'reopen' });
    return '客房状态已更新。';
  }
  if (actionName === 'end-closure') {
    await api('/ops/closures/' + value + '/end', {});
    return '已解除暂停接待。';
  }
  if (actionName === 'grant-revoke') {
    const [accountId, hotelId] = value.split('/');
    await api('/ops/grants', { accountId, hotelId, manage: false });
    return '已撤销该酒店的权限。';
  }
  return null;
}

export async function deskForm(state, kind, input, data) {
  const filters = {
    'orders-filter': 'orders',
    'stats-filter': 'statistics',
    'audit-filter': 'audit',
  };
  if (kind in filters) {
    state.ops[filters[kind]] = input;
    return null;
  }
  if (kind === 'choose-hotel') {
    Object.assign(state.ops, {
      hotelId: input.hotelId,
      typeId: null,
      roomId: null,
      editType: null,
      night: null,
    });
    return null;
  }
  if (kind === 'calendar-filter') {
    state.ops.typeId = input.typeId;
    state.ops.calendar = { start: input.start, end: input.end };
    state.ops.night = null;
    return null;
  }
  if (kind === 'desk-order') {
    await api('/ops/orders/' + input.id + '/' + input.event, {
      version: input.version,
      roomIds: data.getAll('roomIds'),
    });
    return '办理成功。';
  }
  if (kind === 'save-offer') {
    await api('/ops/types/' + input.typeId + '/offers', {
      ...input,
      price: input.price === '' ? null : Math.round(Number(input.price) * 100),
      stopped: data.has('stopped'),
    });
    state.ops.night = input.night;
    return '日售记录已保存。';
  }
  if (kind === 'room-event') {
    await api('/ops/rooms/' + input.id, input);
    state.ops.roomId = null;
    return '已更新房态与受影响的销售日期。';
  }
  if (kind === 'add-room') {
    await api('/ops/types/' + input.typeId + '/rooms', input);
    return '客房已新增。';
  }
  if (kind === 'closure') {
    await api('/ops/hotels/' + input.hotelId + '/closures', input);
    return '停售成功，已有订单保留。';
  }
  if (kind === 'resolve') {
    await api('/ops/cases/' + input.id, input);
    return '协调结果已保存。';
  }
  if (kind === 'type-save') {
    const item = await api('/ops/hotels/' + input.hotelId + '/types', input);
    state.ops.editType = item.id;
    return '房型资料已保存。';
  }
  if (kind === 'hotel-save') {
    state.ops.editHotel = (await api('/ops/hotels', input)).id;
    return '酒店资料已保存。';
  }
  if (kind === 'save-account') {
    state.ops.account = (await api('/ops/accounts', { ...input, enabled: data.has('enabled') })).id;
    return '账号已保存。';
  }
  if (kind === 'save-grant') {
    await api('/ops/grants', { ...input, manage: true, audit: data.has('audit') });
    return '授权已更新。';
  }
  return null;
}
