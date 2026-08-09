/**
 * Floor Plan Studio — Phase 1 one-way legacy grid → BIM converter
 * Reads snap-like plain objects / Maps / Sets. Does not touch DOM.
 *
 * Browser: window.FPSBimLegacy
 * Node: module.exports
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'));
  } else {
    root.FPSBimLegacy = factory(root.FPSBim);
  }
})(typeof self !== 'undefined' ? self : this, function (FPSBim) {
  'use strict';

  if (!FPSBim) throw new Error('FPSBimLegacy requires FPSBim (load bim/model.js first)');

  var T = FPSBim.TYPES;

  /** Deterministic UUID-shaped id from prefix+legacy key (stable across refreshes). */
  function stableUuidFromKey(prefix, key) {
    var s = 'fps-bim-v1|' + prefix + '|' + String(key);
    var bytes = new Array(16);
    var h0 = 0x811c9dc5 >>> 0, h1 = 0x811c9dc5 >>> 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h0 ^= c;
      h0 = Math.imul(h0, 0x01000193) >>> 0;
      h1 ^= (c + i * 17) & 0xff;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    // mix into 16 bytes
    for (var j = 0; j < 16; j++) {
      h0 ^= Math.imul(h1, j + 1) >>> 0;
      h1 ^= Math.imul(h0, 0x9e3779b9) >>> 0;
      bytes[j] = (h0 >>> ((j % 4) * 8)) & 0xff;
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4-shaped
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = [];
    for (var k = 0; k < 16; k++) hex.push((bytes[k] + 0x100).toString(16).slice(1));
    return (
      hex.slice(0, 4).join('') + '-' +
      hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' +
      hex.slice(10, 16).join('')
    );
  }

  function asArray(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x;
    if (typeof x.forEach === 'function') {
      var a = [];
      x.forEach(function (v, k) {
        // Map.forEach(value, key) vs Set.forEach(value)
        if (typeof k === 'string' || typeof k === 'number') a.push([k, v]);
        else a.push(v);
      });
      return a;
    }
    return [];
  }

  function mapEntries(x) {
    if (!x) return [];
    if (x instanceof Map) return Array.from(x.entries());
    if (Array.isArray(x)) {
      // [[k,v], ...] or already entries from snap
      return x.map(function (e) {
        if (Array.isArray(e) && e.length >= 2) return [e[0], e[1]];
        return e;
      });
    }
    if (typeof x === 'object') return Object.keys(x).map(function (k) { return [k, x[k]]; });
    return [];
  }

  function setValues(x) {
    if (!x) return [];
    if (x instanceof Set) return Array.from(x);
    if (Array.isArray(x)) return x.slice();
    return [];
  }

  /**
   * Convert grid edge key "h:c:r" | "v:c:r" to wall centerline endpoints in feet.
   * Origin: top-left of grid in plan space; +X right (cols), +Y down (rows) in grid;
   * BIM uses Y-up world with plan X right, plan Y depth = row * ft (north depends on face — stored as property).
   */
  function edgeKeyToSegment(key, ftPerCell, rows) {
    var a = String(key).split(':');
    var t = a[0], c = +a[1], r = +a[2], f = ftPerCell || 3;
    // Plan coords: X = col * f, Y = r * f (row increases "south" on default canvas)
    if (t === 'h') {
      return {
        kind: 'segment',
        units: 'ft',
        points: [
          [c * f, r * f, 0],
          [(c + 1) * f, r * f, 0]
        ],
        extrude: null,
        gridRef: { edgeKey: key, orient: 'h', c: c, r: r }
      };
    }
    return {
      kind: 'segment',
      units: 'ft',
      points: [
        [c * f, r * f, 0],
        [c * f, (r + 1) * f, 0]
      ],
      extrude: null,
      gridRef: { edgeKey: key, orient: 'v', c: c, r: r }
    };
  }

  function cellToBox(c, r, ftPerCell) {
    var f = ftPerCell || 3;
    return {
      kind: 'bbox',
      units: 'ft',
      points: [
        [c * f, r * f, 0],
        [(c + 1) * f, (r + 1) * f, 0]
      ],
      extrude: null,
      gridRef: { cell: c + ':' + r, c: c, r: r }
    };
  }

  function isCompoundEdge(key, cols, rows) {
    var a = String(key).split(':');
    var t = a[0], c = +a[1], r = +a[2];
    if (t === 'h') return r === 0 || r === rows;
    return c === 0 || c === cols;
  }

  /**
   * Flood-fill rooms from wall set (same semantics as editor computeRooms).
   * Porch cells (in-building flood from a Porch label) stay a separate space
   * and are not merged into compound / yard.
   */
  function computeRoomsFromWalls(wallsArr, cols, rows, labelsMap, site) {
    var wallSet = {};
    wallsArr.forEach(function (k) { wallSet[k] = 1; });
    function walled(c, r, dc, dr) {
      var e;
      if (dc === 1) e = 'v:' + (c + 1) + ':' + r;
      else if (dc === -1) e = 'v:' + c + ':' + r;
      else if (dr === 1) e = 'h:' + c + ':' + (r + 1);
      else e = 'h:' + c + ':' + r;
      return !!wallSet[e];
    }
    function inBldg(c, r) {
      if (!site || site.offC == null) return true;
      return c >= site.offC && c < site.offC + site.bCols && r >= site.offR && r < site.offR + site.bRows;
    }
    var porchSet = {};
    Object.keys(labelsMap || {}).forEach(function (k) {
      if (!/porch/i.test(labelsMap[k] || '')) return;
      var a = k.split(':'), stack = [[+a[0], +a[1]]];
      while (stack.length) {
        var cur = stack.pop(), cc = cur[0], rr = cur[1], key = cc + ':' + rr;
        if (porchSet[key]) continue;
        if (!inBldg(cc, rr)) continue;
        porchSet[key] = 1;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nc = cc + d[0], nr = rr + d[1];
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) return;
          if (walled(cc, rr, d[0], d[1])) return;
          if (!inBldg(nc, nr)) return;
          stack.push([nc, nr]);
        });
      }
    });
    function pickLabel(cells) {
      var found = [];
      cells.forEach(function (cl) {
        var t = labelsMap[cl[0] + ':' + cl[1]];
        if (t) found.push(t);
      });
      if (!found.length) return '';
      function hit(re) {
        for (var i = 0; i < found.length; i++) if (re.test(found[i])) return found[i];
        return '';
      }
      return hit(/porch/i) || hit(/stair/i) || hit(/^(?!(compound|front yard|main gate)$).+/i) || hit(/compound/i) || found[0];
    }
    var seen = {}, rooms = [];
    for (var c = 0; c < cols; c++) {
      for (var r = 0; r < rows; r++) {
        var key = c + ':' + r;
        if (seen[key]) continue;
        var stack = [[c, r]], cells = [];
        seen[key] = 1;
        while (stack.length) {
          var cur = stack.pop();
          cells.push(cur);
          var cc = cur[0], rr = cur[1];
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
            var nc = cc + d[0], nr = rr + d[1];
            if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) return;
            if (walled(cc, rr, d[0], d[1])) return;
            if (!!porchSet[cc + ':' + rr] !== !!porchSet[nc + ':' + nr]) return;
            var nk = nc + ':' + nr;
            if (seen[nk]) return;
            seen[nk] = 1;
            stack.push([nc, nr]);
          });
        }
        var label = pickLabel(cells);
        var sx = 0, sy = 0;
        cells.forEach(function (cl) { sx += cl[0]; sy += cl[1]; });
        rooms.push({
          cells: cells,
          label: label,
          cx: sx / cells.length,
          cy: sy / cells.length,
          key: Math.min.apply(null, cells.map(function (x) { return x[0]; })) + ':' + Math.min.apply(null, cells.map(function (x) { return x[1]; }))
        });
      }
    }
    return rooms;
  }

  /**
   * @param {object} legacy — snap object OR live editor bag
   *   Expected: w/walls, d/doors, win/windows, lo/lofts, st/stairs, fn/furniture,
   *   lab/labels, rs/roomSizes, nt/notes, pn, face, cols, rows, ftPerCell, site
   * @param {object} [opts]
   */
  function convertLegacyToBim(legacy, opts) {
    opts = opts || {};
    legacy = legacy || {};
    var cols = legacy.cols != null ? legacy.cols : opts.cols != null ? opts.cols : 14;
    var rows = legacy.rows != null ? legacy.rows : opts.rows != null ? opts.rows : 26;
    var ft = legacy.ftPerCell != null ? legacy.ftPerCell : opts.ftPerCell != null ? opts.ftPerCell : 3;
    var site = legacy.site || opts.site || null;
    var wallH = (site && site.wallLo != null ? site.wallLo : 7) + (site && site.loftSlab != null ? site.loftSlab : 0.5) + (site && site.wallHi != null ? site.wallHi : 3);
    var compoundH = site && site.compoundH != null ? site.compoundH : 5;

    var walls = setValues(legacy.w || legacy.walls);
    var doors = mapEntries(legacy.d || legacy.doors);
    var windows = mapEntries(legacy.win || legacy.windows);
    var lofts = setValues(legacy.lo || legacy.lofts);
    var stairs = mapEntries(legacy.st || legacy.stairs);
    var furniture = mapEntries(legacy.fn || legacy.furniture);
    var labels = {};
    mapEntries(legacy.lab || legacy.labels).forEach(function (e) { labels[e[0]] = e[1]; });
    var roomSizes = {};
    mapEntries(legacy.rs || legacy.roomSizes).forEach(function (e) { roomSizes[e[0]] = e[1]; });
    var notes = mapEntries(legacy.nt || legacy.notes);

    var name = legacy.pn || legacy.projectName || opts.name || 'Untitled Project';
    var face = legacy.face || 'W';

    var model = FPSBim.createModel({
      name: name,
      withHierarchy: true,
      source: 'fps-legacy-convert',
      legacySchemaVersion: legacy.schemaVersion != null ? legacy.schemaVersion : 0,
      projectId: stableUuidFromKey('project', name),
      siteId: stableUuidFromKey('site', name + '|main'),
      buildingId: stableUuidFromKey('building', name + '|main'),
      storeyId: stableUuidFromKey('storey', name + '|gf')
    });
    var storeyId = model.ids.storey;
    var buildingId = model.ids.building;
    var siteId = model.ids.site;

    model.update(siteId, {
      properties: {
        face: face,
        plotL: site ? site.plotL : null,
        plotW: site ? site.plotW : null,
        setback: site ? site.setback : null
      },
      quantities: site ? { area: (site.plotL || 0) * (site.plotW || 0) } : {}
    });
    model.update(buildingId, {
      properties: {
        bldgL: site ? site.bldgL : null,
        bldgW: site ? site.bldgW : null
      }
    });
    model.update(storeyId, {
      properties: {
        elevation: 0,
        level: 0,
        wallStackFt: wallH,
        compoundWallFt: compoundH
      }
    });

    function stableId(prefix, key) {
      return stableUuidFromKey(prefix, key);
    }

    var wallByKey = Object.create(null);

    walls.forEach(function (key) {
      var compound = isCompoundEdge(key, cols, rows);
      var geom = edgeKeyToSegment(key, ft, rows);
      geom.extrude = { height: compound ? compoundH : wallH, direction: [0, 0, 1] };
      var len = ft;
      var wall = model.add({
        id: stableId('wall', key),
        type: T.WALL,
        name: compound ? 'Compound wall' : 'Wall',
        storeyId: storeyId,
        geometry: geom,
        properties: {
          legacyEdgeKey: key,
          compound: compound,
          heightFt: compound ? compoundH : wallH
        },
        classification: { system: 'FPS', code: compound ? 'WALL.COMPOUND' : 'WALL', title: compound ? 'Compound Wall' : 'Wall' },
        quantities: { length: len, height: compound ? compoundH : wallH, area: len * (compound ? compoundH : wallH) }
      });
      model.linkContains(storeyId, wall.id);
      wallByKey[key] = wall.id;
    });

    doors.forEach(function (pair) {
      var key = pair[0], info = pair[1] || {};
      var hostId = wallByKey[key];
      var geom = edgeKeyToSegment(key, ft, rows);
      geom.kind = 'opening';
      var door = model.add({
        id: stableId('door', key),
        type: T.DOOR,
        name: 'Door ' + (info.id != null ? info.id : ''),
        storeyId: storeyId,
        geometry: geom,
        properties: {
          legacyEdgeKey: key,
          legacyDoorId: info.id,
          swing: info.s,
          gate: isCompoundEdge(key, cols, rows)
        },
        classification: { system: 'FPS', code: 'DOOR', title: 'Door' },
        quantities: { width: ft, height: 7 }
      });
      model.linkContains(storeyId, door.id);
      if (hostId) model.linkHosts(hostId, door.id);
    });

    windows.forEach(function (pair) {
      var key = pair[0], wtype = pair[1];
      if (typeof wtype === 'object' && wtype) wtype = wtype.type || wtype.t || 'S';
      var hostId = wallByKey[key];
      var geom = edgeKeyToSegment(key, ft, rows);
      geom.kind = 'opening';
      var win = model.add({
        id: stableId('win', key),
        type: T.WINDOW,
        name: (wtype === 'A' ? 'Awning' : wtype === 'V' ? 'Ventilator' : wtype === 'F' ? 'Fixed' : wtype === 'C' ? 'Clerestory' : 'Sliding') + ' window',
        storeyId: storeyId,
        geometry: geom,
        properties: {
          legacyEdgeKey: key,
          windowType: wtype === 'A' ? 'awning' : wtype === 'V' ? 'ventilator' : wtype === 'F' ? 'fixed' : wtype === 'C' ? 'clerestory' : 'sliding'
        },
        classification: { system: 'FPS', code: 'WINDOW.' + (wtype === 'A' ? 'AWNING' : wtype === 'V' ? 'VENT' : wtype === 'F' ? 'FIXED' : wtype === 'C' ? 'CLERESTORY' : 'SLIDING'), title: 'Window' },
        quantities: { width: ft, height: 4 }
      });
      model.linkContains(storeyId, win.id);
      if (hostId) model.linkHosts(hostId, win.id);
    });

    var rooms = computeRoomsFromWalls(walls, cols, rows, labels, site);
    var maxCells = cols * rows;
    rooms.forEach(function (rm) {
      // Skip huge unlabeled outdoor / plot voids (keep labelled yards/gates)
      if (!rm.label && rm.cells.length > Math.max(24, maxCells * 0.35)) return;
      var ov = roomSizes[rm.key];
      var area = ov && ov.w && ov.h ? ov.w * ov.h : rm.cells.length * ft * ft;
      var space = model.add({
        id: stableId('space', rm.key),
        type: T.SPACE,
        name: rm.label || ('Space ' + rm.key),
        storeyId: storeyId,
        geometry: {
          kind: 'cells',
          units: 'ft',
          points: rm.cells.map(function (cl) { return [cl[0] * ft, cl[1] * ft, 0]; }),
          extrude: { height: wallH, direction: [0, 0, 1] },
          gridRef: { roomKey: rm.key, cells: rm.cells.map(function (cl) { return cl[0] + ':' + cl[1]; }) }
        },
        properties: {
          legacyRoomKey: rm.key,
          label: rm.label || '',
          lengthFt: ov ? ov.w : null,
          breadthFt: ov ? ov.h : null
        },
        classification: { system: 'FPS', code: 'SPACE', title: rm.label || 'Space' },
        quantities: { area: area, cellCount: rm.cells.length }
      });
      model.linkContains(storeyId, space.id);
    });

    stairs.forEach(function (pair) {
      var key = pair[0], dir = pair[1];
      var a = String(key).split(':');
      var st = model.add({
        id: stableId('stair', key),
        type: T.STAIR,
        name: 'Stairs',
        storeyId: storeyId,
        geometry: cellToBox(+a[0], +a[1], ft),
        properties: { legacyCell: key, direction: dir },
        classification: { system: 'FPS', code: 'STAIR', title: 'Stair' },
        quantities: { area: ft * ft }
      });
      model.linkContains(storeyId, st.id);
    });

    furniture.forEach(function (pair) {
      var key = pair[0], info = pair[1] || {};
      var a = String(key).split(':');
      var fur = model.add({
        id: stableId('furn', key),
        type: T.FURNITURE,
        name: info.t || 'Furniture',
        storeyId: storeyId,
        geometry: cellToBox(+a[0], +a[1], ft),
        transform: { origin: [(+a[0] + 0.5) * ft, (+a[1] + 0.5) * ft, 0], rotation: ((info.r || 0) * 90), scale: [1, 1, 1] },
        properties: { legacyCell: key, furnType: info.t, rotationIndex: info.r || 0 },
        classification: { system: 'FPS', code: 'FURN.' + String(info.t || 'ITEM').toUpperCase(), title: info.t || 'Furniture' },
        quantities: {}
      });
      model.linkContains(storeyId, fur.id);
    });

    lofts.forEach(function (key) {
      var a = String(key).split(':');
      var loft = model.add({
        id: stableId('loft', key),
        type: T.SLAB,
        name: 'Loft slab',
        storeyId: storeyId,
        geometry: Object.assign(cellToBox(+a[0], +a[1], ft), {
          extrude: { height: site && site.loftSlab != null ? site.loftSlab : 0.5, direction: [0, 0, 1] }
        }),
        properties: { legacyCell: key, role: 'loft' },
        classification: { system: 'FPS', code: 'SLAB.LOFT', title: 'Loft Slab' },
        quantities: { area: ft * ft, thickness: site && site.loftSlab != null ? site.loftSlab : 0.5 }
      });
      model.linkContains(storeyId, loft.id);
    });

    // Building slab placeholder (single object — not per-cell)
    if (site) {
      var slab = model.add({
        type: T.SLAB,
        name: 'Building slab',
        storeyId: storeyId,
        geometry: {
          kind: 'bbox',
          units: 'ft',
          points: [
            [site.offC * ft, site.offR * ft, wallH],
            [(site.offC + site.bCols) * ft, (site.offR + site.bRows) * ft, wallH]
          ],
          extrude: { height: 0.5, direction: [0, 0, 1] },
          gridRef: { role: 'building-slab' }
        },
        properties: { role: 'building-slab', elevationFt: wallH },
        classification: { system: 'FPS', code: 'SLAB.FLOOR', title: 'Building Slab' },
        quantities: { area: (site.bCols * ft) * (site.bRows * ft), thickness: 0.5 }
      });
      model.linkContains(storeyId, slab.id);
    }

    notes.forEach(function (pair) {
      var key = pair[0], txt = pair[1];
      var a = String(key).split(':');
      var ann = model.add({
        type: T.ANNOTATION,
        name: 'Note',
        storeyId: storeyId,
        geometry: cellToBox(+a[0], +a[1], ft),
        properties: { legacyCell: key, text: txt },
        classification: { system: 'FPS', code: 'ANNOT.NOTE', title: 'Note' }
      });
      model.linkContains(storeyId, ann.id);
    });

    var report = model.validateModel();
    return { model: model, validation: report, stats: model.stats() };
  }

  /**
   * Build legacy bag from live editor globals (browser hook).
   */
  function legacyBagFromEditor(g) {
    g = g || {};
    return {
      schemaVersion: g.schemaVersion != null ? g.schemaVersion : 0,
      w: g.walls ? Array.from(g.walls) : [],
      d: g.doors ? Array.from(g.doors.entries()) : [],
      win: g.windows ? Array.from(g.windows.entries()) : [],
      lo: g.lofts ? Array.from(g.lofts) : [],
      st: g.stairs ? Array.from(g.stairs.entries()) : [],
      fn: g.furniture ? Array.from(g.furniture.entries()) : [],
      lab: g.labels ? Array.from(g.labels.entries()) : [],
      rs: g.roomSizes ? Array.from(g.roomSizes.entries()) : [],
      nt: g.notes ? Array.from(g.notes.entries()) : [],
      pn: g.projectName || 'Untitled',
      face: g.mainFace || 'W',
      cols: g.COLS,
      rows: g.ROWS,
      ftPerCell: g.ftPerCell,
      site: g.SITE || null
    };
  }

  /** Find BIM object on a model by legacy grid key (edge or cell). */
  function findByLegacy(model, kind, legacyKey) {
    if (!model || !legacyKey) return null;
    var prop =
      kind === 'wall' || kind === 'door' || kind === 'win' || kind === 'window'
        ? 'legacyEdgeKey'
        : kind === 'space' || kind === 'room'
          ? 'legacyRoomKey'
          : 'legacyCell';
    var typeMap = {
      wall: T.WALL,
      door: T.DOOR,
      win: T.WINDOW,
      window: T.WINDOW,
      space: T.SPACE,
      room: T.SPACE,
      furn: T.FURNITURE,
      furniture: T.FURNITURE,
      stair: T.STAIR,
      loft: T.SLAB
    };
    var wantType = typeMap[kind] || null;
    var list = wantType ? model.query({ type: wantType }) : model._all ? model._all() : [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      var p = o.properties || {};
      if (p[prop] === legacyKey) return o;
      if (kind === 'loft' && p.legacyCell === legacyKey && p.role === 'loft') return o;
    }
    return null;
  }

  return {
    convertLegacyToBim: convertLegacyToBim,
    legacyBagFromEditor: legacyBagFromEditor,
    edgeKeyToSegment: edgeKeyToSegment,
    cellToBox: cellToBox,
    computeRoomsFromWalls: computeRoomsFromWalls,
    stableUuidFromKey: stableUuidFromKey,
    findByLegacy: findByLegacy
  };
});
