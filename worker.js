const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

const ADMIN_COOKIE = 'nexauren_admin';
const ADMIN_SESSION_SECONDS = 60 * 60 * 8;

const ALLOWED_CATEGORIES = new Set([
  'samples',
  'midi',
  'presets',
  'project-files',
  'bundles',
  'free'
]);

const ALLOWED_STATUS = new Set([
  'draft',
  'published',
  'archived'
]);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: JSON_HEADERS
      });
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

    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      return adminLogin(request, env);
    }

    if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
      return adminLogout();
    }

    if (url.pathname === '/api/products' && request.method === 'GET') {
      return getProducts(env);
    }

    if (
      url.pathname.startsWith('/api/products/') &&
      request.method === 'GET'
    ) {
      const slug = decodeURIComponent(
        url.pathname.slice('/api/products/'.length)
      );

      return getProduct(env, slug);
    }

    if (url.pathname === '/api/admin/products') {
      const session = await requireAdmin(request, env);

      if (!session.ok) {
        return session.response;
      }

      if (request.method === 'GET') {
        return getAdminProducts(env);
      }

      if (request.method === 'POST') {
        return createProduct(request, env);
      }
    }

    if (
      url.pathname.startsWith('/api/admin/products/') &&
      ['PUT', 'DELETE'].includes(request.method)
    ) {
      const session = await requireAdmin(request, env);

      if (!session.ok) {
        return session.response;
      }

      const id = decodeURIComponent(
        url.pathname.slice('/api/admin/products/'.length)
      );

      if (request.method === 'PUT') {
        return updateProduct(request, env, id);
      }

      return deleteProduct(env, id);
    }

    return serveAsset(request, env);
  }
};

async function serveAsset(request, env) {
  if (!env.ASSETS) {
    return json({
      ok: false,
      error: 'Static assets are not configured'
    }, 500);
  }

  const url = new URL(request.url);

  if (url.pathname.startsWith('/product/')) {
    const assetUrl = new URL(request.url);
    assetUrl.pathname = '/product/';

    return env.ASSETS.fetch(
      new Request(assetUrl, request)
    );
  }

  return env.ASSETS.fetch(request);
}

async function getProducts(env) {
  if (!env.DB) {
    return json({
      ok: false,
      error: 'D1 database is not configured'
    }, 500);
  }

  try {
    const result = await env.DB
      .prepare(`
        SELECT
          p.id,
          p.name,
          p.slug,
          p.description,
          p.short_description,
          p.category,
          p.price,
          p.currency,
          p.cover_url,
          p.status,
          p.is_free,
          p.downloads_count,
          p.sales_count,
          p.created_at,
          p.published_at,
          GROUP_CONCAT(pt.tag, '||') AS genre_tags
        FROM products p
        LEFT JOIN product_tags pt
          ON pt.product_id = p.id
        WHERE p.status = 'published'
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `)
      .all();

    return json({
      ok: true,
      products: addGenreArrays(result.results || [])
    });
  } catch (error) {
    console.error('getProducts', error);

    return json({
      ok: false,
      error: 'Could not load products'
    }, 500);
  }
}

async function getProduct(env, slug) {
  if (!env.DB) {
    return json({
      ok: false,
      error: 'D1 database is not configured'
    }, 500);
  }

  try {
    const result = await env.DB
      .prepare(`
        SELECT
          p.id,
          p.name,
          p.slug,
          p.description,
          p.short_description,
          p.category,
          p.price,
          p.currency,
          p.cover_url,
          p.status,
          p.is_free,
          p.downloads_count,
          p.sales_count,
          p.created_at,
          p.published_at,
          GROUP_CONCAT(pt.tag, '||') AS genre_tags
        FROM products p
        LEFT JOIN product_tags pt
          ON pt.product_id = p.id
        WHERE p.slug = ?
          AND p.status = 'published'
        GROUP BY p.id
        LIMIT 1
      `)
      .bind(slug)
      .first();

    if (!result) {
      return json({
        ok: false,
        error: 'Product not found'
      }, 404);
    }

    return json({
      ok: true,
      product: addGenreArrays([result])[0]
    });
  } catch (error) {
    console.error('getProduct', error);

    return json({
      ok: false,
      error: 'Could not load product'
    }, 500);
  }
}

async function adminLogin(request, env) {
  if (!env.ADMIN_KEY) {
    return json({
      ok: false,
      error: 'Admin access is not configured'
    }, 503);
  }

  try {
    const body = await request.json();
    const key = String(body?.key || '');

    if (!key || !(await safeEqual(key, env.ADMIN_KEY))) {
      return json({
        ok: false,
        error: 'Invalid admin key'
      }, 401);
    }

    const expiresAt = Math.floor(Date.now() / 1000) +
      ADMIN_SESSION_SECONDS;
    const signature = await signSession(
      expiresAt,
      env.ADMIN_KEY
    );
    const value = `${expiresAt}.${signature}`;

    return json({
      ok: true,
      message: 'Admin session created'
    }, 200, {
      'Set-Cookie': buildCookie(
        value,
        ADMIN_SESSION_SECONDS
      )
    });
  } catch {
    return json({
      ok: false,
      error: 'Invalid request'
    }, 400);
  }
}

function adminLogout() {
  return json({
    ok: true
  }, 200, {
    'Set-Cookie': buildCookie('', 0)
  });
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_KEY) {
    return {
      ok: false,
      response: json({
        ok: false,
        error: 'Admin access is not configured'
      }, 503)
    };
  }

  const cookies = parseCookies(
    request.headers.get('Cookie') || ''
  );
  const session = cookies[ADMIN_COOKIE];

  if (!session) {
    return {
      ok: false,
      response: json({
        ok: false,
        error: 'Admin authentication required'
      }, 401)
    };
  }

  const [expiresText, signature] = session.split('.');
  const expiresAt = Number(expiresText);

  if (
    !expiresAt ||
    !signature ||
    expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    return {
      ok: false,
      response: json({
        ok: false,
        error: 'Admin session expired'
      }, 401)
    };
  }

  const expected = await signSession(
    expiresAt,
    env.ADMIN_KEY
  );

  if (!(await safeEqual(signature, expected))) {
    return {
      ok: false,
      response: json({
        ok: false,
        error: 'Invalid admin session'
      }, 401)
    };
  }

  return { ok: true };
}

async function getAdminProducts(env) {
  if (!env.DB) {
    return json({
      ok: false,
      error: 'D1 database is not configured'
    }, 500);
  }

  try {
    const result = await env.DB
      .prepare(`
        SELECT
          p.id,
          p.name,
          p.slug,
          p.description,
          p.short_description,
          p.category,
          p.price,
          p.currency,
          p.cover_url,
          p.file_key,
          p.file_name,
          p.file_size,
          p.status,
          p.is_free,
          p.downloads_count,
          p.sales_count,
          p.created_at,
          p.updated_at,
          p.published_at,
          GROUP_CONCAT(pt.tag, '||') AS genre_tags
        FROM products p
        LEFT JOIN product_tags pt
          ON pt.product_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC
      `)
      .all();

    return json({
      ok: true,
      products: addGenreArrays(result.results || [])
    });
  } catch (error) {
    console.error('getAdminProducts', error);

    return json({
      ok: false,
      error: 'Could not load admin products'
    }, 500);
  }
}

async function createProduct(request, env) {
  const validation = await readProductBody(request);

  if (!validation.ok) {
    return json({
      ok: false,
      error: validation.error
    }, 400);
  }

  const product = validation.product;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const publishedAt = product.status === 'published'
    ? now
    : null;

  try {
    const existing = await env.DB
      .prepare('SELECT id FROM products WHERE slug = ? LIMIT 1')
      .bind(product.slug)
      .first();

    if (existing) {
      return json({
        ok: false,
        error: 'A product with this slug already exists'
      }, 409);
    }

    await env.DB
      .prepare(`
        INSERT INTO products (
          id,
          name,
          slug,
          description,
          short_description,
          category,
          price,
          currency,
          cover_url,
          file_key,
          file_name,
          file_size,
          status,
          is_free,
          downloads_count,
          sales_count,
          created_at,
          updated_at,
          published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
      `)
      .bind(
        id,
        product.name,
        product.slug,
        product.description,
        product.shortDescription,
        product.category,
        product.price,
        product.currency,
        product.coverUrl,
        product.fileKey,
        product.fileName,
        product.fileSize,
        product.status,
        product.isFree,
        now,
        now,
        publishedAt
      )
      .run();

    await replaceProductGenres(
      env,
      id,
      product.genres
    );

    return json({
      ok: true,
      product: {
        id,
        ...product,
        created_at: now,
        updated_at: now,
        published_at: publishedAt,
        downloads_count: 0,
        sales_count: 0
      }
    }, 201);
  } catch (error) {
    console.error('createProduct', error);

    return json({
      ok: false,
      error: 'Could not create product'
    }, 500);
  }
}

async function updateProduct(request, env, id) {
  const validation = await readProductBody(request);

  if (!validation.ok) {
    return json({
      ok: false,
      error: validation.error
    }, 400);
  }

  const product = validation.product;
  const now = new Date().toISOString();

  try {
    const existing = await env.DB
      .prepare(`
        SELECT id, created_at, published_at
        FROM products
        WHERE id = ?
        LIMIT 1
      `)
      .bind(id)
      .first();

    if (!existing) {
      return json({
        ok: false,
        error: 'Product not found'
      }, 404);
    }

    const slugOwner = await env.DB
      .prepare(`
        SELECT id
        FROM products
        WHERE slug = ?
          AND id != ?
        LIMIT 1
      `)
      .bind(product.slug, id)
      .first();

    if (slugOwner) {
      return json({
        ok: false,
        error: 'A product with this slug already exists'
      }, 409);
    }

    const publishedAt = product.status === 'published'
      ? (existing.published_at || now)
      : null;

    await env.DB
      .prepare(`
        UPDATE products
        SET
          name = ?,
          slug = ?,
          description = ?,
          short_description = ?,
          category = ?,
          price = ?,
          currency = ?,
          cover_url = ?,
          file_key = ?,
          file_name = ?,
          file_size = ?,
          status = ?,
          is_free = ?,
          updated_at = ?,
          published_at = ?
        WHERE id = ?
      `)
      .bind(
        product.name,
        product.slug,
        product.description,
        product.shortDescription,
        product.category,
        product.price,
        product.currency,
        product.coverUrl,
        product.fileKey,
        product.fileName,
        product.fileSize,
        product.status,
        product.isFree,
        now,
        publishedAt,
        id
      )
      .run();

    await replaceProductGenres(
      env,
      id,
      product.genres
    );

    return json({
      ok: true,
      product: {
        id,
        ...product,
        created_at: existing.created_at,
        updated_at: now,
        published_at: publishedAt
      }
    });
  } catch (error) {
    console.error('updateProduct', error);

    return json({
      ok: false,
      error: 'Could not update product'
    }, 500);
  }
}

async function deleteProduct(env, id) {
  if (!env.DB) {
    return json({
      ok: false,
      error: 'D1 database is not configured'
    }, 500);
  }

  try {
    const existing = await env.DB
      .prepare('SELECT id FROM products WHERE id = ? LIMIT 1')
      .bind(id)
      .first();

    if (!existing) {
      return json({
        ok: false,
        error: 'Product not found'
      }, 404);
    }

    await env.DB
      .prepare('DELETE FROM product_tags WHERE product_id = ?')
      .bind(id)
      .run();

    await env.DB
      .prepare('DELETE FROM products WHERE id = ?')
      .bind(id)
      .run();

    return json({
      ok: true,
      message: 'Product deleted'
    });
  } catch (error) {
    console.error('deleteProduct', error);

    return json({
      ok: false,
      error: 'Could not delete product'
    }, 500);
  }
}

async function readProductBody(request) {
  let body;

  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      error: 'Invalid JSON body'
    };
  }

  const name = cleanText(body?.name, 160);
  const slug = makeSlug(body?.slug || name);
  const description = cleanText(body?.description, 5000);
  const shortDescription = cleanText(
    body?.short_description || body?.shortDescription,
    300
  );
  const category = cleanText(body?.category, 40);
  const currency = cleanText(
    body?.currency || 'USD',
    10
  ).toUpperCase();
  const coverUrl = cleanText(
    body?.cover_url || body?.coverUrl,
    1000
  );
  const fileKey = cleanText(
    body?.file_key || body?.fileKey,
    500
  );
  const fileName = cleanText(
    body?.file_name || body?.fileName,
    255
  );
  const fileSize = Math.max(
    0,
    Number(body?.file_size || body?.fileSize || 0)
  );
  const status = ALLOWED_STATUS.has(body?.status)
    ? body.status
    : 'draft';
  let price = Number(body?.price ?? 0);
  const isFree = Boolean(
    body?.is_free ?? body?.isFree
  ) || price <= 0;
  const genres = normalizeGenres(
    body?.genres ?? body?.tags ?? body?.genre_tags
  );

  if (!name) {
    return {
      ok: false,
      error: 'Product name is required'
    };
  }

  if (!slug) {
    return {
      ok: false,
      error: 'Product slug is required'
    };
  }

  if (!ALLOWED_CATEGORIES.has(category)) {
    return {
      ok: false,
      error: 'Invalid product category'
    };
  }

  if (!Number.isFinite(price) || price < 0) {
    return {
      ok: false,
      error: 'Price must be a valid positive number'
    };
  }

  if (isFree) {
    price = 0;
  }

  if (status === 'published' && !isFree && price <= 0) {
    return {
      ok: false,
      error: 'Paid products need a price'
    };
  }

  return {
    ok: true,
    product: {
      name,
      slug,
      description,
      shortDescription,
      category,
      price,
      currency,
      coverUrl,
      fileKey,
      fileName,
      fileSize,
      status,
      isFree: isFree ? 1 : 0,
      genres
    }
  };
}

function addGenreArrays(products) {
  return products.map((product) => ({
    ...product,
    genres: normalizeGenres(product.genre_tags)
  }));
}

function normalizeGenres(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '').split(',');

  const result = [];
  const seen = new Set();

  for (const item of raw) {
    const clean = cleanText(item, 40)
      .replace(/\|/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = clean.toLowerCase();

    if (!clean || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(clean);

    if (result.length >= 8) {
      break;
    }
  }

  return result;
}

async function replaceProductGenres(env, productId, genres) {
  await env.DB
    .prepare('DELETE FROM product_tags WHERE product_id = ?')
    .bind(productId)
    .run();

  for (const genre of genres) {
    await env.DB
      .prepare(`
        INSERT INTO product_tags (
          id,
          product_id,
          tag
        ) VALUES (?, ?, ?)
      `)
      .bind(
        crypto.randomUUID(),
        productId,
        genre
      )
      .run();
  }
}

function cleanText(value, maxLength) {
  return String(value ?? '')
    .trim()
    .slice(0, maxLength);
}

function makeSlug(value) {
  return cleanText(value, 120)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));

  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i];
  }

  return diff === 0;
}

async function signSession(expiresAt, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(String(expiresAt))
  );

  return toBase64Url(new Uint8Array(signature));
}

function toBase64Url(bytes) {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function parseCookies(header) {
  return header.split(';').reduce((cookies, part) => {
    const [key, ...rest] = part.trim().split('=');

    if (key) {
      cookies[key] = decodeURIComponent(rest.join('='));
    }

    return cookies;
  }, {});
}

function buildCookie(value, maxAge) {
  return [
    `${ADMIN_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAge}`
  ].join('; ');
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders
    }
  });
}
