/**
 * 샘플 저장·불러오기 CSS (SAMPLE_LIBRARY_PLAN §3.3·§5). sampleLibrary.js / sampleParty.js / calcFill.js 앞 로드.
 * 카드 = 사이트 파티 리스트 카드(번들 list 컴포넌트) 실측 복제 — 수치 바꾸지 말 것 (§3.3 대조 검증 완료값).
 * 말풍선 = styles/teamCopyIcons.js .tip 과 같은 실측값 — 한쪽 바꾸면 다른 쪽도.
 */
(function (g) {
  'use strict';
  g.nuoSampleCardCss = [
    '* { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--nuo-font); }',
    // 라벨 가운데 · 뱃지 오른쪽 — 3칸 grid(양옆 1fr 동일)라 뱃지 폭과 무관하게 라벨이 정확히 중앙.
    '.count { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin-bottom: 6px; font-size: 11px; color: var(--nuo-text-muted); }',
    // 제목 스타일 = 사이트 섹션 제목('공격 수치' 등) 14px/500, 자간 -0.35 (옛 "내 파티" 제목과 같은 값).
    '.count .lbl { grid-column: 2; font-size: 14px; font-weight: 500; letter-spacing: -0.35px; color: var(--nuo-text-strong); }',
    // 박스 파티 탭 — 사이트 상단 메뉴("계산기 | 스피드 | 도감")식 텍스트 탭 + 세로 구분선 (목업 합의 2026-09-26).
    '.tabs { display: flex; align-items: center; }',
    // 색 = 사이트 상단 메뉴처럼 선택 분홍·나머지 --menu-inactive (2026-10-29 사용자 선택 B안). 옛 비활성 #b5b5b5 는 대비 2.05.
    '.tab { padding: 0; border: 0; background: none; font: inherit; letter-spacing: inherit; color: var(--nuo-text-muted); cursor: pointer; transition: color 0.15s; }',
    '.tab:hover { color: var(--nuo-text-strong); }',
    '.tab.on { color: var(--nuo-primary); cursor: default; }',
    '.tabs i { display: block; width: 1px; height: 12px; margin: 0 10px; background: #d0d0d0; }',
    '.tab:focus-visible { outline: 2px solid var(--nuo-primary-focus); outline-offset: 2px; }',
    // 개수 뱃지 = 사이트 파티 탭 "SP 66/66" 뱃지 실측(2026-09-24: 9px/300 lh13.5, padding 2px 8px, radius 5) — 색만 회색.
    '.badge { grid-column: 3; justify-self: end; display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 5px; background: var(--nuo-neutral-btn); font-size: 9px; font-weight: 300; line-height: 13.5px; color: #fff; }',
    '.badge svg { width: 10px; height: 10px; fill: #fff; }',
    '.empty { padding: 8px 0 2px; font-size: 11px; color: var(--nuo-text-muted); text-align: center; word-break: keep-all; }',
    '.msg { margin-bottom: 6px; font-size: 11px; color: var(--nuo-primary); }',
    '.msg:empty { display: none; }',
    // 네이티브 스크롤바 숨김(Windows 기본 바가 카드 폭을 14px 깎음) + 오버레이 thumb — styles/speedPanel.js .inline-sb 와 같은 값.
    '.shell { position: relative; }',
    '.list { max-height: 395px; overflow-y: auto; padding-right: 2px; scrollbar-width: none; }', // padding 2 → 카드 336.8 (사이트 336.7)
    '.list::-webkit-scrollbar { width: 0; height: 0; }',
    '.list > .card:last-child { margin-bottom: 0; }',
    '.sb { position: absolute; top: 0; bottom: 0; right: 1px; width: 6px; opacity: 0; transition: opacity .35s ease; pointer-events: none; z-index: 20; }',
    '.sb.show { opacity: 1; pointer-events: auto; }',
    '.thumb { position: absolute; left: 1px; right: 1px; border-radius: 3px; background: rgba(148, 163, 184, 0.55); cursor: pointer; }',
    '.thumb:hover { background: rgba(148, 163, 184, 0.8); }',
    '.head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 12px; color: #272727; }',
    '.head .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.head .acts { flex: none; display: flex; align-items: center; gap: 6px; }',
    // 복사 = 파티 탭 슬롯 아이콘 줄 요약 아이콘(styles/teamCopyIcons.js .ic.slot)과 같은 12px 회색.
    '.cp { flex: none; width: 12px; height: 12px; padding: 0; border: 0; background: none; color: #808080; cursor: pointer; line-height: 0; transition: color 0.15s, opacity 0.15s; }',
    '.cp:hover { color: var(--nuo-primary); }',
    '.cp svg { width: 12px; height: 12px; display: block; }',
    '.cp.busy { opacity: 0.5; cursor: default; }',
    // 복사 결과 말풍선 — .list 가 overflow 로 자르므로 .shell 에 두고 JS 가 버튼 위치(left/top)를 줌. 모양은 styles/teamCopyIcons.js .tip 과 같음.
    '.shell > .tip { position: absolute; transform: translate(-50%, calc(-100% - 4px)); z-index: 30; white-space: nowrap; pointer-events: none; padding: 4px 8px; border-radius: 4px; background: #333; font: 400 11px/1.5 var(--nuo-font); color: #fff; }',
    '.shell > .tip[hidden] { display: none; }',
    '.del { flex: none; width: 12px; height: 12px; padding: 0; border: 0; background: none; color: #808080; cursor: pointer; line-height: 0; }',
    '.del:hover { color: var(--nuo-primary); }',
    '.del svg { width: 12px; height: 12px; fill: currentColor; }',
    '.card { position: relative; display: flex; align-items: center; height: 120px; padding: 10px; margin-bottom: 10px; border: 1px solid transparent; border-radius: 8px; cursor: pointer; user-select: none; }',
    '.card:hover, .card:focus-visible { border-color: #E4007F; outline: none; }',
    '.info { flex: 1; min-width: 0; }',
    '.line { display: flex; align-items: center; margin-top: -3px; font-size: 10px; font-weight: 400; white-space: nowrap; }',
    '.line b { font-size: 14px; font-weight: 500; color: #000; }',
    '.line span { margin-left: 4px; color: #434343; }',
    '.line .tera { width: 12px; height: 12px; margin-left: 4px; }',
    '.moves { display: flex; flex-direction: column; width: 120px; height: 75px; margin-top: 7px; }',
    '.mv { display: flex; align-items: center; height: 18.75px; font-size: 10px; font-weight: 500; line-height: 13px; color: #000; }',
    '.mv img { width: 15px; height: 15px; margin-right: 3px; }',
    '.mv span { word-break: keep-all; }',
    '.art { position: absolute; right: 120px; bottom: 10px; height: 75px; display: flex; align-items: center; justify-content: center; }',
    '.art .a { width: 75px; height: 75px; object-fit: contain; }',
    '.art .it { position: absolute; right: 0; bottom: 0; width: 30px; height: 30px; z-index: 10; }',
    '.stats { position: absolute; right: 10px; bottom: 10px; font-size: 11px; line-height: 13px; }',
    '.st { display: flex; align-items: center; height: 14px; }',
    '.st i { display: block; flex: none; width: 4px; height: 4px; margin: 0 4px 1px 0; }',
    '.st img { width: 12px; height: 11px; margin-right: 4px; }',
    '.st .r, .st .v { display: inline-block; width: 20px; text-align: right; }',
    '.st .r { color: #272727; }',
    '.st .v { font-weight: 500; }',
    // 파티 카드 (PARTY_PRESET_PLAN §4.4) — .card 의 hover·클릭·키보드 규칙 재사용, 높이·여백만 덮음.
    // 3×2 (사용자 요청 2026-09-26) — 옛 1열 6칸은 git 태그 party-card-1row.
    // 여백 0 = hover 핑크 테두리가 타일 바깥에 딱 붙음 (사용자 요청). radius 7 = 테두리 1 + 타일 6 → 모서리 곡선 일치.
    // 한 장 카드 (사용자 선택 2026-09-26) — 칸 사이 여백 0·칸 모서리 0, 바깥 모서리는 카드 overflow 로 둥글게. 칸 구분 = 배경색.
    '.card.pt { display: grid; grid-template-columns: repeat(3, 1fr); height: auto; padding: 0; gap: 0; border-radius: 7px; overflow: hidden; }',
    '.tl { min-width: 0; height: 74px; padding: 5px 6px 0; display: flex; flex-direction: column; align-items: center; gap: 2px; }',
    // 이름 = 샘플 카드 종 이름(.line b 14px/500 #000)을 타일 폭(≈106px)에 맞춰 11px — "메가한카리아스Z" 가 한 줄에 들어가는 크기.
    // 왼쪽 정렬 = 샘플 카드 최소화판 (사용자 요청 2026-09-26). 일러는 가운데 유지.
    '.tl .pn { align-self: flex-start; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 500; line-height: 14px; color: #000; }',
    // 빈 칸 = 연회색 + 가운데 슬롯 번호 (사용자 선택). 번호 색 = 박스 비활성 탭과 같은 --nuo-text-muted, 노말 타입(#E3E3E3)보다 옅은 배경.
    '.tl.e { justify-content: center; padding: 0; background: #f5f5f5; }',
    '.tl .no { font-size: 14px; font-weight: 500; color: var(--nuo-text-muted); }',
    // 물건 = 일러 상자 오른쪽 아래 겹침 — 사이트 카드(일러 75 · 물건 30)와 같은 0.4 비율·위치.
    '.tl .ab { position: relative; flex: none; width: 50px; height: 50px; }',
    '.tl .a { display: block; width: 50px; height: 50px; object-fit: contain; }',
    '.tl .it { position: absolute; right: 0; bottom: 0; width: 20px; height: 20px; }'
  ].join('\n');

  // 사이트 PrimeVue Dialog 복제 — 모션·마스크는 styles/prefsModalCss.js 실측값 계승.
  // 2026-09-24 실측: 헤더 없는 Dialog, radius 12 (rounded-lg 클래스보다 PrimeVue 테마가 이김), content padding 0 20px 20px
  // (샘플 불러오기 창은 제목 줄이 윗변에 붙음), 확인창 = 폭 360 + 내부 p-4 text-center, 제목+설명 2줄.
  g.nuoSampleDialogCss = [
    ':host { all: initial; }',
    '.backdrop { position: fixed; inset: 0; z-index: 2147483646; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0); transition: background-color 0.15s ease; font-family: var(--nuo-font); }',
    '.backdrop.on { background: rgba(0, 0, 0, 0.5); }',
    '.box { position: relative; padding: 0 20px 20px; background: #fff; border: 1px solid var(--p-surface-200, #e2e8f0); border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1); opacity: 0; scale: 0.75; transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1), scale 0.15s cubic-bezier(0.4, 0, 0.2, 1); }',
    '.backdrop.on .box { opacity: 1; scale: 1; transition-timing-function: cubic-bezier(0, 0, 0.2, 1); }',
    '.box:focus { outline: none; }', // 열 때 포커스만 받아 둠 (openShell) — 표시용 테두리 없음

    // 사이트 원본은 위 여백 0(제목이 윗변에 붙음) — 우리 계산기 창만 사방 20 으로 보정 (사용자 요청 2026-09-24).
    '.box.list-box { width: 380px; padding-top: 20px; }',
    // 박스 높이 고정 (사용자 요청 2026-09-26) — 탭 전환·빈 목록에도 창이 안 움직이게. 머리 19 + 6 + 목록 최대 395 (2026-09-26 실측).
    '.box.list-box .lib { height: 420px; }',
    '.hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }',
    '.ttl { display: flex; align-items: center; font-size: 15px; font-weight: 500; color: #E4007F; }',
    '.ttl img { width: 24px; height: 24px; margin-right: 6px; }',
    '.x { width: 18px; height: 18px; padding: 0; border: 0; background: none; color: #000; cursor: pointer; line-height: 0; }',
    '.hacts { display: flex; align-items: center; gap: 10px; }',
    '.gear { width: 16px; height: 16px; padding: 0; border: 0; background: none; color: var(--nuo-text-muted); cursor: pointer; line-height: 0; transition: color 0.15s; }',
    '.gear:hover { color: var(--nuo-primary); }',
    '.gear svg { width: 16px; height: 16px; fill: currentColor; }',
    // 이름 창 = 사이트 '샘플 불러오기' 창(폭 320) + 사이트 라벨 필드(높이 50, #d8d8d8, radius 8, 라벨 9px).
    '.box.name-box { width: 320px; padding-top: 20px; }',
    '.nf { position: relative; display: block; margin-bottom: 12px; }',
    '.nl { position: absolute; top: -6px; left: 12px; padding: 0 4px; background: #fff; font-size: 9px; line-height: 1; color: var(--nuo-text-muted); white-space: nowrap; }',
    '.nf input { display: block; width: 100%; height: 50px; padding: 8px 12px; border: 1px solid var(--nuo-field-border); border-radius: 8px; background: #fff; font: 400 14px var(--nuo-font); color: var(--nuo-text-strong); outline: none; box-sizing: border-box; }',
    '.nf input::placeholder { color: #9e9e9e; }',
    '.nf input:focus { border-color: var(--nuo-primary); }',
    '.row { display: flex; justify-content: flex-end; gap: 6px; }',
    '.btn.plain { background: transparent; color: #272727; }',
    // 공격/수비 창 버튼 — 확인창 설명 줄 자리, 96×32 (사용자 요청: 보기 쉽게 크게).
    '.sides { display: flex; justify-content: center; gap: 8px; margin: 12px 0; }',
    '.side { display: flex; align-items: center; justify-content: center; gap: 6px; width: 96px; height: 32px; padding: 0; border: 0; border-radius: 8px; font: 400 14px var(--nuo-font); color: #fff; cursor: pointer; }',
    '.side.atk { background: #E9C46A; }',
    '.side.def { background: #8FC31F; }',
    '.side img { width: 16px; height: 16px; filter: brightness(0) invert(1); }',
    '.box.confirm { width: 360px; padding: 16px 36px 36px; text-align: center; }',
    '.q { margin: 0 0 4px; font-size: 16px; font-weight: 600; line-height: 24px; color: #334155; word-break: keep-all; }',
    '.sub { margin: 0 0 12px; font-size: 11px; line-height: 16.5px; color: #334155; word-break: keep-all; }',
    '.acts { display: flex; justify-content: center; gap: 6px; }',
    '.btn { width: 50px; height: 20px; padding: 0; border: 0; border-radius: 5px; font: 300 10px var(--nuo-font); cursor: pointer; }',
    '.btn.ghost { background: #EBEBED; color: #272727; }',
    '.btn.ok { background: #E9C46A; color: #fff; }',
    '.x:focus-visible, .btn:focus-visible, .gear:focus-visible, .side:focus-visible { outline: 2px solid var(--nuo-primary-focus); outline-offset: 1px; }',
    '@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }'
  ].join('\n');
})(typeof globalThis !== 'undefined' ? globalThis : self);
