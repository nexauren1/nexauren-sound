const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
const year = document.querySelector('#year');
const productsContainer = document.querySelector('#products');

if (year) {
  year.textContent = new Date().getFullYear();
}

menuToggle?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');

  menuToggle.setAttribute(
    'aria-expanded',
    String(open)
  );

  menuToggle.setAttribute(
    'aria-label',
    open ? 'Close menu' : 'Open menu'
  );
});

document.querySelectorAll('.nav a').forEach((link) => {
  link.addEventListener('click', () => {
    nav.classList.remove('open');
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

function coverClass(index) {
  const classes = [
    'cover-one',
    'cover-two',
    'cover-three'
  ];

  return classes[index % classes.length];
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

function productCard(product, index) {
  const title = escapeHtml(product.name);
  const description = escapeHtml(
    product.short_description || product.description ||
    'Original sounds for your next track.'
  );
  const price = formatPrice(product.price, product.currency);
  const cover = product.cover_url
    ? `<img src="${escapeHtml(product.cover_url)}" alt="${title}" loading="lazy">`
    : `<span>${escapeHtml(product.name)}</span>`;

  return `
    <article class="product-card">
      <a
        class="product-cover ${coverClass(index)}"
        href="?product=${encodeURIComponent(product.slug)}"
        aria-label="View ${title}"
      >
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
          <a
            class="product-button"
            href="?product=${encodeURIComponent(product.slug)}"
          >
            View pack
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
        <span class="products-spinner" aria-hidden="true"></span>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = `
    <div class="products-state products-state-error">
      <p>${escapeHtml(message)}</p>
      <button type="button" id="products-retry">
        Try again
      </button>
    </div>
  `;

  document.querySelector('#products-retry')?.addEventListener(
    'click',
    loadProducts
  );
}

async function loadProducts() {
  if (!productsContainer) return;

  showProductsState('Loading sounds...', 'loading');

  try {
    const response = await fetch('/api/products', {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const products = Array.isArray(data.products)
      ? data.products
      : [];

    if (!data.ok) {
      throw new Error(data.error || 'Could not load products');
    }

    if (!products.length) {
      productsContainer.innerHTML = `
        <div class="products-state">
          <p>No products are published yet.</p>
        </div>
      `;
      return;
    }

    productsContainer.innerHTML = products
      .map(productCard)
      .join('');
  } catch (error) {
    console.error('Nexauren Sound products:', error);

    showProductsState(
      'We could not load the products right now. Please try again.',
      'error'
    );
  }
}

loadProducts();
