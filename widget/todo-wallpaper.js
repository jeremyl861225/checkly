/* =============================================================
   Checkly — 鎖定畫面桌布（Scriptable）
   -------------------------------------------------------------
   iPhone 鎖定畫面的小工具區只有時鐘下面那一小條（最多四個小的或兩個
   中的），放不下一整週加卡片。所以這裡走另一條路：把週曆和當天的事項
   直接畫進「桌布圖片」，再由「捷徑」自動化定時換上。看得到、但點不動。

   跑法：
     1. 這支腳本單獨在 Scriptable 裡跑 → 會跳出預覽，確認版面。
     2. 捷徑：執行指令碼（這支）→ 設定桌布（鎖定畫面）。
     3. 個人自動化：每天某個時間跑那個捷徑。

   背景照片（選填）：把一張圖命名成 todo-wallpaper-bg.jpg 放進
   Scriptable 的資料夾（檔案 App → iCloud Drive → Scriptable）。
   沒放就用素色漸層。

   這個檔案分成兩半：
     wallpaperLayout()  純計算，只吐出「要畫什麼」，不碰 Scriptable API
     main()             Scriptable 專用，把上面那些指令畫成圖
   widget/preview.html 會直接抓這個檔案來執行 wallpaperLayout()，
   所以電腦上看到的版面跟手機上畫出來的是同一份計算。
   ============================================================= */

/* =============================================================
   版面計算（純函式，瀏覽器也跑得動）
   回傳一串繪圖指令：
     {op:'rect', x,y,w,h, r, fill}
     {op:'text', x,y,w,h, s, size, weight, color, align}
   座標單位是「點」，原點在左上角。
   ============================================================= */
function wallpaperLayout(data, W, H, dark){
  const WD = ['日','一','二','三','四','五','六'];

  /* ---- 色票：跟 App 同一套 ---- */
  const T = dark ? {
    panel:'#17191C', panelA:0.74, ink:'#ECEEF1', ink2:'#B6BBC1', muted:'#8A9097',
    line:'#34383D', accent:'#5BA7A6', onAcc:'#111214', danger:'#E97552', done:'#B9E3B3',
    chipA:0.26, chipDoneA:0.13
  } : {
    panel:'#FBFAF6', panelA:0.86, ink:'#133E50', ink2:'#3D6070', muted:'#5C737D',
    line:'#DCD9CE', accent:'#2A7574', onAcc:'#FDFCF7', danger:'#A83F17', done:'#2F6B41',
    chipA:0.22, chipDoneA:0.11
  };
  const cat = h => dark ? liftForDark(h || '#8F8368') : (h || '#8F8368');

  /* ---- 尺度 ---- */
  const M      = 14;                                   // 左右邊界
  const GAP    = 3;                                    // 欄距
  const colW   = (W - M*2 - GAP*6) / 7;
  const CHIP_H = 40, CHIP_GAP = 4, ROWS = 3;           // 每天最多三條；格子夠高，標題可折兩行
  const CARD_H = 44, CARD_GAP = 6;                     // 幾張卡片由剩餘高度決定
  const PANEL_PAD = 14;
  // 起點壓在 iOS 自己的鎖定畫面小工具列（約螢幕高 0.26–0.32）下面，免得疊在一起
  const top    = Math.round(H * 0.33) + PANEL_PAD;

  const ops = [];
  const today = data.today || '';
  const items = (data.days && data.days[today]) || [];

  /* ---- 底板：照片什麼顏色都有可能，沒有底板文字一定會有讀不到的時候。
         高度先留空，等內容排完再回頭撐開——手算高度漏掉一段是看不出來的。 ---- */
  const stripH = 14 + 22 + 4 + ROWS*(CHIP_H+CHIP_GAP);
  const panel  = {op:'rect', x:M-PANEL_PAD, y:top-PANEL_PAD, w:W-(M-PANEL_PAD)*2, h:0,
                  r:26, fill:T.panel, alpha:T.panelA};
  ops.push(panel);
  let bottom = top + stripH - CHIP_GAP;            // 內容目前畫到哪裡

  /* ---- 週曆 ---- */
  const week = weekOf(today);
  week.forEach((ds, i) => {
    const x = M + i*(colW + GAP);
    const isT = ds === today;

    ops.push({op:'text', x, y:top, w:colW, h:14, s:WD[dow(ds)], size:11,
              color: isT ? T.accent : T.muted, align:'center'});

    if (isT) ops.push({op:'rect', x:x+(colW-30)/2, y:top+15, w:30, h:22, r:11,
                       fill:T.accent, alpha:1});
    ops.push({op:'text', x, y:top+17, w:colW, h:20, s:String(Number(ds.slice(8,10))),
              size:16, weight: isT ? 'bold' : 'regular',
              color: isT ? T.onAcc : T.ink, align:'center'});

    const its = (data.days && data.days[ds]) || [];
    its.slice(0, ROWS).forEach((it, r) => {
      const y = top + 41 + r*(CHIP_H + CHIP_GAP);
      const c = cat(it.p);
      ops.push({op:'rect', x, y, w:colW, h:CHIP_H, r:7, fill:c,
                alpha: it.d ? T.chipDoneA : T.chipA});
      const tc = it.d ? T.muted : c;
      // 欄寬只有四十幾點，一行放不下四、五個字以上，所以標題折兩行；
      // 內距也收到 2，每省一點就多看得到半個字。
      const tx2 = x + 2, tw2 = colW - 4, LH = 12;
      const title = (it.m ? '★' : '') + it.t;
      if (it.w){
        ops.push({op:'text', x:tx2, y:y+3, w:tw2, h:9,
                  s:fit(startTime(it.w), 7.5, tw2), size:7.5, color:tc, align:'left'});
        const f = fitLines(title, 9, tw2, 2, 7);
        const y0 = y + 13 + (CHIP_H - 16 - f.lines.length*LH) / 2;
        f.lines.forEach((ln, k) => ops.push({op:'text', x:tx2, y:y0+k*LH, w:tw2, h:LH,
                  s:ln, size:f.size, weight:'medium', color:tc, align:'left'}));
      } else {
        const f = fitLines(title, 9.5, tw2, 2, 7.5);
        const y0 = y + (CHIP_H - f.lines.length*(LH+1)) / 2;
        f.lines.forEach((ln, k) => ops.push({op:'text', x:tx2, y:y0+k*(LH+1), w:tw2, h:LH+1,
                  s:ln, size:f.size, weight:'medium', color:tc, align:'left'}));
      }
    });
    if (its.length > ROWS){
      const py = top + 41 + ROWS*(CHIP_H+CHIP_GAP) - 1;
      ops.push({op:'text', x, y:py, w:colW, h:10,
                s:'＋'+(its.length-ROWS), size:8, color:T.muted, align:'center'});
      bottom = Math.max(bottom, py + 10);
    }
  });

  /* ---- 當天卡片 ----
     鎖定畫面下緣有手電筒、相機與 home indicator，畫到那裡就被蓋掉了。
     所以卡片放幾張不是寫死的，是看週曆畫完之後還剩多少高度。 ---- */
  // 0.855：手電筒與相機那兩顆大約在螢幕高的 0.88 起跳，留這麼多就夠，
  // 再保守下去會平白空一大塊、卡片卻少一張。
  const FOOT_H = 20;
  const room   = H * 0.855 - (bottom + 12) - FOOT_H - PANEL_PAD;
  const CARDS  = Math.max(1, Math.min(5, Math.floor((room + CARD_GAP) / (CARD_H + CARD_GAP))));
  const shown  = items.slice(0, CARDS);

  let cy = bottom + 12;
  if (!shown.length){
    ops.push({op:'text', x:M, y:cy, w:W-M*2, h:18, s:'今天沒有安排', size:13,
              color:T.muted, align:'left'});
    cy += 18;
  }
  shown.forEach(it => {
    const c = cat(it.p);
    ops.push({op:'rect', x:M, y:cy+4, w:4, h:CARD_H-8, r:2,
              fill:c, alpha: it.d ? 0.4 : 1});
    const tx = M + 14, tw = W - M*2 - 14;
    ops.push({op:'text', x:tx, y:cy+2, w:tw, h:21,
              s:fit((it.m?'★ ':'')+it.t, 17, tw), size:17, weight:'semibold',
              color: it.d ? T.muted : T.ink, align:'left'});
    const sub = [it.w, it.s ? `${it.s[0]}/${it.s[1]}` : '', it.d ? '已完成' : '']
      .filter(Boolean).join('   ');
    ops.push({op:'text', x:tx, y:cy+24, w:tw, h:16, s:sub, size:12,
              color: it.d ? T.done : T.ink2, align:'left'});
    cy += CARD_H + CARD_GAP;
  });

  if (shown.length) cy -= CARD_GAP;               // 最後一張卡片後面不留欄距
  const late = (data.late || []).length;
  const more = items.length - CARDS;
  if (more > 0 || late){
    const fy = cy + 6;
    if (more > 0) ops.push({op:'text', x:M, y:fy, w:W-M*2, h:14,
                            s:`還有 ${more} 件`, size:11, color:T.muted, align:'left'});
    if (late)     ops.push({op:'text', x:M, y:fy, w:W-M*2, h:14,
                            s:`逾期 ${late} 件`, size:11, weight:'medium',
                            color:T.danger, align:'right'});
    cy = fy + 14;
  }
  panel.h = cy - panel.y + PANEL_PAD;

  return { ops, panel,
           bg:{ top: dark ? '#1B2A2E' : '#EDF0E6', bottom: dark ? '#111214' : '#F8F7F2' } };

  /* ---- 這個版面自己要用的小工具 ---- */
  function dow(s){ return parseYmd(s).getDay(); }
  function weekOf(ds){
    const st = addDays(ds, -dow(ds));
    return Array.from({length:7}, (_, i) => addDays(st, i));
  }
}

/* 估算字寬：CJK 約等於字級，拉丁與數字約 0.55 倍。
   DrawContext 沒有自動截字，寬度算錯就會壓到隔壁格，所以寧可保守一點。 */
// CJK、全形標點，以及 ★✓◆● 這類跟漢字等寬的符號
const WIDE_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFF60\u3000-\u303F\u2605\u2606\u2B50\u25A0-\u25FF\u2713\u2714\u2716\u2726\u2727]/;
function textW(s, size){
  let w = 0;
  for (const ch of String(s == null ? '' : s)){
    w += WIDE_RE.test(ch) ? size : size * 0.55;
  }
  return w;
}
/** 「09:00 - 12:00」在 50 點寬的格子裡一定會被切，格子裡只留開始時刻。 */
function startTime(w){
  return String(w == null ? '' : w).split(/[-\u2013\u2014~\uFF5E\u301C]/)[0].trim();
}
function fit(s, size, maxW){
  s = String(s == null ? '' : s);
  if (textW(s, size) <= maxW) return s;
  let out = '';
  for (const ch of s){
    if (textW(out + ch, size) > maxW - size * 0.7) break;
    out += ch;
  }
  return out + '…';
}

// 中文可以在任何地方斷，英數不行——「拍攝 TikTok 影片」斷成「拍攝 TikT / ok 影片」很難看。
// 冒號也收進來，否則「門診 08:30」會被斷成「08: / 30」。
const WORD_RE = /[0-9A-Za-z@._:+\-/]/;

/** 排成最多 maxLines 行，每行不超過 maxW。
    回傳 {lines, truncated}——truncated 表示放不完、最後一行收了省略號。 */
function wrapLines(s, size, maxW, maxLines){
  const chars = Array.from(String(s == null ? '' : s));
  const lines = [];
  let brokeWord = false;
  let i = 0;
  while (i < chars.length && lines.length < maxLines){
    while (i < chars.length && chars[i] === ' ') i++;      // 換行後不要留開頭的空白
    const start = i;
    let cur = '';
    while (i < chars.length && textW(cur + chars[i], size) <= maxW){ cur += chars[i]; i++; }
    if (i === start){ cur = chars[i]; i++; }               // 單一字元就超寬：硬放，否則停不下來

    // 斷點落在一串英數中間就退回那串的開頭——前提是退回後這行還有字，
    // 而且那串本身放得進一行（放不進的話退了也沒用，只會空轉）
    if (i < chars.length && WORD_RE.test(chars[i]) && WORD_RE.test(chars[i-1])){
      let j = i;  while (j > start && WORD_RE.test(chars[j-1])) j--;
      let k = i;  while (k < chars.length && WORD_RE.test(chars[k])) k++;
      if (j > start && textW(chars.slice(j, k).join(''), size) <= maxW){
        cur = chars.slice(start, j).join('');
        i = j;
      } else {
        brokeWord = true;      // 那串本身就放不進一行，只能硬切——縮小一級也許就不必了
      }
    }

    if (lines.length === maxLines - 1 && i < chars.length){
      cur = fit(chars.slice(start).join(''), size, maxW);
      lines.push(cur.replace(/\s+$/, ''));
      return { lines, truncated: true, brokeWord };
    }
    lines.push(cur.replace(/\s+$/, ''));
  }
  return { lines, truncated: i < chars.length, brokeWord };
}

/** 先用原字級試，整個標題放不完就一階一階縮小，回傳放得完的最大字級。
    格子只有四十幾點寬，與其把「拍攝 TikTok 影片」截成「拍攝／TikTok …」，
    不如小半級讓它完整出現——小一點還讀得到，被截掉就真的沒了。 */
function fitLines(s, size, maxW, maxLines, minSize){
  let fallback = null;                       // 放得完、但英數字串被硬切開的那個字級
  for (let sz = size; sz > minSize - 0.01; sz -= 0.5){
    const r = wrapLines(s, sz, maxW, maxLines);
    if (r.truncated) continue;
    if (!r.brokeWord) return { size: sz, lines: r.lines };   // 放得完又沒切壞，就是它
    if (!fallback) fallback = { size: sz, lines: r.lines };
  }
  if (fallback) return fallback;
  return { size: minSize, lines: wrapLines(s, minSize, maxW, maxLines).lines };
}

/* ---- 日期 ---- */
function _pad(n){ return String(n).padStart(2, '0'); }
function _ymd(d){ return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`; }
function parseYmd(s){
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m||1)-1, d||1);
}
function addDays(s, n){
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return _ymd(d);
}

/* ---- 深色的類別色換算：跟 App 的 liftForDark 同一套 ---- */
function liftForDark(hex){
  const h = String(hex || '').replace('#','');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  let r = (parseInt(n.slice(0,2),16)||0)/255,
      g = (parseInt(n.slice(2,4),16)||0)/255,
      b = (parseInt(n.slice(4,6),16)||0)/255;
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b), df = mx - mn;
  let hu = 0;
  if (df){
    if (mx === r)      hu = ((g-b)/df + (g<b?6:0));
    else if (mx === g) hu = (b-r)/df + 2;
    else               hu = (r-g)/df + 4;
    hu /= 6;
  }
  let l = (mx+mn)/2;
  let sa = df ? df / (1 - Math.abs(2*l - 1)) : 0;
  if (l >= 0.62) return '#' + n;
  l  = 0.52 + (l / 0.62) * 0.28;
  sa = Math.min(sa, 0.62);
  const q = l < 0.5 ? l*(1+sa) : l + sa - l*sa, pp = 2*l - q;
  const ch = t => {
    t = (t+1)%1;
    if (t < 1/6) return pp + (q-pp)*6*t;
    if (t < 1/2) return q;
    if (t < 2/3) return pp + (q-pp)*(2/3 - t)*6;
    return pp;
  };
  const hx = v => Math.round(Math.min(1, Math.max(0, v))*255).toString(16).padStart(2,'0');
  return '#' + hx(ch(hu+1/3)) + hx(ch(hu)) + hx(ch(hu-1/3));
}

/* =============================================================
   Scriptable：把上面的指令畫成一張桌布
   ============================================================= */
const BG_FILE = 'todo-wallpaper-bg.jpg';    // 放在 Scriptable 資料夾就會當底圖

async function main(feedUrl){
  const data = await loadFeed(feedUrl);
  const sz   = Device.screenSize();
  const W = sz.width, H = sz.height;
  const dark = Device.isUsingDarkAppearance();
  const L = wallpaperLayout(data, W, H, dark);

  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = true;
  ctx.respectScreenScale = true;

  /* 底圖：有放照片就用照片，沒有就用兩段素色（DrawContext 沒有漸層，
     用一排細橫條假裝，省得為了漸層多拉一個相依） */
  const bg = backgroundImage();
  if (bg){
    ctx.drawImageInRect(bg, coverRect(bg.size, W, H));
  } else {
    const a = hexToRGB(L.bg.top), b = hexToRGB(L.bg.bottom);
    const STEPS = 64;
    for (let i = 0; i < STEPS; i++){
      const t = i / (STEPS - 1);
      ctx.setFillColor(new Color(rgbToHex(
        a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t)));
      ctx.fillRect(new Rect(0, Math.floor(H*i/STEPS), W, Math.ceil(H/STEPS) + 1));
    }
  }

  for (const o of L.ops){
    if (o.op === 'rect'){
      ctx.setFillColor(new Color(o.fill, o.alpha === undefined ? 1 : o.alpha));
      if (o.r){
        const p = new Path();
        p.addRoundedRect(new Rect(o.x, o.y, o.w, o.h), o.r, o.r);
        ctx.addPath(p);
        ctx.fillPath();
      } else {
        ctx.fillRect(new Rect(o.x, o.y, o.w, o.h));
      }
    } else {
      ctx.setFont(fontFor(o.size, o.weight));
      ctx.setTextColor(new Color(o.color));
      if (o.align === 'center')      ctx.setTextAlignedCenter();
      else if (o.align === 'right')  ctx.setTextAlignedRight();
      else                           ctx.setTextAlignedLeft();
      ctx.drawTextInRect(String(o.s), new Rect(o.x, o.y, o.w, o.h));
    }
  }

  const img = ctx.getImage();
  if (config.runsInApp) await QuickLook.present(img);
  else Script.setShortcutOutput(img);     // 捷徑接走 → 設定桌布
  Script.complete();
}

function fontFor(size, weight){
  if (weight === 'bold')     return Font.boldSystemFont(size);
  if (weight === 'semibold') return Font.semiboldSystemFont(size);
  if (weight === 'medium')   return Font.mediumSystemFont(size);
  return Font.systemFont(size);
}

function backgroundImage(){
  for (const fm of candidateFMs()){
    try{
      const p = fm.joinPath(fm.documentsDirectory(), BG_FILE);
      if (!fm.fileExists(p)) continue;
      if (fm.isFileStoredInICloud && fm.isFileStoredInICloud(p) &&
          !fm.isFileDownloaded(p)) continue;    // 還沒下載完就當作沒有，別卡住
      return fm.readImage(p);
    }catch(e){}
  }
  return null;
}
function candidateFMs(){
  const out = [];
  try{ out.push(FileManager.iCloud()); }catch(e){}
  try{ out.push(FileManager.local()); }catch(e){}
  return out;
}

/** 把照片等比放大到蓋滿整個螢幕（超出的部分裁掉） */
function coverRect(s, W, H){
  const k = Math.max(W / s.width, H / s.height);
  const w = s.width * k, h = s.height * k;
  return new Rect((W - w) / 2, (H - h) / 2, w, h);
}

function hexToRGB(hex){
  const h = String(hex).replace('#','');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function rgbToHex(r, g, b){
  const hx = v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2,'0');
  return '#' + hx(r) + hx(g) + hx(b);
}

async function loadFeed(url){
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.cacheDirectory(), 'todo-widget.json');
  try{
    const req = new Request(url);
    req.timeoutInterval = 15;
    const d = await req.loadJSON();
    if (d && d.error) throw new Error(d.error);
    fm.writeString(cache, JSON.stringify(d));
    return d;
  }catch(e){
    if (fm.fileExists(cache)){
      try{ return JSON.parse(fm.readString(cache)); }catch(_){}
    }
    return { today: _ymd(new Date()), days:{}, late:[] };
  }
}
