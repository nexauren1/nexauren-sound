const loginScreen = document.querySelector('#login-screen');
const adminScreen = document.querySelector('#admin-screen');
const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');
const productForm = document.querySelector('#product-form');
const formMessage = document.querySelector('#form-message');
const productsList = document.querySelector('#products-list');
const saveButton = document.querySelector('#save-button');
const cancelEditButton = document.querySelector('#cancel-edit');
const refreshButton = document.querySelector('#refresh-button');
const seedButton = document.querySelector('#seed-button');
const logoutButton = document.querySelector('#logout-button');

const fields = {
  id: document.querySelector('#product-id'),
  name: document.querySelector('#name'),
  slug: document.querySelector('#slug'),
  category: document.querySelector('#category'),
  status: document.querySelector('#status'),
  genres: document.querySelector('#genres'),
  shortDescription: document.querySelector('#short-description'),
  description: document.querySelector('#description'),
  price: document.querySelector('#price'),
  currency: document.querySelector('#currency'),
  isFree: document.querySelector('#is-free'),
  coverUrl: document.querySelector('#cover-url'),
  fileKey: document.querySelector('#file-key'),
  fileName: document.querySelector('#file-name'),
  fileSize: document.querySelector('#file-size')
};

function setMessage(element, message, type = '') {
  if (!element) return;
  element.textContent = message || '';
  element.className = `form-message ${type}`.trim();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || data.ok === false) {
    const error = new Error(
      data.error || `Request failed (${response.status})`
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeGenres(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  return [...new Set(
    source
      .map((item) => String(item || '').trim())
      .map((item) => item.replace(/\s+/g, ' '))
      .filter(Boolean)
  )].slice(0, 12);
}

fields.name?.addEventListener('input', () => {
  if (!fields.id.value && !fields.slug.dataset.edited) {
    fields.slug.value = slugify(fields.name.value);
  }
});

fields.slug?.addEventListener('input', () => {
  fields.slug.dataset.edited = 'true';
});

fields.isFree?.addEventListener('change', () => {
  if (fields.isFree.checked) {
    fields.price.value = '0';
  }
});

async function checkSession() {
  try {
    await loadProducts();
    showAdmin();
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      return;
    }

    showLogin();
    setMessage(loginMessage, error.message, 'error');
  }
}

function showAdmin() {
  loginScreen.classList.add('hidden');
  adminScreen.classList.remove('hidden');
}

function showLogin() {
  adminScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(loginMessage, 'Checking access...');

  const key = document.querySelector('#admin-key').value;

  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ key })
    });

    document.querySelector('#admin-key').value = '';
    setMessage(loginMessage, '');
    showAdmin();
    await loadProducts();
  } catch (error) {
    setMessage(loginMessage, error.message, 'error');
  }
});

logoutButton?.addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', {
      method: 'POST'
    });
  } catch {
    // The local UI can still return to the login screen.
  }

  resetForm();
  showLogin();
  setMessage(loginMessage, 'You have been logged out.', 'success');
});

refreshButton?.addEventListener('click', () => {
  loadProducts();
});

seedButton?.addEventListener('click', async () => {
  const confirmed = window.confirm(
    'Add the demo catalog to D1? This works only when the catalog is empty.'
  );

  if (!confirmed) return;

  seedButton.disabled = true;
  setMessage(formMessage, 'Creating demo catalog...');

  try {
    const data = await api('/api/admin/seed-demo', {
      method: 'POST'
    });

    setMessage(
      formMessage,
      `${data.created || 0} demo products added. Replace their assets before selling.`,
      'success'
    );
    await loadProducts();
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      setMessage(loginMessage, 'Your admin session has expired.', 'error');
      return;
    }

    setMessage(formMessage, error.message, 'error');
  } finally {
    seedButton.disabled = false;
  }
});

cancelEditButton?.addEventListener('click', resetForm);

productForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(formMessage, 'Saving product...');
  saveButton.disabled = true;

  const product = readForm();
  const id = fields.id.value;
  const path = id
    ? `/api/admin/products/${encodeURIComponent(id)}`
    : '/api/admin/products';
  const method = id ? 'PUT' : 'POST';

  try {
    await api(path, {
      method,
      body: JSON.stringify(product)
    });

    setMessage(
      formMessage,
      id ? 'Product updated successfully.' : 'Product created successfully.',
      'success'
    );
    resetForm(false);
    await loadProducts();
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      setMessage(loginMessage, 'Your admin session has expired.', 'error');
    } else {
      setMessage(formMessage, error.message, 'error');
    }
  } finally {
    saveButton.disabled = false;
  }
});

function readForm() {
  return {
    name: fields.name.value.trim(),
    slug: fields.slug.value.trim(),
    category: fields.category.value,
    status: fields.status.value,
    genres: normalizeGenres(fields.genres.value),
    short_description: fields.shortDescription.value.trim(),
    description: fields.description.value.trim(),
    price: Number(fields.price.value || 0),
    currency: fields.currency.value,
    is_free: fields.isFree.checked,
    cover_url: fields.coverUrl.value.trim(),
    file_key: fields.fileKey.value.trim(),
    file_name: fields.fileName.value.trim(),
    file_size: Number(fields.fileSize.value || 0)
  };
}

function fillForm(product) {
  fields.id.value = product.id || '';
  fields.name.value = product.name || '';
  fields.slug.value = product.slug || '';
  fields.slug.dataset.edited = 'true';
  fields.category.value = product.category || 'samples';
  fields.status.value = product.status || 'draft';
  fields.genres.value = Array.isArray(product.genres)
    ? product.genres.join(', ')
    : '';
  fields.shortDescription.value = product.short_description || '';
  fields.description.value = product.description || '';
  fields.price.value = Number(product.price || 0).toFixed(2);
  fields.currency.value = product.currency || 'USD';
  fields.isFree.checked = Number(product.is_free) === 1;
  fields.coverUrl.value = product.cover_url || '';
  fields.fileKey.value = product.file_key || '';
  fields.fileName.value = product.file_name || '';
  fields.fileSize.value = Number(product.file_size || 0);

  document.querySelector('#form-title').textContent = 'Edit product';
  saveButton.textContent = 'Update product';
  cancelEditButton.classList.remove('hidden');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm(clearMessage = true) {
  productForm.reset();
  fields.id.value = '';
  fields.slug.value = '';
  fields.slug.dataset.edited = '';
  fields.genres.value = '';
  fields.price.value = '0';
  fields.fileSize.value = '0';
  fields.currency.value = 'USD';
  fields.category.value = 'samples';
  fields.status.value = 'draft';
  document.querySelector('#form-title').textContent = 'Create product';
  saveButton.textContent = 'Save product';
  cancelEditButton.classList.add('hidden');

  if (clearMessage) {
    setMessage(formMessage, '');
  }
}

async function loadProducts() {
  productsList.innerHTML = '<div class="list-state">Loading products...</div>';

  const data = await api('/api/admin/products', {
    method: 'GET'
  });

  const products = Array.isArray(data.products)
    ? data.products
    : [];

  updateStats(products);
  renderProducts(products);

  return products;
}

function updateStats(products) {
  document.querySelector('#stat-total').textContent = products.length;
  document.querySelector('#stat-published').textContent = products.filter(
    (product) => product.status === 'published'
  ).length;
  document.querySelector('#stat-drafts').textContent = products.filter(
    (product) => product.status === 'draft'
  ).length;
  document.querySelector('#stat-free').textContent = products.filter(
    (product) => Number(product.is_free) === 1
  ).length;
}

function renderProducts(products) {
  if (!products.length) {
    productsList.innerHTML = `
      <div class="list-state">
        No products yet. Create the first product above or use Add demo catalog.
      </div>
    `;
    return;
  }

  productsList.innerHTML = `
    <div class="product-row header">
      <div>Product</div>
      <div>Format / Genre</div>
      <div>Price</div>
      <div>Status</div>
      <div>Actions</div>
    </div>
    ${products.map(productRow).join('')}
  `;

  products.forEach((product) => {
    document
      .querySelector(`[data-edit="${CSS.escape(product.id)}"]`)
      ?.addEventListener('click', () => fillForm(product));

    document
      .querySelector(`[data-delete="${CSS.escape(product.id)}"]`)
      ?.addEventListener('click', () => removeProduct(product));
  });
}

function productRow(product) {
  const name = escapeHtml(product.name);
  const slug = escapeHtml(product.slug);
  const category = escapeHtml(categoryLabel(product.category));
  const genres = Array.isArray(product.genres)
    ? product.genres.slice(0, 3).map((genre) =>
      `<span>${escapeHtml(genre)}</span>`
    ).join('')
    : '';
  const price = product.is_free
    ? 'Free'
    : formatPrice(product.price, product.currency);
  const status = escapeHtml(product.status || 'draft');

  return `
    <div class="product-row">
      <div class="product-name">
        <strong>${name}</strong>
        <span>${slug}</span>
      </div>
      <div class="product-meta">
        <strong>${category}</strong>
        <div class="row-tags">${genres}</div>
      </div>
      <div class="product-meta">${escapeHtml(price)}</div>
      <div><span class="status-pill status-${status}">${status}</span></div>
      <div class="row-actions">
        <button class="small-button" type="button" data-edit="${escapeHtml(product.id)}">Edit</button>
        <button class="small-button danger" type="button" data-delete="${escapeHtml(product.id)}">Delete</button>
      </div>
    </div>
  `;
}

function formatPrice(price, currency) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD'
    }).format(Number(price || 0));
  } catch {
    return `${currency || 'USD'} ${Number(price || 0).toFixed(2)}`;
  }
}

async function removeProduct(product) {
  const confirmed = window.confirm(
    `Delete “${product.name}”? This cannot be undone.`
  );

  if (!confirmed) return;

  try {
    await api(`/api/admin/products/${encodeURIComponent(product.id)}`, {
      method: 'DELETE'
    });

    if (fields.id.value === product.id) {
      resetForm();
    }

    await loadProducts();
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      setMessage(loginMessage, 'Your admin session has expired.', 'error');
      return;
    }

    setMessage(formMessage, error.message, 'error');
  }
}

function categoryLabel(category) {
  const labels = {
    samples: 'Sample Pack',
    midi: 'MIDI Pack',
    presets: 'Preset Pack',
    'project-files': 'Project File',
    bundles: 'Bundle',
    free: 'Free Download'
  };

  return labels[category] || category || 'Sound';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

checkSession();
