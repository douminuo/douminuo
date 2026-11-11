/**
 * Service worker: 팀빌더 슬롯 → 계산기 기입용 페이로드.
 * globalThis.nuoCalcPayload.buildSidePayloadFromSlot(slot, side, docs, page)
 */
(function () {
  'use strict';

  var SL = globalThis.nuoSlotRead;

  /**
   * F40 (2026-05-23): moveTags.json 은 background.js loadCalcPayloadDocs() 가 단일 로더로
   * 묶음에 넣어 준다. buildOneSideFromFlatSlot 는 docs.moveTagsDoc 를 그대로 읽는다.
   * SW 부팅 후 fetch 1회로 줄임.
   */

  function buildRichMoveRow(slug, slugDashed, ko, typeEn, power, dcStr, moveTagsDoc, moveSlugToEnDoc) {
    var enName = '';
    var byS = moveSlugToEnDoc && moveSlugToEnDoc.bySlug;
    if (byS) {
      if (slugDashed && byS[slugDashed]) enName = String(byS[slugDashed]);
      else if (slug && byS[slug]) enName = String(byS[slug]);
    }

    var rawFlags = null;
    var movesTbl = moveTagsDoc && moveTagsDoc.moves;
    if (movesTbl && typeof movesTbl === 'object' && slug) {
      rawFlags = movesTbl[slug];
    }
    var tags = rawFlags && typeof rawFlags === 'object' ? rawFlags : {};
    // moveTags 의 비-flag 키 — 사이트 기술 객체에선 flags 밖 최상위 필드.
    var NON_FLAG = { recoil: 1, sheerForceEligible: 1, alwaysCrit: 1, multihit: 1, multiaccuracy: 1 };
    var flags = {};
    var fk;
    for (fk in tags) {
      if (Object.prototype.hasOwnProperty.call(tags, fk) && tags[fk] === true && !NON_FLAG[fk]) {
        flags[fk] = 1;
      }
    }

    var category =
      dcStr === 'special' ? 'Special' : dcStr === 'physical' ? 'Physical' : 'Status';
    var typeCapitalized = typeEn
      ? typeEn.charAt(0).toUpperCase() + typeEn.slice(1).toLowerCase()
      : 'Normal';

    // 사이트 계산기 기술 목록 행과 같은 모양 (smogon gen9 move → {…, multihit, multiaccuracy, secondaries, recoil}).
    // 사이트 결정력이 secondaries(우격다짐)·recoil(이판사판)을 보고, move.name watcher 가 multihit 로 타수를 채움.
    return {
      id: slug,
      name: enName,
      kr: ko,
      type: typeCapitalized,
      basePower: power,
      category: category,
      flags: flags,
      multihit: tags.multihit,
      multiaccuracy: !!tags.multiaccuracy,
      secondaries: !!tags.sheerForceEligible,
      recoil: !!tags.recoil,
    };
  }

  /**
   * F39: 소스 문서(object) identity 로 빌드 결과를 캐싱하는 공통 헬퍼.
   * WeakMap 키라 소스 문서 참조가 바뀌면 자연히 무효화되고, SW 가 죽으면 GC 됨.
   * buildFn 은 memoize 된 함수와 동일한 인자를 받되, 캐시 키는 첫 인자(object)로 고정.
   */
  function memoizeByDocRef(buildFn) {
    var cache = new WeakMap();
    return function (doc) {
      if (!doc || typeof doc !== 'object') return buildFn.apply(null, arguments);
      var hit = cache.get(doc);
      if (hit === undefined) {
        hit = buildFn.apply(null, arguments);
        cache.set(doc, hit);
      }
      return hit;
    };
  }

  /** 슬러그 정규화 맵 hyphenless → hyphenated (moveSlugToEn.json 키) — 사이트 기술 행 영문 이름 찾기용. 한 번만 빌드. */
  var getSlugCanonicalMap = memoizeByDocRef(function (moveSlugToEnDoc) {
    var bySlug = (moveSlugToEnDoc && moveSlugToEnDoc.bySlug) || {};
    var map = Object.create(null);
    var k;
    for (k in bySlug) {
      if (!Object.prototype.hasOwnProperty.call(bySlug, k)) continue;
      var hyphenless = String(k).replace(/-/g, '');
      if (hyphenless && map[hyphenless] == null) map[hyphenless] = k;
    }
    return map;
  });

  var str = SL.label;
  var asInt = SL.asInt;

  function ivSix(slot) {
    var out = [];
    var i;
    for (i = 0; i < 6; i++) out.push(SL.stat(slot, i).iv);
    return out;
  }

  /**
   * 특성 → modifiers.json setsWeather / setsTerrain (simpleMovePower 와 동일 키). names = koNames 해석기.
   * @returns {{ abilityWeatherKey: string|null, abilityTerrainKey: string|null }}
   */
  function envKeysFromAbilityKo(abilityKo, names) {
    var hit = names.abilityRule(str(abilityKo));
    var r = (hit && hit.rule) || {};
    function key(v) {
      return v != null && String(v).trim() !== '' ? String(v).toLowerCase().trim() : null;
    }
    return { abilityWeatherKey: key(r.setsWeather), abilityTerrainKey: key(r.setsTerrain) };
  }

  function personalityScalar(mul) {
    if (mul > 1) return 1.1;
    if (mul < 1) return 0.9;
    return 1;
  }

  function natureRowForKo(natureKo, natureKoDoc, natureStatMulDoc) {
    var slug = (natureKoDoc && natureKoDoc.koToSlug && natureKoDoc.koToSlug[natureKo]) || '';
    var row =
      slug &&
      natureStatMulDoc &&
      natureStatMulDoc.bySlug &&
      natureStatMulDoc.bySlug[slug]
        ? natureStatMulDoc.bySlug[slug]
        : null;
    return { slug: slug, row: row };
  }

  /**
   * 공격측 기술 = 슬롯만 보고 기술1→4 순: ① 물리/특수 + 위력 > 0 인 첫 기술, ② 없으면 물리/특수 + 위력 0 (위력 변동 —
   * 자이로볼·풀묶기 등) 인 첫 기술을 위력 40 으로 (옛 PokéAPI 경로와 같은 값 — 사이트 계산기는 자체 위력식이 있으면 그걸 씀,
   * SMARTNUO_RE_PLAN §2.1), ③ 없으면 null → 호출자가 몸통박치기. 외부 호출 없음 (2026-11-10 PokéAPI 기술 조회 제거 —
   * 페이지가 준 기술 이름이 외부 요청 URL 이 되던 경로, 463cb05 보안 감사 3건).
   * shortcut: 목록에서 고르지 않고 글자만 친 기술(분류 '')은 무시 (사용자 결정 2026-11-10) — moveTags.json 에 분류·타입·위력
   *   (Showdown moves.ts)을 넣으면 번들로 풀 수 있음, 그때 PokéAPI 와 챔피언스 위력이 다른 기술 주의.
   * 사이트가 슬롯 기술의 power·damage_class 를 빼면 전부 몸통박치기 (인라인 결정력도 같이 사라져 바로 보임) — 고칠 곳 = slotRead.moveRow.
   * 영문 slug 문자열만 있는 옛 공유 슬롯은 기술은 골라지지만 사이트 기술 칸 한글 이름이 빌 수 있음.
   */
  function firstDamagingMoveFromSlot(slot, names, typeKoDoc) {
    var rows = [0, 1, 2, 3].map(function (i) {
      return SL.moveRow(slot, i);
    });
    function pick(fixedPower) {
      var i;
      for (i = 0; i < 4; i++) {
        var r = rows[i];
        if (!r || (r.dc !== 'physical' && r.dc !== 'special') || r.power > 0 !== fixedPower) continue;
        var byKo = typeKoDoc && typeKoDoc.byKo;
        var typeEn = r.typeEn || (byKo && Object.prototype.hasOwnProperty.call(byKo, r.typeKo) ? String(byKo[r.typeKo] || '').toLowerCase() : '');
        var slug = names.move(r.id) || r.id.toLowerCase();
        return {
          ko: r.ko,
          meta: { slug: slug, power: fixedPower ? r.power : null, typeEn: typeEn || 'normal', damage_class: r.dc },
        };
      }
      return null;
    }
    return pick(true) || pick(false);
  }

  /** F39: typeKoDoc.byKo 역인덱스 enLower → ko (first-set-wins). */
  var getTypeKoReverseIx = memoizeByDocRef(function (byKo) {
    var rev = Object.create(null);
    var ko;
    var enDisp;
    for (ko in byKo) {
      if (!Object.prototype.hasOwnProperty.call(byKo, ko)) continue;
      enDisp = String(byKo[ko] || '').toLowerCase();
      if (enDisp && !rev[enDisp]) rev[enDisp] = ko;
    }
    return rev;
  });

  function typeKoFromEnSlug(typeEn, typeKoDoc) {
    var slug = String(typeEn || 'normal').toLowerCase();
    var byKo = typeKoDoc && typeKoDoc.byKo;
    if (!byKo) return '';
    var rev = getTypeKoReverseIx(byKo);
    return rev[slug] || '';
  }

  function buildAttackerMovePayload(pack, typeKoDoc, moveTagsDoc, moveSlugToEnDoc) {
    if (!pack || !pack.meta) return null;
    var m = pack.meta;
    var dc = m.damage_class === 'special' ? 'special' : 'physical';
    var typeEn = String(m.typeEn || 'normal').toLowerCase();
    var typeKo = typeKoFromEnSlug(typeEn, typeKoDoc);
    var slugUndashed = String(m.slug || 'tackle')
      .toLowerCase()
      .replace(/-/g, '');
    var canonMap = getSlugCanonicalMap(moveSlugToEnDoc);
    var slugDashed =
      (canonMap && canonMap[slugUndashed]) || String(m.slug || 'tackle').toLowerCase();
    var ko = pack.ko || '';
    var power = m.power != null && m.power !== '' ? asInt(m.power) : 40;
    var richRow = buildRichMoveRow(
      slugUndashed,
      slugDashed,
      ko,
      typeEn,
      power,
      dc,
      moveTagsDoc,
      moveSlugToEnDoc
    );

    return {
      name: slugUndashed,
      kr: ko,
      power: power,
      typeEn: typeEn,
      typeKo: typeKo,
      damageClass: dc,
      richNameRow: richRow,
    };
  }

  /** PokeAPI/공식: 몸통박치기 tackle — 물리·노말·위력 40 (현행) */
  function defaultAttackerMovePayload(typeKoDoc, moveTagsDoc, moveSlugToEnDoc) {
    var typeEn = 'normal';
    var richRow = buildRichMoveRow(
      'tackle',
      'tackle',
      '몸통박치기',
      typeEn,
      40,
      'physical',
      moveTagsDoc,
      moveSlugToEnDoc
    );
    return {
      name: 'tackle',
      kr: '몸통박치기',
      power: 40,
      typeEn: typeEn,
      typeKo: typeKoFromEnSlug(typeEn, typeKoDoc) || '노말',
      damageClass: 'physical',
      richNameRow: richRow,
    };
  }

  /**
   * 슬롯 하나 → 한쪽 패널 페이로드. 칸(공격/특공·방어/특방)은 고르지 않음 — bridge 가 정함
   * (CALC_SIDE_PLAN: SW 가 미리 고른 값과 bridge 의 선택이 어긋난 버그 bc2352f·8061f1a).
   * 6칸 배열 순서 = slotRead STAT_KEYS (HP, 공격, 방어, 특공, 특방, 스피드).
   * @param {object} slot 사이트 파티 슬롯 (slotRead.js 모양)
   * @param {object} docs natureKoDoc / natureStatMulDoc / typeKoDoc / koNames / moveSlugToEnDoc / moveTagsDoc
   * @param {'attacker'|'defender'} role
   * @param {'calc'|'speed'=} page — 기술은 계산기 공격측에만 붙음.
   * @returns {Promise<{ speciesKo, sp: number[], ivs: number[], nature: number[], level, abilityKo, itemKo,
   *   abilityWeatherKey, abilityTerrainKey, attackerMove? }>} 빈 슬롯·종 없음 = reject (empty_slot / no_species)
   */
  function buildOneSideFromFlatSlot(slot, docs, role, page) {
    if (SL.isEmpty(slot)) return Promise.reject(new Error('empty_slot'));
    var speciesKo = SL.speciesKo(slot);
    if (!speciesKo) return Promise.reject(new Error('no_species'));

    var row = natureRowForKo(SL.nature(slot), docs.natureKoDoc, docs.natureStatMulDoc).row;
    var abilityKo = SL.ability(slot);
    var env = envKeysFromAbilityKo(abilityKo, docs.koNames);
    var out = {
      speciesKo: speciesKo,
      sp: SL.spSix(slot),
      ivs: ivSix(slot),
      nature: row
        ? [1, personalityScalar(row.atk), personalityScalar(row.def), personalityScalar(row.spa), personalityScalar(row.spd), personalityScalar(row.spe)]
        : [1, 1, 1, 1, 1, 1],
      level: SL.level(slot) || 50,
      abilityKo: abilityKo,
      itemKo: SL.item(slot),
      abilityWeatherKey: env.abilityWeatherKey,
      abilityTerrainKey: env.abilityTerrainKey,
    };
    if (page === 'speed' || role !== 'attacker') return Promise.resolve(out);

    var movePack = firstDamagingMoveFromSlot(slot, docs.koNames, docs.typeKoDoc);
    // F40 (2026-05-23): moveTagsDoc 는 docs 묶음에 미리 들어 있음 — SW 가 1회 로드.
    var moveTagsDoc = (docs && docs.moveTagsDoc) || { moves: {} };
    out.attackerMove =
      buildAttackerMovePayload(movePack, docs.typeKoDoc, moveTagsDoc, docs.moveSlugToEnDoc) ||
      defaultAttackerMovePayload(docs.typeKoDoc, moveTagsDoc, docs.moveSlugToEnDoc);
    return Promise.resolve(out);
  }

  /**
   * 팀빌더 슬롯 객체 한 개를 한쪽 패널 페이로드로 변환. 외부 fetch 없음.
   * @param {object} slot 팀빌더 bridge 가 준 single slot (slotRead.js 모양)
   * @param {'attacker'|'defender'} side 어느 패널에 적용할지
   * @param {object} docs background.js loadCalcPayloadDocs() 의 doc 묶음
   * @returns {Promise<object>} buildOneSideFromFlatSlot 의 페이로드 하나
   */
  function buildSidePayloadFromSlot(slot, side, docs, page) {
    return buildOneSideFromFlatSlot(slot, docs || {}, side === 'defender' ? 'defender' : 'attacker', page === 'speed' ? 'speed' : 'calc');
  }

  globalThis.nuoCalcPayload = {
    buildSidePayloadFromSlot: buildSidePayloadFromSlot,
  };
})();
