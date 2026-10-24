/**
 * 팀빌더 좌측 샘플 카드 인라인: 결정력(기술명 직후) · 우상단 물리/특수 내구.
 *
 * F6: 옛 teamBuilderFill.js 에서 분리. 복사 진입점(teamBuilderFill) 과 인라인 어노테이션은
 * 독립된 시스템이라 한 IIFE 에 묶을 이유가 없었음. 분리 후 각 파일이 ~700 / ~1400 줄.
 *
 * 의존: globalThis.nuoCsCommon (calcFillShared.js), globalThis.nuoTeamBuilderShared
 * (teamBuilderShared.js). manifest 에서 두 파일이 본 파일보다 먼저 로드되도록 순서 고정.
 */
(function () {
  'use strict';

  var CS = globalThis.nuoCsCommon || {};
  var TBS = globalThis.nuoTeamBuilderShared || {};
  // R2/T1: 옛 "계산기 화면이면 hide" 의 음의 정의 → "팀빌더 화면이면 show" 양의 정의.
  var isTeamBuilderRoute = CS.isTeamBuilderRoute || function () { return true; };
  var isSmartnuoHost = TBS.isSmartnuoHost;
  var injectTeamBridgeOnce = TBS.injectTeamBridgeOnce;
  var getSlotsFromBridge = TBS.getSlotsFromBridge;

  if (typeof isSmartnuoHost !== 'function' || typeof getSlotsFromBridge !== 'function') {
    // shared 가 못 올라온 경우 — 안전하게 종료. manifest 순서 점검.
    return;
  }

  var TB_INLINE_STYLE_ID = 'nuo-fmt-tb-inline-annot-style';
  var LOCAL_TB_INLINE = 'nuo_fmt_tbInlineEnabled';
  var tbInlineGen = 0;
  var tbInlineTimer = null;
  var tbInlineMo = null;
  var tbMoTouchSlot =
    typeof TBS.tbMoRecordsTouchSlotList === 'function'
      ? TBS.tbMoRecordsTouchSlotList
      : function () {
          return true;
        };
  var tbInlineAnnotInited = false;
  var tbInlineHandlersWired = false;
  var tbInlineEnabled = true;

  function tbInlineAnyEnabled() {
    return tbInlineEnabled;
  }

  function refreshTbInlineOpt(done) {
    chrome.storage.local.get(
      [LOCAL_TB_INLINE],
      function (got) {
        if (chrome.runtime.lastError) {
          tbInlineEnabled = true;
        } else {
          tbInlineEnabled = got[LOCAL_TB_INLINE] !== false;
        }
        if (typeof done === 'function') done();
      }
    );
  }

  function ensureTbInlineStyle() {
    if (document.getElementById(TB_INLINE_STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = TB_INLINE_STYLE_ID;
    st.textContent =
      '.nuo-fmt-tb-ann{font-size:9px;font-weight:400;color:#888;display:inline;}' +
      '.nuo-fmt-tb-ann-num{white-space:nowrap;}' +
      // 두 줄로 꺾인 기술만: 사이트 행 높이(18.75px) 고정이라 줄간격 압축 + 결정력 글씨 축소로 옆 줄 겹침 방지
      '[data-nuo-tb-wrap]{line-height:10px !important;}' +
      '[data-nuo-tb-wrap] .nuo-fmt-tb-ann{display:block;font-size:8px;line-height:9px;}' +
      '.nuo-fmt-tb-bulk-corner{position:absolute;top:8px;right:10px;font-size:9px;font-weight:400;color:#888;line-height:1.2;text-align:right;white-space:nowrap;pointer-events:none;z-index:4;}';
    document.head.appendChild(st);
  }

  function clearTbInlineAnnotations() {
    document.querySelectorAll('[data-nuo-tb-ann="1"]').forEach(function (n) {
      try {
        if (n.parentNode) n.parentNode.removeChild(n);
      } catch (e) {}
    });
    document.querySelectorAll('[data-nuo-tb-wrap]').forEach(function (n) {
      n.removeAttribute('data-nuo-tb-wrap');
    });
  }

  function tbExtHostSelector() {
    return '[data-nuo-inject]';
  }

  function isInTbExtHost(el) {
    if (!el || typeof el.closest !== 'function') return false;
    return !!el.closest(tbExtHostSelector());
  }

  /** 팀빌더 좌측 슬롯 리스트 루트 — DOM 변경 시 teamBuilderShared.getTbSlotListRoot 와 같이 갱신. */
  function findSlotCardByIndex(slotIdx) {
    if (slotIdx < 0 || slotIdx > 5) return null;
    try {
      var list = typeof TBS.getTbSlotListRoot === 'function' ? TBS.getTbSlotListRoot() : null;
      if (!list || !list.children) return null;
      var wrapper = list.children[slotIdx + 1];
      if (!wrapper || !wrapper.children) return null;
      var body = wrapper.children[1] || wrapper.children[0];
      return body || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * filled[i] 가 true 인 슬롯만 카드 body 매핑 (옛 sprite URL 매칭 대체).
   */
  function mapSlotsToCardEls(filled) {
    var out = [null, null, null, null, null, null];
    for (var i = 0; i < 6; i++) {
      if (filled && filled[i]) out[i] = findSlotCardByIndex(i);
    }
    return out;
  }

  /** want 문자열이 기술명 매칭에서 제외되는지(옛 findExactTextNodeHost 와 동일). */
  function tbMoveWantSkippable(want) {
    want = String(want || '').trim();
    if (!want || want === '--' || want.length > 48) return true;
    return false;
  }

  /**
   * 후보 element 배열에서 leaf-most 하나 선택(옛 findExactTextNodeHost 와 동일 규칙).
   * @param {Element[]} matches
   * @returns {Element|null}
   */
  function tbPickLeafMostHost(matches) {
    if (!matches || !matches.length) return null;
    var j;
    var k;
    var m;
    var hasInner;
    for (j = 0; j < matches.length; j++) {
      m = matches[j];
      hasInner = false;
      for (k = 0; k < matches.length; k++) {
        if (j === k) continue;
        if (m.contains(matches[k])) {
          hasInner = true;
          break;
        }
      }
      if (!hasInner) return m;
    }
    return matches[matches.length - 1];
  }

  /**
   * 카드 내 4기술 표시명에 대응하는 호스트 element 를 TreeWalker 1패스로 찾는다(F37 옵션 C).
   * @param {Element} cardRoot
   * @param {string[]} want4 길이 4 (moveNames)
   * @returns {(Element|null)[]} 길이 4, 못 찾은 칸은 null
   */
  function mapMoveNamesToHostsInCard(cardRoot, want4) {
    var out = [null, null, null, null];
    if (!cardRoot || cardRoot.nodeType !== 1) return out;
    var buckets = [[], [], [], []];
    var walker;
    try {
      walker = document.createTreeWalker(cardRoot, NodeFilter.SHOW_TEXT, null, false);
    } catch (eTw) {
      return out;
    }
    var node;
    var t;
    var pe;
    var mi;
    var wantStr;
    while (walker.nextNode()) {
      node = walker.currentNode;
      t = String(node.nodeValue || '').trim();
      if (!t) continue;
      pe = node.parentElement;
      if (!pe || pe.nodeType !== 1) continue;
      if (isInTbExtHost(pe)) continue;
      try {
        if (pe.querySelector('.nuo-fmt-tb-ann')) continue;
      } catch (eQ) {}
      if (pe.children.length > 6) continue;
      for (mi = 0; mi < 4; mi++) {
        wantStr = want4 && want4[mi] != null ? String(want4[mi]).trim() : '';
        if (tbMoveWantSkippable(wantStr)) continue;
        if (t !== wantStr) continue;
        buckets[mi].push(pe);
      }
    }
    for (mi = 0; mi < 4; mi++) {
      out[mi] = tbPickLeafMostHost(buckets[mi]);
    }
    return out;
  }

  function requestSlotAnnot(slotData) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'ANNOTATE_BUILDER_SLOT', slotData: slotData }, function (r) {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(r && r.ok ? r : null);
      });
    });
  }

  function applyMovePowerSuffixes(cardRoot, moveNames, suff) {
    if (!Array.isArray(suff)) return;
    var hosts = mapMoveNamesToHostsInCard(cardRoot, moveNames);
    var added = [];
    var mi;
    for (mi = 0; mi < 4; mi++) {
      var suf = suff[mi];
      if (!suf) continue;
      var name = moveNames[mi];
      if (!name || name === '--') continue;
      var el = hosts[mi];
      if (!el) continue;
      if (el.querySelector('.nuo-fmt-tb-ann')) continue;
      // 기술명(한글)과 결정력이 한 줄에 안 들어갈 때 한글 이름 중간이 아닌 이름/결정력
      // 경계에서 줄바꿈되도록 보장:
      //   - el.style.wordBreak = 'keep-all' : 한글은 한 덩어리로 취급(글자 사이 분리 금지)
      //   - outer span(.nuo-fmt-tb-ann)은 nowrap 미적용, 시작에 일반 공백 → 거기서 끊김 허용
      //   - inner span(.nuo-fmt-tb-ann-num)에만 nowrap → "(5040→7560)" 내부 분리 방지
      try {
        el.style.wordBreak = 'keep-all';
      } catch (eWb) {}
      var span = document.createElement('span');
      span.className = 'nuo-fmt-tb-ann';
      span.setAttribute('data-nuo-tb-ann', '1');
      var inner = document.createElement('span');
      inner.className = 'nuo-fmt-tb-ann-num';
      inner.textContent = suf;
      span.appendChild(document.createTextNode(' '));
      span.appendChild(inner);
      el.appendChild(span);
      added.push([el, inner]);
    }
    // 부착을 모두 끝낸 뒤 한 번에 측정(레이아웃 1회). 결정력이 기술명 아래 줄로 내려갔으면 꺾임.
    added.forEach(function (p) {
      try {
        if (p[1].getBoundingClientRect().top - p[0].getBoundingClientRect().top > 5) {
          p[0].setAttribute('data-nuo-tb-wrap', '1');
        }
      } catch (eWr) {}
    });
  }

  /** 물리내구/특수내구 최종값만 `숫자/숫자`, 슬롯 카드 우상단 */
  function applyBulkCorner(cardRoot, bulkCompact) {
    if (!bulkCompact || !String(bulkCompact).trim()) return;
    try {
      var cs = window.getComputedStyle(cardRoot);
      if (cs.position === 'static') {
        cardRoot.style.position = 'relative';
        cardRoot.setAttribute('data-nuo-tb-rel', '1');
      }
    } catch (ePos) {}
    var div = document.createElement('div');
    div.className = 'nuo-fmt-tb-bulk-corner';
    div.setAttribute('data-nuo-tb-ann', '1');
    div.textContent = String(bulkCompact).trim();
    cardRoot.appendChild(div);
  }

  function scheduleTeamBuilderInlineAnnotate() {
    if (!isSmartnuoHost()) return;
    if (!tbInlineAnyEnabled()) return;
    clearTimeout(tbInlineTimer);
    // 연속 변화 묶기용. 한 사이클 ≈10ms·사이트 카드 갱신 ≈6ms (2026-10-23 실측) — 옛 520ms 는 근거 없음.
    tbInlineTimer = setTimeout(function () {
      runTeamBuilderInlineAnnotate();
    }, 50);
  }

  function tbReconnectMo() {
    try {
      if (tbInlineMo && document.body) {
        tbInlineMo.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
    } catch (eRe) {}
  }

  function runTeamBuilderInlineAnnotate() {
    if (!isSmartnuoHost()) return;
    if (!tbInlineAnyEnabled()) {
      clearTbInlineAnnotations();
      return;
    }
    if (!isTeamBuilderRoute()) {
      clearTbInlineAnnotations();
      return;
    }
    var mo = tbInlineMo;
    if (mo) {
      try {
        mo.disconnect();
      } catch (eDisc) {}
    }
    var myGen = ++tbInlineGen;
    injectTeamBridgeOnce()
      .then(function () {
        return getSlotsFromBridge();
      })
      .then(function (r) {
        if (myGen !== tbInlineGen) return null;
        if (!isTeamBuilderRoute()) {
          clearTbInlineAnnotations();
          return null;
        }
        if (!r || !r.ok || !r.slots) {
          clearTbInlineAnnotations();
          return null;
        }
        // C-5a/b: 인라인 어노테이션도 슬롯 데이터를 받았으니 hot snapshot + 캐시 mirror.
        // FAB 가 안 떠 있어도(옵션 OFF) 인라인이 켜져 있으면 이쪽이 single source.
        if (typeof TBS.setSlotSnapshot === 'function') {
          TBS.setSlotSnapshot({ slots: r.slots, slotArt: r.slotArt });
        }
        ensureTbInlineStyle();
        var filled = r.filled || [];
        var cardMap = mapSlotsToCardEls(filled);
        // Phase 1: 슬롯별 어노테이션을 비동기로 모두 수집. 기존 어노테이션은 그대로 두어
        // 사용자에게는 stale 한 값이 잠깐 보이지만, "빈 상태"는 아예 노출되지 않음.
        var jobs = [];
        var si;
        for (si = 0; si < 6; si++) {
          if (!filled[si]) continue;
          var sd = r.slots[si];
          var cardEl = cardMap[si];
          if (!cardEl) continue;
          (function (slotData, card) {
            jobs.push(
              requestSlotAnnot(slotData).then(function (ann) {
                if (!ann || ann.empty) return null;
                return { slotData: slotData, card: card, ann: ann };
              })
            );
          })(sd, cardEl);
        }
        return Promise.all(jobs);
      })
      .then(function (results) {
        if (myGen !== tbInlineGen) return;
        if (!results) return;
        // Phase 2: 새 데이터가 모두 도착했으니 한 동기 블록에서 atomic swap —
        // 기존 어노테이션 제거 직후 곧바로 새 어노테이션 부착. 브라우저는 중간 프레임을
        // 그리지 않으므로 사용자 시각에는 깜빡임 없이 값이 바뀐 것처럼 보임.
        clearTbInlineAnnotations();
        results.forEach(function (item) {
          if (!item) return;
          var names = globalThis.nuoSlotRead.moves(item.slotData);
          var card = item.card;
          if (!card) return;
          if (tbInlineEnabled) {
            applyMovePowerSuffixes(card, names, item.ann.movePowerSuffixes || []);
            applyBulkCorner(card, item.ann.bulkCompact || '');
          }
        });
      })
      .catch(function () {
        if (myGen === tbInlineGen) clearTbInlineAnnotations();
      })
      .then(function () {
        if (myGen !== tbInlineGen) return;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            tbReconnectMo();
          });
        });
      });
  }

  function wireTbInlineObserverHandlers() {
    if (tbInlineHandlersWired) return;
    tbInlineHandlersWired = true;
    var onDom = function () {
      scheduleTeamBuilderInlineAnnotate();
    };
    window.addEventListener('hashchange', onDom);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleTeamBuilderInlineAnnotate();
    });
    // R3: SPA pushState 라우트 전환 시 어노테이션 즉시 갱신/제거.
    if (CS && CS.onRouteChange) {
      CS.onRouteChange(onDom);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDom);
    } else {
      scheduleTeamBuilderInlineAnnotate();
    }
  }

  function tbEnsureMutationObserver() {
    if (!tbInlineAnyEnabled() || tbInlineMo) return;
    tbInlineMo = new MutationObserver(function (records) {
      if (!tbMoTouchSlot(records)) return;
      scheduleTeamBuilderInlineAnnotate();
    });
    try {
      tbInlineMo.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (eMo) {}
  }

  function initTeamBuilderInlineAnnotate() {
    if (!isSmartnuoHost()) return;
    if (tbInlineAnnotInited) return;
    tbInlineAnnotInited = true;

    wireTbInlineObserverHandlers();

    refreshTbInlineOpt(function () {
      tbEnsureMutationObserver();
      if (tbInlineAnyEnabled()) scheduleTeamBuilderInlineAnnotate();
    });

    // F13: shared 헬퍼로 storage 변경 핸들러 보일러플레이트 통합.
    var TB_INLINE_PREF_KEYS = [LOCAL_TB_INLINE];
    if (CS && CS.onLocalPrefChange) {
      CS.onLocalPrefChange(TB_INLINE_PREF_KEYS, function () {
        refreshTbInlineOpt(function () {
          if (!tbInlineAnyEnabled()) {
            try { if (tbInlineMo) tbInlineMo.disconnect(); } catch (e0) {}
            tbInlineMo = null;
            clearTbInlineAnnotations();
            return;
          }
          tbEnsureMutationObserver();
          scheduleTeamBuilderInlineAnnotate();
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTeamBuilderInlineAnnotate);
  } else {
    initTeamBuilderInlineAnnotate();
  }
})();
