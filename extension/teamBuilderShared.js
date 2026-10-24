/**
 * 팀빌더 콘텐츠 스크립트(FAB / 인라인 어노테이션) 공용 유틸 — F6.
 *
 * teamBuilderFill.js (FAB) 와 teamBuilderInlineAnnot.js (인라인) 두 파일이 모두
 * MAIN-world bridge(teamBuilderBridge.js) 와 통신하므로, 그 통신 코드를 한 곳에 두고
 * 두 소비자가 globalThis.nuoTeamBuilderShared 로 import.
 *
 * manifest 에서 두 소비자보다 먼저 로드되어야 함.
 */
(function (g) {
  'use strict';

  var MSG_EXT = 'nuo-team-ext';
  var MSG_BRIDGE = 'nuo-team-bridge';

  var CS = g.nuoCsCommon || {};
  var SL = g.nuoSlotRead;

  function injectTeamBridge() {
    return CS.requestBridgeInject('INJECT_TEAM_BUILDER_BRIDGE', 'team_bridge_inject_failed');
  }

  /**
   * F12: 매 호출마다 SW 메시지 + chrome.scripting.executeScript 왕복을 피한다.
   * 페이지 측은 __NUO_TEAM_BUILDER_BRIDGE_V4__ 가드로 어차피 noop이지만 메시지 비용이 남음.
   * 첫 ok 이후엔 같은 promise 재사용. 실패 시 캐시 초기화 → 다음 호출이 재시도.
   */
  var teamBridgeReadyP = null;
  function injectTeamBridgeOnce() {
    if (teamBridgeReadyP) return teamBridgeReadyP;
    teamBridgeReadyP = injectTeamBridge();
    teamBridgeReadyP.catch(function () {
      teamBridgeReadyP = null;
    });
    return teamBridgeReadyP;
  }

  /**
   * 구버전 공유 URL 폴백: 사이트가 pokemon.sprite 를 못 채운 슬롯에 대해
   * 슬러그(pokemon.name 또는 pokemon.name.id) → PokeAPI 내부 id → raw 스프라이트 URL 로 복구.
   * pokemonSlugToDex.json 은 빌드타임 번들이며, 사이트의 정상 케이스 URL 패턴과 동일.
   */
  var slugDexCacheP = null;
  function ensureSlugDexLoaded() {
    if (slugDexCacheP) return slugDexCacheP;
    slugDexCacheP = new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          resolve({ bySlug: {} });
          return;
        }
        chrome.runtime.sendMessage({ type: 'GET_POKEMON_SLUG_TO_DEX' }, function (resp) {
          if (chrome.runtime.lastError || !resp || !resp.ok || !resp.doc || !resp.doc.bySlug) {
            resolve({ bySlug: {} });
            return;
          }
          resolve(resp.doc);
        });
      } catch (e) {
        resolve({ bySlug: {} });
      }
    });
    return slugDexCacheP;
  }

  function enrichSlotArtWithFallback(slots, slotArt, bySlug) {
    if (!Array.isArray(slots) || !Array.isArray(slotArt) || !bySlug) return slotArt;
    var out = slotArt.slice(0);
    var i;
    for (i = 0; i < out.length && i < slots.length; i++) {
      if (out[i]) continue;
      var slug = SL.speciesSlug(slots[i]);
      if (!slug) continue;
      var dex = bySlug[slug];
      if (!dex) continue;
      out[i] = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + dex + '.png';
    }
    return out;
  }

  /**
   * MAIN bridge 의 NUO_TEAM_GET_SLOTS / NUO_TEAM_SLOTS_REPLY postMessage RPC.
   * 결과: { ok, slots, filled, slotArt, error }. 8초 timeout. filled·slotArt 는 여기서 slotRead 로 계산 (bridge 는 슬롯만).
   */
  function getSlotsFromBridge() {
    return new Promise(function (resolve) {
      var rid = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
      var done = false;

      function finish(r) {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        if (!r.ok || !Array.isArray(r.slotArt) || !Array.isArray(r.slots)) {
          resolve(r);
          return;
        }
        ensureSlugDexLoaded().then(function (doc) {
          r.slotArt = enrichSlotArtWithFallback(r.slots, r.slotArt, doc.bySlug);
          resolve(r);
        });
      }

      function onMsg(ev) {
        var d = ev.data;
        if (!d || d.source !== MSG_BRIDGE || d.type !== 'NUO_TEAM_SLOTS_REPLY') return;
        if (String(d.requestId) !== rid) return;
        var slots = Array.isArray(d.slots) ? d.slots : null;
        finish({
          ok: !!d.ok && !!slots,
          slots: slots,
          filled: slots ? SL.filledFlags(slots) : null,
          slotArt: slots ? [0, 1, 2, 3, 4, 5].map(function (i) { return SL.sprite(slots[i]); }) : null,
          error: d.error,
        });
      }

      window.addEventListener('message', onMsg);
      window.postMessage(
        {
          source: MSG_EXT,
          type: 'NUO_TEAM_GET_SLOTS',
          requestId: rid,
        },
        '*'
      );

      setTimeout(function () {
        finish({ ok: false, slots: null, filled: null, error: 'team_slots_timeout' });
      }, 8000);
    });
  }

  /**
   * bridge 요청/응답 1회 (requestId 매칭, 8초 timeout → bridge_timeout).
   * @param {string} type 요청 타입
   * @param {string} replyType 응답 타입
   * @param {object=} extra 요청에 덧붙일 필드
   * @returns {Promise<object>} 응답 메시지 그대로 (timeout 이면 { ok:false, error:'bridge_timeout' })
   */
  function bridgeRpc(type, replyType, extra) {
    return new Promise(function (resolve) {
      var rid = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
      var done = false;
      function finish(r) {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        resolve(r);
      }
      function onMsg(ev) {
        if (ev.source !== window) return; // 다른 frame 의 위조 응답 무시
        var d = ev.data;
        if (!d || d.source !== MSG_BRIDGE || d.type !== replyType) return;
        if (String(d.requestId) !== rid) return;
        finish(d);
      }
      window.addEventListener('message', onMsg);
      var msg = { source: MSG_EXT, type: type, requestId: rid };
      var k;
      if (extra) {
        for (k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k];
        }
      }
      window.postMessage(msg, '*');
      setTimeout(function () { finish({ ok: false, error: 'bridge_timeout' }); }, 8000);
    });
  }

  /** 샘플 저장용 — 현재 편집 슬롯 읽기 (SAMPLE_LIBRARY_PLAN §4.2). */
  function readInputFromBridge() {
    return injectTeamBridgeOnce().then(function () {
      return bridgeRpc('NUO_TEAM_READ_INPUT', 'NUO_TEAM_INPUT_REPLY', null);
    });
  }

  /** 샘플 불러오기 — 현재 편집 슬롯에 쓰기. */
  function writeInputToBridge(slot) {
    return injectTeamBridgeOnce().then(function () {
      return bridgeRpc('NUO_TEAM_WRITE_INPUT', 'NUO_TEAM_WRITE_REPLY', { slot: slot });
    });
  }

  /** 파티 불러오기 — 6칸 통째 쓰기 (PARTY_PRESET_PLAN §4.2). */
  function writePartyToBridge(slots) {
    return injectTeamBridgeOnce().then(function () {
      return bridgeRpc('NUO_TEAM_WRITE_PARTY', 'NUO_TEAM_WRITE_REPLY', { slots: slots });
    });
  }

  /** 슬롯 #index(1~6) 샘플 이름만 사이트에 씀 (이름 창에서 입력한 이름 반영). */
  function setSlotNameToBridge(index, name) {
    return injectTeamBridgeOnce().then(function () {
      return bridgeRpc('NUO_TEAM_SET_SLOT_NAME', 'NUO_TEAM_WRITE_REPLY', { index: index, name: name });
    });
  }

  /**
   * 슬롯 스냅샷 — 계산기 자동입력의 “팀 슬롯 원클릭” 흐름을 위한 두 층 mirror.
   *
   * - Hot snapshot (C-5a): 콘텐츠 스크립트 isolated world 의 `_hot` 변수.
   *   같은 탭에서 SPA 라우트가 바뀌어도 살아남음. 풀 리로드 / 탭 종료 시 소멸.
   * - 영속 캐시 (C-5b): `chrome.storage.local.<SLOT_CACHE_KEY>`.
   *   부팅 후 계산기 페이지 직접 접속 시에도 슬롯 버튼이 보이도록.
   *
   * 동시 갱신 — `setSlotSnapshot` 한 호출이 두 곳을 같이 갱신한다.
   * 팀빌더 측 콘텐츠 스크립트(teamBuilderFill / teamBuilderInlineAnnot)가
   * `getSlotsFromBridge` 의 ok 응답 받을 때마다 호출.
   *
   * 계산기 측은 `getHotSnapshot` → `getCacheSnapshot` 순서로 read. bridge 호출 없음(T-1).
   */
  var SLOT_CACHE_KEY = 'nuo_fmt_teamSlotsCache';
  var SLOT_CACHE_SCHEMA = 1;

  /** SPA 라우트 전환에 살아남는 isolated-world 변수. 풀 리로드 시 자연 소멸. */
  var _hot = null;

  /**
   * Hot snapshot + 영속 캐시 동시 갱신.
   * @param {{ slots: object[], slotArt?: string[] }} payload
   *   slots: 길이 1~6 의 flat slot 배열 (빈 슬롯은 {} 또는 비슷한 모양 OK).
   *   slotArt: 같은 길이의 스프라이트 URL 배열 (없으면 빈 배열).
   */
  function setSlotSnapshot(payload) {
    if (!payload || typeof payload !== 'object') return;
    var slots = Array.isArray(payload.slots) ? payload.slots.slice(0, 6) : null;
    if (!slots || slots.length === 0) return;
    var slotArt = Array.isArray(payload.slotArt) ? payload.slotArt.slice(0, 6) : [];
    var snap = {
      slots: slots,
      slotArt: slotArt,
      savedAt: Date.now(),
      schema: SLOT_CACHE_SCHEMA,
    };
    _hot = snap;
    // 영속 캐시 — 실패는 조용히 (TEMPLATES §0 “조용한 실패”).
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        var obj = {};
        obj[SLOT_CACHE_KEY] = snap;
        chrome.storage.local.set(obj, function () {
          // chrome.runtime.lastError 무시
        });
      }
    } catch (e) {}
  }

  /** 동기 — hot only. 콘텐츠 스크립트 isolated world 의 _hot 을 그대로 반환. */
  function getHotSnapshot() {
    return _hot;
  }

  /**
   * Promise — chrome.storage.local 비동기 GET.
   * 결과: 유효 스냅샷 또는 null (스토리지 실패 / 스키마 미스매치 / 빈 배열).
   */
  function getCacheSnapshot() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
          resolve(null);
          return;
        }
        chrome.storage.local.get([SLOT_CACHE_KEY], function (got) {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          var c = got && got[SLOT_CACHE_KEY];
          if (!c || c.schema !== SLOT_CACHE_SCHEMA) {
            resolve(null);
            return;
          }
          if (!Array.isArray(c.slots) || c.slots.length === 0) {
            resolve(null);
            return;
          }
          resolve(c);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * 팀빌더 좌측 슬롯 리스트 컨테이너 — 카드 찾기·MO 가드 등에서 공용.
   * 사이트가 이미지 캡처용으로 단 `[data-capture-area]` (자식 = [헤더, 슬롯1..6]).
   * DOM 구조 변경 시 teamBuilderInlineAnnot 의 findSlotCardByIndex 와 같이 갱신.
   * @returns {Element|null}
   */
  function getTbSlotListRoot() {
    return document.querySelector('[data-capture-area]');
  }

  /**
   * MO 콜백 records 중 슬롯 리스트 컨테이너(또는 그 자손) 변경이 하나라도 있으면 true.
   * getTbSlotListRoot() 가 null 이면 가드 생략(항상 true) — 컨테이너 mount 전 폴백.
   * @param {MutationRecord[]} records
   * @returns {boolean}
   */
  /** 우리 삽입 host(`data-nuo-inject`)만 붙거나 떨어진 레코드 — 슬롯 갱신 트리거에서 제외. */
  function isOnlyNuoInjectRecord(rec) {
    if (!rec || rec.type !== 'childList') return false;
    var nodes = [].slice.call(rec.addedNodes || []).concat([].slice.call(rec.removedNodes || []));
    if (!nodes.length) return false;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n || n.nodeType !== 1 || !n.hasAttribute('data-nuo-inject')) return false;
    }
    return true;
  }

  function tbMoRecordsTouchSlotList(records) {
    var root = getTbSlotListRoot();
    if (!root) return true;
    if (!records || !records.length) return false;
    var i;
    for (i = 0; i < records.length; i++) {
      if (isOnlyNuoInjectRecord(records[i])) continue;
      var t = records[i] && records[i].target;
      if (!t) continue;
      if (t === root || root.contains(t)) return true;
    }
    return false;
  }

  g.nuoTeamBuilderShared = {
    injectTeamBridge: injectTeamBridge,
    injectTeamBridgeOnce: injectTeamBridgeOnce,
    getSlotsFromBridge: getSlotsFromBridge,
    readInputFromBridge: readInputFromBridge,
    writeInputToBridge: writeInputToBridge,
    writePartyToBridge: writePartyToBridge,
    setSlotNameToBridge: setSlotNameToBridge,
    setSlotSnapshot: setSlotSnapshot,
    getHotSnapshot: getHotSnapshot,
    getCacheSnapshot: getCacheSnapshot,
    getTbSlotListRoot: getTbSlotListRoot,
    tbMoRecordsTouchSlotList: tbMoRecordsTouchSlotList,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
