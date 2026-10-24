/**
 * 샘플 저장·불러오기 공용 (SAMPLE_LIBRARY_PLAN §4). 저장소 CRUD + 사이트 카드 복제 렌더 + 목록 mount + 다이얼로그 셸.
 * 소비자: sampleParty.js (파티 탭), calcFill.js (계산기·스피드 "내 파티" 줄).
 * manifest: styles/sampleCard.js · sampleCardAssets.js · calcFillShared.js 뒤, 소비자 앞.
 */
(function (g) {
  'use strict';

  var CS = g.nuoCsCommon || {};
  var SL = g.nuoSlotRead;
  var A = g.NUO_SAMPLE_CARD_ASSETS || { stat: [], move: {}, tera: {}, pokeball: '' };
  var KEY = 'nuo_fmt_sampleLibrary';
  var PARTY_KEY = 'nuo_fmt_partyLibrary';
  var SCHEMA = 1;
  // 2026-09-24 실측: 카드 1장 HTML ≈ 18KB(아이콘 data URI 반복) → 100장 그리기 44~72ms. 넘기려면 아이콘을 CSS 로 한 번만 두고 올릴 것.
  var LIMIT = 100;
  var PARTY_LIMIT = 20; // 사용자 결정 (PARTY_PRESET_PLAN §2)

  function mapErr(code) {
    return typeof g.mapCalcFillError === 'function' ? g.mapCalcFillError(code) : String(code || '');
  }

  /* ===== 순수 로직 ===== */

  function normName(s) {
    return String(s == null ? '' : s).trim();
  }

  function findByName(items, name) {
    var n = normName(name);
    var i;
    for (i = 0; i < items.length; i++) {
      if (normName(items[i].name) === n) return items[i];
    }
    return null;
  }

  /** 같은 이름 항목을 빼고 entry 를 맨 앞에 (덮어쓰기 = 교체 + 최신 위치). */
  function withSaved(items, entry) {
    var n = normName(entry.name);
    return [entry].concat(items.filter(function (it) { return normName(it.name) !== n; }));
  }

  /** 새 이름은 limit 미만일 때만, 같은 이름 덮어쓰기는 항상 가능. limit 기본 = 샘플 LIMIT. */
  function canAdd(items, name, limit) {
    return items.length < (limit || LIMIT) || !!findByName(items, name);
  }

  function withoutId(items, id) {
    return items.filter(function (it) { return it.id !== id; });
  }

  function isLoadable(item) {
    return !!item && !SL.isEmpty(item.slot);
  }

  /** 파티 = 6칸, 칸마다 null 또는 포켓몬 이름 있는 슬롯, 최소 1마리. */
  function isPartyLoadable(item) {
    var s = item && item.slots;
    if (!Array.isArray(s) || s.length !== 6) return false;
    var i, n = 0;
    for (i = 0; i < 6; i++) {
      if (s[i] === null) continue;
      if (SL.isEmpty(s[i])) return false;
      n++;
    }
    return n > 0;
  }

  /* 사이트 번들 list 컴포넌트 규칙 (§3.3) — 수치·조건 그대로. */
  var TYPE_BG = {
    normal: '#E3E3E3', fire: '#F8BFBF', water: '#BFD9FB', grass: '#C6E3BF', electric: '#FEEDB3', ice: '#C6F4FF',
    fighting: '#FFD9B3', poison: '#DEC6F0', ground: '#DECBBD', flying: '#DAEAFB', psychic: '#FBC6D7', bug: '#DEE3BA',
    rock: '#E7E6DA', ghost: '#D5C6D5', dragon: '#CBD0F6', dark: '#CBC6C6', steel: '#D0E3EA', fairy: '#FBD5FB'
  };
  var STAT_KEYS = ['hp', 'attack', 'defense', 'special_attack', 'special_defense', 'speed'];
  var NATURE_KEY = { 공격: 'attack', 방어: 'defense', 특공: 'special_attack', 특방: 'special_defense', 스피드: 'speed' };

  function typeBg(t) {
    return TYPE_BG[t] || 'white';
  }

  /** 스탯 포인트 색 — 사이트 Se(): 0 파랑, 32 이상 핑크, 그 외 검정. */
  function spColor(v) {
    var n = Number(v) || 0;
    return n === 0 ? '#4184F3' : n >= 32 ? '#E4007F' : '#272727';
  }

  /** 성격 점 — 사이트 ve(): 상승 스탯 핑크, 하락 스탯 파랑. object 가 아니면 점 없음. */
  function natureDot(personality, key) {
    if (!personality || typeof personality !== 'object' || !personality.up || !personality.down) return 'transparent';
    if (NATURE_KEY[personality.up] === key) return '#E4007F';
    if (NATURE_KEY[personality.down] === key) return '#4184F3';
    return 'transparent';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 이미지 URL 은 https: 또는 사이트 상대경로만 (저장 데이터가 조작돼도 javascript: 등 차단). */
  function safeUrl(u) {
    var s = String(u || '');
    return /^(https:\/\/|\/[^/])/.test(s) ? s : '';
  }

  // 파티 탭 슬롯 아이콘 줄 요약 복사 아이콘과 같은 모양 (teamBuilderFill.js SUM_SVG).
  var COPY_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h7"/></svg>';
  var BOX_SVG = '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="M200-80q-33 0-56.5-23.5T120-160v-451q-18-11-29-28.5T80-680v-120q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v120q0 23-11 40.5T840-611v451q0 33-23.5 56.5T760-80H200Zm0-520v440h560v-440H200Zm-40-80h640v-120H160v120Zm200 280h240v-80H360v80Zm120 20Z"/></svg>';
  // 사이트 슬롯 줄 삭제 아이콘(30px PNG) 픽셀 그대로 옮긴 외곽선 휴지통 (2026-09-26 실측) — 30칸 격자 rect.
  var TRASH_SVG = '<svg viewBox="0 0 30 30" aria-hidden="true"><path d="M11 4h8v1h-8zM5 5h20v2H5zM6 7h3v17H6zM21 7h3v17h-3zM6 24h18v1H6zM7 25h16v1H7zM11 10h3v11h-3zM16 10h3v11h-3z"/></svg>';

  /**
   * 저장 항목 → 카드 마크업 (헤더 줄 + 사이트 카드). 어노테이션 없음 (§2).
   * @param {{ id: string, name: string, art: string, slot: object }} item
   * @returns {string}
   */
  function renderCard(item) {
    var slot = item && item.slot;
    var p = SL.mon(slot) || {};
    var species = SL.speciesKo(slot);
    var nat = SL.nature(slot);
    var ability = SL.ability(slot);
    var equip = SL.item(slot);
    var tera = A.tera[SL.tera(slot)] || '';
    var moves = Array.isArray(p.moves) ? p.moves : [];
    var moveNames = SL.moves(slot);
    var stats = p.stats || {};
    var id = esc(item.id);
    var h = '<div class="head"><span class="nm">' + esc(item.name) + '</span><span class="acts">' +
      '<button type="button" class="cp" data-id="' + id + '" aria-label="샘플 복사">' + COPY_SVG + '</button>' +
      '<button type="button" class="del" data-id="' + id + '" aria-label="삭제">' + TRASH_SVG + '</button></span></div>' +
      '<div class="card" role="button" tabindex="0" data-id="' + id + '" style="background:' + typeBg(p.first_type) + '">' +
      '<div class="info"><div class="line"><b>' + esc(species) + '</b>' +
      (nat ? '<span>' + esc(nat) + '</span>' : '') +
      (ability ? '<span>| ' + esc(ability) + '</span>' : '') +
      (equip ? '<span>| ' + esc(equip) + '</span>' : '') +
      (tera ? '<img class="tera" src="' + tera + '" alt="">' : '') +
      '</div><div class="moves">';
    var k;
    for (k = 0; k < 4; k++) {
      var m = moves[k];
      var mName = moveNames[k];
      var mIcon = mName && A.move[m.type] ? '<img src="' + A.move[m.type] + '" alt="">' : '';
      h += '<div class="mv">' + (mName ? mIcon + '<span>' + esc(mName) + '</span>' : '') + '</div>';
    }
    var art = safeUrl(item.art);
    h += '</div></div><div class="art">' +
      (art ? '<img class="a" src="' + esc(art) + '" alt="">' : '') +
      (equip ? '<img class="it" src="/data/party/equipment/' + encodeURIComponent(equip) + '.png" alt="">' : '') +
      '</div><div class="stats">';
    for (k = 0; k < STAT_KEYS.length; k++) {
      var sv = stats[STAT_KEYS[k]] || {};
      h += '<div class="st"><i style="background:' + natureDot(p.personality, STAT_KEYS[k]) + '"></i>' +
        (A.stat[k] ? '<img src="' + A.stat[k] + '" alt="">' : '') +
        '<span class="r">' + esc(sv.real == null ? '' : sv.real) + '</span>' +
        '<span class="v" style="color:' + spColor(sv.value) + '">' + esc(Number(sv.value) || 0) + '</span></div>';
    }
    return h + '</div></div>';
  }

  /**
   * 파티 항목 → 카드 마크업 (PARTY_PRESET_PLAN §4.4, 목업 3안 → 3×2 + 이름, 사용자 요청 2026-09-26.
   * 옛 1열 6칸은 git 태그 party-card-1row). 머리 줄은 샘플 카드와 같은 부품.
   * 타일 = 타입색 + 이름 + 일러 50 + 지닌 물건 20 (사이트 카드 75/30 비율·위치), 빈 칸 = 연회색 + 슬롯 번호.
   * 여섯 칸 사이 여백 없음 — 한 장 카드, 칸 구분은 배경색 (사용자 선택 2026-09-26).
   * @param {{ id: string, name: string, slots: Array, arts: Array }} item
   * @returns {string}
   */
  function renderPartyCard(item) {
    var id = esc(item.id);
    var slots = Array.isArray(item.slots) ? item.slots : [];
    var arts = Array.isArray(item.arts) ? item.arts : [];
    var h = '<div class="head"><span class="nm">' + esc(item.name) + '</span><span class="acts">' +
      '<button type="button" class="cp" data-id="' + id + '" aria-label="파티 복사">' + COPY_SVG + '</button>' +
      '<button type="button" class="del" data-id="' + id + '" aria-label="삭제">' + TRASH_SVG + '</button></span></div>' +
      '<div class="card pt" role="button" tabindex="0" data-id="' + id + '">';
    var k;
    for (k = 0; k < 6; k++) {
      var p = SL.mon(slots[k]);
      if (!p) { h += '<div class="tl e"><span class="no">' + (k + 1) + '</span></div>'; continue; }
      var equip = SL.item(slots[k]);
      var art = safeUrl(arts[k]) || SL.sprite(slots[k]);
      h += '<div class="tl" style="background:' + typeBg(p.first_type) + '">' +
        '<span class="pn">' + esc(SL.speciesKo(slots[k])) + '</span><span class="ab">' +
        (art ? '<img class="a" src="' + esc(art) + '" alt="">' : '') +
        (equip ? '<img class="it" src="/data/party/equipment/' + encodeURIComponent(equip) + '.png" alt="">' : '') +
        '</span></div>';
    }
    return h + '</div>';
  }

  /* ===== 저장소 — 샘플·파티 같은 모양 문서 { version, items } (PARTY_PRESET_PLAN §4.1) ===== */

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /**
   * @param {string} key chrome.storage.local 키
   * @param {string} failCode 읽기·쓰기 실패 reject 코드
   */
  // shortcut: readAll → writeAll 사이 잠금 없음 — 몇 ms 안에 두 번 저장하면 하나 유실 가능. 사용자 결정으로 둠 (2026-09-26).
  function makeStore(key, failCode) {
    function readAll() {
      return new Promise(function (resolve, reject) {
        try {
          chrome.storage.local.get([key], function (got) {
            if (chrome.runtime.lastError) { reject(new Error(failCode)); return; }
            var doc = got && got[key];
            resolve(doc && doc.version === SCHEMA && Array.isArray(doc.items) ? doc.items : []);
          });
        } catch (e) {
          reject(new Error(failCode));
        }
      });
    }
    function writeAll(items) {
      return new Promise(function (resolve, reject) {
        try {
          var obj = {};
          obj[key] = { version: SCHEMA, items: items };
          chrome.storage.local.set(obj, function () {
            if (chrome.runtime.lastError) { reject(new Error(failCode)); return; }
            resolve();
          });
        } catch (e) {
          reject(new Error(failCode));
        }
      });
    }
    return {
      readAll: readAll,
      save: function (entry) { return readAll().then(function (items) { return writeAll(withSaved(items, entry)); }); },
      remove: function (id) { return readAll().then(function (items) { return writeAll(withoutId(items, id)); }); },
      /** 다른 탭 저장·삭제 즉시 반영. @returns {function} teardown */
      onChange: function (cb) {
        if (typeof CS.onLocalPrefChange !== 'function') return function () {};
        return CS.onLocalPrefChange([key], function () { readAll().then(cb, function () {}); });
      }
    };
  }

  var samples = makeStore(KEY, 'storage_failed');
  var parties = makeStore(PARTY_KEY, 'party_save_failed');

  /**
   * @param {object} slot bridge 가 읽은 보강 슬롯 (sample_name 포함)
   * @param {string} art 일러스트 URL
   */
  function saveEntry(slot, art) {
    return samples.save({ id: newId(), name: normName(slot.sample_name), savedAt: Date.now(), slot: slot, art: art || '' });
  }

  /**
   * @param {string} name 파티 이름
   * @param {Array} slots 6칸 (빈 칸 null)
   * @param {Array} arts 6칸 일러 URL
   */
  function savePartyEntry(name, slots, arts) {
    return parties.save({ id: newId(), name: normName(name), savedAt: Date.now(), slots: slots, arts: arts });
  }

  /* ===== 목록 — 샘플·파티 공용 (PARTY_PRESET_PLAN §4.3) ===== */

  var KINDS = {
    sample: { store: samples, limit: LIMIT, render: renderCard, noun: '샘플', obj: '샘플을', empty: '저장한 샘플이 없습니다',
      readErr: 'storage_read_failed', delErr: 'storage_delete_failed', loadable: isLoadable, invalid: 'sample_invalid', copied: '샘플 복사 완료' },
    party: { store: parties, limit: PARTY_LIMIT, render: renderPartyCard, noun: '파티', obj: '파티를', empty: '저장한 파티가 없습니다',
      readErr: 'party_read_failed', delErr: 'party_delete_failed', loadable: isPartyLoadable, invalid: 'party_invalid', copied: '파티 복사 완료' }
  };

  /** 목록 머리 가운데 — 종류 1개면 라벨, 2개면 사이트 상단 메뉴식 텍스트 탭 (세로 구분선). */
  function headHtml(kinds, cur) {
    if (kinds.length === 1) return '<span class="lbl">' + KINDS[cur].noun + '</span>';
    return '<span class="lbl tabs">' + kinds.map(function (k) {
      return '<button type="button" class="tab' + (k === cur ? ' on' : '') + '" data-kind="' + k + '" aria-pressed="' + (k === cur) + '">' +
        KINDS[k].noun + '</button>';
    }).join('<i></i>') + '</span>';
  }

  /** 머리 줄은 빈 상태에도 그림 (탭 전환). 개수 뱃지 = 파티 탭 "SP 66/66" 뱃지 실측 + 회색. */
  function renderList(items, k, head) {
    var top = '<div class="count">' + head + '<span class="badge">' + BOX_SVG + items.length + '/' + k.limit + '</span></div>' +
      '<p class="msg" role="status"></p>';
    if (!items.length) return top + '<p class="empty">' + k.empty + '</p>';
    return top + '<div class="shell"><div class="list">' + items.map(k.render).join('') + '</div>' +
      '<div class="sb"><div class="thumb"></div></div><div class="tip" role="status" hidden></div></div>';
  }

  /**
   * box(Shadow 안 요소)에 목록을 그리고 저장소 변경을 따라감. 탭 = 종류 전환, 카드 클릭 = onPick(item, kind),
   * 휴지통 = 확인 후 삭제, 복사 = 파티 탭 복사 아이콘과 같은 변환 (teamBuilderFill.js nuoTeamCopy).
   * box 가 속한 Shadow root 에 nuoSampleCardCss 가 있어야 함.
   * @param {Element} box
   * @param {{ kinds: string[], onPick: function(object, string) }} opts
   * @returns {function} teardown
   */
  function mountList(box, opts) {
    var kinds = opts.kinds && opts.kinds.length ? opts.kinds : ['sample'];
    var cur = kinds[0];
    var items = [];
    var tipTimer = null;
    function draw() { box.innerHTML = renderList(items, KINDS[cur], headHtml(kinds, cur)); }
    /** 결과 말풍선 — .list 가 overflow 로 자르므로 .shell 기준으로 버튼 위에 띄움. */
    function showTip(btn, text, ms) {
      var tip = box.querySelector('.shell > .tip');
      var shell = box.querySelector('.shell');
      if (!tip || !shell) return;
      var b = btn.getBoundingClientRect();
      var s = shell.getBoundingClientRect();
      tip.textContent = text;
      tip.style.left = (b.left + b.width / 2 - s.left) + 'px';
      tip.style.top = (b.top - s.top) + 'px';
      tip.hidden = false;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(function () { tip.hidden = true; }, ms);
    }
    function setMsg(t) {
      var m = box.querySelector('.msg');
      if (m) m.textContent = t || '';
    }
    function itemOf(el) {
      var id = el.getAttribute('data-id');
      var i;
      for (i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
      return null;
    }
    function load() {
      var k = cur;
      KINDS[k].store.readAll().then(function (it) {
        if (k !== cur) return; // 읽는 사이 탭이 바뀜
        items = it;
        draw();
      }, function () {
        if (k !== cur) return;
        items = [];
        draw();
        setMsg(mapErr(KINDS[k].readErr));
      });
    }
    load();
    var offs = kinds.map(function (k) {
      return KINDS[k].store.onChange(function (it) {
        if (k !== cur) return;
        items = it;
        draw();
      });
    });

    box.addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (tab) {
        var nk = tab.getAttribute('data-kind');
        // items 비움 — 읽는 몇 ms 사이 남아 있는 옛 종류 카드 클릭은 itemOf 가 null → 무시 (빈 문구 깜빡임 없이)
        if (nk !== cur && KINDS[nk]) { cur = nk; items = []; load(); }
        return;
      }
      var cp = e.target.closest('.cp');
      if (cp) {
        var c = itemOf(cp);
        var TC = g.nuoTeamCopy;
        if (!c || cp.classList.contains('busy') || !TC) return;
        var kc = KINDS[cur];
        var job = cur === 'party' ? TC.copyPartySlots && TC.copyPartySlots(c.slots) : TC.copySampleSlot(c.slot);
        if (!job) return;
        cp.classList.add('busy');
        job.then(function () {
          cp.classList.remove('busy');
          showTip(cp, kc.copied, 1500);
        }, function (err) {
          cp.classList.remove('busy');
          window.alert((err && err.message) || '변환 실패');
        });
        return;
      }
      var del = e.target.closest('.del');
      if (del) {
        var d = itemOf(del);
        var kd = KINDS[cur];
        if (!d) return;
        confirmDialog('\'' + d.name + '\' ' + kd.obj + ' 삭제할까요?', '삭제하기', '삭제하면 복구할 수 없습니다.').then(function (yes) {
          if (yes) kd.store.remove(d.id).catch(function () { window.alert(mapErr(kd.delErr)); });
        });
        return;
      }
      var card = e.target.closest('.card');
      if (!card) return;
      var it = itemOf(card);
      if (!it) return;
      if (!KINDS[cur].loadable(it)) { window.alert(mapErr(KINDS[cur].invalid)); return; }
      opts.onPick(it, cur);
    });
    // 커스텀 오버레이 스크롤바 — 스피드표 펼치기(speedOutspeedCalc.js updateInlineScrollbar 등)와 같은 모양·동작.
    // 네이티브 바는 숨김(카드 폭 보존), 스크롤하는 동안만 thumb 가 보였다가 1.4s 뒤 fade.
    var sbHideTimer = null;
    var sbDragging = false;
    function syncScrollbar(show) {
      var list = box.querySelector('.list');
      var sb = box.querySelector('.sb');
      var thumb = sb && sb.firstChild;
      if (!list || !thumb) return;
      var sh = list.scrollHeight;
      var ch = list.clientHeight;
      if (sh <= ch + 1) { thumb.style.height = '0px'; return; }
      var th = Math.max(24, Math.round((ch / sh) * sb.clientHeight));
      var maxTop = sb.clientHeight - th;
      thumb.style.height = th + 'px';
      thumb.style.top = (maxTop > 0 ? Math.round((list.scrollTop / (sh - ch)) * maxTop) : 0) + 'px';
      if (!show) return;
      sb.classList.add('show');
      clearTimeout(sbHideTimer);
      sbHideTimer = setTimeout(function () { if (!sbDragging) sb.classList.remove('show'); }, 1400);
    }
    box.addEventListener('scroll', function () {
      syncScrollbar(true);
      var tip = box.querySelector('.shell > .tip');
      if (tip) tip.hidden = true; // 버튼과 함께 안 움직이므로 스크롤 시 숨김
    }, true); // scroll 은 버블 안 함 → capture
    box.addEventListener('mousedown', function (e) {
      if (!e.target.classList || !e.target.classList.contains('thumb')) return;
      e.preventDefault();
      var list = box.querySelector('.list');
      var sb = box.querySelector('.sb');
      sbDragging = true;
      var startY = e.clientY;
      var startScroll = list.scrollTop;
      var range = list.scrollHeight - list.clientHeight;
      var maxTop = sb.clientHeight - e.target.offsetHeight;
      function mm(ev) { list.scrollTop = startScroll + (maxTop > 0 ? ((ev.clientY - startY) / maxTop) * range : 0); }
      function mu() {
        sbDragging = false;
        document.removeEventListener('mousemove', mm, true);
        document.removeEventListener('mouseup', mu, true);
        syncScrollbar(true);
      }
      document.addEventListener('mousemove', mm, true);
      document.addEventListener('mouseup', mu, true);
    });
    box.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('card')) {
        e.preventDefault();
        e.target.click();
      }
    });
    // 도구 아이콘 등 404 → 깨진 이미지 대신 빈 자리 (사이트 카드도 이미지 없으면 비어 보임)
    box.addEventListener('error', function (e) {
      if (e.target && e.target.tagName === 'IMG') e.target.style.visibility = 'hidden';
    }, true);
    return function () {
      clearTimeout(tipTimer);
      offs.forEach(function (f) { f(); });
    };
  }

  /* ===== 다이얼로그 셸 — 사이트 PrimeVue Dialog 복제 (§5.4·§5.5) ===== */

  var DIALOG_CSS = (g.nuoTokensCss || '') + '\n' + (g.nuoSampleDialogCss || '') + '\n' + (g.nuoSampleCardCss || '');
  var LEAVE_MS = 150; // 사이트 p-dialog-leave-active 와 동일 (prefsEntry 와 같은 값)
  var MASK_DISMISS = false; // 2026-09-24 실측: 사이트 Dialog 는 마스크 클릭으로 안 닫힘
  var X_SVG = '<svg width="18" height="18" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>';
  var shells = [];

  /** 겹쳐 뜰 수 있음 (목록 위 확인창). Esc·마스크 = 맨 위 것만 닫힘. */
  function openShell(boxClass, html, onDismiss) {
    var host = document.createElement('div');
    host.setAttribute('data-nuo-inject', 'sample-dialog');
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + DIALOG_CSS + '</style>' +
      '<div class="backdrop" role="dialog" aria-modal="true"><div class="box ' + boxClass + '" tabindex="-1">' + html + '</div></div>';
    var bd = root.querySelector('.backdrop');
    // 포커스를 창 안으로 — 페이지 버튼(`박스`·아이콘)에 남으면 Enter/Space 가 같은 창을 또 엶. 입력칸 있는 창은 호출자가 다시 focus.
    root.querySelector('.box').focus({ preventScroll: true });
    var sh = { root: root, closed: false, onDismiss: onDismiss || null, teardown: null };
    sh.close = function () {
      if (sh.closed) return;
      sh.closed = true;
      var ix = shells.indexOf(sh);
      if (ix >= 0) shells.splice(ix, 1);
      if (sh.teardown) { try { sh.teardown(); } catch (eT) {} }
      bd.classList.remove('on');
      setTimeout(function () { if (host.parentNode) host.parentNode.removeChild(host); }, LEAVE_MS);
    };
    bd.addEventListener('click', function (e) {
      if (MASK_DISMISS && e.target === bd) dismiss(sh);
    });
    shells.push(sh);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { bd.classList.add('on'); });
    });
    return sh;
  }

  function dismiss(sh) {
    var cb = sh.onDismiss;
    sh.close();
    if (cb) cb();
  }

  try {
    // 사이트 Dialog 는 Esc 무반응이지만 키보드 접근성 위해 우리 창은 Esc = 닫기(취소) 유지
    document.addEventListener('keydown', function (e) {
      if (!shells.length) return;
      if (e.key !== 'Escape' && e.keyCode !== 27) return;
      e.stopPropagation(); // 뒤의 사이트 다이얼로그까지 같이 닫히지 않게
      dismiss(shells[shells.length - 1]);
    }, true);
    // 라우트 전환 시 떠 있는 우리 다이얼로그 정리 (prefsEntry 와 같은 처리)
    if (typeof CS.onRouteChange === 'function') {
      CS.onRouteChange(function () { while (shells.length) dismiss(shells[shells.length - 1]); });
    }
  } catch (eWire) {}

  /**
   * 사이트 슬롯 삭제 확인창 복제 — 제목 + 설명 2줄, [취소][확인] 순.
   * @param {string} question 예: "'물리접수' 샘플이 이미 있어요. 덮어쓸까요?"
   * @param {string} okLabel 예: '덮어쓰기' / '삭제하기'
   * @param {string=} sub 설명 줄 예: '삭제하면 복구할 수 없습니다.'
   * @returns {Promise<boolean>}
   */
  function confirmDialog(question, okLabel, sub) {
    return new Promise(function (resolve) {
      var sh = openShell('confirm',
        '<p class="q">' + esc(question) + '</p>' +
        (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') +
        '<div class="acts"><button type="button" class="btn ghost" data-a="no">취소</button>' +
        '<button type="button" class="btn ok" data-a="yes">' + esc(okLabel) + '</button></div>',
        function () { resolve(false); });
      sh.root.querySelector('.acts').addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        sh.close();
        resolve(b.getAttribute('data-a') === 'yes');
      });
      sh.root.querySelector('.btn.ok').focus();
    });
  }

  // Material "settings" (사이트 아이콘 세트와 같은 계열), 16px 회색 — 박스 헤더 X 왼쪽.
  var GEAR_SVG = '<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm112-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z"/></svg>';

  function titleHtml(text) {
    return '<span class="ttl">' + (A.pokeball ? '<img src="' + esc(A.pokeball) + '" alt="">' : '') + esc(text) + '</span>';
  }

  /**
   * 박스 — 중앙 열 `박스` 버튼(prefsEntry)의 모달 (PARTY_PRESET_PLAN §4.3). 톱니 = 박스 닫고 환경설정.
   * 카드 클릭은 닫지 않음 — 호출자가 확인 후 box.close().
   * @param {{ kinds: string[], onPick: function(object, string, object) }} opts
   * @returns {{ close: function() }}
   */
  function openBox(opts) {
    var sh = openShell('list-box',
      '<div class="hd">' + titleHtml('박스') + '<span class="hacts">' +
      '<button type="button" class="gear" aria-label="환경설정">' + GEAR_SVG + '</button>' +
      '<button type="button" class="x" aria-label="닫기">' + X_SVG + '</button></span></div><div class="lib"></div>');
    sh.root.querySelector('.x').addEventListener('click', function () { dismiss(sh); });
    sh.root.querySelector('.gear').addEventListener('click', function () {
      dismiss(sh);
      if (g.nuoPrefsModal && typeof g.nuoPrefsModal.open === 'function') g.nuoPrefsModal.open();
    });
    sh.teardown = mountList(sh.root.querySelector('.lib'), {
      kinds: opts.kinds,
      onPick: function (item, kind) { opts.onPick(item, kind, sh); }
    });
    return sh;
  }

  /**
   * 이름 입력 창 — 사이트 '샘플 불러오기' 창 복제 (제목 + 라벨 필드 + [취소][저장]). Enter = 저장.
   * @param {string} title '파티 저장' / '샘플 저장'
   * @param {string} label '파티 이름' / '샘플 이름'
   * @returns {Promise<string|null>} trim 한 이름, 취소면 null
   */
  function nameDialog(title, label) {
    return new Promise(function (resolve) {
      var sh = openShell('name-box',
        '<div class="hd">' + titleHtml(title) + '<button type="button" class="x" aria-label="닫기">' + X_SVG + '</button></div>' +
        '<label class="nf"><span class="nl">' + esc(label) + '</span>' +
        '<input type="text" maxlength="16" placeholder="이름을 입력해주세요" spellcheck="false" autocomplete="off"></label>' +
        '<div class="row"><button type="button" class="btn plain" data-a="no">취소</button>' +
        '<button type="button" class="btn ok" data-a="yes">저장</button></div>',
        function () { resolve(null); });
      var inp = sh.root.querySelector('input');
      function submit() {
        var v = normName(inp.value);
        if (!v) { inp.focus(); return; } // 빈 이름 = 창 유지 (§4.5)
        sh.close();
        resolve(v);
      }
      sh.root.querySelector('.x').addEventListener('click', function () { dismiss(sh); });
      sh.root.querySelector('.row').addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.getAttribute('data-a') === 'yes') submit();
        else dismiss(sh);
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter 무시 (Review Focus 2)
        e.preventDefault();
        submit();
      });
      inp.focus();
    });
  }

  /**
   * 계산기·스피드 — 샘플을 공격/수비 어느 쪽에 넣을지 (확인창 틀, 설명 줄 자리에 버튼 2개).
   * 색 = 사이트 '계산' 결과창 공격측 #E9C46A / 수비측 #8FC31F.
   * @param {string} question
   * @param {{ attacker: string, defender: string }} icons 사이트 칼/방패 img src ('' 이면 글자만)
   * @returns {Promise<'attacker'|'defender'|null>}
   */
  function sideDialog(question, icons) {
    function ic(src) {
      var u = safeUrl(src);
      return u ? '<img src="' + esc(u) + '" alt="">' : '';
    }
    return new Promise(function (resolve) {
      var sh = openShell('confirm',
        '<p class="q">' + esc(question) + '</p>' +
        '<div class="sides"><button type="button" class="side atk" data-a="attacker">' + ic(icons && icons.attacker) + '공격측</button>' +
        '<button type="button" class="side def" data-a="defender">' + ic(icons && icons.defender) + '수비측</button></div>' +
        '<div class="acts"><button type="button" class="btn ghost" data-a="no">취소</button></div>',
        function () { resolve(null); });
      sh.root.querySelector('.box').addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        var a = b.getAttribute('data-a');
        sh.close();
        resolve(a === 'attacker' || a === 'defender' ? a : null);
      });
      sh.root.querySelector('.side.atk').focus();
    });
  }

  g.nuoSampleLibrary = {
    LIMIT: LIMIT,
    PARTY_LIMIT: PARTY_LIMIT,
    normName: normName,
    findByName: findByName,
    canAdd: canAdd,
    isLoadable: isLoadable,
    isPartyLoadable: isPartyLoadable,
    readAll: samples.readAll,
    saveEntry: saveEntry,
    readParties: parties.readAll,
    savePartyEntry: savePartyEntry,
    renderCard: renderCard,
    renderPartyCard: renderPartyCard,
    mountList: mountList,
    confirmDialog: function (q, ok, sub) { return confirmDialog(q, ok, sub); },
    openBox: function (o) { return openBox(o); },
    nameDialog: function (t, l) { return nameDialog(t, l); },
    sideDialog: function (q, i) { return sideDialog(q, i); },
    _pure: {
      normName: normName, findByName: findByName, withSaved: withSaved, withoutId: withoutId,
      isLoadable: isLoadable, isPartyLoadable: isPartyLoadable, spColor: spColor, natureDot: natureDot, typeBg: typeBg,
      esc: esc, renderCard: renderCard, renderPartyCard: renderPartyCard,
      renderList: renderList, canAdd: canAdd, LIMIT: LIMIT, headHtml: headHtml, KINDS: KINDS
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
