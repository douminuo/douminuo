'use strict';
// SW(background.js) 를 통째로 vm 에 올려 메시지 응답을 덤프 — SW 리팩터 전후 비교용 (chrome·fetch 스텁, 사이트 모양 픽스처).
//   node scripts/sw-snapshot.js <extension 폴더> <out.json>
//   node scripts/sw-snapshot.js --diff <before.json> <after.json>
// HEAD 기준선: git archive HEAD extension | tar -x -C <임시 폴더> 후 그 폴더의 extension 을 넘김.
// 파티 공유 POST 는 가짜 id 로 응답 (네트워크 안 나감), 그 외 외부 fetch 는 실패.
const fs = require('fs');
if (process.argv[2] === '--diff') {
  const a = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const b = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  let n = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    n++;
    console.log('DIFF ' + k + '\n  - ' + JSON.stringify(a[k]) + '\n  + ' + JSON.stringify(b[k]));
  }
  console.log(n + ' diffs');
  process.exit(n ? 1 : 0);
}
const { loadSW, F } = require('./lib/swHarness');
const OUT = process.argv[3];
const { send, net, storageSets } = loadSW(process.argv[2]);

const OPT_KEYS = ['includeUrls', 'includeRealStats', 'includeMovePowers', 'includeBulkStats', 'showdownPaste'];
function combos() {
  const out = [];
  for (let m = 0; m < 32; m++) {
    const fo = {};
    OPT_KEYS.forEach((k, i) => { fo[k] = !!(m & (1 << i)); });
    out.push(fo);
  }
  return out;
}

async function run() {
  const out = {};
  for (const [k, s] of Object.entries(F)) {
    out['ann ' + k] = await send({ type: 'ANNOTATE_BUILDER_SLOT', slotData: s });
    for (const side of ['attacker', 'defender']) {
      out['calc ' + side + ' ' + k] = await send({ type: 'GET_CALC_PAYLOADS_FROM_SLOT', slot: s, side, page: 'calc' });
    }
    for (const fo of combos()) {
      out['fmt ' + k + ' ' + JSON.stringify(fo)] = await send({ type: 'FORMAT_BUILDER_SLOT', slotIndex: 2, slotData: s, origin: 'https://smartnuo.com', pathname: '/party', formatOptions: fo });
    }
  }
  const party = [F.nidoking, F.azumarill, F.aegislash, F.empty_obj, F.dragonite, null];
  for (const fo of combos()) {
    out['party ' + JSON.stringify(fo)] = await send({ type: 'COPY_PARTY_SHARE_URL', partySlots: party, origin: 'https://smartnuo.com', pathname: '/party', formatOptions: fo });
  }
  out['party none'] = await send({ type: 'COPY_PARTY_SHARE_URL', partySlots: [null, {}, null, null, null, null], formatOptions: {} });
  const dex = await send({ type: 'GET_POKEMON_SLUG_TO_DEX' });
  out.dex = Object.keys(dex.doc.bySlug || {}).length;
  out.net = net;
  out.storageSets = storageSets;
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('wrote', OUT, Object.keys(out).length, 'keys');
}
run().catch((e) => { console.error(e); process.exit(1); });
