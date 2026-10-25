'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = { globalThis: {}, self: {}, console };
ctx.globalThis = ctx.self = ctx;
vm.createContext(ctx);
for (const f of ['slotRead.js', 'fmtCommon.js', 'formatter.js']) {
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
const realsOf = (s) => { const o = {}; 'HABCDS'.split('').forEach((L, i) => { o[L] = ctx.nuoSlotRead.stat(s, i).real; }); return o; };
const bulkOf = (s, types) => ctx.computeBulkPhysSpecBuffed(realsOf(s), koNames, ctx.nuoSlotRead.item(s), ctx.nuoSlotRead.ability(s), '', types || []);
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

// BACKLOG #2: 실능치 줄 — 기술배치상 안 쓰는 A/C 는 x.
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
const agReal = { H: 100, B: 100, D: 100 };
const agAll = ctx.computeBulkPhysSpecBuffed(agReal, koNames, '', '파동의방호', '', []);
assert(agAll.physBuffed === Math.floor((100 * 100 * 2) / 0.411) && agAll.specBuffed === agAll.specBase, '파동의방호 물리 ×2 (최종 S): ' + JSON.stringify(agAll));
const agInline = ctx.computeBulkPhysSpecBuffed(agReal, koNames, '', '파동의방호', '', [], { excludeConditionalAbilities: true });
assert(agInline.physBuffed === agInline.physBase, '파동의방호 인라인 제외: ' + JSON.stringify(agInline));

// 사이트 durability: 방어 쪽 배율은 하나씩 floor, 멀티스케일 등(bulkFinal)은 최종 곱.
const r97 = { H: 100, B: 97, D: 97 };
const marvelVest = ctx.computeBulkPhysSpecBuffed(r97, koNames, '돌격조끼', '이상한비늘', '', []);
assert(marvelVest.physBuffed === Math.floor((100 * Math.floor(97 * 1.5)) / 0.411), '이상한비늘 방어 floor: ' + JSON.stringify(marvelVest));
assert(marvelVest.specBuffed === Math.floor((100 * Math.floor(97 * 1.5)) / 0.411), '돌격조끼 특방 floor: ' + JSON.stringify(marvelVest));
const ms = ctx.computeBulkPhysSpecBuffed(r97, koNames, '', '멀티스케일', '', []);
assert(ms.physBuffed === Math.floor((100 * 97 * 2) / 0.411), '멀티스케일 최종 S: ' + JSON.stringify(ms));
// 종 한정: 금속파우더 = 메타몽만.
assert(ctx.computeBulkPhysSpecBuffed(r97, koNames, '금속파우더', '', '메타몽', []).physBuffed === Math.floor((100 * 194) / 0.411), '금속파우더 메타몽');
const mpOther = ctx.computeBulkPhysSpecBuffed(r97, koNames, '금속파우더', '', '피카츄', []);
assert(mpOther.physBuffed === mpOther.physBase, '금속파우더 다른 종 = 효과 없음');
// 샘플 제목에 종명이 들어가도 판정은 opts.speciesName (실제 종) 기준.
const mpTitle = ctx.computeBulkPhysSpecBuffed(r97, koNames, '금속파우더', '', '메타몽 카운터\n피카츄', [], { speciesName: '피카츄' });
assert(mpTitle.physBuffed === mpTitle.physBase, '금속파우더 제목에 메타몽 = 효과 없음');
// 탈: 벗겨진 뒤 HP 1/8 잃음 — 복사(버프)만, 인라인 제외.
const dg = ctx.computeBulkPhysSpecBuffed({ H: 131, B: 100, D: 100 }, koNames, '', '탈', '', []);
assert(dg.physBuffed === Math.floor(((131 - 16) * 100) / 0.411) && dg.specBuffed === dg.physBuffed, '탈 HP 7/8: ' + JSON.stringify(dg));
const dgInline = ctx.computeBulkPhysSpecBuffed({ H: 131, B: 100, D: 100 }, koNames, '', '탈', '', [], { excludeConditionalAbilities: true });
assert(dgInline.physBuffed === dgInline.physBase, '탈 인라인 제외: ' + JSON.stringify(dgInline));

console.log('smoke-formatter: ok');
