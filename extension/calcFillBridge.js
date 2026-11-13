/**
 * 페이지(MAIN) 컨텍스트에서 실행됨.
 *
 * Phase 2.A (2026-05-09): 스마트누오 Nuxt 3 — Vue 인스턴스 대신 `window.__NUXT__.state` 의
 * useState payload 에 attacker/defender 를 직접 쓴다.
 *
 * 격리: isolated world 의 calcFill.js 가 postMessage 로 NUO_APPLY_CALC_V31 { side, payload, page } 보내면
 * 본 파일이 NUO_CALC_RESULT 로 응답한다. 한 번에 한쪽만.
 *
 * 칸 선택 규칙 (CALC_SIDE_PLAN, 2026-11-10) — 어느 칸(공격/특공·방어/특방)에 넣고 그 칸의 성격 배율을 쓸지는
 * 이 파일의 cellIndex 만 정함. SW 페이로드는 6칸 사실(sp·ivs·nature)만 보냄. 이유: 수비만 채울 때 필요한
 * "페이지의 현재 공격 기술"은 MAIN world 에서만 보이고, SW 가 미리 고른 값과 여기 선택이 어긋난 버그가
 * 두 번 있었음 (bc2352f 수비 성격 배율, 8061f1a 사이코쇼크).
 * 포톤가이저: 사이트 계산기는 특례 없이 항상 특공 기준 (실측 2026-11-10: 한카리아스 실수치 132 = 사이코키네시스와 같음)
 * → 페이로드 분류(special) 그대로 특공 칸. 결정력 표시(높은 쪽)는 simpleMovePower 의 별도 결정.
 * 메시지 타입 V31: 확장 새로고침 후 페이지에 남은 옛 bridge(V30 수신)가 새 모양을 먼저 해석하지 않게.
 */
(function () {
  if (window.__NUO_CALC_BRIDGE_V45__) return;
  window.__NUO_CALC_BRIDGE_V45__ = true;

  var KEY_POKE_LIST = '$spokemon_list';
  var KEY_ATT = '$scalculator.attacker';
  var KEY_DEF = '$scalculator.defender';
  var KEY_SPEED_ATT = '$sspeed.attacker';
  var KEY_SPEED_DEF = '$sspeed.defender';

  var applyQueue = [];
  var applyBusy = false;

  /** F33: $spokemon_list lazy 인덱스 — list ref 변경 시 재빌드, first-set-wins. */
  var pokeIxByKr = null;
  var pokeIxByEn = null;
  var pokeIxSourceRef = null;

  /** F34: dex 키별 { kr, ref } — 6개 ability/equipment 배열. */
  var dexIxCache = Object.create(null);

  function ensurePokeIxBuilt(list) {
    if (!Array.isArray(list)) {
      pokeIxByKr = null;
      pokeIxByEn = null;
      pokeIxSourceRef = null;
      return;
    }
    if (pokeIxSourceRef === list) return;
    pokeIxByKr = Object.create(null);
    pokeIxByEn = Object.create(null);
    var i;
    var p;
    var kr;
    var keys = ['id', 'smogon_id', 'db_en', 'name'];
    var ki;
    var v;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (!p) continue;
      kr = String(p.kr || '').trim();
      if (kr && !pokeIxByKr[kr]) pokeIxByKr[kr] = p;
      for (ki = 0; ki < keys.length; ki++) {
        v = String(p[keys[ki]] || '').toLowerCase().trim();
        if (v && !pokeIxByEn[v]) pokeIxByEn[v] = p;
      }
    }
    pokeIxSourceRef = list;
  }

  function lookupByDex(state, key, kr) {
    var arr = lookupDexArray(state, key);
    if (!arr) return null;
    var c = dexIxCache[key];
    if (!c || c.ref !== arr) {
      c = { kr: Object.create(null), ref: arr };
      var i;
      var a;
      var k;
      for (i = 0; i < arr.length; i++) {
        a = arr[i];
        if (!a) continue;
        k = String(a.kr || '').trim();
        if (k && !c.kr[k]) c.kr[k] = a;
      }
      dexIxCache[key] = c;
    }
    return c.kr[String(kr || '').trim()] || null;
  }

  /** 스마트누오 도감: 공격측 블레이드폼 remap */
  var ATTACKER_SPECIES_KO_REMAP = {
    킬가르도: '킬가르도 (블레이드)',
  };

  function speciesKoForAttacker(speciesKo) {
    var k = String(speciesKo || '').trim();
    if (!k) return speciesKo;
    var mapped = ATTACKER_SPECIES_KO_REMAP[k];
    return mapped || speciesKo;
  }

  /** 사이트 effort 단위 = 챔피언스 SP 0..32 (슬롯 stats.*.value 그대로). */
  function clampSp(n) {
    n = n | 0;
    if (n < 0) return 0;
    if (n > 32) return 32;
    return n;
  }

  /**
   * @returns {object|null}
   */
  function getNuxtState() {
    try {
      var nx = window.__NUXT__;
      if (!nx) return null;
      if (nx.state && typeof nx.state === 'object') return nx.state;
      var pl = nx.payload;
      if (pl && pl.state && typeof pl.state === 'object') return pl.state;
      return null;
    } catch (e) {
      return null;
    }
  }

  function isCalculatorContext() {
    var p = '/';
    try {
      p = (location.pathname || '/').replace(/\/+$/, '') || '/';
    } catch (eCtx) {
      return false;
    }
    if (p === '/' || p === '/index' || p.indexOf('/index.') === 0) return true;
    if (p === '/speed' || p.indexOf('/speed/') === 0) return true;
    return false;
  }

  /**
   * @param {object} state
   * @param {'calc'|'speed'=} page — 미지정은 데미지 계산기(`$scalculator.*`).
   */
  function calcShellReady(state, page) {
    if (!page) page = 'calc';
    if (!state) return false;
    var pl = state[KEY_POKE_LIST];
    if (!Array.isArray(pl) || pl.length === 0) return false;
    if (page === 'speed') {
      var sa = state[KEY_SPEED_ATT];
      var sd = state[KEY_SPEED_DEF];
      if (!sa || typeof sa !== 'object' || !sd || typeof sd !== 'object') return false;
      return isCalculatorContext();
    }
    var att = state[KEY_ATT];
    var def = state[KEY_DEF];
    if (!att || typeof att !== 'object' || !def || typeof def !== 'object') return false;
    return isCalculatorContext();
  }

  /** 한글 종명 1순위, share URL 에 영문 slug 만 온 경우 id / smogon_id / name 폴백. */
  function findPokemonEntry(state, species) {
    var list = state[KEY_POKE_LIST];
    ensurePokeIxBuilt(list);
    if (!pokeIxByKr) return null;
    var k = String(species || '').trim();
    if (!k) return null;
    return pokeIxByKr[k] || pokeIxByEn[k.toLowerCase()] || null;
  }

  function defaultEvsIvs(evs, ivs) {
    var e = evs && evs.length >= 6 ? evs : [0, 0, 0, 0, 0, 0];
    var iv = ivs && ivs.length >= 6 ? ivs : [31, 31, 31, 31, 31, 31];
    return { evs: e, ivs: iv };
  }

  var WX_INTERNAL_TO_NUO = {
    sun: { kr: '쾌청', en: 'Sun' },
    rain: { kr: '비바라기', en: 'Rain' },
    sand: { kr: '모래바람', en: 'Sand' },
    snow: { kr: '설경', en: 'Snow' },
    strongwinds: { kr: '', en: '' },
  };

  var FIELD_INTERNAL_TO_NUO = {
    electric: { kr: '일렉트릭필드', en: 'Electric Terrain' },
    grassy: { kr: '그래스필드', en: 'Grassy Terrain' },
    misty: { kr: '미스트필드', en: 'Misty Terrain' },
    psychic: { kr: '사이코필드', en: 'Psychic Terrain' },
  };

  /** att.weather / att.field 는 사이트 기대상 {en, kr} 객체. 초기값은 빈 string ''. */
  function wxSlotLooksEmpty(v) {
    if (v == null || v === '') return true;
    if (typeof v === 'object') {
      var k = v.kr ? String(v.kr).trim() : '';
      var e = v.en ? String(v.en).trim() : '';
      return !k && !e;
    }
    if (typeof v !== 'string') return false;
    var d = v.trim().toLowerCase();
    if (!d) return true;
    if (d === 'none' || d === 'null' || d === '없음' || d === '--') return true;
    return false;
  }

  function wxApplyWeather(att, internalKey) {
    if (!att || !internalKey) return;
    var pair = WX_INTERNAL_TO_NUO[String(internalKey).toLowerCase().trim()];
    if (!pair || !pair.kr) return;
    // 사이트는 weather/field 를 {en, kr} 객체로 기대 (equipment 와 같은 모양).
    att.weather = { en: pair.en, kr: pair.kr };
  }

  function wxApplyField(att, internalKey) {
    if (!att || !internalKey) return;
    var pair = FIELD_INTERNAL_TO_NUO[String(internalKey).toLowerCase().trim()];
    if (!pair || !pair.kr) return;
    att.field = { en: pair.en, kr: pair.kr };
  }

  /** att.weather / att.field 에 특성의 날씨·필드 대입. onlyIfEmpty = 수비측 채울 때 (이미 정한 날씨를 덮지 않음). */
  function applyWeatherAndTerrain(att, pl, onlyIfEmpty) {
    if (!att || !pl) return;
    try {
      if (pl.abilityWeatherKey && (!onlyIfEmpty || wxSlotLooksEmpty(att.weather))) wxApplyWeather(att, pl.abilityWeatherKey);
      if (pl.abilityTerrainKey && (!onlyIfEmpty || wxSlotLooksEmpty(att.field))) wxApplyField(att, pl.abilityTerrainKey);
    } catch (eWx) {}
  }

  /** NUXT 의 state + data 양쪽에서 도감 배열 검색 — ability/equipment 는 dump 상 data 측에만 있음. */
  function lookupDexArray(state, key) {
    if (state && Array.isArray(state[key])) return state[key];
    try {
      var nx = typeof window !== 'undefined' ? window.__NUXT__ : null;
      if (nx && nx.data && Array.isArray(nx.data[key])) return nx.data[key];
    } catch (e) {}
    return null;
  }

  /** @param {boolean|'speed'} defenderSide false=공격측 cal_att | true=수비측 cal_def | 'speed'=스피드 전용 */
  function lookupAbilityObj(state, kr, defenderSide) {
    var key =
      defenderSide === 'speed'
        ? 'ability.speed'
        : defenderSide
          ? 'ability.cal_def'
          : 'ability.cal_att';
    var k = String(kr || '').trim();
    if (!k) return { en: '?', kr: '' };
    var hit = lookupByDex(state, key, k);
    if (hit) return hit;
    return { en: '?', kr: k };
  }

  /** @param {boolean|'speed'} defenderSide — lookupAbilityObj 와 동일 규칙 */
  function lookupEquipmentObj(state, kr, defenderSide) {
    var key =
      defenderSide === 'speed'
        ? 'equipment.speed'
        : defenderSide
          ? 'equipment.cal_def'
          : 'equipment.cal_att';
    var k = String(kr || '').trim();
    // 2026-05-14: 사이트가 EQUIPMENT_TABLE[equipment.en] strict lookup 도입. 옛 {en:'?', kr}
    // 폴백은 strict lookup miss → undefined.megaStone → calculate TypeError. 사이트의 “도구
    // 없음” sentinel(= 초기 state 의 빈 문자열)을 그대로 사용해 폴백 경로를 막는다.
    if (!k) return '';
    var hit = lookupByDex(state, key, k);
    if (hit) return hit;
    return '';
  }

  /** Nuxt 는 `$smove_dex.row_map` 처럼 점 포함 단일 키. kr_map 은 slug → 한글. */
  function findMoveRow(state, mp) {
    if (!mp) return null;
    var rm = state['$smove_dex.row_map'];
    var km = state['$smove_dex.kr_map'];
    if (rm && mp.name) {
      var slug = String(mp.name).trim();
      if (slug && rm[slug]) return rm[slug];
      // 사이트 row_map 키는 dash 제거 slug. SW 페이로드는 play-rough 처럼 dash 포함 가능.
      var noDash = slug.replace(/-/g, '');
      if (noDash && noDash !== slug && rm[noDash]) return rm[noDash];
    }
    var krStr = String(mp.kr || '').trim();
    if (km && krStr) {
      var key;
      for (key in km) {
        if (Object.prototype.hasOwnProperty.call(km, key) && km[key] === krStr) {
          if (rm && rm[key]) return rm[key];
          break;
        }
      }
    }
    return null;
  }

  /** 사이트 STAB 판정이 move.type.en 과 attacker.types[i] 를 대소문자까지 동일 비교함 → 영문 타입은 PascalCase 로 맞춤. */
  function capitalizeType(s) {
    if (!s) return '';
    var t = String(s).trim();
    if (!t) return '';
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }

  /** 사이트 기대: move.name 은 도감 row 객체, damage_class 는 대문자 시작. */
  function buildMoveObject(row, mp, physAtk) {
    var dcStr = 'Physical';
    if (physAtk === false) dcStr = 'Special';
    else if (physAtk === true) dcStr = 'Physical';
    else if (mp && mp.damageClass === 'special') dcStr = 'Special';
    else if (mp && mp.damageClass === 'physical') dcStr = 'Physical';

    // typeEn: nested mp.type.en → SW top-level mp.typeEn (소문자) → row.type 문자열. 기본 'Normal' 은 전부 실패 후.
    var typeEn = '';
    var typeKo = '';
    if (mp && mp.type && typeof mp.type === 'object') {
      if (mp.type.kr) typeKo = String(mp.type.kr).trim();
      if (mp.type.en) typeEn = capitalizeType(mp.type.en);
    }
    if (!typeKo && mp && mp.typeKo) typeKo = String(mp.typeKo).trim();
    if (!typeEn && mp && mp.typeEn) typeEn = capitalizeType(mp.typeEn);
    if (!typeKo && row && row.type) {
      if (typeof row.type === 'object' && row.type.kr) typeKo = String(row.type.kr).trim();
      else if (typeof row.type === 'string') typeKo = row.type;
    }
    if (!typeEn && row && typeof row.type === 'string') {
      typeEn = capitalizeType(row.type);
    }
    if (!typeEn) typeEn = 'Normal';
    if (!typeKo) typeKo = '노말';

    // SW 가 보낸 rich row 가 있으면 최우선. 사이트 특성(rule)이 flags.punch 등을 본다 —
    // row_map placeholder 는 flags 가 없어 철주먹 등 배율이 빠짐.
    var nameObj;
    if (mp && mp.richNameRow && typeof mp.richNameRow === 'object') {
      nameObj = mp.richNameRow;
    } else if (row && typeof row === 'object') {
      nameObj = row;
    } else {
      nameObj = {
        id: (mp && mp.name) || '',
        name: '',
        kr: (mp && mp.kr) || '',
        type: typeEn,
        basePower: (mp && mp.power | 0) || 40,
      };
    }

    var power =
      mp && mp.power != null ? mp.power | 0 : row && row.basePower != null ? row.basePower | 0 : 40;

    return {
      name: nameObj,
      type: { en: typeEn, kr: typeKo },
      power: power,
      damage_class: dcStr,
    };
  }

  /** 특수기지만 상대 방어로 맞는 기술 (move.name.id = Showdown id). 사이트 수비 칸도 방어 실수치로 바뀜 (실측 2026-11-10).
   *  신비의칼은 게임상 방어지만 사이트가 특방 칸으로 다룸 (실측 2026-11-13) — 사이트를 따라 뺌 (사용자 결정). */
  var SPECIAL_HITS_DEF = { psyshock: 1, psystrike: 1 };

  function inferIncomingPhysicalFromAttacker(att) {
    if (!att || !att.move) return null;
    var mn = att.move.name;
    if (mn && typeof mn === 'object' && SPECIAL_HITS_DEF[String(mn.id || '').toLowerCase()]) return true;
    var dc = String(att.move.damage_class || '').toLowerCase();
    if (dc === 'special') return false;
    if (dc === 'physical') return true;
    return null;
  }

  /**
   * 채울 칸 인덱스 (STAT_KEYS 순: 1 공격 · 2 방어 · 3 특공 · 4 특방 · 5 스피드) — 칸 선택은 여기 한 곳 (CALC_SIDE_PLAN).
   * 공격측 = 페이로드 기술 분류, 수비측 = 페이지의 현재 공격 기술 (사이코쇼크류 = 방어), 기술 없으면 물리.
   */
  function cellIndex(state, side, pl, page) {
    if (page === 'speed') return 5;
    if (side === 'attacker') return pl.attackerMove && pl.attackerMove.damageClass === 'special' ? 3 : 1;
    return inferIncomingPhysicalFromAttacker(state[KEY_ATT]) === false ? 4 : 2;
  }

  function applySideFromPayload(state, side, pl, page) {
    var isAtk = side === 'attacker';
    var target = state[page === 'speed' ? (isAtk ? KEY_SPEED_ATT : KEY_SPEED_DEF) : (isAtk ? KEY_ATT : KEY_DEF)];
    var entry = findPokemonEntry(state, isAtk ? speciesKoForAttacker(pl.speciesKo) : pl.speciesKo);
    if (!entry) {
      return { ok: false, error: page === 'speed'
        ? (isAtk ? 'species_not_in_speed_dex' : 'species_not_in_speed_def_dex')
        : (isAtk ? 'species_not_in_dex' : 'species_not_in_def_dex') };
    }

    // types·stats·sprite 는 사이트 name watcher 가 채움.
    target.name = entry;

    var ix = cellIndex(state, side, pl, page);
    var ei = defaultEvsIvs(pl.sp, pl.ivs);
    if (!isAtk && page !== 'speed') {
      target.hp_effort = clampSp(ei.evs[0]);
      target.hp_individual_value = ei.ivs[0] | 0;
    }
    target.effort = clampSp(ei.evs[ix]);
    target.individual_value = ei.ivs[ix] | 0;
    if (pl.level != null && pl.level > 0) target.level = pl.level | 0;

    var n = pl.nature && pl.nature[ix];
    if (n === 0.9 || n === 1 || n === 1.1) target.personality = n;

    // type·power·damage_class 는 사이트 move watcher 도 채우지만, 도감 row 없는 폴백(name '') 이면 watcher 가 안 돌아 직접 넣어 둠.
    if (isAtk && page !== 'speed' && pl.attackerMove) {
      target.move = buildMoveObject(findMoveRow(state, pl.attackerMove), pl.attackerMove, ix === 1);
    }
    var dexSide = page === 'speed' ? 'speed' : !isAtk;
    target.ability = lookupAbilityObj(state, pl.abilityKo, dexSide);
    target.equipment = lookupEquipmentObj(state, pl.itemKo, dexSide);

    return { ok: true };
  }

  function postResult(result, requestId) {
    window.postMessage(
      {
        source: 'nuo-calc-page',
        type: 'NUO_CALC_RESULT',
        requestId: requestId,
        ok: result.ok,
        error: result.error,
      },
      '*'
    );
  }

  function runApplyCalcFillCore(state, job, done) {
    if (!job.payload) {
      done({ ok: false, error: 'no_valid_payload' });
      return;
    }
    try {
      var r = applySideFromPayload(state, job.side, job.payload, job.page);
      if (r.ok) {
        // 날씨·필드는 공격측 칸에 — 공격측을 채울 땐 항상, 수비측을 채울 땐 비어 있을 때만.
        applyWeatherAndTerrain(state[job.page === 'speed' ? KEY_SPEED_ATT : KEY_ATT], job.payload, job.side === 'defender');
      }
      done(r);
    } catch (e) {
      done({ ok: false, error: String((e && e.message) || e) });
    }
  }

  function runApplyCalcFill(job, done) {
    var state = getNuxtState();
    if (!state) {
      done({ ok: false, error: 'nuxt_state_not_found' });
      return;
    }
    var page = job.page === 'speed' ? 'speed' : 'calc';
    if (!calcShellReady(state, page)) {
      var pl = state[KEY_POKE_LIST];
      if (!Array.isArray(pl) || pl.length === 0) {
        done({ ok: false, error: 'calc_dex_not_ready' });
      } else if (page === 'speed') {
        done({ ok: false, error: 'speed_state_not_found' });
      } else {
        done({ ok: false, error: 'vue_calc_not_found' });
      }
      return;
    }
    runApplyCalcFillCore(state, job, done);
  }

  function pumpQueue() {
    if (applyBusy || applyQueue.length === 0) return;
    applyBusy = true;
    var job = applyQueue.shift();
    var rid = job.requestId;

    function finish(result) {
      postResult(result, rid);
      applyBusy = false;
      pumpQueue();
    }

    try {
      runApplyCalcFill(job, finish);
    } catch (e) {
      finish({ ok: false, error: String((e && e.message) || e) });
    }
  }

  window.addEventListener('message', function (ev) {
    // 같은 window(우리 콘텐츠 스크립트)에서 온 것만 — 사이트 안 다른 출처 iframe 이 계산기 칸을 쓰지 못하게 (teamBuilderBridge 와 같은 가드).
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.source !== 'nuo-calc-ext' || d.type !== 'NUO_APPLY_CALC_V31') return;
    applyQueue.push({
      side: d.side === 'defender' ? 'defender' : 'attacker',
      payload: d.payload,
      requestId: d.requestId != null ? d.requestId : '',
      page: d.page === 'speed' ? 'speed' : 'calc',
    });
    pumpQueue();
  });
})();
