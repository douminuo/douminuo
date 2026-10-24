importScripts('slotRead.js');
importScripts('shareToRaw.js');
importScripts('fmtCommon.js');
importScripts('koNames.js');
importScripts('formatter.js');
importScripts('calcPayload.js');
importScripts('simpleMovePower.js');
importScripts('attackerFormOverride.js');
importScripts('showdownPaste.js');

/**
 * GET /api/party/share/:id → 파티(6슬롯) 또는 단일 샘플.
 * 통합 입력: 한 줄(자동 판별) / 여러 줄(각각 단일 샘플만).
 */
(function () {
  'use strict';

  var SR = globalThis.shareToRaw;
  var SL = globalThis.nuoSlotRead;
  var SMP = globalThis.simpleMovePower;
  var AFO = globalThis.attackerFormOverride;

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
   * F41: 계산기 자동입력 GET_CALC_PAYLOADS_FROM_SLOT 의 8개 doc 묶음 (옛 URL 경로
   * GET_CALC_PAYLOADS 와 공유하던 헬퍼 — URL 경로는 REDESIGN §11 에서 제거).
   *
   * F40: moveTags.json 은 calcPayload.js 자체 로더에서도 fetch 하던 것을 본 헬퍼로 단일화.
   * buildOneSideFromFlatSlot 가 docs.moveTagsDoc 를 그대로 읽는다.
   *
   * @returns {Promise<{
   *   natureKoDoc: object, natureStatMulDoc: object, typeKoDoc: object,
   *   moveKoFallbackDoc: object, koNames: object, moveKoDoc: object,
   *   moveSlugToEnDoc: object, moveTagsDoc: object,
   * }>}
   */
  function loadCalcPayloadDocs() {
    return loadDocs({
      natureKoDoc: 'natureKoMap.json',
      natureStatMulDoc: 'natureStatMul.json',
      typeKoDoc: 'typeKoMap.json',
      moveKoFallbackDoc: 'moveKoFallback.json',
      koNames: loadKoNames(),
      moveKoDoc: 'moveKoMap.json',
      // 슬러그 정규화 (hyphenless → hyphenated) — calcPayload 가 한 번만 reduce.
      moveSlugToEnDoc: 'moveSlugToEn.json',
      moveTagsDoc: 'moveTags.json',
    });
  }

  function buildDisplayPartyUrl(origin, pathname, id) {
    var p = pathname || '/';
    return origin + p + '#ps=' + id;
  }

  /**
   * 결과 텍스트에 누오 URL이 들어가는 옵션인지 (어머니 사이트 보호 §A.2 #1).
   * - includeUrls === false: 사용자가 URL 출력 끔 → 슬롯·파티 URL 둘 다 안 들어감
   * - showdownPaste === true: PokePaste 출력은 URL을 포함하지 않음
   * → 둘 중 하나라도 해당되면 누오 POST를 보낼 이유가 없다.
   */
  function needsServerUrls(fo) {
    if (!fo) return true;
    if (fo.includeUrls === false) return false;
    if (fo.showdownPaste) return false;
    return true;
  }

  /**
   * 파티 전체: POST /api/party/share (동일 path), 본문 { data: { all: true, data: (6칸, 빈칸 null) } }.
   * 응답 { id } → #ps= (단일 슬롯과 동일). 단일 슬롯: { data: { slot, data } }.
   * 사이트 현행 본문과 동일 (2026-10 번들 BFJqrx6L — 옛 2026-04 캡처는 { params: { data } } 래핑).
   */
  function postSharePartyAll(origin, pathname, slotsSix) {
    if (!Array.isArray(slotsSix) || slotsSix.length !== 6) {
      return Promise.reject(new Error('bad_party_slots'));
    }
    var row = [];
    var anyFilled = false;
    var i;
    for (i = 0; i < 6; i++) {
      var s = slotsSix[i];
      if (SL.isEmpty(s)) {
        row.push(null);
      } else {
        anyFilled = true;
        try {
          row.push(JSON.parse(JSON.stringify(s)));
        } catch (e) {
          row.push(s);
        }
      }
    }
    if (!anyFilled) {
      return Promise.reject(new Error('empty_party'));
    }
    return fetch(origin + '/api/party/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        data: {
          all: true,
          data: row,
        },
      }),
    }).then(function (res) {
      return res.text().then(function (t) {
        var j = null;
        try {
          j = t ? JSON.parse(t) : null;
        } catch (e) {
          j = null;
        }
        if (!res.ok) {
          var hint =
            j && (j.message || j.error)
              ? String(j.message || j.error).slice(0, 120)
              : (t || '').slice(0, 100);
          throw new Error('party_share_post_' + res.status + (hint ? ': ' + hint : ''));
        }
        if (!j) throw new Error('empty_response');
        var sid = j.id != null ? j.id : j.data && j.data.id;
        if (!sid) throw new Error('empty_response');
        return buildDisplayPartyUrl(origin, pathname, sid);
      });
    });
  }

  function postShareSlot(origin, pathname, slotIndex1Based, slotData) {
    // 빈/무효 슬롯은 어떤 누오 호출도 가지 않는다 (어머니 사이트 보호 원칙 §A.2 #3).
    // 단순 null 또는 {}만이 아니라 pokemon.name 없는 메타-only 칸도 SL.isEmpty 가 잡는다.
    if (SL.isEmpty(slotData)) return Promise.resolve('');
    return fetch(origin + '/api/party/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        data: { slot: slotIndex1Based, data: slotData },
      }),
    })
      .then(function (res) {
        if (!res.ok) return '';
        return res.json();
      })
      .then(function (j) {
        if (!j) return '';
        var sid = j.id != null ? j.id : j.data && j.data.id;
        if (!sid) return '';
        return origin + (pathname || '/') + '#ps=' + sid;
      })
      .catch(function () {
        return '';
      });
  }

  function fetchPokemonTypesEn(name) {
    if (!name) return Promise.resolve([]);
    var url = 'https://pokeapi.co/api/v2/pokemon/' + encodeURIComponent(String(name).toLowerCase());
    return fetch(url, {
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
        return [];
      });
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
   * §A.4 보호 원칙: (3)은 평소 발동되지 않아야 한다.
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

  function realByLetterFromSlot(slot) {
    var out = {};
    var i;
    for (i = 0; i < 6; i++) out['HABCDS'.charAt(i)] = SL.stat(slot, i).real;
    return out;
  }

  /**
   * 슬롯 분석 입구 — 인라인 어노테이션·요약 복사 공용.
   * bulk = 복사용 (`기본 (버프)`), bulkInline = 인라인용 (풀체력 조건부 특성 제외 — F51).
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
      // 결정력 입력만 폼 보정한 클론으로 교체. 내구력/그 외 소비자는 원본 slotData 사용.
      var slotForPower = slotData;
      if (AFO && typeof AFO.applyAttackerFormOverride === 'function') {
        slotForPower = AFO.applyAttackerFormOverride(
          slotData,
          d.natureKoDoc,
          d.natureStatMulDoc
        );
      }
      var reals = realByLetterFromSlot(slotData);
      var speciesKo = SL.speciesKo(slotData);
      var titleCtx = SL.sampleName(slotData) + '\n' + speciesKo;
      function bulk(excludeConditional) {
        return globalThis.computeBulkPhysSpecBuffed(
          reals, d.names, SL.item(slotData), SL.ability(slotData), titleCtx, d.types || [],
          { excludeConditionalAbilities: excludeConditional, speciesName: speciesKo }
        );
      }
      return {
        movePowers: SMP.computeMovePowers(slotForPower, d.types, d.names, d.moveTags),
        bulk: bulk(false),
        bulkInline: bulk(true),
      };
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

  function normalizeSlotsToSix(slots) {
    var s = Array.isArray(slots) ? slots.slice(0, 6) : [];
    while (s.length < 6) s.push({});
    return s;
  }

  function cloneShareSlot(slot) {
    try {
      return JSON.parse(JSON.stringify(slot));
    } catch (e) {
      return slot && typeof slot === 'object' ? Object.assign({}, slot) : {};
    }
  }

  /**
   * 슬롯별 공유 URL — 순서대로 POST (빈 칸은 postShareSlot 이 '' 반환).
   * @param {boolean} include false 면 POST 없이 전부 '' (F16).
   */
  function collectSlotUrls(origin, pathname, slots6, include) {
    var urls = [];
    var chain = Promise.resolve();
    slots6.forEach(function (slotData, idx) {
      chain = chain.then(function () {
        if (!include) {
          urls.push('');
          return;
        }
        return postShareSlot(origin, pathname, idx + 1, slotData).then(function (u) {
          urls.push(u || '');
        });
      });
    });
    return chain.then(function () {
      return urls;
    });
  }

  /**
   * F14: 옛 if-체인을 dict lookup 으로. alias 키들은 같은 메시지를 명시적으로 매핑.
   */
  var SHARE_ERR_MSG = {
    empty: 'URL을 입력해 주세요.',
    empty_input: 'URL을 입력해 주세요.',
    no_party_url: 'URL 형식을 확인해 주세요.',
    bad_url: 'URL 형식을 확인해 주세요.',
    no_ps_id: '#ps= 가 포함된 스마트누오 공유 URL인지 확인해 주세요.',
    share_not_found: '공유를 불러오지 못했습니다. URL·로그인·네트워크를 확인하세요.',
    empty_response: '공유를 불러오지 못했습니다. URL·로그인·네트워크를 확인하세요.',
    unknown_share_shape: '지원하지 않는 공유 형식입니다.',
    bad_party_slots: '파티 슬롯 형식이 올바르지 않습니다.',
    empty_party: '비어 있는 파티입니다. 포켓몬을 넣은 뒤 다시 시도하세요.',
    team_slots_unavailable: '팀 슬롯(6칸)을 읽지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.',
    party_resolve_empty: '파티를 등록했지만 변환용 데이터를 받지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  function mapShareError(err) {
    var m = err && err.message ? String(err.message) : String(err);
    if (Object.prototype.hasOwnProperty.call(SHARE_ERR_MSG, m)) return SHARE_ERR_MSG[m];
    if (m.indexOf('party_share_post_') === 0) {
      return '파티 URL을 서버에 등록하지 못했습니다. 로그인·네트워크를 확인하세요.';
    }
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

    // F16: URL이 결과에 안 들어가는 옵션이면 누오 POST 생략.
    var pSampleUrl = needsServerUrls(fo)
      ? postShareSlot(origin, pathname, slotIndex, slotData)
      : Promise.resolve('');
    return pSampleUrl.then(function (sampleUrl) {
      var urls = { partyUrl: '', sampleUrls: [sampleUrl ? String(sampleUrl).trim() : ''] };
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
     * 출력: { ok: true, payloads: { attacker?, defender? } } — 한쪽만 채워짐.
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
        .then(function (payloads) {
          sendResponse({ ok: true, payloads: payloads });
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
      var needUrlsCp = needsServerUrls(foCp);

      // F16/F17: 결과 텍스트에 URL이 들어가지 않는 옵션이면 누오 등록 자체를 생략.
      // 들어가는 옵션이라도, 등록 후 GET 으로 다시 받아오는 단계는 생략 — 우리가
      // teamBuilderBridge 에서 받은 로컬 slotsCp 를 source of truth 로 사용.
      var pPartyUrlCp = needUrlsCp
        ? postSharePartyAll(originCp, pathnameCp, slotsCp)
        : Promise.resolve('');

      pPartyUrlCp
        .then(function (partyUrl) {
          var partyId = '';
          if (partyUrl) {
            partyId = SR.extractPsId(partyUrl) || '';
            if (!partyId) {
              return Promise.reject(new Error('party_resolve_empty'));
            }
          }
          var displayParty = partyId ? buildDisplayPartyUrl(originCp, pathnameCp, partyId) : '';
          var slots6 = normalizeSlotsToSix(slotsCp);
          return collectSlotUrls(originCp, pathnameCp, slots6, needUrlsCp).then(function (urls) {
            return formatSlotsForCopy(slots6, foCp, { partyUrl: displayParty, sampleUrls: urls }, true);
          });
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
    chrome.storage.local.remove(
      ['nuo_fmt_modifiersCache', 'nuo_fmt_moveTagsCache', 'nuo_fmt_moveKoCache', 'nuo_fmt_pokemonTypeCache'],
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
