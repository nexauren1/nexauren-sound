const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

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
        database: Boolean(env.DB)
      });
    }

    if (url.pathname === '/api/products') {
      return getProducts(env);
    }

    if (url.pathname.startsWith('/api/products/')) {
      const slug = decodeURIComponent(
        url.pathname.slice('/api/products/'.length)
      );

      return getProduct(env, slug);
    }

    return json({
      ok: false,
      error: 'Not found'
    }, 404);
  }
};

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
          id,
          name,
          slug,
          description,
          short_description,
          category,
          price,
          currency,
          cover_url,
          status,
          is_free,
          downloads_count,
          sales_count,
          created_at,
          published_at
        FROM products
        WHERE status = 'published'
        ORDER BY created_at DESC
      `)
      .all();

    return json({
      ok: true,
      products: result.results || []
    });
  } catch (error) {
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
          id,
          name,
          slug,
          description,
          short_description,
          category,
          price,
          currency,
          cover_url,
          status,
          is_free,
          downloads_count,
          sales_count,
          created_at,
          published_at
        FROM products
        WHERE slug = ?
          AND status = 'published'
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
      product: result
    });
  } catch (error) {
    return json({
      ok: false,
      error: 'Could not load product'
    }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}
