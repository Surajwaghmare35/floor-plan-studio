/**
 * Floor Plan Studio — Phase 1 Canonical BIM Model
 * Parallel data layer only. No DOM/SVG. Not wired to renderers/exporters yet.
 *
 * Browser: window.FPSBim
 * Node: module.exports / require('./model.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FPSBim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;

  /** IFC-oriented type names used by this lightweight model (not full IFC compliance). */
  var TYPES = {
    PROJECT: 'IfcProject',
    SITE: 'IfcSite',
    BUILDING: 'IfcBuilding',
    STOREY: 'IfcBuildingStorey',
    SPACE: 'IfcSpace',
    WALL: 'IfcWall',
    DOOR: 'IfcDoor',
    WINDOW: 'IfcWindow',
    SLAB: 'IfcSlab',
    ROOF: 'IfcRoof',
    COLUMN: 'IfcColumn',
    BEAM: 'IfcBeam',
    STAIR: 'IfcStair',
    FURNITURE: 'IfcFurniture',
    OPENING: 'IfcOpeningElement',
    ANNOTATION: 'IfcAnnotation'
  };

  var REQUIRED = ['id', 'type'];

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    // RFC4122-ish v4 fallback (browser + Node)
    var b = new Array(16);
    for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for (var j = 0; j < 16; j++) h.push((b[j] + 0x100).toString(16).slice(1));
    return (
      h.slice(0, 4).join('') +
      '-' +
      h.slice(4, 6).join('') +
      '-' +
      h.slice(6, 8).join('') +
      '-' +
      h.slice(8, 10).join('') +
      '-' +
      h.slice(10, 16).join('')
    );
  }

  function emptyGeometry() {
    return { kind: 'none', units: 'ft', points: [], extrude: null, gridRef: null };
  }

  function emptyTransform() {
    return { origin: [0, 0, 0], rotation: 0, scale: [1, 1, 1] };
  }

  function createObject(partial) {
    var o = {
      id: (partial && partial.id) || uuid(),
      type: partial && partial.type,
      name: (partial && partial.name) || '',
      description: (partial && partial.description) || '',
      storeyId: partial && partial.storeyId != null ? partial.storeyId : null,
      geometry: (partial && partial.geometry) || emptyGeometry(),
      transform: (partial && partial.transform) || emptyTransform(),
      materialId: partial && partial.materialId != null ? partial.materialId : null,
      properties: Object.assign({}, (partial && partial.properties) || {}),
      classification: Object.assign({ system: 'FPS', code: '', title: '' }, (partial && partial.classification) || {}),
      quantities: Object.assign({}, (partial && partial.quantities) || {}),
      relationships: Object.assign({ contains: [], containedIn: null, connects: [], hosts: [], hostedBy: null }, (partial && partial.relationships) || {})
    };
    if (partial) {
      ['name', 'description', 'storeyId', 'materialId'].forEach(function (k) {
        if (partial[k] !== undefined) o[k] = partial[k];
      });
      if (partial.geometry) o.geometry = Object.assign(emptyGeometry(), partial.geometry);
      if (partial.transform) o.transform = Object.assign(emptyTransform(), partial.transform);
      if (partial.properties) o.properties = Object.assign({}, partial.properties);
      if (partial.classification) o.classification = Object.assign({ system: 'FPS', code: '', title: '' }, partial.classification);
      if (partial.quantities) o.quantities = Object.assign({}, partial.quantities);
      if (partial.relationships) o.relationships = Object.assign({ contains: [], containedIn: null, connects: [], hosts: [], hostedBy: null }, partial.relationships);
    }
    return o;
  }

  function validateObject(obj, opts) {
    opts = opts || {};
    var errors = [];
    if (!obj || typeof obj !== 'object') {
      return { ok: false, errors: ['object is required'] };
    }
    REQUIRED.forEach(function (k) {
      if (obj[k] == null || obj[k] === '') errors.push('missing required field: ' + k);
    });
    if (obj.id != null && typeof obj.id !== 'string') errors.push('id must be a string UUID');
    if (obj.type != null && typeof obj.type !== 'string') errors.push('type must be a string');
    if (opts.knownTypesOnly && obj.type && !Object.keys(TYPES).some(function (k) { return TYPES[k] === obj.type; })) {
      errors.push('unknown type: ' + obj.type);
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /**
   * @param {object} [seed] optional { name, projectId, siteId, buildingId, storeyId }
   */
  function createModel(seed) {
    seed = seed || {};
    var listeners = [];
    var objects = Object.create(null);
    var meta = {
      schemaVersion: SCHEMA_VERSION,
      name: seed.name || 'Untitled Project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: seed.source || 'fps-bim',
      units: 'ft',
      legacySchemaVersion: seed.legacySchemaVersion != null ? seed.legacySchemaVersion : 0
    };

    function emit(type, payload) {
      var ev = { type: type, payload: payload, at: Date.now() };
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](ev); } catch (e) { /* subscriber errors must not break model */ }
      }
      return ev;
    }

    function touch() {
      meta.updatedAt = new Date().toISOString();
    }

    function assertUniqueId(id) {
      if (objects[id]) throw new Error('duplicate id: ' + id);
    }

    function add(partial) {
      var obj = createObject(partial);
      var v = validateObject(obj, { knownTypesOnly: true });
      if (!v.ok) throw new Error('invalid object: ' + v.errors.join('; '));
      assertUniqueId(obj.id);
      objects[obj.id] = obj;
      touch();
      emit('create', { id: obj.id, object: obj });
      return obj;
    }

    function get(id) {
      return objects[id] || null;
    }

    function update(id, patch) {
      var cur = objects[id];
      if (!cur) throw new Error('not found: ' + id);
      if (patch && patch.id && patch.id !== id) throw new Error('cannot change id');
      var next = createObject(Object.assign({}, cur, patch || {}, { id: id }));
      var v = validateObject(next, { knownTypesOnly: true });
      if (!v.ok) throw new Error('invalid object: ' + v.errors.join('; '));
      objects[id] = next;
      touch();
      emit('update', { id: id, object: next, prev: cur });
      return next;
    }

    function remove(id) {
      var cur = objects[id];
      if (!cur) return false;
      delete objects[id];
      // scrub relationship refs
      Object.keys(objects).forEach(function (oid) {
        var o = objects[oid];
        var rel = o.relationships;
        if (!rel) return;
        if (rel.containedIn === id) rel.containedIn = null;
        if (rel.hostedBy === id) rel.hostedBy = null;
        ['contains', 'connects', 'hosts'].forEach(function (k) {
          if (Array.isArray(rel[k])) rel[k] = rel[k].filter(function (x) { return x !== id; });
        });
      });
      touch();
      emit('delete', { id: id, object: cur });
      return true;
    }

    function query(filter) {
      filter = filter || {};
      var out = [];
      Object.keys(objects).forEach(function (id) {
        var o = objects[id];
        if (filter.type && o.type !== filter.type) return;
        if (filter.storeyId != null && o.storeyId !== filter.storeyId) return;
        if (filter.nameContains) {
          var n = (o.name || '').toLowerCase();
          if (n.indexOf(String(filter.nameContains).toLowerCase()) < 0) return;
        }
        if (filter.prop) {
          var pk = filter.prop.key, pv = filter.prop.value;
          if (!o.properties || o.properties[pk] !== pv) return;
        }
        out.push(o);
      });
      return out;
    }

    function linkContains(parentId, childId) {
      var p = objects[parentId], c = objects[childId];
      if (!p || !c) throw new Error('linkContains: missing parent or child');
      if (p.relationships.contains.indexOf(childId) < 0) p.relationships.contains.push(childId);
      c.relationships.containedIn = parentId;
      if (c.storeyId == null && p.type === TYPES.STOREY) c.storeyId = parentId;
      touch();
      emit('update', { id: parentId, object: p });
      emit('update', { id: childId, object: c });
    }

    function linkHosts(hostId, hostedId) {
      var h = objects[hostId], g = objects[hostedId];
      if (!h || !g) throw new Error('linkHosts: missing host or hosted');
      if (h.relationships.hosts.indexOf(hostedId) < 0) h.relationships.hosts.push(hostedId);
      g.relationships.hostedBy = hostId;
      touch();
      emit('update', { id: hostId, object: h });
      emit('update', { id: hostedId, object: g });
    }

    function validateModel() {
      var errors = [];
      var ids = Object.keys(objects);
      var seen = Object.create(null);
      ids.forEach(function (id) {
        if (seen[id]) errors.push('duplicate id in index: ' + id);
        seen[id] = 1;
        var v = validateObject(objects[id], { knownTypesOnly: true });
        if (!v.ok) errors.push(id + ': ' + v.errors.join('; '));
        var rel = objects[id].relationships || {};
        ['contains', 'connects', 'hosts'].forEach(function (k) {
          (rel[k] || []).forEach(function (ref) {
            if (!objects[ref]) errors.push(id + '.' + k + ' → missing ' + ref);
          });
        });
        if (rel.containedIn && !objects[rel.containedIn]) errors.push(id + '.containedIn → missing');
        if (rel.hostedBy && !objects[rel.hostedBy]) errors.push(id + '.hostedBy → missing');
      });
      var projects = query({ type: TYPES.PROJECT });
      if (projects.length === 0) errors.push('model has no IfcProject');
      return { ok: errors.length === 0, errors: errors };
    }

    function toJSON() {
      return {
        schemaVersion: meta.schemaVersion,
        meta: {
          name: meta.name,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          source: meta.source,
          units: meta.units,
          legacySchemaVersion: meta.legacySchemaVersion
        },
        objects: Object.keys(objects).map(function (id) {
          return JSON.parse(JSON.stringify(objects[id]));
        })
      };
    }

    function fromJSON(data) {
      if (!data || typeof data !== 'object') throw new Error('fromJSON: invalid data');
      var ver = data.schemaVersion != null ? data.schemaVersion : 0;
      if (ver > SCHEMA_VERSION) throw new Error('unsupported schemaVersion: ' + ver);
      // clear
      Object.keys(objects).forEach(function (id) { delete objects[id]; });
      if (data.meta) {
        meta.name = data.meta.name || meta.name;
        meta.createdAt = data.meta.createdAt || meta.createdAt;
        meta.source = data.meta.source || meta.source;
        meta.units = data.meta.units || meta.units;
        meta.legacySchemaVersion = data.meta.legacySchemaVersion != null ? data.meta.legacySchemaVersion : 0;
      }
      meta.schemaVersion = SCHEMA_VERSION;
      var list = data.objects || [];
      list.forEach(function (raw) {
        var obj = createObject(raw);
        var v = validateObject(obj);
        if (!v.ok) throw new Error('fromJSON invalid: ' + v.errors.join('; '));
        if (objects[obj.id]) throw new Error('fromJSON duplicate id: ' + obj.id);
        objects[obj.id] = obj;
      });
      touch();
      emit('load', { count: list.length, schemaVersion: ver });
      return api;
    }

    function on(fn) {
      if (typeof fn === 'function') listeners.push(fn);
      return function off() {
        listeners = listeners.filter(function (x) { return x !== fn; });
      };
    }

    function stats() {
      var byType = {};
      Object.keys(objects).forEach(function (id) {
        var t = objects[id].type;
        byType[t] = (byType[t] || 0) + 1;
      });
      return { count: Object.keys(objects).length, byType: byType, schemaVersion: meta.schemaVersion };
    }

    // Seed minimal hierarchy if requested
    var project = null, site = null, building = null, storey = null;
    if (seed.withHierarchy !== false) {
      project = add({ id: seed.projectId, type: TYPES.PROJECT, name: meta.name });
      site = add({ id: seed.siteId, type: TYPES.SITE, name: 'Site', properties: { role: 'site' } });
      building = add({ id: seed.buildingId, type: TYPES.BUILDING, name: 'Building' });
      storey = add({ id: seed.storeyId, type: TYPES.STOREY, name: 'Ground Floor', properties: { elevation: 0, level: 0 } });
      linkContains(project.id, site.id);
      linkContains(site.id, building.id);
      linkContains(building.id, storey.id);
    }

    var api = {
      SCHEMA_VERSION: SCHEMA_VERSION,
      TYPES: TYPES,
      meta: meta,
      uuid: uuid,
      createObject: createObject,
      validateObject: validateObject,
      add: add,
      get: get,
      update: update,
      remove: remove,
      query: query,
      linkContains: linkContains,
      linkHosts: linkHosts,
      validateModel: validateModel,
      toJSON: toJSON,
      fromJSON: fromJSON,
      on: on,
      stats: stats,
      getProject: function () { return query({ type: TYPES.PROJECT })[0] || null; },
      getStoreys: function () { return query({ type: TYPES.STOREY }); },
      /** @internal test helper */
      _all: function () { return Object.keys(objects).map(function (id) { return objects[id]; }); }
    };

    if (project) {
      api.ids = { project: project.id, site: site.id, building: building.id, storey: storey.id };
    }

    return api;
  }

  /**
   * Migrate serialized BIM JSON. Absence of schemaVersion ⇒ v0.
   * v0 and v1 currently share object shape; bump SCHEMA_VERSION when breaking.
   */
  function migrateDocument(data) {
    if (!data || typeof data !== 'object') throw new Error('migrate: invalid');
    var ver = data.schemaVersion != null ? data.schemaVersion : 0;
    var out = JSON.parse(JSON.stringify(data));
    if (ver === 0) {
      out.schemaVersion = 1;
      out.meta = out.meta || {};
      out.meta.legacySchemaVersion = 0;
      out.objects = (out.objects || []).map(function (o) {
        return createObject(o);
      });
    }
    if ((out.schemaVersion || 0) > SCHEMA_VERSION) {
      throw new Error('migrate: unsupported schemaVersion ' + out.schemaVersion);
    }
    out.schemaVersion = SCHEMA_VERSION;
    return out;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    TYPES: TYPES,
    uuid: uuid,
    createObject: createObject,
    validateObject: validateObject,
    createModel: createModel,
    migrateDocument: migrateDocument,
    emptyGeometry: emptyGeometry,
    emptyTransform: emptyTransform
  };
});
