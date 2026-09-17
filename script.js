const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
const year = document.querySelector('#year');
const productsContainer = document.querySelector('#products');

if (year) {
  year.textContent = new Date().getFullYear();
}

menuToggle?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute(
    'aria-label',
    open ? 'Close menu' : 'Open menu'
  );
});

document.querySelectorAll('.nav a').forEach((link) => {
  link.addEventListener('click', () => {
    nav?.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', 'Open menu');
  });
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatPrice(price, currency) {
  if (Number(price) === 0) return 'Free';

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD'
    }).format(Number(price));
  } catch {
    return `${currency || 'USD'} ${Number(price).toFixed(2)}`;
  }
}

function categoryLabel(category) {
  const labels = {
    samples: 'SAMPLE PACK',
    midi: 'MIDI PACK',
    presets: 'PRESET PACK',
    'project-files': 'PROJECT FILE',
    bundles: 'BUNDLE',
    free: 'FREE DOWNLOAD'
  };

  return labels[category] || String(category || 'SOUND')
    .replaceAll('-', ' ')
    .toUpperCase();
}

function coverClass(index) {
  return [
    'cover-one',
    'cover-two',
    'cover-three'
  ][index % 3];
}

function productCard(product, index) {
  const title = escapeHtml(product.name);
  const description = escapeHtml(
    product.short_description ||
    product.description ||
    'Original sounds for your next track.'
  );
  const price = formatPrice(product.price, product.currency);
  const cover = product.cover_url
    ? `<img src="${escapeHtml(product.cover_url)}" alt="${title}" loading="lazy">`
    : `<span>${title}</span>`;

  return `
    <article class="product-card">
      <a class="product-cover ${coverClass(index)}"
        href="/product/?slug=${encodeURIComponent(product.slug)}"
        aria-label="View ${title}">
        ${cover}
      </a>
      <div class="product-info">
        <p class="product-type">
          ${escapeHtml(categoryLabel(product.category))}
        </p>
        <h3>${title}</h3>
        <p>${description}</p>
        <div class="product-bottom">
          <strong>${escapeHtml(price)}</strong>
          <a class="product-button"
            href="/product/?slug=${encodeURIComponent(product.slug)}">
            View product
          </a>
        </div>
      </div>
    </article>
  `;
}

function showProductsState(message, type = 'loading') {
  if (!productsContainer) return;

  if (type === 'loading') {
    productsContainer.innerHTML = `
      <div class="products-state">
        <span class="products-spinner"></span>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = `
    <div class="products-state products-state-error">
      <p>${escapeHtml(message)}</p>
      <button type="button" id="products-retry">Try again</button>
    </div>
  `;

  document.querySelector('#products-retry')?.addEventListener(
    'click',
    loadProducts
  );
}

async function fetchProducts() {
  const response = await fetch('/api/products', {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || 'Could not load products');
  }

  return Array.isArray(data.products) ? data.products : [];
}

async function loadProducts() {
  if (!productsContainer) return;

  showProductsState('Loading sounds...', 'loading');

  try {
    let products = await fetchProducts();
    const mode = productsContainer.dataset.productList || 'all';
    const params = new URLSearchParams(location.search);
    const category = params.get('category');

    if (mode === 'free') {
      products = products.filter((item) =>
        Number(item.price) === 0 ||
        Number(item.is_free) === 1 ||
        item.category === 'free'
      );
    }

    if (category && category !== 'all') {
      products = products.filter((item) => item.category === category);
    }

    const search = document.querySelector('#product-search');
    const applySearch = () => {
      const term = String(search?.value || '').trim().toLowerCase();
      const filtered = products.filter((item) => {
        const text = `${item.name} ${item.description || ''} ${item.category || ''}`;
        return text.toLowerCase().includes(term);
      });

      renderProductResults(filtered, mode);
    };

    search?.addEventListener('input', applySearch);
    renderProductResults(products, mode);
  } catch (error) {
    console.error('Nexauren Sound products:', error);
    showProductsState(
      'We could not load the products right now. Please try again.',
      'error'
    );
  }
}

function renderProductResults(products, mode) {
  if (!productsContainer) return;

  const visible = mode === 'home' ? products.slice(0, 6) : products;

  if (!visible.length) {
    productsContainer.innerHTML = `
      <div class="products-state">
        <p>No products match this selection yet.</p>
        <a class="button button-secondary" href="/shop/">
          Browse the full shop
        </a>
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = visible
    .map(productCard)
    .join('');
}

async function loadProductDetail() {
  const mount = document.querySelector('#product-detail');
  if (!mount) return;

  const slug = new URLSearchParams(location.search).get('slug');

  if (!slug) {
    mount.innerHTML = `
      <div class="products-state products-state-error">
        <p>Choose a product from the shop to view its details.</p>
        <a class="button button-primary" href="/shop/">Go to shop</a>
      </div>
    `;
    return;
  }

  try {
    mount.innerHTML = `
      <div class="products-state">
        <span class="products-spinner"></span>
        <p>Loading product...</p>
      </div>
    `;

    const response = await fetch(
      `/api/products/${encodeURIComponent(slug)}`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' }
    );
    const data = await response.json();

    if (!response.ok || !data.ok || !data.product) {
      throw new Error(data.error || 'Product not found');
    }

    const product = data.product;
    const title = escapeHtml(product.name);
    const cover = product.cover_url
      ? `<img src="${escapeHtml(product.cover_url)}" alt="${title}">`
      : `<strong>${title}</strong>`;

    document.title = `${product.name} — Nexauren Sound`;

    mount.innerHTML = `
      <div class="detail-grid">
        <div class="detail-cover">${cover}</div>
        <div class="detail-content">
          <p class="eyebrow">${escapeHtml(categoryLabel(product.category))}</p>
          <h1>${title}</h1>
          <div class="detail-price">
            ${escapeHtml(formatPrice(product.price, product.currency))}
          </div>
          <p class="detail-description">
            ${escapeHtml(product.description || product.short_description || 'Made for producers.')}
          </p>
          <div class="detail-actions">
            <p>Digital checkout is being connected to the store.</p>
            <a class="button button-primary" href="/shop/">
              Continue browsing
            </a>
          </div>
          <div class="detail-facts">
            <div><small>Format</small><strong>${escapeHtml(categoryLabel(product.category))}</strong></div>
            <div><small>Delivery</small><strong>Digital download</strong></div>
            <div><small>Product type</small><strong>${Number(product.price) === 0 ? 'Free' : 'Paid'}</strong></div>
            <div><small>Created for</small><strong>Music producers</strong></div>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Nexauren Sound product:', error);
    mount.innerHTML = `
      <div class="products-state products-state-error">
        <p>${escapeHtml(error.message || 'Product not found')}</p>
        <a class="button button-primary" href="/shop/">Back to shop</a>
      </div>
    `;
  }
}

function initFilters() {
  const buttons = document.querySelectorAll('.filter-button');
  if (!buttons.length) return;

  const params = new URLSearchParams(location.search);
  const current = params.get('category') || 'all';

  buttons.forEach((button) => {
    button.classList.toggle(
      'active',
      button.dataset.category === current
    );
  });
}

initFilters();
loadProducts();
loadProductDetail();
