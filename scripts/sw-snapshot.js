'use strict';
// SW(background.js) 를 통째로 vm 에 올려 메시지 응답을 덤프 — SW 리팩터 전후 비교용 (chrome·fetch 스텁, 사이트 모양 픽스처).
//   node scripts/sw-snapshot.js <extension 폴더> <out.json>
//   node scripts/sw-snapshot.js --diff <before.json> <after.json>
// HEAD 기준선: git archive HEAD extension | tar -x -C <임시 폴더> 후 그 폴더의 extension 을 넘김.
// 파티 공유 POST 는 가짜 id 로 응답 (네트워크 안 나감), 그 외 외부 fetch 는 실패.
const fs = require('fs');
if (process.argv[2] === '--diff') {
  const a = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const b = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  let n = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    n++;
    console.log('DIFF ' + k + '\n  - ' + JSON.stringify(a[k]) + '\n  + ' + JSON.stringify(b[k]));
  }
  console.log(n + ' diffs');
  process.exit(n ? 1 : 0);
}
const path = require('path');
const vm = require('vm');
const EXT = path.resolve(process.argv[2]);
const OUT = process.argv[3];

const net = [];
const storageSets = [];
let listener = null;
const ctx = { console, setTimeout, clearTimeout, Promise, JSON, Object, Array, Date, Math };
ctx.globalThis = ctx.self = ctx;
ctx.importScripts = (...files) => files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), ctx, { filename: f }));
ctx.chrome = {
  runtime: {
    getURL: (f) => 'ext://' + f,
    getManifest: () => ({ version: '2.0.0' }),
    onMessage: { addListener: (fn) => { listener = fn; } },
    onInstalled: { addListener: () => {} },
    lastError: undefined,
  },
  storage: { local: {
    get: (k, cb) => cb({}),
    set: (o) => { storageSets.push(Object.keys(o)); },
    remove: (k, cb) => cb && cb(),
  } },
  scripting: {},
};
ctx.fetch = (url, init) => {
  if (url.startsWith('ext://')) {
    const t = fs.readFileSync(path.join(EXT, url.slice(6)), 'utf8');
    return Promise.resolve({ ok: true, text: () => Promise.resolve(t), json: () => Promise.resolve(JSON.parse(t)) });
  }
  net.push(url + ' ' + ((init && init.body) || '').length);
  if (url.endsWith('/api/party/share')) {
    const id = 'ID' + ((init && init.body) || '').length;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id }), text: () => Promise.resolve(JSON.stringify({ id })) });
  }
  return Promise.reject(new Error('no_net'));
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });

function send(msg) {
  return new Promise((resolve) => {
    const r = listener(msg, { tab: { id: 1 }, frameId: 0 }, resolve);
    if (r !== true) resolve('(sync/none)');
  });
}

function mv(id, en, kr, typeEn, typeKo, bp, cat) {
  return { name: { id, name: en, kr, type: typeEn, base_power: bp, category: cat }, name_kr: kr, type: typeKo, power: bp, damage_class: cat };
}
const EMPTY_MV = { name: '', name_kr: '', type: '', power: '', damage_class: '' };
function stats(sp, real) {
  const k = ['hp', 'attack', 'defense', 'special_attack', 'special_defense', 'speed'];
  const o = {}; k.forEach((x, i) => { o[x] = { value: sp[i], real: real[i] }; }); return o;
}
function slot(n, p) { const sn = p._sn || ''; delete p._sn; return { slot_display: '#' + n, sample_name: sn, sp_used: 0, sp_total: 66, pokemon: Object.assign({ level: 50, personality: '', terastal: '', ability: '', equipment: '' }, p) }; }

const F = {
  nidoking: slot(1, {
    name: { id: 'nidoking', db_en: 'nidoking', smogon_id: 'nidoking', name: 'Nidoking', kr: '니드킹', types: ['Poison', 'Ground'] },
    name_kr: '니드킹', sprite: '/data/pokeapi-sprites/front/34.png', first_type: 'poison', second_type: 'ground',
    ability: '우격다짐', stats: stats([0, 32, 0, 0, 0, 0], [156, 154, 97, 105, 95, 105]),
    moves: [mv('firefang', 'Fire Fang', '불꽃엄니', 'Fire', '불꽃', 65, 'Physical'), EMPTY_MV, EMPTY_MV, EMPTY_MV],
  }),
  azumarill: slot(2, {
    _sn: '배북마릴리',
    name: { id: 'azumarill', db_en: 'azumarill', smogon_id: 'azumarill', name: 'Azumarill', kr: '마릴리', types: ['Water', 'Fairy'] },
    name_kr: '마릴리', sprite: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/184.png', first_type: 'water', second_type: 'fairy',
    ability: '천하장사', equipment: { en: 'Choice Band', kr: '구애머리띠' },
    personality: { name: '고집', up: '공격', down: '특공', display: '고집' }, terastal: '물',
    stats: stats([32, 32, 0, 0, 2, 0], [207, 112, 100, 72, 101, 70]),
    moves: [mv('aquajet', 'Aqua Jet', '아쿠아제트', 'Water', '물', 40, 'Physical'), mv('playrough', 'Play Rough', '치근거리기', 'Fairy', '페어리', 90, 'Physical'),
      mv('scald', 'Scald', '열탕', 'Water', '물', 80, 'Special'), mv('bellydrum', 'Belly Drum', '배수의진', 'Normal', '노말', 0, 'Status')],
  }),
  aegislash: slot(3, {
    name: { id: 'aegislash', db_en: 'aegislash-shield', smogon_id: 'aegislash', name: 'Aegislash', kr: '킬가르도', types: ['Steel', 'Ghost'] },
    name_kr: '킬가르도', sprite: '/upload/sprite/681.png', first_type: 'steel', second_type: 'ghost',
    ability: '배틀스위치', equipment: { en: 'Life Orb', kr: '생명의구슬' }, personality: { name: '조심', up: '특방', down: '특공', display: '조심' },
    stats: stats([32, 0, 0, 0, 32, 2], [167, 70, 170, 70, 192, 81]),
    moves: [mv('shadowball', 'Shadow Ball', '섀도볼', 'Ghost', '고스트', 80, 'Special'), mv('kingsshield', "King's Shield", '킹실드', 'Steel', '강철', 0, 'Status'), EMPTY_MV, EMPTY_MV],
  }),
  // 단일 타입 + 번들 조회 경로, 조건부 특성(멀티스케일), 테라
  dragonite: slot(4, {
    _sn: '망나뇽 샘플',
    name: { id: 'dragonite', db_en: 'dragonite', smogon_id: 'dragonite', name: 'Dragonite', kr: '망나뇽', types: ['Dragon', 'Flying'] },
    name_kr: '망나뇽', sprite: '', first_type: 'dragon',
    ability: '멀티스케일', equipment: { en: 'Heavy-Duty Boots', kr: '통굽부츠' }, personality: { name: '고집', up: '공격', down: '특공', display: '고집' }, terastal: '노말',
    stats: stats([2, 32, 0, 0, 0, 32], [168, 204, 115, 108, 120, 132]),
    moves: [mv('extremespeed', 'Extreme Speed', '신속', 'Normal', '노말', 80, 'Physical'), mv('earthquake', 'Earthquake', '지진', 'Ground', '땅', 100, 'Physical'), mv('firepunch', 'Fire Punch', '불꽃펀치', 'Fire', '불꽃', 75, 'Physical'), mv('dragondance', 'Dragon Dance', '용의춤', 'Dragon', '드래곤', 0, 'Status')],
  }),
  mrmime_single_en_item: slot(5, {
    name: { id: 'mrmime', db_en: 'mr-mime', smogon_id: 'mrmime', name: 'Mr. Mime', kr: '마임맨', types: ['Psychic', 'Fairy'] },
    name_kr: '', sprite: '', first_type: 'psychic', second_type: 'fairy',
    ability: '필터', equipment: { en: 'Leftovers', kr: '' }, level: 50,
    stats: stats([0, 0, 0, 32, 0, 32], [125, 65, 85, 152, 140, 142]),
    moves: [mv('psychic', 'Psychic', '사이코키네시스', 'Psychic', '에스퍼', 90, 'Special'), EMPTY_MV, EMPTY_MV, EMPTY_MV],
  }),
  empty_obj: {},
  empty_null: null,
  meta_only: { slot_display: '#5', sample_name: '', sp_used: 0, sp_total: 66, pokemon: { name: '', name_kr: '', moves: [] } },
};

const OPT_KEYS = ['includeUrls', 'includeRealStats', 'includeMovePowers', 'includeBulkStats', 'showdownPaste'];
function combos() {
  const out = [];
  for (let m = 0; m < 32; m++) {
    const fo = {};
    OPT_KEYS.forEach((k, i) => { fo[k] = !!(m & (1 << i)); });
    out.push(fo);
  }
  return out;
}

async function run() {
  const out = {};
  for (const [k, s] of Object.entries(F)) {
    out['ann ' + k] = await send({ type: 'ANNOTATE_BUILDER_SLOT', slotData: s });
    for (const side of ['attacker', 'defender']) {
      out['calc ' + side + ' ' + k] = await send({ type: 'GET_CALC_PAYLOADS_FROM_SLOT', slot: s, side, page: 'calc' });
    }
    for (const fo of combos()) {
      out['fmt ' + k + ' ' + JSON.stringify(fo)] = await send({ type: 'FORMAT_BUILDER_SLOT', slotIndex: 2, slotData: s, origin: 'https://smartnuo.com', pathname: '/party', formatOptions: fo });
    }
  }
  const party = [F.nidoking, F.azumarill, F.aegislash, F.empty_obj, F.dragonite, null];
  for (const fo of combos()) {
    out['party ' + JSON.stringify(fo)] = await send({ type: 'COPY_PARTY_SHARE_URL', partySlots: party, origin: 'https://smartnuo.com', pathname: '/party', formatOptions: fo });
  }
  out['party none'] = await send({ type: 'COPY_PARTY_SHARE_URL', partySlots: [null, {}, null, null, null, null], formatOptions: {} });
  const dex = await send({ type: 'GET_POKEMON_SLUG_TO_DEX' });
  out.dex = Object.keys(dex.doc.bySlug || {}).length;
  out.net = net;
  out.storageSets = storageSets;
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('wrote', OUT, Object.keys(out).length, 'keys');
}
run().catch((e) => { console.error(e); process.exit(1); });
