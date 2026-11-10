'use strict';

/**
 * calcFillBridge.js (MAIN world) smoke — 가짜 window.__NUXT__.state 에 bridge 를 올리고
 * NUO_APPLY_CALC_V30 을 보내 계산기 칸 값을 assert. sw-snapshot.js 는 SW 페이로드까지만 보므로
 * 페이로드 ↔ bridge 해석이 어긋나는 버그(수비 성격 배율 2026-11-10)는 여기서 잡는다.
 * 페이로드 모양 = calcPayload.finalizePair 출력 (defenderPersonalityPhys/Spec).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'calcFillBridge.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** 새 window 에 bridge 를 올리고 (job → 결과·state) 를 돌려주는 apply 함수. */
function mountBridge(state) {
  const listeners = [];
  const results = [];
  const win = {
    console,
    location: { pathname: '/' },
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
  vm.runInContext(src, win);
  return function apply(payloads) {
    win.postMessage({ source: 'nuo-calc-ext', type: 'NUO_APPLY_CALC_V30', requestId: 'r', payloads, onlyDefender: true, page: 'calc' });
    return results.pop();
  };
}

function freshState(atkDamageClass) {
  return {
    '$spokemon_list': [{ kr: '하마돈', id: 'hippowdon' }],
    '$scalculator.attacker': { move: { damage_class: atkDamageClass } },
    '$scalculator.defender': {},
  };
}

// 장난꾸러기(방어↑ 특공↓) 하마돈: 방어 SP 2, 특방 SP 32
const hippo = {
  speciesKo: '하마돈',
  evs: [2, 0, 2, 0, 32, 0],
  incomingPhysical: true,
  defenderPersonality: 1.1,
  defenderPersonalityPhys: 1.1,
  defenderPersonalitySpec: 1,
  abilityKo: '',
  itemKo: '',
};

// 공격측 특수기 → 특방 칸: SP 32, 성격 1 (물리 기준 1.1 이 들어가면 안 됨)
let st = freshState('Special');
let r = mountBridge(st)({ defender: hippo });
assert(r && r.ok, 'special apply ok: ' + JSON.stringify(r));
assert(st['$scalculator.defender'].effort === 32, 'special effort: got ' + st['$scalculator.defender'].effort);
assert(st['$scalculator.defender'].personality === 1, 'special personality: got ' + st['$scalculator.defender'].personality);

// 공격측 물리기 → 방어 칸: SP 2, 성격 1.1
st = freshState('Physical');
r = mountBridge(st)({ defender: hippo });
assert(r && r.ok, 'physical apply ok');
assert(st['$scalculator.defender'].effort === 2, 'physical effort: got ' + st['$scalculator.defender'].effort);
assert(st['$scalculator.defender'].personality === 1.1, 'physical personality: got ' + st['$scalculator.defender'].personality);

// 사이코쇼크(특수지만 방어로 맞음) → 방어 칸: SP 2, 성격 1.1 (사이트 수비 실수치도 방어 기준, 실측 2026-11-10)
st = freshState('Special');
st['$scalculator.attacker'].move.name = { id: 'psyshock', kr: '사이코쇼크' };
r = mountBridge(st)({ defender: hippo });
assert(r && r.ok, 'psyshock apply ok');
assert(st['$scalculator.defender'].effort === 2, 'psyshock effort: got ' + st['$scalculator.defender'].effort);
assert(st['$scalculator.defender'].personality === 1.1, 'psyshock personality: got ' + st['$scalculator.defender'].personality);

// 실패 = 매퍼(mapCalcFillError)가 아는 코드로 응답
r = mountBridge(freshState('Physical'))({ defender: Object.assign({}, hippo, { speciesKo: '없는종' }) });
assert(r && !r.ok && r.error === 'species_not_in_def_dex', 'unknown species code: ' + JSON.stringify(r));
r = mountBridge(null)({ defender: hippo });
assert(r && r.error === 'nuxt_state_not_found', 'no nuxt code: ' + JSON.stringify(r));

console.log('smoke-calc-bridge: ok');
