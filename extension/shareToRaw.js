/**
 * Smartnuo GET /api/party/share/:id JSON → formatSingleSample 이 기대하는 줄글.
 * 슬롯 필드 읽기는 slotRead.js (nuoSlotRead) — 본 파일은 줄글 조립·공유 응답 해석만.
 */
(function (global) {
  'use strict';

  var SL = global.nuoSlotRead;
  var STAT_LABELS_KO = ['HP', '공격', '방어', '특수공격', '특수방어', '스피드'];

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

  var REAL_LETTERS_SIX = ['H', 'A', 'B', 'C', 'D', 'S'];

  /**
   * 팀빌더 슬롯 → formatter.formatBulkLinesFromReals 용 실수치 맵.
   * @param {object} slot
   * @returns {Record<string, number>}
   */
  function realByLetterFromSlot(slot) {
    if (SL.isEmpty(slot)) return {};
    var out = {};
    var i;
    for (i = 0; i < 6; i++) out[REAL_LETTERS_SIX[i]] = SL.stat(slot, i).real;
    return out;
  }

  /**
   * @param {object} slot
   * @param {number} blockIndex1Based 파티 슬롯 번호(빈 슬롯 표기용). 비넘버 제목일 때는 1 넘겨도 됨.
   * @param {{ numberedTitle?: boolean }|undefined} opts 파티만 true → 샘플명 있으면 `#1 | …`, 없으면 `#1` + 다음 줄 종명
   * @returns {string}
   */
  function shareSlotToRaw(slot, blockIndex1Based, opts) {
    opts = opts || {};
    var numbered = opts.numberedTitle === true;

    var idx = blockIndex1Based | 0;
    if (idx < 1) idx = 1;

    if (SL.isEmpty(slot)) {
      var headEmpty = numbered ? '#' + idx : '--';
      var linesE = [headEmpty, '특성 : --', '도구 : --', '성격 : --'];
      var si;
      for (si = 0; si < 6; si++) {
        linesE.push(STAT_LABELS_KO[si] + ' : 0 0');
      }
      linesE.push('기술1 : --');
      linesE.push('기술2 : --');
      linesE.push('기술3 : --');
      linesE.push('기술4 : --');
      return linesE.join('\n');
    }

    var sampleTitle = SL.sampleName(slot);
    var speciesLine = SL.speciesKo(slot);
    var lines = [];
    if (numbered) {
      lines.push(sampleTitle ? '#' + idx + ' | ' + sampleTitle : '#' + idx);
    } else if (sampleTitle) {
      lines.push(sampleTitle);
    }
    if (speciesLine && (!sampleTitle || speciesLine !== sampleTitle)) {
      lines.push(speciesLine);
    }
    if (!lines.length) {
      lines.push(numbered ? '#' + idx : '--');
    }

    lines.push('특성 : ' + (SL.ability(slot) || '--'));
    lines.push('도구 : ' + (SL.item(slot) || '--'));
    lines.push('성격 : ' + (SL.nature(slot) || '--'));

    var ter = SL.tera(slot);
    if (ter) lines.push('테라스탈 : ' + ter);

    var i;
    for (i = 0; i < 6; i++) {
      var st = SL.stat(slot, i);
      lines.push(STAT_LABELS_KO[i] + ' : ' + st.real + ' ' + st.sp);
    }

    var moves = SL.moves(slot);
    for (i = 0; i < 4; i++) {
      lines.push('기술' + (i + 1) + ' : ' + (moves[i] || '--'));
    }

    return lines.join('\n');
  }

  global.shareToRaw = {
    classifyShareGetResponse: classifyShareGetResponse,
    shareSlotToRaw: shareSlotToRaw,
    realByLetterFromSlot: realByLetterFromSlot,
    extractPsId: extractPsId,
    normalizePartyUrlInput: normalizePartyUrlInput,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
