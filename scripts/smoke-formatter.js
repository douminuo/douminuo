'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const fmtCommonPath = path.join(root, 'extension', 'fmtCommon.js');
const formatterPath = path.join(root, 'extension', 'formatter.js');

const ctx = { globalThis: {}, self: {}, console };
ctx.globalThis = ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(fmtCommonPath, 'utf8'), ctx);
vm.runInContext(fs.readFileSync(formatterPath, 'utf8'), ctx);
const formatSample = ctx.formatSample;
const koNames = require('./lib/koNamesForSmoke').koNamesForSmoke(ctx);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const raw = [
  '#1|Test',
  'HP : 125 0',
  '공격 : 100 0',
  '방어 : 50 0',
  '특수공격 : 100 0',
  '특수방어 : 60 0',
  '스피드 : 100 0',
  '테라스탈 : 불꽃',
  '기술1 : Tackle',
  '기술2 : --',
  '기술3 : --',
  '기술4 : --',
].join('\n');

const out = formatSample(raw, {
  includeBulkStats: true,
  includeUrls: false,
  koNames,
});
const wantPhys = Math.floor((125 * 50) / 0.411);
const wantSpec = Math.floor((125 * 60) / 0.411);
assert(out.includes('물리내구력:' + wantPhys), 'phys bulk');
assert(out.includes('특수내구력:' + wantSpec), 'spec bulk');
const iTera = out.indexOf('테라스탈');
const iPhys = out.indexOf('물리내구력');
const iMove = out.indexOf('Tackle');
assert(iTera !== -1 && iPhys > iTera && iMove > iPhys, 'order: 테라스탈 → 내구력 → 기술');

const off = formatSample(raw, { includeBulkStats: false, includeUrls: false, koNames });
assert(!off.includes('물리내구력'), 'off switch');

const rawVest2 = [
  '#1|Test',
  '특성 : --',
  '도구 : 돌격조끼',
  '성격 : --',
  'HP : 100 0',
  '공격 : 100 0',
  '방어 : 80 0',
  '특수공격 : 100 0',
  '특수방어 : 80 0',
  '스피드 : 100 0',
  '기술1 : --',
  '기술2 : --',
  '기술3 : --',
  '기술4 : --',
].join('\n');

const vestOut = formatSample(rawVest2, {
  includeBulkStats: true,
  includeUrls: false,
  koNames,
});
const specBase = Math.floor((100 * 80) / 0.411);
const specBuff = Math.floor((100 * Math.floor(80 * 1.5)) / 0.411);
assert(
  vestOut.includes('물리내구력:' + Math.floor((100 * 80) / 0.411)),
  'vest phys same line'
);
assert(vestOut.includes('특수내구력:' + specBase + ' (' + specBuff + ')'), 'vest spec paren: ' + vestOut);

const rawKee = rawVest2.replace('돌격조끼', '악키열매');
const keeOut = formatSample(rawKee, {
  includeBulkStats: true,
  includeUrls: false,
  koNames,
});
const physBaseKee = Math.floor((100 * 80) / 0.411);
const physBuffKee = Math.floor((100 * Math.floor(80 * 1.5)) / 0.411);
assert(
  keeOut.includes('물리내구력:' + physBaseKee + ' (' + physBuffKee + ')'),
  'kee berry (악키열매) phys paren'
);

const rawFur = rawVest2.replace('특성 : --', '특성 : 퍼코트').replace('도구 : 돌격조끼', '도구 : --');
const furOut = formatSample(rawFur, {
  includeBulkStats: true,
  includeUrls: false,
  koNames,
});
const furPhysBase = Math.floor((100 * 80) / 0.411);
const furPhysBuff = Math.floor((100 * Math.floor(80 * 2)) / 0.411);
assert(
  furOut.includes('물리내구력:' + furPhysBase + ' (' + furPhysBuff + ')'),
  'fur-coat doubles phys bulk: ' + furOut
);
assert(furOut.includes('특수내구력:' + Math.floor((100 * 80) / 0.411)), 'fur-coat leaves spec line unbracketed');

const rawTablets = rawVest2.replace('특성 : --', '특성 : 재앙의목간');
const tabOut = formatSample(rawTablets, {
  includeBulkStats: true,
  includeUrls: false,
  koNames,
});
const tabPhysBase = Math.floor((100 * 80) / 0.411);
var tabB = Math.floor(80 * (4 / 3));
var tabPhysBuff = Math.floor((100 * tabB) / 0.411);
assert(
  tabOut.includes('물리내구력:' + tabPhysBase + ' (' + tabPhysBuff + ')'),
  'tablets-of-ruin phys ×4/3: ' + tabOut
);

const rawSand = rawVest2
  .replace('특성 : --', '특성 : 모래날림')
  .replace('도구 : 돌격조끼', '도구 : --');
const sandOut = formatSample(rawSand, {
  includeBulkStats: true,
  includeUrls: false,
  koNames,
  blockSpeciesTypes: [['rock', 'dark']],
});
const sandSpecBase = Math.floor((100 * 80) / 0.411);
const sandSpecBuff = Math.floor((100 * Math.floor(80 * 1.5)) / 0.411);
assert(
  sandOut.includes('특수내구력:' + sandSpecBase + ' (' + sandSpecBuff + ')'),
  'sand + rock: spec bulk ×1.5: ' + sandOut
);
assert(
  sandOut.includes('물리내구력:' + Math.floor((100 * 80) / 0.411)),
  'sand + rock: phys line unchanged'
);

const sandNoRockOut = formatSample(rawSand, {
  includeBulkStats: true,
  includeUrls: false,
  koNames,
  blockSpeciesTypes: [['dark', 'flying']],
});
assert(
  sandNoRockOut.indexOf('특수내구력:' + sandSpecBase + ' (') === -1,
  'sand without rock type: no spec paren'
);

const rawSnow = rawVest2.replace('특성 : --', '특성 : 눈퍼뜨리기');
const snowOut = formatSample(rawSnow, {
  includeBulkStats: true,
  includeUrls: false,
  koNames,
  blockSpeciesTypes: [['ice']],
});
const snowPhysBase = Math.floor((100 * 80) / 0.411);
const snowPhysBuff = Math.floor((100 * Math.floor(80 * 1.5)) / 0.411);
assert(
  snowOut.includes('물리내구력:' + snowPhysBase + ' (' + snowPhysBuff + ')'),
  'snow + ice: phys bulk ×1.5: ' + snowOut
);

// BACKLOG #2: 실능치 줄 — 기술배치상 안 쓰는 A/C 는 x.
var realRaw = [
  '#1|Test',
  'HP : 125 0',
  '공격 : 100 0',
  '방어 : 50 0',
  '특수공격 : 90 0',
  '특수방어 : 60 0',
  '스피드 : 80 0',
  '기술1 : Tackle',
  '기술2 : --',
  '기술3 : --',
  '기술4 : --',
].join('\n');
var physOnly = formatSample(realRaw, {
  includeRealStats: true,
  includeUrls: false,
  blockMovePowers: [[{ base: 1, buffed: 1, cls: 'physical' }, null, null, null]],
});
assert(physOnly.includes('125-100-50-x-60-80'), 'phys-only: C is x: ' + physOnly);

var mixed = formatSample(realRaw, {
  includeRealStats: true,
  includeUrls: false,
  blockMovePowers: [
    [
      { base: 1, buffed: 1, cls: 'physical' },
      { base: 2, buffed: 2, cls: 'special' },
      null,
      null,
    ],
  ],
});
assert(mixed.includes('125-100-50-90-60-80'), 'mixed: A and C numeric: ' + mixed);

var specOnly = formatSample(realRaw, {
  includeRealStats: true,
  includeUrls: false,
  blockMovePowers: [[{ base: 1, buffed: 1, cls: 'special' }, null, null, null]],
});
assert(specOnly.includes('125-x-50-90-60-80'), 'spec-only: A is x: ' + specOnly);

var noMp = formatSample(realRaw, { includeRealStats: true, includeUrls: false });
assert(noMp.includes('125-100-50-90-60-80'), 'no movePowers: all numeric: ' + noMp);

var unresolved = formatSample(realRaw, {
  includeRealStats: true,
  includeUrls: false,
  blockMovePowers: [[null, null, null, null]],
});
assert(unresolved.includes('125-100-50-90-60-80'), 'all-null cells: all numeric: ' + unresolved);

// 파동의방호: 조건부(접촉) 물리내구 ×2 — 인라인(excludeConditional)엔 미반영, 샘플 텍스트 경로엔 반영.
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

console.log('smoke-formatter: ok');
