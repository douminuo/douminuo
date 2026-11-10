/**
 * 계산기·스피드 좌/우 패널 "내 파티" 줄 CSS (REDESIGN §4.1 A). 프로필 헤더 다음 형제로 삽입되는
 * 섹션 — 사이트 섹션 규격(padding 10, border-bottom). calcFill.js 앞 로드.
 * 필드형 재배치 (SAMPLE_LIBRARY_PLAN §5.3). 불러오기 버튼 제거 = PARTY_PRESET_PLAN §5.5.
 */
(function (g) {
  'use strict';
  g.nuoCalcPartyRowCss = [
    // 패딩·경계선은 :host 가 아닌 .sec 에 — 사이트 Tailwind preflight(* { padding:0; border:0 })가 host 요소에 걸리면 :host 규칙을 이김.
    // 필드형 (SAMPLE_LIBRARY_PLAN §5.3): 사이트 '포켓몬 이름' 칸과 같은 라벨 필드 — 높이 50, #d8d8d8, radius 8, 라벨 9px.
    ':host { all: initial; display: block; }',
    '.sec { padding: 16px 10px 10px; border-bottom: 1px solid var(--nuo-border); font-family: var(--nuo-font); color: var(--nuo-text); }',
    '* { box-sizing: border-box; font-family: inherit; }',
    '.fld { position: relative; display: flex; align-items: center; height: 50px; padding: 0 12px; border: 1px solid var(--nuo-field-border); border-radius: 8px; background: #fff; }',
    '.ttl { position: absolute; top: -6px; left: 12px; margin: 0; padding: 0 4px; background: #fff; font-size: 9px; font-weight: 400; line-height: 1; color: var(--nuo-text-muted); white-space: nowrap; }',
    // 칸 안 간격 12 (테두리↔첫 칩, 마지막 칩↔테두리) — 칩 사이는 space-between (불러오기 버튼·구분선은 박스로 이관, PARTY_PRESET_PLAN §5.5).
    '.chips { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; }',
    '.chip { width: 34px; height: 34px; padding: 0; display: flex; align-items: center; justify-content: center; border: 1px solid transparent; border-radius: 8px; background: transparent; cursor: pointer; transition: border-color 0.15s, opacity 0.15s; }',
    '.chip[hidden] { display: none; }',
    '.chip img { width: 32px; height: 32px; object-fit: contain; }',
    '.chip img:not([src]) { display: none; }',
    '.chip .num { font-size: 10px; color: var(--nuo-text-muted); }',
    '.chip.has-art .num { display: none; }',
    '.chip:hover:not(:disabled), .chip.done { border-color: var(--nuo-primary); }',
    '.chip:disabled { cursor: default; }',
    '.chip.busy { opacity: 0.5; cursor: default; }',
    '.empty { flex: 1; font-size: 10px; color: var(--nuo-text-muted); padding: 0 6px; }',
    '.empty[hidden] { display: none; }',
    'button:focus-visible { outline: 2px solid var(--nuo-primary-focus); outline-offset: 1px; }',
    '@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }'
  ].join('\n');
})(typeof globalThis !== 'undefined' ? globalThis : self);
