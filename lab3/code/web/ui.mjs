export const $ = (selector) => document.querySelector(selector);
export const e = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );

export async function api(path, value) {
  const options =
    value === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        };
  const response = await fetch('/api' + path, options);
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message), { code: data.code });
  return data;
}

export const money = (cents) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

export const when = (instant) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);

export const orderStates = {
  pending: '待确认',
  confirmed: '已确认',
  staying: '已入住',
  completed: '已完成',
  cancelled: '已取消',
};
export const roomStates = { free: '空闲', occupied: '已入住', cleaning: '待清洁', repair: '维修中' };
export const roles = { guest: '顾客', staff: '酒店前台', admin: '平台管理' };

export const days = (date, step) => new Date(Date.parse(date) + step * 86400000).toISOString().slice(0, 10);
export const countNights = (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000;
export const dateRange = (from, to) => from + ' 至 ' + to;
export const ref = (id) => 'BS-' + String(id).padStart(5, '0');
export const routeUrl = (path, query) => path + '?' + new URLSearchParams(query);

export function status(value) {
  return `<span class="status ${e(value)}"><i></i>${e(orderStates[value] ?? roomStates[value] ?? value)}</span>`;
}

export function field(name, value, label, type = 'text', options = '') {
  return `<label>${e(label)}<input class="form-control" name="${e(name)}" type="${e(type)}" value="${e(value)}" ${options}></label>`;
}

export function select(name, label, items, selected = '') {
  return `<label>${e(label)}<select class="form-select" name="${e(name)}">${items
    .map(
      ([value, title]) =>
        `<option value="${e(value)}"${String(value) === String(selected) ? ' selected' : ''}>${e(title)}</option>`,
    )
    .join('')}</select></label>`;
}

export const hidden = (name, value) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`;
export const checkbox = (name, caption, checked = false) =>
  `<label class="check"><input class="form-check-input" type="checkbox" name="${e(name)}"${checked ? ' checked' : ''}>${e(caption)}</label>`;

const buttonTheme = { secondary: 'btn-outline-primary', text: 'btn-link' };

export function action(name, label, data = '', kind = '') {
  return `<button type="button" class="btn ${buttonTheme[kind] ?? 'btn-primary'}" data-action="${e(name)}" data-value="${e(data)}">${e(label)}</button>`;
}

export function button(label, kind = '') {
  return `<button class="btn ${buttonTheme[kind] ?? 'btn-primary'}" type="submit">${e(label)}</button>`;
}

export function heading(title, intro = '') {
  return `<div class="page-title"><h1>${e(title)}</h1>${intro ? `<p>${e(intro)}</p>` : ''}</div>`;
}

export function table(headers, rows) {
  if (!rows.length) return '<p class="empty">暂无符合条件的记录。</p>';
  return `<div class="table-wrap"><table class="table table-hover"><thead class="table-light"><tr>${headers.map((h) => `<th scope="col">${e(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((item) => `<td>${item}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function photograph(file, alt, className = '') {
  return `<img class="${e(className)}" src="/photos/${encodeURIComponent(file)}" alt="${e(alt)}">`;
}

export function notice(text, kind = '') {
  const tone = { error: 'danger', success: 'success' }[kind] ?? 'primary';
  return `<p class="notice alert alert-${tone}" role="status">${e(text)}</p>`;
}

export function messages(error, kind = 'error') {
  const region = $('#feedback');
  if (region) region.innerHTML = notice(error instanceof Error ? error.message : error, kind);
}

export const inputData = (form) => Object.fromEntries(new FormData(form));

export function section(title, content) {
  return `<section class="panel card"><h2>${e(title)}</h2>${content}</section>`;
}
