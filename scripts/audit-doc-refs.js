/**
 * 문서의 `백틱` 식별자·파일명 중 코드(extension/, scripts/)에 더 없는 것 → 문서별 목록.
 *
 *   node scripts/audit-doc-refs.js TEMPLATES.md CLAUDE.md BACKLOG.md
 *
 * 이름만 봄 — 이름이 있어도 내용이 틀린 경우(대부분)는 손 대조 (MAINTENANCE.md §2).
 * 오탐 많음 (사이트 키·영문 단어) — 목록을 훑어 진짜 사라진 이름만 고침.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', '.cache', 'legacy'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const code = walk(path.join(ROOT, 'extension'), []).concat(walk(path.join(ROOT, 'scripts'), []))
  .filter((p) => /\.(js|json|html|css)$/.test(p));
const files = new Set(code.map((p) => path.basename(p)));
const corpus = code.filter((p) => !/\.json$/.test(p) || fs.statSync(p).size < 200000)
  .map((p) => fs.readFileSync(p, 'utf8')).join('\n');

for (const doc of process.argv.slice(2)) {
  const t = fs.readFileSync(path.resolve(ROOT, doc), 'utf8');
  const miss = new Map();
  const re = /`([^`\n]{3,80})`/g;
  let m;
  while ((m = re.exec(t))) {
    const tok = m[1];
    const fileM = tok.match(/([A-Za-z0-9_\-]+\.(?:js|json))\b/);
    const ids = [];
    if (fileM && !files.has(fileM[1])) ids.push(fileM[1]);
    // camelCase 식별자 6자 이상만 — 짧은 단어·영문 문장 오탐 줄임
    for (const id of tok.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) || []) {
      if (id.length >= 6 && !corpus.includes(id)) ids.push(id);
    }
    for (const id of ids) {
      const line = t.slice(0, m.index).split('\n').length;
      if (!miss.has(id)) miss.set(id, []);
      miss.get(id).push(line);
    }
  }
  console.log('## ' + doc + ' (' + miss.size + ')');
  for (const [id, lines] of miss) console.log('  ' + id + ' @' + lines.slice(0, 6).join(','));
}
