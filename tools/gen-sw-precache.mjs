#!/usr/bin/env node
// 依 precache 檔案的內容重新產生 sw.js 的快取版本（BUILD）與逐檔雜湊（HASHES）。
//
//   node tools/gen-sw-precache.mjs            改寫 sw.js（在 repo 根目錄跑；沒變就一個位元組都不動）
//   node tools/gen-sw-precache.mjs --check    只檢查不寫入；sw.js 過期或引用有缺時 exit 1（部署前／pre-commit 用）
//   node tools/gen-sw-precache.mjs <appRoot> [--sw sw.js] [--check]
//
// 沒有建置流程：PRECACHE 陣列由人手維護（sw.js 裡），這支只負責
//   1. 驗證 PRECACHE：每個檔都存在、沒有帶查詢字串（sw.js 對帶 ?query 的資源一律不快取 → 離線會壞）
//   2. 驗證引用：index.html 的標籤（link／script／img…的 href、src）、<style> 裡的 url()、
//      manifest 的 icons 與 start_url 引用的本機檔，都要在 PRECACHE 裡而且檔案存在；外部網址一律不行。
//      例外：./sw.js 本身、.gitignore 的選用功能 imports/。
//      （字型、圖片、script 新增了卻忘了加進 PRECACHE，要等到離線才會發現壞了——這裡先擋）
//   3. HASHES：PRECACHE 裡每個非 HTML 檔（vendor、字型、圖示、manifest…）內容的 SHA-256 前 16 碼。
//      sw.js 用它①安裝時直接從上一代複製沒變的檔（不重抓）、②從網路抓來的檔要對得上才收
//      （伺服器已經是下一版的檔不會混進這一代）、③快取被清掉時自我修復。
//      所以這些檔改了一定要重跑這支，否則新版 SW 會因雜湊不符而裝不上（舊版照常服務）。
//   4. BUILD：上面那些檔（路徑＋內容）合起來的雜湊前 10 碼；CACHE 名稱＝PREFIX + 'v10-' + BUILD。
//      任何一個檔變了 sw.js 就跟著變 → 瀏覽器安裝新 SW → 整批換新 → 新舊版本不會混用。
//   HTML（'./'、index.html）刻意不算進 HASHES 與 BUILD：外殼由 sw.js 在背景更新（伺服器上 sw.js 沒換時才寫），
//   只改 index.html 的部署不該觸發一次 SW 更新；雜湊也沒辦法登記——index.html 一改，雜湊對不上，背景更新就寫不進去。
//
// sw.js 裡由這支改寫的地方（寫法要維持原樣）：
//   const BUILD = '…';
//   // <sw-hashes> … // </sw-hashes>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const here = path.dirname(fileURLToPath(import.meta.url));
const posArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--sw');
const appRoot = path.resolve(posArg || path.join(here, '..'));
const swPath = path.join(appRoot, opt('--sw', 'sw.js'));
const checkOnly = args.includes('--check');

const errors = [];
const fail = (m) => errors.push(m);
const die = (m) => { console.error('✗ ' + m); process.exit(1); };
const posix = (p) => p.split(path.sep).join('/');
const norm = (u) => (u === '.' || u === './') ? './' : './' + posix(path.posix.normalize(u.split(/[?#]/)[0].replace(/^\.\//, '')));

// ---- 1. 讀 sw.js 的 PRECACHE ----
if (!fs.existsSync(swPath)) die(`找不到 ${swPath}`);
const sw = fs.readFileSync(swPath, 'utf8');
const arr = sw.match(/const PRECACHE\s*=\s*\[([\s\S]*?)\];/);
if (!arr) die('sw.js 裡找不到 const PRECACHE = [ … ];');
const precache = [...arr[1].replace(/\/\/[^\n]*/g, '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
if (!precache.length) die('PRECACHE 是空的');
const pre = new Set();
for (const u of precache) {
  if (u.includes('?')) fail(`PRECACHE 項目帶查詢字串：${u}（sw.js 不快取帶 ?query 的資源）`);
  if (/^(https?:)?\/\//.test(u)) fail(`PRECACHE 項目是外部網址：${u}`);
  const k = norm(u);
  if (k !== u) fail(`PRECACHE 項目請寫成 ${k}（目前是 ${u}；sw.js 用這個字串查 HASHES）`);
  if (pre.has(k)) fail(`PRECACHE 重複：${u}`);
  pre.add(k);
  if (k !== './' && !fs.existsSync(path.join(appRoot, k))) fail(`PRECACHE 列了不存在的檔案：${u}`);
}

// ---- 2. index.html／manifest 引用的本機檔都要在 PRECACHE ----
{
  const htmlPath = path.join(appRoot, 'index.html');
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  if (!html) fail('找不到 index.html');
  const refs = new Map();
  const add = (u, where) => {
    u = (u || '').trim();
    if (!u || /^(data:|#|mailto:|javascript:|blob:|about:)/.test(u) || u.includes('${')) return;
    if (/^(https?:)?\/\//.test(u)) { fail(`${where} 引用外部網址 ${u}（離線會失敗，請改成本機檔案）`); return; }
    const k = norm(u);
    if (!refs.has(k)) refs.set(k, where);
  };
  // 註解裡的範例標籤不算
  const live = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of live.matchAll(/<(?:link|script|img|source|use|image|video|audio|iframe)\b[^>]*?\s(?:href|src|xlink:href)\s*=\s*["']([^"']+)["']/g)) add(m[1], 'index.html 標籤');
  for (const st of live.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))
    for (const m of st[1].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(m[1], 'index.html 的 CSS url()');
  const manPath = path.join(appRoot, 'manifest.webmanifest');
  if (fs.existsSync(manPath)) {
    let man = null;
    try { man = JSON.parse(fs.readFileSync(manPath, 'utf8')); } catch (e) { fail('manifest.webmanifest 不是合法的 JSON：' + e.message); }
    for (const ic of (man && man.icons) || []) add(ic.src, 'manifest 的 icons');
    if (man && man.start_url) add(man.start_url, 'manifest 的 start_url');
  }
  for (const [k, where] of refs) {
    if (k === './sw.js' || k.startsWith('./imports/')) continue;
    if (!pre.has(k)) fail(`${where} 引用了 ${k}，但它不在 sw.js 的 PRECACHE（離線會缺這個檔）`);
    else if (k !== './' && !fs.existsSync(path.join(appRoot, k))) fail(`${where} 引用了 ${k}，但檔案不存在`);
  }
}
if (errors.length) { for (const m of errors) console.error('✗ ' + m); process.exit(1); }

// ---- 3. 逐檔雜湊與 BUILD（HTML 不算，見檔頭） ----
const isHtml = (u) => u === './' || /\.html?$/i.test(u);
const hashed = [...pre].filter((u) => !isHtml(u)).sort();
const read = (u) => fs.readFileSync(path.join(appRoot, u));
const fileHash = (u) => createHash('sha256').update(read(u)).digest('hex').slice(0, 16);
const h = createHash('sha256');
for (const u of hashed) h.update(u + '\0').update(read(u)).update('\0');
const BUILD = h.digest('hex').slice(0, 10);

const HSTART = '// <sw-hashes> 以下由 tools/gen-sw-precache.mjs 產生，勿手改';
const HEND = '// </sw-hashes>';
const hashBlock = `${HSTART}\nconst HASHES = {\n` + hashed.map((u) => `  '${u}': '${fileHash(u)}',`).join('\n') + `\n};\n${HEND}`;

let next = sw;
if (!/const BUILD\s*=\s*'[^']*';/.test(next)) die("sw.js 裡找不到 const BUILD = '…';");
next = next.replace(/const BUILD\s*=\s*'[^']*';/, `const BUILD = '${BUILD}';`);
if (!/^\/\/ <sw-hashes>[^\n]*\n[\s\S]*?^\/\/ <\/sw-hashes>$/m.test(next)) die('sw.js 裡找不到 // <sw-hashes> … // </sw-hashes> 區段');
next = next.replace(/^\/\/ <sw-hashes>[^\n]*\n[\s\S]*?^\/\/ <\/sw-hashes>$/m, () => hashBlock);

const rel = path.relative(process.cwd(), path.join(here, 'gen-sw-precache.mjs')) || 'tools/gen-sw-precache.mjs';
if (next === sw) { console.log(`✓ sw.js 已是最新（BUILD=${BUILD}，precache ${pre.size} 項，雜湊 ${hashed.length} 項）`); process.exit(0); }
if (checkOnly) die(`sw.js 與 precache 檔案不一致（應為 BUILD=${BUILD}）；請跑 node ${rel}`);
fs.writeFileSync(swPath, next);
console.log(`✓ sw.js 已更新：BUILD=${BUILD}，雜湊 ${hashed.length} 項：\n  ` + hashed.join('\n  '));
