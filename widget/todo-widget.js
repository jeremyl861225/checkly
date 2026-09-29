/* =============================================================
   Checkly — iPhone 桌面小工具（Scriptable）
   -------------------------------------------------------------
   上方一整排本週七天（每天有彩色事項條），下方是當天的事項卡片。
   點某一天 → 開啟 App 並跳到那天的月曆。

   資料來自 App 推上去的唯讀快照（Edge Function `widget`）。
   重複排程怎麼展開是 App 的事，這裡只負責畫。

   用法：由 loader 呼叫 main(feedUrl)。單獨使用時在檔尾自己加一行
         await main("https://...functions/v1/widget?t=你的token");

   支援的小工具尺寸：
     large               週曆 + 當天卡片（推薦）
     medium              週曆 + 兩張卡片
     small               當天前三件
     accessoryRectangular  鎖定畫面長條：今天幾件 + 最近兩件

   長按小工具 → 編輯小工具 → Parameter 可以填天數位移：
     留白或 0 = 今天、1 = 明天、-1 = 昨天
   ============================================================= */

/* ---------- 色票（跟 App 同一套；深色由 Color.dynamic 自動切換）---------- */
const C = {
  bg:    dyn('#FBFAF6', '#17191C'),
  card:  dynA('#133E50', 0.045, '#FFFFFF', 0.055),
  ink:   dyn('#133E50', '#ECEEF1'),
  ink2:  dyn('#3D6070', '#B6BBC1'),
  muted: dyn('#5C737D', '#8A9097'),
  line:  dyn('#DCD9CE', '#34383D'),
  accent:dyn('#2A7574', '#5BA7A6'),
  onAcc: dyn('#FDFCF7', '#111214'),
  hot:   dyn('#B9660F', '#F4A14F'),
  danger:dyn('#A83F17', '#E97552'),
  doneInk: dyn('#2F6B41', '#B9E3B3')
};

const WD = ['日','一','二','三','四','五','六'];

/* =============================================================
   進入點
   ============================================================= */
async function main(feedUrl){
  const fam  = config.runsInWidget ? config.widgetFamily : 'large';
  const off  = parseInt((args.widgetParameter || '').trim(), 10) || 0;
  const data = await loadFeed(feedUrl);

  let w;
  if (data.error)            w = errorWidget(data.error);
  else if (fam === 'accessoryRectangular') w = lockWidget(data, off);
  else if (fam === 'accessoryCircular')    w = circleWidget(data, off);
  else if (fam === 'accessoryInline')      w = inlineWidget(data, off);
  else if (fam === 'small')  w = smallWidget(data, off);
  else if (fam === 'medium') w = weekWidget(data, off, 'medium');
  else                       w = weekWidget(data, off, 'large');

  // 小工具每次更新由 iOS 決定，這裡只給一個最早可更新時間，別讓它停在舊資料
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  if (config.runsInWidget) Script.setWidget(w);
  else if (fam === 'medium') await w.presentMedium();
  else if (fam === 'small')  await w.presentSmall();
  else await w.presentLarge();
  Script.complete();
}

/* =============================================================
   取資料：拿不到就退回上一次的快取，寧可顯示舊的也不要一片空白
   ============================================================= */
async function loadFeed(url){
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.cacheDirectory(), 'todo-widget.json');
  try{
    const req = new Request(url);
    req.timeoutInterval = 12;
    const d = await req.loadJSON();
    if (d && d.error) {
      // token 失效／被重新產生：有舊快取就先用舊的，同時記下狀態
      if (fm.fileExists(cache)) {
        const old = JSON.parse(fm.readString(cache));
        old.stale = 'token';
        return old;
      }
      return { error: d.error === 'not_found'
        ? '網址已失效。請回 App 的「桌面小工具」重新產生，再貼一次程式碼。'
        : '讀取失敗：' + d.error };
    }
    fm.writeString(cache, JSON.stringify(d));
    return d;
  }catch(e){
    if (fm.fileExists(cache)) {
      try{
        const old = JSON.parse(fm.readString(cache));
        old.stale = 'offline';
        return old;
      }catch(_){}
    }
    return { error: '連不上網路，也沒有先前的資料。' };
  }
}

/* =============================================================
   大／中型：週曆 + 當天卡片
   ============================================================= */
function weekWidget(d, off, fam){
  const S = sizeOf(fam);
  const PAD = 13;
  const inner = S.w - PAD * 2;
  const colW = Math.floor((inner - 6 * 2) / 7);     // 七欄，欄距 2

  const today = d.today || ymd(new Date());
  const sel   = addDays(today, off);
  const week  = weekOf(sel);

  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(PAD, PAD, PAD, PAD);
  w.url = appLink(d, sel);                          // 點空白處開當天

  /* ---- 抬頭：月份 + 選到的那天有幾件 ---- */
  const head = w.addStack();
  head.centerAlignContent();
  const mo = head.addText(`${Number(sel.slice(5,7))} 月`);
  mo.font = Font.boldSystemFont(14);
  mo.textColor = C.ink;
  const tag = head.addText(sameDay(sel, today) ? '  今天' : '  ' + WD[dow(sel)] + '曜');
  tag.font = Font.systemFont(11);
  tag.textColor = C.muted;
  head.addSpacer();
  const cnt = (d.days && d.days[sel]) ? d.days[sel] : [];
  const left = cnt.filter(x => !x.d).length;
  const st = head.addText(left ? `${left} 件未完成` : (cnt.length ? '全部完成' : '沒有事項'));
  st.font = Font.mediumSystemFont(11);
  st.textColor = left ? C.ink2 : C.doneInk;

  w.addSpacer(9);

  /* ---- 週曆：七欄，每欄可以各自點 ---- */
  const rows = fam === 'large' ? 3 : 2;             // 每天最多顯示幾條
  const strip = w.addStack();
  strip.layoutHorizontally();
  strip.topAlignContent();
  week.forEach((ds, i) => {
    if (i) strip.addSpacer(2);
    dayColumn(strip, d, ds, colW, today, sel, rows);
  });

  w.addSpacer(10);
  hairline(w, inner);
  w.addSpacer(8);

  /* ---- 當天卡片 ---- */
  const list = cnt.slice();
  const max  = fam === 'large' ? 5 : 2;
  if (!list.length){
    const e = w.addText('這天沒有安排');
    e.font = Font.systemFont(12);
    e.textColor = C.muted;
  } else {
    list.slice(0, max).forEach((it, i) => {
      if (i) w.addSpacer(5);
      card(w, it, d, sel);
    });
    if (list.length > max){
      w.addSpacer(5);
      const more = w.addText(`還有 ${list.length - max} 件`);
      more.font = Font.systemFont(11);
      more.textColor = C.muted;
    }
  }

  w.addSpacer();
  footer(w, d);
  return w;
}

/** 週曆的一欄：週幾 / 日期 / 事項條 */
function dayColumn(parent, d, ds, colW, today, sel, rows){
  const col = parent.addStack();
  col.layoutVertically();
  col.size = new Size(colW, 0);
  col.url = appLink(d, ds);                         // 點這一天 → 開 App 到那天

  const isToday = sameDay(ds, today);
  const isSel   = sameDay(ds, sel);

  const wd = col.addStack();
  wd.addSpacer();
  const wt = wd.addText(WD[dow(ds)]);
  wt.font = Font.systemFont(9);
  wt.textColor = isToday ? C.accent : C.muted;
  wd.addSpacer();

  col.addSpacer(1);

  // 日期：今天用實心藥丸，選到的那天（不是今天時）用細框
  const dn = col.addStack();
  dn.addSpacer();
  const pill = dn.addStack();
  pill.size = new Size(colW - 10, 17);
  pill.centerAlignContent();
  pill.cornerRadius = 8.5;
  if (isToday)      pill.backgroundColor = C.accent;
  else if (isSel)   pill.backgroundColor = C.card;
  const dt = pill.addText(String(Number(ds.slice(8,10))));
  dt.font = isToday || isSel ? Font.boldSystemFont(12) : Font.systemFont(12);
  dt.textColor = isToday ? C.onAcc : C.ink;
  dt.centerAlignText();
  dn.addSpacer();

  col.addSpacer(3);

  const items = (d.days && d.days[ds]) ? d.days[ds] : [];
  items.slice(0, rows).forEach((it, i) => {
    if (i) col.addSpacer(2);
    chip(col, it, colW);
  });
  if (items.length > rows){
    col.addSpacer(1);
    const m = col.addStack();
    m.addSpacer();
    const mt = m.addText('＋' + (items.length - rows));
    mt.font = Font.systemFont(8);
    mt.textColor = C.muted;
    m.addSpacer();
  }
}

/** 週曆格子裡的一條事項 */
function chip(col, it, colW){
  const c = catColor(it.p);
  const box = col.addStack();
  box.size = new Size(colW, 13);
  box.cornerRadius = 3.5;
  box.setPadding(0, 2, 0, 2);
  box.centerAlignContent();
  box.backgroundColor = catColor(it.p, it.d ? 0.10 : 0.20);
  const t = box.addText(it.t);
  // 欄寬只有四十幾點。Scriptable 放不下時是「縮字」不是截斷，
  // 所以把 minimumScaleFactor 放寬：短標題維持 7.5，長標題自己縮到看得完為止。
  t.font = Font.mediumSystemFont(7.5);
  t.textColor = it.d ? C.muted : c;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.7;
}

/** 下方的一張卡片：左側色條 + 時間 + 標題 + 右側狀態 */
function card(w, it, d, ds){
  const row = w.addStack();
  row.centerAlignContent();
  row.size = new Size(0, 26);
  row.url = appLink(d, ds);

  const bar = row.addStack();
  bar.size = new Size(3, 20);
  bar.cornerRadius = 1.5;
  bar.backgroundColor = it.d ? catColor(it.p, 0.35) : catColor(it.p);
  row.addSpacer(8);

  if (it.w){
    const tm = row.addText(it.w);
    tm.font = Font.mediumSystemFont(11);
    tm.textColor = it.d ? C.muted : C.ink2;
    tm.lineLimit = 1;
    row.addSpacer(7);
  }

  const ti = row.addText((it.m ? '★ ' : '') + it.t);
  ti.font = Font.systemFont(13);
  ti.textColor = it.d ? C.muted : C.ink;
  ti.lineLimit = 1;
  ti.minimumScaleFactor = 0.72;

  row.addSpacer();

  if (it.d){
    const ck = row.addText('✓');
    ck.font = Font.boldSystemFont(12);
    ck.textColor = C.doneInk;
  } else if (it.s){
    const pg = row.addText(`${it.s[0]}/${it.s[1]}`);
    pg.font = Font.mediumSystemFont(10);
    pg.textColor = C.muted;
  } else if (it.n){
    const sp = row.addText(`${it.x}/${it.n} 天`);
    sp.font = Font.systemFont(10);
    sp.textColor = C.muted;
  }
}

/** 頁尾：逾期提醒與資料時間 */
function footer(w, d){
  const f = w.addStack();
  f.centerAlignContent();
  const late = (d.late || []).length;
  if (late){
    const l = f.addText(`逾期 ${late} 件`);
    l.font = Font.mediumSystemFont(10);
    l.textColor = C.danger;
  }
  f.addSpacer();
  const note = f.addText(stampText(d));
  note.font = Font.systemFont(9);
  note.textColor = C.muted;
}

function stampText(d){
  if (d.stale === 'offline') return '離線，顯示上次的資料';
  if (d.stale === 'token')   return '網址已變更，請回 App 重設';
  if (!d.updated_at) return '';
  const t = new Date(d.updated_at);
  if (isNaN(t.getTime())) return '';
  return `更新於 ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/* =============================================================
   小型：只列當天前三件
   ============================================================= */
function smallWidget(d, off){
  const today = d.today || ymd(new Date());
  const sel = addDays(today, off);
  const items = (d.days && d.days[sel]) ? d.days[sel] : [];

  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(13, 13, 13, 13);
  w.url = appLink(d, sel);

  const h = w.addStack();
  h.centerAlignContent();
  const dd = h.addText(String(Number(sel.slice(8,10))));
  dd.font = Font.boldSystemFont(22);
  dd.textColor = C.accent;
  h.addSpacer(5);
  const wd = h.addText(`週${WD[dow(sel)]}`);
  wd.font = Font.mediumSystemFont(11);
  wd.textColor = C.muted;
  h.addSpacer();

  w.addSpacer(7);
  if (!items.length){
    const e = w.addText('沒有安排');
    e.font = Font.systemFont(12);
    e.textColor = C.muted;
  } else {
    items.slice(0, 3).forEach((it, i) => {
      if (i) w.addSpacer(5);
      const r = w.addStack();
      r.centerAlignContent();
      const b = r.addStack();
      b.size = new Size(3, 16);
      b.cornerRadius = 1.5;
      b.backgroundColor = it.d ? catColor(it.p, 0.35) : catColor(it.p);
      r.addSpacer(6);
      const t = r.addText((it.w ? it.w + ' ' : '') + it.t);
      t.font = Font.systemFont(10.5);
      t.textColor = it.d ? C.muted : C.ink;
      t.lineLimit = 1;
      t.minimumScaleFactor = 0.7;
    });
    if (items.length > 3){
      w.addSpacer(4);
      const m = w.addText(`還有 ${items.length - 3} 件`);
      m.font = Font.systemFont(10);
      m.textColor = C.muted;
    }
  }
  w.addSpacer();
  return w;
}

/* =============================================================
   鎖定畫面
   iOS 只給時鐘下面那一小條，放不下週曆，所以只挑最要緊的講。
   ============================================================= */
function lockWidget(d, off){
  const today = d.today || ymd(new Date());
  const sel = addDays(today, off);
  const items = (d.days && d.days[sel]) ? d.days[sel] : [];
  const open = items.filter(x => !x.d);

  const w = new ListWidget();
  w.setPadding(2, 2, 2, 2);
  w.url = appLink(d, sel);

  const h = w.addText(open.length ? `待辦 ${open.length} 件` : '今天都完成了');
  h.font = Font.boldSystemFont(12);

  (open.length ? open : items).slice(0, 2).forEach(it => {
    const t = w.addText((it.w ? it.w + ' ' : '') + it.t);
    t.font = Font.systemFont(11);
    t.lineLimit = 1;
  });
  if (!items.length){
    const t = w.addText('沒有安排');
    t.font = Font.systemFont(11);
  }
  return w;
}

function circleWidget(d, off){
  const today = d.today || ymd(new Date());
  const sel = addDays(today, off);
  const items = (d.days && d.days[sel]) ? d.days[sel] : [];
  const done = items.filter(x => x.d).length;

  const w = new ListWidget();
  w.url = appLink(d, sel);
  w.addSpacer();
  const n = w.addText(String(items.length - done));
  n.font = Font.boldSystemFont(18);
  n.centerAlignText();
  const l = w.addText('待辦');
  l.font = Font.systemFont(9);
  l.centerAlignText();
  w.addSpacer();
  return w;
}

function inlineWidget(d, off){
  const today = d.today || ymd(new Date());
  const sel = addDays(today, off);
  const items = ((d.days && d.days[sel]) ? d.days[sel] : []).filter(x => !x.d);
  const w = new ListWidget();
  w.url = appLink(d, sel);
  w.addText(items.length ? `${items.length} 件・${items[0].t}` : '今天沒有待辦');
  return w;
}

function errorWidget(msg){
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(15, 15, 15, 15);
  const t = w.addText('Checkly');
  t.font = Font.boldSystemFont(13);
  t.textColor = C.ink;
  w.addSpacer(6);
  const m = w.addText(msg);
  m.font = Font.systemFont(11);
  m.textColor = C.danger;
  w.addSpacer();
  return w;
}

/* =============================================================
   小工具
   ============================================================= */
function dyn(l, d){ return Color.dynamic(new Color(l), new Color(d)); }
function dynA(l, la, d, da){ return Color.dynamic(new Color(l, la), new Color(d, da)); }

/** 類別色。深色主題沿用原色會糊進底色，所以提亮——這段跟 App 的 liftForDark 同一套算法。 */
function catColor(hex, alpha){
  const base = hex || '#8F8368';
  const a = alpha === undefined ? 1 : alpha;
  return Color.dynamic(new Color(base, a), new Color(liftForDark(base), a));
}
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

function hairline(w, width){
  const l = w.addStack();
  l.size = new Size(width, 1);
  l.backgroundColor = C.line;
}

/** iOS 各螢幕寬度對應的小工具尺寸（點）。查不到就取最接近的一組。 */
const WIDGET_SIZES = {
  320: { small:141, medium:292, large:292, largeH:311 },
  360: { small:155, medium:329, large:329, largeH:345 },
  375: { small:155, medium:329, large:329, largeH:345 },
  390: { small:158, medium:338, large:338, largeH:354 },
  393: { small:158, medium:338, large:338, largeH:354 },
  402: { small:162, medium:344, large:344, largeH:362 },
  414: { small:169, medium:360, large:360, largeH:376 },
  428: { small:170, medium:364, large:364, largeH:382 },
  430: { small:170, medium:364, large:364, largeH:382 },
  440: { small:174, medium:374, large:374, largeH:391 }
};
function sizeOf(fam){
  const s = Device.screenSize();
  const sw = Math.round(Math.min(s.width, s.height));
  const keys = Object.keys(WIDGET_SIZES).map(Number);
  const k = keys.reduce((a, b) => Math.abs(b - sw) < Math.abs(a - sw) ? b : a, keys[0]);
  const t = WIDGET_SIZES[k];
  // 抓不準時寧可少 2 點，寬了會被裁掉，窄一點只是留白
  if (fam === 'medium') return { w: t.medium - 2, h: 155 };
  return { w: t.large - 2, h: t.largeH };
}

/** 開啟 App 並跳到某一天 */
function appLink(d, ds){
  const base = (d.app || 'https://jeremyl861225.github.io/checkly/').replace(/[?#].*$/, '');
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'd=' + ds;
}

/* ---------- 日期（一律用本機日期字串，不做時區換算）---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function parseYmd(s){
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m||1) - 1, d||1);
}
function addDays(s, n){
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
const dow = s => parseYmd(s).getDay();
const sameDay = (a, b) => a === b;
/** 含 ds 的那一週（週日起算，跟 App 的月曆同一套） */
function weekOf(ds){
  const start = addDays(ds, -dow(ds));
  return Array.from({length: 7}, (_, i) => addDays(start, i));
}
