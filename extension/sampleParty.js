/**
 * 파티 탭 저장·불러오기 (PARTY_PRESET_PLAN §5.2·§5.3).
 * 저장 = teamBuilderFill 아이콘 줄 저장 버튼 → nuoPartyBox.saveSlot(n) / saveParty().
 * 불러오기 = 중앙 열 `박스` (prefsEntry) → nuoBoxHandlers.team → 박스 [샘플 | 파티].
 * 사이트 '샘플 불러오기' 창·샘플 이름 칸은 건드리지 않음 (사이트 원래 동작).
 */
(function (g) {
  'use strict';

  var CS = g.nuoCsCommon || {};
  var TBS = g.nuoTeamBuilderShared || {};
  var LIB = g.nuoSampleLibrary;
  var SL = g.nuoSlotRead;
  if (!LIB || typeof TBS.getSlotsFromBridge !== 'function' || typeof CS.findTextLeaves !== 'function') return;

  var EMPTY_MSG = '포켓몬을 먼저 선택해 주세요';
  var STOP = {}; // 사용자가 멈춘 흐름(취소·빈 슬롯) — catch 에서 조용히 끝냄
  var SAMPLE_O = { limit: LIB.LIMIT, limitCode: 'sample_limit', subj: '샘플이', what: '샘플' };
  var PARTY_O = { limit: LIB.PARTY_LIMIT, limitCode: 'party_limit', subj: '파티가', what: '파티' };

  function mapErr(code) {
    return typeof g.mapCalcFillError === 'function' ? g.mapCalcFillError(code) : String(code || '');
  }

  function stop() { throw STOP; }

  /** 슬롯 #n 좌측 카드의 공식 일러스트 URL (§4.1 arts). 헤더 `#n` leaf → 헤더 줄 → 다음 형제 = 카드. */
  function findArt(n) {
    var leaves = CS.findTextLeaves(new RegExp('^#' + n + '$'));
    var i;
    for (i = 0; i < leaves.length; i++) {
      var row = leaves[i].parentElement && leaves[i].parentElement.parentElement;
      var card = row && row.nextElementSibling;
      var img = card && card.querySelector('img[src*="official-artwork"]');
      if (img) return img.src;
    }
    return '';
  }

  /** bridge 보강 슬롯 6칸 (GET_SLOTS). 실패 코드는 매퍼에 있는 것으로 통일. */
  function readSlots() {
    return TBS.getSlotsFromBridge().then(function (r) {
      if (!r || !r.ok || !Array.isArray(r.slots) || r.slots.length !== 6) throw new Error('bridge_state_missing');
      return r.slots;
    });
  }

  /** 상한·같은 이름 확인. @returns {Promise<boolean>} */
  function okToSave(items, name, o) {
    if (!LIB.canAdd(items, name, o.limit)) {
      window.alert(mapErr(o.limitCode));
      return Promise.resolve(false);
    }
    if (!LIB.findByName(items, name)) return Promise.resolve(true);
    return LIB.confirmDialog('\'' + name + '\' ' + o.subj + ' 이미 있어요. 덮어쓸까요?', '덮어쓰기', '기존 ' + o.what + ' 내용은 복구할 수 없습니다.');
  }

  function endFlow(fb) {
    return function (err) {
      fb.idle();
      if (err !== STOP) window.alert(mapErr(err && err.message));
    };
  }

  /** 슬롯 #n → 샘플 저장. 이름 없으면 이름 창 → 저장본 sample_name + 저장 성공 시 사이트 슬롯 이름에도. */
  function saveSlot(n, fb) {
    var slot, asked;
    fb.busy();
    readSlots().then(function (slots) {
      slot = slots[n - 1];
      if (SL.isEmpty(slot)) { fb.idle(); window.alert(EMPTY_MSG); stop(); }
      var has = LIB.normName(slot.sample_name);
      asked = !has;
      return has || LIB.nameDialog('샘플 저장', '샘플 이름');
    }).then(function (name) {
      if (!name) stop();
      slot.sample_name = name;
      return LIB.readAll().then(function (items) { return okToSave(items, name, SAMPLE_O); });
    }).then(function (go) {
      if (!go) stop();
      return LIB.saveEntry(slot, findArt(n) || SL.sprite(slot));
    }).then(function () {
      if (!asked) return null;
      // 사이트 이름 반영 실패는 조용히 — 샘플 저장은 이미 끝남 (사용자는 사이트 칸에서 다시 입력 가능)
      return TBS.setSlotNameToBridge(n, slot.sample_name).then(null, function () {});
    }).then(function () {
      fb.done('샘플 저장 완료');
    }).catch(endFlow(fb));
  }

  /** 파티 6칸 저장 — 이름 창 필수 (사이트에 파티 이름 칸 없음). */
  function saveParty(fb) {
    var slots, arts;
    fb.busy();
    readSlots().then(function (all) {
      slots = all.map(function (s) { return SL.isEmpty(s) ? null : s; });
      if (!slots.some(Boolean)) { fb.idle(); window.alert(EMPTY_MSG); stop(); }
      arts = slots.map(function (s, i) { return s ? (findArt(i + 1) || SL.sprite(s)) : ''; });
      return LIB.nameDialog('파티 저장', '파티 이름');
    }).then(function (name) {
      if (!name) stop();
      return LIB.readParties().then(function (items) {
        return okToSave(items, name, PARTY_O).then(function (go) {
          if (!go) stop();
          return LIB.savePartyEntry(name, slots, arts);
        });
      });
    }).then(function () {
      fb.done('파티 저장 완료');
    }).catch(endFlow(fb));
  }

  function alertErr(err) {
    window.alert(mapErr(err && err.message));
  }

  function checkWrite(r) {
    if (!r || !r.ok) throw new Error((r && r.error) || 'bridge_timeout');
  }

  /** 박스 [샘플 | 파티] — 카드마다 확인창 후 쓰기 (샘플은 편집 슬롯이 비었으면 바로), 성공 시 박스 닫힘. 취소 = 박스로 돌아감. */
  function openTeamBox() {
    LIB.openBox({
      kinds: ['sample', 'party'],
      onPick: function (item, kind, box) {
        if (kind === 'party') {
          LIB.confirmDialog('\'' + item.name + '\' 파티를 불러올까요?', '불러오기', '저장되지 않은 파티 내용은 사라집니다.').then(function (yes) {
            if (!yes) return null;
            return TBS.writePartyToBridge(item.slots).then(function (r) { checkWrite(r); box.close(); });
          }).catch(alertErr);
          return;
        }
        TBS.readInputFromBridge().then(function (r) {
          checkWrite(r);
          if (!r.slot) return true; // 편집 슬롯에 포켓몬 없음 = 잃을 내용 없음 → 확인창 생략
          return LIB.confirmDialog('\'' + item.name + '\' 샘플을 #' + r.active + ' 슬롯에 불러올까요?', '불러오기', '저장되지 않은 샘플 내용은 사라집니다.');
        }).then(function (yes) {
          if (!yes) return null;
          return TBS.writeInputToBridge(item.slot).then(function (r) { checkWrite(r); box.close(); });
        }).catch(alertErr);
      }
    });
  }

  g.nuoPartyBox = { saveSlot: saveSlot, saveParty: saveParty };
  g.nuoBoxHandlers = g.nuoBoxHandlers || {};
  g.nuoBoxHandlers.team = openTeamBox;
})(typeof globalThis !== 'undefined' ? globalThis : self);
