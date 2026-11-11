/**
 * 슬롯 분석 — 결정력·내구력이 같이 쓰는 문맥을 한 번만 만들고 두 계산을 부름 (구조 개선 후보 4, 2026-11-10).
 * 문맥에 모으는 것 (이것만): 종명, 타입, 도구 규칙(종 한정 판정 통과분), 특성 slug·규칙, 실수치.
 * 각 계산 파일에 그대로 두는 것: 결정력 = 곱 순서·floor 자리·웨더볼류 재귀·포톤가이저/바디프레스 스탯 선택,
 *   내구력 = 특성 → 도구 → 날씨 순서·쿼크차지/초상투영/날씨 분기·탈 HP·조건부 특성 제외·도구 내구 배율 검사.
 * fetch·storage·chrome 없음 (smoke 가 SW 없이 부름). 문서 로딩은 background.analyzeSlot.
 * SW 전용 (importScripts: slotRead·fmtCommon·formatter·simpleMovePower·attackerFormOverride 다음).
 */
(function (g) {
  'use strict';

  var SL = g.nuoSlotRead;
  var FC = g.nuoFmtCommon;

  /** 결정력용 실수치 — 값이 없으면 null (0 아님: 포톤가이저 스탯 선택·"스탯 없음 = 결정력 비움"이 null 을 봄). */
  function realOrNull(poke, key) {
    var o = poke && poke.stats && poke.stats[key];
    if (!o || o.real == null) return null;
    var n = parseInt(o.real, 10);
    return isNaN(n) ? null : n;
  }

  /**
   * @param {object} slot 사이트 파티 슬롯 (slotRead.js 모양, 빈 칸 아님)
   * @param {{ names: object, types: string[], natureKoDoc?: object, natureStatMulDoc?: object }} docs
   * @returns {{ speciesKo: string, types: string[], itemRule: object|null, ability: ({slug: string, rule: object}|null),
   *   real: { H: number, A: number, B: number, C: number, D: number, S: number },
   *   power: { atk: number|null, spa: number|null, def: number|null } }}
   *   real = 내구력용 (SL.stat, 없으면 0 · 실드폼 원본), power = 결정력용 (없으면 null · 공격·특공은 폼 보정 반영).
   */
  function buildContext(slot, docs) {
    var names = docs.names;
    var speciesKo = SL.speciesKo(slot);
    var itemHit = names.itemRule(SL.item(slot));
    var real = {};
    var i;
    for (i = 0; i < 6; i++) real['HABCDS'.charAt(i)] = SL.stat(slot, i).real;
    var poke = SL.mon(slot);
    var power = { atk: realOrNull(poke, 'attack'), spa: realOrNull(poke, 'special_attack'), def: realOrNull(poke, 'defense') };
    var form = g.attackerFormOverride.attackerFormStats(slot, docs.natureKoDoc, docs.natureStatMulDoc);
    if (form) {
      power.atk = form.atk;
      power.spa = form.spa;
    }
    return {
      speciesKo: speciesKo,
      types: docs.types || [],
      itemRule: itemHit && FC.ruleFitsSpecies(itemHit.rule, speciesKo) ? itemHit.rule : null,
      ability: names.abilityRule(SL.ability(slot)),
      real: real,
      power: power,
    };
  }

  /**
   * 인라인 어노테이션·요약 복사 공용. bulk = 복사용 (`기본 (버프)`), bulkInline = 인라인용 (풀체력 조건부 특성 제외 — F51).
   * @param {{ names: object, moveTags: object|null, types: string[], natureKoDoc?: object, natureStatMulDoc?: object }} docs
   * @returns {{ movePowers: Array, bulk: object|null, bulkInline: object|null }}
   */
  function analyzeSlotWithDocs(slot, docs) {
    var c = buildContext(slot, docs);
    return {
      movePowers: g.simpleMovePower.computeMovePowers(SL.mon(slot).moves, c, docs.names, docs.moveTags),
      bulk: g.computeBulkPhysSpecBuffed(c, { excludeConditionalAbilities: false }),
      bulkInline: g.computeBulkPhysSpecBuffed(c, { excludeConditionalAbilities: true }),
    };
  }

  g.nuoSlotAnalysis = { analyze: analyzeSlotWithDocs };
})(typeof globalThis !== 'undefined' ? globalThis : self);
