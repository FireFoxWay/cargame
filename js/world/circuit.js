// Circuit mode: one closed track from levels.json with barriers, lamps, grandstand and harbour scenery.
import * as THREE from '../lib/three.js';
import { clamp, lerp, smooth, dampAngle, vnoise, fbm, R, store, tick, setLoad } from '../core/util.js';
import { HW, RW, CURB0, BARRIER, WALL, SCENERY, TEST_TRACK } from '../core/config.js';
import { scene, mainOnly, FOG_D, BUILD } from '../gfx/renderer.js';
import { ATMO, GL_ATMOS } from '../gfx/shaders.js';
import { noiseTex, canvasTex } from '../gfx/textures.js';
import { Course } from './course.js';
import { ribbonGeo, roadGeo, makeRoadMaterial } from './roadmat.js';
import { place, freeze, buildLamps, initLampLights, buildTrees, buildBuildings, makeGroundMaterial, makeWaterMat } from './props.js';

// Circuits come from levels.json (edited with editor.html); this copy is the offline fallback.
const BUILTIN_LEVELS = [{"name":"Harbor Sprint","stars":1,"track":[[0,-600],[0,-300],[0,0],[20,200],[120,300],[300,320],[480,300],[600,220],[640,60],[560,-60],[600,-200],[640,-400],[560,-560],[380,-620],[180,-640],[60,-640]]},{"name":"Lantern Loop","stars":1,"track":[[0,-500],[0,-150],[0,150],[60,300],[220,330],[330,240],[330,60],[420,-40],[620,-20],[760,60],[860,-40],[820,-250],[640,-380],[420,-440],[260,-600],[100,-640]]},{"name":"Quayside Chicane","stars":2,"track":[[-200,-400],[-200,-100],[-150,150],[0,300],[250,340],[500,300],[700,200],[800,40],[780,-120],[690,-170],[640,-250],[700,-340],[720,-480],[600,-620],[300,-660],[40,-620],[-120,-540]]},{"name":"Pine Ridge","stars":2,"track":[[293,195],[473,150],[623,33],[645,-95],[625,-229],[660,-333],[662,-501],[490,-621],[305,-631],[122,-614],[-46,-517],[-59,-353],[-4,-235],[-37,-111],[-43,73],[102,187]]},{"name":"Breakwater","stars":2,"track":[[276,155],[430,192],[609,145],[671,32],[605,-147],[557,-201],[550,-270],[619,-384],[623,-509],[504,-610],[345,-615],[248,-598],[94,-561],[-10,-508],[-77,-392],[-67,-301],[-38,-224],[-10,-126],[22,-29],[84,46],[197,119]]},{"name":"Signal Hill","stars":3,"track":[[289,236],[438,184],[539,106],[627,12],[666,-76],[660,-177],[655,-241],[685,-336],[718,-453],[667,-618],[573,-680],[369,-695],[213,-635],[133,-567],[62,-466],[-10,-394],[-93,-345],[-176,-266],[-188,-146],[-108,-47],[-28,30],[49,129],[152,212]]},{"name":"Tidewater","stars":3,"track":[[335,258],[474,273],[598,154],[627,4],[700,-110],[764,-187],[743,-320],[662,-419],[623,-529],[566,-631],[404,-691],[250,-644],[92,-583],[-20,-549],[-131,-419],[-133,-332],[-150,-199],[-168,-77],[-97,16],[82,63],[180,129]]},{"name":"Old Mill Esses","stars":3,"track":[[295,239],[530,164],[662,60],[715,-102],[659,-248],[648,-348],[584,-489],[487,-550],[291,-688],[57,-721],[-55,-524],[-26,-360],[-94,-220],[-82,-105],[11,-16],[101,125]]},{"name":"Beacon Point","stars":4,"track":[[272,172],[418,100],[554,31],[612,-53],[628,-156],[671,-268],[720,-372],[700,-512],[529,-577],[368,-573],[211,-594],[68,-538],[16,-465],[-57,-374],[-102,-268],[-30,-159],[-16,-62],[-11,134],[90,205]]},{"name":"Saltmarsh","stars":4,"track":[[290,163],[486,174],[608,90],[643,-60],[680,-162],[795,-257],[891,-422],[739,-534],[451,-483],[371,-583],[218,-738],[14,-618],[-14,-485],[-86,-383],[-133,-277],[-113,-139],[-147,-2],[-93,144],[130,172]]},{"name":"Cannery Row","stars":5,"track":[[316,16],[408,-8],[591,35],[700,-48],[763,-194],[700,-311],[724,-469],[589,-666],[418,-648],[231,-570],[111,-453],[44,-390],[-17,-296],[-272,-163],[-260,25],[-84,99],[112,193]]},{"name":"Afterglow Circuit","stars":5,"track":[[0,-260],[0,-100],[0,60],[0,180],[15,250],[60,285],[120,280],[160,240],[170,180],[200,130],[260,120],[320,150],[350,210],[340,280],[360,340],[430,360],[500,330],[520,260],[500,180],[460,120],[460,40],[510,-20],[540,-100],[520,-190],[450,-240],[360,-230],[300,-180],[230,-190],[180,-250],[120,-320],[50,-330],[10,-300]]}];

export async function buildCircuit() {
  let LEVEL_DATA = BUILTIN_LEVELS;
  try { const r = await fetch('levels.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (Array.isArray(j.levels) && j.levels.length) LEVEL_DATA = j.levels; } } catch {}
  const NL = LEVEL_DATA.length;
  const LEVELS = LEVEL_DATA.map((l, i) => {
    const d = NL > 1 ? i / (NL - 1) : 0;
    return { n: i + 1, name: l.name, stars: clamp(l.stars | 0 || 1, 1, 5), pts: l.track,
      botSkill: l.botSkill ?? 0.9 + 0.075 * d, botUpg: l.botUpg ?? Math.round(d * 4), aggr: l.aggr ?? (d >= 0.5 ? (d - 0.45) / 0.55 : 0) };
  });
  const LEVEL = TEST_TRACK ? NL + 1 : clamp(store.get('level', 1) | 0, 1, NL);
  const LV = TEST_TRACK ? { n: LEVEL, name: 'Test · ' + (TEST_TRACK.name || 'Untitled'), stars: TEST_TRACK.stars || 3, pts: TEST_TRACK.track, botSkill: 0.95, botUpg: 2, aggr: 0 } : LEVELS[LEVEL - 1];

  const C = Course.fromControl(LV.pts, true, 2, true).racing();
  const { NS, DS, TL, TX, TZ, NXr, NZr, HEAD, CURV } = C;
  const idx = (i) => C.idx(i), trackPoint = (i, lat) => C.point(i, lat);
  const TARGET_LAP = C.IDEAL * lerp(1.04, 0.935, clamp((LEVEL - 1) / Math.max(NL - 1, 1), 0, 1));
  const levelLen = LEVELS.map((l) => new THREE.CatmullRomCurve3(l.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal', 0.5).getLength());

  // Distance-to-centreline field, used for terrain flattening and scenery placement.
  const DF = { x0: -800, z0: -1100, cell: 8, nx: 0, nz: 0, d: null };
  DF.nx = Math.ceil((1500 - DF.x0) / DF.cell) + 1; DF.nz = Math.ceil((1000 - DF.z0) / DF.cell) + 1;
  DF.d = new Float32Array(DF.nx * DF.nz);
  for (let iz = 0; iz < DF.nz; iz++) for (let ix = 0; ix < DF.nx; ix++) {
    const x = DF.x0 + ix * DF.cell, z = DF.z0 + iz * DF.cell; let m = 1e12;
    for (let i = 0; i < NS; i += 2) { const dx = x - TX[i], dz = z - TZ[i]; const d = dx * dx + dz * dz; if (d < m) m = d; }
    DF.d[iz * DF.nx + ix] = Math.sqrt(m);
  }
  function distAt(x, z) {
    const fx = (x - DF.x0) / DF.cell, fz = (z - DF.z0) / DF.cell;
    if (fx < 0 || fz < 0 || fx >= DF.nx - 1 || fz >= DF.nz - 1) return 3000;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, n = DF.nx, d = DF.d;
    return lerp(lerp(d[iz * n + ix], d[iz * n + ix + 1], tx), lerp(d[(iz + 1) * n + ix], d[(iz + 1) * n + ix + 1], tx), tz);
  }
  const shoreZ = (x) => 440 + Math.sin(x * 0.0042) * 45 + Math.sin(x * 0.011 + 2.0) * 18;
  function terrainH(x, z) {
    const d = distAt(x, z);
    const flat = smooth(BARRIER + 9, BARRIER + 150, d);
    let h = (fbm(x * 0.0022 + 11.3, z * 0.0022 + 7.1, 5) - 0.42) * 150;
    h += smooth(-420, -1100, z) * 120 + smooth(760, 1300, x) * 95 + smooth(-180, -750, x) * 75;
    h = Math.max(h, -4) * flat;
    const shore = shoreZ(x);
    const sea = smooth(shore - 30, shore + 70, z) * (1 - smooth(1090, 1180, z)) * smooth(BARRIER + 5, BARRIER + 40, d);
    h = lerp(h, -9, sea);
    h = lerp(h, 2.2 + vnoise(x * 0.01, z * 0.01) * 3, smooth(1090, 1180, z));
    return h - 0.05;
  }
  setLoad(0.3, 'Shaping the hills');
  await tick();

  /* Terrain, water, distant mountains */
  {
    const g = new THREE.PlaneGeometry(5600, 5600, 280, 280); g.rotateX(-Math.PI / 2); g.translate(250, 0, 200);
    const p = g.attributes.position, uv = g.attributes.uv, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = terrainH(x, z); p.setY(i, h);
      uv.setXY(i, x / 14, z / 14);
      const n = vnoise(x * 0.02, z * 0.02);
      let c = [lerp(0.04, 0.085, n), lerp(0.06, 0.075, n), lerp(0.025, 0.04, n)];
      if (SCENERY === 'city') { const u = 1 - smooth(260, 520, distAt(x, z)); c = c.map((v, k) => lerp(v, [0.07, 0.072, 0.078][k] * (0.8 + 0.4 * n), u)); }
      if (SCENERY === 'forest') c = c.map((v, k) => v * [0.75, 0.9, 0.8][k]);
      const rock = smooth(45, 140, h); c = c.map((v, k) => lerp(v, [0.03, 0.03, 0.034][k], rock));
      const sand = smooth(-3.5, -0.8, h) * (1 - smooth(0.6, 2.4, h)) * smooth(300, 420, z);
      c = c.map((v, k) => lerp(v, [0.10, 0.085, 0.062][k], sand));
      const under = smooth(-1.5, -5, h); c = c.map((v, k) => lerp(v, [0.012, 0.02, 0.02][k], under));
      col.set(c, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, makeGroundMaterial({ map: noiseTex })); m.receiveShadow = true;
    scene.add(freeze(m));
  }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2), makeWaterMat(FOG_D));
  water.position.set(250, -1.2, 400);
  scene.add(freeze(mainOnly(water)));
  {
    const seg = 180, pos = [], tv = [], ind = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, r = 3300 + Math.sin(a * 3) * 150;
      const x = 250 + Math.sin(a) * r, z = 200 + Math.cos(a) * r;
      const north = smooth(0.2, 0.95, Math.cos(a));
      const h = (140 + fbm(i * 0.06, 3.3, 5) * 520) * (1 - north * 0.55);
      pos.push(x, -40, z, x, h, z); tv.push(0, 1);
    }
    for (let i = 0; i < seg; i++) { const a = i * 2; ind.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(tv, 1)); g.setIndex(ind);
    const m = new THREE.ShaderMaterial({
      vertexShader: `attribute float aT; varying vec3 vW; varying float vT; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vT = aT; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      uniforms: { ...ATMO },
      fragmentShader: `varying vec3 vW; varying float vT; ${GL_ATMOS}
void main(){ vec3 dir = vW - cameraPosition; vec3 base = mix(vec3(0.004, 0.006, 0.013), vec3(0.12, 0.16, 0.22), uDay) * (0.7 + 0.5 * vT); gl_FragColor = vec4(mix(base, atmosColor(dir), clamp(0.66 - vT * 0.16 + 0.25 * (uFogMul - 1.0), 0.0, 1.0)), 1.0); }`,
      side: THREE.DoubleSide, depthWrite: true, fog: false,
    });
    const ring = new THREE.Mesh(g, m); ring.frustumCulled = false; scene.add(freeze(ring));
  }
  setLoad(0.4, 'Laying the asphalt');
  await tick();

  /* Road, verge, kerbs */
  const LAMP_N = 2 * Math.round(TL / 100), LAMP_SP = TL / LAMP_N, LAMP_BASE = BARRIER + 2.2, LAMP_ARM = 5.8;
  const LAMP_POOL = LAMP_BASE - LAMP_ARM - 0.6;
  const road = new THREE.Mesh(roadGeo(C), makeRoadMaterial({ kind: 'circuit', TL, lamps: { sp: LAMP_SP, pool: LAMP_POOL }, offset: 0 }));
  road.receiveShadow = true;
  scene.add(freeze(mainOnly(road)));
  {
    const prof = [[-(BARRIER + 5), -0.03], [-BARRIER, -0.03], [-(RW + 2.5), -0.022], [-RW, -0.008], [RW, -0.008], [RW + 2.5, -0.022], [BARRIER, -0.03], [BARRIER + 5, -0.03]];
    const g = ribbonGeo(C, prof, (lat, s, x, z) => [x / 3, z / 3]);
    const c = new Float32Array(g.attributes.position.count * 3), P = g.attributes.position;
    for (let k = 0; k <= NS; k++) {
      const i = k % NS;
      for (let j = 0; j < prof.length; j++) {
        const x = P.getX(k * 8 + j), z = P.getZ(k * 8 + j);
        const n = vnoise(x * 0.08, z * 0.08);
        let col = [lerp(0.035, 0.07, n), lerp(0.055, 0.075, n), lerp(0.02, 0.035, n)];
        const lat = prof[j][0]; const outside = Math.sign(lat) === -Math.sign(CURV[i]);
        let gv = 0; for (let q = -8; q <= 8; q += 4) gv = Math.max(gv, smooth(1 / 110, 1 / 55, Math.abs(CURV[idx(i + q)])));
        if (outside && Math.abs(lat) > RW + 1 && Math.abs(lat) < BARRIER + 1) col = col.map((v, q) => lerp(v, [0.085, 0.07, 0.052][q], gv * (0.8 + 0.2 * n)));
        c.set(col, (k * 8 + j) * 3);
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const m = new THREE.Mesh(g, makeGroundMaterial({ roughness: 0.88, map: noiseTex })); m.receiveShadow = true;
    scene.add(freeze(mainOnly(m)));
  }
  const curbAt = new Uint8Array(NS);
  for (let i = 0; i < NS; i++) if (Math.abs(CURV[i]) > 1 / 150) for (let k = -7; k <= 7; k++) curbAt[idx(i + k)] = 1;
  {
    const prof = [[0, 0.0], [0.22, 0.055], [1.05, 0.06], [1.4, 0.0]];
    const pos = [], col = [];
    const RED = [0.36, 0.02, 0.016], WHITE = [0.46, 0.46, 0.45];
    for (const side of [-1, 1]) for (let i = 0; i < NS; i++) {
      const j = idx(i + 1); if (!curbAt[i] || !curbAt[j]) continue;
      const cc = i % 2 === 0 ? RED : WHITE;
      for (let p = 0; p < prof.length - 1; p++) {
        const l0 = side * (CURB0 + prof[p][0]), l1 = side * (CURB0 + prof[p + 1][0]), y0 = prof[p][1], y1 = prof[p + 1][1];
        const [ax, az] = trackPoint(i, l0), [bx, bz] = trackPoint(i, l1), [cx, cz] = trackPoint(j, l0), [dx, dz] = trackPoint(j, l1);
        const A = [ax, y0, az], B = [bx, y1, bz], Cc = [cx, y0, cz], D = [dx, y1, dz];
        const tris = side > 0 ? [A, B, Cc, B, D, Cc] : [A, Cc, B, B, Cc, D];
        for (const v of tris) { pos.push(...v); col.push(...cc); }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, makeGroundMaterial({ roughness: 0.55 })); m.receiveShadow = true;
    scene.add(freeze(mainOnly(m)));
  }
  setLoad(0.5, 'Bolting up the barriers');
  await tick();

  /* Barriers, lamps, gantry, grandstand */
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0x9ea6b0, metalness: 0.85, roughness: 0.33, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const prof = [[0.0, 0.40], [-0.11, 0.50], [-0.03, 0.60], [-0.11, 0.70], [0.0, 0.80], [0.04, 0.83]].map(([o, y]) => [side * (BARRIER + o), y]);
    if (side < 0) prof.reverse();
    const m = new THREE.Mesh(ribbonGeo(C, prof), barrierMat); m.castShadow = true; m.receiveShadow = true; scene.add(freeze(m));
  }
  {
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.8, 0.15), new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.6, roughness: 0.5 }), NS);
    let c = 0;
    for (let i = 0; i < NS; i += 2) for (const side of [-1, 1]) { const [x, z] = trackPoint(i, side * (BARRIER + 0.14)); place(posts, c++, x, 0.4, z, HEAD[i]); }
    posts.count = c; posts.computeBoundingSphere(); scene.add(freeze(mainOnly(posts)));
    const refl = [new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.3, 0.2) }), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.5, 2.7) })];
    for (const [si, side] of [[0, 1], [1, -1]]) {
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), refl[si], Math.ceil(NS / 10)); let k = 0;
      for (let i = 0; i < NS; i += 10) { const [x, z] = trackPoint(i, side * (BARRIER - 0.1)); place(m, k++, x, 0.62, z, HEAD[i]); }
      m.count = k; m.computeBoundingSphere(); scene.add(freeze(m));
    }
  }
  {
    const list = [];
    for (let k = 0; k < LAMP_N; k++) {
      const s = k * LAMP_SP + LAMP_SP * 0.5, i = idx(Math.round(s / DS)), side = k % 2 === 0 ? 1 : -1;
      const [bx, bz] = trackPoint(i, side * LAMP_BASE), [hx, hz] = trackPoint(i, side * (LAMP_BASE - LAMP_ARM));
      const dx = -side * NXr[i], dz = -side * NZr[i];
      if (list.some((L) => (L.hx - hx) ** 2 + (L.hz - hz) ** 2 < 30 * 30)) continue;
      list.push({ bx, bz, hx, hz, ang: Math.atan2(-dz, dx) });
    }
    buildLamps(list, LAMP_ARM, 10);
    initLampLights();
  }
  // Start/finish gantry with the five start lights.
  const startLightMats = [];
  {
    const grp = new THREE.Group(); grp.position.set(TX[0], 0, TZ[0]); grp.rotation.y = HEAD[0]; scene.add(grp);
    const steel = new THREE.MeshStandardMaterial({ color: 0x23272e, metalness: 0.7, roughness: 0.4 });
    const span = RW + 1.6;
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.2, 0.6), steel); p.position.set(sx * span, 3.6, 0); grp.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.6, 1.3, 0.7), steel); beam.position.y = 6.6; grp.add(beam);
    await Promise.race([document.fonts.load('900 80px "Big Shoulders Display"').catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    const signTex = canvasTex(1024, 96, (g, w, h) => {
      g.fillStyle = '#05060a'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 24) for (let y = 0; y < h; y += 24) if (((x + y) / 24) % 2 === 0 && (x < 96 || x > w - 120)) { g.fillStyle = '#e8e8e8'; g.fillRect(x, y, 24, 24); }
      g.fillStyle = '#ffd6a0'; g.font = '900 72px "Big Shoulders Display", Impact, "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('AFTERGLOW CIRCUIT', w / 2, h / 2 + 3);
    });
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(2.2, 2.2, 2.2) });
    for (const sz of [-1, 1]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, span * 2 * 96 / 1024), signMat); s.position.set(0, 6.6, sz * 0.36); if (sz < 0) s.rotation.y = Math.PI; grp.add(s); }
    const housing = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.5 });
    for (let k = 0; k < 5; k++) {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.005, 0.005) }); startLightMats.push(m);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.1, 0.25), housing); h.position.set((k - 2) * 0.9, 5.0, -0.25); grp.add(h);
      for (const yy of [5.25, 4.78]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 10), m); b.position.set((k - 2) * 0.9, yy, -0.4); grp.add(b); }
    }
    grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    freeze(grp); grp.traverse(freeze);
  }
  // Grandstand on the start straight, with a crowd that takes photos.
  const crowdSpots = [];
  {
    const grp = new THREE.Group(); grp.position.set(TX[0], 0, TZ[0]); grp.rotation.y = HEAD[0]; scene.add(grp);
    const concrete = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.85 });
    const x0 = BARRIER + 5, tiers = 11, dep = 1.5, rise = 0.55, len = 150;
    for (let t = 0; t < tiers; t++) { const b = new THREE.Mesh(new THREE.BoxGeometry(dep, rise * (t + 1), len), concrete); b.position.set(-(x0 + dep * t + dep / 2), rise * (t + 1) / 2, -20); b.receiveShadow = true; grp.add(b); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(dep * tiers + 4, 0.3, len + 4), new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.6, metalness: 0.4 }));
    roof.position.set(-(x0 + dep * tiers / 2 - 1), rise * tiers + 4.2, -20); roof.rotation.z = -0.06; roof.castShadow = true; grp.add(roof);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 3.9, 4.6) }));
    strip.position.set(-(x0 - 2.6), rise * tiers + 3.62, -20); grp.add(strip);
    for (let z = -90; z <= 50; z += 20) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.4, rise * tiers + 4.4, 0.4), concrete); c.position.set(-(x0 + dep * tiers + 1), (rise * tiers + 4.4) / 2, z); c.castShadow = true; grp.add(c); }
    const people = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.58, 0.26), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, emissive: 0x06080e }), tiers * 190);
    const cc = new THREE.Color(), dim = new THREE.Color(0x202634); const palette = [0x9c2f2f, 0x2f4f9c, 0xd8d8d8, 0x2a2a2a, 0xc98b2a, 0x3d7a4f, 0x6d3f8a];
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
    let n = 0; grp.updateMatrixWorld(true); const wm = new THREE.Vector3();
    for (let t = 0; t < tiers; t++) for (let k = 0; k < 190; k++) {
      if (R() < 0.18) continue;
      const lx = -(x0 + dep * t + 0.4 + R() * 0.7), lz = -94 + k * 0.78 + R() * 0.2, ly = rise * (t + 1) + 0.31;
      _m.compose(_p.set(lx, ly, lz), _q, _s.set(1, 0.9 + R() * 0.25, 1)); people.setMatrixAt(n, _m);
      people.setColorAt(n, cc.setHex(palette[Math.floor(R() * palette.length)]).lerp(dim, 0.45).multiplyScalar(0.22 + R() * 0.3)); n++;
      if (R() < 0.25) { wm.set(lx, ly + 0.25, lz).applyMatrix4(grp.matrixWorld); crowdSpots.push(wm.clone()); }
    }
    people.count = n; people.computeBoundingSphere(); grp.add(mainOnly(people));
    freeze(grp); grp.traverse(freeze);
  }
  setLoad(0.6, 'Planting the pines');
  await tick();

  /* Trees, harbour city, bridge */
  {
    const N = Math.round((SCENERY === 'forest' ? 9000 : SCENERY === 'city' ? 700 : 2600) * BUILD.trees);
    const list = []; let tries = 0;
    while (list.length < N && tries < 160000) {
      tries++;
      const x = lerp(-750, 1450, R()), z = lerp(-1050, 520, R());
      const d = distAt(x, z); if (d < BARRIER + (SCENERY === 'forest' ? 3.5 : 6) || d > 900 || (SCENERY === 'city' && d < 420)) continue;
      const h = terrainH(x, z); if (h < 0.4) continue;
      const cluster = fbm(x * 0.012 + 5, z * 0.012 + 9, 3); if (cluster < (SCENERY === 'forest' ? 0.3 - (d < 120 ? 0.1 : 0) : 0.42 + (d < 60 ? 0.08 : 0))) continue;
      const s = (0.75 + R() * 0.85) * (SCENERY === 'forest' ? 1.35 : 1);
      list.push({ x, y: h, z, s, sy: 0.9 + R() * 0.35, ry: R() * 6.28, kind: R() < (SCENERY === 'forest' ? 0.12 : 0.22) ? 1 : 0, c: [0.7 + R() * 0.5, 0.75 + R() * 0.45, 0.7 + R() * 0.4] });
    }
    buildTrees(list);
  }
  {
    const spots = [];
    for (let i = 0; i < 360; i++) {
      const x = lerp(-1300, 1600, R()), z = lerp(1240, 1950, R());
      const c = Math.exp(-((x - 180) ** 2) / (2 * 420 ** 2) - ((z - 1460) ** 2) / (2 * 230 ** 2));
      spots.push({ x, y: 0, z, w: 16 + R() * 26, h: 16 + R() * 36 + c * (80 + R() * 190), d: 16 + R() * 26, ry: R() < 0.8 ? 0 : (R() - 0.5) * 0.8 });
    }
    buildBuildings(spots, 130);
    if (SCENERY === 'city') {
      // Downtown: towers along both sides of the track, kept clear of the barriers, lamps, grandstand and each other.
      const tw = [];
      for (let i = 0; i < NS; i += 9) {
        if (Math.min(i, NS - i) * DS < 120) continue;
        for (const side of [-1, 1]) {
          const w = 14 + R() * 18, d = 14 + R() * 18, r = Math.hypot(w, d) / 2;
          const [x, z] = trackPoint(i, side * (BARRIER + 11 + r + R() * 8));
          if (distAt(x, z) < BARRIER + 7 + r) continue;
          if (tw.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + r + 3)) continue;
          const tall = R() < 0.25;
          tw.push({ x, y: -0.5, z, w, d, r, h: tall ? 90 + R() * 130 : 22 + R() * 60, ry: HEAD[i] });
        }
      }
      buildBuildings(tw, 110);
    }
  }
  const traffic = [];
  {
    const BZ = 960, bx0 = -1650, bx1 = 420, dy = 20, len = bx1 - bx0;
    const dark = new THREE.MeshStandardMaterial({ color: 0x191c23, roughness: 0.7, metalness: 0.3 });
    const add = (m) => { scene.add(freeze(m)); return m; };
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 1.6, 16), dark); deck.position.set((bx0 + bx1) / 2, dy, BZ); add(deck);
    const lines = [];
    for (const px of [-1000, -420]) {
      for (const oz of [-7.5, 7.5]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(3.4, 125, 3.4), dark); leg.position.set(px, 125 / 2 - 3, BZ + oz); add(leg); }
      const cross = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 18), dark); cross.position.set(px, 96, BZ); add(cross);
      for (const oz of [-7.5, 7.5]) for (let k = 1; k <= 10; k++) for (const dir of [-1, 1]) lines.push(px, 116, BZ + oz, px + dir * k * 27, dy + 0.8, BZ + oz);
      const red = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 0.5, 0.3) })); red.position.set(px, 123, BZ); add(red);
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(0.12, 0.13, 0.17) })));
    const dl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.4, 1.4) }), 200); let k = 0;
    for (let x = bx0 + 10; x < bx1; x += 30) for (const oz of [-8, 8]) place(dl, k++, x, dy + 2.6, BZ + oz, 0);
    dl.count = k; dl.computeBoundingSphere(); add(dl);
    for (const [col, lane, dir] of [[new THREE.Color(5, 5, 5.5), -3.5, 1], [new THREE.Color(6, 0.25, 0.15), 3.5, -1]]) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.5, 1.2), new THREE.MeshBasicMaterial({ color: col }), 24);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; scene.add(freeze(im));
      traffic.push({ im, lane: BZ + lane, dir, x0: bx0, len, dy, phase: Array.from({ length: 24 }, () => R()) });
    }
  }
  // TV camera spots along the circuit.
  const tvCams = [];
  for (let i = 0; i < NS; i += 52) { const side = tvCams.length % 2 ? 1 : -1; const [x, z] = trackPoint(i, side * (BARRIER + 5 + R() * (SCENERY === 'harbor' ? 9 : 2))); tvCams.push({ i, x, z, y: 2.4 + R() * 6 }); }

  // Barrier contact: push the car back inside and bounce it off along the wall.
  function walls(c) {
    const al = Math.abs(c.lat); const i = c.ti;
    c.surface = al < HW + 0.2 ? 0 : al < CURB0 + 1.4 && curbAt[i] ? 1 : al < RW + 0.4 ? 0 : 2;
    if (al <= WALL) return 0;
    const side = Math.sign(c.lat), push = al - WALL;
    c.x -= NXr[i] * side * push; c.z -= NZr[i] * side * push; c.lat = side * WALL;
    const vn = (c.vx * NXr[i] + c.vz * NZr[i]) * side;
    if (vn <= 0) return 0;
    c.vx -= NXr[i] * side * vn * 1.35; c.vz -= NZr[i] * side * vn * 1.35;
    c.vx *= 0.985; c.vz *= 0.985; c.yawRate *= 0.6;
    c.psi = dampAngle(c.psi, HEAD[i] + (Math.cos(c.psi - HEAD[i]) < 0 ? Math.PI : 0), 3, 1 / 60);
    return vn;
  }
  const gridSlot = (k) => { const s = TL - (9 + 8 * k); return [idx(Math.round(s / DS)), k % 2 === 0 ? -2.6 : 2.6]; };
  const _t = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
  function update(dt, t) {
    for (const tr of traffic) {
      for (let k = 0; k < 24; k++) { const f = (tr.phase[k] + t * 0.012 * (0.8 + (k % 3) * 0.1)) % 1; const x = tr.dir > 0 ? tr.x0 + f * tr.len : tr.x0 + (1 - f) * tr.len; tr.im.setMatrixAt(k, _t.compose(_p.set(x, tr.dy + 1.1, tr.lane), _q, _s)); }
      tr.im.instanceMatrix.needsUpdate = true;
    }
  }
  return {
    kind: 'circuit', C, LEVEL, NL, LV, LEVELS, levelLen, TARGET_LAP, startLightMats, crowdSpots, tvCams, curbAt,
    walls, gridSlot, update, start: new THREE.Vector3(TX[0], 0, TZ[0]),
    ground: null,
  };
}
