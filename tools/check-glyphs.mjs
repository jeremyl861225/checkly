#!/usr/bin/env node
// 檢查字元是不是真的在內建字型（fonts/ 的 JetBrains Mono 子集）裡。缺字會退回系統字型：
// 細線的 □△ 跟粗體混在一起、實心的 ●■ 還會撐出 1ch 的格子——亂碼跳字、ASCII 粒子、轉圈字元都只能用字型裡有的字。
//
//   node tools/check-glyphs.mjs              檢查 index.html 裡跳字引擎的 GLYPHS
//   node tools/check-glyphs.mjs "▖▘▝▗✦"      檢查任意字串（例如要加進動畫的字元）
//   node tools/check-glyphs.mjs --ranges     列出字型在幾個常用區段裡有哪些字
//
// 不需要安裝任何套件：WOFF2 的表格是一整段 brotli，Node 內建就能解；cmap 不會被 WOFF2 轉換，解開直接讀。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTS = ['fonts/JetBrainsMono-Bold.woff2', 'fonts/JetBrainsMono-Regular.woff2'];
const TAGS = ['cmap','head','hhea','hmtx','maxp','name','OS/2','post','cvt ','fpgm','glyf','loca','prep','CFF ','VORG','EBDT','EBLC','gasp','hdmx','kern','LTSH','PCLT','VDMX','vhea','vmtx','BASE','GDEF','GPOS','GSUB','EBSC','JSTF','MATH','CBDT','CBLC','COLR','CPAL','SVG ','sbix','acnt','avar','bdat','bloc','bsln','cvar','fdsc','feat','fmtx','fvar','gvar','hsty','just','lcar','mort','morx','opbd','prop','trak','Zapf','Silf','Glat','Gloc','Feat','Sill'];

/** WOFF2 → 有字形的碼位集合 */
function cmapOf(file){
  const b = fs.readFileSync(file);
  if(b.toString('ascii', 0, 4) !== 'wOF2') throw new Error(file + ' 不是 WOFF2');
  const numTables = b.readUInt16BE(12);
  let p = 48;
  const b128 = () => { let v = 0; for(let i = 0; i < 5; i++){ const x = b[p++]; v = v * 128 + (x & 127); if(!(x & 128)) return v; } throw new Error('UIntBase128'); };
  const dir = [];
  for(let i = 0; i < numTables; i++){
    const f = b[p++];
    let tag; if((f & 63) === 63){ tag = b.toString('ascii', p, p + 4); p += 4; } else tag = TAGS[f & 63];
    const ver = f >> 6, orig = b128();
    const transformed = (tag === 'glyf' || tag === 'loca') ? ver === 0 : ver !== 0;
    dir.push({ tag, len: transformed ? b128() : orig });
  }
  const data = zlib.brotliDecompressSync(b.subarray(p, p + b.readUInt32BE(20)));
  let off = 0, cm = null;
  for(const t of dir){ if(t.tag === 'cmap') cm = data.subarray(off, off + t.len); off += t.len; }
  if(!cm) throw new Error(file + ' 沒有 cmap');
  let best = null;
  for(let i = 0; i < cm.readUInt16BE(2); i++){
    const o = cm.readUInt32BE(8 + i * 8), fmt = cm.readUInt16BE(o);
    if(fmt === 12) best = { o, fmt }; else if(fmt === 4 && !best) best = { o, fmt };
  }
  const set = new Set(), o = best.o;
  if(best.fmt === 12){
    for(let g = 0, n = cm.readUInt32BE(o + 12); g < n; g++){
      const s = cm.readUInt32BE(o + 16 + g * 12), e = cm.readUInt32BE(o + 20 + g * 12), gid = cm.readUInt32BE(o + 24 + g * 12);
      for(let c = s; c <= e; c++) if(gid + c - s) set.add(c);
    }
  }else{
    const x2 = cm.readUInt16BE(o + 6), endO = o + 14, startO = endO + x2 + 2, deltaO = startO + x2, rangeO = deltaO + x2;
    for(let s = 0; s < x2 / 2; s++){
      const end = cm.readUInt16BE(endO + s * 2), start = cm.readUInt16BE(startO + s * 2), delta = cm.readInt16BE(deltaO + s * 2), ro = cm.readUInt16BE(rangeO + s * 2);
      for(let c = start; c <= end && c !== 0xFFFF; c++){
        let gid;
        if(ro === 0) gid = (c + delta) & 0xFFFF;
        else { const gi = cm.readUInt16BE(rangeO + s * 2 + ro + (c - start) * 2); gid = gi ? (gi + delta) & 0xFFFF : 0; }
        if(gid) set.add(c);
      }
    }
  }
  return set;
}

const args = process.argv.slice(2);
const sets = FONTS.map(f => [f, cmapOf(path.join(root, f))]);
if(args[0] === '--ranges'){
  const R = [['2000–206F 標點', 0x2000, 0x206f], ['2190–21FF 箭頭', 0x2190, 0x21ff], ['2500–257F 框線', 0x2500, 0x257f],
             ['2580–259F 方塊', 0x2580, 0x259f], ['25A0–25FF 幾何', 0x25a0, 0x25ff], ['2700–27BF 裝飾', 0x2700, 0x27bf]];
  for(const [f, set] of sets){
    console.log(f + '（' + set.size + ' 字）');
    for(const [name, a, z] of R){ let s = ''; for(let c = a; c <= z; c++) if(set.has(c)) s += String.fromCodePoint(c); console.log('  ' + name + '：' + (s || '（無）')); }
  }
  process.exit(0);
}
let text = args[0], what = '指定的字串';
if(text === undefined){
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const m = html.match(/var GLYPHS = '([^']+)'/);
  if(!m) { console.error('✗ index.html 裡找不到 var GLYPHS = \'…\''); process.exit(1); }
  text = m[1]; what = 'index.html 的 GLYPHS';
}
let bad = false;
for(const [f, set] of sets){
  const miss = [...new Set([...text])].filter(ch => ch.trim() && !set.has(ch.codePointAt(0)));
  if(miss.length){ bad = true; console.error(`✗ ${f} 缺 ${miss.length} 個字：${miss.join(' ')}（${miss.map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ')}）`); }
}
if(bad) process.exit(1);
console.log(`✓ ${what}（${[...new Set([...text])].length} 個字元）兩個字型都有`);
