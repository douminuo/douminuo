/**
 * Pokemon Showdown data/moves.ts + data/mods/champions/moves.ts → extension/moveTags.json
 * Node 18+ (fetch). Usage:
 *   node scripts/generate-move-tags.js [path/to/moves.ts] [path/to/champions/moves.ts]
 * Without args, downloads master from GitHub raw.
 *
 * 스마트누오 = 포켓몬 챔피언스 전용 → champions mod 의 재분류가 본가보다 우선
 * (예: 드래곤클로·섀도클로 slicing, 전광쌍격 punch, 프리즈드라이 부가효과 제거).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_URL =
  'https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/moves.ts';
const CHAMPIONS_URL =
  'https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/mods/champions/moves.ts';
const OUT = path.join(__dirname, '..', 'extension', 'moveTags.json');

function extractBalanced(s, openIdx) {
  let depth = 0;
  let i = openIdx;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') {
      i += 2;
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < n - 1 && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < n) {
        if (s[i] === '\\') {
          i += 2;
          continue;
        }
        if (s[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '`') {
      i++;
      while (i < n) {
        if (s[i] === '\\') {
          i += 2;
          continue;
        }
        if (s[i] === '$' && s[i + 1] === '{') {
          const openBrace = i + 1;
          const closed = extractBalanced(s, openBrace);
          i = closed.end;
          continue;
        }
        if (s[i] === '`') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}') {
      depth--;
      i++;
      if (depth === 0) return { inner: s.slice(openIdx + 1, i - 1), end: i };
      continue;
    }
    i++;
  }
  throw new Error('unbalanced braces');
}

function extractMovesInner(ts) {
  const marker = 'export const Moves:';
  const idx = ts.indexOf(marker);
  if (idx === -1) throw new Error('export const Moves not found');
  const eq = ts.indexOf('= {', idx);
  if (eq === -1) throw new Error('Moves = { not found');
  const brace = ts.indexOf('{', eq);
  return extractBalanced(ts, brace).inner;
}

function skipWsCommentsCommas(s, i) {
  const n = s.length;
  while (i < n) {
    if (/[\s,]/.test(s[i])) {
      i++;
      continue;
    }
    if (s[i] === '/' && s[i + 1] === '/') {
      i += 2;
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
      continue;
    }
    if (s[i] === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < n - 1 && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function parseTopLevelKeys(content) {
  const entries = {};
  let i = 0;
  const n = content.length;
  while (i < n) {
    i = skipWsCommentsCommas(content, i);
    if (i >= n) break;
    if (content[i] === '}') break;

    let key;
    if (content[i] === '"') {
      i++;
      key = '';
      while (i < n && content[i] !== '"') {
        if (content[i] === '\\') i++;
        key += content[i++];
      }
      if (content[i] !== '"') throw new Error('unclosed key string');
      i++;
    } else {
      key = '';
      while (i < n && /[a-z0-9_]/i.test(content[i])) key += content[i++];
    }

    i = skipWsCommentsCommas(content, i);
    if (content[i] !== ':') throw new Error('expected : after key ' + key + ' at ' + i);
    i++;
    i = skipWsCommentsCommas(content, i);
    if (content[i] !== '{') throw new Error('expected { for move ' + key);
    const { inner, end } = extractBalanced(content, i);
    entries[key] = inner;
    i = end;
  }
  return entries;
}

function parseFlagsObject(body) {
  const tags = {};
  const m = body.match(/flags:\s*(\{[^}]*\})/);
  if (!m) return tags;
  const inner = m[1].slice(1, -1);
  const re = /(\w+)\s*:\s*(1|true)\b/g;
  let x;
  while ((x = re.exec(inner)) !== null) {
    tags[x[1]] = true;
  }
  return tags;
}

function parseCategory(body) {
  const m = body.match(/category:\s*"(Physical|Special|Status)"/);
  return m ? m[1] : '';
}

function hasRecoil(body) {
  return /\brecoil:\s*\[/.test(body);
}

/**
 * 첫 `secondary:`/`secondaries:` 만 본다 — mod 본문이 앞에 붙으면 `secondary: undefined` 가 본가를 덮음.
 * 부가효과 여러 개(불꽃엄니 등)는 `secondaries: [...]` 로 적혀 있음.
 */
function hasSecondaryBlock(body) {
  const m = body.match(/\bsecondar(?:y|ies):\s*(\S)/);
  return !!m && (m[1] === '{' || m[1] === '[');
}

/** 다단 타수 — 고정 `multihit: 2` 또는 범위 `multihit: [2, 5]`. 스마트누오 계산기 기술 객체와 같은 모양. */
function parseMultihit(body) {
  const m = body.match(/\bmultihit:\s*(?:\[\s*(\d+)\s*,\s*(\d+)\s*\]|(\d+))/);
  if (!m) return null;
  return m[3] ? Number(m[3]) : [Number(m[1]), Number(m[2])];
}

/** 확정 급소 기술 (트릭플라워·스톰스로우·프로스트브레스 등). */
function hasWillCrit(body) {
  return /\bwillCrit:\s*true\b/.test(body);
}

function buildTagsForMoveBody(body) {
  const tags = parseFlagsObject(body);
  const cat = parseCategory(body);
  if (hasRecoil(body)) tags.recoil = true;
  if ((cat === 'Physical' || cat === 'Special') && hasSecondaryBlock(body)) {
    tags.sheerForceEligible = true;
  }
  if (hasWillCrit(body)) tags.alwaysCrit = true;
  const hits = parseMultihit(body);
  if (hits) tags.multihit = hits;
  if (/\bmultiaccuracy:\s*true\b/.test(body)) tags.multiaccuracy = true;
  return tags;
}

async function loadSource(arg, url) {
  if (arg) {
    return fs.readFileSync(path.resolve(arg), 'utf8');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch ' + url + ' ' + res.status);
  return res.text();
}

async function main() {
  const ts = await loadSource(process.argv[2], DEFAULT_URL);
  const byKey = parseTopLevelKeys(extractMovesInner(ts));
  // champions mod 항목(`inherit: true` + 바뀐 필드만)을 본가 본문 앞에 붙임 —
  // 파서가 첫 매치(flags/category/secondary)를 쓰므로 mod 값이 우선.
  const champTs = await loadSource(process.argv[3], CHAMPIONS_URL);
  const champByKey = parseTopLevelKeys(extractMovesInner(champTs));
  for (const k of Object.keys(champByKey)) {
    if (byKey[k]) byKey[k] = champByKey[k] + '\n' + byKey[k];
  }
  const moves = {};
  for (const k of Object.keys(byKey)) {
    const tags = buildTagsForMoveBody(byKey[k]);
    if (Object.keys(tags).length) moves[k] = tags;
  }
  const doc = {
    version: 4,
    source: 'pokemon-showdown data/moves.ts + data/mods/champions/moves.ts',
    sourceUrl: DEFAULT_URL,
    modSourceUrl: CHAMPIONS_URL,
    generatedAt: new Date().toISOString(),
    moves,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 0) + '\n', 'utf8');
  console.log('Wrote', OUT, 'moves with tags:', Object.keys(moves).length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
