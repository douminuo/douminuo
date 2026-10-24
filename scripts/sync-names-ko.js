'use strict';

/**
 * modifiers.json 의 items 또는 abilities 키(= PokeAPI slug)마다 nameKo 를 설정하고 aliases 를 제거한다.
 * 우선순위 = koNames.js 와 같음: ① 사이트 표기 (extension/{item,ability}KoFallback.json — 사이트 표기 유일 출처,
 * 예: zap-plate 사이트 "우뢰플레이트" vs PokeAPI "우레플레이트") ② PokeAPI GET /api/v2/{kind}/{slug}/ 의 ko 이름.
 * 둘 다 없으면 기존 nameKo·aliases 유지하고 MISSING_KO 로그.
 *
 * node scripts/sync-names-ko.js --kind item
 * node scripts/sync-names-ko.js --kind ability
 */
const fs = require('fs');
const path = require('path');
const { koName } = require('./lib/pokeapi');

const kindArgIx = process.argv.indexOf('--kind');
const KIND = kindArgIx >= 0 ? process.argv[kindArgIx + 1] : null;
if (KIND !== 'item' && KIND !== 'ability') {
  console.error('Usage: node scripts/sync-names-ko.js --kind item|ability');
  process.exit(1);
}
const SECTION = KIND === 'item' ? 'items' : 'abilities';

const modPath = path.join(__dirname, '..', 'extension', 'modifiers.json');
const sitePath = path.join(__dirname, '..', 'extension', KIND + 'KoFallback.json');
const DELAY_MS = 80;

function loadJsonObject(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? j : {};
  } catch (e) {
    return {};
  }
}

async function fetchKo(slug) {
  const url = 'https://pokeapi.co/api/v2/' + KIND + '/' + encodeURIComponent(slug) + '/';
  const res = await fetch(url);
  if (!res.ok) return { slug, ko: null, err: res.status };
  const j = await res.json();
  return { slug, ko: koName(j), err: null };
}

async function main() {
  const mod = JSON.parse(fs.readFileSync(modPath, 'utf8'));
  const keys = Object.keys(mod[SECTION] || {});
  const missing = [];
  // 사이트 표기 파일은 { byKo: { 한글: slug } } — slug → 한글 로 뒤집음 (같은 slug 둘이면 먼저 나온 표기).
  const site = {};
  for (const [ko, slug] of Object.entries(loadJsonObject(sitePath).byKo || {})) if (!site[slug]) site[slug] = ko;

  for (const slug of keys) {
    const entry = mod[SECTION][slug];
    if (!entry || typeof entry !== 'object') continue;
    // 사이트 표기가 있으면 PokéAPI 호출 생략.
    const row = site[slug] ? { ko: null, err: null } : await fetchKo(slug);
    const ko = site[slug] || row.ko;

    if (ko) {
      entry.nameKo = ko;
      delete entry.aliases;
    } else {
      missing.push(slug + (row.err ? ':' + row.err : ''));
      if (!entry.nameKo) {
        console.error('MISSING_KO (no nameKo, keep aliases if any):', slug, row.err || '');
      }
    }

    if (!site[slug]) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  fs.writeFileSync(modPath, JSON.stringify(mod, null, 2) + '\n', 'utf8');

  if (missing.length) {
    console.error('MISSING_KO count:', missing.length);
    console.error(missing.join('\n'));
  }
  console.log('sync-names-ko(' + KIND + '): wrote', modPath, SECTION + ':', keys.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
