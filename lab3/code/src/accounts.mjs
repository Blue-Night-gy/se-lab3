import { HOUR, fingerprint, passwordMatches, passwordDigest, requireThat, text, token } from './model.mjs';

const cookieKey = 'bosu_session';
const fakeDigest = passwordDigest('placeholder-for-invalid-credentials');

function sessionCookie(value, lifetime) {
  return cookieKey + '=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + lifetime;
}

function readCookie(header) {
  for (const field of (header ?? '').split(';')) {
    const [name, value] = field.trim().split('=', 2);
    if (name === cookieKey && /^[\w-]{32}$/.test(value ?? '')) return value;
  }
  return null;
}

export function identify(db, cookie) {
  const value = readCookie(cookie);
  if (!value) return null;
  return (
    db.get(
      `SELECT a.id,a.username,a.name,a.role FROM sessions s
    JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=?
    AND s.expires_at>? AND a.enabled=1`,
      fingerprint(value),
      db.clock(),
    ) ?? null
  );
}

export function login(db, input) {
  const username = text(input.username, '账号', 40);
  const account = db.get('SELECT * FROM accounts WHERE username=? AND enabled=1', username);
  const valid = passwordMatches(input.password, account?.digest ?? fakeDigest);
  requireThat(account && valid, 'LOGIN', '账号或密码不正确', 401);
  const value = token();
  db.transaction(() => {
    db.run('DELETE FROM sessions WHERE expires_at<=?', db.clock());
    db.run('INSERT INTO sessions VALUES(?,?,?)', fingerprint(value), account.id, db.clock() + 8 * HOUR);
  });
  const { id, name, role } = account;
  return { actor: { id, username: account.username, name, role }, cookie: sessionCookie(value, 8 * 3600) };
}

export function logout(db, cookie) {
  const value = readCookie(cookie);
  if (value) db.run('DELETE FROM sessions WHERE token_hash=?', fingerprint(value));
  return sessionCookie('', 0);
}

export function register(db, input) {
  const username = text(input.username, '登录账号', 40);
  const name = text(input.name, '显示姓名', 40);
  const digest = passwordDigest(input.password);
  db.transaction(() => {
    requireThat(
      !db.get('SELECT 1 FROM accounts WHERE username=?', username),
      'USERNAME',
      '该账号已被使用',
      409,
    );
    db.run("INSERT INTO accounts(username,name,role,digest) VALUES(?,?,'guest',?)", username, name, digest);
  });
  return login(db, { username, password: input.password });
}
