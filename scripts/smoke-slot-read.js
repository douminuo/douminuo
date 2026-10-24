'use strict';

/**
 * extension/slotRead.js smoke — 사이트 슬롯 모양(2026-10-24 실측, ARCH_REVIEW_PLAN 후보 2 §0) 읽기.
 *
 *   node scripts/smoke-slot-read.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { console, URL };
ctx.globalThis = ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'slotRead.js'), 'utf8'), ctx);
const SL = ctx.nuoSlotRead;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const eq = (got, want, msg) => assert(JSON.stringify(got) === JSON.stringify(want), msg + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

const EMPTY_MV = { name: '', name_kr: '', type: '', power: '', damage_class: '' };
const slot = {
  slot_display: '#2', sample_name: ' 배북 ', sp_used: 66, sp_total: 66,
  pokemon: {
    name: { id: 'aegislash', db_en: 'aegislash-shield', smogon_id: 'aegislash', name: 'Aegislash', kr: '킬가르도', types: ['Steel', 'Ghost'] },
    name_kr: '', sprite: '/data/pokeapi-sprites/front/681.png', first_type: 'steel', level: 50,
    personality: { name: '조심', up: '특방', down: '특공', display: '조심' }, terastal: '물',
    ability: '배틀스위치', equipment: { en: 'Leftovers', kr: '' },
    stats: { hp: { value: 32, real: 167 }, attack: { value: '', real: 70, individual_value: 0 }, speed: { value: 2, real: 81 } },
    moves: [{ name: { id: 'shadowball', name: 'Shadow Ball', kr: '섀도볼' }, name_kr: '', type: '고스트', power: 80, damage_class: 'Special' }, { name: '', name_kr: '킹실드' }, EMPTY_MV],
  },
};

// 라벨: kr → name_kr → name → en, 빈 값은 건너뜀.
eq(SL.label({ en: 'Choice Band', kr: '구애머리띠' }), '구애머리띠', 'label kr');
eq(SL.label({ en: 'Leftovers', kr: '' }), 'Leftovers', 'label kr 비면 en');
eq(SL.label({ name: { kr: '니드킹', name: 'Nidoking' } }), '니드킹', 'label name 재귀');
eq(SL.label(' 우격다짐 '), '우격다짐', 'label trim');
eq(SL.label(7), '7', 'label number');
eq(SL.label([1]), '', 'label array');

// 비어 있음 = pokemon.name.
eq([null, {}, { slot_display: '#5', pokemon: { name: '', name_kr: '' } }, slot].map(SL.isEmpty), [true, true, true, false], 'isEmpty');
eq(SL.filledFlags([slot, null, {}]), [true, false, false, false, false, false], 'filledFlags');
eq(SL.filledFlags(null), [false, false, false, false, false, false], 'filledFlags null');

// 필드.
eq(SL.speciesKo(slot), '킬가르도', 'speciesKo name_kr 비면 name.kr');
eq(SL.speciesSlug(slot), 'aegislash-shield', 'speciesSlug db_en (하이픈 보존)');
eq(SL.speciesSlug({ pokemon: { name: 'Mr-Mime' } }), 'mr-mime', 'speciesSlug 문자열');
eq(SL.speciesSlug({ pokemon: { name: '니드킹' } }), '', 'speciesSlug 한글 = 없음');
eq(SL.sampleName(slot), '배북', 'sampleName');
eq([SL.item(slot), SL.ability(slot), SL.nature(slot), SL.tera(slot)], ['Leftovers', '배틀스위치', '조심', '물'], 'item/ability/nature/tera');
eq(SL.moves(slot), ['섀도볼', '킹실드', '', ''], 'moves');
eq(SL.stat(slot, 1), { sp: 0, real: 70, iv: 0 }, 'stat attack');
eq(SL.stat(slot, 3), { sp: 0, real: 0, iv: 31 }, 'stat 없음');
eq(SL.spSix(slot), [32, 0, 0, 0, 0, 2], 'spSix');
eq(SL.level(slot), 50, 'level');
eq([SL.item(null), SL.moves({}), SL.level({})], ['', ['', '', '', ''], null], '빈 칸 기본값');

// 스프라이트: 허용 호스트 정규화, 상대경로·https 원문, 그 밖은 ''.
const sp = (u) => SL.sprite({ pokemon: { name: 'x', sprite: u } });
eq(sp('/data/pokeapi-sprites/front/681.png'), '/data/pokeapi-sprites/front/681.png', 'sprite 사이트 상대경로');
eq(sp('//smartnuo.com/upload/sprite/681.png'), 'https://smartnuo.com/upload/sprite/681.png', 'sprite // 스마트누오');
eq(sp('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/184.png'), 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/184.png', 'sprite PokéAPI');
eq(sp('javascript:alert(1)'), '', 'sprite javascript:');
eq(sp('data:image/png;base64,AAAA'), '', 'sprite data:');
eq(sp(''), '', 'sprite 빈 값');

console.log('smoke-slot-read: ok');
