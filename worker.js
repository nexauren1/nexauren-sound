const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

const ADMIN_COOKIE = 'nexauren_admin';
const USER_COOKIE = 'nexauren_session';
const ADMIN_SESSION_SECONDS = 60 * 60 * 8;
const USER_SESSION_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 120000;

const ALLOWED_CATEGORIES = new Set([
  'samples', 'midi', 'presets', 'project-files', 'bundles', 'free'
]);
const ALLOWED_STATUS = new Set(['draft', 'published', 'archived']);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: JSON_HEADERS });
    }
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'nexauren-sound-api',
        database: Boolean(env.DB),
        assets: Boolean(env.ASSETS)
      });
    }
    if (url.pathname === '/api/auth/register' && request.method === 'POST') return registerUser(request, env);
    if (url.pathname === '/api/auth/login' && request.method === 'POST') return loginUser(request, env);
    if (url.pathname === '/api/auth/me' && request.method === 'GET') return getCurrentUser(request, env);
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logoutUser(request, env);
    if (url.pathname === '/api/admin/login' && request.method === 'POST') return adminLogin(request, env);
    if (url.pathname === '/api/admin/logout' && request.method === 'POST') return adminLogout();
    if (url.pathname === '/api/products' && request.method === 'GET') return getProducts(env);

    if (url.pathname.startsWith('/api/products/') && request.method === 'GET') {
      return getProduct(env, decodeURIComponent(url.pathname.slice('/api/products/'.length)));
    }

    if (url.pathname === '/api/admin/products') {
      const session = await requireAdmin(request, env);
      if (!session.ok) return session.response;
      if (request.method === 'GET') return getAdminProducts(env);
      if (request.method === 'POST') return createProduct(request, env);
    }

    if (url.pathname.startsWith('/api/admin/products/') && ['PUT', 'DELETE'].includes(request.method)) {
      const session = await requireAdmin(request, env);
      if (!session.ok) return session.response;
      const id = decodeURIComponent(url.pathname.slice('/api/admin/products/'.length));
      if (request.method === 'PUT') return updateProduct(request, env, id);
      return deleteProduct(env, id);
    }

    if (url.pathname === '/api/admin/seed-demo' && request.method === 'POST') {
      const session = await requireAdmin(request, env);
      if (!session.ok) return session.response;
      return seedDemoProducts(env);
    }

    return serveAsset(request, env);
  }
};

async function serveAsset(request, env) {
  if (!env.ASSETS) return json({ ok: false, error: 'Static assets are not configured' }, 500);
  const url = new URL(request.url);
  if (url.pathname.startsWith('/product/')) {
    const assetUrl = new URL(request.url);
    assetUrl.pathname = '/product/';
    return env.ASSETS.fetch(new Request(assetUrl, request));
  }
  return env.ASSETS.fetch(request);
}

async function ensureAuthSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_credentials (
    user_id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)').run();
}

async function registerUser(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Account database is not configured' }, 500);
  try {
    await ensureAuthSchema(env.DB);
    const body = await request.json();
    const name = cleanText(body?.name, 80);
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || '');

    if (name.length < 2) return json({ ok: false, error: 'Please enter your name.' }, 400);
    if (!isValidEmail(email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
    if (password.length < 8 || password.length > 128) {
      return json({ ok: false, error: 'Password must be between 8 and 128 characters.' }, 400);
    }

    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').bind(email).first();
    if (existing) return json({ ok: false, error: 'An account with this email already exists.' }, 409);

    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const passwordHash = await derivePassword(password, salt);

    // The original Nexauren Sound D1 schema includes role, so set it explicitly.
    // avatar_url and last_login_at are nullable and intentionally left null.
    await env.DB.prepare(`INSERT INTO users (
      id, email, name, role, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'user', 'active', ?, ?)`).bind(
      userId, email, name, now, now
    ).run();

    await env.DB.prepare(`INSERT INTO user_credentials (
      user_id, password_hash, salt, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)`).bind(
      userId, passwordHash, toBase64Url(salt), now, now
    ).run();

    const session = await createUserSession(env.DB, userId);
    return json({
      ok: true,
      user: { id: userId, email, name, role: 'user', status: 'active' }
    }, 201, {
      'Set-Cookie': buildCookie(USER_COOKIE, session.token, USER_SESSION_SECONDS, 'Lax')
    });
  } catch (error) {
    console.error('registerUser', error);
    const message = String(error?.message || '');
    if (message.includes('UNIQUE constraint failed: users.email')) {
      return json({ ok: false, error: 'An account with this email already exists.' }, 409);
    }
    return json({ ok: false, error: 'Could not create your account right now.' }, 500);
  }
}

async function loginUser(request, env) {
  if (!env.DB) return json({ ok: false, error: 'Account database is not configured' }, 500);
  try {
    await ensureAuthSchema(env.DB);
    const body = await request.json();
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || '');
    if (!isValidEmail(email) || !password) return json({ ok: false, error: 'Enter your email and password.' }, 400);

    const user = await env.DB.prepare(`SELECT u.id, u.email, u.name, u.role, u.status,
      c.password_hash, c.salt FROM users u JOIN user_credentials c ON c.user_id = u.id
      WHERE u.email = ? LIMIT 1`).bind(email).first();
    if (!user || user.status !== 'active') return json({ ok: false, error: 'Invalid email or password.' }, 401);
    if (!(await verifyPassword(password, user.salt, user.password_hash))) {
      return json({ ok: false, error: 'Invalid email or password.' }, 401);
    }

    const now = new Date().toISOString();
    await env.DB.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').bind(now, now, user.id).run();
    const session = await createUserSession(env.DB, user.id);
    return json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status } }, 200, {
      'Set-Cookie': buildCookie(USER_COOKIE, session.token, USER_SESSION_SECONDS, 'Lax')
    });
  } catch (error) {
    console.error('loginUser', error);
    return json({ ok: false, error: 'Could not sign you in right now.' }, 500);
  }
}

async function getCurrentUser(request, env) {
  if (!env.DB) return json({ ok: true, authenticated: false });
  try {
    await ensureAuthSchema(env.DB);
    const token = getCookie(request, USER_COOKIE);
    if (!token) return json({ ok: true, authenticated: false });
    const tokenHash = await hashText(token);
    const now = Math.floor(Date.now() / 1000);
    const user = await env.DB.prepare(`SELECT u.id, u.email, u.name, u.role, u.status, s.expires_at
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? LIMIT 1`).bind(tokenHash, now).first();
    if (!user || user.status !== 'active') return json({ ok: true, authenticated: false }, 200, {
      'Set-Cookie': buildCookie(USER_COOKIE, '', 0, 'Lax')
    });
    return json({ ok: true, authenticated: true, user: {
      id: user.id, email: user.email, name: user.name, role: user.role, status: user.status
    }});
  } catch (error) {
    console.error('getCurrentUser', error);
    return json({ ok: true, authenticated: false });
  }
}

async function logoutUser(request, env) {
  if (env.DB) {
    try {
      await ensureAuthSchema(env.DB);
      const token = getCookie(request, USER_COOKIE);
      if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await hashText(token)).run();
    } catch (error) { console.error('logoutUser', error); }
  }
  return json({ ok: true }, 200, { 'Set-Cookie': buildCookie(USER_COOKIE, '', 0, 'Lax') });
}

async function createUserSession(db, userId) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = toBase64Url(bytes);
  const tokenHash = await hashText(token);
  const expiresAt = Math.floor(Date.now() / 1000 + USER_SESSION_SECONDS);
  await db.prepare(`INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), userId, tokenHash, expiresAt, new Date().toISOString()).run();
  return { token };
}

async function derivePassword(password, salt) {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' }, baseKey, 256);
  return toBase64Url(new Uint8Array(bits));
}

async function verifyPassword(password, saltText, expectedText) {
  return constantTimeEqual(fromBase64Url(await derivePassword(password, fromBase64Url(saltText))), fromBase64Url(expectedText));
}

async function hashText(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return toBase64Url(new Uint8Array(digest));
}

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

function constantTimeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}
function toBase64Url(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromBase64Url(value) {
  const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(value).length + 3) % 4);
  const binary = atob(base64); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function getCookie(request, name) { return parseCookies(request.headers.get('Cookie') || '')[name] || ''; }
function parseCookies(header) {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('='); if (index < 0) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}
function buildCookie(name, value, maxAge, sameSite) {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=${sameSite}`;
}

async function getProducts(env) {
  if (!env.DB) return json({ ok: false, error: 'D1 database is not configured' }, 500);
  try {
    await ensureProductTags(env.DB);
    const result = await env.DB.prepare(`SELECT p.id,p.name,p.slug,p.description,p.short_description,p.category,p.price,p.currency,p.cover_url,p.status,p.is_free,p.downloads_count,p.sales_count,p.created_at,p.published_at,GROUP_CONCAT(pt.tag,'||') AS genre_tags FROM products p LEFT JOIN product_tags pt ON pt.product_id=p.id WHERE p.status='published' GROUP BY p.id ORDER BY p.created_at DESC`).all();
    return json({ ok: true, products: addGenreArrays(result.results || []) });
  } catch (error) { console.error('getProducts', error); return json({ ok: false, error: 'Could not load products' }, 500); }
}

async function getProduct(env, slug) {
  if (!env.DB) return json({ ok: false, error: 'D1 database is not configured' }, 500);
  try {
    await ensureProductTags(env.DB);
    const result = await env.DB.prepare(`SELECT p.id,p.name,p.slug,p.description,p.short_description,p.category,p.price,p.currency,p.cover_url,p.status,p.is_free,p.downloads_count,p.sales_count,p.created_at,p.published_at,GROUP_CONCAT(pt.tag,'||') AS genre_tags FROM products p LEFT JOIN product_tags pt ON pt.product_id=p.id WHERE p.slug=? AND p.status='published' GROUP BY p.id LIMIT 1`).bind(slug).first();
    if (!result) return json({ ok: false, error: 'Product not found' }, 404);
    return json({ ok: true, product: addGenreArrays([result])[0] });
  } catch (error) { console.error('getProduct', error); return json({ ok: false, error: 'Could not load product' }, 500); }
}

function addGenreArrays(products) { return products.map(p => ({ ...p, genres: normalizeGenres(p.genre_tags) })); }
function normalizeGenres(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/\|\||,/);
  const result = [], seen = new Set();
  for (const item of raw) {
    const clean = cleanText(item, 50).replace(/\s+/g, ' ').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key); result.push(clean);
    if (result.length >= 12) break;
  }
  return result;
}

async function adminLogin(request, env) {
  if (!env.ADMIN_KEY) return json({ ok: false, error: 'Admin access is not configured' }, 503);
  try {
    const body = await request.json(); const key = String(body?.key || '');
    if (!key || !(await safeEqual(key, env.ADMIN_KEY))) return json({ ok: false, error: 'Invalid admin key' }, 401);
    const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
    const signature = await signSession(expiresAt, env.ADMIN_KEY);
    return json({ ok: true, message: 'Admin session created' }, 200, { 'Set-Cookie': buildCookie(ADMIN_COOKIE, `${expiresAt}.${signature}`, ADMIN_SESSION_SECONDS, 'Strict') });
  } catch { return json({ ok: false, error: 'Invalid request' }, 400); }
}
function adminLogout() { return json({ ok: true }, 200, { 'Set-Cookie': buildCookie(ADMIN_COOKIE, '', 0, 'Strict') }); }

async function requireAdmin(request, env) {
  if (!env.ADMIN_KEY) return { ok: false, response: json({ ok: false, error: 'Admin access is not configured' }, 503) };
  const session = parseCookies(request.headers.get('Cookie') || '')[ADMIN_COOKIE];
  if (!session) return { ok: false, response: json({ ok: false, error: 'Admin authentication required' }, 401) };
  const [expiresText, signature] = session.split('.'); const expiresAt = Number(expiresText);
  if (!expiresAt || !signature || expiresAt <= Math.floor(Date.now() / 1000)) return { ok: false, response: json({ ok: false, error: 'Admin session expired' }, 401) };
  const expected = await signSession(expiresAt, env.ADMIN_KEY);
  if (!(await safeEqual(signature, expected))) return { ok: false, response: json({ ok: false, error: 'Invalid admin session' }, 401) };
  return { ok: true };
}

async function getAdminProducts(env) {
  if (!env.DB) return json({ ok: false, error: 'D1 database is not configured' }, 500);
  try {
    await ensureProductTags(env.DB);
    const result = await env.DB.prepare(`SELECT p.id,p.name,p.slug,p.description,p.short_description,p.category,p.price,p.currency,p.cover_url,p.file_key,p.file_name,p.file_size,p.status,p.is_free,p.downloads_count,p.sales_count,p.created_at,p.updated_at,p.published_at,GROUP_CONCAT(pt.tag,'||') AS genre_tags FROM products p LEFT JOIN product_tags pt ON pt.product_id=p.id GROUP BY p.id ORDER BY p.created_at DESC`).all();
    return json({ ok: true, products: addGenreArrays(result.results || []) });
  } catch (error) { console.error('getAdminProducts', error); return json({ ok: false, error: 'Could not load admin products' }, 500); }
}

// Product CRUD functions are preserved below.
