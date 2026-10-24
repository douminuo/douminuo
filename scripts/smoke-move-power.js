'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const fmtCommonPath = path.join(root, 'extension', 'fmtCommon.js');
const shareToRawPath = path.join(root, 'extension', 'shareToRaw.js');
const simplePath = path.join(root, 'extension', 'simpleMovePower.js');
const moveTags = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'moveTags.json'), 'utf8'));
const { koNamesForSmoke } = require('./lib/koNamesForSmoke');

const ctx = { globalThis: {}, self: {}, console };
ctx.globalThis = ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'extension', 'slotRead.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(fmtCommonPath, 'utf8'), ctx);
vm.runInContext(fs.readFileSync(shareToRawPath, 'utf8'), ctx);
vm.runInContext(fs.readFileSync(simplePath, 'utf8'), ctx);
const SMP = ctx.simpleMovePower;
const names = koNamesForSmoke(ctx);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 픽스처는 짧게 slot.ability·slot.equipment 로 씀 → 사이트 모양(pokemon 안, name 필수)으로 옮겨 넘김.
function cmp(slot, types) {
  const p = Object.assign({ name: 'smoke' }, slot.pokemon);
  if (slot.ability !== undefined) p.ability = slot.ability;
  if (slot.equipment !== undefined) p.equipment = slot.equipment;
  return SMP.computeMovePowers({ pokemon: p }, types, names, moveTags);
}

const firePunch = {
  name: 'Fire Punch',
  power: '75',
  damage_class: 'physical',
  type: 'Fire',
};
const slot = {
  pokemon: {
    moves: [firePunch],
    stats: {
      attack: { real: 100 },
      special_attack: { real: 100 },
    },
  },
  ability: { name: 'Tough Claws' },
};

const row = cmp(slot, ['fire']);
// 사이트 결정력 구조: floor(위력 u[배율마다 floor] × 실수치 l × 최종 d).
const wantTough = Math.floor(Math.floor(75 * 1.3) * 100 * 1.5);
assert(row[0].buffed === wantTough, 'tough claws buffed: got ' + row[0].buffed + ' want ' + wantTough);
assert(row[0].base === row[0].buffed, 'tough claws base equals buffed');
assert(row[0].cls === 'physical', 'fire punch cls is physical');

const sheer = cmp(Object.assign({}, slot, { ability: { name: 'Sheer Force' } }), ['fire']);
const wantSheer = Math.floor(Math.floor(75 * 1.3) * 100 * 1.5);
assert(sheer[0].buffed === wantSheer, 'sheer force buffed');
assert(sheer[0].base === sheer[0].buffed, 'sheer base equals buffed');

// 부가효과 여러 개(`secondaries: [...]`) 기술도 우격다짐 대상 — 불꽃엄니.
const fireFang = { name: 'fire-fang', power: '65', damage_class: 'physical', type: 'Fire' };
const sheerFang = cmp({ pokemon: { moves: [fireFang], stats: { attack: { real: 100 } } }, ability: { name: 'Sheer Force' } }, ['fire']);
assert(sheerFang[0].buffed === Math.floor(Math.floor(65 * 1.3) * 100 * 1.5), 'sheer force + fire fang (secondaries[]): got ' + sheerFang[0].buffed);

const firePunchKo = {
  name_kr: '불꽃펀치',
  power: '75',
  damage_class: 'physical',
  type: 'Fire',
};
const koRow = cmp(
  {
    pokemon: {
      moves: [firePunchKo],
      stats: { attack: { real: 100 }, special_attack: { real: 100 } },
    },
    ability: { name: 'Tough Claws' },
  },
  ['fire']
);
assert(koRow[0].buffed === wantTough, 'tough claws + Korean move name');

// 스마트누오 표기 한글명만 있는 기술 (moveKoFallback) → moveTags 태그 적용.
function koOnly(nameKr, power, dc, type, ability) {
  return cmp(
    {
      pokemon: {
        moves: [{ name_kr: nameKr, power: power, damage_class: dc, type: type }],
        stats: { attack: { real: 100 }, special_attack: { real: 100 } },
      },
      ability: { name: ability },
    },
    ['normal']
  )[0];
}
assert(koOnly('암석액스', '65', 'physical', 'Rock', 'Sharpness').buffed === Math.floor(65 * 1.5) * 100, 'sharpness + 암석액스 (site ko)');
assert(koOnly('에어커터', '60', 'special', 'Flying', 'Sharpness').buffed === Math.round(60 * 1.5) * 100, 'sharpness + 에어커터 (site ko)');
assert(koOnly('맹독엄니', '50', 'physical', 'Poison', 'Strong Jaw').buffed === Math.round(50 * 1.5) * 100, 'strong jaw + 맹독엄니 (site ko)');
assert(koOnly('드래곤클로', '80', 'physical', 'Dragon', 'Tough Claws').buffed === Math.round(80 * 1.3) * 100, 'tough claws + 드래곤클로 (site ko)');

const bullet = {
  name: 'Bullet Punch',
  power: '40',
  damage_class: 'physical',
  type: 'Steel',
};
const techSlot = {
  pokemon: {
    moves: [bullet],
    stats: { attack: { real: 100 }, special_attack: { real: 100 } },
  },
  ability: { name: 'Technician' },
};
const techRow = cmp(techSlot, ['steel']);
const techWant = Math.floor(Math.floor(40 * 1.5) * 100 * 1.5);
assert(techRow[0].buffed === techWant, 'technician');
assert(techRow[0].base === techRow[0].buffed, 'technician no split');

const wild = {
  name: 'Wild Charge',
  power: '90',
  damage_class: 'physical',
  type: 'Electric',
};
const rec = {
  pokemon: {
    moves: [wild],
    stats: { attack: { real: 100 }, special_attack: { real: 100 } },
  },
  ability: { name: 'Reckless' },
};
const recRow = cmp(rec, ['electric']);
const wantRec = Math.floor(Math.floor(90 * 1.2) * 100 * 1.5);
assert(recRow[0].buffed === wantRec, 'reckless');
assert(recRow[0].base === recRow[0].buffed, 'reckless no split');

const ft = {
  name: 'Flamethrower',
  power: '90',
  damage_class: 'special',
  type: 'Fire',
};
const droughtSlot = {
  pokemon: {
    moves: [ft],
    stats: { attack: { real: 100 }, special_attack: { real: 100 } },
  },
  ability: { name: 'Drought' },
};
const dr = cmp(droughtSlot, ['fire']);
const wantDroughtBuffed = Math.floor(90 * 100 * (1.5 * 1.5));
const wantDroughtBase = Math.floor(90 * 100 * 1.5);
assert(dr[0].buffed === wantDroughtBuffed, 'drought buffed');
assert(dr[0].base === wantDroughtBase, 'drought base without sun mul: got ' + dr[0].base + ' want ' + wantDroughtBase);
assert(dr[0].base < dr[0].buffed, 'drought base < buffed');
assert(dr[0].cls === 'special', 'flamethrower cls is special');

const tb = {
  name: 'Thunderbolt',
  power: '90',
  damage_class: 'special',
  type: 'Electric',
};
const surgeSlot = {
  pokemon: {
    moves: [tb],
    stats: { attack: { real: 100 }, special_attack: { real: 100 } },
  },
  ability: { name: 'Electric Surge' },
};
const sur = cmp(surgeSlot, ['electric']);
const wantSurgeBuffed = Math.floor(90 * 100 * (1.5 * 1.3));
const wantSurgeBase = Math.floor(90 * 100 * 1.5);
assert(sur[0].buffed === wantSurgeBuffed, 'electric surge buffed');
assert(sur[0].base === wantSurgeBase, 'electric surge base');
assert(sur[0].base < sur[0].buffed, 'surge split');

const tackle = {
  name: 'Tackle',
  power: '40',
  damage_class: 'physical',
  type: 'Normal',
};
const normSlot = {
  pokemon: {
    moves: [tackle],
    stats: { attack: { real: 100 }, special_attack: { real: 100 } },
  },
  ability: { name: 'Normalize' },
};
const normRow = cmp(normSlot, ['normal']);
const normWant = Math.floor(Math.floor(40 * 1.2) * 100 * 1.5);
assert(normRow[0].buffed === normWant, 'normalize');
assert(normRow[0].base === normRow[0].buffed, 'normalize no split');

const pbSlot = {
  pokemon: {
    moves: [firePunch],
    stats: { attack: { real: 100 }, special_attack: { real: 100 } },
  },
  ability: { name: 'Parental Bond' },
};
const pbRow = cmp(pbSlot, ['fire']);
// 부자유친 = 사이트 L + pokeRound(L, 0.25): 11250 + 2812.
const pbWant = 11250 + 2812;
assert(pbRow[0].buffed === pbWant, 'parental bond');
assert(pbRow[0].base === pbRow[0].buffed, 'parental bond no conditional split');

const rockHeadSlot = {
  pokemon: {
    moves: [
      {
        name: 'Double-Edge',
        power: '120',
        damage_class: 'physical',
        type: 'Normal',
      },
    ],
    stats: { attack: { real: 100 }, special_attack: { real: 100 } },
  },
  ability: { name: 'Rock Head' },
};
const rh = cmp(rockHeadSlot, ['normal']);
assert(rh[0].base === rh[0].buffed, 'rock head single display cell');

const tackleRuin = {
  name: 'Tackle',
  power: '40',
  damage_class: 'physical',
  type: 'Normal',
};
const swordSlot = {
  pokemon: {
    moves: [tackleRuin],
    stats: { attack: { real: 100 }, special_attack: { real: 100 } },
  },
  ability: { name: 'Sword of Ruin' },
};
const sw = cmp(swordSlot, ['normal']);
const swordWant = Math.floor(40 * 100 * (1.5 * (4 / 3)));
assert(sw[0].buffed === swordWant, 'sword of ruin ×4/3 phys: got ' + sw[0].buffed + ' want ' + swordWant);
assert(sw[0].base === sw[0].buffed, 'sword ruin no base split');

const beadsSlot = {
  pokemon: {
    moves: [ft],
    stats: { attack: { real: 100 }, special_attack: { real: 100 } },
  },
  ability: { name: 'Beads of Ruin' },
};
const bd = cmp(beadsSlot, ['fire']);
const beadsWant = Math.floor(90 * 100 * (1.5 * (4 / 3)));
assert(bd[0].buffed === beadsWant, 'beads of ruin ×4/3 spec');
assert(bd[0].base === bd[0].buffed, 'beads ruin no base split');

// 무조건 급소 — 예: 트릭플라워(flowertrick). moveTags 에 alwaysCrit 있어야 함.
const flowerTrick = { name: 'Flower Trick', type: 'Grass', power: 70, damage_class: 'physical' };
const critRow = cmp({ pokemon: { moves: [flowerTrick], stats: { attack: { real: 100 }, special_attack: { real: 100 }, defense: { real: 100 } } } }, ['normal']);
const wantCrit = Math.floor(70 * 100 * 1.5);
assert(critRow[0].base === wantCrit, '트릭플라워 무조건 급소: base got ' + critRow[0].base + ' want ' + wantCrit);
assert(critRow[0].base === critRow[0].buffed, '무조건 급소: base === buffed(조건부 아님)');

// 변환자재/리베로 — 타입 안 맞는 기술도 buffed 에서는 자속.
const waterGun = { name: 'Water Gun', type: 'Water', power: 40, damage_class: 'special' };
const proteanSlot = { pokemon: { moves: [waterGun], stats: { attack: { real: 100 }, special_attack: { real: 100 }, defense: { real: 100 } } }, ability: { name: 'Protean' } };
const proteanRow = cmp(proteanSlot, ['normal']); // 자연 타입 = 노말(물 아님) → 자연 STAB 없음
const wantProteanBase = 40 * 100;
const wantProteanBuffed = Math.floor(40 * 100 * 1.5);
assert(proteanRow[0].base === wantProteanBase, '변환자재 base(자속 없음): got ' + proteanRow[0].base);
assert(proteanRow[0].buffed === wantProteanBuffed, '변환자재 buffed(자속 반영): got ' + proteanRow[0].buffed);

// 변환자재인데 이미 자연 STAB 인 경우 — 중복 곱 안 되는지.
const proteanNaturalStab = cmp(proteanSlot, ['water']);
assert(proteanNaturalStab[0].base === proteanNaturalStab[0].buffed, '변환자재 + 자연 STAB: base === buffed(중복 곱 없음)');

// 챔피언스 재분류 (moveTags.json champions mod overlay) — 사이트 슬롯 기술 모양(name=영문 slug + name_kr).
const stats100 = { attack: { real: 100 }, special_attack: { real: 100 } };
const dragonClawKo = { name: 'dragon-claw', name_kr: '드래곤클로', power: '80', damage_class: 'physical', type: 'Dragon' };
const sharpRow = cmp({ pokemon: { moves: [dragonClawKo], stats: stats100 }, ability: { name: 'Sharpness' } }, ['dragon']);
const wantSharp = Math.floor(Math.floor(80 * 1.5) * 100 * 1.5);
assert(sharpRow[0].buffed === wantSharp, '예리함 + 드래곤클로(챔스 slicing): got ' + sharpRow[0].buffed + ' want ' + wantSharp);

const doubleShockKo = { name: 'double-shock', name_kr: '전광쌍격', power: '120', damage_class: 'physical', type: 'Electric' };
const fistRow = cmp({ pokemon: { moves: [doubleShockKo], stats: stats100 }, ability: { name: 'Iron Fist' } }, ['electric']);
const wantFist = Math.floor(Math.floor(120 * 1.2) * 100 * 1.5);
assert(fistRow[0].buffed === wantFist, '철주먹 + 전광쌍격(챔스 punch): got ' + fistRow[0].buffed + ' want ' + wantFist);

// 챔피언스 신규 메가 특성 (사이트 한글명으로 매칭).
const ft2 = { name: 'flamethrower', power: '90', damage_class: 'special', type: 'Fire' };
const megaSol = cmp({ pokemon: { moves: [ft2], stats: stats100 }, ability: '메가솔라' }, ['grass']);
assert(megaSol[0].base === Math.floor(90 * 100 * 1.5), '메가솔라 쾌청 base 반영: got ' + megaSol[0].base);
assert(megaSol[0].base === megaSol[0].buffed, '메가솔라 조건부 아님');

const weatherBall = { name: 'weather-ball', power: '50', damage_class: 'special', type: 'Normal' };
const megaSolWb = cmp({ pokemon: { moves: [weatherBall], stats: stats100 }, ability: '메가솔라' }, ['grass']);
assert(megaSolWb[0].base === Math.floor(100 * 100 * 1.5), '메가솔라 웨더볼 = 불꽃 100 × 쾌청: got ' + megaSolWb[0].base);
assert(megaSolWb[0].base === megaSolWb[0].buffed, '메가솔라 웨더볼 조건부 아님');

// 웨더볼·대지의파동: 특성 날씨/필드 따라감 — base = 원래(노말 50), buffed = 날씨/필드 타입 100.
const wbCase = (ab, types) => cmp({ pokemon: { moves: [weatherBall], stats: stats100 }, ability: ab }, types)[0];
const wbDrizzle = wbCase('잔비', ['water']);
assert(wbDrizzle.base === 50 * 100, '잔비 웨더볼 base 노말 50: got ' + wbDrizzle.base);
assert(wbDrizzle.buffed === Math.floor(100 * 100 * (1.5 * 1.5)), '잔비 웨더볼 buffed 물 100×비×자속: got ' + wbDrizzle.buffed);
const wbChloro = wbCase('엽록소', ['grass']);
assert(wbChloro.buffed === Math.floor(100 * 100 * 1.5) && wbChloro.base === 5000, '엽록소 웨더볼 쾌청: ' + JSON.stringify(wbChloro));
const wbSolar = wbCase('선파워', ['fire']);
assert(wbSolar.buffed === Math.floor(100 * Math.floor(100 * 1.5) * (1.5 * 1.5)), '선파워 웨더볼 쾌청+특공: ' + JSON.stringify(wbSolar));
const wbSand = wbCase('모래날림', ['rock']);
assert(wbSand.buffed === Math.floor(100 * 100 * 1.5), '모래날림 웨더볼 바위 100 자속: ' + JSON.stringify(wbSand));
const wbNone = wbCase('철주먹', ['normal']);
assert(wbNone.base === wbNone.buffed && wbNone.base === Math.floor(50 * 100 * 1.5), '무관 특성 웨더볼 노말: ' + JSON.stringify(wbNone));
const wbDelta = wbCase('델타스트림', ['dragon']);
assert(wbDelta.buffed === 50 * 100, '델타스트림 웨더볼 노말 그대로: ' + JSON.stringify(wbDelta));
const ffOnly = cmp({ pokemon: { moves: [ft2], stats: stats100 }, ability: '엽록소' }, ['grass'])[0];
assert(ffOnly.base === ffOnly.buffed, '엽록소는 웨더볼 외 기술 영향 없음');

const terrainPulse = { name: 'terrain-pulse', power: '50', damage_class: 'special', type: 'Normal' };
const tp = cmp({ pokemon: { moves: [terrainPulse], stats: stats100 }, ability: '일렉트릭메이커' }, ['electric'])[0];
assert(tp.base === 50 * 100, '일렉트릭메이커 대지의파동 base 노말: ' + JSON.stringify(tp));
assert(tp.buffed === Math.floor(100 * 100 * (1.5 * 1.3)), '일렉트릭메이커 대지의파동 전기 100×필드×자속: ' + JSON.stringify(tp));

const moonblast = { name: 'moonblast', power: '95', damage_class: 'special', type: 'Fairy' };
const misty = cmp({ pokemon: { moves: [moonblast, terrainPulse], stats: stats100 }, ability: '미스트메이커' }, ['fairy']);
assert(misty[0].base === misty[0].buffed, '미스트필드는 페어리 위력 보정 없음: ' + JSON.stringify(misty[0]));
assert(misty[1].buffed === Math.floor(100 * 100 * 1.5), '미스트메이커 대지의파동 = 페어리 100 자속, 필드 보정 없음: ' + JSON.stringify(misty[1]));

const fireMane = cmp({ pokemon: { moves: [ft2], stats: stats100 }, ability: '불꽃의갈기' }, ['fire']);
assert(fireMane[0].buffed === Math.floor(Math.floor(90 * 1.5) * 100 * 1.5), '불꽃의갈기: got ' + fireMane[0].buffed);

const hyperVoice = { name: 'hyper-voice', power: '90', damage_class: 'special', type: 'Normal' };
const dragonize = cmp({ pokemon: { moves: [hyperVoice], stats: stats100 }, ability: '드래곤스킨' }, ['water', 'dragon']);
assert(dragonize[0].buffed === Math.floor(Math.floor(90 * 1.2) * 100 * 1.5), '드래곤스킨(드래곤 자속): got ' + dragonize[0].buffed);

// 사이트 계산창 실측 (2026-10-23): 실수치 = Lv50 SP32 무보정.
const one = (mv, atk, ab, types, extra) =>
  cmp(Object.assign({ pokemon: { moves: [mv], stats: { attack: { real: atk }, special_attack: { real: atk } } }, ability: ab }, extra || {}), types)[0];
assert(one(fireFang, 154, '우격다짐', ['poison', 'ground']).buffed === 12936, '니드킹 우격다짐 불꽃엄니 = 사이트 12936');
const flareBlitz = { name: 'flare-blitz', power: '120', damage_class: 'physical', type: 'Fire' };
assert(one(flareBlitz, 136, '이판사판', ['fire', 'flying']).buffed === 29376, '리자몽 이판사판 플레어드라이브 = 사이트 29376');
const icicleSpear = { name: 'icicle-spear', power: '25', damage_class: 'physical', type: 'Ice' };
assert(one(icicleSpear, 147, '', ['water', 'ice']).buffed === 27560, '파르셀 고드름침 5타 = 사이트 27560');

// 트리플악셀 = 단계 합 (20·40·60 각각 floor).
const tripleAxel = { name: 'triple-axel', power: '20', damage_class: 'physical', type: 'Ice' };
assert(one(tripleAxel, 100, '', ['ice']).buffed === 3000 + 6000 + 9000, '트리플악셀 단계 합');
// 부자유친은 연속기엔 미적용.
assert(one(icicleSpear, 100, '부자유친', ['normal']).buffed === 2500 * 5, '부자유친 + 연속기 = 타수만');

// 진홍빛고동: 쾌청 → buffed 만 공격 ×4/3 실수치 floor.
const oriA = one(flareBlitz, 100, '진홍빛고동', ['fighting']);
assert(oriA.base === 12000 && oriA.buffed === Math.floor(120 * 133 * 1.5), '진홍빛고동: ' + JSON.stringify(oriA));

// 플레이트·주얼 (최종 d), 종 한정 도구 (실수치 ×2).
assert(one(flareBlitz, 100, '', ['normal'], { equipment: '불구슬플레이트' }).buffed === Math.floor(120 * 100 * 1.2), '불구슬플레이트');
assert(one(flareBlitz, 100, '', ['normal'], { equipment: '불꽃주얼' }).buffed === Math.floor(120 * 100 * 1.3), '불꽃주얼');
const thunder = { name: 'thunderbolt', power: '90', damage_class: 'special', type: 'Electric' };
const lbSlot = (nameKr) => cmp({ pokemon: { name_kr: nameKr, moves: [thunder], stats: stats100 }, equipment: '전기구슬' }, ['electric'])[0];
assert(lbSlot('피카츄').buffed === Math.floor(90 * 200 * 1.5), '전기구슬 피카츄 특공 ×2');
assert(lbSlot('라이츄').buffed === Math.floor(90 * 100 * 1.5), '전기구슬 다른 종 = 효과 없음');

// 바디프레스 = 방어 실수치, 공격 배율(구애머리띠·천하장사) 안 붙음.
const bodyPress = { name: 'body-press', power: '80', damage_class: 'physical', type: 'Fighting' };
const bpSlot = (extra) =>
  cmp(Object.assign({ pokemon: { moves: [bodyPress], stats: { attack: { real: 100 }, defense: { real: 150 }, special_attack: { real: 100 } } } }, extra), ['fighting'])[0];
assert(bpSlot({ equipment: '구애머리띠' }).buffed === Math.floor(80 * 150 * 1.5), '바디프레스 + 구애머리띠 = 효과 없음: ' + JSON.stringify(bpSlot({ equipment: '구애머리띠' })));
assert(bpSlot({ ability: '천하장사' }).buffed === Math.floor(80 * 150 * 1.5), '바디프레스 + 천하장사 = 효과 없음');

console.log('smoke-move-power: ok');
