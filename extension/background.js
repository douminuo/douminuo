importScripts('slotRead.js');
importScripts('shareToRaw.js');
importScripts('fmtCommon.js');
importScripts('koNames.js');
importScripts('formatter.js');
importScripts('calcPayload.js');
importScripts('simpleMovePower.js');
importScripts('attackerFormOverride.js');
importScripts('slotAnalysis.js');
importScripts('showdownPaste.js');

/**
 * 서비스 워커 — 팀빌더·계산기 콘텐츠 스크립트 메시지 처리 (요약·Showdown 복사, 결정력·내구력 주석,
 * 계산기 자동입력 페이로드). 스마트누오 호출 = 공유 등록 구역 한 곳.
 */
(function () {
  'use strict';

  var SL = globalThis.nuoSlotRead;
  var SMP = globalThis.simpleMovePower;

  /** 확장 패키지 JSON 파일 → 읽기 실패·모양 이상 때 쓸 빈 문서. */
  var DOC_EMPTY = {
    'modifiers.json': { version: 0, items: {}, abilities: {} },
    'moveTags.json': { version: 0, moves: {} },
    'moveKoMap.json': { version: 0, byKo: {} },
    'moveKoFallback.json': { version: 0, byKo: {} },
    'moveSlugToEn.json': { bySlug: {} },
    // F20: 종 영문 slug → [type1, type2]. 미커버 종이면 fetchPokemonTypesEn fallback.
    'pokemonTypeMap.json': { version: 0, bySlug: {} },
    'pokemonSlugToDex.json': { bySlug: {} },
    'itemKoMap.json': { byKo: {} },
    'itemKoFallback.json': { byKo: {} },
    'abilityKoMap.json': { byKo: {} },
    'abilityKoFallback.json': { byKo: {} },
    'natureKoMap.json': { koToSlug: {} },
    'natureStatMul.json': { bySlug: {} },
    'typeKoMap.json': { byKo: {} },
  };

  function hasObjectKey(key) {
    return function (j) {
      return j && typeof j[key] === 'object' && j[key] !== null ? j : null;
    };
  }

  /** 모양 검사 — 통과하면 (보정한) 문서, 아니면 falsy → 빈 문서. */
  var DOC_VALIDATE = {
    'modifiers.json': function (j) {
      if (!hasObjectKey('items')(j)) return null;
      if (!j.abilities || typeof j.abilities !== 'object') j.abilities = {};
      return j;
    },
    'moveTags.json': hasObjectKey('moves'),
    'moveKoMap.json': hasObjectKey('byKo'),
    'pokemonTypeMap.json': hasObjectKey('bySlug'),
  };

  /**
   * F1: 번들 JSON 을 SW 라이프타임 1회만 fetch + parse. 성공한 결과만 캐시 (fetch 실패면 다음 호출이 재시도).
   *
   * 주의: 결과 객체는 캐시와 공유 — 변형(mutate) 금지.
   */
  var jsonDocCache = Object.create(null);    // fileName → resolved doc
  var jsonInflight = Object.create(null);    // fileName → in-flight Promise

  function loadJsonUrl(fileName) {
    if (Object.prototype.hasOwnProperty.call(jsonDocCache, fileName)) {
      return Promise.resolve(jsonDocCache[fileName]);
    }
    if (jsonInflight[fileName]) return jsonInflight[fileName];
    var p = fetch(chrome.runtime.getURL(fileName))
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        var validate = DOC_VALIDATE[fileName];
        if (validate) j = validate(j) || DOC_EMPTY[fileName];
        jsonDocCache[fileName] = j;
        delete jsonInflight[fileName];
        return j;
      })
      .catch(function () {
        delete jsonInflight[fileName];
        return DOC_EMPTY[fileName];
      });
    jsonInflight[fileName] = p;
    return p;
  }

  /**
   * 이름 → 파일명(문자열) 또는 Promise 묶음을 한 번에 기다려 같은 이름의 객체로.
   * @param {Object<string, string|Promise>} spec
   * @returns {Promise<Object<string, any>>}
   */
  function loadDocs(spec) {
    var names = Object.keys(spec);
    return Promise.all(
      names.map(function (k) {
        return typeof spec[k] === 'string' ? loadJsonUrl(spec[k]) : spec[k];
      })
    ).then(function (arr) {
      var out = {};
      names.forEach(function (k, i) {
        out[k] = arr[i];
      });
      return out;
    });
  }

  /**
   * 한글 이름 해석기 (koNames.js) — 도구·특성·기술, 사이트 표기(*KoFallback) 우선. SW 라이프타임 1회 빌드.
   * shortcut: 로드 실패 시 빈 문서로 만든 해석기가 SW 종료까지 캐시됨 — SW 재시작이 잦아 실사용 영향 작음.
   */
  var koNamesPromise = null;
  function loadKoNames() {
    if (koNamesPromise) return koNamesPromise;
    koNamesPromise = loadDocs({
      modifiers: 'modifiers.json',
      itemMap: 'itemKoMap.json',
      itemSite: 'itemKoFallback.json',
      abilityMap: 'abilityKoMap.json',
      abilitySite: 'abilityKoFallback.json',
      moveMap: 'moveKoMap.json',
      moveSite: 'moveKoFallback.json',
    }).then(globalThis.nuoKoNames.forDocs);
    return koNamesPromise;
  }

  /**
   * F41: 계산기 자동입력 GET_CALC_PAYLOADS_FROM_SLOT 의 doc 묶음 (옛 URL 경로
   * GET_CALC_PAYLOADS 와 공유하던 헬퍼 — URL 경로는 REDESIGN §11 에서 제거).
   *
   * F40: moveTags.json 은 calcPayload.js 자체 로더에서도 fetch 하던 것을 본 헬퍼로 단일화.
   * buildOneSideFromFlatSlot 가 docs.moveTagsDoc 를 그대로 읽는다.
   *
   * @returns {Promise<{
   *   natureKoDoc: object, natureStatMulDoc: object, typeKoDoc: object,
   *   koNames: object,
   *   moveSlugToEnDoc: object, moveTagsDoc: object,
   * }>}
   */
  function loadCalcPayloadDocs() {
    return loadDocs({
      natureKoDoc: 'natureKoMap.json',
      natureStatMulDoc: 'natureStatMul.json',
      typeKoDoc: 'typeKoMap.json',
      koNames: loadKoNames(),
      // 슬러그 정규화 (hyphenless → hyphenated) — calcPayload 가 한 번만 reduce.
      moveSlugToEnDoc: 'moveSlugToEn.json',
      moveTagsDoc: 'moveTags.json',
    });
  }

  function buildDisplayPartyUrl(origin, pathname, id) {
    var p = pathname || '/';
    return origin + p + '#ps=' + id;
  }

  // ── 공유 등록 (POST /api/party/share) ────────────────────────────────────
  /**
   * 스마트누오 공유 등록과 호출 수 규칙은 이 구역 한 곳 (CLAUDE §4 어머니 사이트 보호). 핸들러는 URL만 받는다.
   * - 0회: 결과에 URL이 안 들어가는 옵션 (includeUrls === false, Showdown), 빈 칸.
   * - 슬롯 복사 = 1회, 파티 복사 = 파티 1 + 채운 칸 수 (파티 먼저, 칸은 순서대로).
   * - 같은 origin·본문 = SW 수명 1회: 진행 중 요청도 공유, 실패하면 메모에서 빼서 다음 복사가 다시 보냄.
   * - 실패 = 원인(HTTP 오류·id 없는 응답·네트워크) 상관없이 슬롯 slot_share_failed / 파티 party_share_failed.
   *   하나라도 실패하면 복사 전체 실패 (링크 빠진 "복사 완료" 없음). 다시 누르면 메모 덕에 성공 못 한 것만 나감.
   * 본문 = 사이트 현행 (2026-10 번들 BFJqrx6L — 옛 2026-04 캡처는 { params: { data } } 래핑):
   *   파티 { data: { all: true, data: 6칸(빈칸 null) } }, 슬롯 { data: { slot, data } }. 응답 { id } → #ps=.
   * shortcut: 파티 복사 도중 실패해도 먼저 성공한 등록은 서버에 남음, 메모는 크기 제한 없음 — SW 수명이 짧아 그대로.
   */
  var shareMemo = Object.create(null);

  function needsServerUrls(fo) {
    return fo.includeUrls !== false && !fo.showdownPaste;
  }

  /** @returns {Promise<string>} 표시 URL. */
  function postShare(origin, pathname, body, failCode) {
    // 보내는 쪽은 location.origin 고정이지만 SW 에서도 스마트누오만 (보안 감사 2026-11-14)
    if (origin !== 'https://smartnuo.com' && origin !== 'https://www.smartnuo.com') return Promise.reject(new Error(failCode));
    var mk = origin + '\n' + body;
    if (!shareMemo[mk]) {
      shareMemo[mk] = fetch(origin + '/api/party/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'include',
        body: body,
      })
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (j) {
          var sid = j && (j.id != null ? j.id : j.data && j.data.id);
          if (!sid) throw new Error(failCode);
          return sid;
        })
        .catch(function () {
          delete shareMemo[mk];
          throw new Error(failCode);
        });
    }
    return shareMemo[mk].then(function (sid) {
      return buildDisplayPartyUrl(origin, pathname, sid);
    });
  }

  /** 빈 칸 = '' (호출 없음). 빈 판정 = SL.isEmpty (pokemon.name 없는 메타-only 칸 포함). */
  function shareSlot(origin, pathname, slotIndex1Based, slotData) {
    if (SL.isEmpty(slotData)) return Promise.resolve('');
    var body = JSON.stringify({ data: { slot: slotIndex1Based, data: slotData } });
    return postShare(origin, pathname, body, 'slot_share_failed');
  }

  /** 슬롯 복사용 URL. 저장 샘플 복사는 칸 번호가 없어 호출자가 1을 넘김. */
  function shareUrlsForSlot(origin, pathname, fo, slotIndex1Based, slotData) {
    if (!needsServerUrls(fo)) return Promise.resolve({ partyUrl: '', sampleUrls: [''] });
    return shareSlot(origin, pathname, slotIndex1Based, slotData).then(function (u) {
      return { partyUrl: '', sampleUrls: [u] };
    });
  }

  /** 파티 복사용 URL. slots6 = 6칸 (빈 파티는 핸들러가 먼저 거름). */
  function shareUrlsForParty(origin, pathname, fo, slots6) {
    if (!needsServerUrls(fo)) return Promise.resolve({ partyUrl: '', sampleUrls: ['', '', '', '', '', ''] });
    var body = JSON.stringify({
      data: {
        all: true,
        data: slots6.map(function (s) {
          return SL.isEmpty(s) ? null : s;
        }),
      },
    });
    var out = { partyUrl: '', sampleUrls: [] };
    var chain = postShare(origin, pathname, body, 'party_share_failed').then(function (u) {
      out.partyUrl = u;
    });
    slots6.forEach(function (slotData, idx) {
      chain = chain.then(function () {
        return shareSlot(origin, pathname, idx + 1, slotData).then(function (u) {
          out.sampleUrls.push(u);
        });
      });
    });
    return chain.then(function () {
      return out;
    });
  }

  /** slug → 타입 Promise. 같은 종 = SW 라이프타임 1회 (TEMPLATES §10.4). 404 의 [] 도 저장, 네트워크 실패만 다음에 재시도. */
  var typeFetchMemo = Object.create(null);

  function fetchPokemonTypesEn(name) {
    if (!name) return Promise.resolve([]);
    var key = String(name).toLowerCase();
    if (typeFetchMemo[key]) return typeFetchMemo[key];
    var url = 'https://pokeapi.co/api/v2/pokemon/' + encodeURIComponent(key);
    return (typeFetchMemo[key] = fetch(url, {
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        if (!res.ok) return [];
        return res.json();
      })
      .then(function (j) {
        if (!j || !Array.isArray(j.types)) return [];
        return j.types
          .map(function (t) {
            return t && t.type && t.type.name ? String(t.type.name).toLowerCase() : '';
          })
          .filter(Boolean);
      })
      .catch(function () {
        delete typeFetchMemo[key];
        return [];
      }));
  }

  function collectTypesFromSlotPokemon(poke) {
    if (!poke) return [];
    var out = [];
    [poke.first_type, poke.second_type].forEach(function (t) {
      if (t == null || t === '') return;
      var e = SMP.normalizeTypeToEn(t);
      if (e && out.indexOf(e) < 0) out.push(e);
    });
    return out;
  }

  function mergeTypeLists(a, b) {
    var out = (a && a.slice()) || [];
    (b || []).forEach(function (t) {
      if (t && out.indexOf(t) < 0) out.push(t);
    });
    return out;
  }

  /**
   * F20: 슬롯 → 종 타입 [type1, type2?] (영문 slug).
   * 우선순위: (1) 슬롯의 firstType/secondType (2) 번들 pokemonTypeMap.bySlug
   *          (3) 마지막 수단으로 PokéAPI fetch — 신규 폼이 번들에 없을 때만.
   * CLAUDE §4 트래픽 보호: (3)은 평소 발동되지 않아야 한다.
   */
  function resolveSpeciesTypesForSlot(slotData) {
    var local = collectTypesFromSlotPokemon(SL.mon(slotData));
    if (local.length >= 2) return Promise.resolve(local);
    var slug = SL.speciesSlug(slotData);
    if (!slug) return Promise.resolve(local);

    return loadJsonUrl('pokemonTypeMap.json').then(function (bundle) {
      var bySlug = bundle && bundle.bySlug;
      if (bySlug && Array.isArray(bySlug[slug]) && bySlug[slug].length) {
        var merged = mergeTypeLists(local, bySlug[slug]);
        return merged.length ? merged : local;
      }
      // 번들 미커버 → PokéAPI fallback (드물게 발생)
      return fetchPokemonTypesEn(slug).then(function (apiTypes) {
        var merged = mergeTypeLists(local, apiTypes);
        return merged.length ? merged : local;
      });
    });
  }

  /**
   * 슬롯 분석 입구 — 인라인 어노테이션·요약 복사 공용. 문서 로딩만 하고 계산은 slotAnalysis.js.
   * @returns {Promise<{ movePowers: Array, bulk: object|null, bulkInline: object|null }>}
   */
  function analyzeSlot(slotData) {
    if (SL.isEmpty(slotData)) {
      return Promise.resolve({ movePowers: [null, null, null, null], bulk: null, bulkInline: null });
    }
    return loadDocs({
      names: loadKoNames(),
      moveTags: 'moveTags.json',
      types: resolveSpeciesTypesForSlot(slotData),
      natureKoDoc: 'natureKoMap.json',
      natureStatMulDoc: 'natureStatMul.json',
    }).then(function (d) {
      return globalThis.nuoSlotAnalysis.analyze(slotData, d);
    });
  }

  function analyzeSlotsInOrder(slots) {
    var out = [];
    var chain = Promise.resolve();
    slots.forEach(function (s, i) {
      chain = chain.then(function () {
        return analyzeSlot(s).then(function (a) {
          out[i] = a;
        });
      });
    });
    return chain.then(function () {
      return out;
    });
  }

  function cloneShareSlot(slot) {
    try {
      return JSON.parse(JSON.stringify(slot));
    } catch (e) {
      return slot && typeof slot === 'object' ? Object.assign({}, slot) : {};
    }
  }

  /**
   * F14: 옛 if-체인을 dict lookup 으로. share_not_found·empty_response·unknown_share_shape =
   * classifyShareGetResponse (사용자 결정으로 유지) 가 던지는 코드.
   */
  var SHARE_ERR_MSG = {
    share_not_found: '공유를 불러오지 못했습니다. URL·로그인·네트워크를 확인하세요.',
    empty_response: '공유를 불러오지 못했습니다. URL·로그인·네트워크를 확인하세요.',
    unknown_share_shape: '지원하지 않는 공유 형식입니다.',
    empty_party: '비어 있는 파티입니다. 포켓몬을 넣은 뒤 다시 시도하세요.',
    team_slots_unavailable: '팀 슬롯(6칸)을 읽지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.',
    slot_share_failed: '샘플 URL을 서버에 등록하지 못했습니다. 로그인·네트워크를 확인하세요.',
    party_share_failed: '파티 URL을 서버에 등록하지 못했습니다. 로그인·네트워크를 확인하세요.',
  };

  function mapShareError(err) {
    var m = err && err.message ? String(err.message) : String(err);
    if (Object.prototype.hasOwnProperty.call(SHARE_ERR_MSG, m)) return SHARE_ERR_MSG[m];
    return m;
  }

  function loadPasteBundleDocs() {
    return loadDocs({
      koNames: loadKoNames(),
      moveSlugToEnDoc: 'moveSlugToEn.json',
      natureKoDoc: 'natureKoMap.json',
      typeKoDoc: 'typeKoMap.json',
    });
  }

  /** F14: builder 슬롯 변환 전용 코드 + share 에러로 위임. */
  var BUILDER_FORMAT_ERR_MSG = {
    empty_slot: '빈 슬롯입니다.',
    bad_index: '슬롯 번호가 올바르지 않습니다.',
  };

  function mapBuilderFormatError(err) {
    var m = err && err.message ? String(err.message) : String(err);
    if (Object.prototype.hasOwnProperty.call(BUILDER_FORMAT_ERR_MSG, m)) {
      return BUILDER_FORMAT_ERR_MSG[m];
    }
    return mapShareError(err);
  }

  function formatBuilderSlotFromPage(msg) {
    var slotIndex = msg.slotIndex | 0;
    var slotData = msg.slotData;
    var origin = msg.origin || 'https://smartnuo.com';
    var pathname = msg.pathname || '/';
    var fo = msg.formatOptions || {};

    if (slotIndex < 1 || slotIndex > 6) {
      return Promise.reject(new Error('bad_index'));
    }
    if (!slotData || SL.isEmpty(slotData)) {
      return Promise.reject(new Error('empty_slot'));
    }

    return shareUrlsForSlot(origin, pathname, fo, slotIndex, slotData).then(function (urls) {
      return formatSlotsForCopy([slotData], fo, urls, false);
    });
  }

  /**
   * 슬롯 목록 + 팀빌더 formatOptions → 요약 또는 Showdown 텍스트 (슬롯 복사·파티 복사 공용).
   * @param {{ partyUrl: string, sampleUrls: string[] }} urls URL 끈 설정이면 빈 값 (F16)
   * @param {boolean} numbered 파티 = `#N` 제목
   */
  function formatSlotsForCopy(slots, fo, urls, numbered) {
    function summary() {
      return analyzeSlotsInOrder(slots).then(function (analyses) {
        return globalThis.formatSlotsText(slots, analyses, {
          numberedTitle: numbered,
          includeUrls: fo.includeUrls !== false,
          includeRealStats: !!fo.includeRealStats,
          includeMovePowers: !!fo.includeMovePowers,
          includeBulkStats: !!fo.includeBulkStats,
          partyUrl: urls.partyUrl,
          sampleUrls: urls.sampleUrls,
        });
      });
    }
    if (!fo.showdownPaste) return summary();
    return loadPasteBundleDocs().then(function (docs) {
      return globalThis.buildShowdownPaste(slots.map(cloneShareSlot), docs) || summary();
    });
  }

  // ── 업데이트 알림 ──────────────────────────────────────────────────────────

  /**
   * major 또는 minor 버전이 올라간 경우만 true.
   * patch만 변경(x.y.z → x.y.z+1)이면 false.
   * @param {string} prev  예: "1.4.0"
   * @param {string} curr  예: "1.5.0"
   */
  function isMinorOrMajorUpdate(prev, curr) {
    var p = String(prev || '0.0.0').split('.').map(Number);
    var c = String(curr || '0.0.0').split('.').map(Number);
    return c[0] > p[0] || (c[0] === p[0] && c[1] > p[1]);
  }

  /**
   * 업데이트 알림 플래그를 storage에 기록 (페이지 토스트 updateToast.js 가 읽음).
   * patch 업데이트(minor·major 미변경)이면 아무것도 하지 않는다.
   */
  function triggerUpdateNotice(prev, curr) {
    if (!isMinorOrMajorUpdate(prev, curr)) return;
    chrome.storage.local.set({ nuo_fmt_pendingUpdateNotice: { version: curr, shownInPage: false } });
  }

  /**
   * MAIN world 에서 실행 — Nuxt 가 SSR 화면 hydration 을 끝낼 때까지 대기 (최대 10초).
   * 그 전에 사이트 DOM 에 우리 host 를 끼우면 Vue 가 불일치로 판단해 화면이 뒤엉킴 (2026-09-24 재현:
   * 계산기 새로고침 5회 중 3회 "Hydration completed but contains mismatches", 확장 없는 브라우저 9회 중 0회).
   * 겸사: 사이트 라우트 이동이 끝날 때(Nuxt `page:finish` — 새 페이지 DOM 이 이미 있음) 콘텐츠 스크립트에
   * NUO_PAGE_FINISH_V1 을 보냄 (calcFillShared 가 받아 경로 판정·앵커 삽입). 페이지당 1회만 등록.
   */
  function waitNuxtHydratedInPage() {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var el = document.getElementById('__nuxt');
        var nx = el && el.__vue_app__ && el.__vue_app__.$nuxt;
        if (nx && typeof nx.hook === 'function' && !window.__NUO_PAGE_FINISH_HOOK_V1__) {
          window.__NUO_PAGE_FINISH_HOOK_V1__ = true;
          nx.hook('page:finish', function () {
            window.postMessage({ source: 'nuo-route-page', type: 'NUO_PAGE_FINISH_V1' }, '*');
          });
        }
        if ((nx && nx.isHydrating === false) || Date.now() - t0 > 10000) { resolve(true); return; }
        setTimeout(poll, 50);
      })();
    });
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (!msg) return;

    if (msg.type === 'WAIT_SITE_HYDRATED') {
      var hyTabId = _sender && _sender.tab && _sender.tab.id;
      if (hyTabId == null) {
        sendResponse({ ok: false });
        return true;
      }
      chrome.scripting
        .executeScript({
          target: { tabId: hyTabId, frameIds: [_sender.frameId || 0] },
          world: 'MAIN',
          func: waitNuxtHydratedInPage,
        })
        .then(function () {
          sendResponse({ ok: true });
        })
        .catch(function () {
          sendResponse({ ok: false });
        });
      return true;
    }

    if (msg.type === 'INJECT_CALC_BRIDGE' || msg.type === 'INJECT_TEAM_BUILDER_BRIDGE') {
      var injTabId = _sender && _sender.tab && _sender.tab.id;
      if (injTabId == null) {
        sendResponse({ ok: false, error: 'no_sender_tab' });
        return true;
      }
      var injFile =
        msg.type === 'INJECT_CALC_BRIDGE' ? 'calcFillBridge.js' : 'teamBuilderBridge.js';
      chrome.scripting
        .executeScript({
          target: { tabId: injTabId },
          world: 'MAIN',
          files: [injFile],
        })
        .then(function () {
          sendResponse({ ok: true });
        })
        .catch(function (e) {
          sendResponse({ ok: false, error: String((e && e.message) || e) });
        });
      return true;
    }

    if (msg.type === 'FORMAT_BUILDER_SLOT') {
      formatBuilderSlotFromPage(msg)
        .then(function (text) {
          sendResponse({ ok: true, text: text != null ? String(text) : '' });
        })
        .catch(function (err) {
          sendResponse({
            ok: false,
            error: mapBuilderFormatError(err),
          });
        });
      return true;
    }

    if (msg.type === 'ANNOTATE_BUILDER_SLOT') {
      var slotAn = msg.slotData;
      if (!slotAn || SL.isEmpty(slotAn)) {
        sendResponse({
          ok: true,
          empty: true,
          movePowerSuffixes: [null, null, null, null],
          bulkText: '',
          bulkCompact: '',
        });
        return true;
      }
      analyzeSlot(slotAn)
        .then(function (a) {
          var mp = a.movePowers || [];
          sendResponse({
            ok: true,
            movePowerSuffixes: [0, 1, 2, 3].map(function (mi) {
              return globalThis.movePowerSuffixFormatter(mp[mi]);
            }),
            bulkText: globalThis.formatBulkLinesFromComp(a.bulkInline),
            bulkCompact: globalThis.formatBulkCompactSlashFromComp(a.bulkInline),
          });
        })
        .catch(function (err) {
          sendResponse({
            ok: false,
            error: mapShareError(err) || String((err && err.message) || err),
          });
        });
      return true;
    }

    /**
     * 계산기 자동 입력 — 팀빌더 슬롯 직접 입력 경로. share GET 호출 없음.
     * 입력: { slot, side: 'attacker'|'defender' }
     * 출력: { ok: true, payload } — 요청한 한쪽 (칸 선택은 bridge). 빈 슬롯·종 없음 = { ok: false, error }.
     */
    if (msg.type === 'GET_CALC_PAYLOADS_FROM_SLOT') {
      var CPs = globalThis.nuoCalcPayload;
      if (!CPs || typeof CPs.buildSidePayloadFromSlot !== 'function') {
        sendResponse({ ok: false, error: 'calc_payload_unavailable' });
        return true;
      }
      var slotIn = msg.slot;
      var sideIn = msg.side === 'defender' ? 'defender' : 'attacker';
      if (!slotIn || typeof slotIn !== 'object' || SL.isEmpty(slotIn)) {
        sendResponse({ ok: false, error: mapShareError(new Error('empty_slot')) });
        return true;
      }
      loadCalcPayloadDocs()
        .then(function (docs) {
          return CPs.buildSidePayloadFromSlot(slotIn, sideIn, docs, msg.page);
        })
        .then(function (payload) {
          sendResponse({ ok: true, payload: payload });
        })
        .catch(function (err) {
          sendResponse({
            ok: false,
            error: mapShareError(err) || String((err && err.message) || err),
          });
        });
      return true;
    }

    if (msg.type === 'COPY_PARTY_SHARE_URL') {
      var originCp = msg.origin || 'https://smartnuo.com';
      var pathnameCp = msg.pathname || '/';
      var slotsCp = msg.partySlots;

      var hasSixSlots = Array.isArray(slotsCp) && slotsCp.length === 6;
      var hasAnyMon =
        hasSixSlots &&
        (function () {
          var j;
          for (j = 0; j < 6; j++) {
            if (!SL.isEmpty(slotsCp[j])) return true;
          }
          return false;
        })();

      if (!hasSixSlots) {
        sendResponse({ ok: false, error: mapShareError(new Error('team_slots_unavailable')) });
        return true;
      }
      if (!hasAnyMon) {
        sendResponse({ ok: false, error: mapShareError(new Error('empty_party')) });
        return true;
      }

      var foCp = msg.formatOptions || {};
      // F17: 등록 후 GET 으로 다시 받아오지 않음 — teamBuilderBridge 에서 받은 slotsCp 가 source of truth.
      shareUrlsForParty(originCp, pathnameCp, foCp, slotsCp)
        .then(function (urls) {
          return formatSlotsForCopy(slotsCp, foCp, urls, true);
        })
        .then(function (text) {
          sendResponse({ ok: true, text: text != null ? String(text) : '' });
        })
        .catch(function (err) {
          sendResponse({
            ok: false,
            error: mapShareError(err),
          });
        });
      return true;
    }

    if (msg.type === 'GET_POKEMON_SLUG_TO_DEX') {
      loadJsonUrl('pokemonSlugToDex.json').then(function (doc) {
        sendResponse({ ok: true, doc: doc });
      });
      return true;
    }

    // 팝업 fallback 감지용. 팝업 배너 미구현 상태에서도 핸들러는 준비해 둔다.
    if (msg.type === 'TRIGGER_UPDATE_NOTICE') {
      triggerUpdateNotice(
        String(msg.prevVersion || '0.0.0'),
        chrome.runtime.getManifest().version
      );
      sendResponse({ ok: true });
      return true;
    }
  });

  chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason !== 'update') return;
    // 2.0.1: 옛 번들 storage 미러 정리 — fetch 성공마다 쓰기만 하던 사본 (ARCH_REVIEW 후보 3).
    // 2.0.2: 계산기 기술 PokéAPI 조회 캐시 — 기술 고르기 = 슬롯만 (calcPayload firstDamagingMoveFromSlot).
    chrome.storage.local.remove(
      [
        'nuo_fmt_modifiersCache',
        'nuo_fmt_moveTagsCache',
        'nuo_fmt_moveKoCache',
        'nuo_fmt_pokemonTypeCache',
        'nuo_fmt_moveMetaCache',
        'nuo_calc_move_ko_slug_map',
      ],
      function () {
        return chrome.runtime.lastError;
      }
    );
    triggerUpdateNotice(
      String(details.previousVersion || '0.0.0'),
      chrome.runtime.getManifest().version
    );
  });
})();
