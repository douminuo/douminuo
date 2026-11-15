'use strict';

/**
 * 한 번에 도는 검사 — 실패하면 종료 코드 1. git pre-commit 훅(.githooks/pre-commit)이 자동 실행.
 *   node scripts/check.js [extension 폴더]   (폴더 인자 = 순서 검사를 사본에 시험할 때만, smoke 는 항상 이 저장소)
 *
 * 1. smoke-*.js 전부
 * 2. 로드 순서 — manifest content_scripts · background importScripts.
 *    목록을 베끼지 않고 의존을 코드에서 읽음: 파일 IIFE 맨 위(들여쓰기 2칸) `var X = g.NAME` 이 읽는 NAME 을
 *    정의(`g.NAME =`)하는 파일이 앞에 있어야 함. 함수 안 읽기(클릭 시점 조회 — nuoBoxHandlers 등)는 순서 무관이라 안 봄.
 *    shortcut: 들여쓰기 2칸 규칙에 기댐 — IIFE 모양이 다른 파일은 안 잡힘, 그런 파일이 생기면 파서로.
 * 3. extension 의 JSON 파싱
 * 4. ES5 금지 문법 정규식 (2026-11-15 사용자 결정 — ESLint 대신, 의존성 0). 문자열 안 오탐 가능.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXT = path.resolve(process.argv[2] || path.join(ROOT, 'extension'));
const fails = [];

// ── 1. smoke
for (const f of fs.readdirSync(__dirname).filter((n) => /^smoke-.*\.js$/.test(n)).sort()) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  if (r.status !== 0) fails.push(`${f} 실패\n${(r.stdout || '') + (r.stderr || '')}`.trim());
}

// ── 2. 로드 순서
const ALIAS = '(?:g|global|globalThis|self)';
const DEF_RE = new RegExp(`(?:^|[^\\w.])${ALIAS}\\.(\\w+)\\s*=(?!=)`, 'g');
const TOP_READ_LINE = new RegExp(`^  var \\w+ = .*`);
const READ_RE = new RegExp(`(?:^|[^\\w.])${ALIAS}\\.(\\w+)`, 'g');

function scan(file) {
  const src = fs.readFileSync(path.join(EXT, file), 'utf8');
  const defs = new Set();
  const reads = new Set();
  for (const m of src.matchAll(DEF_RE)) defs.add(m[1]);
  for (const line of src.split('\n')) {
    if (!TOP_READ_LINE.test(line)) continue;
    for (const m of line.matchAll(READ_RE)) reads.add(m[1]);
  }
  return { defs, reads };
}

let edges = 0;
function checkOrder(label, files) {
  const info = files.map(scan);
  const firstDef = new Map();
  info.forEach((x, i) => x.defs.forEach((n) => { if (!firstDef.has(n)) firstDef.set(n, i); }));
  info.forEach((x, i) => x.reads.forEach((n) => {
    const d = firstDef.get(n);
    if (d === undefined || d === i) return;
    edges++;
    if (d > i) fails.push(`${label}: ${files[i]} 가 맨 위에서 ${n} 을 읽는데 정의한 ${files[d]} 가 뒤에 있음`);
  }));
}

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const csFiles = manifest.content_scripts[0].js;
// nuoTokens 맨 앞 — 모든 Shadow CSS·토스트가 prepend (TEMPLATES §9).
if (csFiles[0] !== 'styles/nuoTokens.js') fails.push('manifest: styles/nuoTokens.js 가 content_scripts 맨 앞이 아님');
checkOrder('manifest content_scripts', csFiles);

const bgSrc = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const swFiles = Array.from(bgSrc.matchAll(/^importScripts\('([^']+)'\)/gm), (m) => m[1]).concat('background.js');
checkOrder('background importScripts', swFiles);

// 들여쓰기 규칙이 깨져 아무것도 못 읽으면 검사가 조용히 통과하므로 막음.
if (edges < 10) fails.push(`로드 순서: 의존을 ${edges}개만 찾음 — check.js 의 읽기 규칙이 코드 모양과 어긋남`);

// ── 3. JSON
(function walkJson(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJson(p);
    else if (e.name.endsWith('.json')) {
      try { JSON.parse(fs.readFileSync(p, 'utf8')); } catch (err) { fails.push(`JSON 파싱 실패: ${path.relative(EXT, p)} — ${err.message}`); }
    }
  }
})(EXT);

// ── 4. ES5
// 예외: 생성물 sampleCardAssets·regulationSpeedData, Node 도구 embedSpeedData.
// popup.js 계산된 키 `{ [LK.x]: … }` (2026-10-24 사용자 결정 유지)는 이 정규식에 안 걸림.
const ES5_SKIP = new Set(['sampleCardAssets.js', 'regulationSpeedData.js', 'embedSpeedData.js']);
const ES5_BAD = /(^|[^\w.$'"])(let|const|class|async)\s+[\w{[]|=>|`/;
assert(ES5_BAD.test('  let x = 1;') && ES5_BAD.test('a.map((x) => x)') && ES5_BAD.test('var s = `t`;'));
assert(!ES5_BAD.test("  var s = 'let it go';") && !ES5_BAD.test('  el.className = 1;'));

(function walkJs(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walkJs(p); continue; }
    if (!e.name.endsWith('.js') || ES5_SKIP.has(e.name)) continue;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (ES5_BAD.test(line.replace(/\s\/\/.*$/, ''))) fails.push(`ES5: ${path.relative(EXT, p)}:${i + 1}: ${t.slice(0, 80)}`);
    });
  }
})(EXT);

if (fails.length) {
  console.error(fails.join('\n') + `\n\ncheck: 실패 ${fails.length}건`);
  process.exit(1);
}
console.log(`check: 통과 (로드 순서 의존 ${edges}개)`);
