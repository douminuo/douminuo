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
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'sampleLibrary.js'), 'utf8'), ctx);
const SL = ctx.nuoSlotRead;
const LIBP = ctx.nuoSampleLibrary._pure;

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
// 기술 칸 상세 — 2026-11-10 실측 네 모양 (고정 위력, 위력 변동 물리·특수, 글자만 침).
const mvs = { pokemon: { name: 'x', moves: [
  { name: { id: 'pound', name: 'Pound', kr: '막치기', type: 'Normal', base_power: 40, category: 'Physical' }, name_kr: '막치기', type: '노말', power: 40, damage_class: 'Physical' },
  { name: { id: 'gyroball', name: 'Gyro Ball', kr: '자이로볼', type: 'Steel', base_power: 0, category: 'Physical' }, name_kr: '자이로볼', type: '강철', power: 0, damage_class: 'Physical' },
  { name: { id: 'grassknot', name: 'Grass Knot', kr: '풀묶기', type: 'Grass', base_power: 0, category: 'Special' }, name_kr: '', type: '풀', power: 0, damage_class: 'Special' },
  { name: '사이코쇼크', name_kr: '', type: '', power: 0, damage_class: '' },
] } };
eq(SL.moveRow(mvs, 0), { id: 'pound', ko: '막치기', dc: 'physical', power: 40, typeEn: 'normal', typeKo: '노말' }, 'moveRow 고정 위력');
eq(SL.moveRow(mvs, 1), { id: 'gyroball', ko: '자이로볼', dc: 'physical', power: 0, typeEn: 'steel', typeKo: '강철' }, 'moveRow 위력 변동');
eq(SL.moveRow(mvs, 2), { id: 'grassknot', ko: '풀묶기', dc: 'special', power: 0, typeEn: 'grass', typeKo: '풀' }, 'moveRow name_kr 비면 name.kr');
eq(SL.moveRow(mvs, 3), { id: '사이코쇼크', ko: '사이코쇼크', dc: '', power: 0, typeEn: '', typeKo: '' }, 'moveRow 글자만 침');
eq([SL.moveRow(slot, 2), SL.moveRow(slot, 3), SL.moveRow({}, 0)], [null, null, null], 'moveRow 빈 칸');

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
// 허용 호스트 밖 https 는 버림 — <img> 요청이 PRIVACY §2 도메인 밖으로 나가지 않게 (2026-11-13).
eq(sp('https://evil.example/a.png'), '', 'sprite 다른 호스트 https');
eq(sp('//evil.example/a.png'), '', 'sprite 다른 호스트 //');
eq(sp('https://smartnuo.com/data/pokeapi-sprites/front/681.png'), 'https://smartnuo.com/data/pokeapi-sprites/front/681.png', 'sprite 스마트누오 절대주소');
// raw.githubusercontent 는 PokeAPI/sprites 저장소만 (보안 감사 10, 2026-11-14).
eq(sp('https://raw.githubusercontent.com/someone/repo/main/sprites/pokemon/1.png'), '', 'sprite raw 다른 저장소');

// 이미지 URL 판정 한 곳 (보안 감사 1·2): 저장 카드 일러스트·슬롯 캐시 그림도 같은 기준. 2.0.1 이하 저장분에 남은 다른 호스트도 그릴 때 버림.
const ART = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/730.png'; // 사이트 카드 실측 2026-11-14
eq(SL.imageUrl(ART), ART, 'imageUrl 사이트 카드 일러스트');
eq(SL.imageUrl('/data/pokeapi-sprites/front/681.png'), '/data/pokeapi-sprites/front/681.png', 'imageUrl 상대경로');
eq([SL.imageUrl('https://evil.example/official-artwork/1.png'), SL.imageUrl('javascript:alert(1)'), SL.imageUrl(null)], ['', '', ''], 'imageUrl 거름');
const cardHtml = LIBP.renderCard({ art: 'https://evil.example/official-artwork/1.png', slot: { pokemon: { name: { kr: 'a' } } } });
assert(cardHtml.indexOf('evil.example') === -1, 'renderCard 다른 호스트 art 버림');
assert(LIBP.renderCard({ art: ART, slot: { pokemon: { name: { kr: 'a' } } } }).indexOf(ART) !== -1, 'renderCard 사이트 art 유지');
const partyHtml = LIBP.renderPartyCard({ name: 'p', slots: [{ pokemon: { name: { kr: 'a' }, sprite: '/data/pokeapi-sprites/front/1.png' } }], arts: ['https://evil.example/x.png'] });
assert(partyHtml.indexOf('evil.example') === -1 && partyHtml.indexOf('/data/pokeapi-sprites/front/1.png') !== -1, 'renderPartyCard 다른 호스트 art → sprite 로 대체');

// 표시 라벨의 제어문자(줄바꿈 등) = 공백 하나 — 공유 링크로 들어온 이름이 복사 텍스트에 줄을 끼워 넣지 못하게 (보안 감사 3).
eq(SL.label('a\nhttps://evil.example/#ps=1'), 'a https://evil.example/#ps=1', 'label 줄바꿈');
eq(SL.label({ kr: ' a\r\n\tb\u0000 ' }), 'a b', 'label 제어문자 연속');

console.log('smoke-slot-read: ok');
