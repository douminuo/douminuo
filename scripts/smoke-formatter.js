'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = { globalThis: {}, self: {}, console };
ctx.globalThis = ctx.self = ctx;
vm.createContext(ctx);
// 내구력은 슬롯 분석 입구(slotAnalysis) 경유 — SW analyzeSlot 과 같은 조립.
for (const f of ['slotRead.js', 'fmtCommon.js', 'formatter.js', 'simpleMovePower.js', 'attackerFormOverride.js', 'slotAnalysis.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'extension', f), 'utf8'), ctx, { filename: f });
}
const formatSlotsText = ctx.formatSlotsText;
const koNames = require('./lib/koNamesForSmoke').koNamesForSmoke(ctx);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** 사이트 모양 슬롯 (slotRead.js 머리 주석). reals = H A B C D S 실수치. */
function slot(p) {
  const keys = ['hp', 'attack', 'defense', 'special_attack', 'special_defense', 'speed'];
  const stats = {};
  keys.forEach((k, i) => { stats[k] = { value: (p.sp || [])[i] || 0, real: p.reals[i] }; });
  return {
    sample_name: p.sample || '',
    pokemon: {
      name: { kr: p.species || '테스트' }, name_kr: p.species || '테스트',
      ability: p.ability || '', equipment: p.item || '', personality: p.nature || '', terastal: p.tera || '',
      stats, moves: (p.moves || []).map((m) => ({ name_kr: m })),
    },
  };
}
const analyze = (s, types) => ctx.nuoSlotAnalysis.analyze(s, { names: koNames, moveTags: null, types: types || [] });
const bulkOf = (s, types) => analyze(s, types).bulk;
const inlineOf = (s, types) => analyze(s, types).bulkInline;
const q = (v) => Math.floor(v / 0.411);

// 요약 블록: 순서 = 제목 → 종 @도구 → 성격 / 특성 → SP → 테라 → 내구력 → 기술
const s1 = slot({ sample: 'Test', reals: [125, 100, 50, 100, 60, 100], sp: [0, 32, 0, 0, 0, 2], tera: '불꽃', moves: ['Tackle'] });
const out = formatSlotsText([s1], [{ bulk: bulkOf(s1) }], { includeBulkStats: true, includeUrls: false });
assert(out === ['Test', '테스트 @--', '-- / --', 'A32 S2', '테라스탈: 불꽃', '물리내구력:' + q(125 * 50), '특수내구력:' + q(125 * 60), 'Tackle / -- / -- / --'].join('\n'), 'summary block: ' + out);
assert(!formatSlotsText([s1], [{ bulk: bulkOf(s1) }], { includeBulkStats: false }).includes('물리내구력'), 'bulk off switch');

// 파티: #N 제목, 빈 칸 생략, URL 은 슬롯 번호 인덱스
const s2 = slot({ reals: [1, 1, 1, 1, 1, 1], species: '피카츄' });
const party = formatSlotsText([s1, {}, null, s2], [], {
  numberedTitle: true, partyUrl: 'P', sampleUrls: ['u1', '', '', 'u4'],
});
assert(party === 'P\n\nu1\n#1 | Test\n테스트 @--\n-- / --\nA32 S2\n테라스탈: 불꽃\nTackle / -- / -- / --\n\nu4\n#4\n피카츄 @--\n-- / --\n-- / -- / -- / --', 'party: ' + party);
assert(!formatSlotsText([s1, s2], [], { numberedTitle: true, partyUrl: 'P', sampleUrls: ['u1'], includeUrls: false }).includes('u1'), 'urls off');
// 단일: 샘플명 = 종명이면 제목 줄 생략
assert(formatSlotsText([slot({ sample: '피카츄', species: '피카츄', reals: [1, 1, 1, 1, 1, 1] })], [], {}).indexOf('피카츄 @') === 0, 'title = species omitted');

// 내구력 규칙 (방어 쪽 배율마다 floor, 괄호 = 버프)
const base = { reals: [100, 100, 80, 100, 80, 100] };
const vest = bulkOf(slot(Object.assign({ item: '돌격조끼' }, base)));
assert(ctx.formatBulkLinesFromComp(vest) === '물리내구력:' + q(8000) + '\n특수내구력:' + q(8000) + ' (' + q(100 * 120) + ')', 'vest: ' + JSON.stringify(vest));
assert(bulkOf(slot(Object.assign({ item: '악키열매' }, base))).physBuffed === q(100 * 120), 'kee berry phys ×1.5');
const fur = bulkOf(slot(Object.assign({ ability: '퍼코트' }, base)));
assert(fur.physBuffed === q(100 * 160) && fur.specBuffed === fur.specBase, 'fur coat: ' + JSON.stringify(fur));
assert(bulkOf(slot(Object.assign({ ability: '재앙의목간' }, base))).physBuffed === q(100 * Math.floor(80 * (4 / 3))), 'tablets ×4/3');
const sand = slot(Object.assign({ ability: '모래날림' }, base));
assert(bulkOf(sand, ['rock', 'dark']).specBuffed === q(100 * 120), 'sand + rock spec ×1.5');
assert(bulkOf(sand, ['dark', 'flying']).specBuffed === q(8000), 'sand without rock');
assert(bulkOf(slot(Object.assign({ ability: '눈퍼뜨리기' }, base)), ['ice']).physBuffed === q(100 * 120), 'snow + ice phys ×1.5');

// 사이트 실측 2026-11-13 (REA 2차). 진화의휘석 = 진화 전(name.nfe)만. 해피너스 54608, 럭키 73832.
const withNfe = (s, nfe) => { if (nfe !== undefined) s.pokemon.name.nfe = nfe; return s; };
const blissey = bulkOf(withNfe(slot({ item: '진화의휘석', reals: [362, 10, 62, 10, 187, 10] }), false));
assert(blissey.physBase === 54608 && blissey.physBuffed === 54608, 'eviolite final evo off: ' + JSON.stringify(blissey));
assert(bulkOf(withNfe(slot({ item: '진화의휘석', reals: [357, 10, 57, 10, 157, 10] }), true)).physBuffed === 73832, 'eviolite nfe on');
assert(bulkOf(slot({ item: '진화의휘석', reals: [357, 10, 57, 10, 157, 10] })).physBuffed === 73832, 'eviolite nfe unknown → applied');
// 테라셸: 멀티스케일처럼 복사는 괄호 ×2, 인라인은 제외 (테라파고스 202/162/162, 사이트 159240).
const tera = slot({ ability: '테라셸', reals: [202, 10, 162, 10, 162, 10] });
assert(bulkOf(tera).physBase === 79620 && bulkOf(tera).physBuffed === 159240 && bulkOf(tera).specBuffed === 159240, 'tera shell: ' + JSON.stringify(bulkOf(tera)));
assert(inlineOf(tera).physBuffed === 79620, 'tera shell inline excluded');

// 실능치 줄 — 기술배치상 안 쓰는 A/C 는 x.
const sr = slot({ reals: [125, 100, 50, 90, 60, 80], moves: ['Tackle'] });
const realLine = (mp) => formatSlotsText([sr], [{ movePowers: mp }], { includeRealStats: true }).split('\n')[2];
const P = { base: 1, buffed: 1, cls: 'physical' };
const S = { base: 2, buffed: 2, cls: 'special' };
assert(realLine([P, null, null, null]) === '125-100-50-x-60-80', 'phys-only');
assert(realLine([P, S, null, null]) === '125-100-50-90-60-80', 'mixed');
assert(realLine([S, null, null, null]) === '125-x-50-90-60-80', 'spec-only');
assert(realLine(undefined) === '125-100-50-90-60-80', 'no movePowers');
assert(realLine([null, null, null, null]) === '125-100-50-90-60-80', 'all-null cells');

// 파동의방호: 조건부(접촉) 물리내구 ×2 — 인라인(excludeConditional)엔 미반영, 복사 경로엔 반영.
const ag = slot({ ability: '파동의방호', reals: [100, 0, 100, 0, 100, 0] });
const agAll = bulkOf(ag);
assert(agAll.physBuffed === Math.floor((100 * 100 * 2) / 0.411) && agAll.specBuffed === agAll.specBase, '파동의방호 물리 ×2 (최종 S): ' + JSON.stringify(agAll));
const agInline = inlineOf(ag);
assert(agInline.physBuffed === agInline.physBase, '파동의방호 인라인 제외: ' + JSON.stringify(agInline));

// 사이트 durability: 방어 쪽 배율은 하나씩 floor, 멀티스케일 등(bulkFinal)은 최종 곱.
const r97 = (p) => slot(Object.assign({ reals: [100, 0, 97, 0, 97, 0] }, p));
const marvelVest = bulkOf(r97({ item: '돌격조끼', ability: '이상한비늘' }));
assert(marvelVest.physBuffed === Math.floor((100 * Math.floor(97 * 1.5)) / 0.411), '이상한비늘 방어 floor: ' + JSON.stringify(marvelVest));
assert(marvelVest.specBuffed === Math.floor((100 * Math.floor(97 * 1.5)) / 0.411), '돌격조끼 특방 floor: ' + JSON.stringify(marvelVest));
const ms = bulkOf(r97({ ability: '멀티스케일' }));
assert(ms.physBuffed === Math.floor((100 * 97 * 2) / 0.411), '멀티스케일 최종 S: ' + JSON.stringify(ms));
// 종 한정: 금속파우더 = 메타몽만 (결정력·내구력 같은 문맥 판정).
assert(bulkOf(r97({ item: '금속파우더', species: '메타몽' })).physBuffed === Math.floor((100 * 194) / 0.411), '금속파우더 메타몽');
const mpOther = bulkOf(r97({ item: '금속파우더', species: '피카츄' }));
assert(mpOther.physBuffed === mpOther.physBase, '금속파우더 다른 종 = 효과 없음');
// 샘플 이름에 종명이 들어가도 판정은 실제 종 기준.
const mpTitle = bulkOf(r97({ item: '금속파우더', species: '피카츄', sample: '메타몽 카운터' }));
assert(mpTitle.physBuffed === mpTitle.physBase, '금속파우더 샘플 이름에 메타몽 = 효과 없음');
// 회귀 점검 2.0.1 심해의비늘 (2026-11-10): 게임 규칙 = 진주몽 특방 ×2, 다른 종 효과 없음.
assert(bulkOf(r97({ item: '심해의비늘', species: '진주몽' })).specBuffed === Math.floor((100 * 194) / 0.411), '심해의비늘 진주몽 특방 ×2');
const dssOther = bulkOf(r97({ item: '심해의비늘', species: '피카츄' }));
assert(dssOther.specBuffed === dssOther.specBase && dssOther.specBase === Math.floor((100 * 97) / 0.411), '심해의비늘 다른 종 = 효과 없음');
// 회귀 점검 1.4.0 (사용자 결정): 인라인 내구력 = 멀티스케일·스펙터가드 제외, 복사(bulkOf) = 물리·특수 최종 ×2.
['멀티스케일', '스펙터가드'].forEach((ab) => {
  const inl = inlineOf(r97({ ability: ab }));
  assert(inl.physBuffed === inl.physBase && inl.specBuffed === inl.specBase, ab + ' 인라인 제외: ' + JSON.stringify(inl));
  const cp = bulkOf(r97({ ability: ab }));
  assert(cp.physBuffed === Math.floor((100 * 97 * 2) / 0.411) && cp.specBuffed === cp.physBuffed, ab + ' 복사 ×2: ' + JSON.stringify(cp));
});
// 탈: 벗겨진 뒤 HP 1/8 잃음 — 복사(버프)만, 인라인 제외.
const dgSlot = slot({ ability: '탈', reals: [131, 0, 100, 0, 100, 0] });
const dg = bulkOf(dgSlot);
assert(dg.physBuffed === Math.floor(((131 - 16) * 100) / 0.411) && dg.specBuffed === dg.physBuffed, '탈 HP 7/8: ' + JSON.stringify(dg));
const dgInline = inlineOf(dgSlot);
assert(dgInline.physBuffed === dgInline.physBase, '탈 인라인 제외: ' + JSON.stringify(dgInline));

// 초상투영 = 종명으로 폼 판정 (SW 통째 — 샘플 이름 "주춧돌 카운터" 인 우물 오거폰이 방어 ×1.5 로 속지 않게).
(async () => {
  const { loadSW, F } = require('./lib/swHarness');
  const sw = loadSW(path.join(root, 'extension'));
  const well = await sw.send({ type: 'ANNOTATE_BUILDER_SLOT', slotData: F.ogerpon_wellspring });
  assert(well.bulkText === '물리내구력:' + q(155 * 104) + '\n특수내구력:' + q(155 * 116) + ' (' + q(155 * Math.floor(116 * 1.5)) + ')', '초상투영 우물: ' + JSON.stringify(well.bulkText));
  assert(q(155 * Math.floor(116 * 1.5)) === 65620 && q(155 * 104) === 39221, '플랜 손계산 값');
  const corner = await sw.send({ type: 'ANNOTATE_BUILDER_SLOT', slotData: F.ogerpon_cornerstone });
  assert(corner.bulkText === '물리내구력:' + q(155 * 104) + ' (' + q(155 * Math.floor(104 * 1.5)) + ')\n특수내구력:' + q(155 * 116), '초상투영 주춧돌: ' + JSON.stringify(corner.bulkText));

  // --- 회귀 점검 (CHANGELOG 버그 수정, 2026-11-10) ---
  const { slot: siteSlot, stats, mv, EMPTY_MV } = require('./lib/swHarness');
  // 2.0.2 블레이드폼 실수치 (Lv50 아님) · 1.4.0 블레이드 기준·성격: 킬가르도 Lv100 고집 공격 SP 4.
  // 손계산 (SMARTNUO_RE_PLAN §2 computeRealNonHp): inner = floor((2×140 + 31) × 100/100) = 311,
  //   블레이드 공격 = floor((311 + 5 + 4) × 1.1) = 352 (옛 식 floor(316×1.1) + floor(4×1.1) = 347 + 4 = 351 — SP 32 는 두 식 모두 382 라 SP 4).
  // 아이언헤드 결정력 = floor(80 × 352 × 1.5 자속) = 42240 (옛 식이면 42120).
  const blade = siteSlot(3, {
    name: { id: 'aegislash', db_en: 'aegislash-shield', smogon_id: 'aegislash', name: 'Aegislash', kr: '킬가르도', types: ['Steel', 'Ghost'] },
    name_kr: '킬가르도', sprite: '', first_type: 'steel', second_type: 'ghost', level: 100,
    ability: '배틀스위치', personality: { name: '고집', up: '공격', down: '특공', display: '고집' },
    stats: stats([0, 4, 0, 0, 0, 0], [261, 154, 316, 122, 316, 156]),
    moves: [mv('ironhead', 'Iron Head', '아이언헤드', 'Steel', '강철', 80, 'Physical'), EMPTY_MV, EMPTY_MV, EMPTY_MV],
  });
  const bladeAnn = await sw.send({ type: 'ANNOTATE_BUILDER_SLOT', slotData: blade });
  assert(Math.floor(80 * 352 * 1.5) === 42240 && bladeAnn.movePowerSuffixes[0] === '(42240)', '블레이드 Lv100 고집 결정력: ' + JSON.stringify(bladeAnn.movePowerSuffixes));

  // 2.0.2 포톤가이저가 공격으로 계산될 때 공격 실능치 x: 게임 규칙 = 공격·특공 중 높은 쪽 → 공격 > 특공이면 공격을 씀 → 실능치 줄 공격 칸은 숫자, 특공 칸은 x.
  const necro = siteSlot(1, {
    name: { id: 'necrozma', db_en: 'necrozma', smogon_id: 'necrozma', name: 'Necrozma', kr: '네크로즈마', types: ['Psychic'] },
    name_kr: '네크로즈마', sprite: '', first_type: 'psychic',
    stats: stats([0, 32, 0, 0, 0, 0], [172, 159, 121, 147, 109, 99]),
    moves: [mv('photongeyser', 'Photon Geyser', '포톤가이저', 'Psychic', '에스퍼', 100, 'Special'), EMPTY_MV, EMPTY_MV, EMPTY_MV],
  });
  const pg = await sw.send({ type: 'FORMAT_BUILDER_SLOT', slotIndex: 1, slotData: necro, origin: 'https://smartnuo.com', pathname: '/party', formatOptions: { includeRealStats: true, includeUrls: false } });
  assert(pg.ok && pg.text.split('\n').indexOf('172-159-121-x-109-99') !== -1, '포톤가이저 공격 > 특공 실능치: ' + JSON.stringify(pg));
  console.log('smoke-formatter: ok');
})().catch((e) => { console.error(e); process.exit(1); });
