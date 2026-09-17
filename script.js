const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
const year = document.querySelector('#year');
const productsContainer = document.querySelector('#products');

const CATEGORY_LABELS = {
  samples: 'SAMPLE PACK',
  midi: 'MIDI PACK',
  presets: 'PRESET PACK',
  'project-files': 'PROJECT FILE',
  bundles: 'BUNDLE',
  free: 'FREE DOWNLOAD'
};

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

function slugKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function formatPrice(price, currency) {
  if (Number(price) === 0) {
    return 'Free';
  }

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
  return CATEGORY_LABELS[category] || String(category || 'SOUND')
    .replaceAll('-', ' ')
    .toUpperCase();
}

function coverClass(index) {
  return [
    'cover-one',
    'cover-two',
    'cover-three',
    'cover-four'
  ][index % 4];
}

function productCard(product, index) {
  const title = escapeHtml(product.name);
  const description = escapeHtml(
    product.short_description ||
    product.description ||
    'Original sounds for your next track.'
  );
  const price = formatPrice(product.price, product.currency);
  const genres = Array.isArray(product.genres)
    ? product.genres.slice(0, 3)
    : [];
  const tags = genres.length
    ? `<div class="product-tags">${genres.map((genre) => `<span>${escapeHtml(genre)}</span>`).join('')}</div>`
    : '<div class="product-tags"></div>';
  const cover = product.cover_url
    ? `<img src="${escapeHtml(product.cover_url)}" alt="${title}" loading="lazy">`
    : `<span>${title}</span>`;
  const link = `/product/?slug=${encodeURIComponent(product.slug)}`;

  return `
    <article class="product-card">
      <a class="product-cover ${coverClass(index)}" href="${link}" aria-label="View ${title}">
        ${cover}
      </a>
      <div class="product-info">
        <p class="product-type">${escapeHtml(categoryLabel(product.category))}</p>
        <h3>${title}</h3>
        <p>${description}</p>
        ${tags}
        <div class="product-bottom">
          <strong>${escapeHtml(price)}</strong>
          <a class="product-button" href="${link}">View product</a>
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

  showProductsState('Loading the collection...', 'loading');

  try {
    let products = await fetchProducts();
    const mode = productsContainer.dataset.productList || 'all';
    const params = new URLSearchParams(location.search);
    const category = params.get('category');
    const genre = params.get('genre');
    const sort = params.get('sort') || 'newest';

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

    if (genre) {
      const target = slugKey(genre);
      products = products.filter((item) =>
        Array.isArray(item.genres) &&
        item.genres.some((itemGenre) => slugKey(itemGenre) === target)
      );
    }

    const search = document.querySelector('#product-search');
    const genreFilter = document.querySelector('#genre-filter');
    const sortSelect = document.querySelector('#sort-products');
    const resultsCount = document.querySelector('#results-count');
    const original = [...products];

    if (genreFilter && genre) {
      const matching = [...genreFilter.options].find(
        (option) => slugKey(option.value) === slugKey(genre)
      );
      if (matching) genreFilter.value = matching.value;
    }

    if (sortSelect) {
      sortSelect.value = sort;
    }

    const applyFilters = () => {
      const term = String(search?.value || '').trim().toLowerCase();
      const selectedGenre = genreFilter?.value || '';
      const selectedSort = sortSelect?.value || 'newest';

      let filtered = original.filter((item) => {
        const genres = Array.isArray(item.genres) ? item.genres : [];
        const text = [
          item.name,
          item.description,
          item.short_description,
          item.category,
          ...genres
        ].filter(Boolean).join(' ').toLowerCase();

        const matchesSearch = !term || text.includes(term);
        const matchesGenre = !selectedGenre || genres.some(
          (itemGenre) => slugKey(itemGenre) === slugKey(selectedGenre)
        );

        return matchesSearch && matchesGenre;
      });

      filtered = sortProducts(filtered, selectedSort);

      if (resultsCount) {
        resultsCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'product' : 'products'}`;
      }

      renderProductResults(filtered, mode);
    };

    search?.addEventListener('input', applyFilters);
    genreFilter?.addEventListener('change', applyFilters);
    sortSelect?.addEventListener('change', applyFilters);

    renderProductResults(
      sortProducts(products, sort),
      mode
    );

    if (resultsCount) {
      resultsCount.textContent = `${products.length} ${products.length === 1 ? 'product' : 'products'}`;
    }
  } catch (error) {
    console.error('Nexauren Sound products:', error);
    showProductsState(
      'We could not load the products right now. Please try again.',
      'error'
    );
  }
}

function sortProducts(products, sort) {
  return [...products].sort((a, b) => {
    if (sort === 'price-low') {
      return Number(a.price || 0) - Number(b.price || 0);
    }

    if (sort === 'price-high') {
      return Number(b.price || 0) - Number(a.price || 0);
    }

    if (sort === 'name') {
      return String(a.name).localeCompare(String(b.name));
    }

    return String(b.created_at || '').localeCompare(
      String(a.created_at || '')
    );
  });
}

function renderProductResults(products, mode) {
  if (!productsContainer) return;

  const visible = mode === 'home'
    ? products.slice(0, 6)
    : products;

  if (!visible.length) {
    productsContainer.innerHTML = `
      <div class="products-state">
        <p>No products match this selection yet.</p>
        <a class="button button-secondary" href="/shop/">Browse the full shop</a>
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
    const tags = Array.isArray(product.genres)
      ? product.genres.map((genre) => `<span>${escapeHtml(genre)}</span>`).join('')
      : '';

    document.title = `${product.name} — Nexauren Sound`;

    mount.innerHTML = `
      <div class="detail-grid">
        <div class="detail-cover">${cover}</div>
        <div class="detail-content">
          <p class="eyebrow">${escapeHtml(categoryLabel(product.category))}</p>
          <h1>${title}</h1>
          <div class="detail-tags">${tags}</div>
          <div class="detail-price">${escapeHtml(formatPrice(product.price, product.currency))}</div>
          <p class="detail-description">
            ${escapeHtml(product.description || product.short_description || 'Made for producers.')}
          </p>
          <div class="detail-actions">
            <p>${Number(product.price) === 0 ? 'This product is free.' : 'Digital checkout is being connected to the store.'}</p>
            <a class="button button-primary" href="/account/">Create account</a>
            <a class="button button-secondary" href="/shop/">Continue browsing</a>
          </div>
          <div class="detail-facts">
            <div><small>Format</small><strong>${escapeHtml(categoryLabel(product.category))}</strong></div>
            <div><small>Delivery</small><strong>Digital download</strong></div>
            <div><small>Product type</small><strong>${Number(product.price) === 0 ? 'Free' : 'Paid'}</strong></div>
            <div><small>For</small><strong>Music producers</strong></div>
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

async function updateAccountNav() {
  const accountLink = document.querySelector('.nav-account');

  if (!accountLink) return;

  try {
    const response = await fetch('/api/auth/me', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const data = await response.json();

    if (response.ok && data.authenticated) {
      accountLink.textContent = 'My account';
    }
  } catch {
    // Keep account navigation available when auth status is unavailable.
  }
}

initFilters();
loadProducts();
loadProductDetail();
updateAccountNav();
