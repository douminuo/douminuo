'use strict';

/**
 * modifiers.json 의 items 또는 abilities 키(= PokeAPI slug)마다
 * GET /api/v2/{kind}/{slug}/ → names 중 language.name === 'ko' 를 읽어
 * nameKo 를 설정하고 aliases 를 제거한다 (한글은 PokeAPI 출처만 사용하는 정책).
 *
 * PokeAPI에 ko 가 없으면 scripts/{kind}-ko-fallback.json 에서 공식 한글명을 찾는다.
 * 거기도 없으면 기존 nameKo·aliases 유지하고 MISSING_KO 로그.
 * 단 scripts/{kind}-ko-site.json 에 있는 slug 는 스마트누오 표기가 PokeAPI 와 달라서
 * (예: zap-plate 사이트 "우뢰플레이트" vs PokeAPI "우레플레이트") 그 값을 PokeAPI 보다 우선한다 — 사이트 슬롯 도구명과 매칭돼야 하므로.
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
const fallbackPath = path.join(__dirname, KIND + '-ko-fallback.json');
const sitePath = path.join(__dirname, KIND + '-ko-site.json');
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
  const fallback = loadJsonObject(fallbackPath);
  const site = loadJsonObject(sitePath);

  for (const slug of keys) {
    const row = await fetchKo(slug);
    const entry = mod[SECTION][slug];
    if (!entry || typeof entry !== 'object') continue;

    let ko = typeof site[slug] === 'string' && site[slug].trim() ? site[slug].trim() : row.ko;
    const fb = fallback[slug];
    if (!ko && typeof fb === 'string' && fb.trim()) {
      ko = fb.trim();
      console.log('FALLBACK_KO:', slug, '→', ko);
    }

    if (ko) {
      entry.nameKo = ko;
      delete entry.aliases;
    } else {
      missing.push(slug + (row.err ? ':' + row.err : ''));
      if (!entry.nameKo) {
        console.error('MISSING_KO (no nameKo, keep aliases if any):', slug, row.err || '');
      }
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
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
