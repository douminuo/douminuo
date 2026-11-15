'use strict';

/**
 * 공유 등록(POST /api/party/share) smoke — 스마트누오 호출 수 규칙과 실패 처리.
 * 호출 수: 슬롯 복사 1, 파티 복사 1 + 채운 칸, URL 끔·Showdown·빈 칸 0, 같은 본문 = SW 수명 1회.
 * 실패: 원인(HTTP·id 없음·네트워크) 상관없이 한국어 문구, 다시 누르면 성공 못 한 것만 다시 보냄.
 *   node scripts/smoke-share.js
 */

const path = require('path');
const { loadSW, F } = require('./lib/swHarness');

const EXT = path.join(__dirname, '..', 'extension');
const ORIGIN = 'https://smartnuo.com';
const SLOT_FAIL = '샘플 URL을 서버에 등록하지 못했습니다. 로그인·네트워크를 확인하세요.';
const PARTY_FAIL = '파티 URL을 서버에 등록하지 못했습니다. 로그인·네트워크를 확인하세요.';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** 공유 POST 본문 길이만 (net 항목 = 'url 길이'). */
function sharePosts(sw) {
  return sw.net.filter((l) => l.indexOf('/api/party/share ') !== -1);
}

function copySlot(sw, slotData, fo, slotIndex) {
  return sw.send({ type: 'FORMAT_BUILDER_SLOT', slotIndex: slotIndex || 2, slotData, origin: ORIGIN, pathname: '/party', formatOptions: fo || {} });
}

function copyParty(sw, slots, fo) {
  return sw.send({ type: 'COPY_PARTY_SHARE_URL', partySlots: slots, origin: ORIGIN, pathname: '/party', formatOptions: fo || {} });
}

// 채운 칸 = 1·2·4 (3 = {}, 5 = null, 6 = 이름 없는 칸)
const PARTY = [F.nidoking, F.azumarill, {}, F.dragonite, null, F.meta_only];

async function run() {
  let sw = loadSW(EXT);
  let r;

  // --- 호출 수 ---
  r = await copySlot(sw, F.azumarill);
  assert(r.ok && r.text.indexOf('#ps=') !== -1 && sharePosts(sw).length === 1, 'slot copy = 1 POST: ' + JSON.stringify(sharePosts(sw)));
  r = await copySlot(sw, F.azumarill);
  assert(r.ok && sharePosts(sw).length === 1, 'slot copy again = memo, 0 POST: ' + sharePosts(sw).length);

  sw = loadSW(EXT);
  r = await copyParty(sw, PARTY);
  assert(r.ok && sharePosts(sw).length === 4, 'party copy = 1 + 3 filled: ' + JSON.stringify(sharePosts(sw)));
  const bodyLen = (l) => Number(l.split(' ')[1]);
  assert(sharePosts(sw).slice(1).every((l) => bodyLen(sharePosts(sw)[0]) > bodyLen(l)), 'party POST (longest body) first: ' + JSON.stringify(sharePosts(sw)));
  r = await copyParty(sw, PARTY);
  assert(r.ok && sharePosts(sw).length === 4, 'party copy again = memo, 0 POST: ' + sharePosts(sw).length);

  sw = loadSW(EXT);
  for (const fo of [{ includeUrls: false }, { showdownPaste: true }]) {
    r = await copySlot(sw, F.azumarill, fo);
    assert(r.ok, 'slot ' + JSON.stringify(fo) + ': ' + JSON.stringify(r));
    r = await copyParty(sw, PARTY, fo);
    assert(r.ok, 'party ' + JSON.stringify(fo) + ': ' + JSON.stringify(r));
  }
  r = await copySlot(sw, F.meta_only);
  assert(!r.ok, 'empty slot must fail: ' + JSON.stringify(r));
  r = await copyParty(sw, [null, {}, F.meta_only, null, null, null]);
  assert(!r.ok, 'empty party must fail: ' + JSON.stringify(r));
  assert(sharePosts(sw).length === 0, 'url off / showdown / empty = 0 POST: ' + JSON.stringify(sharePosts(sw)));

  // --- 슬롯 쪽 실패 (원인 셋) ---
  for (const mode of ['http', 'noid', 'net']) {
    sw = loadSW(EXT);
    sw.failShare = () => mode;
    r = await copySlot(sw, F.azumarill);
    assert(!r.ok && r.error === SLOT_FAIL && r.text === undefined, 'slot fail ' + mode + ': ' + JSON.stringify(r));
    // 실패는 메모에 안 남음 → 다시 누르면 다시 보냄
    sw.failShare = null;
    r = await copySlot(sw, F.azumarill);
    assert(r.ok && sharePosts(sw).length === 2, 'slot retry after ' + mode + ': ' + sharePosts(sw).length);
  }

  // --- 파티 복사 중 2번째 채운 칸(슬롯 2) 실패 → 다시 누르면 성공 못 한 것만 ---
  sw = loadSW(EXT);
  sw.failShare = (body) => (body.indexOf('{"data":{"slot":2,') === 0 ? 'net' : undefined);
  r = await copyParty(sw, PARTY);
  assert(!r.ok && r.error === SLOT_FAIL, 'party copy, slot 2 fail: ' + JSON.stringify(r));
  const before = sharePosts(sw).length;
  assert(before === 3, 'party + slot 1 + slot 2 (fail): ' + before);
  sw.failShare = null;
  r = await copyParty(sw, PARTY);
  const retried = sharePosts(sw).slice(before);
  // 파티·슬롯 1 = 메모, 슬롯 2 = 실패분, 슬롯 4 = 지난번엔 안 나감
  assert(r.ok && retried.length === 2 && retried[0] === sharePosts(sw)[2], 'retry = failed + unsent only: ' + JSON.stringify(retried));

  // --- 파티 쪽 실패 (원인 셋) — 영문 원문·GET 시절 "불러오지 못했습니다" 없이 ---
  for (const mode of ['http', 'noid', 'net']) {
    sw = loadSW(EXT);
    sw.failShare = (body) => (body.indexOf('"all":true') !== -1 ? mode : undefined);
    r = await copyParty(sw, PARTY);
    assert(!r.ok && r.error === PARTY_FAIL && r.text === undefined, 'party fail ' + mode + ': ' + JSON.stringify(r));
    assert(sharePosts(sw).length === 1, 'party fail stops before slots: ' + sharePosts(sw).length);
  }

  // --- 진행 중 공유: 기다리지 않고 연달아 두 번 = POST 1회 ---
  sw = loadSW(EXT);
  let both = await Promise.all([copySlot(sw, F.azumarill), copySlot(sw, F.azumarill)]);
  assert(both[0].ok && both[1].ok && sharePosts(sw).length === 1, 'in-flight shared: ' + sharePosts(sw).length);
  // 슬롯 복사 직후 파티 복사 — 같은 칸 번호·본문이면 슬롯 POST 공유
  sw = loadSW(EXT);
  both = await Promise.all([copySlot(sw, F.azumarill, {}, 2), copyParty(sw, PARTY)]);
  assert(both[0].ok && both[1].ok && sharePosts(sw).length === 4, 'slot + party in flight = 1 + 3: ' + sharePosts(sw).length);
  // 진행 중이던 요청이 실패 → 둘 다 실패, 메모에서 빠져 다음 복사가 다시 보냄
  sw = loadSW(EXT);
  sw.failShare = () => 'net';
  both = await Promise.all([copySlot(sw, F.azumarill), copySlot(sw, F.azumarill)]);
  assert(!both[0].ok && !both[1].ok && sharePosts(sw).length === 1, 'in-flight fail shared: ' + sharePosts(sw).length);
  sw.failShare = null;
  r = await copySlot(sw, F.azumarill);
  assert(r.ok && sharePosts(sw).length === 2, 'retry after in-flight fail: ' + sharePosts(sw).length);

  // --- 공유 POST 는 스마트누오 origin 만 (보안 감사 6) ---
  sw = loadSW(EXT);
  r = await sw.send({ type: 'FORMAT_BUILDER_SLOT', slotIndex: 2, slotData: F.azumarill, origin: 'https://evil.example', pathname: '/party', formatOptions: {} });
  assert(!r.ok && r.error === SLOT_FAIL, 'slot copy, other origin: ' + JSON.stringify(r));
  r = await sw.send({ type: 'COPY_PARTY_SHARE_URL', partySlots: PARTY, origin: 'https://evil.example', pathname: '/party', formatOptions: {} });
  assert(!r.ok && r.error === PARTY_FAIL, 'party copy, other origin: ' + JSON.stringify(r));
  assert(sharePosts(sw).length === 0, 'other origin = 0 POST: ' + JSON.stringify(sharePosts(sw)));
  r = await sw.send({ type: 'FORMAT_BUILDER_SLOT', slotIndex: 2, slotData: F.azumarill, origin: 'https://www.smartnuo.com', pathname: '/party', formatOptions: {} });
  assert(r.ok && sharePosts(sw).length === 1, 'www.smartnuo.com allowed: ' + JSON.stringify(r));

  console.log('smoke-share: ok');
}
run().catch((e) => { console.error(e); process.exit(1); });
