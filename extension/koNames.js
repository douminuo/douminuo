/**
 * 한글 이름 해석 — 도구·특성·기술 라벨(한글·영문·slug·{kr} 객체) → slug (기술은 Showdown id) + modifiers 규칙.
 * 우선순위 (세 종류 공통): ① 사이트 표기(*KoFallback.json) ② modifiers nameKo·aliases·slug ③ PokéAPI 표기(*KoMap.json)
 * ④ 영문/slug 모양이면 그대로 정규화. 비교 키 = 소문자 + 공백·하이픈·따옴표·점 제거 (KO_NAMES_PLAN §2).
 * SW 전용 (importScripts: fmtCommon 다음).
 */
(function (g) {
  'use strict';

  var FC = g.nuoFmtCommon;

  function matchKey(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[\s\-'’.]/g, '');
  }

  /** 사이트 슬롯 값 → 라벨 문자열. 객체면 kr 우선 (사이트 {en, kr}·슬롯 {kr} 모양). */
  function labelOf(v) {
    if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      var k = v.kr != null ? v.kr : v.name_kr != null ? v.name_kr : v.nameKr;
      if (k != null && String(k).trim()) return FC.readLabel(k);
    }
    var t = FC.readLabel(v);
    return t === '--' ? '' : t;
  }

  /** key → slug 인덱스. 먼저 넣은 쪽이 이김 (first-set-wins) — 넣는 순서 = 우선순위. */
  function buildIx(siteDoc, modSection, mapDoc) {
    var ix = Object.create(null);
    function put(label, slug) {
      var k = matchKey(label);
      if (k && slug && !ix[k]) ix[k] = String(slug);
    }
    function putByKo(doc) {
      var byKo = doc && doc.byKo;
      var k;
      for (k in byKo) if (Object.prototype.hasOwnProperty.call(byKo, k)) put(k, byKo[k]);
    }
    putByKo(siteDoc);
    var slug;
    var rule;
    var i;
    for (slug in modSection || {}) {
      if (!Object.prototype.hasOwnProperty.call(modSection, slug)) continue;
      rule = modSection[slug];
      put(slug, slug);
      if (rule && rule.nameKo) put(rule.nameKo, slug);
      if (rule && Array.isArray(rule.aliases)) for (i = 0; i < rule.aliases.length; i++) put(rule.aliases[i], slug);
    }
    putByKo(mapDoc);
    return ix;
  }

  var ASCII_LABEL = /^[a-z0-9][a-z0-9 \-'’.]*$/i;

  function makeKind(ix, asId) {
    return function (raw) {
      var lab = labelOf(raw);
      if (!lab) return '';
      var hit = ix[matchKey(lab)];
      if (hit) return hit;
      if (!ASCII_LABEL.test(lab)) return '';
      // ④ 영문 이름·slug 통과: 기술 = Showdown id(영숫자만), 도구·특성 = PokéAPI slug(하이픈).
      var low = lab.toLowerCase().replace(/['’.]/g, '');
      return asId ? low.replace(/[^a-z0-9]/g, '') : low.trim().replace(/[\s-]+/g, '-');
    };
  }

  var cache = new WeakMap();

  /**
   * @param {{ modifiers: object, itemMap: object, itemSite: object, abilityMap: object, abilitySite: object,
   *   moveMap: object, moveSite: object }} docs  — 같은 docs 객체면 인덱스 재사용 (WeakMap)
   * @returns {{ item: function(*): string, ability: function(*): string, move: function(*): string,
   *   itemRule: function(*): ({slug: string, rule: object}|null), abilityRule: function(*): ({slug: string, rule: object}|null) }}
   */
  function forDocs(docs) {
    var hit = cache.get(docs);
    if (hit) return hit;
    var mod = docs.modifiers || {};
    var items = mod.items || {};
    var abilities = mod.abilities || {};
    var item = makeKind(buildIx(docs.itemSite, items, docs.itemMap), false);
    var ability = makeKind(buildIx(docs.abilitySite, abilities, docs.abilityMap), false);
    function ruleOf(section, slug) {
      return slug && Object.prototype.hasOwnProperty.call(section, slug) ? { slug: slug, rule: section[slug] } : null;
    }
    var api = {
      item: item,
      ability: ability,
      move: makeKind(buildIx(docs.moveSite, null, docs.moveMap), true),
      itemRule: function (raw) { return ruleOf(items, item(raw)); },
      abilityRule: function (raw) { return ruleOf(abilities, ability(raw)); },
    };
    cache.set(docs, api);
    return api;
  }

  g.nuoKoNames = { forDocs: forDocs, matchKey: matchKey };
})(typeof globalThis !== 'undefined' ? globalThis : self);
