/* Pokemon Showdown / PokePaste 스타일 (shareToRaw + 맵 JSON) */
(function (global) {
  'use strict';

  var SR = global.shareToRaw;
  var FC = global.nuoFmtCommon;
  var readLabel = FC.readLabel;
  var normalizeMatchKey = FC.normalizeMatchKey;

  function asInt(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseInt(String(v), 10);
    return isNaN(n) ? null : n;
  }

  function slugToDisplayName(slug) {
    if (!slug) return '';
    return String(slug)
      .trim()
      .toLowerCase()
      .split('-')
      .filter(Boolean)
      .map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(' ');
  }

  function formatSpeciesFromSlug(slug) {
    if (!slug) return '';
    return String(slug)
      .trim()
      .toLowerCase()
      .split('-')
      .filter(Boolean)
      .map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join('-');
  }

  function speciesEnglishFromSlot(s) {
    var poke = s.pokemon || s.mon || s.poke;
    if (poke && typeof poke === 'object') {
      // 사이트 리뉴얼 이후 신규 샘플: poke.name = { id, smogon_id, db_en, kr, ... } 객체.
      // db_en 우선(하이픈 보존, 예: 'aegislash-shield'), 없으면 smogon_id / id(둘 다 하이픈 없음).
      // attackerFormOverride.js · teamBuilderBridge.js 가 동일한 객체 모양을 가정.
      if (poke.name && typeof poke.name === 'object') {
        var en = String(poke.name.db_en || poke.name.smogon_id || poke.name.id || '').trim();
        if (en && /^[a-z0-9-]+$/i.test(en)) return formatSpeciesFromSlug(en);
      }
      // 옛 URL 샘플: poke.name = 영문 slug 문자열.
      if (typeof poke.name === 'string') {
        var pn = poke.name.trim();
        if (/^[a-z0-9-]+$/i.test(pn)) return formatSpeciesFromSlug(pn);
      }
    }
    if (typeof s.name === 'string') {
      var sn = s.name.trim();
      if (/^[a-z0-9-]+$/i.test(sn)) return formatSpeciesFromSlug(sn);
    }
    return readLabel(s.nameKr || s.speciesName || s.speciesKo || s.species) || '';
  }

  /** 도구·특성 라벨 → Showdown 영문 표시명. 못 풀면 라벨 그대로 (kind = names.item | names.ability). */
  function resolveHoldEn(kind, raw) {
    var slug = kind(raw);
    if (slug) return slugToDisplayName(slug);
    var lab = readLabel(raw);
    return lab === '--' ? '' : lab;
  }

  function natureToEnglish(raw, koToSlug) {
    var t = String(raw || '').trim();
    if (!t || t === '--') return '';
    if (/^[a-zA-Z]/.test(t)) {
      var low = t.toLowerCase();
      return low.charAt(0).toUpperCase() + low.slice(1);
    }
    var slug = koToSlug && koToSlug[t];
    if (slug) return slug.charAt(0).toUpperCase() + slug.slice(1).toLowerCase();
    return t;
  }

  function buildCompactMoveEnIndex(bySlug) {
    var compact = Object.create(null);
    var k;
    for (k in bySlug) {
      if (!Object.prototype.hasOwnProperty.call(bySlug, k)) continue;
      var c = String(k).replace(/-/g, '');
      compact[c] = bySlug[k];
    }
    return compact;
  }

  /**
   * F48 (2026-05-24): bySlug 같은 doc 참조에 대해 compact 인덱스 1회만 빌드.
   * SW 라이프타임에 moveSlugToEn.json 은 1회 로드 → 같은 참조 — 두 번째 파티 복사부터 hit.
   */
  var compactMoveIxCache = new WeakMap();
  function getCompactMoveEnIndex(bySlug) {
    if (!bySlug) return Object.create(null);
    var c = compactMoveIxCache.get(bySlug);
    if (c) return c;
    c = buildCompactMoveEnIndex(bySlug);
    compactMoveIxCache.set(bySlug, c);
    return c;
  }

  function moveToEnglish(names, compactIdx, koLabel) {
    var k = String(koLabel || '').trim();
    if (!k || k === '--') return '';
    var id = names.move(k);
    if (!id) return k;
    // 영문 목록에 없으면: 영문 slug 입력은 하이픈 살려 표시, 한글은 id 로 (옛 동작 그대로).
    return compactIdx[id] || slugToDisplayName(/^[a-z0-9-]+$/i.test(k) ? k.toLowerCase() : id);
  }

  function shouldOmitTerastal(value) {
    var t = (value || '').trim();
    if (!t) return true;
    if (/^[-–—.]+$/.test(t)) return true;
    var low = t.toLowerCase();
    if (low === '없음' || low === 'none' || low === 'n/a') return true;
    if (t === '無') return true;
    return false;
  }

  function formatTeraType(raw, typeKoDoc) {
    var t = String(raw || '').trim();
    if (!t) return '';
    if (/^[a-zA-Z]/.test(t)) return slugToDisplayName(t.replace(/\s+/g, '-').toLowerCase());
    var en = typeKoDoc && typeKoDoc.byKo && typeKoDoc.byKo[t];
    if (en) return en;
    return t;
  }

  function getLevel(flat) {
    var poke = flat.pokemon || flat.mon || flat.poke;
    return (
      asInt(flat.level) ||
      asInt(flat.lv) ||
      (poke && asInt(poke.level)) ||
      (poke && asInt(poke.lv)) ||
      null
    );
  }

  /** 종목당 0~32, 합 ≤66. 초과 시 Spe→HP 순으로 깎음. */
  function clampNuoBoostsSix(raw) {
    var b = [];
    var i;
    for (i = 0; i < 6; i++) {
      var v = raw[i] | 0;
      if (v < 0) v = 0;
      else if (v > 32) v = 32;
      b.push(v);
    }
    var sum = 0;
    for (i = 0; i < 6; i++) sum += b[i];
    var j = 5;
    while (sum > 66 && j >= 0) {
      if (b[j] > 0) {
        b[j]--;
        sum--;
      } else {
        j--;
      }
    }
    return b;
  }

  function oneSet(slot, ctx) {
    if (!SR || typeof SR.isSlotEmpty !== 'function' || SR.isSlotEmpty(slot)) return '';
    var s = SR.flattenSlot(slot);
    var species = speciesEnglishFromSlot(s);
    if (!species) species = 'Pokemon';

    var itemStr = resolveHoldEn(ctx.names.item, SR.str(s.equipment || s.item || s.Item || s.hold));
    var head = itemStr ? species + ' @ ' + itemStr : species;

    var lines = [head];
    var ab = resolveHoldEn(ctx.names.ability, SR.str(s.ability || s.ab || s.Ability));
    if (ab) lines.push('Ability: ' + ab);

    var lv = getLevel(s);
    if (lv != null && lv > 0) lines.push('Level: ' + lv);

    var nat = natureToEnglish(readLabel(s.personality || s.nature || s.Nature), ctx.koToSlugNature);
    if (nat) lines.push(nat + ' Nature');

    /* EV 줄: 챔피언스 SP 그대로 — Showdown champions 모드·Smogon 세트가 `EVs:` 줄에 SP(0~32) 를 씀 (2026-10 확인). */
    var nuoEvs = typeof SR.getEvValuesSix === 'function' ? SR.getEvValuesSix(s) : [0, 0, 0, 0, 0, 0];
    var evs = clampNuoBoostsSix(nuoEvs);
    var abbr = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
    var evParts = [];
    var ei;
    for (ei = 0; ei < 6; ei++) {
      if (evs[ei]) evParts.push(evs[ei] + ' ' + abbr[ei]);
    }
    if (evParts.length) lines.push('EVs: ' + evParts.join(' / '));

    var ter =
      typeof SR.teraLine === 'function'
        ? SR.teraLine(s)
        : String(s.terastal || s.tera || s.teraType || '').trim();
    if (ter && !shouldOmitTerastal(ter)) lines.push('Tera Type: ' + formatTeraType(ter, ctx.typeKoDoc));

    var moves = SR.getMoves ? SR.getMoves(slot) : ['', '', '', ''];
    var mi;
    for (mi = 0; mi < 4; mi++) {
      var en = moveToEnglish(ctx.names, ctx.compactMove, moves[mi]);
      if (en) lines.push('- ' + en);
    }

    return lines.join('\n');
  }

  /**
   * @param {object[]} slots
   * @param {{ koNames: object, moveSlugToEnDoc: object, natureKoDoc: object, typeKoDoc?: object }} opts
   *   koNames = koNames.forDocs(...) 해석기 (도구·특성·기술)
   */
  function buildShowdownPaste(slots, opts) {
    if (!SR) return '';
    opts = opts || {};
    var moveEn = (opts.moveSlugToEnDoc && opts.moveSlugToEnDoc.bySlug) || {};
    var natDoc = opts.natureKoDoc || {};
    var koToSlugNature = natDoc.koToSlug || {};
    var typeKoDoc = opts.typeKoDoc || { byKo: {} };

    var ctx = {
      names: opts.koNames,
      compactMove: getCompactMoveEnIndex(moveEn),
      koToSlugNature: koToSlugNature,
      typeKoDoc: typeKoDoc,
    };

    var list = Array.isArray(slots) ? slots : [];
    var blocks = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var block = oneSet(list[i], ctx);
      if (block) blocks.push(block);
    }
    return blocks.join('\n\n');
  }

  global.buildShowdownPaste = buildShowdownPaste;
})(typeof globalThis !== 'undefined' ? globalThis : self);
