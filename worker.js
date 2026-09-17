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
    if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ok: true, service: 'nexauren-sound-api', database: Boolean(env.DB), assets: Boolean(env.ASSETS) });
    if (url.pathname === '/api/auth/register' && request.method === 'POST') return registerUser(request, env);
    if (url.pathname === '/api/auth/login' && request.method === 'POST') return loginUser(request, env);
    if (url.pathname === '/api/auth/me' && request.method === 'GET') return getCurrentUser(request, env);
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logoutUser(request, env);
    if (url.pathname === '/api/admin/login' && request.method === 'POST') return adminLogin(request, env);
    if (url.pathname === '/api/admin/logout' && request.method === 'POST') return adminLogout();
    if (url.pathname === '/api/products' && request.method === 'GET') return getProducts(env);
    if (url.pathname.startsWith('/api/products/') && request.method === 'GET') return getProduct(env, decodeURIComponent(url.pathname.slice('/api/products/'.length)));
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
    user_id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, salt TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
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
    if (password.length < 8 || password.length > 128) return json({ ok: false, error: 'Password must be between 8 and 128 characters.' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').bind(email).first();
    if (existing) return json({ ok: false, error: 'An account with this email already exists.' }, 409);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const passwordHash = await derivePassword(password, salt);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`).bind(userId, email, name, now, now),
      env.DB.prepare(`INSERT INTO user_credentials (user_id, password_hash, salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).bind(userId, passwordHash, toBase64Url(salt), now, now)
    ]);
    const session = await createUserSession(env.DB, userId);
    return json({ ok: true, user: { id: userId, email, name, status: 'active' } }, 201, { 'Set-Cookie': buildCookie(USER_COOKIE, session.token, USER_SESSION_SECONDS, 'Lax') });
  } catch (error) {
    console.error('registerUser', error);
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
    const user = await env.DB.prepare(`SELECT u.id,u.email,u.name,u.status,c.password_hash,c.salt FROM users u JOIN user_credentials c ON c.user_id=u.id WHERE u.email=? LIMIT 1`).bind(email).first();
    if (!user || user.status !== 'active') return json({ ok: false, error: 'Invalid email or password.' }, 401);
    if (!(await verifyPassword(password, user.salt, user.password_hash))) return json({ ok: false, error: 'Invalid email or password.' }, 401);
    const now = new Date().toISOString();
    await env.DB.prepare('UPDATE users SET last_login_at=?, updated_at=? WHERE id=?').bind(now, now, user.id).run();
    const session = await createUserSession(env.DB, user.id);
    return json({ ok: true, user: { id:user.id,email:user.email,name:user.name,status:user.status } }, 200, { 'Set-Cookie': buildCookie(USER_COOKIE, session.token, USER_SESSION_SECONDS, 'Lax') });
  } catch (error) { console.error('loginUser', error); return json({ ok:false,error:'Could not sign you in right now.' },500); }
}

async function getCurrentUser(request, env) {
  if (!env.DB) return json({ ok:true, authenticated:false });
  try {
    await ensureAuthSchema(env.DB);
    const token=getCookie(request,USER_COOKIE);
    if (!token) return json({ok:true,authenticated:false});
    const tokenHash=await hashText(token);
    const now=Math.floor(Date.now()/1000);
    const user=await env.DB.prepare(`SELECT u.id,u.email,u.name,u.status,s.expires_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`).bind(tokenHash,now).first();
    if (!user || user.status!=='active') return json({ok:true,authenticated:false},200,{'Set-Cookie':buildCookie(USER_COOKIE,'',0,'Lax')});
    return json({ok:true,authenticated:true,user:{id:user.id,email:user.email,name:user.name,status:user.status}});
  } catch (error) { console.error('getCurrentUser',error); return json({ok:true,authenticated:false}); }
}

async function logoutUser(request, env) {
  if (env.DB) { try { await ensureAuthSchema(env.DB); const token=getCookie(request,USER_COOKIE); if(token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await hashText(token)).run(); } catch(error){console.error('logoutUser',error);} }
  return json({ok:true},200,{'Set-Cookie':buildCookie(USER_COOKIE,'',0,'Lax')});
}

async function createUserSession(db,userId){
  const bytes=new Uint8Array(32); crypto.getRandomValues(bytes); const token=toBase64Url(bytes); const tokenHash=await hashText(token);
  const expiresAt=Math.floor(Date.now()/1000+USER_SESSION_SECONDS);
  await db.prepare(`INSERT INTO auth_sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)`).bind(crypto.randomUUID(),userId,tokenHash,expiresAt,new Date().toISOString()).run();
  return {token};
}
async function derivePassword(password,salt){
  const baseKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:PASSWORD_ITERATIONS,hash:'SHA-256'},baseKey,256);
  return toBase64Url(new Uint8Array(bits));
}
async function verifyPassword(password,saltText,expectedText){return constantTimeEqual(fromBase64Url(await derivePassword(password,fromBase64Url(saltText))),fromBase64Url(expectedText));}
async function hashText(value){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)));return toBase64Url(new Uint8Array(digest));}
function normalizeEmail(value){return String(value||'').trim().toLowerCase();}
function isValidEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);}
function constantTimeEqual(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i+=1)diff|=a[i]^b[i];return diff===0;}
function toBase64Url(bytes){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');}
function fromBase64Url(value){const normalized=String(value||'').replace(/-/g,'+').replace(/_/g,'/');const padded=normalized.padEnd(Math.ceil(normalized.length/4)*4,'=');const binary=atob(padded);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);return bytes;}
function parseCookies(header){return header.split(';').reduce((cookies,part)=>{const [key,...rest]=part.trim().split('=');if(key)cookies[key]=decodeURIComponent(rest.join('='));return cookies;},{});}
function getCookie(request,name){return parseCookies(request.headers.get('Cookie')||'')[name]||'';}
function buildCookie(name,value,maxAge,sameSite){return [`${name}=${encodeURIComponent(value)}`,'Path=/','HttpOnly','Secure',`SameSite=${sameSite}`,`Max-Age=${maxAge}`].join('; ');}

async function getProducts(env){if(!env.DB)return json({ok:false,error:'D1 database is not configured'},500);try{await ensureProductTags(env.DB);const result=await env.DB.prepare(`SELECT p.id,p.name,p.slug,p.description,p.short_description,p.category,p.price,p.currency,p.cover_url,p.status,p.is_free,p.downloads_count,p.sales_count,p.created_at,p.published_at,GROUP_CONCAT(pt.tag,'||') AS genre_tags FROM products p LEFT JOIN product_tags pt ON pt.product_id=p.id WHERE p.status='published' GROUP BY p.id ORDER BY p.created_at DESC`).all();return json({ok:true,products:addGenreArrays(result.results||[])});}catch(error){console.error('getProducts',error);return json({ok:false,error:'Could not load products'},500);}}
async function getProduct(env,slug){if(!env.DB)return json({ok:false,error:'D1 database is not configured'},500);try{await ensureProductTags(env.DB);const result=await env.DB.prepare(`SELECT p.id,p.name,p.slug,p.description,p.short_description,p.category,p.price,p.currency,p.cover_url,p.status,p.is_free,p.downloads_count,p.sales_count,p.created_at,p.published_at,GROUP_CONCAT(pt.tag,'||') AS genre_tags FROM products p LEFT JOIN product_tags pt ON pt.product_id=p.id WHERE p.slug=? AND p.status='published' GROUP BY p.id LIMIT 1`).bind(slug).first();if(!result)return json({ok:false,error:'Product not found'},404);return json({ok:true,product:addGenreArrays([result])[0]});}catch(error){console.error('getProduct',error);return json({ok:false,error:'Could not load product'},500);}}
function addGenreArrays(products){return products.map(p=>({...p,genres:normalizeGenres(p.genre_tags)}));}
function normalizeGenres(value){const raw=Array.isArray(value)?value:String(value??'').split(/\|\||,/);const result=[],seen=new Set();for(const item of raw){const clean=cleanText(item,50).replace(/\s+/g,' ').trim();const key=clean.toLowerCase();if(!clean||seen.has(key))continue;seen.add(key);result.push(clean);if(result.length>=12)break;}return result;}

async function adminLogin(request,env){if(!env.ADMIN_KEY)return json({ok:false,error:'Admin access is not configured'},503);try{const body=await request.json();const key=String(body?.key||'');if(!key||!(await safeEqual(key,env.ADMIN_KEY)))return json({ok:false,error:'Invalid admin key'},401);const expiresAt=Math.floor(Date.now()/1000)+ADMIN_SESSION_SECONDS;const signature=await signSession(expiresAt,env.ADMIN_KEY);return json({ok:true,message:'Admin session created'},200,{'Set-Cookie':buildCookie(ADMIN_COOKIE,`${expiresAt}.${signature}`,ADMIN_SESSION_SECONDS,'Strict')});}catch{return json({ok:false,error:'Invalid request'},400);}}
function adminLogout(){return json({ok:true},200,{'Set-Cookie':buildCookie(ADMIN_COOKIE,'',0,'Strict')});}
async function requireAdmin(request,env){if(!env.ADMIN_KEY)return{ok:false,response:json({ok:false,error:'Admin access is not configured'},503)};const session=parseCookies(request.headers.get('Cookie')||'')[ADMIN_COOKIE];if(!session)return{ok:false,response:json({ok:false,error:'Admin authentication required'},401)};const [expiresText,signature]=session.split('.');const expiresAt=Number(expiresText);if(!expiresAt||!signature||expiresAt<=Math.floor(Date.now()/1000))return{ok:false,response:json({ok:false,error:'Admin session expired'},401)};const expected=await signSession(expiresAt,env.ADMIN_KEY);if(!(await safeEqual(signature,expected)))return{ok:false,response:json({ok:false,error:'Invalid admin session'},401)};return{ok:true};}

async function getAdminProducts(env){if(!env.DB)return json({ok:false,error:'D1 database is not configured'},500);try{await ensureProductTags(env.DB);const result=await env.DB.prepare(`SELECT p.id,p.name,p.slug,p.description,p.short_description,p.category,p.price,p.currency,p.cover_url,p.file_key,p.file_name,p.file_size,p.status,p.is_free,p.downloads_count,p.sales_count,p.created_at,p.updated_at,p.published_at,GROUP_CONCAT(pt.tag,'||') AS genre_tags FROM products p LEFT JOIN product_tags pt ON pt.product_id=p.id GROUP BY p.id ORDER BY p.created_at DESC`).all();return json({ok:true,products:addGenreArrays(result.results||[])});}catch(error){console.error('getAdminProducts',error);return json({ok:false,error:'Could not load admin products'},500);}}
async function createProduct(request,env){const validation=await readProductBody(request);if(!validation.ok)return json({ok:false,error:validation.error},400);const product=validation.product,id=crypto.randomUUID(),now=new Date().toISOString(),publishedAt=product.status==='published'?now:null;try{const existing=await env.DB.prepare('SELECT id FROM products WHERE slug=? LIMIT 1').bind(product.slug).first();if(existing)return json({ok:false,error:'A product with this slug already exists'},409);await env.DB.prepare(`INSERT INTO products (id,name,slug,description,short_description,category,price,currency,cover_url,file_key,file_name,file_size,status,is_free,downloads_count,sales_count,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?)`).bind(id,product.name,product.slug,product.description,product.shortDescription,product.category,product.price,product.currency,product.coverUrl,product.fileKey,product.fileName,product.fileSize,product.status,product.isFree,now,now,publishedAt).run();await replaceProductGenres(env,id,product.genres);return json({ok:true,product:{id,...product,created_at:now,updated_at:now,published_at:publishedAt,downloads_count:0,sales_count:0}},201);}catch(error){console.error('createProduct',error);return json({ok:false,error:'Could not create product'},500);}}
async function updateProduct(request,env,id){const validation=await readProductBody(request);if(!validation.ok)return json({ok:false,error:validation.error},400);const product=validation.product,now=new Date().toISOString();try{const existing=await env.DB.prepare('SELECT id,created_at,published_at FROM products WHERE id=? LIMIT 1').bind(id).first();if(!existing)return json({ok:false,error:'Product not found'},404);const slugOwner=await env.DB.prepare('SELECT id FROM products WHERE slug=? AND id!=? LIMIT 1').bind(product.slug,id).first();if(slugOwner)return json({ok:false,error:'A product with this slug already exists'},409);const publishedAt=product.status==='published'?(existing.published_at||now):null;await env.DB.prepare(`UPDATE products SET name=?,slug=?,description=?,short_description=?,category=?,price=?,currency=?,cover_url=?,file_key=?,file_name=?,file_size=?,status=?,is_free=?,updated_at=?,published_at=? WHERE id=?`).bind(product.name,product.slug,product.description,product.shortDescription,product.category,product.price,product.currency,product.coverUrl,product.fileKey,product.fileName,product.fileSize,product.status,product.isFree,now,publishedAt,id).run();await replaceProductGenres(env,id,product.genres);return json({ok:true,product:{id,...product,created_at:existing.created_at,updated_at:now,published_at:publishedAt}});}catch(error){console.error('updateProduct',error);return json({ok:false,error:'Could not update product'},500);}}
async function deleteProduct(env,id){if(!env.DB)return json({ok:false,error:'D1 database is not configured'},500);try{const existing=await env.DB.prepare('SELECT id FROM products WHERE id=? LIMIT 1').bind(id).first();if(!existing)return json({ok:false,error:'Product not found'},404);await env.DB.prepare('DELETE FROM product_tags WHERE product_id=?').bind(id).run();await env.DB.prepare('DELETE FROM products WHERE id=?').bind(id).run();return json({ok:true,message:'Product deleted'});}catch(error){console.error('deleteProduct',error);return json({ok:false,error:'Could not delete product'},500);}}
async function seedDemoProducts(env){if(!env.DB)return json({ok:false,error:'D1 database is not configured'},500);const demoProducts=[['Amapiano Essentials Vol. 01','amapiano-essentials-vol-01','samples',9,['Amapiano','Afro House','Afrobeats'],'Demo catalog product. Replace the cover, file and description before selling.'],['Midnight R&B','midnight-rnb','samples',12,['R&B','Neo Soul','Soul'],'Demo catalog product for a modern R&B sample collection.'],['Afro Pop Toolkit','afro-pop-toolkit','samples',10,['Afropop','Afrobeats','Pop'],'Demo catalog product for an energetic Afro Pop workflow.'],['Motion House MIDI','motion-house-midi','midi',7,['House','Tech House','Dance'],'Demo MIDI pack with chord and melody ideas.'],['Pop Hook MIDI','pop-hook-midi','midi',5,['Pop','Dance','R&B'],'Demo MIDI collection focused on hooks and songwriting ideas.'],['Nexa Keys','nexa-keys','presets',12,['R&B','Pop','Ambient'],'Demo preset pack for warm keys, pads and creative textures.'],['After Dark Project','after-dark-project','project-files',19,['Afro House','House','Dance'],'Demo project file showing a modern dance production workflow.'],['Producer Starter Bundle','producer-starter-bundle','bundles',29,['Amapiano','R&B','Pop','House'],'Demo bundle combining multiple Nexauren Sound formats.'],['Free Amapiano Starter','free-amapiano-starter','free',0,['Amapiano','Afro House'],'Demo free download. Replace the file reference with the real release.']];try{await ensureProductTags(env.DB);const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM products').first();if(Number(count?.total||0)>0)return json({ok:false,error:'The catalog already contains products'},409);const now=new Date().toISOString();for(const [name,slug,category,price,genres,description] of demoProducts){const id=crypto.randomUUID();await env.DB.prepare(`INSERT INTO products (id,name,slug,description,short_description,category,price,currency,cover_url,file_key,file_name,file_size,status,is_free,downloads_count,sales_count,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'published',?,0,0,?,?,?)`).bind(id,name,slug,description,description,category,price,'USD','','','',0,price===0?1:0,now,now,now).run();await replaceProductGenres(env,id,genres);}return json({ok:true,created:demoProducts.length,message:'Demo catalog created. Replace demo assets before selling.'});}catch(error){console.error('seedDemoProducts',error);return json({ok:false,error:'Could not create the demo catalog'},500);}}
async function readProductBody(request){let body;try{body=await request.json();}catch{return{ok:false,error:'Invalid JSON body'};}const name=cleanText(body?.name,160),slug=makeSlug(body?.slug||name),description=cleanText(body?.description,5000),shortDescription=cleanText(body?.short_description||body?.shortDescription,300),category=cleanText(body?.category,40),currency=cleanText(body?.currency||'USD',10).toUpperCase(),coverUrl=cleanText(body?.cover_url||body?.coverUrl,1000),fileKey=cleanText(body?.file_key||body?.fileKey,500),fileName=cleanText(body?.file_name||body?.fileName,255),fileSize=Math.max(0,Number(body?.file_size||body?.fileSize||0)),status=ALLOWED_STATUS.has(body?.status)?body.status:'draft';let price=Number(body?.price??0);const isFree=Boolean(body?.is_free??body?.isFree)||price<=0;const genres=normalizeGenres(body?.genres??body?.tags??body?.genre_tags);if(!name)return{ok:false,error:'Product name is required'};if(!slug)return{ok:false,error:'Product slug is required'};if(!ALLOWED_CATEGORIES.has(category))return{ok:false,error:'Invalid product category'};if(!Number.isFinite(price)||price<0)return{ok:false,error:'Price must be a valid positive number'};if(isFree)price=0;if(status==='published'&&!isFree&&price<=0)return{ok:false,error:'Paid products need a price'};return{ok:true,product:{name,slug,description,shortDescription,category,price,currency,coverUrl,fileKey,fileName,fileSize,status,isFree:isFree?1:0,genres}};}
async function ensureProductTags(db){await db.prepare(`CREATE TABLE IF NOT EXISTS product_tags (id TEXT PRIMARY KEY,product_id TEXT NOT NULL,tag TEXT NOT NULL)`).run();}
async function replaceProductGenres(env,productId,genres){await ensureProductTags(env.DB);await env.DB.prepare('DELETE FROM product_tags WHERE product_id=?').bind(productId).run();for(const genre of genres){await env.DB.prepare(`INSERT INTO product_tags (id,product_id,tag) VALUES (?,?,?)`).bind(crypto.randomUUID(),productId,genre).run();}}
function cleanText(value,maxLength){return String(value??'').trim().slice(0,maxLength);}
function makeSlug(value){return cleanText(value,120).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
async function safeEqual(a,b){return constantTimeEqual(new TextEncoder().encode(String(a)),new TextEncoder().encode(String(b)));}
async function signSession(expiresAt,secret){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(String(expiresAt)));return toBase64Url(new Uint8Array(signature));}
function json(data,status=200,extraHeaders={}){return new Response(JSON.stringify(data),{status,headers:{...JSON_HEADERS,...extraHeaders}});}
