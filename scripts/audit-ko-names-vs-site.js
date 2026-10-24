/**
 * 스마트누오 한글 표기 vs 우리 데이터 대조 (SMARTNUO_RE_PLAN K) — 해석은 확장과 같은 extension/koNames.js.
 *
 *   node scripts/audit-ko-names-vs-site.js           # 보고만
 *   node scripts/audit-ko-names-vs-site.js --write   # unresolved 를 extension/{item,ability}KoFallback.json(사이트 표기 유일 출처)에 추가
 *
 * 대조:
 *  - 특성·도구: 사이트 GET /api/ability?for=party · /api/equipment?for=party ([{ en, kr }])
 *    unresolved: 사이트 kr 이 koNames 로 안 풀림 (Showdown 복사 때 한글 그대로 나감) → --write
 *    wrongSlug:  다른 slug 로 풀림 → 손으로 판단. 사이트 표기 파일에 넣으면 이김 (예: 대파 = leek).
 *                같은 한글명이 둘인 혼연일체 등은 그대로 둠
 *    nameKoDiff: modifiers.json nameKo ≠ 사이트 kr (같은 slug) → 사이트 표기 파일에 있으면
 *                node scripts/sync-names-ko.js --kind item|ability 로 nameKo 맞춤
 *  - 포켓몬: regulationSpeedTable 이름 · modifiers speciesKo 가 사이트 GET /api/pokemon kr 에 없음
 *    (스피드표 묶음 이름 "펌킨인(대과종)" 등은 표시 전용이라 그대로 둠)
 *
 * 사이트 트래픽 보호: 응답을 scripts/.cache/smartnuo-*.json 에 저장하고 있으면 재사용 —
 * 최신으로 다시 대조하려면 캐시 파일을 지우고 실행. 런타임(확장) 호출은 추가하지 않음.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { koNamesDocs, koNamesForSmoke } = require('./lib/koNamesForSmoke');

const EXT = path.join(__dirname, '..', 'extension');
const CACHE_DIR = path.join(__dirname, '.cache');
const WRITE = process.argv.includes('--write');

function readExt(name) {
  return JSON.parse(fs.readFileSync(path.join(EXT, name), 'utf8'));
}

async function loadSite(apiPath, cacheName) {
  const file = path.join(CACHE_DIR, cacheName);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = await fetch('https://smartnuo.com/api/' + apiPath, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('smartnuo /api/' + apiPath + ' ' + res.status);
  const text = await res.text();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return JSON.parse(text);
}

// 사이트 en = 특성은 slug, 도구는 영문명("Wide Lens") → PokéAPI slug 모양으로
function toSlug(en) {
  return String(en || '').toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const normKo = (s) => String(s || '').replace(/\s+/g, '');

// resolve = names.item | names.ability (koNames.js), fb = 사이트 표기 문서 (--write 대상)
function auditKind(label, rows, modSection, resolve, fb, fbFile) {
  const out = { nameKoDiff: [], unresolved: [], wrongSlug: [] };
  for (const r of rows) {
    const slug = toSlug(r.en);
    const kr = normKo(r.kr);
    if (!slug || !kr || /custom/.test(slug)) continue; // 사이트 커스텀 항목(mega-sol-custom 등)은 우리 데이터 밖
    const mod = modSection[slug];
    if (mod && mod.nameKo && normKo(mod.nameKo) !== kr) out.nameKoDiff.push(slug + ': 우리 "' + mod.nameKo + '" / 사이트 "' + r.kr + '"');
    const got = resolve(kr) || null;
    if (got == null) out.unresolved.push([kr, slug]);
    else if (got !== slug) out.wrongSlug.push('"' + r.kr + '": 우리 ' + got + ' / 사이트 ' + slug);
  }
  console.log('\n== ' + label + ' (사이트 ' + rows.length + '행)');
  for (const k of Object.keys(out)) {
    console.log('-- ' + k + ' ' + out[k].length);
    out[k].forEach((l) => console.log('   ' + (Array.isArray(l) ? l[1] + ': 사이트 "' + l[0] + '"' : l)));
  }
  if (WRITE && out.unresolved.length) {
    out.unresolved.forEach(([kr, slug]) => (fb.byKo[kr] = slug));
    fb.version = (fb.version || 0) + 1;
    fs.writeFileSync(path.join(EXT, fbFile), JSON.stringify(fb, null, 2) + '\n', 'utf8');
    console.log('   → ' + fbFile + ' 에 ' + out.unresolved.length + '개 추가, version ' + fb.version);
  }
}

async function main() {
  const [abilities, items, pokemon] = await Promise.all([
    loadSite('ability?for=party', 'smartnuo-ability-party.json'),
    loadSite('equipment?for=party', 'smartnuo-equipment-party.json'),
    loadSite('pokemon', 'smartnuo-pokemon-dex.json'),
  ]);
  const docs = koNamesDocs();
  const ctx = { console };
  ctx.globalThis = ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'fmtCommon.js'), 'utf8'), ctx);
  const names = koNamesForSmoke(ctx, docs);
  const mod = docs.modifiers;

  auditKind('특성', abilities, mod.abilities, names.ability, docs.abilitySite, 'abilityKoFallback.json');
  auditKind('도구', items, mod.items, names.item, docs.itemSite, 'itemKoFallback.json');

  const siteKr = new Set(pokemon.map((p) => normKo(p.kr)));
  const ours = new Set();
  Object.values(readExt('regulationSpeedTable.json').bySpeed).forEach((names) => names.forEach((n) => ours.add(n)));
  ['items', 'abilities'].forEach((sec) =>
    Object.values(mod[sec]).forEach((e) => (e.speciesKo || []).forEach((n) => ours.add(n)))
  );
  const missing = [...ours].filter((n) => !siteKr.has(normKo(n)));
  console.log('\n== 포켓몬 (우리 ' + ours.size + '개 이름, 사이트 ' + pokemon.length + '행)');
  console.log('-- 사이트에 없는 이름 ' + missing.length);
  missing.forEach((n) => console.log('   ' + n));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
