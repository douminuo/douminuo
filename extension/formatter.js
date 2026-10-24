/* 요약 포맷 — 슬롯 → 요약 복사 텍스트 (formatSlotsText) + 내구력 계산. SW 전용. */
(function (global) {
  'use strict';

  var SL = global.nuoSlotRead;
  var FC = global.nuoFmtCommon;
  var normalizeMatchKey = FC.normalizeMatchKey;


  var STAT_ORDER = 'HABCDS';

  /** 나무위키·커뮤 관행: (HP실×방어실)/k, (HP실×특방실)/k. 괄호: modifiers.json 도구·특성·패앙·고대활성 등 + 모래날림/눈퍼뜨리기(타입 조건). README「내구력 — 구현 범위」참고. */
  var BULK_REAL_DIVISOR = 0.411;

  /** names = koNames.forDocs(...) 해석기 */
  function findItemBulkRule(names, itemRaw) {
    var found = names && names.itemRule(itemRaw);
    var r = found && found.rule;
    return r && (r.bulkDefMul != null || r.bulkSpdMul != null) ? r : null;
  }

  function findAbilityRuleWithSlug(names, abilityRaw) {
    return names ? names.abilityRule(abilityRaw) : null;
  }

  function numBulkMul(v, fallback) {
    var n = parseFloat(v);
    if (isNaN(n) || n <= 0) return fallback;
    return n;
  }

  /** 고대활성·쿼크차지(protosynthesis·quark-drive): 공격·방·특공·특방·스피드만 최고값; 동률 시 공격→방→특공→특방→스피드. 방 최고→물리×, 특방 최고→특수×. */
  function protoQuarkBulkMul(realByLetter, ar) {
    var dM = ar && ar.bulkHighestDefMul != null ? numBulkMul(ar.bulkHighestDefMul, 1.3) : 1.3;
    var sM = ar && ar.bulkHighestSpdMul != null ? numBulkMul(ar.bulkHighestSpdMul, 1.3) : 1.3;
    var order = ['A', 'B', 'C', 'D', 'S'];
    var maxV = -Infinity;
    var i;
    for (i = 0; i < order.length; i++) {
      var v = realByLetter[order[i]];
      if (v == null || isNaN(v)) return { def: 1, spd: 1 };
      if (v > maxV) maxV = v;
    }
    var win = 'S';
    for (i = 0; i < order.length; i++) {
      var L = order[i];
      if (realByLetter[L] === maxV) {
        win = L;
        break;
      }
    }
    if (win === 'B') return { def: dM, spd: 1 };
    if (win === 'D') return { def: 1, spd: sM };
    return { def: 1, spd: 1 };
  }

  /** 초상투영: 종/제목에 주춧돌·우물(영·한) 패턴. */
  function embodyBulkMulFromContext(ctx) {
    var t = normalizeMatchKey(ctx || '');
    if (!t) return { def: 1, spd: 1 };
    if (t.indexOf('주춧돌') !== -1 || t.indexOf('cornerstone') !== -1 || t.indexOf('코너스톤') !== -1) {
      return { def: 1.5, spd: 1 };
    }
    if (t.indexOf('우물') !== -1 || t.indexOf('wellspring') !== -1 || t.indexOf('웰스프링') !== -1) {
      return { def: 1, spd: 1.5 };
    }
    return { def: 1, spd: 1 };
  }

  function bulkMultipliersFromRule(rule) {
    var bd = rule && rule.bulkDefMul != null ? Number(rule.bulkDefMul) : 1;
    var bs = rule && rule.bulkSpdMul != null ? Number(rule.bulkSpdMul) : 1;
    if (isNaN(bd) || bd <= 0) bd = 1;
    if (isNaN(bs) || bs <= 0) bs = 1;
    return { defM: bd, spdM: bs };
  }

  function hasTypeEn(typesArr, want) {
    if (!typesArr || !typesArr.length) return false;
    var w = String(want || '').toLowerCase().trim();
    var ti;
    for (ti = 0; ti < typesArr.length; ti++) {
      if (String(typesArr[ti] || '').toLowerCase().trim() === w) return true;
    }
    return false;
  }

  /** 모래날림(sand-stream)+바위 타입 → 특방×1.5, 눈퍼뜨리기(snow-warning)+얼음 → 방×1.5. 이 두 특성·타입 조합만 적용. */
  function weatherBulkMulSandSnowOnly(aslug, speciesTypesEn) {
    if (!aslug || !speciesTypesEn || !speciesTypesEn.length) return { def: 1, spd: 1 };
    if (aslug === 'sand-stream' && hasTypeEn(speciesTypesEn, 'rock')) return { def: 1, spd: 1.5 };
    if (aslug === 'snow-warning' && hasTypeEn(speciesTypesEn, 'ice')) return { def: 1.5, spd: 1 };
    return { def: 1, spd: 1 };
  }

  function formatOneBulkLine(title, base, buffed) {
    if (buffed === base) return title + ':' + base;
    return title + ':' + base + ' (' + buffed + ')';
  }

  /**
   * F51 (2026-05-24): opts.excludeConditionalAbilities === true 면 ability rule 의
   *   `bulkConditional === true` 마킹된 보정 (멀티스케일·스펙터가드 등 풀체력 조건부 류) 을 skip.
   *   인라인 어노가 한 숫자만 보여주는 컨텍스트에서 “상시 유효” 가정이 깨지는 보정을 빼기 위해.
   *   샘플텍스트 path (legacy wrapper) 는 opts 안 넘기므로 현재 동작 그대로.
   *   결정력의 abilityHasConditionalPowerDisplay 패턴과 컨셉 일치 — 데이터에 “조건부” 마킹.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.excludeConditionalAbilities]
   * @param {string} [opts.speciesName] 종 한정 도구 판정용 종명 — 없으면 speciesTitleContext (샘플 제목 섞이면 오판)
   * @returns {{ physBase: number, specBase: number, physBuffed: number, specBuffed: number }|null}
   */
  function computeBulkPhysSpecBuffed(
    realByLetter,
    names,
    itemRaw,
    abilityRaw,
    speciesTitleContext,
    speciesTypesEn,
    opts
  ) {
    var h = realByLetter.H;
    var b = realByLetter.B;
    var d = realByLetter.D;
    if (h == null || b == null || d == null) return null;
    // 스마트누오 계산기 durability 구조: floor(H × 방어[배율마다 floor] × S / 0.411).
    // 방어 쪽 = 특성 → 도구 → 날씨 순 실수치 배율, S = bulkFinal 특성(멀티스케일·퍼코트 등) 최종 곱.
    var physBase = Math.floor((h * b) / BULK_REAL_DIVISOR);
    var specBase = Math.floor((h * d) / BULK_REAL_DIVISOR);

    var excludeConditional = !!(opts && opts.excludeConditionalAbilities === true);
    var bEff = b;
    var dEff = d;
    var sDef = 1;
    var sSpd = 1;
    function statMul(m) {
      if (m.def !== 1) bEff = Math.floor(bEff * m.def);
      if (m.spd !== 1) dEff = Math.floor(dEff * m.spd);
    }

    var abFound = findAbilityRuleWithSlug(names, abilityRaw);
    var arule = (abFound && abFound.rule) || {};
    if (abFound) {
      if (abFound.slug === 'embody-aspect' && arule.bulkEmbodyAspect) {
        statMul(embodyBulkMulFromContext(speciesTitleContext || ''));
      } else if (arule.bulkHighestOfAtkFamily) {
        statMul(protoQuarkBulkMul(realByLetter, arule));
      } else if (!(excludeConditional && arule.bulkConditional === true)) {
        // F51: 풀체력 조건부 (bulkConditional) 는 인라인 컨텍스트(opts.excludeConditionalAbilities)에서 skip.
        var am = bulkMultipliersFromRule(arule);
        if (arule.bulkFinal) {
          sDef = am.defM;
          sSpd = am.spdM;
        } else {
          statMul({ def: am.defM, spd: am.spdM });
        }
      }
    }

    var itemRule = findItemBulkRule(names, itemRaw);
    var speciesName = opts && opts.speciesName != null ? opts.speciesName : speciesTitleContext;
    if (itemRule && FC.ruleFitsSpecies(itemRule, speciesName)) {
      var im = bulkMultipliersFromRule(itemRule);
      statMul({ def: im.defM, spd: im.spdM });
    }

    if (abFound) statMul(weatherBulkMulSandSnowOnly(abFound.slug, speciesTypesEn));

    var physBuffed = Math.floor((h * bEff * sDef) / BULK_REAL_DIVISOR);
    var specBuffed = Math.floor((h * dEff * sSpd) / BULK_REAL_DIVISOR);

    return { physBase: physBase, specBase: specBase, physBuffed: physBuffed, specBuffed: specBuffed };
  }

  /**
   * F42 (2026-05-24): 미리 계산된 comp 로 두 줄 포맷.
   * background.js ANNOTATE_BUILDER_SLOT 가 computeBulkPhysSpecBuffed 1회 호출 후 본 함수에 그대로 전달 — 옛 코드는 두 포맷터가 각각 compute 를 다시 돌렸음.
   */
  function formatBulkLinesFromComp(comp) {
    if (!comp) return '';
    return (
      formatOneBulkLine('물리내구력', comp.physBase, comp.physBuffed) +
      '\n' +
      formatOneBulkLine('특수내구력', comp.specBase, comp.specBuffed)
    );
  }

  /** F42 (2026-05-24): 미리 계산된 comp 로 팀빌더 인라인용 `물리/특수` 한 줄. */
  function formatBulkCompactSlashFromComp(comp) {
    if (!comp) return '';
    return String(comp.physBuffed) + '/' + String(comp.specBuffed);
  }

  function trimOrDash(s) {
    var t = (s || '').trim();
    return t ? t : '--';
  }

  /** 테라스탈 줄 생략: 비어 있음, 없음, 대시류 등 */
  function shouldOmitTerastal(value) {
    var t = (value || '').trim();
    if (!t) return true;
    if (/^[-–—.]+$/.test(t)) return true;
    var low = t.toLowerCase();
    if (low === '없음' || low === 'none' || low === 'n/a') return true;
    if (t === '無') return true;
    return false;
  }

  function movePowerSuffix(cell) {
    if (cell == null) return null;
    if (typeof cell === 'number') return '(' + cell + ')';
    if (
      typeof cell === 'object' &&
      cell !== null &&
      typeof cell.base === 'number' &&
      typeof cell.buffed === 'number'
    ) {
      if (cell.base === cell.buffed) return '(' + cell.base + ')';
      return '(' + cell.base + '->' + cell.buffed + ')';
    }
    return null;
  }

  /**
   * 슬롯 하나 → 요약 블록.
   * @param {{ movePowers?: Array, bulk?: object|null }} a background analyzeSlot 결과
   */
  function formatOneSlot(slot, idx1, a, options) {
    var sampleTitle = SL.sampleName(slot);
    var name = SL.speciesKo(slot);
    var out = [];
    if (options.numberedTitle) out.push('#' + idx1 + (sampleTitle ? ' | ' + sampleTitle : ''));
    else if (sampleTitle && sampleTitle !== name) out.push(sampleTitle);
    out.push(trimOrDash(name) + ' @' + trimOrDash(SL.item(slot)));
    out.push(trimOrDash(SL.nature(slot)) + ' / ' + trimOrDash(SL.ability(slot)));

    var evParts = [];
    var reals = [];
    var i;
    for (i = 0; i < 6; i++) {
      var st = SL.stat(slot, i);
      if (st.sp) evParts.push(STAT_ORDER.charAt(i) + st.sp);
      reals.push(String(st.real));
    }
    if (evParts.length) out.push(evParts.join(' '));

    var mp = a.movePowers;
    if (options.includeRealStats) {
      // BACKLOG #2: 기술배치상 전혀 안 쓰는 공격/특수공격 실능치는 'x'. cls = computeMovePowers 의 유효 물리/특수
      // (변화기·미해결 기술은 cell 자체가 null).
      var usesPhysical = false;
      var usesSpecial = false;
      var anyMoveResolved = false;
      (mp || []).forEach(function (cell) {
        if (!cell || typeof cell !== 'object') return;
        anyMoveResolved = true;
        if (cell.cls === 'physical') usesPhysical = true;
        else if (cell.cls === 'special') usesSpecial = true;
      });
      if (anyMoveResolved && !usesPhysical) reals[1] = 'x';
      if (anyMoveResolved && !usesSpecial) reals[3] = 'x';
      out.push(reals.join('-'));
    }

    var tera = SL.tera(slot);
    if (!shouldOmitTerastal(tera)) out.push('테라스탈: ' + tera);
    if (options.includeBulkStats && a.bulk) out.push(formatBulkLinesFromComp(a.bulk));

    var moves = SL.moves(slot);
    out.push(
      moves
        .map(function (m, idx) {
          var base = trimOrDash(m);
          var suf = options.includeMovePowers && Array.isArray(mp) ? movePowerSuffix(mp[idx]) : null;
          return suf && base !== '--' ? base + ' ' + suf : base;
        })
        .join(' / ')
    );
    return out.join('\n');
  }

  /**
   * 슬롯 목록 → 요약 복사 텍스트. 빈 칸은 생략. 인덱스 i = 슬롯 번호 i+1 (analyses·sampleUrls 같은 인덱스).
   * @param {object[]} slots
   * @param {object[]} analyses background analyzeSlot 결과
   * @param {{ numberedTitle?: boolean, includeUrls?: boolean, includeRealStats?: boolean,
   *   includeMovePowers?: boolean, includeBulkStats?: boolean, partyUrl?: string, sampleUrls?: string[] }} options
   * @returns {string}
   */
  function formatSlotsText(slots, analyses, options) {
    options = options || {};
    var includeUrls = options.includeUrls !== false;
    var partyUrl = includeUrls ? String(options.partyUrl || '').trim() : '';
    var sampleUrls = (includeUrls && options.sampleUrls) || [];
    var parts = [];
    slots.forEach(function (slot, i) {
      if (SL.isEmpty(slot)) return;
      var one = formatOneSlot(slot, i + 1, analyses[i] || {}, options);
      var su = sampleUrls[i] ? String(sampleUrls[i]).trim() : '';
      parts.push(su ? su + '\n' + one : one);
    });
    var body = parts.join('\n\n');
    return partyUrl ? partyUrl + '\n\n' + body : body;
  }

  global.formatSlotsText = formatSlotsText;
  // F42: SW 가 한 번 계산한 comp 를 인라인 두 포맷에 재사용.
  global.computeBulkPhysSpecBuffed = computeBulkPhysSpecBuffed;
  global.formatBulkLinesFromComp = formatBulkLinesFromComp;
  global.formatBulkCompactSlashFromComp = formatBulkCompactSlashFromComp;
  global.movePowerSuffixFormatter = movePowerSuffix;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
