const authView = document.querySelector('#auth-view');
const accountView = document.querySelector('#account-view');
const loginForm = document.querySelector('#login-form');
const registerForm = document.querySelector('#register-form');
const loginButton = document.querySelector('#login-button');
const registerButton = document.querySelector('#register-button');
const loginMessage = document.querySelector('#login-message');
const registerMessage = document.querySelector('#register-message');
const accountName = document.querySelector('#account-name');
const accountEmail = document.querySelector('#account-email');
const logoutButton = document.querySelector('#logout-button');

function setMessage(element, message, type = '') {
  if (!element) return;
  element.textContent = message || '';
  element.className = `form-message ${type}`.trim();
}

async function authApi(path, options = {}) {
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

document.querySelectorAll('[data-auth-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.authTab;

    document.querySelectorAll('[data-auth-tab]').forEach((item) => {
      item.classList.toggle(
        'active',
        item.dataset.authTab === target
      );
    });

    loginForm?.classList.toggle(
      'hidden',
      target !== 'login'
    );
    registerForm?.classList.toggle(
      'hidden',
      target !== 'register'
    );

    setMessage(loginMessage, '');
    setMessage(registerMessage, '');
  });
});

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(loginMessage, 'Signing you in...');
  loginButton.disabled = true;

  const form = new FormData(loginForm);
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');

  try {
    const data = await authApi('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password
      })
    });

    showAccount(data.user);
  } catch (error) {
    setMessage(loginMessage, error.message, 'error');
  } finally {
    loginButton.disabled = false;
  }
});

registerForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(registerMessage, 'Creating your account...');
  registerButton.disabled = true;

  const form = new FormData(registerForm);
  const name = String(form.get('name') || '').trim();
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');

  try {
    const data = await authApi('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name,
        email,
        password
      })
    });

    showAccount(data.user);
  } catch (error) {
    setMessage(registerMessage, error.message, 'error');
  } finally {
    registerButton.disabled = false;
  }
});

logoutButton?.addEventListener('click', async () => {
  logoutButton.disabled = true;

  try {
    await authApi('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({})
    });
  } catch {
    // The cookie is cleared by the server even if the response is interrupted.
  }

  showAuth();
  logoutButton.disabled = false;
});

async function checkCurrentUser() {
  try {
    const data = await authApi('/api/auth/me', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (data.authenticated && data.user) {
      showAccount(data.user);
    } else {
      showAuth();
    }
  } catch (error) {
    console.error('Nexauren account:', error);
    showAuth();
  }
}

function showAccount(user) {
  authView?.classList.add('hidden');
  accountView?.classList.remove('hidden');

  if (accountName) {
    accountName.textContent = user.name || 'creator';
  }

  if (accountEmail) {
    accountEmail.textContent = user.email || '';
  }

  setMessage(loginMessage, '');
  setMessage(registerMessage, '');
}

function showAuth() {
  accountView?.classList.add('hidden');
  authView?.classList.remove('hidden');
}

checkCurrentUser();
