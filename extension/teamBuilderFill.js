/**
 * 스마트누오 파티(팀빌더) 페이지 복사 아이콘 — 사이트 슬롯 `#N` 아이콘 줄 · `파티 리스트` 초록
 * 그룹에 합류 (REDESIGN §4.1 B). 슬롯 요약 복사·샘플 저장 / 파티 복사·파티 저장 (저장 흐름은 sampleParty.js). 서버·포맷 로직은 기존과 동일.
 * 복사 옵션 UI 는 환경설정(popup)으로 이관 — 여기선 chrome.storage.local 값만 읽음.
 * 피드백 = 사이트 아이콘 줄 방식 — hover 툴팁 없음, 성공은 클릭 후 아이콘 위 말풍선
 * ("샘플 복사 완료" 1.5s — 사이트 실측), 오류는 사이트처럼 네이티브 alert.
 * 슬롯 갱신: MutationObserver + hashchange + 라우트 전환. 슬롯 스냅샷(hot/캐시)은 계산기
 * "내 파티" 줄이 읽는다.
 *
 * F6: 인라인 어노테이션은 teamBuilderInlineAnnot.js, 공용 유틸은 teamBuilderShared.js.
 */
(function () {
  'use strict';

  var SK = {
    includeUrls: 'nuo_fmt_includeUrls',
    includeRealStats: 'nuo_fmt_includeRealStats',
    includeMovePowers: 'nuo_fmt_includeMovePowers',
    includeBulkStats: 'nuo_fmt_includeBulkStats',
    showdownPaste: 'nuo_fmt_showdownPaste',
  };

  var CS = globalThis.nuoCsCommon || {};
  var TBS = globalThis.nuoTeamBuilderShared || {};
  // R2/T1: 옛 "계산기 화면이면 hide" 의 음의 정의 → "팀빌더 화면이면 show" 양의 정의.
  var isTeamBuilderRoute = CS.isTeamBuilderRoute || function () { return true; };
  var injectTeamBridgeOnce = TBS.injectTeamBridgeOnce;
  var getSlotsFromBridge = TBS.getSlotsFromBridge;

  if (typeof getSlotsFromBridge !== 'function' ||
      typeof CS.keepInjected !== 'function') {
    // teamBuilderShared / calcFillShared 가 못 올라왔으면 안전하게 종료. manifest 순서 점검.
    return;
  }

  function mapErr(code) {
    return typeof globalThis.mapCalcFillError === 'function'
      ? globalThis.mapCalcFillError(code)
      : String(code || '');
  }

  function copyTextBestEffort(text) {
    var s = text != null ? String(text) : '';
    if (!s) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).catch(function () {
        copyViaTextarea(s);
      });
      return;
    }
    copyViaTextarea(s);
  }

  function copyViaTextarea(s) {
    var ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ===== 복사 옵션 (값은 popup 이 씀) ===== */

  var FORMAT_LOCAL_OPT_KEYS = [
    SK.includeUrls,
    SK.includeRealStats,
    SK.includeMovePowers,
    SK.includeBulkStats,
    SK.showdownPaste,
  ];

  function migrateSessionFormatToLocalIfNeeded(done) {
    chrome.storage.local.get(FORMAT_LOCAL_OPT_KEYS, function (lg) {
      if (chrome.runtime.lastError) {
        if (typeof done === 'function') done();
        return;
      }
      var has = false;
      var i;
      for (i = 0; i < FORMAT_LOCAL_OPT_KEYS.length; i++) {
        if (typeof lg[FORMAT_LOCAL_OPT_KEYS[i]] === 'boolean') {
          has = true;
          break;
        }
      }
      if (has) {
        if (typeof done === 'function') done();
        return;
      }
      chrome.storage.session.get(FORMAT_LOCAL_OPT_KEYS, function (sg) {
        if (chrome.runtime.lastError) {
          if (typeof done === 'function') done();
          return;
        }
        var patch = {};
        var j;
        for (j = 0; j < FORMAT_LOCAL_OPT_KEYS.length; j++) {
          var k = FORMAT_LOCAL_OPT_KEYS[j];
          if (typeof sg[k] === 'boolean') patch[k] = sg[k];
        }
        if (Object.keys(patch).length === 0) {
          if (typeof done === 'function') done();
          return;
        }
        chrome.storage.local.set(patch, function () {
          if (typeof done === 'function') done();
        });
      });
    });
  }

  function readFormatOptions(callback) {
    migrateSessionFormatToLocalIfNeeded(function () {
      chrome.storage.local.get(FORMAT_LOCAL_OPT_KEYS, function (got) {
        if (chrome.runtime.lastError) {
          callback({
            includeUrls: true,
            includeRealStats: false,
            includeMovePowers: false,
            includeBulkStats: false,
            showdownPaste: false,
          });
          return;
        }
        callback({
          includeUrls: got[SK.includeUrls] !== false,
          includeRealStats: !!got[SK.includeRealStats],
          includeMovePowers: !!got[SK.includeMovePowers],
          includeBulkStats: !!got[SK.includeBulkStats],
          showdownPaste: !!got[SK.showdownPaste],
        });
      });
    });
  }

  /* ===== 사이트 아이콘 줄 합류 (REDESIGN §4.1 B) ===== */

  var SUM_SVG = '<svg class="base" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h7"/></svg>';
  // 샘플·파티 저장 = 북마크 외곽선 (PARTY_PRESET_PLAN §5.1). 사이트 아이콘 = 30px PNG 에 선 ≈2px 외곽선형
  // (2026-09-26 실측) → 16 단위 선 1.3 (1.2 얇음·1.5 두꺼움 — 사용자 조정, 요약 복사 아이콘과 같은 굵기).
  var SAVE_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.5h8v11L8 11l-4 2.5z"/></svg>';
  var EMPTY_MSG = '포켓몬을 먼저 선택해 주세요';
  var ICON_CSS = (globalThis.nuoTokensCss || '') + '\n' + (globalThis.nuoTeamCopyIconsCss || '');
  // 간격은 host 인라인 — .ic 에 두면 host 폭에 섞여 말풍선 중앙이 어긋남. 인라인이라 사이트 preflight 도 이김.
  var HOST_INLINE = 'display:inline-flex;vertical-align:middle;';
  // 우리 두 아이콘만 옅은 배경으로 사이트 아이콘과 구분 (구분선은 초록 그룹이 길어져 `파티 리스트` 라벨에 붙음 — 2026-09-26 사용자 선택).
  // 음수 margin = 배경 padding 만큼 되돌려 줄 높이·그룹 폭을 거의 그대로.
  // 슬롯 줄 = 연회색 칸. 초록 그룹 = 칸 안의 칸이 아니라 그룹 왼쪽 끝까지 채운 연한 구역 (그룹 padding 4px 8px·radius 5 상쇄, 라벨 간격 10 → 8px).
  var SLOT_TINT = 'border-radius:4px;padding:2px 3px;background:#ececec;margin:-2px 2px -2px -3px;';
  var PARTY_TINT = 'border-radius:5px 0 0 5px;padding:4px 4px 4px 6px;background:rgba(255,255,255,.28);margin:-4px 4px -4px -8px;';

  var bridgeReady = false;
  var injectors = [];

  /** `#N` 슬롯 헤더 줄의 사이트 아이콘 컨테이너(img 줄) — 첫 자식 앞 삽입. */
  function findSlotIconRow(idx1) {
    var list = TBS.getTbSlotListRoot ? TBS.getTbSlotListRoot() : null;
    var leaves = CS.findTextLeaves(new RegExp('^#' + idx1 + '$'), list || document.body);
    var i;
    for (i = 0; i < leaves.length; i++) {
      var row = leaves[i].parentElement && leaves[i].parentElement.parentElement;
      var icons = row && row.children && row.children[1];
      if (icons && icons.querySelector('img')) return { parent: icons, before: icons.firstChild };
    }
    return null;
  }

  /** `파티 리스트` 헤더 옆 초록 아이콘 그룹 — 첫 자식 앞 삽입. */
  function findPartyIconGroup() {
    var leaves = CS.findTextLeaves(/^파티 리스트$/);
    var i;
    for (i = 0; i < leaves.length; i++) {
      var grp = leaves[i].nextElementSibling;
      if (grp && grp.querySelector('img')) return { parent: grp, before: grp.firstChild };
    }
    return null;
  }

  /**
   * host 1개 = [복사][저장] 두 버튼 (순서 결정적 — PARTY_PRESET_PLAN §5.1). 버튼마다 피드백 핸들
   * fb = { busy(), idle(), done(text), fail(msg) }. 말풍선은 누른 버튼 위 가운데.
   * @param {string} kind 'slot' | 'party'
   * @param {{ copy: string, save: string }} labels aria-label
   * @param {{ copy: function(object), save: function(object) }} handlers
   * @returns {function} teardown (타이머 정리)
   */
  function buildIcons(root, kind, labels, handlers) {
    root.innerHTML = '<style>' + ICON_CSS + '</style>' +
      '<button type="button" class="ic ' + kind + '" data-a="copy">' + SUM_SVG + '</button>' +
      '<button type="button" class="ic ' + kind + '" data-a="save">' + SAVE_SVG + '</button>' +
      '<div class="tip" role="status" hidden></div>';
    var tip = root.querySelector('.tip');
    var timers = [];
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    [].slice.call(root.querySelectorAll('.ic')).forEach(function (btn) {
      var a = btn.getAttribute('data-a');
      btn.setAttribute('aria-label', labels[a]);
      var fb = {
        busy: function () {
          clearTimers();
          tip.hidden = true;
          btn.classList.add('busy');
          btn.setAttribute('aria-busy', 'true');
        },
        idle: function () {
          btn.classList.remove('busy');
          btn.removeAttribute('aria-busy');
        },
        done: function (text) {
          fb.idle();
          tip.textContent = text || '샘플 복사 완료';
          tip.style.left = (btn.offsetLeft + btn.offsetWidth / 2) + 'px';
          tip.hidden = false;
          timers.push(setTimeout(function () { tip.hidden = true; }, 1500));
        },
        fail: function (msg) {
          fb.idle();
          window.alert(msg ? String(msg) : mapErr(''));
        }
      };
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (btn.classList.contains('busy')) return;
        handlers[a](fb);
      });
    });
    return clearTimers;
  }

  /* ===== 복사 실행 ===== */

  function runCopyPartyShareUrl(fb) {
    if (!isTeamBuilderRoute()) return;
    fb.busy();

    getSlotsFromBridge().then(function (r) {
      var partySlots = r && r.ok && r.slots && r.slots.length === 6 ? r.slots : null;
      if (!partySlots) {
        fb.fail('슬롯을 읽지 못했습니다.'); // runCopySlot 과 같은 문구 — 읽기 실패를 빈 파티로 안내하지 않게
        return;
      }
      if (!Array.isArray(r.filled) || r.filled.indexOf(true) < 0) {
        fb.fail(EMPTY_MSG);
        return;
      }

      readFormatOptions(function (fo) {
        chrome.runtime.sendMessage(
          {
            type: 'COPY_PARTY_SHARE_URL',
            origin: location.origin,
            pathname: location.pathname || '/',
            partySlots: partySlots,
            formatOptions: fo,
          },
          function (bg) {
            if (chrome.runtime.lastError) {
              fb.fail(mapErr('')); // 매퍼가 lastError 를 한국어로 (영문 원문 노출 금지)
              return;
            }
            if (!bg || !bg.ok) {
              fb.fail((bg && bg.error) || '처리하지 못했습니다.');
              return;
            }
            var t = bg.text != null ? String(bg.text) : '';
            if (!t) {
              fb.fail('출력이 비었습니다.');
              return;
            }
            copyTextBestEffort(t);
            fb.done();
          }
        );
      });
    });
  }

  function runCopySlot(idx1, fb) {
    if (!isTeamBuilderRoute()) return;
    fb.busy();

    getSlotsFromBridge().then(function (r) {
      if (!r || !r.ok || !r.slots) {
        fb.fail('슬롯을 읽지 못했습니다.');
        return;
      }
      if (!r.filled || !r.filled[idx1 - 1]) {
        fb.fail(EMPTY_MSG);
        return;
      }
      var slotData = r.slots[idx1 - 1];
      readFormatOptions(function (fo) {
        chrome.runtime.sendMessage(
          {
            type: 'FORMAT_BUILDER_SLOT',
            slotIndex: idx1,
            slotData: slotData,
            origin: location.origin,
            pathname: location.pathname || '/',
            formatOptions: fo,
          },
          function (bg) {
            if (chrome.runtime.lastError) {
              fb.fail(mapErr('')); // 매퍼가 lastError 를 한국어로 (영문 원문 노출 금지)
              return;
            }
            if (!bg || !bg.ok) {
              fb.fail((bg && bg.error) || '변환 실패');
              return;
            }
            var t = bg.text != null ? String(bg.text) : '';
            if (!t) {
              fb.fail('출력이 비었습니다.');
              return;
            }
            copyTextBestEffort(t);
            fb.done();
          }
        );
      });
    });
  }

  /**
   * 저장한 샘플 복사 (sampleLibrary 목록 카드 복사 버튼) — runCopySlot 과 같은 변환·환경설정.
   * 샘플은 파티 슬롯 번호가 없으므로 slotIndex 1 (공유 URL 옵션일 때 share POST 메타 값일 뿐).
   * pathname '/party' 고정 — 계산기·스피드 탭에서 눌러도 링크가 파티 탭 복사와 같은 경로로 나오게.
   * @param {object} slotData 저장된 슬롯 원본
   * @returns {Promise<void>} 실패 시 reject(Error(한국어 문구))
   */
  function copySampleSlot(slotData) {
    return new Promise(function (resolve, reject) {
      readFormatOptions(function (fo) {
        chrome.runtime.sendMessage(
          {
            type: 'FORMAT_BUILDER_SLOT',
            slotIndex: 1,
            slotData: slotData,
            origin: location.origin,
            pathname: '/party',
            formatOptions: fo,
          },
          function (bg) {
            if (chrome.runtime.lastError || !bg) { reject(new Error('변환 실패')); return; }
            if (!bg.ok) { reject(new Error(bg.error || '변환 실패')); return; }
            var t = bg.text != null ? String(bg.text) : '';
            if (!t) { reject(new Error('출력이 비었습니다.')); return; }
            copyTextBestEffort(t);
            resolve();
          }
        );
      });
    });
  }
  /**
   * 저장한 파티 복사 (박스 파티 카드 복사 버튼) — runCopyPartyShareUrl 과 같은 변환·환경설정.
   * 빈 칸 null → {} (bridge GET_SLOTS 가 주는 빈 슬롯 모양과 같게). pathname '/party' 고정.
   * @param {Array} slots 저장된 6칸
   * @returns {Promise<void>} 실패 시 reject(Error(한국어 문구))
   */
  function copyPartySlots(slots) {
    return new Promise(function (resolve, reject) {
      readFormatOptions(function (fo) {
        chrome.runtime.sendMessage(
          {
            type: 'COPY_PARTY_SHARE_URL',
            origin: location.origin,
            pathname: '/party',
            partySlots: slots.map(function (s) { return s || {}; }),
            formatOptions: fo,
          },
          function (bg) {
            if (chrome.runtime.lastError || !bg) { reject(new Error('변환 실패')); return; }
            if (!bg.ok) { reject(new Error(bg.error || '변환 실패')); return; }
            var t = bg.text != null ? String(bg.text) : '';
            if (!t) { reject(new Error('출력이 비었습니다.')); return; }
            copyTextBestEffort(t);
            resolve();
          }
        );
      });
    });
  }
  globalThis.nuoTeamCopy = { copySampleSlot: copySampleSlot, copyPartySlots: copyPartySlots };

  /* ===== 삽입 등록 · 슬롯 갱신 ===== */

  function registerInjectors() {
    var i;
    for (i = 1; i <= 6; i++) {
      (function (idx1) {
        injectors.push(CS.keepInjected({
          key: 'tb-slot-copy-' + idx1,
          hostStyle: HOST_INLINE + SLOT_TINT,
          // 빈 슬롯에도 보임 — 누르면 alert (처음 쓰는 사람이 기능을 알아보게, PARTY_PRESET_PLAN §2)
          enabled: function () { return bridgeReady && isTeamBuilderRoute(); },
          find: function () { return findSlotIconRow(idx1); },
          build: function (root) {
            return buildIcons(root, 'slot', { copy: '요약 샘플 복사', save: '샘플 저장' }, {
              copy: function (fb) { runCopySlot(idx1, fb); },
              save: function (fb) { if (globalThis.nuoPartyBox) globalThis.nuoPartyBox.saveSlot(idx1, fb); }
            });
          }
        }));
      })(i);
    }
    injectors.push(CS.keepInjected({
      key: 'tb-party-copy',
      hostStyle: HOST_INLINE + PARTY_TINT,
      enabled: function () { return bridgeReady && isTeamBuilderRoute(); },
      find: findPartyIconGroup,
      build: function (root) {
        return buildIcons(root, 'party', { copy: '파티 샘플 복사', save: '파티 저장' }, {
          copy: function (fb) { runCopyPartyShareUrl(fb); },
          save: function (fb) { if (globalThis.nuoPartyBox) globalThis.nuoPartyBox.saveParty(fb); }
        });
      }
    }));
  }

  function refreshInjectors() {
    injectors.forEach(function (h) { h.refresh(); });
  }

  function refreshSlots() {
    if (!bridgeReady) return;
    if (!isTeamBuilderRoute()) {
      refreshInjectors();
      return;
    }
    getSlotsFromBridge().then(function (r) {
      // C-5a/b: 슬롯 hot snapshot + 영속 캐시 갱신. 계산기 페이지가 같은 탭 내에서
      // (또는 다음 부팅 후) 이 데이터를 읽어 "내 파티" 줄에 사용.
      if (isTeamBuilderRoute() && r && r.ok && r.slots && typeof TBS.setSlotSnapshot === 'function') {
        TBS.setSlotSnapshot({ slots: r.slots, slotArt: r.slotArt });
      }
      refreshInjectors();
    });
  }

  function init() {
    registerInjectors();
    injectTeamBridgeOnce().then(function () {
      bridgeReady = true;
      refreshSlots();
    }).catch(function () {});
    var tbMoTouchSlot =
      typeof TBS.tbMoRecordsTouchSlotList === 'function'
        ? TBS.tbMoRecordsTouchSlotList
        : function () {
            return true;
          };
    var moTimer = null;
    var mo = new MutationObserver(function (records) {
      if (!tbMoTouchSlot(records)) return;
      clearTimeout(moTimer);
      moTimer = setTimeout(refreshSlots, 500);
    });
    try {
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (eMo) {}
    window.addEventListener('hashchange', function () {
      setTimeout(refreshSlots, 200);
    });
    // R3: SPA pushState 라우트 전환 시 즉시 갱신.
    if (CS.onRouteChange) {
      CS.onRouteChange(refreshSlots);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // 인라인 어노테이션은 teamBuilderInlineAnnot.js 가 자체 DOMContentLoaded 에서 초기화 (F6).
})();
