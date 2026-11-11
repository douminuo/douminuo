'use strict';
// SW(background.js) 를 vm 에 통째로 올리는 하네스 + 사이트 모양 슬롯 픽스처 — sw-snapshot.js·smoke 공용.
// 공유 POST 는 가짜 id 로 응답 (네트워크 안 나감), 그 외 외부 fetch 는 실패.
// 공유 POST 실패: sw.failShare = (body) => 'http' | 'noid' | 'net' | 아무것도 (= 성공). 본문으로 n번째 칸만 골라 실패시킬 수 있음.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** @returns {{ send: (msg: object) => Promise<any>, net: string[], storageSets: string[][], failShare: null | ((body: string) => string | undefined) }} */
function loadSW(extDir) {
  const EXT = path.resolve(extDir);
  const net = [];
  const storageSets = [];
  let listener = null;
  const api = { send, net, storageSets, failShare: null };
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
      const body = (init && init.body) || '';
      const fail = api.failShare && api.failShare(body);
      if (fail === 'net') return Promise.reject(new TypeError('Failed to fetch'));
      const j = fail === 'http' ? { message: 'Internal Server Error' } : fail === 'noid' ? {} : { id: 'ID' + body.length };
      const status = fail === 'http' ? 500 : 200;
      return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
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
  return api;
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
  // 기술 칸 모양 (2026-11-10 실측, CALC_MOVE_PICK_PLAN §4): 위력 변동 = power 0 + 분류 있음, 글자만 친 기술 = 문자열 name·분류 ''.
  variable_only: slot(3, {
    name: { id: 'aegislash', db_en: 'aegislash-shield', smogon_id: 'aegislash', name: 'Aegislash', kr: '킬가르도', types: ['Steel', 'Ghost'] },
    name_kr: '킬가르도', sprite: '', first_type: 'steel', second_type: 'ghost',
    ability: '배틀스위치', personality: { name: '용감', up: '공격', down: '스피드', display: '용감' },
    stats: stats([32, 32, 0, 0, 2, 0], [167, 112, 170, 70, 151, 58]),
    moves: [mv('kingsshield', "King's Shield", '킹실드', 'Steel', '강철', 0, 'Status'), mv('gyroball', 'Gyro Ball', '자이로볼', 'Steel', '강철', 0, 'Physical'), EMPTY_MV, EMPTY_MV],
  }),
  text_only: slot(2, {
    name: { id: 'azumarill', db_en: 'azumarill', smogon_id: 'azumarill', name: 'Azumarill', kr: '마릴리', types: ['Water', 'Fairy'] },
    name_kr: '마릴리', sprite: '', first_type: 'water', second_type: 'fairy',
    stats: stats([32, 32, 0, 0, 2, 0], [207, 112, 100, 72, 101, 70]),
    moves: [{ name: '사이코쇼크', name_kr: '', type: '', power: 0, damage_class: '' }, EMPTY_MV, EMPTY_MV, EMPTY_MV],
  }),
  status_only: slot(5, {
    name: { id: 'mrmime', db_en: 'mr-mime', smogon_id: 'mrmime', name: 'Mr. Mime', kr: '마임맨', types: ['Psychic', 'Fairy'] },
    name_kr: '마임맨', sprite: '', first_type: 'psychic', second_type: 'fairy',
    stats: stats([0, 0, 0, 32, 0, 32], [125, 65, 85, 152, 140, 142]),
    moves: [mv('reflect', 'Reflect', '리플렉터', 'Psychic', '에스퍼', 0, 'Status'), mv('lightscreen', 'Light Screen', '빛의장막', 'Psychic', '에스퍼', 0, 'Status'), EMPTY_MV, EMPTY_MV],
  }),
  text_then_variable: slot(1, {
    name: { id: 'nidoking', db_en: 'nidoking', smogon_id: 'nidoking', name: 'Nidoking', kr: '니드킹', types: ['Poison', 'Ground'] },
    name_kr: '니드킹', sprite: '', first_type: 'poison', second_type: 'ground',
    stats: stats([0, 0, 0, 32, 0, 32], [156, 112, 97, 137, 95, 137]),
    moves: [{ name: '지진', name_kr: '', type: '', power: 0, damage_class: '' }, mv('grassknot', 'Grass Knot', '풀묶기', 'Grass', '풀', 0, 'Special'), EMPTY_MV, EMPTY_MV],
  }),
  // 초상투영 오거폰 (SLOT_ANALYSIS_PLAN §4 — 우물 폼 Lv50 무보정 실수치 실측 155/140/104/80/116/130, 주춧돌 폼 같은 종족값).
  // 우물 폼 샘플 이름에 "주춧돌" — 종명만 보고 폼을 판정하는지.
  ogerpon_wellspring: slot(1, {
    _sn: '주춧돌 카운터',
    name: { id: 'ogerponwellspring', db_en: 'ogerpon-wellspring-mask', smogon_id: 'ogerponwellspring', name: 'Ogerpon-Wellspring', kr: '오거폰 (우물의가면)', types: ['Grass', 'Water'] },
    name_kr: '오거폰 (우물의가면)', sprite: '', first_type: 'grass', second_type: 'water',
    ability: '초상투영', stats: stats([0, 0, 0, 0, 0, 0], [155, 140, 104, 80, 116, 130]),
    moves: [mv('ivycudgel', 'Ivy Cudgel', '덩굴몽둥이', 'Grass', '풀', 100, 'Physical'), EMPTY_MV, EMPTY_MV, EMPTY_MV],
  }),
  ogerpon_cornerstone: slot(2, {
    name: { id: 'ogerponcornerstone', db_en: 'ogerpon-cornerstone-mask', smogon_id: 'ogerponcornerstone', name: 'Ogerpon-Cornerstone', kr: '오거폰 (주춧돌의가면)', types: ['Grass', 'Rock'] },
    name_kr: '오거폰 (주춧돌의가면)', sprite: '', first_type: 'grass', second_type: 'rock',
    ability: '초상투영', stats: stats([0, 0, 0, 0, 0, 0], [155, 140, 104, 80, 116, 130]),
    moves: [mv('ivycudgel', 'Ivy Cudgel', '덩굴몽둥이', 'Grass', '풀', 100, 'Physical'), EMPTY_MV, EMPTY_MV, EMPTY_MV],
  }),
  empty_obj: {},
  empty_null: null,
  meta_only: { slot_display: '#5', sample_name: '', sp_used: 0, sp_total: 66, pokemon: { name: '', name_kr: '', moves: [] } },
};

module.exports = { loadSW, F, mv, stats, slot, EMPTY_MV };
