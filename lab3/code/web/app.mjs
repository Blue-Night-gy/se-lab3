import {
  $,
  action,
  api,
  button,
  countNights,
  dateRange,
  days,
  e,
  field,
  heading,
  hidden,
  inputData,
  messages,
  money,
  notice,
  photograph,
  ref,
  roles,
  routeUrl,
  section,
  select,
  status,
  table,
  when,
} from './ui.mjs';
import { deskAction, deskForm, deskView, linksFor } from './desk.mjs';

const state = {
  actor: null,
  today: '',
  search: null,
  catalog: [],
  cities: [],
  quote: null,
  decision: null,
  pendingPlan: null,
  orderId: null,
  guestName: '',
  requestKey: null,
  ops: {},
};
let revision = 0;

function searchDefaults(day) {
  return {
    city: '',
    arrival: days(day, 1),
    departure: days(day, 4),
    guests: '4',
    quantity: '2',
    type: '',
    min: '',
    max: '',
  };
}

function customerNav(view) {
  const actor = state.actor;
  return `<nav aria-label="顾客导航"><a href="#search"${view === 'search' ? ' aria-current="page"' : ''}>查找住宿</a>
    <a href="#${actor ? 'orders' : 'login'}"${view === 'orders' ? ' aria-current="page"' : ''}>我的预订</a></nav>`;
}

function layout(view) {
  const actor = state.actor;
  const work = actor && actor.role !== 'guest';
  const brand = `<a class="brand" href="#${work ? 'desk' : 'search'}" aria-label="泊序首页">泊序<span>BOSU STAY</span></a>`;
  const nav = work ? linksFor(actor.role, view) : customerNav(view);
  $('#header').innerHTML = `<div class="site-header${work ? ' workspace' : ''}"><div class="frame head">
    ${brand}${nav}<div class="account">
    ${
      actor
        ? `<span>${e(actor.name)}<small>${e(roles[actor.role])}</small></span>${action('logout', '退出', '', 'text')}`
        : '<a class="btn btn-outline-primary btn-sm" href="#login">登录</a>'
    }</div></div></div>`;
  $('#footer').innerHTML = `<div class="frame foot"><a class="brand mini" href="#search">泊序</a>
    <span>酒店预订系统 · 本地演示</span></div>`;
}

function roomsMarkup(items, search) {
  if (!items.length) return notice('没有符合条件的房型。可更换日期、放宽总价区间或减少间数。');
  const nights = countNights(search.arrival, search.departure);
  return items
    .map(
      (room) => `<article class="room-catalog">
    ${photograph(room.photo, room.name + '示意', 'catalog-photo')}
    <div class="room-copy">
      <p class="property-location">${e(room.city)} · ${e(room.hotel_name)} · ${e(room.location)}</p>
      <h2>${e(room.name)}</h2><p class="description">${e(room.description)}</p>
      <dl class="room-facts"><div><dt>每间容量</dt><dd>${e(room.capacity)} 人</dd></div>
      <div><dt>连住可订</dt><dd>${e(room.available)} 间</dd></div></dl>
      <div class="book-line"><div><span>${e(search.quantity)} 间 · ${nights} 晚合计</span><strong>${money(room.total)}</strong></div>
      ${action('quote', '查看逐晚价格', room.id, 'text')}</div>
    </div>
  </article>`,
    )
    .join('');
}

function queryRooms(s) {
  return api(
    routeUrl('/catalog', {
      ...s,
      min: s.min ? String(Math.round(Number(s.min) * 100)) : '',
      max: s.max ? String(Math.round(Number(s.max) * 100)) : '',
    }),
  );
}

async function searchView(preloaded) {
  const s = state.search;
  const result = preloaded ?? (await queryRooms(s));
  const cities = [['', '全部城市'], ...result.cities.map((city) => [city, city])];
  return `<div class="frame guest catalog-page">
    <header class="catalog-head"><h1>酒店与客房</h1></header>
    <div class="catalog-layout">
    <aside class="catalog-filter" aria-labelledby="catalog-filter-title">
    <h2 id="catalog-filter-title">入住安排</h2>
    <form data-form="search" class="search-bar">
      ${select('city', '目的地', cities, s.city)}
      <div class="search-dates">
      ${field('arrival', s.arrival, '入住日期', 'date', 'required')}
      ${field('departure', s.departure, '退房日期', 'date', 'required')}
      </div>
      <div class="search-party">
      ${field('guests', s.guests, '入住人数', 'number', 'min="1" max="48" required')}
      ${field('quantity', s.quantity, '房间数', 'number', 'min="1" max="12" required')}
      </div>
      <details class="more-filters"${s.type || s.min || s.max ? ' open' : ''}><summary>房型和价格筛选</summary>
        <div class="stack">${field('type', s.type, '房型关键词')}
        ${field('min', s.min, '总价下限（元）', 'number', 'min="0" step="0.01"')}
        ${field('max', s.max, '总价上限（元）', 'number', 'min="0" step="0.01"')}</div>
      </details>
      ${button('查询房型')}
    </form>
    <div id="feedback" aria-live="polite"></div>
    </aside>
    <section class="catalog-results" aria-labelledby="catalog-results-title">
      <header class="results-heading"><h2 id="catalog-results-title">可订房型</h2>
      <span class="result-count">${result.items.length} 种 · 按全程总价排序</span></header>
      <div class="room-results">${roomsMarkup(result.items, s)}</div>
    </section>
    </div>
  </div>`;
}

function loginView() {
  return `<div class="frame guest login-layout">
    <div class="login-image">${photograph('wood-room.jpg', '江城酒店的大床客房示意')}</div>
    <div class="form-pane card">${heading('登录', '查看和管理您的泊序预订。')}
      <div id="feedback" aria-live="polite"></div>
      <form class="stack" data-form="login">${field('username', '', '账号', 'text', 'autocomplete="username" required')}
        ${field('password', '', '密码', 'password', 'autocomplete="current-password" required')}
        ${button('登录')}</form>
      <details class="demo-entry"><summary>选择演示账号</summary><div class="actions">
        ${action('demo', '顾客', 'guest', 'secondary')}${action('demo', '前台', 'desk', 'secondary')}
        ${action('demo', '日志前台', 'audit', 'secondary')}${action('demo', '管理员', 'admin', 'secondary')}
      </div></details>
      <details class="demo-entry"><summary>注册顾客账号</summary><form class="stack" data-form="register">
        ${field('username', '', '账号', 'text', 'autocomplete="username" required')}
        ${field('name', '', '姓名', 'text', 'autocomplete="name" required')}
        ${field('password', '', '新密码（至少8位）', 'password', 'autocomplete="new-password" minlength="8" required')}
        ${button('注册并登录', 'secondary')}</form></details>
    </div>
  </div>`;
}

function priceTable(prices, quantity, oldPrices) {
  const headings = oldPrices
    ? ['住宿夜', '原单价', '新单价', '当晚合计']
    : ['住宿夜', '每间单价', '间数', '当晚合计'];
  return table(
    headings,
    prices.map((item, index) => [
      e(item.night),
      oldPrices ? money(oldPrices[index].unit) : money(item.unit),
      oldPrices ? money(item.unit) : e(quantity),
      money(item.unit * quantity),
    ]),
  );
}

function quoteView() {
  const quote = state.quote;
  if (!quote)
    return (
      '<div class="frame guest">' + notice('请先选择日期和房型。') + '<a href="#search">返回查询</a></div>'
    );
  const { item, plan, prices } = quote;
  const decision = state.decision;
  const amend = state.orderId;
  let revisionNote = '';
  if (decision?.outcome === 'repriced') {
    const delta = quote.total - decision.previousTotal;
    revisionNote = section(
      '酒店已更新价格',
      `<dl class="quote-change"><div><dt>原报价</dt><dd>${money(decision.previousTotal)}</dd></div>
      <div><dt>当前总价</dt><dd>${money(quote.total)}</dd></div><div><dt>差额</dt><dd>${delta >= 0 ? '+' : '−'}${money(Math.abs(delta))}</dd></div></dl>
      <p>${amend ? '接受新报价前，原订单保持有效。' : '此时尚未创建订单和占用房量。'}</p>`,
    );
  }
  if (decision?.outcome === 'duplicate') {
    revisionNote = section(
      '发现相同行程的预订',
      `<ul class="plain">${decision.orders
        .map(
          (order) =>
            `<li><a href="#order/${order.id}">${ref(order.id)}</a> · ${e(order.guest_name)} · ${status(order.state)}</li>`,
        )
        .join('')}</ul>
      <p>继续后仍会检查每晚房量和售价。</p>`,
    );
  }
  const label =
    decision?.outcome === 'repriced'
      ? '接受新价并提交'
      : decision?.outcome === 'duplicate'
        ? '继续另订'
        : amend
          ? '确认住宿调整'
          : '提交预订';
  return `<div class="frame guest quote-page">
    <a class="back" href="${amend ? '#order/' + amend : '#search'}">← ${amend ? '返回原订单' : '返回房型目录'}</a>
    ${heading(amend ? '确认住宿调整' : '确认预订', item.hotel_name + ' · ' + item.name)}
    <div id="feedback" aria-live="polite"></div>
    <div class="two-col quote-layout"><div>
      ${revisionNote}
      ${section('逐晚明细', priceTable(prices, plan.quantity, decision?.oldPrices))}
    </div><aside class="quote-sidebar card">${photograph(item.photo, item.name + '示意')}
      <div><h2>${e(item.name)}</h2><p>${e(dateRange(plan.arrival, plan.departure))}</p>
        <p>${plan.guests}人 · ${plan.quantity}间 · ${prices.length}晚</p>
        <div class="quote-total"><span>全程总价</span><strong>${money(quote.total)}</strong></div>
        <small>价格明细有效至 ${when(quote.expires)}</small>
        <form class="stack quote-booking" data-form="submit">
          ${field('guestName', state.guestName || state.actor?.name, '入住人', 'text', 'maxlength="80" required')}
          ${button(label)}
          <a href="${amend ? '#order/' + amend : '#orders'}">放弃本次提交</a>
        </form>
      </div>
    </aside></div>
  </div>`;
}

async function ordersView() {
  const orders = await api('/orders');
  return `<div class="frame guest">${heading('我的预订', '查看酒店确认和入住进度。')}
    ${table(
      ['预订编号', '酒店及房型', '住宿区间', '间数', '全程价', '状态'],
      orders.map((order) => [
        `<a href="#order/${order.id}">${ref(order.id)}</a>`,
        e(order.hotel_name + ' · ' + order.type_name),
        e(dateRange(order.arrival, order.departure)),
        e(order.quantity),
        money(order.total),
        status(order.state),
      ]),
    )}
    <p><a href="#search">查找新的住宿 →</a></p>
  </div>`;
}

async function orderView(id) {
  const order = await api('/orders/' + id);
  const active = ['pending', 'confirmed'].includes(order.state);
  return `<div class="frame guest"><a class="back" href="#orders">← 我的预订</a>
    ${heading(ref(order.id), order.hotel_name + ' · ' + order.type_name)}
    <div id="feedback" aria-live="polite"></div>
    <div class="two-col"><div>
      ${section(
        '行程详情',
        `<dl class="details"><div><dt>状态</dt><dd>${status(order.state)}</dd></div>
        <div><dt>住宿区间</dt><dd>${e(dateRange(order.arrival, order.departure))}</dd></div>
        <div><dt>住客</dt><dd>${e(order.guest_name)} · ${order.guests}人</dd></div>
        <div><dt>房间</dt><dd>${order.quantity}间 · ${countNights(order.arrival, order.departure)}晚</dd></div>
        ${order.state === 'pending' ? `<div><dt>确认截止</dt><dd>${when(order.deadline)}</dd></div>` : ''}
        ${order.reason ? `<div><dt>取消原因</dt><dd>${e(order.reason)}</dd></div>` : ''}
        ${order.rooms.length ? `<div><dt>已分配房号</dt><dd>${order.rooms.map((room) => e(room.number)).join('、')}</dd></div>` : ''}</dl>`,
      )}
      ${section('成交价格', priceTable(order.prices, order.quantity))}
    </div><aside>
      ${section('全程金额', `<strong class="big-number">${money(order.total)}</strong>`)}
      ${
        active
          ? section(
              '管理预订',
              `<div class="stack"><a class="btn btn-outline-primary" href="#amend/${order.id}">调整日期、房型或间数</a>
        <details><summary>更正入住人</summary><form class="stack" data-form="order-change">
          ${hidden('id', order.id)}${hidden('version', order.version)}${hidden('operation', 'correct')}
          ${field('guestName', order.guest_name, '入住人', 'text', 'required')}${button('保存姓名', 'secondary')}</form></details>
        <details><summary>取消预订</summary><p>入住日18:00前且未实际入住可免费取消。</p>
          <form data-form="order-change">${hidden('id', order.id)}${hidden('version', order.version)}
          ${hidden('operation', 'cancel')}${button('确认免费取消', 'secondary')}</form></details></div>`,
            )
          : ''
      }
    </aside></div>
  </div>`;
}

async function amendmentView(id) {
  const order = await api('/orders/' + id);
  const options = (await api('/room-types')).map((row) => [row.id, row.hotel_name + ' · ' + row.name]);
  return `<div class="frame guest"><a class="back" href="#order/${id}">← 返回预订详情</a>
    ${heading('调整住宿', '提交成功后将重新等待酒店确认。')}
    <div id="feedback" aria-live="polite"></div>
    ${section(
      '新的入住安排',
      `<form class="filters" data-form="amend">
      ${hidden('original', id)}${hidden('guestName', order.guest_name)}
      ${select('typeId', '房型', options, order.type_id)}
      ${field('arrival', order.arrival, '入住日期', 'date', 'required')}
      ${field('departure', order.departure, '退房日期', 'date', 'required')}
      ${field('guests', order.guests, '人数', 'number', 'min="1" max="48" required')}
      ${field('quantity', order.quantity, '间数', 'number', 'min="1" max="12" required')}
      ${button('取得新报价')}</form>`,
    )}
    </div>`;
}

async function show(preloaded) {
  const now = ++revision;
  const [view, id] = (
    location.hash.slice(1) || (state.actor && state.actor.role !== 'guest' ? 'desk' : 'search')
  ).split('/');
  layout(view);
  const main = $('#main');
  main.setAttribute('aria-busy', 'true');
  try {
    let page;
    if (view === 'search') page = await searchView(preloaded);
    else if (view === 'login') page = loginView();
    else if (view === 'quote') page = quoteView();
    else if (view === 'orders') page = state.actor?.role === 'guest' ? await ordersView() : loginView();
    else if (view === 'order') page = await orderView(id);
    else if (view === 'amend') page = await amendmentView(id);
    else page = await deskView(state, view, id);
    if (now === revision) main.innerHTML = page;
  } catch (error) {
    if (now === revision)
      main.innerHTML = `<div class="frame guest"><div id="feedback">${notice(error.message, 'error')}</div>
      <a class="back" href="#search">返回房型目录</a></div>`;
  } finally {
    if (now === revision) main.setAttribute('aria-busy', 'false');
  }
}

function go(hash) {
  if (location.hash === '#' + hash) void show();
  else location.hash = hash;
}

async function fetchQuote(plan, id = null, guest = '') {
  if (!state.actor || state.actor.role !== 'guest') {
    state.pendingPlan = { plan, id, guest };
    go('login');
    return;
  }
  state.quote = await api(id ? '/orders/' + id + '/quotes' : '/quotes', plan);
  state.decision = null;
  state.orderId = id;
  state.guestName = guest;
  state.requestKey = crypto.randomUUID();
  go('quote');
}

async function enter(input, endpoint = '/session') {
  state.actor = (await api(endpoint, input)).actor;
  state.ops = {};
  if (state.actor.role === 'guest' && state.pendingPlan) {
    const { plan, id, guest } = state.pendingPlan;
    state.pendingPlan = null;
    await fetchQuote(plan, id, guest);
  } else go(state.actor.role === 'guest' ? 'search' : 'desk');
}

async function submit(input) {
  state.guestName = input.guestName;
  const result = await api(state.orderId ? '/orders/' + state.orderId + '/amend' : '/orders', {
    ...state.quote.plan,
    quoteId: state.quote.id,
    guestName: input.guestName,
    requestKey: state.requestKey,
    decisionId: state.decision?.decisionId ?? null,
  });
  if (result.outcome === 'saved') {
    state.quote = null;
    go('order/' + result.id);
  } else {
    state.decision = result;
    if (result.quote) state.quote = result.quote;
    state.requestKey = crypto.randomUUID();
    await show();
  }
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action: command, value } = target.dataset;
  target.disabled = true;
  try {
    if (command === 'quote') {
      const { arrival, departure, guests, quantity } = state.search;
      await fetchQuote({ typeId: Number(value), arrival, departure, guests, quantity });
    } else if (command === 'demo') {
      await enter({ username: value, password: 'bosu-demo' });
    } else if (command === 'logout') {
      await api('/logout', {});
      state.actor = null;
      state.quote = null;
      state.pendingPlan = null;
      go('search');
    } else {
      const message = await deskAction(state, command, value);
      await show();
      if (message) messages(message, 'success');
    }
  } catch (error) {
    messages(error);
  } finally {
    target.disabled = false;
  }
});

document.addEventListener('change', (event) => {
  const input = event.target;
  if (!input.matches('input[name="roomIds"]')) return;
  const form = input.closest('form[data-required-rooms]');
  if (!form) return;
  const selected = form.querySelectorAll('input[name="roomIds"]:checked').length;
  const required = Number(form.dataset.requiredRooms);
  form.querySelector('output').textContent = `已选 ${selected} / ${required} 间`;
  form.querySelector('button[type="submit"]').disabled = selected !== required;
});

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.matches('[data-form]')) return;
  event.preventDefault();
  const input = inputData(form);
  const submitter = event.submitter || form.querySelector('button[type=submit]');
  if (submitter) submitter.disabled = true;
  try {
    const kind = form.dataset.form;
    if (kind === 'search') {
      const result = await queryRooms(input);
      state.search = input;
      await show(result);
    } else if (kind === 'login') await enter(input);
    else if (kind === 'register') await enter(input, '/register');
    else if (kind === 'submit') await submit(input);
    else if (kind === 'amend') {
      const { original, guestName, ...plan } = input;
      await fetchQuote(plan, Number(original), guestName);
    } else if (kind === 'order-change') {
      const { id, operation, ...body } = input;
      await api('/orders/' + id + '/' + operation, body);
      await show();
      messages('预订已更新。', 'success');
    } else {
      const message = await deskForm(state, kind, input, new FormData(form));
      await show();
      if (message) messages(message, 'success');
    }
  } catch (error) {
    messages(error);
  } finally {
    if (submitter) submitter.disabled = false;
  }
});

window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  void show();
});

try {
  const session = await api('/session');
  state.actor = session.actor;
  state.today = session.today;
  state.search = searchDefaults(session.today);
  await show();
} catch (error) {
  $('#main').innerHTML = `<div class="frame">${notice(error.message, 'error')}</div>`;
}
