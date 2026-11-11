'use strict';

/**
 * extension/koNames.js smoke — 우선순위(사이트 표기 > modifiers > PokéAPI)·공백·영문 통과·규칙 조회.
 * (옛 fmtCommon 규칙 검색·기술 id 경로와의 동등성은 도입 시 전 키 비교로 확인 — 차이 0건, KO_NAMES_PLAN §4)
 *
 *   node scripts/smoke-ko-names.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { koNamesDocs, koNamesForSmoke } = require('./lib/koNamesForSmoke');

const ctx = { console };
ctx.globalThis = ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'fmtCommon.js'), 'utf8'), ctx);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const docs = koNamesDocs();
const N = koNamesForSmoke(ctx, docs);
assert(ctx.nuoKoNames.forDocs(docs) === N, '같은 docs = 같은 해석기');

// 우선순위: 사이트 표기가 PokéAPI 표기를 이김.
assert(N.item('대파') === 'leek', '대파 = leek (사이트), got ' + N.item('대파'));
assert(N.item('라이츄나이트X') === 'raichunite-x', '메가스톤 사이트 표기');
assert(N.item('검은오물') === 'black-sludge' && N.item('검은진흙') === 'black-sludge', '검은오물(사이트)·검은진흙(PokéAPI) 둘 다');
assert(N.ability('파수견') === 'guard-dog', '파수견');
// 공백 무시.
assert(N.ability('가시지 않는 향기') === 'lingering-aroma', '공백 있는 표기');
assert(N.item('큰말라사다') === N.item('큰 말라사다') && N.item('큰 말라사다'), 'PokéAPI 공백 키도 공백 없이 찾음');
// 객체·영문·slug.
assert(N.item({ en: 'Choice Band', kr: '구애머리띠' }) === 'choice-band', '{kr} 객체');
assert(N.item('Choice Band') === 'choice-band' && N.item('choice-band') === 'choice-band', '영문·slug 통과');
assert(N.item('Booster Energy') === 'booster-energy', 'modifiers 밖 영문도 slug 로');
assert(N.item('') === '' && N.item('--') === '' && N.item(null) === '' && N.item('없는도구이름') === '', '빈 값·모르는 한글 = 빈 문자열');
// 기술 = Showdown id.
assert(N.move('지진') === 'earthquake' && N.move('Earthquake') === 'earthquake' && N.move('fire-punch') === 'firepunch', '기술 id');
assert(N.move('드래곤 클로') === N.move('드래곤클로') && N.move('드래곤클로'), '기술 공백 무시');
// 규칙 조회.
assert(N.itemRule('생명의구슬').rule.finalDamageMul === 1.3, '생명의구슬 규칙');
assert(N.itemRule('생명의구슬').slug === 'life-orb', '규칙 slug');
assert(N.abilityRule('진홍빛고동') && N.abilityRule('진홍빛고동').slug === 'orichalcum-pulse', '진홍빛고동 규칙');
assert(N.itemRule('대파') === null, '규칙 없는 도구 = null');

// 사이트 표기 파일의 모든 항목은 그 slug 로 풀려야 함.
for (const [kind, f] of [['item', 'itemSite'], ['ability', 'abilitySite'], ['move', 'moveSite']]) {
  for (const [ko, slug] of Object.entries(docs[f].byKo)) assert(N[kind](ko) === slug, kind + ' 사이트 표기 ' + ko + ' → ' + N[kind](ko) + ' (want ' + slug + ')');
}
// modifiers 의 모든 slug·nameKo 는 자기 규칙으로 풀려야 함 (정규화 키 충돌 없음).
for (const [kind, sec] of [['itemRule', 'items'], ['abilityRule', 'abilities']]) {
  for (const [slug, rule] of Object.entries(docs.modifiers[sec])) {
    assert(N[kind](slug).slug === slug, sec + ' slug ' + slug);
    if (rule.nameKo) assert(N[kind](rule.nameKo).slug === slug, sec + ' nameKo ' + rule.nameKo + ' → ' + (N[kind](rule.nameKo) || {}).slug);
  }
}

// Showdown 복사 = 같은 해석기 (도구·특성·기술 영문).
for (const f of ['shareToRaw.js', 'showdownPaste.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', f), 'utf8'), ctx, { filename: f });
}
const readExt = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', f), 'utf8'));
const paste = (slot) =>
  ctx.buildShowdownPaste([slot], {
    koNames: N,
    moveSlugToEnDoc: readExt('moveSlugToEn.json'),
    natureKoDoc: readExt('natureKoMap.json'),
    typeKoDoc: readExt('typeKoMap.json'),
  });
const out = paste({ pokemon: { name: 'farfetchd', equipment: '대파', ability: '가시지않는향기', moves: [] } });
assert(out.indexOf('Farfetchd @ Leek') === 0 && out.indexOf('Ability: Lingering Aroma') > 0, 'Showdown 도구·특성: ' + out);
const outMoves = paste({ pokemon: { name: 'garchomp', equipment: '라이츄나이트X', moves: [{ name_kr: '지진' }, { name_kr: '드래곤클로' }, { name_kr: '모르는기술' }] } });
assert(/@ Raichunite X/.test(outMoves) && /- Earthquake/.test(outMoves) && /- Dragon Claw/.test(outMoves) && /- 모르는기술/.test(outMoves), 'Showdown 기술: ' + outMoves);
// 종 이름 = 사이트 도감 행의 Showdown 이름(name.name) 우선 — db_en 대문자화는 'Indeedee-Female' 처럼 안 풀림
const outSd = paste({ pokemon: { name: { db_en: 'indeedee-female', name: 'Indeedee-F', kr: '에써르' }, moves: [] } });
assert(outSd.indexOf('Indeedee-F') === 0, 'Showdown 종 이름: ' + outSd);

// --- 회귀 점검 (CHANGELOG 버그 수정, 2026-11-10) ---
// 2.0.1 Showdown 노력치 = 챔스 SP 그대로 (showdownPaste.js §4.3 — Showdown champions 모드 EVs 줄 = SP, 2026-10-23 확인).
const spStats = {};
['hp', 'attack', 'defense', 'special_attack', 'special_defense', 'speed'].forEach((k, i) => { spStats[k] = { value: [2, 32, 0, 0, 0, 32][i] }; });
const outEv = paste({ pokemon: { name: 'garchomp', stats: spStats, moves: [] } });
assert(outEv.split('\n').indexOf('EVs: 2 HP / 32 Atk / 32 Spe') !== -1, 'Showdown EVs = SP: ' + outEv);

// moveTags.json 은 generate-move-tags.js 재생성물 — 챔스 보정이 빠지면 여기서 잡힘. 기술 id 는 한글 → koNames.
// 2.0.1 번개엄니·얼음엄니·불꽃엄니·3연화살 = 우격다짐 대상 (게임 규칙: 부가효과 있음), 2.0.0 드래곤옐 = 소리, 프리즈드라이 = 우격다짐 제외 (챔스 변경).
const MT = readExt('moveTags.json').moves;
for (const ko of ['번개엄니', '얼음엄니', '불꽃엄니', '3연화살']) assert(MT[N.move(ko)] && MT[N.move(ko)].sheerForceEligible === true, ko + ' 우격다짐: ' + N.move(ko));
assert(MT[N.move('드래곤옐')] && MT[N.move('드래곤옐')].sound === true, '드래곤옐 소리');
assert(MT[N.move('프리즈드라이')] && !MT[N.move('프리즈드라이')].sheerForceEligible, '프리즈드라이 우격다짐 제외');

// 1.5.0 보르그 표기: 스피드표 임베드 데이터에 '보르그' 있고 옛 표기 '보르쥐' 없음.
const rs = { globalThis: null };
rs.globalThis = rs;
vm.createContext(rs);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'regulationSpeedData.js'), 'utf8'), rs);
const rsText = JSON.stringify(rs.NUO_REGULATION_SPEED);
assert(rsText.indexOf('보르그') !== -1 && rsText.indexOf('보르쥐') === -1, '보르그 표기');

console.log('smoke-ko-names: ok');
