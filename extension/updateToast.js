/**
 * updateToast.js — 업데이트 알림 인페이지 토스트.
 * smartnuo.com 페이지 로드 시 nuo_fmt_pendingUpdateNotice 가 있으면
 * 우상단에 Shadow DOM 토스트를 표시한다.
 * nuoCsCommon 의존 없음, 토큰(styles/nuoTokens.js)만 사용.
 */
(function () {
  'use strict';

  var CHANGELOG_URL =
    'https://github.com/douminuo/douminuo/blob/main/CHANGELOG.md';
  var HOST_ID = 'nuo-fmt-update-toast-host';
  var SK_NOTICE = 'nuo_fmt_pendingUpdateNotice';
  var SK_LAST_SEEN = 'nuo_fmt_lastSeenVersion';
  var AUTO_DISMISS_MS = 8000;

  // TEMPLATES.md v7: context invalidated 방어
  function isExtValid() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
    catch (e) { return false; }
  }

  function teardown() {
    var host = document.getElementById(HOST_ID);
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }

  function mountToast(version) {
    if (document.getElementById(HOST_ID)) return; // 중복 마운트 방지

    var host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);

    var shadow = host.attachShadow({ mode: 'open' });
    var autoTimer;

    function doActualDismiss() {
      teardown();
      if (!isExtValid()) return;
      chrome.storage.local.set(
        { nuo_fmt_pendingUpdateNotice: null, nuo_fmt_lastSeenVersion: version },
        function () { if (chrome.runtime.lastError) {} }
      );
    }

    function startDismiss() {
      clearTimeout(autoTimer);
      doActualDismiss();
    }

    var css = [
      ':host { all: initial; }',
      (globalThis.nuoTokensCss || ''),
      '*, *::before, *::after { box-sizing: border-box; }',
      '.toast {',
      '  position: fixed; top: 20px; right: 20px; z-index: 2147483647;',
      '  display: flex; align-items: center; gap: 10px; max-width: 340px;',
      '  padding: 10px 12px; background: #fff;',
      '  border: 1px solid var(--nuo-border); border-radius: 8px; box-shadow: var(--nuo-shadow);',
      '  font: 400 12px/1.5 var(--nuo-font); color: var(--nuo-text);',
      '}',
      '.msg { flex: 1; white-space: nowrap; }',
      '.version { color: var(--nuo-primary); cursor: pointer; font-weight: 500; }',
      '.version:hover { text-decoration: underline; }',
      '.dismiss { flex: 0 0 auto; width: 16px; height: 16px; padding: 0; border: 0; background: none; color: var(--nuo-text-muted); cursor: pointer; line-height: 0; transition: color 0.15s; }',
      '.dismiss:hover { color: var(--nuo-primary); }',
      '@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }'
    ].join('\n');

    // 구조: "도우미누오가 [v1.5.0]으로 업데이트되었습니다. [×]"
    shadow.innerHTML =
      '<style>' + css + '</style>' +
      '<div class="toast">' +
        '<span class="msg">' +
          '도우미누오가 <span class="version"></span>으로 업데이트되었습니다.' +
        '</span>' +
        '<button class="dismiss" aria-label="닫기"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="1.5" y1="1.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="1.5" x2="1.5" y2="10.5"/></svg></button>' +
      '</div>';

    // textContent로 삽입 (XSS 방지)
    shadow.querySelector('.version').textContent = 'v' + version;

    // 타이머 상태 추적 (폴링 없이 Date.now() 한 번만 읽음)
    var timerDuration = AUTO_DISMISS_MS;
    var timerStart = Date.now();
    var frozen = false;
    var FREEZE_THRESHOLD = 3000;

    function startAutoTimer(duration) {
      clearTimeout(autoTimer);
      timerDuration = duration;
      timerStart = Date.now();
      autoTimer = setTimeout(startDismiss, duration);
    }

    startAutoTimer(AUTO_DISMISS_MS);

    var toastEl = shadow.querySelector('.toast');
    var isHovered = false;
    var hoverFreezeTimer = null; // hover 중 3초선 진입 감지용

    toastEl.addEventListener('mouseenter', function () {
      isHovered = true;
      if (frozen) return;
      var remaining = timerDuration - (Date.now() - timerStart);
      if (remaining <= FREEZE_THRESHOLD) {
        // 이미 3초 이하: 즉시 동결
        clearTimeout(autoTimer);
        autoTimer = null;
        frozen = true;
      } else {
        // 3초 초과: 타이머 그대로 유지하되,
        // hover 중 3초선 진입 시점에 동결되도록 예약
        clearTimeout(hoverFreezeTimer);
        hoverFreezeTimer = setTimeout(function () {
          if (!isHovered || frozen) return;
          clearTimeout(autoTimer);
          autoTimer = null;
          frozen = true;
        }, remaining - FREEZE_THRESHOLD);
      }
    });

    toastEl.addEventListener('mouseleave', function () {
      isHovered = false;
      clearTimeout(hoverFreezeTimer);
      hoverFreezeTimer = null;
      if (!frozen) return;
      frozen = false;
      // 동결 해제: 3초 타이머 시작
      startAutoTimer(FREEZE_THRESHOLD);
    });

    // 버전 클릭 → CHANGELOG 새 탭 (토스트 유지)
    shadow.querySelector('.version').addEventListener('click', function () {
      window.open(CHANGELOG_URL, '_blank');
    });

    // 닫기 버튼 → 즉시 dismiss
    shadow.querySelector('.dismiss').addEventListener('click', function () {
      startDismiss();
    });
  }

  function init() {
    if (!isExtValid()) return;

    chrome.storage.local.get([SK_NOTICE, 'nuo_fmt_updateNoticeEnabled'], function (got) {
      if (chrome.runtime.lastError) return;
      if (got['nuo_fmt_updateNoticeEnabled'] === false) return; // 알림 꺼짐
      var notice = got[SK_NOTICE];
      if (!notice || !notice.version) return; // 알림 없음
      if (notice.shownInPage) return;          // 같은 세션 다른 탭에서 이미 표시

      // shownInPage 먼저 기록한 뒤 마운트 (탭 중복 표시 방지)
      chrome.storage.local.set(
        { nuo_fmt_pendingUpdateNotice: { version: notice.version, shownInPage: true } },
        function () {
          if (chrome.runtime.lastError) return;
          mountToast(notice.version);
        }
      );
    });
  }

  init();
})();
