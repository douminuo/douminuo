/**
 * 페이지(MAIN) 컨텍스트에서 실행됨.
 *
 * Phase 2.A (2026-05-09): 스마트누오 Nuxt 3 — Vue 인스턴스 대신 `window.__NUXT__.state` 의
 * useState payload 에 attacker/defender 를 직접 쓴다. (RENEWAL_FIX_PLAN §15.2~15.3)
 *
 * 격리: isolated world 의 calcFill.js 가 postMessage 로 NUO_APPLY_CALC_V30 보내면
 * 본 파일이 NUO_CALC_RESULT 로 응답한다. 프로토콜 유지.
 */
(function () {
  if (window.__NUO_CALC_BRIDGE_V40__) return;
  window.__NUO_CALC_BRIDGE_V40__ = true;

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
    // 사이트는 weather/field 를 {en, kr} 객체로 기대 (§16-9 equipment 와 동일 family).
    att.weather = { en: pair.en, kr: pair.kr };
  }

  function wxApplyField(att, internalKey) {
    if (!att || !internalKey) return;
    var pair = FIELD_INTERNAL_TO_NUO[String(internalKey).toLowerCase().trim()];
    if (!pair || !pair.kr) return;
    att.field = { en: pair.en, kr: pair.kr };
  }

  function applyWeatherAndTerrain(att, pa, pd) {
    if (!att) return;
    try {
      if (pa && !pa.error) {
        if (pa.abilityWeatherKey) wxApplyWeather(att, pa.abilityWeatherKey);
        if (pa.abilityTerrainKey) wxApplyField(att, pa.abilityTerrainKey);
      }
      if (pd && !pd.error) {
        if (pd.abilityWeatherKey && wxSlotLooksEmpty(att.weather)) {
          wxApplyWeather(att, pd.abilityWeatherKey);
        }
        if (pd.abilityTerrainKey && wxSlotLooksEmpty(att.field)) {
          wxApplyField(att, pd.abilityTerrainKey);
        }
      }
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

  function inferIncomingPhysicalFromAttacker(att) {
    if (!att || !att.move) return null;
    var dc = String(att.move.damage_class || '').toLowerCase();
    if (dc === 'special') return false;
    if (dc === 'physical') return true;
    return null;
  }

  function applyAttackerFromPayload(state, pa, physAtk, warnings, page) {
    if (!page) page = 'calc';
    var att = state[page === 'speed' ? KEY_SPEED_ATT : KEY_ATT];
    var species = speciesKoForAttacker(pa.speciesKo);
    var entry = findPokemonEntry(state, species);
    if (!entry) {
      return { ok: false, error: page === 'speed' ? 'species_not_in_speed_dex' : 'species_not_in_dex' };
    }

    // types·stats·sprite 는 사이트 name watcher 가 채움.
    att.name = entry;

    var eiA = defaultEvsIvs(pa.evs, pa.ivs);
    if (page === 'speed') {
      att.effort = clampSp(eiA.evs[5]);
      att.individual_value = eiA.ivs[5] | 0;
    } else {
      att.effort = clampSp(physAtk ? eiA.evs[1] : eiA.evs[3]);
      att.individual_value = physAtk ? eiA.ivs[1] | 0 : eiA.ivs[3] | 0;
    }
    if (pa.level != null && pa.level > 0) att.level = pa.level | 0;

    var ap = page === 'speed' ? pa.personality : pa.attackerPersonality;
    if (ap === 0.9 || ap === 1 || ap === 1.1) att.personality = ap;

    // type·power·damage_class 는 사이트 move watcher 도 채우지만, 도감 row 없는 폴백(name '') 이면 watcher 가 안 돌아 직접 넣어 둠.
    if (page !== 'speed' && pa.attackerMove) {
      var row = findMoveRow(state, pa.attackerMove);
      att.move = buildMoveObject(row, pa.attackerMove, physAtk);
    }
    var dexSide = page === 'speed' ? 'speed' : false;
    att.ability = lookupAbilityObj(state, pa.abilityKo, dexSide);
    att.equipment = lookupEquipmentObj(state, pa.itemKo, dexSide);

    return { ok: true };
  }

  function applyDefenderFromPayload(state, pd, physInc, warnings, page) {
    if (!page) page = 'calc';
    var def = state[page === 'speed' ? KEY_SPEED_DEF : KEY_DEF];
    var entry = findPokemonEntry(state, pd.speciesKo);
    if (!entry) {
      return { ok: false, error: page === 'speed' ? 'species_not_in_speed_def_dex' : 'species_not_in_def_dex' };
    }

    def.name = entry;

    var eiD = defaultEvsIvs(pd.evs, pd.ivs);
    if (page === 'speed') {
      def.effort = clampSp(eiD.evs[5]);
      def.individual_value = eiD.ivs[5] | 0;
    } else {
      def.hp_effort = clampSp(eiD.evs[0]);
      def.hp_individual_value = eiD.ivs[0] | 0;
      def.effort = clampSp(physInc ? eiD.evs[2] : eiD.evs[4]);
      def.individual_value = physInc ? eiD.ivs[2] | 0 : eiD.ivs[4] | 0;
    }

    if (pd.level != null && pd.level > 0) def.level = pd.level | 0;

    var dp = page === 'speed' ? pd.personality : pd.defenderPersonality;
    if (dp === 0.9 || dp === 1 || dp === 1.1) def.personality = dp;

    var dexSideDef = page === 'speed' ? 'speed' : true;
    def.ability = lookupAbilityObj(state, pd.abilityKo, dexSideDef);
    def.equipment = lookupEquipmentObj(state, pd.itemKo, dexSideDef);

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
        warnings: result.warnings,
      },
      '*'
    );
  }

  function runApplyCalcFillCore(state, job, done) {
    var payloads = job.payloads || {};
    var onlyAttacker = !!job.onlyAttacker;
    var onlyDefender = !!job.onlyDefender;
    var page = job.page === 'speed' ? 'speed' : 'calc';

    var warnings = [];

    var paFull = payloads.attacker && !payloads.attacker.error ? payloads.attacker : null;
    var pdFull = payloads.defender && !payloads.defender.error ? payloads.defender : null;

    var physAtk = true;
    var physDef = true;
    if (paFull) {
      physAtk = paFull.physicalMove !== false;
      if (pdFull && typeof pdFull.incomingPhysical === 'boolean') physDef = pdFull.incomingPhysical;
      else physDef = physAtk;
    } else if (pdFull && typeof pdFull.incomingPhysical === 'boolean') {
      var attRef = state[KEY_ATT];
      var inferred = inferIncomingPhysicalFromAttacker(attRef);
      if (inferred === false) {
        physAtk = false;
        physDef = false;
      } else if (inferred === true) {
        physAtk = true;
        physDef = true;
      } else {
        physAtk = pdFull.incomingPhysical;
        physDef = pdFull.incomingPhysical;
      }
    }

    var hasA = !!paFull && !onlyDefender;
    var hasD = !!pdFull && !onlyAttacker;

    if (payloads.attacker && payloads.attacker.error) {
      warnings.push('공격측:' + payloads.attacker.error);
    }
    if (payloads.defender && payloads.defender.error) {
      warnings.push('수비측:' + payloads.defender.error);
    }

    if (!hasA && !hasD) {
      done({ ok: false, error: 'no_valid_payload', warnings: warnings });
      return;
    }

    try {
      var att = page === 'speed' ? state[KEY_SPEED_ATT] : state[KEY_ATT];
      if (hasA) {
        var ra = applyAttackerFromPayload(state, paFull, physAtk, warnings, page);
        if (!ra.ok) {
          done({ ok: false, error: ra.error, warnings: warnings });
          return;
        }
        applyWeatherAndTerrain(att, paFull, hasD ? pdFull : null);
      }

      if (hasD) {
        var rd = applyDefenderFromPayload(state, pdFull, physDef, warnings, page);
        if (!rd.ok) {
          done({ ok: false, error: rd.error, warnings: warnings });
          return;
        }
        if (!hasA) {
          applyWeatherAndTerrain(att, null, pdFull);
        }
      }

      done({ ok: true, warnings: warnings.length ? warnings : undefined });
    } catch (e) {
      done({ ok: false, error: String((e && e.message) || e), warnings: warnings });
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
    var d = ev.data;
    if (!d || d.source !== 'nuo-calc-ext' || d.type !== 'NUO_APPLY_CALC_V30') return;
    var rid = d.requestId != null ? d.requestId : '';
    applyQueue.push({
      payloads: d.payloads,
      requestId: rid,
      onlyAttacker: !!d.onlyAttacker,
      onlyDefender: !!d.onlyDefender,
      page: d.page === 'speed' ? 'speed' : 'calc',
    });
    pumpQueue();
  });
})();
