/**
 * formatter.js · simpleMovePower.js · showdownPaste.js · koNames.js 공통: 라벨 읽기·종 한정 도구 판정.
 * 도구·특성·기술 이름 → slug·규칙 = koNames.js. SW: fmtCommon → koNames → … 순서.
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
    ruleFitsSpecies: ruleFitsSpecies,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
