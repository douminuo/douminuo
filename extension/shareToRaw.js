/**
 * 스마트누오 공유 URL·응답 해석 (`#ps=` id, GET /api/party/share/:id 응답 모양).
 * 요약 텍스트 조립은 formatter.formatSlotsText (슬롯에서 바로).
 */
(function (global) {
  'use strict';

  function extractPsId(s) {
    var m = String(s).match(/[#&?]ps=([^&#'"\s]+)/i);
    return m ? m[1].trim() : null;
  }

  function normalizePartyUrlInput(input) {
    var strIn = String(input || '').trim();
    if (!strIn) return null;
    if (/^https?:\/\//i.test(strIn)) return strIn;
    if (/^#ps=/i.test(strIn)) return 'https://smartnuo.com/' + strIn;
    return 'https://smartnuo.com/#ps=' + encodeURIComponent(strIn);
  }

  function unwrapShareJson(j) {
    if (!j) throw new Error('empty_response');
    if (j.error === true || j.error === 'true') throw new Error('share_not_found');
    if (j.error && j.error !== false) throw new Error(String(j.error));
    return j.data !== undefined ? j.data : j;
  }

  /**
   * 호출자 0 (공유 URL 입력은 2026-09 리디자인 때 없어짐) — 사용자 결정으로 유지. 지우기 전에 물을 것.
   * @returns {{ type: 'party', slots: object[] } | { type: 'single', slot: object }}
   */
  function classifyShareGetResponse(j) {
    var pack = unwrapShareJson(j);

    // Phase 2.D: 래퍼 한 겹 추가 — pack.data 가 실제 파티/단일 페이로드. 옛 폴백은 아래 분기 유지.
    if (pack && typeof pack === 'object' && pack.data !== undefined && pack.data !== null) {
      var d = pack.data;
      if (d && typeof d === 'object' && d.all === true && Array.isArray(d.data)) {
        return { type: 'party', slots: d.data };
      }
      if (Array.isArray(d)) {
        if (d.length >= 2) return { type: 'party', slots: d };
        if (d.length === 1) return { type: 'single', slot: d[0] };
        throw new Error('unknown_share_shape');
      }
      if (d && typeof d === 'object' && d.pokemon) {
        return { type: 'single', slot: d };
      }
      if (d && typeof d === 'object' && typeof d.slot === 'number' && d.data && d.data.pokemon) {
        pack = d;
      }
    }

    /** 단일 샘플: { slot, data: { sampleName, pokemon, nameKr, movesKr } } */
    if (pack && typeof pack.slot === 'number' && pack.data && pack.data.pokemon) {
      return { type: 'single', slot: pack.data };
    }

    if (Array.isArray(pack)) {
      if (pack.length >= 2) return { type: 'party', slots: pack };
      if (pack.length === 1) return { type: 'single', slot: pack[0] };
      throw new Error('unknown_share_shape');
    }

    if (pack && pack.all === true && Array.isArray(pack.data)) {
      return { type: 'party', slots: pack.data };
    }

    if (pack && Array.isArray(pack.data) && pack.data.length >= 2) {
      return { type: 'party', slots: pack.data };
    }

    if (pack && Array.isArray(pack.data) && pack.data.length === 1) {
      return { type: 'single', slot: pack.data[0] };
    }

    if (pack && pack.all === false && pack.data && typeof pack.data === 'object' && !Array.isArray(pack.data)) {
      return { type: 'single', slot: pack.data };
    }

    if (pack && typeof pack === 'object' && !Array.isArray(pack)) {
      var inner = pack.data;
      if (inner && typeof inner === 'object' && !Array.isArray(inner) && pack.all !== true) {
        if (inner.moves || inner.species || inner.pokemon || inner.name || inner.item) {
          return { type: 'single', slot: inner };
        }
      }
      if ((pack.moves || pack.species || pack.pokemon || pack.name || pack.item || pack.ability) && !Array.isArray(pack)) {
        return { type: 'single', slot: pack };
      }
    }

    throw new Error('unknown_share_shape');
  }

  global.shareToRaw = {
    classifyShareGetResponse: classifyShareGetResponse,
    extractPsId: extractPsId,
    normalizePartyUrlInput: normalizePartyUrlInput,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
