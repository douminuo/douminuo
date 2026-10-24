'use strict';

/** smoke 스크립트용: vm ctx 에 koNames.js 를 올리고 런타임(background loadKoNames)과 같은 문서로 해석기 생성. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', '..', 'extension');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(EXT, f), 'utf8'));

function koNamesDocs() {
  return {
    modifiers: readJson('modifiers.json'),
    itemMap: readJson('itemKoMap.json'),
    itemSite: readJson('itemKoFallback.json'),
    abilityMap: readJson('abilityKoMap.json'),
    abilitySite: readJson('abilityKoFallback.json'),
    moveMap: readJson('moveKoMap.json'),
    moveSite: readJson('moveKoFallback.json'),
  };
}

/** ctx 에는 fmtCommon.js 가 이미 올라가 있어야 함. */
function koNamesForSmoke(ctx, docs) {
  vm.runInContext(fs.readFileSync(path.join(EXT, 'koNames.js'), 'utf8'), ctx, { filename: 'koNames.js' });
  return ctx.nuoKoNames.forDocs(docs || koNamesDocs());
}

module.exports = { koNamesDocs, koNamesForSmoke };
