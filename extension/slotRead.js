/**
 * 사이트 파티 슬롯 읽기 — 단일 출처 (ARCH_REVIEW_PLAN 후보 2).
 * 슬롯 = __NUXT__.state['$sparty.slots'][i] 그대로 (bridge 가 도감 보강해 넘김, 저장 샘플도 같은 모양):
 *   { slot_display, sample_name, sp_used, sp_total, pokemon: { name:{id,db_en,smogon_id,kr,…}, name_kr, sprite,
 *     first_type, second_type?, level, personality, terastal, ability, equipment, stats:{<key>:{value,real}}, moves[4] } }
 * 값은 문자열 또는 { kr, en, name } 객체 — 둘 다 label() 로 읽음. 사이트 모양이 바뀌면 여기만 고침 (TEMPLATES §10.1).
 * SW(importScripts) 와 isolated 콘텐츠 스크립트(manifest) 가 같은 파일을 로드. MAIN bridge 는 쓰지 않음.
 */
(function (g) {
  'use strict';

  var STAT_KEYS = ['hp', 'attack', 'defense', 'special_attack', 'special_defense', 'speed'];

  /** 표시 라벨: 문자열 → trim, 객체 → kr → name_kr → name(재귀) → en → label → title 중 첫 비어 있지 않은 값. */
  function label(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return String(v);
    if (typeof v !== 'object' || Array.isArray(v)) return '';
    var keys = ['kr', 'name_kr', 'name', 'en', 'label', 'title'];
    var i;
    for (i = 0; i < keys.length; i++) {
      var t = label(v[keys[i]]);
      if (t) return t;
    }
    return '';
  }

  function asInt(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseInt(String(v), 10);
    return isNaN(n) ? null : n;
  }

  /** 포켓몬이 든 칸이면 slot.pokemon, 아니면 null. 기준 = pokemon.name (사이트 카드·쓰기 검사와 같음). */
  function mon(slot) {
    var p = slot && typeof slot === 'object' ? slot.pokemon : null;
    return p && typeof p === 'object' && p.name ? p : null;
  }

  function isEmpty(slot) {
    return !mon(slot);
  }

  /** 6칸 채워짐 여부. */
  function filledFlags(slots) {
    var out = [];
    var i;
    for (i = 0; i < 6; i++) out.push(!!(slots && mon(slots[i])));
    return out;
  }

  function field(slot, key) {
    var p = mon(slot);
    return p ? label(p[key]) : '';
  }

  function sampleName(slot) {
    return mon(slot) ? label(slot.sample_name) : '';
  }

  /** 종 한글 이름 (name_kr → name.kr). */
  function speciesKo(slot) {
    var p = mon(slot);
    return p ? label(p.name_kr) || label(p.name) : '';
  }

  /** 종 PokéAPI slug (하이픈 보존 — 'aegislash-shield', 'mr-mime'). 번들 pokemonTypeMap·pokemonSlugToDex 키와 같음. */
  function speciesSlug(slot) {
    var p = mon(slot);
    if (!p) return '';
    var n = p.name;
    var s = typeof n === 'object' ? String(n.db_en || n.smogon_id || n.id || '') : String(n);
    s = s.trim().toLowerCase();
    return /^[a-z0-9-]+$/.test(s) ? s : '';
  }

  /** 기술 4칸 표시 이름 (name_kr → name.kr). 빈 칸 ''. */
  function moves(slot) {
    var p = mon(slot);
    var m = p && Array.isArray(p.moves) ? p.moves : [];
    var out = ['', '', '', ''];
    var i;
    for (i = 0; i < 4 && i < m.length; i++) out[i] = label(m[i]);
    return out;
  }

  /** 스탯 i (STAT_KEYS 순) → { sp, real, iv }. 없으면 sp 0 · real 0 · iv 31. */
  function stat(slot, i) {
    var p = mon(slot);
    var o = p && p.stats && p.stats[STAT_KEYS[i]];
    if (!o || typeof o !== 'object') o = {};
    var iv = asInt(o.individual_value);
    return {
      sp: asInt(o.value) || 0,
      real: asInt(o.real) || 0,
      iv: iv == null ? 31 : Math.max(0, Math.min(31, iv)),
    };
  }

  function spSix(slot) {
    var out = [];
    var i;
    for (i = 0; i < 6; i++) out.push(stat(slot, i).sp);
    return out;
  }

  function level(slot) {
    var p = mon(slot);
    var n = p ? asInt(p.level) : null;
    return n != null && n > 0 ? n : null;
  }

  function spriteHostOk(parsed) {
    var host = (parsed.hostname || '').toLowerCase();
    var path = parsed.pathname || '';
    if (!/\.png$/i.test(path)) return false;
    if (host === 'raw.githubusercontent.com') return /\/sprites\/pokemon\//i.test(path);
    if (host !== 'smartnuo.com' && host !== 'www.smartnuo.com') return false;
    // smartnuo sprite 두 경로: 옛 /upload/sprite/ … · 리뉴얼 후 share 로드 시 /data/sprite/ …
    var pl = path.toLowerCase();
    return path.indexOf('..') === -1 && (pl.indexOf('/upload/sprite/') === 0 || pl.indexOf('/data/sprite/') === 0);
  }

  /**
   * 슬롯 sprite → 이미지 URL. PokéAPI raw·스마트누오 sprite 경로면 정규화 URL, 그 밖의 https/상대경로는 원문
   * (사이트 `/data/pokeapi-sprites/…` 상대경로 포함), 그 외('javascript:' 등)는 ''.
   */
  function sprite(slot) {
    var p = mon(slot);
    var u = p && typeof p.sprite === 'string' ? p.sprite.trim() : '';
    if (!u || u.length > 900) return '';
    var abs = u.indexOf('//') === 0 ? 'https:' + u : u;
    try {
      var parsed = new URL(abs, 'https://smartnuo.com/');
      var proto = (parsed.protocol || '').toLowerCase();
      if (proto !== 'https:' && proto !== 'http:') return '';
      if (spriteHostOk(parsed)) return parsed.href;
    } catch (e) {
      return '';
    }
    return /^(https:\/\/|\/[^/])/.test(u) ? u : '';
  }

  g.nuoSlotRead = {
    STAT_KEYS: STAT_KEYS,
    label: label,
    asInt: asInt,
    mon: mon,
    isEmpty: isEmpty,
    filledFlags: filledFlags,
    sampleName: sampleName,
    speciesKo: speciesKo,
    speciesSlug: speciesSlug,
    item: function (slot) { return field(slot, 'equipment'); },
    ability: function (slot) { return field(slot, 'ability'); },
    nature: function (slot) { return field(slot, 'personality'); },
    tera: function (slot) { return field(slot, 'terastal'); },
    moves: moves,
    stat: stat,
    spSix: spSix,
    level: level,
    sprite: sprite,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
