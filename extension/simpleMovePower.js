/**
 * 결정력: 스마트누오 계산기 potential 이식 — floor(위력 u × 실수치 l × 최종배율 d) × 타수.
 *   u = 위력 특성(테크니션·태그·우격·-스킨·타입특성) 순차 floor, l = 실수치 특성·구애·종 한정 도구 순차 floor,
 *   d = 자속·생명의구슬·힘의머리띠·[맹화]·타입도구/플레이트/주얼·날씨·필드·급소·재앙 (floor 없이 곱).
 * computeMovePowers: { base, buffed, cls } — base 는 조건부 특성 효과 제외(표기용). cls 는 physical|special.
 * 한글 기술명·도구·특성 → koNames.js 해석기(names) — 사이트 표기 우선.
 * 맹화·모래의힘·선파워: HP·실제 날씨는 보지 않고 배율만 적용.
 * 날씨·필드: 이 포켓몬 특성의 setsWeather / setsTerrain 만 반영.
 *
 * 비표준 공격 스탯(분자): Body Press(bodypress)=방어 실수치, 물리·STAB 등은 그대로.
 * Photon Geyser(photongeyser)=공격·특공 중 더 큰 쪽; 동률(atk<=spa)은 특수 취급. 유효 물리/특수에 맞춰 도구·맹화 등 분기.
 */
(function (global) {
  'use strict';

  var FC = global.nuoFmtCommon;
  var SR = globalThis.shareToRaw;  // C3: hold 정규화용

  /** 한글 타입명 → PokeAPI type.name */
  var TYPE_KO_TO_EN = {
    노말: 'normal',
    불꽃: 'fire',
    물: 'water',
    전기: 'electric',
    풀: 'grass',
    얼음: 'ice',
    격투: 'fighting',
    독: 'poison',
    땅: 'ground',
    비행: 'flying',
    에스퍼: 'psychic',
    벌레: 'bug',
    바위: 'rock',
    고스트: 'ghost',
    드래곤: 'dragon',
    악: 'dark',
    강철: 'steel',
    페어리: 'fairy',
    스텔라: 'stellar',
  };

  function normalizeTypeToEn(t) {
    if (t == null || t === '') return '';
    var s = String(t).trim();
    if (!s) return '';
    var low = s.toLowerCase();
    if (/^[a-z]+$/.test(low) && low.length <= 12) return low;
    return TYPE_KO_TO_EN[s] || TYPE_KO_TO_EN[s.replace(/\s/g, '')] || '';
  }

  function num(v, fallback) {
    var n = parseFloat(v);
    if (isNaN(n) || n <= 0) return fallback;
    return n;
  }

  function showdownMoveIdFromMove(mv, names) {
    if (mv == null || typeof mv !== 'object' || Array.isArray(mv)) {
      return names.move(mv);
    }
    var order = [
      'nameEn',
      'name_en',
      'englishName',
      'name',
      'nameKr',
      'name_kr',
      'titleKr',
      'label',
    ];
    var seen = {};
    var i;
    for (i = 0; i < order.length; i++) {
      var t = FC.readLabel(mv[order[i]]);
      if (!t || seen[t]) continue;
      seen[t] = true;
      var id = names.move(t);
      if (id) return id;
    }
    return '';
  }

  function getMoveTags(moveTagsBundle, mv, names, moveId) {
    var out = {};
    if (!moveTagsBundle || !moveTagsBundle.moves || typeof moveTagsBundle.moves !== 'object') return out;
    var id = arguments[3] != null ? arguments[3] : showdownMoveIdFromMove(mv, names);
    if (!id) return out;
    var row = moveTagsBundle.moves[id];
    if (!row || typeof row !== 'object') return out;
    var k;
    for (k in row) {
      if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
      var v = row[k];
      if (v) out[k] = true;
    }
    return out;
  }

  /** 확정 급소 기술(트릭플라워 등) 배율 — base/buffed 양쪽에 처음부터 반영(조건부 아님). */
  var CRIT_POWER_MUL = 1.5;

  /** 쾌청·비: 불꽃·물 위력 보정(공격기준). strongwinds 등은 빈 객체 */
  var WEATHER_TYPE_POWER_MUL = {
    sun: { fire: 1.5, water: 0.5 },
    rain: { water: 1.5, fire: 0.5 },
    sand: {},
    snow: {},
    strongwinds: {},
  };

  /** 웨더볼·대지의파동이 날씨/필드에서 바뀌는 타입 (strongwinds 는 변화 없음). */
  var WEATHER_BALL_TYPE = { sun: 'fire', rain: 'water', sand: 'rock', snow: 'ice' };
  var TERRAIN_PULSE_TYPE = { electric: 'electric', grassy: 'grass', misty: 'fairy', psychic: 'psychic' };

  /**
   * 지형: 해당 타입 위력(지면에 있다고 상정).
   * F52 (2026-05-24): 8세대 너프 후 모든 필드 보정 1.3 으로 통일. 옛 코드의 psychic 1.5 는 7세대까지의 값.
   */
  var TERRAIN_TYPE_POWER_MUL = {
    electric: { electric: 1.3 },
    grassy: { grass: 1.3 },
    misty: { dragon: 0.5 }, // 미스트필드 = 드래곤 반감 (사이트 결정력도 ×0.5)
    psychic: { psychic: 1.3 },
  };

  /** 표기용: 맹화·모래의힘·날씨/필드 깔기·선파워(특공)만 '버프 후' 전제 */
  function abilityHasConditionalPowerDisplay(ar) {
    var a = ar || {};
    return !!(
      a.pinchBoostType != null ||
      a.sandForce === true ||
      a.setsWeather != null ||
      a.setsTerrain != null ||
      a.spaBoostInSun != null ||
      a.alwaysStab === true
    );
  }

  /** 사이트 fe() 와 같은 4096 고정소수점 곱 (부자유친 2타째 ×0.25). */
  function pokeRound(v, mul) {
    var m = (mul * 4096) >>> 0;
    return ((((v * m) >>> 0) + 2047) / 4096) >>> 0;
  }

  /**
   * F8: 한 번의 호출로 base 와 buffed 결정력을 동시에 계산.
   * - 스마트누오 결정력(potential) 구조: 실수치 l·위력 u 는 배율마다 floor, 최종 d 는 floor 없이 곱, floor(u*l*d).
   * - 조건부 곱(맹화·모래의힘·setsWeather/setsTerrain·spaBoostInSun·condAtk/SpaMul*) 은 Buffed 에만 적용.
   * - abilityHasConditionalPowerDisplay 가 false 인(또는 조건부가 매치 안 되는) 경우 base === buffed.
   *
   * @returns {{ base: number, buffed: number, cls: 'physical'|'special' }|null}
   *   cls 는 호출자(ruin 보정 분기)가 활용. null 이면 변화기/위력 0/비공격기.
   */
  function oneMovePowerInternalDual(
    mv,
    atkReal,
    spaReal,
    defReal,
    speciesTypesEn,
    itemRule,
    abilityRule,
    moveTagsBundle,
    names
  ) {
    // === Step 1: 입력 검증 — mv·power·damage_class null/0/status 조기 리턴 ===
    if (!mv || typeof mv !== 'object') return null;
    var p = mv.power;
    if (p == null || p === '') return null;
    var pnum = parseInt(p, 10);
    if (isNaN(pnum) || pnum <= 0) return null;

    var cls = String(mv.damage_class || '').toLowerCase();
    if (cls === 'status') return null;

    var isPhys = cls === 'physical';
    var isSpec = cls === 'special';
    if (!isPhys && !isSpec) return null;

    // === Step 2: stat 결정 — photongeyser(공특 최대치)·bodypress(방어)·일반 ===
    var moveId = arguments[9] != null ? arguments[9] : showdownMoveIdFromMove(mv, names);

    // 웨더볼·대지의파동: 특성의 날씨/필드를 따라감 — 조건부(깔기·날씨 의존 특성)라 base 는 원래 기술,
    // buffed 는 날씨/필드 타입·위력 100 으로 다시 계산. 메가솔라(selfWeather)는 아래 Step 3 에서 base 까지.
    var ar0 = abilityRule || {};
    if (!mv.nuoResolved) {
      var fixType = '';
      var ar2 = ar0;
      if (moveId === 'weatherball' && !ar0.selfWeather) {
        var condW = ar0.setsWeather || ar0.impliesWeather;
        fixType = WEATHER_BALL_TYPE[condW] || '';
        // impliesWeather(엽록소 등)는 결정력 날씨 보정이 없으므로 웨더볼 계산에서만 깔린 것으로 둠.
        if (fixType) ar2 = Object.assign({}, ar0, { setsWeather: condW });
      } else if (moveId === 'terrainpulse') {
        fixType = TERRAIN_PULSE_TYPE[ar0.setsTerrain] || '';
      }
      if (fixType) {
        var plain = oneMovePowerInternalDual(
          Object.assign({}, mv, { nuoResolved: true }),
          atkReal, spaReal, defReal, speciesTypesEn, itemRule, ar0, moveTagsBundle, names, moveId
        );
        var boosted = oneMovePowerInternalDual(
          Object.assign({}, mv, { nuoResolved: true, power: 100, type: fixType }),
          atkReal, spaReal, defReal, speciesTypesEn, itemRule, ar2, moveTagsBundle, names, moveId
        );
        if (!plain || !boosted) return plain || boosted;
        return { base: plain.base, buffed: boosted.buffed, cls: plain.cls };
      }
    }

    var stat;
    if (moveId === 'photongeyser') {
      var pa = atkReal != null && !isNaN(atkReal) ? atkReal : null;
      var ps = spaReal != null && !isNaN(spaReal) ? spaReal : null;
      if (pa == null && ps == null) return null;
      if (pa == null) {
        isPhys = false;
        isSpec = true;
        stat = ps;
      } else if (ps == null) {
        isPhys = true;
        isSpec = false;
        stat = pa;
      } else if (pa > ps) {
        isPhys = true;
        isSpec = false;
        stat = pa;
      } else {
        isPhys = false;
        isSpec = true;
        stat = ps;
      }
    } else if (moveId === 'bodypress') {
      stat = defReal;
      if (stat == null || isNaN(stat)) return null;
    } else {
      stat = isPhys ? atkReal : spaReal;
      if (stat == null || isNaN(stat)) return null;
    }

    // === Step 3: 기술 타입 결정 ===
    var moveTypeEn = normalizeTypeToEn(mv.type);
    if (!moveTypeEn) return null;

    var ar = abilityRule || {};
    var ir = itemRule || {};
    // 메가솔라 웨더볼: 항상 쾌청 기준 (날씨 ×1.5 는 아래 selfWeather 단계).
    if (moveId === 'weatherball' && WEATHER_BALL_TYPE[ar.selfWeather]) {
      pnum = 100;
      moveTypeEn = WEATHER_BALL_TYPE[ar.selfWeather];
    }

    // -스킨·노말스킨: 타입부터 바꿈 — 이후 타입 특성·도구·자속·날씨는 바뀐 타입 기준.
    var ateMul = 1;
    if (ar.normalizeAllMoves) {
      moveTypeEn = 'normal';
      ateMul = num(ar.normalizePowerMul, 1.2);
    } else if (ar.ateType && moveTypeEn === 'normal') {
      moveTypeEn = String(ar.ateType).toLowerCase().trim();
      ateMul = num(ar.atePowerMul, 1.2);
    }

    var tags = getMoveTags(moveTagsBundle, mv, names, moveId);
    var abBoostT = ar.boostType != null ? String(ar.boostType).toLowerCase().trim() : '';
    var abTypeHit = !!abBoostT && moveTypeEn === abBoostT;

    // === Step 4: 실수치 l — 사이트처럼 배율마다 floor (특성 → 조건부 특성 → 도구) ===
    // 강철술사·수포(typedMulOnStat)는 사이트에 없음 — Showdown 처럼 실수치 보정 자리에 둠.
    // 바디프레스는 방어 실수치 — 공격 배율(구애머리띠·천하장사·진홍빛고동 등)은 안 붙음 (Showdown ModifyDef).
    var atkStat = isPhys && moveId !== 'bodypress';
    var lBase = stat;
    if (atkStat && ar.atkMulPhysical != null) lBase = Math.floor(lBase * num(ar.atkMulPhysical, 1));
    if (isSpec && ar.spaMulSpecial != null) lBase = Math.floor(lBase * num(ar.spaMulSpecial, 1));
    if (abTypeHit && ar.typedMulOnStat) lBase = Math.floor(lBase * num(ar.typedPowerMul, 1));
    var lBuffed = lBase;
    if (isSpec && ar.spaBoostInSun != null) lBuffed = Math.floor(lBuffed * num(ar.spaBoostInSun, 1.5));
    if (atkStat && ar.condAtkMulPhysical != null) lBuffed = Math.floor(lBuffed * num(ar.condAtkMulPhysical, 1));
    if (isSpec && ar.condSpaMulSpecial != null) lBuffed = Math.floor(lBuffed * num(ar.condSpaMulSpecial, 1));
    function itemStat(l) {
      if (atkStat && ir.atkMulPhysical != null) l =Math.floor(l * num(ir.atkMulPhysical, 1));
      if (isSpec && ir.spaMulSpecial != null) l = Math.floor(l * num(ir.spaMulSpecial, 1));
      return l;
    }
    lBase = itemStat(lBase);
    lBuffed = itemStat(lBuffed);

    // === Step 5: 위력 u — 사이트 G() 처럼 배율마다 floor. 특성은 하나라 그 안 순서는 무관 ===
    function powerG(c, buffed) {
      if (ar.powerMul != null && !ar.ifSheerForceMove) {
        var cap = ar.ifBasePowerAtMost;
        if (cap == null || c <= cap) c = Math.floor(c * num(ar.powerMul, 1));
      }
      var btags = ar.boostIfMoveTags;
      if (btags && Array.isArray(btags.all) && btags.all.length) {
        var tagOk = true;
        var ti;
        for (ti = 0; ti < btags.all.length; ti++) {
          if (!tags[btags.all[ti]]) tagOk = false;
        }
        if (btags.physicalOnly && !isPhys) tagOk = false;
        if (btags.specialOnly && !isSpec) tagOk = false;
        if (tagOk) c = Math.floor(c * num(btags.powerMul, 1));
      }
      if (ar.ifSheerForceMove && tags.sheerForceEligible) c = Math.floor(c * num(ar.sheerForcePowerMul, 1.3));
      if (buffed && ar.sandForce && (moveTypeEn === 'ground' || moveTypeEn === 'rock' || moveTypeEn === 'steel')) {
        c = Math.floor(c * num(ar.sandForcePowerMul, 1.3));
      }
      if (ateMul !== 1) c = Math.floor(c * ateMul);
      if (abTypeHit && !ar.typedMulOnStat) c = Math.floor(c * num(ar.typedPowerMul, 1));
      return c;
    }

    // === Step 6: 최종 배율 d — floor 없이 곱. 부동소수 결과를 사이트와 맞추려고 곱하는 순서도 사이트대로 ===
    var stab = false;
    var i;
    for (i = 0; speciesTypesEn && i < speciesTypesEn.length; i++) {
      if (speciesTypesEn[i] === moveTypeEn) stab = true;
    }
    var itemTypes = ir.boostType == null ? [] : [].concat(ir.boostType);
    var selfWeatherKey = ar.selfWeather != null ? String(ar.selfWeather).toLowerCase().trim() : '';
    var weatherKey = ar.setsWeather != null ? String(ar.setsWeather).toLowerCase().trim() : '';
    var terrainKey = ar.setsTerrain != null ? String(ar.setsTerrain).toLowerCase().trim() : '';
    function finalMul(buffed) {
      var d = 1;
      // 변환자재/리베로: 자연 타입이 안 맞아도 buffed 에서는 자속(자연 STAB 이면 이미 true 라 중복 안 됨).
      if (stab || (buffed && ar.alwaysStab === true)) d *= num(ar.stabMul, 1.5);
      if (ir.finalDamageMul != null) d *= num(ir.finalDamageMul, 1);
      if (isPhys && ir.powerMulPhysical != null) d *= num(ir.powerMulPhysical, 1);
      if (isSpec && ir.powerMulSpecial != null) d *= num(ir.powerMulSpecial, 1);
      if (ir.powerMul != null) d *= num(ir.powerMul, 1);
      if (buffed && ar.pinchBoostType != null && moveTypeEn === String(ar.pinchBoostType).toLowerCase().trim()) {
        d *= num(ar.pinchPowerMul, 1.5);
      }
      if (itemTypes.indexOf(moveTypeEn) !== -1) d *= num(ir.typedPowerMul, 1);
      // 메가솔라(selfWeather)는 조건부 아님 — base 에도. 날씨 깔기(setsWeather)는 buffed 만.
      var wk = selfWeatherKey || (buffed ? weatherKey : '');
      var wm = WEATHER_TYPE_POWER_MUL[wk] && WEATHER_TYPE_POWER_MUL[wk][moveTypeEn];
      if (wm != null) d *= wm;
      var tm = buffed && TERRAIN_TYPE_POWER_MUL[terrainKey] && TERRAIN_TYPE_POWER_MUL[terrainKey][moveTypeEn];
      if (tm) d *= tm;
      if (tags.alwaysCrit) d *= CRIT_POWER_MUL;
      // 재앙의검/구슬: 사이트 support 와 같은 자리. 포톤게이저는 유효 물리/특수 기준.
      if (isPhys && ar.movePowerFoeDefenseRuinMul != null) d *= num(ar.movePowerFoeDefenseRuinMul, 1);
      if (isSpec && ar.movePowerFoeSpDefenseRuinMul != null) d *= num(ar.movePowerFoeSpDefenseRuinMul, 1);
      return d;
    }

    // === Step 7: floor(u*l*d) × 타수 — 트리플악셀·트리플킥 = 단계 합, 부자유친 = 사이트 pokeRound ===
    var tagRow = moveTagsBundle && moveTagsBundle.moves ? moveTagsBundle.moves[moveId] : null;
    var multihit = tagRow && tagRow.multihit;
    var hits = Array.isArray(multihit) ? multihit[1] : multihit > 0 ? multihit : 1;
    var steps = moveId === 'tripleaxel' ? [20, 40, 60] : moveId === 'triplekick' ? [10, 20, 30] : null;
    function total(l, buffed) {
      var d = finalMul(buffed);
      if (steps) {
        var sum = 0;
        var k;
        for (k = 0; k < steps.length && k < hits; k++) sum += Math.floor(powerG(steps[k], buffed) * l * d);
        return sum;
      }
      var L = Math.floor(powerG(pnum, buffed) * l * d);
      if (ar.parentalBond && !multihit) return L + pokeRound(L, 0.25);
      return L * hits;
    }

    return { base: total(lBase, false), buffed: total(lBuffed, true), cls: cls };
  }

  /**
   * @param {object} slotData Smartnuo 공유 data 객체
   * @param {string[]} speciesTypesEn
   * @param {object} names koNames.forDocs(...) 해석기 (도구·특성 규칙, 기술 id)
   * @param {object|null} moveTagsJson moveTags.json 전체 또는 null
   * @returns {({ base: number, buffed: number, cls: string }|null)[]}
   */
  function computeMovePowers(slotData, speciesTypesEn, names, moveTagsJson) {
    var out = [null, null, null, null];
    var poke = slotData && slotData.pokemon;
    if (!poke || !Array.isArray(poke.moves)) return out;

    // F10: SR.flattenSlot 단일 출처 사용 (옛 flattenPokemonSlot 사본 제거).
    // C3: SR.str() 로 equipment/ability 정규화 — 문자열/객체 양쪽 진입 통일.
    var flat = SR.flattenSlot(slotData);
    var itemHit = names.itemRule(SR.str(flat.equipment || flat.item || flat.Item || flat.hold));
    var itemRule = itemHit && FC.ruleFitsSpecies(itemHit.rule, SR.speciesNameLine(flat)) ? itemHit.rule : null;
    var abilityHit = names.abilityRule(SR.str(flat.ability || flat.ab || flat.Ability));
    var abilityRule = abilityHit ? abilityHit.rule : null;

    var stats = poke.stats || {};
    var atk =
      stats.attack && stats.attack.real != null ? parseInt(stats.attack.real, 10) : null;
    var spa =
      stats.special_attack && stats.special_attack.real != null
        ? parseInt(stats.special_attack.real, 10)
        : null;
    var def =
      stats.defense && stats.defense.real != null ? parseInt(stats.defense.real, 10) : null;
    if (atk != null && isNaN(atk)) atk = null;
    if (spa != null && isNaN(spa)) spa = null;
    if (def != null && isNaN(def)) def = null;

    var moves = poke.moves;
    var i;
    for (i = 0; i < 4 && i < moves.length; i++) {
      var mv = moves[i];
      // F49: 슬롯당 showdown id 1회만 해석.
      var moveId = showdownMoveIdFromMove(mv, names);
      // F8: 단일 호출로 base + buffed 동시 산출.
      var pair = oneMovePowerInternalDual(
        mv,
        atk,
        spa,
        def,
        speciesTypesEn || [],
        itemRule,
        abilityRule,
        moveTagsJson,
        names,
        moveId
      );
      out[i] = pair;
    }
    return out;
  }

  global.simpleMovePower = {
    computeMovePowers: computeMovePowers,
    normalizeTypeToEn: normalizeTypeToEn,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
