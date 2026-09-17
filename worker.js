const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

const demoProducts = [
  {
    id: 'afro-house-essentials',
    name: 'Afro House Essentials',
    category: 'samples',
    price: 9.99,
    currency: 'USD',
    description:
      'Drums, percussion and musical elements for Afro House production.'
  },
  {
    id: 'auren-melodic-midi',
    name: 'Auren Melodic MIDI',
    category: 'midi',
    price: 7.99,
    currency: 'USD',
    description:
      'Melodies, chord progressions and ideas ready for your next track.'
  },
  {
    id: 'nexauren-atmospheres',
    name: 'Nexauren Atmospheres',
    category: 'presets',
    price: 8.99,
    currency: 'USD',
    description:
      'Modern atmospheric presets designed for electronic music.'
  }
];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: JSON_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        service: 'nexauren-sound-api'
      });
    }

    if (url.pathname === '/api/products') {
      return json({
        ok: true,
        products: demoProducts
      });
    }

    if (url.pathname.startsWith('/api/products/')) {
      const id = url.pathname.split('/').pop();
      const product = demoProducts.find(item => item.id === id);

      if (!product) {
        return json({ ok: false, error: 'Product not found' }, 404);
      }

      return json({ ok: true, product });
    }

    return json({
      ok: false,
      error: 'Not found'
    }, 404);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}
