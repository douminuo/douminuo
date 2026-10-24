/**
 * 팀빌더(MAIN). Nuxt 3 — `window.__NUXT__.state['$sparty.slots']` 직접 읽기.
 * NUO_TEAM_SLOTS_REPLY = 도감 보강한 슬롯 복제본만. 채워짐·일러스트 판정은 콘텐츠 쪽 slotRead.js (teamBuilderShared).
 */
(function () {
  if (window.__NUO_TEAM_BUILDER_BRIDGE_V12__) return;
  window.__NUO_TEAM_BUILDER_BRIDGE_V12__ = true;

  var MSG_EXT = 'nuo-team-ext';
  var MSG_BRIDGE = 'nuo-team-bridge';

  function getNuxtState() {
    try {
      var nx = window.__NUXT__;
      if (!nx) return null;
      if (nx.state && typeof nx.state === 'object') return nx.state;
      var pl = nx.payload;
      if (pl && pl.state && typeof pl.state === 'object') return pl.state;
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * $spokemon_list 가 채워질 때까지 최대 2초 폴링 — 부팅 직후 augment 가 빈 도감으로 스킵되는 race 방지.
   */
  /** F36: 한 번 ready 되면 이후 폴 생략 (bridge 가드 유지, 동일 page 컨텍스트). */
  var pokeListEverReady = false;

  /** F35: $spokemon_list lazy 인덱스 — augmentSlotWithDex 3회 선형 스캔 대체. */
  var tbPokeIxByKr = null;
  var tbPokeIxById = null;
  var tbPokeIxSourceRef = null;

  function ensureTbPokeIxBuilt(list) {
    if (!Array.isArray(list)) {
      tbPokeIxByKr = null;
      tbPokeIxById = null;
      tbPokeIxSourceRef = null;
      return;
    }
    if (tbPokeIxSourceRef === list) return;
    tbPokeIxByKr = Object.create(null);
    tbPokeIxById = Object.create(null);
    var i;
    var p;
    var kr;
    var pid;
    var noDash;
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (!p) continue;
      kr = String(p.kr || '').trim();
      if (kr && !tbPokeIxByKr[kr]) tbPokeIxByKr[kr] = p;
      pid = String(p.id || '').toLowerCase();
      if (pid) {
        if (!tbPokeIxById[pid]) tbPokeIxById[pid] = p;
        noDash = pid.replace(/-/g, '');
        if (noDash !== pid && !tbPokeIxById[noDash]) tbPokeIxById[noDash] = p;
      }
    }
    tbPokeIxSourceRef = list;
  }

  function waitForPokeListReady(maxMs, intervalMs) {
    if (pokeListEverReady) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var deadline = Date.now() + (maxMs || 2000);
      var step = intervalMs || 100;
      function tick() {
        var s = getNuxtState();
        if (s) {
          var pl = s['$spokemon_list'];
          if (Array.isArray(pl) && pl.length > 0) {
            pokeListEverReady = true;
            return resolve(true);
          }
        }
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tick, step);
      }
      tick();
    });
  }

  /**
   * 슬롯 pokemon 을 도감($spokemon_list)으로 보강 — 한칭 슬롯은 name(slug) 부실·second_type 누락 가능.
   * 얕은 복사만 해서 Nuxt reactive proxy 원본은 건드리지 않음.
   */
  function augmentSlotWithDex(slot, state) {
    if (!slot || typeof slot !== 'object' || !slot.pokemon) return slot;
    var poke = slot.pokemon;
    var hasSlug = poke.name && typeof poke.name === 'string' && /^[a-z][a-z0-9-]*$/i.test(poke.name);
    var slugFromNameObj = '';
    if (poke.name && typeof poke.name === 'object') {
      slugFromNameObj = String(poke.name.id || poke.name.smogon_id || '').toLowerCase().trim();
    }
    var hasBoth = poke.first_type && poke.second_type;

    // 구버전 공유 URL 로 sprite 가 빈 경우, 사이트의 $spokemon_dex.row_map 에서 도트 URL 복구.
    // 키는 하이픈 없는 영문 id (예: clefablemega). ZA 메가 등 $spokemon_list 에 없는 폼도 커버.
    // $spokemon_list 매칭/early return 보다 먼저 — 사이트 자체 dict 가 더 넓은 커버리지.
    var spriteFromDex = '';
    if (!poke.sprite) {
      var rowMap = state && state['$spokemon_dex.row_map'];
      if (rowMap && typeof rowMap === 'object') {
        var compactCandidates = [];
        if (hasSlug) compactCandidates.push(String(poke.name).toLowerCase().replace(/-/g, ''));
        if (slugFromNameObj) compactCandidates.push(slugFromNameObj.replace(/-/g, ''));
        var ci;
        var dexRow = null;
        for (ci = 0; ci < compactCandidates.length; ci++) {
          var key = compactCandidates[ci];
          if (key && rowMap[key]) {
            dexRow = rowMap[key];
            break;
          }
        }
        var spritePath = dexRow && (dexRow.sprite_sample || dexRow.sprite);
        if (spritePath && typeof spritePath === 'string' && spritePath.charAt(0) === '/') {
          spriteFromDex = 'https://smartnuo.com' + spritePath;
        }
      }
    }

    if (hasSlug && hasBoth && !spriteFromDex) return slot;

    var pokeList = state && state['$spokemon_list'];
    if (!Array.isArray(pokeList) || pokeList.length === 0) {
      if (!spriteFromDex) return slot;
      var nP = Object.assign({}, poke);
      nP.sprite = spriteFromDex;
      var nS = Object.assign({}, slot);
      nS.pokemon = nP;
      return nS;
    }

    ensureTbPokeIxBuilt(pokeList);
    var entry = null;
    var kr = String(poke.name_kr || '').trim();
    if (kr && tbPokeIxByKr) entry = tbPokeIxByKr[kr] || null;
    if (!entry && hasSlug && tbPokeIxById) {
      var slugLow = String(poke.name).toLowerCase();
      var slugNoDash = slugLow.replace(/-/g, '');
      entry = tbPokeIxById[slugLow] || tbPokeIxById[slugNoDash] || null;
    }
    if (!entry && slugFromNameObj && tbPokeIxById) {
      var slugObj = slugFromNameObj;
      var slugObjNoDash = slugObj.replace(/-/g, '');
      entry = tbPokeIxById[slugObj] || tbPokeIxById[slugObjNoDash] || null;
    }
    if (!entry) {
      if (!spriteFromDex) return slot;
      var npNoEntry = Object.assign({}, poke);
      npNoEntry.sprite = spriteFromDex;
      var nsNoEntry = Object.assign({}, slot);
      nsNoEntry.pokemon = npNoEntry;
      return nsNoEntry;
    }

    var types = Array.isArray(entry.types) ? entry.types : [];
    var t0 = types[0] ? String(types[0]).toLowerCase() : '';
    var t1 = types[1] ? String(types[1]).toLowerCase() : '';

    var newPoke = Object.assign({}, poke);
    // name 이 이미 객체로 들어있으면 사이트가 의존하는 모양일 수 있어 덮어쓰지 않음.
    if (!newPoke.name && entry.id) newPoke.name = entry.id;
    if (!newPoke.first_type && t0) newPoke.first_type = t0;
    if (!newPoke.second_type && t1) newPoke.second_type = t1;
    if (!newPoke.sprite && spriteFromDex) newPoke.sprite = spriteFromDex;

    var newSlot = Object.assign({}, slot);
    newSlot.pokemon = newPoke;
    return newSlot;
  }

  function pickBestSlots() {
    var s = getNuxtState();
    if (!s) return null;
    var raw = s['$sparty.slots'];
    if (!Array.isArray(raw)) return null;
    var out = [];
    var i;
    for (i = 0; i < 6; i++) {
      var slot = raw[i] != null ? raw[i] : {};
      out.push(augmentSlotWithDex(slot, s));
    }
    return out;
  }

  function cloneSlots(slots) {
    try {
      return JSON.parse(JSON.stringify(slots));
    } catch (e) {
      return null;
    }
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.source !== MSG_EXT || d.type !== 'NUO_TEAM_GET_SLOTS') return;
    var rid = d.requestId != null ? String(d.requestId) : '';
    waitForPokeListReady(2000, 100).then(function () {
      var slots = pickBestSlots();
      if (!slots) {
        window.postMessage(
          {
            source: MSG_BRIDGE,
            type: 'NUO_TEAM_SLOTS_REPLY',
            requestId: rid,
            ok: false,
            error: 'no_party_slots',
            slots: null,
          },
          '*'
        );
        return;
      }
      var cloned = cloneSlots(slots);
      if (!cloned) {
        window.postMessage(
          {
            source: MSG_BRIDGE,
            type: 'NUO_TEAM_SLOTS_REPLY',
            requestId: rid,
            ok: false,
            error: 'clone_failed',
            slots: null,
          },
          '*'
        );
        return;
      }
      window.postMessage(
        {
          source: MSG_BRIDGE,
          type: 'NUO_TEAM_SLOTS_REPLY',
          requestId: rid,
          ok: true,
          slots: cloned,
        },
        '*'
      );
    });
  });

  /**
   * 샘플 저장·불러오기 (SAMPLE_LIBRARY_PLAN §4.2).
   * 읽기 = 우측 편집 패널 `$sparty.input` 을 계산기 칩과 같은 보강(augmentSlotWithDex) 후 깊은 복사.
   * 쓰기 = `$sparty.input` 대입 — 사이트가 slots[active-1]·좌측 카드·localStorage 까지 동기화.
   * slots[i] 직접 변경은 사이트 localStorage 에 반영 안 됨 (2026-09-23 실측) → 금지.
   */
  function postInputReply(type, rid, body) {
    var msg = { source: MSG_BRIDGE, type: type, requestId: rid };
    var k;
    for (k in body) {
      if (Object.prototype.hasOwnProperty.call(body, k)) msg[k] = body[k];
    }
    window.postMessage(msg, '*');
  }

  window.addEventListener('message', function (ev) {
    // 같은 window(우리 콘텐츠 스크립트)에서 온 것만 — 사이트 안 다른 출처 iframe 이 슬롯을 덮어쓰지 못하게.
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.source !== MSG_EXT) return;
    if (d.type !== 'NUO_TEAM_READ_INPUT' && d.type !== 'NUO_TEAM_WRITE_INPUT') return;
    var rid = d.requestId != null ? String(d.requestId) : '';
    var replyType = d.type === 'NUO_TEAM_READ_INPUT' ? 'NUO_TEAM_INPUT_REPLY' : 'NUO_TEAM_WRITE_REPLY';
    waitForPokeListReady(2000, 100).then(function () {
      var s = getNuxtState();
      var input = s && s['$sparty.input'];
      var active = s && Number(s['$sparty.active_slot']);
      if (!input || typeof input !== 'object' || !(active >= 1 && active <= 6)) {
        postInputReply(replyType, rid, { ok: false, error: 'bridge_state_missing' });
        return;
      }
      if (d.type === 'NUO_TEAM_READ_INPUT') {
        var hasPoke = !!(input.pokemon && input.pokemon.name);
        var slot = hasPoke ? cloneSlots(augmentSlotWithDex(input, s)) : null;
        if (hasPoke && !slot) {
          postInputReply(replyType, rid, { ok: false, error: 'bridge_state_missing' });
          return;
        }
        postInputReply(replyType, rid, { ok: true, slot: slot, active: active });
        return;
      }
      var next = cloneSlots(d.slot);
      if (!next || !next.pokemon || !next.pokemon.name) {
        postInputReply(replyType, rid, { ok: false, error: 'sample_invalid' });
        return;
      }
      next.slot_display = '#' + active;
      try {
        s['$sparty.input'] = next;
      } catch (eW) {
        postInputReply(replyType, rid, { ok: false, error: 'bridge_state_missing' });
        return;
      }
      postInputReply(replyType, rid, { ok: true });
    });
  });

  /**
   * 파티 불러오기 (PARTY_PRESET_PLAN §4.2). 6칸 배열 통째 재대입 = 사이트 store set_slot 과 같은 경로
   * → persist watcher 가 localStorage `smartnuo.party` 저장. 활성 슬롯은 편집 패널에도 반영
   * (사이트 load_active_slot_to_input 과 같음). 활성 슬롯이 빈 칸이면 사이트 watcher 가 빈 입력으로 되돌림.
   */
  function isPartySlotsShape(slots) {
    if (!Array.isArray(slots) || slots.length !== 6) return false;
    var i;
    for (i = 0; i < 6; i++) {
      var x = slots[i];
      if (x === null) continue;
      if (!x || typeof x !== 'object' || !x.pokemon || !x.pokemon.name) return false;
    }
    return true;
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return; // READ/WRITE_INPUT 과 같은 출처 가드
    var d = ev.data;
    if (!d || d.source !== MSG_EXT || d.type !== 'NUO_TEAM_WRITE_PARTY') return;
    var rid = d.requestId != null ? String(d.requestId) : '';
    waitForPokeListReady(2000, 100).then(function () {
      var s = getNuxtState();
      var active = s && Number(s['$sparty.active_slot']);
      if (!s || !Array.isArray(s['$sparty.slots']) || !(active >= 1 && active <= 6)) {
        postInputReply('NUO_TEAM_WRITE_REPLY', rid, { ok: false, error: 'bridge_state_missing' });
        return;
      }
      var next = cloneSlots(d.slots);
      if (!isPartySlotsShape(next)) {
        postInputReply('NUO_TEAM_WRITE_REPLY', rid, { ok: false, error: 'party_invalid' });
        return;
      }
      try {
        s['$sparty.slots'] = next;
        var cur = cloneSlots(next[active - 1]);
        if (cur) {
          cur.slot_display = '#' + active;
          s['$sparty.input'] = cur;
        }
      } catch (eW) {
        postInputReply('NUO_TEAM_WRITE_REPLY', rid, { ok: false, error: 'bridge_state_missing' });
        return;
      }
      postInputReply('NUO_TEAM_WRITE_REPLY', rid, { ok: true });
    });
  });

  /**
   * 슬롯 #index 의 샘플 이름만 바꿈 — 이름 없는 슬롯을 저장하며 입력한 이름을 사이트에도 (2026-09-26 실측):
   * 편집 중 슬롯 = input.sample_name (편집 패널 제목 칸·카드·localStorage 가 따라감),
   * 다른 슬롯 = 그 칸만 복제해 slots 배열 재대입 (WRITE_PARTY 와 같은 경로).
   */
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.source !== MSG_EXT || d.type !== 'NUO_TEAM_SET_SLOT_NAME') return;
    var rid = d.requestId != null ? String(d.requestId) : '';
    var idx = Number(d.index);
    var name = typeof d.name === 'string' ? d.name.slice(0, 16) : '';
    var s = getNuxtState();
    var active = s && Number(s['$sparty.active_slot']);
    var slots = s && s['$sparty.slots'];
    if (!Array.isArray(slots) || !(idx >= 1 && idx <= 6) || !name || !slots[idx - 1]) {
      postInputReply('NUO_TEAM_WRITE_REPLY', rid, { ok: false, error: 'bridge_state_missing' });
      return;
    }
    try {
      if (idx === active && s['$sparty.input']) {
        s['$sparty.input'].sample_name = name;
      } else {
        var next = slots.slice();
        var cur = cloneSlots(next[idx - 1]);
        cur.sample_name = name;
        next[idx - 1] = cur;
        s['$sparty.slots'] = next;
      }
    } catch (eN) {
      postInputReply('NUO_TEAM_WRITE_REPLY', rid, { ok: false, error: 'bridge_state_missing' });
      return;
    }
    postInputReply('NUO_TEAM_WRITE_REPLY', rid, { ok: true });
  });
})();
