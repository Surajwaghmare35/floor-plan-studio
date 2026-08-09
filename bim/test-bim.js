#!/usr/bin/env node
/**
 * Phase 1 BIM model tests — run: node bim/test-bim.js
 */
'use strict';

var assert = require('assert');
var FPSBim = require('./model.js');
var Legacy = require('./legacy-convert.js');

var passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  OK  ' + name);
  } catch (e) {
    console.error('  FAIL  ' + name);
    console.error('       ', e.message);
    process.exitCode = 1;
  }
}

console.log('FPS BIM Phase 1 tests\n');

test('uuid is stable format', function () {
  var id = FPSBim.uuid();
  assert.strictEqual(typeof id, 'string');
  assert.ok(/^[0-9a-f-]{36}$/i.test(id), id);
});

test('createObject has required BIM fields', function () {
  var o = FPSBim.createObject({ type: FPSBim.TYPES.WALL, name: 'W1' });
  assert.ok(o.id);
  assert.strictEqual(o.type, 'IfcWall');
  assert.ok(o.geometry);
  assert.ok(o.transform);
  assert.ok(o.properties);
  assert.ok(o.classification);
  assert.ok(o.quantities);
  assert.ok(o.relationships);
});

test('validateObject rejects missing type', function () {
  var v = FPSBim.validateObject({ id: 'x' });
  assert.strictEqual(v.ok, false);
});

test('model CRUD + events', function () {
  var events = [];
  var m = FPSBim.createModel({ name: 'T', withHierarchy: true });
  m.on(function (ev) { events.push(ev.type); });
  var wall = m.add({ type: FPSBim.TYPES.WALL, name: 'A', storeyId: m.ids.storey });
  m.linkContains(m.ids.storey, wall.id);
  m.update(wall.id, { name: 'A2' });
  assert.strictEqual(m.get(wall.id).name, 'A2');
  assert.ok(m.remove(wall.id));
  assert.strictEqual(m.get(wall.id), null);
  assert.ok(events.indexOf('create') >= 0);
  assert.ok(events.indexOf('update') >= 0);
  assert.ok(events.indexOf('delete') >= 0);
});

test('duplicate id rejected', function () {
  var m = FPSBim.createModel({ withHierarchy: false });
  var id = FPSBim.uuid();
  m.add({ id: id, type: FPSBim.TYPES.COLUMN, name: 'C1' });
  var threw = false;
  try { m.add({ id: id, type: FPSBim.TYPES.COLUMN, name: 'C2' }); } catch (e) { threw = true; }
  assert.ok(threw);
});

test('serialization round-trip', function () {
  var m = FPSBim.createModel({ name: 'Round', withHierarchy: true });
  m.add({ type: FPSBim.TYPES.WALL, name: 'W', storeyId: m.ids.storey, quantities: { length: 3 } });
  var json = m.toJSON();
  assert.strictEqual(json.schemaVersion, FPSBim.SCHEMA_VERSION);
  var m2 = FPSBim.createModel({ withHierarchy: false });
  m2.fromJSON(json);
  assert.strictEqual(m2.meta.name, 'Round');
  assert.ok(m2.query({ type: FPSBim.TYPES.WALL }).length >= 1);
  var v = m2.validateModel();
  assert.ok(v.ok, v.errors.join('; '));
});

test('migrateDocument treats missing schemaVersion as v0', function () {
  var raw = {
    objects: [{ id: FPSBim.uuid(), type: 'IfcWall', name: 'old' }]
  };
  var mig = FPSBim.migrateDocument(raw);
  assert.strictEqual(mig.schemaVersion, 1);
  assert.strictEqual(mig.meta.legacySchemaVersion, 0);
});

test('edgeKeyToSegment geometry', function () {
  var seg = Legacy.edgeKeyToSegment('h:2:3', 3);
  assert.strictEqual(seg.points[0][0], 6);
  assert.strictEqual(seg.points[1][0], 9);
  assert.deepStrictEqual(seg.gridRef.edgeKey, 'h:2:3');
});

test('legacy → BIM converter builds hierarchy + walls/doors/spaces', function () {
  var legacy = {
    schemaVersion: 0,
    pn: 'Test Plan',
    face: 'W',
    cols: 4,
    rows: 4,
    ftPerCell: 3,
    site: { plotL: 12, plotW: 12, bldgL: 9, bldgW: 9, setback: 0, offC: 0, offR: 0, bCols: 4, bRows: 4, wallLo: 7, loftSlab: 0.5, wallHi: 3, compoundH: 5 },
    // simple box
    w: ['h:0:0', 'h:1:0', 'h:2:0', 'h:3:0', 'h:0:4', 'h:1:4', 'h:2:4', 'h:3:4', 'v:0:0', 'v:0:1', 'v:0:2', 'v:0:3', 'v:4:0', 'v:4:1', 'v:4:2', 'v:4:3', 'h:1:2', 'v:2:0', 'v:2:1'],
    d: [['h:1:2', { s: 1, id: 1 }]],
    win: [['v:0:1', 'S']],
    lo: ['1:1'],
    st: [['3:3', 0]],
    fn: [['2:2', { t: 'bed', r: 1 }]],
    lab: [['1:1', 'Room A'], ['2:2', 'Room B']],
    rs: [['0:0', { w: 10, h: 8 }]],
    nt: [['0:0', 'note']]
  };
  var out = Legacy.convertLegacyToBim(legacy);
  assert.ok(out.validation.ok, out.validation.errors.join('; '));
  assert.ok(out.stats.byType.IfcWall >= 1);
  assert.ok(out.stats.byType.IfcDoor >= 1);
  assert.ok(out.stats.byType.IfcWindow >= 1);
  assert.ok(out.stats.byType.IfcSpace >= 1);
  assert.ok(out.stats.byType.IfcFurniture >= 1);
  assert.ok(out.stats.byType.IfcStair >= 1);
  assert.ok(out.stats.byType.IfcSlab >= 1);

  // door hosted by wall
  var door = out.model.query({ type: FPSBim.TYPES.DOOR })[0];
  assert.ok(door.relationships.hostedBy, 'door should be hosted by a wall');

  // JSON round-trip of converted model
  var again = FPSBim.createModel({ withHierarchy: false });
  again.fromJSON(out.model.toJSON());
  assert.ok(again.validateModel().ok);
});

test('model does not reference document/window (isolation smoke)', function () {
  var src = require('fs').readFileSync(require('path').join(__dirname, 'model.js'), 'utf8');
  assert.ok(src.indexOf('document.') < 0);
  assert.ok(src.indexOf('getElementById') < 0);
  assert.ok(src.indexOf('innerHTML') < 0);
});

test('stable ids match across two conversions', function () {
  var legacy = {
    pn: 'Stable',
    face: 'W',
    cols: 3,
    rows: 3,
    ftPerCell: 3,
    w: ['h:0:0', 'h:1:0', 'h:2:0', 'h:0:3', 'h:1:3', 'h:2:3', 'v:0:0', 'v:0:1', 'v:0:2', 'v:3:0', 'v:3:1', 'v:3:2'],
    d: [['h:1:0', { s: 0, id: 1 }]],
    win: [],
    lo: [],
    st: [],
    fn: [],
    lab: [['1:1', 'Hall']],
    rs: [],
    nt: []
  };
  var a = Legacy.convertLegacyToBim(legacy);
  var b = Legacy.convertLegacyToBim(legacy);
  var wa = a.model.query({ type: FPSBim.TYPES.WALL }).map(function (o) { return o.id; }).sort();
  var wb = b.model.query({ type: FPSBim.TYPES.WALL }).map(function (o) { return o.id; }).sort();
  assert.deepStrictEqual(wa, wb);
  var door = a.model.query({ type: FPSBim.TYPES.DOOR })[0];
  var door2 = Legacy.findByLegacy(b.model, 'door', 'h:1:0');
  assert.ok(door2);
  assert.strictEqual(door.id, door2.id);
});

console.log('\n' + passed + ' tests passed');
if (process.exitCode) console.error('\nSome tests failed');
else console.log('All Phase 1 tests passed.');
