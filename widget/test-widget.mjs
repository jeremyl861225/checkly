/* 小工具腳本的煙霧測試
 * ---------------------------------------------------------------
 * 用假的 Scriptable API 把 todo-widget.js 與 todo-wallpaper.js 實際跑一次。
 * 驗的不是畫面好不好看，是「每條路徑都走得通、沒有打錯的 API 名稱、
 * 每個顏色都是合法色碼」——這些在手機上只會安靜地變成空白小工具。
 *
 * 跑法：node widget/test-widget.mjs
 * 改過任何一支腳本都應該重跑一次。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 這個檔案就放在 widget/ 底下，跟受測的兩支腳本同一層
const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 路徑有空白，不能用 URL.pathname

/* ---------- 假 Scriptable ---------- */
const calls = [];
const rec = (k, v) => { calls.push(k); return v; };

class Size { constructor(w,h){ this.width=w; this.height=h; } }
class Rect { constructor(x,y,w,h){ Object.assign(this,{x,y,width:w,height:h}); } }
class Color {
  constructor(hex, a=1){
    if(!/^#[0-9a-fA-F]{6}$/.test(String(hex))) throw new Error('壞的色碼：' + hex);
    this.hex = hex; this.a = a;
  }
  static dynamic(l,d){
    if(!(l instanceof Color) || !(d instanceof Color)) throw new Error('Color.dynamic 參數不是 Color');
    return { dyn:[l,d] };
  }
}
const mkFont = n => { if(typeof n !== 'number' || !(n>0)) throw new Error('字級不是正數：'+n); return {size:n}; };
const Font = { systemFont:mkFont, boldSystemFont:mkFont, mediumSystemFont:mkFont,
               semiboldSystemFont:mkFont, lightSystemFont:mkFont };

class Txt {
  constructor(s){ this.text = String(s); }
  set font(v){ if(!v || typeof v.size!=='number') throw new Error('font 設錯'); this._f=v; }
  set textColor(v){ this._c=v; }
  set lineLimit(v){ this._l=v; }
  set minimumScaleFactor(v){ if(v<=0||v>1) throw new Error('minimumScaleFactor 超出範圍'); }
  centerAlignText(){} leftAlignText(){} rightAlignText(){}
}
class Stack {
  constructor(){ this.kids=[]; }
  addStack(){ const s=new Stack(); this.kids.push(s); return s; }
  addText(s){ const t=new Txt(s); this.kids.push(t); return t; }
  addSpacer(n){ if(n!==undefined && typeof n!=='number') throw new Error('addSpacer 參數錯'); }
  addImage(){ return {}; }
  layoutHorizontally(){} layoutVertically(){}
  centerAlignContent(){} topAlignContent(){} bottomAlignContent(){}
  setPadding(){}
  set size(v){ if(!(v instanceof Size)) throw new Error('size 不是 Size'); this._s=v; }
  set backgroundColor(v){ this._bg=v; }
  set cornerRadius(v){ this._r=v; }
  set url(v){
    if(typeof v!=='string' || !/^https?:\/\//.test(v)) throw new Error('url 不合法：'+v);
    this._u=v; rec('url');
  }
}
class ListWidget extends Stack {
  set refreshAfterDate(v){ if(!(v instanceof Date)) throw new Error('refreshAfterDate 不是 Date'); }
  async presentLarge(){} async presentMedium(){} async presentSmall(){}
}
class Path { addRoundedRect(r,cw,ch){ if(!(r instanceof Rect)) throw new Error('addRoundedRect 參數錯'); } }
class DrawContext {
  constructor(){ this.ops=0; }
  set size(v){ if(!(v instanceof Size)) throw new Error('DrawContext.size 錯'); }
  set opaque(v){} set respectScreenScale(v){}
  setFillColor(c){ if(!(c instanceof Color)) throw new Error('setFillColor 不是 Color'); }
  fillRect(r){ if(!(r instanceof Rect)) throw new Error('fillRect 錯'); this.ops++; }
  addPath(p){ if(!(p instanceof Path)) throw new Error('addPath 錯'); }
  fillPath(){ this.ops++; }
  setFont(f){ if(!f || typeof f.size!=='number') throw new Error('setFont 錯'); }
  setTextColor(c){ if(!(c instanceof Color)) throw new Error('setTextColor 不是 Color'); }
  setTextAlignedLeft(){} setTextAlignedCenter(){} setTextAlignedRight(){}
  drawTextInRect(s,r){ if(typeof s!=='string') throw new Error('drawTextInRect 文字不是字串');
                       if(!(r instanceof Rect)) throw new Error('drawTextInRect Rect 錯'); this.ops++; }
  drawImageInRect(i,r){ if(!(r instanceof Rect)) throw new Error('drawImageInRect 錯'); this.ops++; }
  getImage(){ return {size:new Size(393,852)}; }
}

let FEED_JSON = null, FEED_FAIL = false;
class Request {
  constructor(url){ this.url=url; rec('request:'+url.split('?')[0]); }
  set timeoutInterval(v){}
  async loadJSON(){ if(FEED_FAIL) throw new Error('offline'); return FEED_JSON; }
  async loadString(){ return ''; }
}
const files = new Map();
const mkFM = () => ({
  cacheDirectory:()=>'/cache', documentsDirectory:()=>'/docs',
  joinPath:(a,b)=>path.posix.join(a,b),
  fileExists:p=>files.has(p),
  readString:p=>files.get(p),
  writeString:(p,v)=>files.set(p,v),
  readImage:()=>null,
  isFileStoredInICloud:()=>false, isFileDownloaded:()=>true
});
const FileManager = { local:mkFM, iCloud:mkFM };
const Device = { screenSize:()=>new Size(393,852), screenScale:()=>3,
                 isUsingDarkAppearance:()=>false };
const Script = { setWidget:w=>rec('setWidget', w), complete:()=>{}, setShortcutOutput:i=>rec('shortcutOutput', i) };
const QuickLook = { present:async()=>{} };

/* ---------- 測試資料：跟 App 的 wfBuild() 同一個格式 ---------- */
const pad = n => String(n).padStart(2,'0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const add = (s,n)=>{ const [y,m,dd]=s.split('-').map(Number); const d=new Date(y,m-1,dd);
                     d.setDate(d.getDate()+n); return ymd(d); };
const T = ymd(new Date());
function sampleFeed(){
  const days = {};
  for(let i=-3;i<=6;i++){
    const ds = add(T,i);
    days[ds] = [
      {k:'s',i:'a'+i,t:'辦公室工作與週會紀錄',w:'09:00 - 12:00',c:'工作',p:'#2A7574',d:i%3===0,s:[1,3]},
      {k:'e',i:'b'+i,t:'★ 參觀畫展',w:'16:30',c:'私人',p:'#C87A22',d:false,m:1,n:3,x:2},
      {k:'t',i:'c'+i,t:'交年度考核表',w:'',c:'',p:null,d:false},
      {k:'s',i:'d'+i,t:'睡前伸展',w:'22:00',c:'私人',p:'#4C8C5B',d:false}
    ];
  }
  return { v:1, today:T, from:add(T,-7), to:add(T,35), app:'https://jeremyl861225.github.io/checkly/',
           days, late:[{k:'t',i:'z',t:'補請領收據',c:'',p:'#C87A22',due:add(T,-3),m:1}],
           updated_at:new Date().toISOString() };
}

/* ---------- 跑 ---------- */
function runner(file){
  const src = fs.readFileSync(path.join(ROOT,file),'utf8');
  const fn = new Function(
    'Size','Rect','Color','Font','ListWidget','Path','DrawContext','Request',
    'FileManager','Device','Script','QuickLook','config','args','console',
    src + '\n; return main;');
  return (cfg, ag) => fn(Size,Rect,Color,Font,ListWidget,Path,DrawContext,Request,
    FileManager,Device,Script,QuickLook,cfg,ag,console);
}

const results = [];
async function check(label, fn){
  try{ await fn(); results.push('✅ ' + label); }
  catch(e){ results.push('❌ ' + label + ' — ' + e.message); }
}

const widgetMain = runner('todo-widget.js');
const wallMain   = runner('todo-wallpaper.js');
const FEED = 'https://x.supabase.co/functions/v1/widget?t=AAAAAAAAAAAAAAAAAAAAAAAAAAAA';

for(const fam of ['large','medium','small','accessoryRectangular','accessoryCircular','accessoryInline']){
  for(const par of ['', '1', '-2', 'abc']){
    FEED_JSON = sampleFeed(); FEED_FAIL = false;
    await check(`小工具 ${fam} param="${par}"`, () =>
      widgetMain({runsInWidget:true, widgetFamily:fam, runsInApp:false}, {widgetParameter:par})(FEED));
  }
}

// 空資料、token 失效、離線
FEED_JSON = { v:1, today:T, days:{}, late:[], app:'https://jeremyl861225.github.io/checkly/' };
await check('小工具 空資料', () => widgetMain({runsInWidget:true,widgetFamily:'large'},{widgetParameter:''})(FEED));
FEED_JSON = { error:'not_found' }; files.clear();
await check('小工具 token 失效（無快取）', () => widgetMain({runsInWidget:true,widgetFamily:'large'},{widgetParameter:''})(FEED));
FEED_JSON = sampleFeed();
await check('小工具 先存一次快取', () => widgetMain({runsInWidget:true,widgetFamily:'large'},{widgetParameter:''})(FEED));
FEED_JSON = { error:'not_found' };
await check('小工具 token 失效（有快取→顯示舊的）', () => widgetMain({runsInWidget:true,widgetFamily:'large'},{widgetParameter:''})(FEED));
FEED_FAIL = true;
await check('小工具 離線（有快取）', () => widgetMain({runsInWidget:true,widgetFamily:'large'},{widgetParameter:''})(FEED));
files.clear();
await check('小工具 離線（無快取）', () => widgetMain({runsInWidget:true,widgetFamily:'large'},{widgetParameter:''})(FEED));

// 桌布
for(const dark of [false,true]){
  Device.isUsingDarkAppearance = () => dark;
  for(const [w,h] of [[375,812],[393,852],[430,932]]){
    Device.screenSize = () => new Size(w,h);
    FEED_JSON = sampleFeed(); FEED_FAIL = false; files.clear();
    await check(`桌布 ${w}x${h} ${dark?'深色':'淺色'} (捷徑)`, () =>
      wallMain({runsInWidget:false, runsInApp:false},{widgetParameter:''})(FEED));
    await check(`桌布 ${w}x${h} ${dark?'深色':'淺色'} (App 內預覽)`, () =>
      wallMain({runsInWidget:false, runsInApp:true},{widgetParameter:''})(FEED));
  }
}
Device.screenSize = () => new Size(393,852);
FEED_JSON = { v:1, today:T, days:{}, late:[] };
await check('桌布 空資料', () => wallMain({runsInWidget:false,runsInApp:false},{widgetParameter:''})(FEED));
FEED_FAIL = true; files.clear();
await check('桌布 離線無快取', () => wallMain({runsInWidget:false,runsInApp:false},{widgetParameter:''})(FEED));

const fails = results.filter(r=>r.startsWith('❌'));
console.log(results.join('\n'));
console.log(`\n通過 ${results.length-fails.length}/${results.length}`);
if(fails.length) process.exit(1);
