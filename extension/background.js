importScripts('shareToRaw.js');
importScripts('fmtCommon.js');
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
  var SMP = globalThis.simpleMovePower;
  var AFO = globalThis.attackerFormOverride;

  var SK_MODIFIERS_CACHE = 'nuo_fmt_modifiersCache';
  var SK_MOVETAGS_CACHE = 'nuo_fmt_moveTagsCache';
  var SK_MOVEKO_CACHE = 'nuo_fmt_moveKoCache';
  var SK_POKEMON_TYPE_CACHE = 'nuo_fmt_pokemonTypeCache';

  /**
   * JSON 문자열 파싱 + 스키마 검증. 실패/비정상이면 `empty`를 반환.
   * @param {string} text
   * @param {(j:any)=>any|null} validate 유효하면 수정된 doc을 반환, 아니면 falsy
   * @param {object} empty 실패 시 반환할 기본 문서
   */
  function safeJsonParse(text, validate, empty) {
    try {
      var j = JSON.parse(text);
      var ok = validate(j);
      return ok || empty;
    } catch (e) {
      return empty;
    }
  }

  var EMPTY_MODIFIERS = { version: 0, items: {}, abilities: {} };
  var EMPTY_MOVETAGS = { version: 0, moves: {} };
  var EMPTY_MOVEKOMAP = { version: 0, byKo: {} };
  var EMPTY_POKEMON_TYPE = { version: 0, bySlug: {} };

  function parseModifiersJson(text) {
    return safeJsonParse(
      text,
      function (j) {
        if (!j || typeof j.items !== 'object' || j.items === null) return null;
        if (!j.abilities || typeof j.abilities !== 'object') j.abilities = {};
        return j;
      },
      EMPTY_MODIFIERS
    );
  }

  function parseMoveTagsJson(text) {
    return safeJsonParse(
      text,
      function (j) {
        return j && typeof j.moves === 'object' && j.moves !== null ? j : null;
      },
      EMPTY_MOVETAGS
    );
  }

  function parseMoveKoMapJson(text) {
    return safeJsonParse(
      text,
      function (j) {
        return j && typeof j.byKo === 'object' && j.byKo !== null ? j : null;
      },
      EMPTY_MOVEKOMAP
    );
  }

  function parsePokemonTypeJson(text) {
    return safeJsonParse(
      text,
      function (j) {
        return j && typeof j.bySlug === 'object' && j.bySlug !== null ? j : null;
      },
      EMPTY_POKEMON_TYPE
    );
  }

  function makeBundleLoader(storageKey, fileName, parse, emptyDoc) {
    var promise = null;
    return function ensureLoaded() {
      if (promise) return promise;
      promise = fetch(chrome.runtime.getURL(fileName))
        .then(function (res) {
          return res.text();
        })
        .then(function (text) {
          var doc = parse(text);
          try {
            chrome.storage.local.set({
              [storageKey]: { text: text, savedAt: Date.now() },
            });
          } catch (e) {}
          return doc;
        })
        .catch(function () {
          return new Promise(function (resolve) {
            chrome.storage.local.get([storageKey], function (got) {
              if (chrome.runtime.lastError) {
                resolve(emptyDoc);
                return;
              }
              var c = got[storageKey];
              if (c && c.text) {
                resolve(parse(c.text));
                return;
              }
              resolve(emptyDoc);
            });
          });
        });
      return promise;
    };
  }

  var ensureMoveKoMapLoaded = makeBundleLoader(
    SK_MOVEKO_CACHE,
    'moveKoMap.json',
    parseMoveKoMapJson,
    { version: 0, byKo: {} }
  );
  var ensureMoveTagsLoaded = makeBundleLoader(
    SK_MOVETAGS_CACHE,
    'moveTags.json',
    parseMoveTagsJson,
    { version: 0, moves: {} }
  );
  var ensureModifiersLoaded = makeBundleLoader(
    SK_MODIFIERS_CACHE,
    'modifiers.json',
    parseModifiersJson,
    { version: 0, items: {}, abilities: {} }
  );
  // F20: 종 영문 slug → [type1, type2] 번들 lookup. 빌드 타임에 PokéAPI 일괄 추출
  // (scripts/generate-pokemon-type-map.js). 없거나 미커버 종이면 fetchPokemonTypesEn fallback.
  var ensurePokemonTypeMapLoaded = makeBundleLoader(
    SK_POKEMON_TYPE_CACHE,
    'pokemonTypeMap.json',
    parsePokemonTypeJson,
    EMPTY_POKEMON_TYPE
  );

  /**
   * F41: 계산기 자동입력 GET_CALC_PAYLOADS_FROM_SLOT 의 8개 doc 묶음 (옛 URL 경로
   * GET_CALC_PAYLOADS 와 공유하던 헬퍼 — URL 경로는 REDESIGN §11 에서 제거).
   *
   * F40: moveTags.json 은 calcPayload.js 자체 로더에서도 fetch 하던 것을 본 헬퍼로 단일화.
   * buildOneSideFromFlatSlot 가 docs.moveTagsDoc 를 그대로 읽는다.
   *
   * @returns {Promise<{
   *   natureKoDoc: object, natureStatMulDoc: object, typeKoDoc: object,
   *   moveKoFallbackDoc: object, modifiersDoc: object, moveKoDoc: object,
   *   moveSlugToEnDoc: object, moveTagsDoc: object,
   * }>}
   */
  function loadCalcPayloadDocs() {
    return Promise.all([
      loadJsonUrl('natureKoMap.json', { koToSlug: {} }),
      loadJsonUrl('natureStatMul.json', { bySlug: {} }),
      loadJsonUrl('typeKoMap.json', { byKo: {} }),
      loadJsonUrl('moveKoFallback.json', { version: 0, byKo: {} }),
      ensureModifiersLoaded(),
      ensureMoveKoMapLoaded(),
      // 본 라운드: 슬러그 정규화 (hyphenless → hyphenated) — calcPayload 가 한 번만 reduce.
      // 옛 코드는 hyphen 위치를 모르고 sequential 추측해 ~10 sequential 404 (~2~4초).
      loadJsonUrl('moveSlugToEn.json', { bySlug: {} }),
      ensureMoveTagsLoaded(),
    ]).then(function (arr) {
      return {
        natureKoDoc: arr[0],
        natureStatMulDoc: arr[1],
        typeKoDoc: arr[2],
        moveKoFallbackDoc: arr[3],
        modifiersDoc: arr[4],
        moveKoDoc: arr[5],
        moveSlugToEnDoc: arr[6],
        moveTagsDoc: arr[7],
      };
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
      if (SR.isSlotEmpty(s)) {
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
    // 단순 null 또는 {}만이 아니라 {slot:1, data:null} 같은 메타-only 케이스도 SR.isSlotEmpty가 잡는다.
    if (SR.isSlotEmpty(slotData)) return Promise.resolve('');
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
    [poke.firstType, poke.secondType, poke.first_type, poke.second_type].forEach(function (t) {
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
    var poke = slotData && slotData.pokemon;
    var local = collectTypesFromSlotPokemon(poke);
    if (local.length >= 2) return Promise.resolve(local);
    if (!poke || !poke.name) return Promise.resolve(local);

    var slug = String(poke.name).toLowerCase();
    return ensurePokemonTypeMapLoaded().then(function (bundle) {
      var bySlug = bundle && bundle.bySlug;
      if (bySlug && Array.isArray(bySlug[slug]) && bySlug[slug].length) {
        var merged = mergeTypeLists(local, bySlug[slug]);
        return merged.length ? merged : local;
      }
      // 번들 미커버 → PokéAPI fallback (드물게 발생)
      return fetchPokemonTypesEn(poke.name).then(function (apiTypes) {
        var merged = mergeTypeLists(local, apiTypes);
        return merged.length ? merged : local;
      });
    });
  }

  function computeBlockPowersForSlot(slotData) {
    if (SR.isSlotEmpty(slotData)) {
      return Promise.resolve({
        movePowers: [null, null, null, null],
        speciesTypesEn: [],
      });
    }
    return Promise.all([
      ensureModifiersLoaded(),
      ensureMoveTagsLoaded(),
      ensureMoveKoMapLoaded(),
      resolveSpeciesTypesForSlot(slotData),
      loadJsonUrl('natureKoMap.json', { koToSlug: {} }),
      loadJsonUrl('natureStatMul.json', { bySlug: {} }),
      loadJsonUrl('moveKoFallback.json', { version: 0, byKo: {} }),
    ]).then(function (arr) {
      var rules = arr[0];
      var moveTags = arr[1];
      var moveKo = arr[2];
      // 사이트 표기(moveKoFallback) 도 한글명 lookup 에 포함 — 영문 name 없는 기술 대비. idempotent.
      mergeByKoPaste(moveKo, arr[6]);
      var types = arr[3];
      var natureKoDoc = arr[4];
      var natureStatMulDoc = arr[5];
      // 결정력 입력만 폼 보정한 클론으로 교체. 내구력/그 외 소비자는 원본 slotData 사용.
      var slotForPower = slotData;
      if (AFO && typeof AFO.applyAttackerFormOverride === 'function') {
        slotForPower = AFO.applyAttackerFormOverride(
          slotData,
          natureKoDoc,
          natureStatMulDoc
        );
      }
      return {
        movePowers: SMP.computeMovePowers(slotForPower, types, rules, moveTags, moveKo),
        speciesTypesEn: types || [],
      };
    });
  }

  function sequentialComputeBlockAugmented(slots) {
    var blockMovePowers = [];
    var blockSpeciesTypes = [];
    var pchain = Promise.resolve();
    var i;
    for (i = 0; i < slots.length; i++) {
      (function (idx) {
        pchain = pchain.then(function () {
          return computeBlockPowersForSlot(slots[idx]).then(function (pack) {
            blockMovePowers[idx] = pack.movePowers;
            blockSpeciesTypes[idx] = pack.speciesTypesEn;
          });
        });
      })(i);
    }
    return pchain.then(function () {
      return { blockMovePowers: blockMovePowers, blockSpeciesTypes: blockSpeciesTypes };
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
   * @param {string} origin
   * @param {string} pathname
   * @param {string} partyId 등록된 파티의 #ps= 값. 빈 문자열이면 partyUrl도 빈 문자열.
   * @param {object[]} slots 6슬롯 (로컬 또는 GET 결과)
   * @param {{ includeSlotUrls?: boolean }} [opts] includeSlotUrls=false 면 슬롯별 POST 생략 (F16).
   */
  function resolvePartyWithRaws(origin, pathname, partyId, slots, opts) {
    opts = opts || {};
    var includeSlotUrls = opts.includeSlotUrls !== false;
    var slots6 = normalizeSlotsToSix(slots);
    var displayParty = partyId ? buildDisplayPartyUrl(origin, pathname, partyId) : '';
    var urls = [];
    var raws = [];
    var chain = Promise.resolve();
    var i;
    for (i = 0; i < 6; i++) {
      (function (idx) {
        chain = chain.then(function () {
          var slotData = slots6[idx];
          raws.push(SR.shareSlotToRaw(slotData, idx + 1, { numberedTitle: true }));
          if (!includeSlotUrls) {
            urls.push('');
            return;
          }
          return postShareSlot(origin, pathname, idx + 1, slotData).then(function (u) {
            urls.push(u || '');
          });
        });
      })(i);
    }
    return chain.then(function () {
      return sequentialComputeBlockAugmented(slots6).then(function (pack) {
        return {
          partyUrl: displayParty,
          sampleUrls: urls,
          pasteRaw: raws.join('\n\n'),
          shareSlots: slots6.map(cloneShareSlot),
          blockMovePowers: pack.blockMovePowers,
          blockSpeciesTypes: pack.blockSpeciesTypes,
        };
      });
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

  /**
   * F1: 같은 번들 JSON을 여러 경로(loadPasteBundleDocs, computeBlockPowersForSlot,
   * GET_CALC_PAYLOADS 등)에서 거듭 fetch + JSON.parse 하던 낭비를 SW 라이프타임
   * 메모이제이션으로 제거. 성공한 결과만 캐시 (실패면 다음 호출이 재시도).
   *
   * 주의: 호출자가 결과 객체를 변형(mutate)하는 경우 캐시도 같이 변형된다.
   * loadPasteBundleDocs의 mergeByKoPaste 가 moveKoMap 의 byKo 를 덮어쓰지만
   * `if (base[k] == null)` 가드로 idempotent — 재호출 시 no-op.
   */
  var jsonDocCache = Object.create(null);    // fileName → resolved doc
  var jsonInflight = Object.create(null);    // fileName → in-flight Promise

  function loadJsonUrl(fileName, empty) {
    if (Object.prototype.hasOwnProperty.call(jsonDocCache, fileName)) {
      return Promise.resolve(jsonDocCache[fileName]);
    }
    if (jsonInflight[fileName]) return jsonInflight[fileName];
    var p = fetch(chrome.runtime.getURL(fileName))
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        jsonDocCache[fileName] = j;
        delete jsonInflight[fileName];
        return j;
      })
      .catch(function () {
        delete jsonInflight[fileName];
        return empty;
      });
    jsonInflight[fileName] = p;
    return p;
  }

  function mergeByKoPaste(baseDoc, fallbackDoc) {
    var base = baseDoc && baseDoc.byKo;
    var fb = fallbackDoc && fallbackDoc.byKo;
    if (!base || !fb) return;
    var k;
    for (k in fb) {
      if (!Object.prototype.hasOwnProperty.call(fb, k)) continue;
      if (base[k] == null) base[k] = fb[k];
    }
  }

  function loadPasteBundleDocs() {
    return Promise.all([
      loadJsonUrl('moveKoMap.json', { byKo: {} }),
      loadJsonUrl('moveKoFallback.json', { version: 0, byKo: {} }),
      loadJsonUrl('moveSlugToEn.json', { bySlug: {} }),
      loadJsonUrl('natureKoMap.json', { koToSlug: {} }),
      loadJsonUrl('itemKoMap.json', { byKo: {} }),
      loadJsonUrl('abilityKoMap.json', { byKo: {} }),
      loadJsonUrl('typeKoMap.json', { byKo: {} }),
      loadJsonUrl('modifiers.json', { version: 0, items: {}, abilities: {} }),
      loadJsonUrl('itemKoFallback.json', { byKo: {} }),
      loadJsonUrl('abilityKoFallback.json', { byKo: {} }),
    ]).then(function (arr) {
      mergeByKoPaste(arr[0], arr[1]);
      // 도구·특성 fallback = 사이트 표기 (scripts/audit-ko-names-vs-site.js) → PokéAPI 맵보다 우선 (예: 대파 = leek)
      if (arr[4].byKo) Object.assign(arr[4].byKo, arr[8].byKo);
      if (arr[5].byKo) Object.assign(arr[5].byKo, arr[9].byKo);
      return {
        moveKoDoc: arr[0],
        moveSlugToEnDoc: arr[2],
        natureKoDoc: arr[3],
        itemKoDoc: arr[4],
        abilityKoDoc: arr[5],
        typeKoDoc: arr[6],
        modifiersDocument: arr[7],
      };
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
    if (!slotData || SR.isSlotEmpty(slotData)) {
      return Promise.reject(new Error('empty_slot'));
    }

    var needUrls = needsServerUrls(fo);

    return computeBlockPowersForSlot(slotData).then(function (pack) {
      // F16: URL이 결과에 안 들어가는 옵션이면 누오 POST 생략.
      var pSampleUrl = needUrls
        ? postShareSlot(origin, pathname, slotIndex, slotData)
        : Promise.resolve('');
      return pSampleUrl.then(function (sampleUrl) {
        var urlStr = sampleUrl ? String(sampleUrl).trim() : '';
        var pasteRaw = SR.shareSlotToRaw(slotData, 1, { numberedTitle: false });
        var modP = ensureModifiersLoaded();

        if (fo.showdownPaste) {
          return Promise.all([modP, loadPasteBundleDocs()]).then(function (twice) {
            var mod = twice[0];
            var docs = twice[1];
            var slotsOne = [cloneShareSlot(slotData)];
            var BSP = globalThis.buildShowdownPaste;
            if (typeof BSP !== 'function') return pasteRaw;
            var out = BSP(slotsOne, {
              modifiersDocument: mod,
              moveKoDoc: docs.moveKoDoc,
              moveSlugToEnDoc: docs.moveSlugToEnDoc,
              natureKoDoc: docs.natureKoDoc,
              itemKoDoc: docs.itemKoDoc,
              abilityKoDoc: docs.abilityKoDoc,
              typeKoDoc: docs.typeKoDoc,
            });
            return out || pasteRaw;
          });
        }

        return modP.then(function (mod) {
          var fmt = globalThis.formatSample;
          if (typeof fmt !== 'function') return pasteRaw;
          var sampleUrls = urlStr ? [urlStr] : [''];
          var opts = {
            includeUrls: fo.includeUrls !== false,
            includeRealStats: !!fo.includeRealStats,
            includeMovePowers: !!fo.includeMovePowers,
            includeBulkStats: !!fo.includeBulkStats,
            partyUrl: '',
            sampleUrls: sampleUrls,
            blockMovePowers: [pack.movePowers],
            blockSpeciesTypes: [pack.speciesTypesEn],
            modifiersDocument: mod,
          };
          return fmt(pasteRaw, opts) || '';
        });
        });
    });
  }

  /** resolvePartyWithRaws 결과(파티) + 팀빌더 formatOptions → 팝업과 동일한 샘플/Showdown 문자열 */
  function formatResolvedPartyShare(data, fo) {
    fo = fo || {};
    var pasteRaw = data && data.pasteRaw != null ? String(data.pasteRaw) : '';
    var partyUrl = data && data.partyUrl != null ? String(data.partyUrl).trim() : '';
    // partyUrl이 비어 있어도 정상 — F16에 의해 의도적으로 누오 등록을 생략한 경우
    // (옵션이 결과에 URL을 포함하지 않을 때). formatter 가 빈 partyUrl을 자연스럽게 처리.

    if (fo.showdownPaste) {
      var slots = data.shareSlots;
      if (!Array.isArray(slots) || slots.length === 0) {
        return Promise.resolve(pasteRaw);
      }
      return Promise.all([ensureModifiersLoaded(), loadPasteBundleDocs()]).then(function (twice) {
        var mod = twice[0];
        var docs = twice[1];
        var BSP = globalThis.buildShowdownPaste;
        if (typeof BSP !== 'function') return pasteRaw;
        var out = BSP(slots, {
          modifiersDocument: mod,
          moveKoDoc: docs.moveKoDoc,
          moveSlugToEnDoc: docs.moveSlugToEnDoc,
          natureKoDoc: docs.natureKoDoc,
          itemKoDoc: docs.itemKoDoc,
          abilityKoDoc: docs.abilityKoDoc,
          typeKoDoc: docs.typeKoDoc,
        });
        return out || pasteRaw;
      });
    }

    return ensureModifiersLoaded().then(function (mod) {
      var fmt = globalThis.formatSample;
      if (typeof fmt !== 'function') return pasteRaw;
      var opts = {
        includeUrls: fo.includeUrls !== false,
        includeRealStats: !!fo.includeRealStats,
        includeMovePowers: !!fo.includeMovePowers,
        includeBulkStats: !!fo.includeBulkStats,
        partyUrl: partyUrl,
        sampleUrls: Array.isArray(data.sampleUrls) ? data.sampleUrls : [],
        blockMovePowers: data.blockMovePowers,
        blockSpeciesTypes: data.blockSpeciesTypes,
        modifiersDocument: mod,
      };
      return fmt(pasteRaw, opts) || '';
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
      if (!slotAn || SR.isSlotEmpty(slotAn)) {
        sendResponse({
          ok: true,
          empty: true,
          movePowerSuffixes: [null, null, null, null],
          bulkText: '',
          bulkCompact: '',
        });
        return true;
      }
      computeBlockPowersForSlot(slotAn)
        .then(function (pack) {
          return ensureModifiersLoaded().then(function (mod) {
            var MPS = globalThis.movePowerSuffixFormatter;
            var reals = SR.realByLetterFromSlot(slotAn);
            var flat = SR.flattenSlot(slotAn);
            var itemRaw = SR.str(flat.equipment || flat.item || flat.Item || flat.hold);
            var abilityRaw = SR.str(flat.ability || flat.ab || flat.Ability);
            var titleCtx =
              SR.str(SR.titleRest(flat)) + '\n' + SR.str(SR.speciesNameLine(flat));
            // F42 (2026-05-24): 두 포맷이 같은 comp 를 공유 — 옛 코드는 두 번 계산했음.
            var CBP = globalThis.computeBulkPhysSpecBuffed;
            var FBLC = globalThis.formatBulkLinesFromComp;
            var FBCSC = globalThis.formatBulkCompactSlashFromComp;
            // F51 (2026-05-24): 인라인 어노 컨텍스트 — 풀체력 조건부 특성 (멀티스케일·스펙터가드 등) skip.
            var comp =
              typeof CBP === 'function'
                ? CBP(reals, mod, itemRaw, abilityRaw, titleCtx, pack.speciesTypesEn, {
                    excludeConditionalAbilities: true,
                  })
                : null;
            var bulkText = typeof FBLC === 'function' ? FBLC(comp) || '' : '';
            var bulkCompact = typeof FBCSC === 'function' ? FBCSC(comp) || '' : '';
            var suff = [];
            var mp = pack.movePowers || [];
            var mi;
            for (mi = 0; mi < 4; mi++) {
              suff.push(typeof MPS === 'function' ? MPS(mp[mi]) : null);
            }
            sendResponse({
              ok: true,
              movePowerSuffixes: suff,
              bulkText: bulkText,
              bulkCompact: bulkCompact,
            });
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
      if (!slotIn || typeof slotIn !== 'object' || SR.isSlotEmpty(slotIn)) {
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
            if (!SR.isSlotEmpty(slotsCp[j])) return true;
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
          return resolvePartyWithRaws(originCp, pathnameCp, partyId, slotsCp, {
            includeSlotUrls: needUrlsCp,
          }).then(function (data) {
            return formatResolvedPartyShare(data, foCp);
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
      loadJsonUrl('pokemonSlugToDex.json', { bySlug: {} }).then(function (doc) {
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
    triggerUpdateNotice(
      String(details.previousVersion || '0.0.0'),
      chrome.runtime.getManifest().version
    );
  });
})();
