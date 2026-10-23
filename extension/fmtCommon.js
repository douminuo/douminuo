/**
 * formatter.js · simpleMovePower.js 공통: 도구/특성/항목 라벨 정규화.
 * popup: fmtCommon → formatter 순서. SW: fmtCommon → simpleMovePower 순서.
 */
(function (g) {
  'use strict';

  function readLabel(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object' && v.name != null) return readLabel(v.name);
    if (typeof v === 'object' && v.label != null) return readLabel(v.label);
    if (typeof v === 'object' && v.title != null) return readLabel(v.title);
    return String(v).trim();
  }

  function normalizeMatchKey(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function slugifyForMatch(s) {
    return normalizeMatchKey(s).replace(/\s+/g, '-');
  }

  function collectHoldLabels(hold) {
    var out = [];
    var seen = {};
    function pushRaw(s) {
      var t = readLabel(s);
      if (!t || t === '--') return;
      var k = normalizeMatchKey(t);
      if (seen[k]) return;
      seen[k] = true;
      out.push(t);
    }
    if (hold == null) return out;
    if (typeof hold !== 'object' || Array.isArray(hold)) {
      pushRaw(hold);
      return out;
    }
    // C3: 호출자(simpleMovePower·showdownPaste)가 SR.str() 로 정규화 후 전달.
    // 여기까지 객체가 오는 경우는 방어 폴백 — Nuxt 슬롯 kr 단일 필드 우선.
    pushRaw(hold.kr != null ? hold.kr : (hold.name_kr || hold.nameKr || hold.name || ''));
    return out;
  }

  /** F38: map 객체당 정규화 키 인덱스 — slug in map 순서 first-set-wins. */
  var sectionIxCache = new WeakMap();

  function buildSectionIx(map) {
    var out = Object.create(null);
    if (!map || typeof map !== 'object') return out;
    function push(rawKey, slug, rule) {
      if (rawKey == null || rawKey === '') return;
      var key = normalizeMatchKey(rawKey);
      if (key && !out[key]) out[key] = { slug: String(slug), rule: rule };
    }
    var slug;
    var rule;
    var ai;
    for (slug in map) {
      if (!Object.prototype.hasOwnProperty.call(map, slug)) continue;
      rule = map[slug];
      push(slug, slug, rule);
      push(String(slug).replace(/-/g, ' '), slug, rule);
      push(slugifyForMatch(slug), slug, rule);
      if (rule && rule.nameKo) push(rule.nameKo, slug, rule);
      if (rule && Array.isArray(rule.aliases)) {
        for (ai = 0; ai < rule.aliases.length; ai++) push(rule.aliases[ai], slug, rule);
      }
    }
    return out;
  }

  /**
   * modifiers.json 의 items/abilities 맵에서 라벨(한글/영문/별칭)에 해당하는 { slug, rule } 검색.
   * formatter.js / showdownPaste.js / simpleMovePower.js 공용.
   */
  function findRuleAndSlugInMap(map, label) {
    var lab = readLabel(label);
    if (!lab || lab === '--') return null;
    if (!map || typeof map !== 'object') return null;

    var want = normalizeMatchKey(lab);
    var wantSlug = slugifyForMatch(lab);
    var ix = sectionIxCache.get(map);
    if (!ix) {
      ix = buildSectionIx(map);
      sectionIxCache.set(map, ix);
    }
    return ix[want] || ix[wantSlug] || null;
  }

  /**
   * hold(도구/특성 원본 값)를 라벨로 정규화해 map 에서 첫 매치 { slug, rule } 반환.
   * formatter.js / showdownPaste.js / simpleMovePower.js 공용.
   */
  function findFirstRuleAndSlugForHold(map, holdRaw) {
    if (!map) return null;
    var labels = collectHoldLabels(holdRaw);
    var li;
    for (li = 0; li < labels.length; li++) {
      var found = findRuleAndSlugInMap(map, labels[li]);
      if (found) return found;
    }
    return null;
  }

  /**
   * 종 한정 도구(전기구슬·굵은뼈 등): rule.speciesKo 의 종명 중 하나가 speciesText 에 들어 있어야 적용.
   * speciesKo 없는 rule·null 은 항상 true. formatter.js / simpleMovePower.js 공용.
   */
  function ruleFitsSpecies(rule, speciesText) {
    if (!rule || !Array.isArray(rule.speciesKo)) return true;
    var t = String(speciesText || '');
    var i;
    for (i = 0; i < rule.speciesKo.length; i++) {
      if (t.indexOf(rule.speciesKo[i]) !== -1) return true;
    }
    return false;
  }

  g.nuoFmtCommon = {
    readLabel: readLabel,
    normalizeMatchKey: normalizeMatchKey,
    slugifyForMatch: slugifyForMatch,
    collectHoldLabels: collectHoldLabels,
    findRuleAndSlugInMap: findRuleAndSlugInMap,
    findFirstRuleAndSlugForHold: findFirstRuleAndSlugForHold,
    ruleFitsSpecies: ruleFitsSpecies,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
