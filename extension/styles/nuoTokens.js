/**
 * 스마트누오 디자인 토큰 (REDESIGN_PLAN §3). 사이트 :root 변수를 상속(Shadow DOM 경계 통과) +
 * 실측 폴백. popup.css :root 블록과 값 동기화 — 한쪽 바꾸면 다른 쪽도.
 * manifest content_scripts 맨 앞 로드.
 */
(function (g) {
  'use strict';
  var DECL = [
    '--nuo-primary: var(--primary, #e4007f);',
    '--nuo-primary-hover: var(--p-primary-hover-color, #c70070);',
    '--nuo-primary-focus: var(--primary-focus, #e4007fb3);',
    '--nuo-gold: #e9c46a;',
    '--nuo-green: #66a945;',
    '--nuo-neutral-btn: var(--center-button-bg, #a1a4ba);',
    '--nuo-border: var(--panel-border, #ddd);',
    '--nuo-field-border: #d8d8d8;',
    '--nuo-shadow: 0 0 6px var(--panel-shadow, #e1e1e1);',
    '--nuo-pill-bg: #f2f3f7;',
    '--nuo-pill-border: #e5e8ee;',
    '--nuo-pill-text: #657084;',
    '--nuo-ink: #10213a;',
    '--nuo-chip-track: #f4f4f4;',
    '--nuo-chip-off: #d9d9d9;',
    '--nuo-text: #000;',
    '--nuo-text-strong: #272727;',
    '--nuo-text-muted: var(--menu-inactive, #626262);',
    '--nuo-font: SCDream, "Noto Sans KR", sans-serif;'
  ].join(' ');
  g.nuoTokensDecl = DECL;
  g.nuoTokensCss = ':host { ' + DECL + ' }';
})(typeof globalThis !== 'undefined' ? globalThis : self);
