'use strict';

/**
 * 계산기 자동입력 전 구간 smoke — 슬롯 → SW(GET_CALC_PAYLOADS_FROM_SLOT) → calcFillBridge → 가짜 Nuxt state.
 * sw-snapshot.js 는 SW 페이로드까지만 봐서, 페이로드 ↔ bridge 해석이 어긋나는 버그
 * (수비 성격 배율 bc2352f, 사이코쇼크 8061f1a)는 여기서 잡는다.
 *   node scripts/smoke-calc-bridge.js                 고정 assert
 *   node scripts/smoke-calc-bridge.js --dump out.json  위 + "슬롯 → state" 전체 덤프 (리팩터 전후 비교, 비교 대상 = state 만)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadSW, F, slot, stats, mv, EMPTY_MV } = require('./lib/swHarness');

const BRIDGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'extension', 'calcFillBridge.js'), 'utf8');
const sw = loadSW(path.join(__dirname, '..', 'extension'));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** 새 window 에 bridge 를 올림. post(msg) → bridge 응답 (없으면 undefined). */
function mountBridge(state, pathname) {
  const listeners = [];
  const results = [];
  const win = {
    console,
    location: { pathname: pathname || '/' },
    __NUXT__: state ? { state } : null,
    addEventListener(type, fn) {
      if (type === 'message') listeners.push(fn);
    },
    postMessage(data) {
      if (data && data.source === 'nuo-calc-page') results.push(data);
      else listeners.forEach((fn) => fn({ source: self, data }));
    },
  };
  vm.createContext(win);
  // bridge 안의 window = vm 전역 프록시 (win 과 다른 객체) — ev.source 가드가 이걸 비교함
  const self = vm.runInContext('this', win);
  win.window = self;
  vm.runInContext(BRIDGE_SRC, win);
  return function post(msg) {
    win.postMessage(msg);
    return results.pop();
  };
}

const DEX = ['니드킹', '마릴리', '킬가르도 (블레이드)', '킬가르도', '망나뇽', '마임맨', '하마돈'].map((kr, i) => ({ kr, id: 'p' + i }));

/** 페이지 공격 기술: null = 없음. */
function freshState(page, atkMove) {
  const s = { '$spokemon_list': DEX };
  if (page === 'speed') {
    s['$sspeed.attacker'] = {};
    s['$sspeed.defender'] = {};
  } else {
    s['$scalculator.attacker'] = { move: atkMove || '' };
    s['$scalculator.defender'] = {};
  }
  return s;
}

/**
 * calcFill.orchestrateCalcFillFromSlot 과 같은 흐름 (메시지 V31 { side, payload, page }).
 * @returns {Promise<{ err: string } | { ok: boolean, error?: string, side: object }>}
 */
async function fill(slotData, side, page, atkMove) {
  const bg = await sw.send({ type: 'GET_CALC_PAYLOADS_FROM_SLOT', slot: slotData, side, page });
  if (!bg || !bg.ok) return { err: (bg && bg.error) || 'no_bg' };
  if (!bg.payload) return { err: 'no_valid_payload' };
  const state = freshState(page, atkMove);
  const r = mountBridge(state, page === 'speed' ? '/speed' : '/')({
    source: 'nuo-calc-ext', type: 'NUO_APPLY_CALC_V31', requestId: 'r', side, payload: bg.payload, page,
  });
  const key = page === 'speed' ? '$sspeed.' + side : '$scalculator.' + side;
  return { ok: !!(r && r.ok), error: r && r.error, side: state[key] };
}

// 장난꾸러기(방어↑ 특공↓) 하마돈: 방어 SP 2, 특방 SP 32
const hippo = slot(6, {
  name: { id: 'hippowdon', db_en: 'hippowdon', smogon_id: 'hippowdon', name: 'Hippowdon', kr: '하마돈', types: ['Ground'] },
  name_kr: '하마돈', sprite: '', first_type: 'ground',
  personality: { name: '장난꾸러기', up: '방어', down: '특공', display: '장난꾸러기' },
  stats: stats([2, 0, 2, 0, 32, 0], [215, 132, 154, 79, 124, 67]),
  moves: [mv('earthquake', 'Earthquake', '지진', 'Ground', '땅', 100, 'Physical'), EMPTY_MV, EMPTY_MV, EMPTY_MV],
});
const FIX = Object.assign({}, F, { hippo });

const ATK_MOVES = {
  physical: { damage_class: 'Physical', name: { id: 'earthquake' } },
  special: { damage_class: 'Special', name: { id: 'psychic' } },
  psyshock: { damage_class: 'Special', name: { id: 'psyshock' } },
  none: null,
};

async function run() {
  // --- 고정 assert ---
  let r = await fill(hippo, 'defender', 'calc', ATK_MOVES.special);
  assert(r.ok && r.side.effort === 32 && r.side.personality === 1, 'hippo vs special: ' + JSON.stringify([r.side && r.side.effort, r.side && r.side.personality]));
  r = await fill(hippo, 'defender', 'calc', ATK_MOVES.physical);
  assert(r.ok && r.side.effort === 2 && r.side.personality === 1.1, 'hippo vs physical: ' + JSON.stringify([r.side.effort, r.side.personality]));
  r = await fill(hippo, 'defender', 'calc', ATK_MOVES.psyshock);
  assert(r.ok && r.side.effort === 2 && r.side.personality === 1.1, 'hippo vs psyshock: ' + JSON.stringify([r.side.effort, r.side.personality]));
  // 공격측: 물리기 슬롯 → 공격 칸 (마릴리 고집 = 공격 1.1), 특수기 슬롯 → 특공 칸 (마임맨)
  r = await fill(F.azumarill, 'attacker', 'calc');
  assert(r.ok && r.side.effort === 32 && r.side.personality === 1.1, 'azumarill attacker: ' + JSON.stringify([r.side.effort, r.side.personality]));
  r = await fill(F.mrmime_single_en_item, 'attacker', 'calc');
  assert(r.ok && r.side.effort === 32 && r.side.personality === 1, 'mrmime attacker: ' + JSON.stringify([r.side.effort, r.side.personality]));
  // 스피드: 망나뇽 스피드 SP 32
  r = await fill(F.dragonite, 'attacker', 'speed');
  assert(r.ok && r.side.effort === 32, 'dragonite speed attacker: ' + JSON.stringify(r.side && r.side.effort));
  r = await fill(F.dragonite, 'defender', 'speed');
  assert(r.ok && r.side.effort === 32, 'dragonite speed defender: ' + JSON.stringify(r.side && r.side.effort));

  // bridge 단독 오류 코드 — 매퍼(mapCalcFillError)가 아는 코드
  const bg = await sw.send({ type: 'GET_CALC_PAYLOADS_FROM_SLOT', slot: hippo, side: 'defender', page: 'calc' });
  const msg = { source: 'nuo-calc-ext', type: 'NUO_APPLY_CALC_V31', requestId: 'r', side: 'defender', payload: bg.payload, page: 'calc' };
  // 옛 타입 V30 은 무시 (페이지에 남은 옛 bridge 와 섞이지 않게)
  r = mountBridge(freshState('calc', ATK_MOVES.physical))(Object.assign({}, msg, { type: 'NUO_APPLY_CALC_V30' }));
  assert(r === undefined, 'V30 must be ignored: ' + JSON.stringify(r));
  // 빈 칸 = SW 응답 실패 (화면 문구는 calcFill 의 mapCalcFillError)
  const empty = await sw.send({ type: 'GET_CALC_PAYLOADS_FROM_SLOT', slot: F.meta_only, side: 'defender', page: 'calc' });
  assert(empty && !empty.ok && empty.error === 'empty_slot', 'empty slot code: ' + JSON.stringify(empty));
  const noDex = freshState('calc', ATK_MOVES.physical);
  noDex['$spokemon_list'] = [{ kr: '없는종', id: 'x' }];
  r = mountBridge(noDex)(msg);
  assert(r && !r.ok && r.error === 'species_not_in_def_dex', 'unknown species code: ' + JSON.stringify(r));
  r = mountBridge(null)(msg);
  assert(r && r.error === 'nuxt_state_not_found', 'no nuxt code: ' + JSON.stringify(r));

  // --- 덤프 ---
  const dumpAt = process.argv.indexOf('--dump');
  if (dumpAt !== -1) {
    const out = {};
    for (const [k, s] of Object.entries(FIX)) {
      out['calc attacker ' + k] = await fill(s, 'attacker', 'calc');
      for (const [mk, m] of Object.entries(ATK_MOVES)) out['calc defender ' + k + ' vs ' + mk] = await fill(s, 'defender', 'calc', m);
      for (const side of ['attacker', 'defender']) out['speed ' + side + ' ' + k] = await fill(s, side, 'speed');
    }
    fs.writeFileSync(process.argv[dumpAt + 1], JSON.stringify(out, null, 1));
    console.log('dumped', Object.keys(out).length, 'cases');
  }
  console.log('smoke-calc-bridge: ok');
}
run().catch((e) => { console.error(e); process.exit(1); });
