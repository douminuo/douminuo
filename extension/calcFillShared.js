/**
 * 계산기 기입 오류 코드 → 사용자 메시지 + 콘텐츠 스크립트 공용 유틸.
 *
 * R1 (2026-05-09): 페이지 식별을 본문 텍스트 휴리스틱에서 URL pathname 기반으로 교체.
 * 사이트 리뉴얼(Nuxt 3 + Tailwind) 후 path 분리됨 — '/' = 데미지 계산기, '/party' = 팀빌더,
 * '/speed' = 신규 스피드 계산기 탭.
 *
 * R3 (2026-05-09): SPA pushState 라우트 전환 감지. 500ms pathname 폴링 + popstate/hashchange/
 * visibilitychange 에서 즉시 체크. 변경 감지 시 'nuofmt:locchange' CustomEvent 발생.
 */
(function (g) {
  'use strict';

  /* ===== R1: URL 기반 페이지 라우트 식별 ===== */

  /**
   * 현재 페이지 라우트.
   * @returns {'calc' | 'team' | 'calc-speed' | 'other'}
   */
  function getRoute() {
    var h = '';
    try { h = (location.hostname || '').toLowerCase(); } catch (eHost) { return 'other'; }
    if (h !== 'smartnuo.com' && h !== 'www.smartnuo.com') return 'other';
    // trailing slash 제거 후 비교 — 'smartnuo.com/' 도 'smartnuo.com' 과 같은 라우트.
    var p = '/';
    try { p = (location.pathname || '/').replace(/\/+$/, '') || '/'; } catch (ePath) { return 'other'; }
    if (p === '/' || p === '/index' || p.indexOf('/index.') === 0) return 'calc';
    if (p === '/party' || p.indexOf('/party/') === 0) return 'team';
    if (p === '/speed' || p.indexOf('/speed/') === 0) return 'calc-speed';
    if (p === '/docs' || p.indexOf('/docs/') === 0) return 'pokedex';
    return 'other';
  }

  function isCalculatorRoute()  { return getRoute() === 'calc'; }
  function isTeamBuilderRoute() { return getRoute() === 'team'; }
  function isCalcSpeedRoute()   { return getRoute() === 'calc-speed'; }
  function isPokedexRoute()     { return getRoute() === 'pokedex'; }

  /**
   * 계산기·스피드 "내 파티" 줄 게이트 — '/' (calc) 또는 '/speed' (calc-speed) 합집합.
   * 두 페이지 모두 같은 계산기 패널을 띄우므로 가드 합집합이 의미상 한 헬퍼.
   */
  function isCalcOrSpeedRoute() {
    var r = getRoute();
    return r === 'calc' || r === 'calc-speed';
  }

  /* ===== R3: SPA pushState 라우트 전환 감지 ===== */

  /**
   * 콘텐츠 스크립트 isolated world 의 history 와 MAIN world 의 history 는 별개 객체이므로
   * isolated 측에서 monkey-patch 를 걸어도 사이트 라우터(MAIN)의 pushState 는 못 잡는다.
   * 주 신호 = MAIN 의 Nuxt `page:finish` 훅이 보내는 NUO_PAGE_FINISH_V1 (background.js waitNuxtHydratedInPage).
   * 그 외 popstate/hashchange/visibilitychange 즉시 체크 + 폴백으로 injectTick(400ms) 마다 pathname 비교
   * (사이트 훅이 바뀌어도 라우트 감지는 유지).
   */
  var lastPathSeen = (function () {
    try { return location.pathname || '/'; } catch (eInit) { return '/'; }
  })();

  function dispatchLocChange() {
    try {
      window.dispatchEvent(new CustomEvent('nuofmt:locchange', {
        detail: { pathname: location.pathname, route: getRoute() }
      }));
    } catch (eDisp) {}
  }

  function checkPathChange() {
    var p;
    try { p = location.pathname || '/'; } catch (eRead) { return; }
    if (p !== lastPathSeen) {
      lastPathSeen = p;
      dispatchLocChange();
    }
  }

  try {
    window.addEventListener('popstate', checkPathChange);
    window.addEventListener('hashchange', checkPathChange);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkPathChange();
    });
    window.addEventListener('message', function (ev) {
      var d = ev.data;
      if (ev.source !== window || !d || d.source !== 'nuo-route-page' || d.type !== 'NUO_PAGE_FINISH_V1') return;
      checkPathChange();
      injectTick(); // 새 페이지 DOM 이 이미 있음 — 400ms 기다리지 않고 바로 앵커 삽입
    });
  } catch (eWire) {}

  /**
   * 라우트 변경 구독. 'nuofmt:locchange' 의 얇은 wrapper.
   * @param {(detail: { pathname: string, route: string }) => void} cb
   * @returns {() => void} teardown — listener 제거.
   */
  function onRouteChange(cb) {
    if (typeof cb !== 'function') return function () {};
    var listener = function (ev) {
      try {
        cb(ev && ev.detail ? ev.detail : { pathname: location.pathname, route: getRoute() });
      } catch (eCb) {}
    };
    window.addEventListener('nuofmt:locchange', listener);
    return function () {
      try { window.removeEventListener('nuofmt:locchange', listener); } catch (eRm) {}
    };
  }

  /* ===== 브리지 주입 요청 (변경 없음) ===== */

  /**
   * background 에게 MAIN 월드 브리지 주입 요청.
   * @param {string} type INJECT_CALC_BRIDGE | INJECT_TEAM_BUILDER_BRIDGE
   * @param {string=} fallbackError 백그라운드가 에러 문자열을 안 주었을 때 쓸 코드
   */
  function requestBridgeInject(type, fallbackError) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({ type: type }, function (r) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'runtime'));
          return;
        }
        if (!r || !r.ok) {
          reject(new Error((r && r.error) || fallbackError || 'bridge_inject_failed'));
          return;
        }
        resolve();
      });
    });
  }

  /* ===== 에러 매퍼 (변경 없음) ===== */

  /**
   * F14: 옛 if-체인을 dict lookup 으로. 같은 의미의 alias 들은 한 줄씩 나란히 적어 둠.
   */
  var CALC_FILL_ERR_MSG = {
    empty_slot: '샘플이 비어 있거나 종 이름을 읽지 못했습니다.',
    no_species: '샘플이 비어 있거나 종 이름을 읽지 못했습니다.',
    vue_calc_not_found: '계산기 상태(attacker/defender)를 찾지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    nuxt_state_not_found: '페이지 상태(Nuxt)를 읽지 못했습니다. 스마트누오를 새로고침한 뒤 다시 시도해 주세요.',
    species_not_in_dex: '도감에서 해당 종을 찾지 못했습니다. 이름·폼을 확인해 주세요.',
    species_not_in_def_dex: '도감에서 수비 포켓몬 종을 찾지 못했습니다. 이름·폼을 확인해 주세요.',
    species_not_in_speed_dex: '스피드 계산기 도감에서 해당 종을 찾지 못했습니다. 이름·폼을 확인해 주세요.',
    species_not_in_speed_def_dex: '스피드 계산기 도감에서 수비 포켓몬 종을 찾지 못했습니다. 이름·폼을 확인해 주세요.',
    speed_state_not_found: '스피드 계산기 상태(attacker/defender)를 찾지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
    calc_dex_not_ready: '도감(종 목록)이 아직 로드 중입니다. 잠시 후 다시 시도해 주세요.',
    calc_broadcast_all_failed: '계산기 인스턴스 모두에 반영하지 못했습니다. 탭을 새로고침한 뒤 다시 시도해 주세요.',
    not_calculator_view: '데미지 계산기 화면인지 확인해 주세요.',
    no_valid_payload: '적용할 수 있는 페이로드가 없습니다.',
    bridge_inject_failed: '브리지 주입에 실패했습니다. 탭을 새로고침한 뒤 확장을 다시 로드해 보세요.',
    calc_apply_timeout: '시간 초과. 계산기 탭을 활성화한 뒤 다시 시도해 주세요.',
    calc_payload_unavailable: '계산기용 스크립트를 불러오지 못했습니다. 확장 프로그램을 다시 로드해 주세요.',
    bridge_timeout: '사이트 정보를 읽지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    bridge_state_missing: '사이트 정보를 읽지 못했습니다. 새로고침 후 다시 시도해 주세요.',
    storage_failed: '샘플을 저장하지 못했습니다.',
    storage_read_failed: '저장한 샘플을 불러오지 못했습니다.',
    storage_delete_failed: '샘플을 삭제하지 못했습니다.',
    sample_invalid: '이 샘플은 불러올 수 없습니다.',
    sample_limit: '샘플은 최대 100개까지 저장할 수 있습니다.',
    party_save_failed: '파티를 저장하지 못했습니다.',
    party_read_failed: '저장한 파티를 불러오지 못했습니다.',
    party_delete_failed: '파티를 삭제하지 못했습니다.',
    party_invalid: '이 파티는 불러올 수 없습니다.',
    party_limit: '파티는 최대 20개까지 저장할 수 있습니다.',
  };

  function mapCalcFillError(code) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
        var le = String(chrome.runtime.lastError.message || '');
        if (le.indexOf('Receiving end') !== -1) {
          return '탭과 연결되지 않았습니다. 스마트누오 탭을 새로고침해 주세요.';
        }
      }
    } catch (e) {}

    var c = String(code || '');
    if (Object.prototype.hasOwnProperty.call(CALC_FILL_ERR_MSG, c)) return CALC_FILL_ERR_MSG[c];
    // bridge_inject_failed 는 dict 에 있고, 그 외 'inject' 가 들어간 미래 코드들도 같은 메시지로.
    if (c.indexOf('inject') !== -1) {
      return CALC_FILL_ERR_MSG.bridge_inject_failed;
    }
    return c || '알 수 없는 오류';
  }

  /* ===== storage.onChanged 헬퍼 (변경 없음) ===== */

  /**
   * F13: chrome.storage.onChanged 보일러플레이트 통합.
   * 콘텐츠 스크립트 5+ 곳에서 같은 패턴(area 검사 → keys 변경 검출 → 전체 keys 재조회)을
   * 반복하던 것을 한 줄 호출로. callback 은 keys 모두를 포함한 storage 결과를 받는다.
   *
   * @param {string[]} keys 관심 키 목록
   * @param {(got: object) => void} callback 변경 감지 시 호출. got = chrome.storage.local.get 결과.
   * @returns {() => void} teardown 함수 — listener 제거. 호출자가 라이프사이클 끝낼 때 사용.
   */
  function onLocalPrefChange(keys, callback) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) {
      return function () {};
    }
    var listener = function (changes, area) {
      if (area !== 'local') return;
      var hit = false;
      var k;
      for (k = 0; k < keys.length; k++) {
        if (changes[keys[k]]) { hit = true; break; }
      }
      if (!hit) return;
      try {
        chrome.storage.local.get(keys, function (got) {
          if (chrome.runtime.lastError) return;
          callback(got);
        });
      } catch (e) {}
    };
    chrome.storage.onChanged.addListener(listener);
    return function () {
      try { chrome.storage.onChanged.removeListener(listener); } catch (e) {}
    };
  }

  /* ===== REDESIGN §4.1: 사이트 DOM 앵커 삽입 ===== */

  /** 사이트 PC 레이아웃(tailwind `pc:` = min-width 820px, 2026-09-23 실측) 여부. 삽입 진입점은 PC 전용. */
  function isPcLayout() {
    try { return window.matchMedia('(min-width: 820px)').matches; } catch (e) { return true; }
  }

  /**
   * trim 한 텍스트가 re 와 일치하는 텍스트 노드의 부모 요소들 (문서 순서).
   * @param {RegExp} re
   * @param {Element=} scope 기본 document.body
   * @returns {Element[]}
   */
  function findTextLeaves(re, scope) {
    var out = [];
    var base = scope || document.body;
    if (!base) return out;
    var w = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = w.nextNode())) {
      if (n.parentElement && re.test(String(n.nodeValue || '').trim())) out.push(n.parentElement);
    }
    return out;
  }

  var injectSpecs = [];
  var injectTimer = null;
  // 사이트(Nuxt SSR) hydration 이 끝나기 전엔 삽입 금지 — 끼운 host 를 Vue 가 불일치로 보고 패널 DOM 을 뒤엉키게 함
  // (background.js waitNuxtHydratedInPage 주석 참고). SW 가 MAIN world 에서 대기 후 응답, 실패·12초 초과 시에도 진행.
  var siteHydrated = false;
  function markSiteHydrated() {
    if (siteHydrated) return;
    siteHydrated = true;
    injectTick();
  }
  try {
    chrome.runtime.sendMessage({ type: 'WAIT_SITE_HYDRATED' }, function () {
      void chrome.runtime.lastError;
      markSiteHydrated();
    });
  } catch (eHy) {
    siteHydrated = true;
  }
  setTimeout(markSiteHydrated, 12000);

  function extAlive() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  function unmountInjected(s) {
    if (typeof s.teardown === 'function') { try { s.teardown(); } catch (eT) {} }
    s.teardown = null;
    if (s.host && s.host.parentNode) s.host.parentNode.removeChild(s.host);
    s.host = null;
  }

  function syncInjected(s) {
    var on = false;
    // extAlive: refresh() 경로(슬롯 MO 등)로도 불리므로 폴링 정지만으론 부족 — 옛 스크립트 재삽입 차단.
    try { on = extAlive() && isPcLayout() && !!s.enabled(); } catch (eEn) { on = false; }
    if (!on) { unmountInjected(s); return; }
    if (!siteHydrated) return;
    // 붙어 있으면 find 생략 — 폴링 비용은 앵커를 못 찾은 동안에만 든다.
    if (s.host && s.host.isConnected) return;
    var a = null;
    try { a = s.find(); } catch (eF) { a = null; }
    unmountInjected(s);
    if (!a || !a.parent) return;
    var host = document.createElement('div');
    host.setAttribute('data-nuo-inject', s.key);
    if (s.hostStyle) host.style.cssText = s.hostStyle;
    a.parent.insertBefore(host, a.before || null);
    s.host = host;
    s.teardown = s.build(host.attachShadow({ mode: 'open' }), host) || null;
  }

  function injectTick() {
    var i;
    if (!extAlive()) {
      // 확장 새로고침 후 옛 스크립트: 자기 삽입물 철거 + 폴링 정지 (새 스크립트와 이중 표시 방지).
      for (i = 0; i < injectSpecs.length; i++) unmountInjected(injectSpecs[i]);
      clearInterval(injectTimer);
      injectTimer = null;
      return;
    }
    checkPathChange(); // 라우트 감지 폴백 (page:finish 신호가 안 올 때)
    for (i = 0; i < injectSpecs.length; i++) syncInjected(injectSpecs[i]);
  }

  /**
   * 사이트 DOM 앵커에 Shadow host 를 붙여 두고, 사이트 re-render 로 떨어지면 재삽입.
   * enabled()·isPcLayout() false 거나 find() null 이면 조용히 미표시.
   * @param {{ key: string, enabled: function(): boolean,
   *   find: function(): ({ parent: Element, before: (Node|null) }|null),
   *   build: function(ShadowRoot, Element): (function|undefined), hostStyle: (string|undefined) }} spec
   * @returns {{ refresh: function(), getHost: function(): (Element|null) }}
   */
  function keepInjected(spec) {
    var s = { key: spec.key, enabled: spec.enabled, find: spec.find, build: spec.build,
      hostStyle: spec.hostStyle || '', host: null, teardown: null };
    injectSpecs.push(s);
    syncInjected(s);
    if (!injectTimer) injectTimer = setInterval(injectTick, 400);
    return {
      refresh: function () { syncInjected(s); },
      getHost: function () { return s.host; }
    };
  }

  g.mapCalcFillError = mapCalcFillError;
  g.nuoCsCommon = {
    isSiteHydrated: function () { return siteHydrated; },
    getRoute: getRoute,
    isCalculatorRoute: isCalculatorRoute,
    isTeamBuilderRoute: isTeamBuilderRoute,
    isCalcSpeedRoute: isCalcSpeedRoute,
    isPokedexRoute: isPokedexRoute,
    // 계산기·스피드 "내 파티" 줄 게이트 (calc + calc-speed 합집합).
    isCalcOrSpeedRoute: isCalcOrSpeedRoute,
    onRouteChange: onRouteChange,
    requestBridgeInject: requestBridgeInject,
    onLocalPrefChange: onLocalPrefChange,
    keepInjected: keepInjected,
    findTextLeaves: findTextLeaves,
    isPcLayout: isPcLayout,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
