/**
 * 폼 고정 종(현재는 킬가르도 실드→블레이드)의 공격형 폼 공격·특공 실수치 — 결정력 전용 (slotAnalysis 문맥 power).
 * 내구력은 실드폼 원본 실수치를 그대로 씀. 슬롯은 고치지 않음.
 */
(function (g) {
  'use strict';

  var SL = g.nuoSlotRead;

  // 검출 후보. 현재는 킬가르도(실드)만.
  // 7세대 너프 이후: 블레이드 Atk/SpA 140, 실드 Def/SpD 140
  // baseStats 시그니처: HP60·Atk50·Def140·SpA50·SpD140·Spe60
  var OVERRIDES = [
    {
      label: 'aegislash-shield→blade',
      match: function (slotData, poke) {
        // F53: slug 는 aegislash-shield / aegislash — 하이픈 제거 후 비교. 블레이드폼 slug 는 제외.
        var n = SL.speciesSlug(slotData).replace(/-/g, '');
        if (n === 'aegislash' || n === 'aegislashshield') return true;
        // base_stats 폴백 — 실드폼 시그너처 (HP60·Atk50·Def140·SpA50·SpD140·Spe60).
        var bs = bsArr(poke.base_stats || poke.baseStats);
        return (
          !!bs &&
          bs[0] === 60 &&
          bs[1] === 50 &&
          bs[2] === 140 &&
          bs[3] === 50 &&
          bs[4] === 140 &&
          bs[5] === 60
        );
      },
      bladeAtkBase: 140,
      bladeSpaBase: 140,
    },
  ];

  function readIv(v) {
    var n = parseInt(v, 10);
    if (isNaN(n) || n < 0 || n > 31) return 31;
    return n;
  }

  function bsArr(bs) {
    if (Array.isArray(bs) && bs.length >= 6) return bs;
    if (bs && typeof bs === 'object') {
      return [
        bs.hp,
        bs.attack,
        bs.defense,
        bs.special_attack,
        bs.special_defense,
        bs.speed,
      ];
    }
    return null;
  }

  /**
   * 비-HP 실수치 (포켓몬 챔피언스, 스마트누오 표시식 — SMARTNUO_RE_PLAN §2):
   *   real = floor((floor((2*BS + IV) * L/100) + 5 + SP) * natureMul)
   * SP 를 더한 뒤 성격을 곱함 (따로 곱해 더하면 Lv50 이 아닐 때 1 어긋남). 구형 `floor(EV/4)` 식 아님.
   */
  function computeRealNonHp(baseStat, iv, ev, level, natureMul) {
    var inner = Math.floor(((2 * baseStat + iv) * level) / 100);
    return Math.floor((inner + 5 + ev) * natureMul);
  }

  function natureMulFor(natureKo, statKey, natureKoDoc, natureStatMulDoc) {
    var slug =
      (natureKoDoc && natureKoDoc.koToSlug && natureKoDoc.koToSlug[natureKo]) || '';
    var row =
      slug &&
      natureStatMulDoc &&
      natureStatMulDoc.bySlug &&
      natureStatMulDoc.bySlug[slug];
    if (!row) return 1;
    var v = row[statKey];
    return typeof v === 'number' && v > 0 ? v : 1;
  }

  /**
   * @param {object} slotData 슬롯 (읽기만)
   * @param {object} natureKoDoc { koToSlug }
   * @param {object} natureStatMulDoc { bySlug }
   * @returns {{ atk: number, spa: number } | null} 해당 없음 = null
   */
  function attackerFormStats(slotData, natureKoDoc, natureStatMulDoc) {
    var poke = SL.mon(slotData);
    if (!poke) return null;

    var rule = null;
    var i;
    for (i = 0; i < OVERRIDES.length; i++) {
      if (OVERRIDES[i].match(slotData, poke)) {
        rule = OVERRIDES[i];
        break;
      }
    }
    if (!rule) return null;

    var stats = poke.stats || {};
    var lvl = parseInt(poke.level, 10);
    if (!lvl || lvl < 1) lvl = 50;
    var natureKo = SL.nature(slotData);

    var atkObj = stats.attack || {};
    var spaObj = stats.special_attack || {};
    var atkEv = parseInt(atkObj.value, 10) | 0;
    var spaEv = parseInt(spaObj.value, 10) | 0;
    // F15: 슬롯의 individual_value 우선. 없거나 범위 밖이면 31.
    // 폼 변환은 결정력 표기용 추정 — 사용자가 IV<31로 빌드한 케이스도 정확히 반영.
    var atkIv = readIv(atkObj.individual_value);
    var spaIv = readIv(spaObj.individual_value);

    var atkMul = natureMulFor(natureKo, 'atk', natureKoDoc, natureStatMulDoc);
    var spaMul = natureMulFor(natureKo, 'spa', natureKoDoc, natureStatMulDoc);

    return {
      atk: computeRealNonHp(rule.bladeAtkBase, atkIv, atkEv, lvl, atkMul),
      spa: computeRealNonHp(rule.bladeSpaBase, spaIv, spaEv, lvl, spaMul),
    };
  }

  g.attackerFormOverride = {
    attackerFormStats: attackerFormStats,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
