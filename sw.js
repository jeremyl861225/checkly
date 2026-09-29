/* Checkly — service worker
 *
 * 目的：讓 App 外殼（HTML／字型／程式庫／圖示）離線也開得起來，不用每次開都重抓。網路只拿來同步資料。
 *
 * 同網域下還有其他 PWA（Clinical-Tools、題庫、改名前的舊版 /todo-app/ 等），所以這裡嚴格自我約束：
 *   - 快取名稱一律用 PREFIX 開頭，清理時只刪自己的，絕不動別人的
 *   - 只處理本 scope（/checkly/）底下的同源 GET
 *   - Supabase 的 API 一律不碰，永遠走網路
 *
 * 「一代」＝一份 sw.js（CACHE 名稱帶 BUILD）＋它 PRECACHE 的檔案。規則：
 *   - PRECACHE 是外殼必備檔：全部到齊才算安裝成功，少一個就整個安裝失敗、舊版繼續服務（不會裝出一個缺檔的新版）
 *   - 非 HTML 的 precache 檔（vendor、字型、圖示、manifest）在 HASHES 登記了內容雜湊：安裝時上一代有一模一樣的
 *     就直接複製（不重抓）；從網路抓來的一定要對得上雜湊才收——伺服器已經換成下一版的檔案不會混進這一代
 *   - 這些檔「快取優先、只從自己這一代拿」，背景不更新：它們有變 sw.js 一定跟著變（BUILD／HASHES），
 *     由瀏覽器的 SW 更新整批換新
 *   - HTML（./、index.html）不在雜湊裡：只改 index.html 的部署 sw.js 不會變，外殼照舊在背景更新
 *     （下次開就是新版）；但伺服器上 sw.js 也換了時不寫，新外殼留給新版 SW 自己 precache
 *   - 快取被別人清掉（同網域其他 App 的 SW 早期寫法會刪掉所有不是自己的快取）：每次開 App 順手檢查，
 *     缺的從網路補回這一代（一樣要對得上雜湊）；連線上開一次就恢復離線可用。
 *     離線時補不成不算數（不進 30 秒冷卻），恢復連線後的下一次開啟會再補
 *   - 網路回來的檔順手存進快取時，副本一定在 return 之前 clone（回傳後 body 被頁面讀走，再 clone 會丟例外）
 *   - OPTIONAL 是可有可無的檔：逐一 add，抓不到就略過
 *
 * BUILD 常數與 HASHES 的 sw-hashes 標記區段由 tools/gen-sw-precache.mjs 改寫，那兩處的寫法要維持原樣；
 * PRECACHE 由人手維護，新增或修改任何 precache 檔之後都要跑一次那支（--check 會擋下漏跑與漏列）。
 */
const PREFIX = 'checkly-';   // 與舊版 todo-app（同網域 /todo-app/）的 'todo-app-' 分開：兩邊清理時互不刪到對方
const BUILD = '70ddf64b73';   // ← tools/gen-sw-precache.mjs 依 precache 檔案內容自動產生
const CACHE  = PREFIX + 'v10-' + BUILD;
const META   = PREFIX + 'meta';   // 只放「目前啟用的是哪一代」一筆紀錄；不是資料快取，清理與查找都跳過它

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/supabase-2.111.0.min.js',
  './fonts/JetBrainsMono-Bold.woff2',
  './fonts/JetBrainsMono-Regular.woff2',
  './mark.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './maskable-512.png',
];

// <sw-hashes> 以下由 tools/gen-sw-precache.mjs 產生，勿手改
const HASHES = {
  './fonts/JetBrainsMono-Bold.woff2': '28d60155d203d74b',
  './fonts/JetBrainsMono-Regular.woff2': 'b8b5ea834936ecc4',
  './icon-180.png': '95de465baf5afad3',
  './icon-192.png': '57bb3d43c1bc681a',
  './icon-512.png': '272f1264d45f3a0b',
  './manifest.webmanifest': 'dad3d6393ab220be',
  './mark.png': '96eb0366c4e72e8d',
  './maskable-512.png': 'f9c1b24c03a54814',
  './vendor/supabase-2.111.0.min.js': '0c2562701c7ac6da',
};
// </sw-hashes>

// 非必要檔：抓不到不擋安裝（目前沒有；之後新增非核心資源放這裡）
const OPTIONAL = [];

const scopeUrl  = self.registration.scope;
const scopePath = new URL(scopeUrl).pathname;
const abs = u => new URL(u, scopeUrl).href;
/** 路徑 → PRECACHE 裡的寫法（'./fonts/JetBrainsMono-Bold.woff2' 這種），用來查 HASHES */
const PRE_KEY = new Map(PRECACHE.map(u => [new URL(u, scopeUrl).pathname, u]));
const SHELL_KEYS = [abs('./'), abs('./index.html')];
const isShellPath = p => p === scopePath || p === scopePath + 'index.html';
const okBasic = res => !!res && res.ok && res.type === 'basic' && !res.redirected;
const NET_TIMEOUT_MS = 15000;     // 背景工作（補檔、更新外殼）等網路最多這麼久：連得上 Wi‑Fi 卻沒網路時不要一直掛著

/** 帶逾時的 fetch（只用在背景工作；回給頁面的請求不設逾時，交給瀏覽器） */
function fetchT(req){
  const ctl = new AbortController();
  const t = setTimeout(()=>ctl.abort(), NET_TIMEOUT_MS);
  return fetch(req, {signal: ctl.signal}).finally(()=>clearTimeout(t));
}

/* ---------- 內容雜湊 ---------- */
async function digest(res){
  const buf = await res.clone().arrayBuffer();
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let s = '';
  for(const b of h) s += b.toString(16).padStart(2, '0');
  return s.slice(0, 16);
}
/** 這個回應是不是這一代的檔？有登記雜湊的要對得上；沒登記的（HTML）一律算 */
async function belongs(key, res){
  const want = key && HASHES[key];
  if(!want) return true;
  try{ return (await digest(res)) === want; }catch(e){ return false; }
}

/* ---------- 自己的快取 ---------- */
async function ownCaches(){
  return (await caches.keys()).filter(k => k.startsWith(PREFIX) && k !== META);
}
/** 自己的快取裡找：先找目前這一代，沒有再依新到舊找其他代。
    用 caches.match({cacheName})：不存在的快取不會像 caches.open 那樣被「復活」成一個空快取 */
async function matchOwn(req, opts){
  const hit = await caches.match(req, {...opts, cacheName: CACHE});
  if(hit) return hit;
  const names = (await ownCaches()).filter(k => k !== CACHE).reverse();
  for(const n of names){
    const r = await caches.match(req, {...opts, cacheName: n});
    if(r) return r;
  }
  return null;
}
const META_KEY = abs('./__sw-generation');
async function readMeta(){
  try{ const r = await caches.match(META_KEY, {cacheName: META}); return r ? await r.text() : null; }catch(e){ return null; }
}
async function writeMeta(v){
  try{ await (await caches.open(META)).put(META_KEY, new Response(v)); }catch(e){}
}
/** 這個 SW 還是目前啟用的那一代嗎？（新版接手後，舊版還沒跑完的背景工作不能再寫快取）
    紀錄不見了（被別人清掉）就當作是。只有 activate 會寫紀錄：這裡若也補寫，
    萬一補寫的是一個已經過時的舊 SW，真正在用的那一代反而會以為自己過時、再也不補檔 */
async function isCurrentGen(){
  const m = await readMeta();
  return m === null || m === CACHE;
}
/** 寫進這一代。回應要在交給頁面「之前」就 clone 好再傳進來（交出去之後再 clone 會丟例外） */
async function putCurrent(pairs){
  if(!(await isCurrentGen())) return;
  const c = await caches.open(CACHE);
  await Promise.all(pairs.map(([k, res]) => c.put(k, res)));
}
/** 伺服器上是不是已經有新版的 sw.js（正在安裝或等著接手）。查不到（離線）也當成「有」，寧可先不寫 */
async function newerPending(){
  try{ await self.registration.update(); }catch(e){ return true; }
  return !!(self.registration.installing || self.registration.waiting);
}

/* ---------- 安裝／啟用 ---------- */
/** 放一個 precache 檔進 c：上一代有雜湊相同的就複製，否則網路重抓（繞過 HTTP 快取）並驗雜湊 */
async function precacheOne(c, u, older){
  const want = HASHES[u];
  if(want){
    for(const n of older){
      const r = await caches.match(abs(u), {cacheName: n});
      if(r && r.ok && (await belongs(u, r))){ await c.put(abs(u), r); return; }
    }
  }
  const res = await fetch(new Request(u, {cache:'reload'}));
  if(!res.ok) throw new Error(`precache ${u}：HTTP ${res.status}`);
  if(!(await belongs(u, res))) throw new Error(`precache ${u}：內容與 sw.js 登記的雜湊不同（伺服器上不是這一版的檔）`);
  await c.put(abs(u), res);
}

self.addEventListener('install', e=>{
  e.waitUntil((async ()=>{
    const existed = await caches.has(CACHE);
    const older = (await ownCaches()).filter(k => k !== CACHE).reverse();
    const c = await caches.open(CACHE);
    // 必備檔一次到齊；任何一個失敗 → install 失敗 → 這個新版被丟掉，舊 SW 與舊快取照常服務
    const rs = await Promise.allSettled(PRECACHE.map(u => precacheOne(c, u, older)));
    const bad = rs.find(r => r.status === 'rejected');
    if(bad){
      // 剛剛 open 出來的快取要收掉，否則 activate 時會被誤認成「上一代」而留下，真正的上一代反被刪
      if(!existed) await caches.delete(CACHE);
      throw bad.reason;
    }
    await Promise.all(OPTIONAL.map(u =>
      c.add(new Request(u, {cache:'reload'})).catch(err =>
        console.warn('[sw] 非必要檔略過', u, err && err.message))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e=>{
  e.waitUntil((async ()=>{
    // 只動自己前綴的快取。保留「上一代」一份：還開著的舊頁面若要載入舊版的檔（例如第一次用到的字型），
    // 新快取裡可能已經換成新版的內容，要到上一代去找；更舊的才刪。
    // 上一代＝上次啟用時記在 META 的那一代（不靠 caches.keys() 的順序：被刪掉又 open 的快取會排到最後）；
    // 沒有紀錄（第一次、或被別人清掉）才退回「keys() 最後一個非空的」。
    const old = (await ownCaches()).filter(k => k !== CACHE);
    const prev = await readMeta();
    let keep = (prev && old.includes(prev)) ? prev : null;
    if(!keep){
      for(const k of old.slice().reverse()){
        const n = (await (await caches.open(k)).keys()).length;   // k 取自 keys()，open 不會新建
        if(n){ keep = k; break; }
      }
    }
    await Promise.all(old.filter(k => k !== keep).map(k => caches.delete(k)));
    await dropOrphans();
    await writeMeta(CACHE);
    await self.clients.claim();
  })());
});

/** 改名前的整合預覽版（前綴 'todo-app-'）在這個 scope 裝過時留下的快取，改名後沒人會清。
    只刪「裡面每一筆網址都在本 scope 底下」的：舊版 App 自己的快取（網址都在 /todo-app/ 底下）碰不到；
    scope 是網域根目錄（本機開發）時整段跳過，免得把同網域其他 App 的快取當成自己的 */
async function dropOrphans(){
  if(scopePath === '/') return;
  for(const k of await caches.keys()){
    if(!k.startsWith('todo-app-')) continue;
    try{
      const keys = await (await caches.open(k)).keys();
      if(keys.length && keys.every(r => new URL(r.url).pathname.startsWith(scopePath))) await caches.delete(k);
    }catch(err){}
  }
}

/* ---------- 自我修復：這一代的檔被別人清掉時補回來 ---------- */
let healP = null, healedAt = 0;
/** 30 秒冷卻只在「真的查過」之後才開始：這次是因為離線／網路錯誤沒補成，下一次開啟就要再試，
    否則離線時開一次、恢復連線後 30 秒內再開，那一次會被冷卻略過，快取就一直是空的 */
function healSoon(){
  if(healP) return healP;
  if(Date.now() - healedAt < 30000) return Promise.resolve();
  healP = heal().then(ok => { if(ok) healedAt = Date.now(); }, ()=>{}).finally(()=>{ healP = null; });
  return healP;
}
/** 補齊這一代缺的 precache 檔。回傳 false＝有檔因為網路錯誤沒補成（不進冷卻） */
async function heal(){
  const miss = [];
  for(const u of PRECACHE) if(!(await caches.match(abs(u), {cacheName: CACHE}))) miss.push(u);
  if(!miss.length) return true;
  if(!(await isCurrentGen())) return true;     // 已經不是目前這一代：不歸我管
  const c = await caches.open(CACHE);          // 整個快取被刪時，這裡會重建（它就是目前這一代）
  let netFail = false;
  const older = (await ownCaches()).filter(k => k !== CACHE).reverse();
  let htmlOk = null;                            // 外殼要補的話，先確認伺服器上不是已經換了一版
  for(const u of miss){
    try{
      if(HASHES[u]){
        let done = false;
        for(const n of older){
          const r = await caches.match(abs(u), {cacheName: n});
          if(r && r.ok && (await belongs(u, r))){ await c.put(abs(u), r); done = true; break; }
        }
        if(done) continue;
      }else{
        if(htmlOk === null){
          // 跟 newerPending() 一樣，但查不到（離線）要記成網路錯誤：不能因此進冷卻
          try{ await self.registration.update(); htmlOk = !(self.registration.installing || self.registration.waiting); }
          catch(err){ htmlOk = false; netFail = true; }
        }
        if(!htmlOk) continue;
      }
      const res = await fetchT(new Request(abs(u), {cache:'no-cache'}));
      if(!okBasic(res)) continue;
      if(!(await belongs(u, res))) continue;   // 伺服器已經是新版：留給新版 SW 的安裝，不混進這一代
      await c.put(abs(u), res);
    }catch(err){ netFail = true; /* 離線：下次開再補 */ }
  }
  return !netFail;
}

/* ---------- 外殼（./、index.html、以及 ./?d=…、./?demo=1 這種導覽） ---------- */
async function cachedShell(){
  return (await caches.match(SHELL_KEYS[0], {cacheName: CACHE})) ||
         (await caches.match(SHELL_KEYS[1], {cacheName: CACHE})) ||
         (await matchOwn(SHELL_KEYS[0])) || (await matchOwn(SHELL_KEYS[1]));
}
let revalP = null;
/** 背景更新外殼：只改了 index.html 的部署下次開就生效；伺服器上 sw.js 也換了時不寫（見檔頭） */
function revalidateShell(){
  if(revalP) return revalP;
  revalP = (async ()=>{
    const res = await fetchT(new Request(SHELL_KEYS[0], {cache:'no-cache'}));
    if(!okBasic(res)) return;
    const body = await res.clone().text();
    const cur = await caches.match(SHELL_KEYS[0], {cacheName: CACHE});
    if(cur && (await cur.text()) === body) return;  // 沒變（最常見）：不用寫，也不用去問 sw.js
    if(await newerPending()) return;
    const copy = res.clone();
    await putCurrent([[SHELL_KEYS[0], res], [SHELL_KEYS[1], copy]]);
  })().catch(()=>{}).finally(()=>{ revalP = null; });
  return revalP;
}
const offline503 = () => new Response('離線，且這個資源沒有快取。', {
  status: 503, headers: {'Content-Type':'text/plain; charset=utf-8'}
});
const offlinePage = () => new Response(
  '<!doctype html><html lang="zh-Hant"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Checkly — 離線</title>' +
  '<body style="font:16px/1.6 system-ui,-apple-system,sans-serif;padding:32px 20px;max-width:34em;margin:auto;color:#133E50;background:#F8F7F2">' +
  '<h1 style="font-size:20px">目前離線，App 的離線檔案不在這台裝置上</h1>' +
  '<p>可能是瀏覽器清掉了網站資料。連上網路後重新開啟一次，就會重新下載並恢復離線可用；' +
  '你的待辦資料存在另一個地方，不受影響。</p></body></html>',
  { status: 503, headers: {'Content-Type':'text/html; charset=utf-8'} });

async function serveShell(e){
  const req = e.request;
  if(req.mode === 'navigate') e.waitUntil(healSoon());
  const hit = await cachedShell();
  if(hit){
    e.waitUntil(revalidateShell());
    return hit;
  }
  // 連外殼都沒有（第一次、或快取被清掉）：只能等網路；拿到的順手存成外殼。
  // 副本要在 return 之前同步 clone：回傳後 body 就被頁面讀走，之後再 clone 會丟例外（以前就是這樣默默存不進去）
  try{
    const res = await fetch(req);
    if(okBasic(res)){
      const a = res.clone(), b = res.clone();
      e.waitUntil(putCurrent([[SHELL_KEYS[0], a], [SHELL_KEYS[1], b]]).catch(()=>{}));
    }
    return res;
  }catch(err){
    return req.mode === 'navigate' ? offlinePage() : offline503();
  }
}

/* ---------- 這一代的 precache 檔 ---------- */
/** 固定檔名的 precache 檔（vendor、字型、圖示、manifest）：只從這一代拿，背景不更新。
    這一代沒有（被清掉）→ 網路，對得上雜湊才補回來 → 還是沒有就退回其他代 */
async function servePrecached(e, key){
  const req = e.request;
  const hit = await caches.match(req, {cacheName: CACHE});
  if(hit) return hit;
  let res = null;
  try{ res = await fetch(req); }catch(err){}
  if(okBasic(res)){
    if(await belongs(key, res)){
      const rc = res.clone();                    // return 之前 clone（見 serveShell）
      e.waitUntil(putCurrent([[abs(key), rc]]).catch(()=>{}));
    }
    return res;
  }
  return (await matchOwn(req)) || res || offline503();
}
/** 其他同 scope 的檔（不屬於任何一代）：stale-while-revalidate */
async function serveOther(e){
  const req = e.request;
  const hit = await caches.match(req, {cacheName: CACHE});
  let saved = Promise.resolve();
  const fresh = fetch(req).then(res=>{
    if(okBasic(res)) saved = putCurrent([[req, res.clone()]]).catch(()=>{});
    return res;
  }).catch(()=> null);

  if(hit){ e.waitUntil(fresh.then(()=> saved)); return hit; }

  const res = await fresh;
  if(res){ e.waitUntil(saved); return res; }
  const older = await matchOwn(req);
  if(older) return older;
  if(req.mode === 'navigate'){
    const shell = await cachedShell();
    if(shell) return shell;
    return offlinePage();
  }
  return offline503();
}

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;      // Supabase 等外部一律走網路
  if(!url.pathname.startsWith(scopePath)) return;      // 不碰同網域其他 App

  // App 外殼：桌面小工具的深連結 ./?d=2026-09-26、試用模式 ./?demo=1 也是它，一律先給快取的外殼
  // （不先等網路：Wi‑Fi 連得上卻沒網路時不會乾等，也不會拿到比快取裡的字型、程式庫新一版的 HTML）
  if(isShellPath(url.pathname) && (req.mode === 'navigate' || !url.search)){
    e.respondWith(serveShell(e));
    return;
  }
  if(url.search){
    // 其他帶查詢字串的資源不進快取（同一個檔會因查詢字串不同被存成好幾份）
    if(req.mode !== 'navigate') return;
    e.respondWith(fetch(req).catch(async ()=> (await cachedShell()) || offlinePage()));
    return;
  }

  const key = PRE_KEY.get(url.pathname);
  if(key){ e.respondWith(servePrecached(e, key)); return; }
  e.respondWith(serveOther(e));
});
