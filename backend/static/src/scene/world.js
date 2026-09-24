import * as THREE from "three";
import { clamp, lerp } from "../utils.js";
import { addOutline, makeTextLabelMesh, makeLabel } from "./labels.js";
import { FlowDots, makeFlowTube, FLOW_COLORS } from "./flows.js";

//Builds the full 3D world for terrain, buildings, power assets, flows
export function createWorld(ctx, hover, registries){
  const { scene } = ctx;
  const { registerHover } = hover;
  const { waterMeshes, glowMats } = registries;
  let hydroGlowAnchors = null;

// Layout 
const LAYOUT = {
  house:        { x: -4,  z: -18 },
  windCollector:{ x:  4,  z: 17 },
  factory:      { x: -26, z: -2 },
  substation:   { x: -14, z: 1 },
  hospital:     { x:  20, z: 1 }
};


  //Procedural terrain alpine like  with vertex colors
  function hash2(x, z){

    const s = Math.sin(x*127.1 + z*311.7) * 43758.5453123;
    return s - Math.floor(s);
  }

  function smoothstep(t){ return t*t*(3-2*t); }

  function valueNoise(x, z){
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const x1 = x0 + 1, z1 = z0 + 1;
    const sx = smoothstep(x - x0);
    const sz = smoothstep(z - z0);
    const n00 = hash2(x0, z0);
    const n10 = hash2(x1, z0);
    const n01 = hash2(x0, z1);
    const n11 = hash2(x1, z1);
    const ix0 = lerp(n00, n10, sx);
    const ix1 = lerp(n01, n11, sx);
    return lerp(ix0, ix1, sz);
  }

  function fbm(x, z){
    let v = 0, a = 0.5, f = 0.08;
    for (let i=0;i<5;i++){
      v += a * valueNoise(x*f, z*f);
      a *= 0.55;
      f *= 2.1;
    }
    return v;
  }

  function makeTerrain(){
    const size = 78;              // close to slab (80) so Alps reach the rim
    const half = size * 0.5;
    const seg = 120;

    let geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI/2);
    geo = geo.toNonIndexed();     // crisp low-poly shading

    const pos = geo.attributes.position;
    const colors = [];
    const c = new THREE.Color();

    // Match the actual turbine positions so peaks appear under turbines
    const turbinePeaks = [
      { x:-30, z:34, amp:3.2, rad:12 },
      { x:-12, z:32, amp:3.0, rad:12 },
      { x:  6, z:34, amp:2.8, rad:12 },
    ];

    for (let i=0;i<pos.count;i++){
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // Alps should sit mainly on the BACK/LEFT rim (Carinthia diorama look)
      const backness = clamp(z / half, 0, 1);               // 0 front, 1 back
      const leftness = clamp((-x + 2) / (half + 2), 0, 1);  // 1 left, 0 right

      const n  = fbm(x, z);
      const n2 = fbm(x + 40, z - 20);

      // Rim masks: push height to the border and keep interior flatter
      const rimBand = clamp((Math.max(Math.abs(x), Math.abs(z)) - (half - 16)) / 16, 0, 1);
      const backWall = clamp((z - (half - 18)) / 18, 0, 1);

      // Mountain mask: strong on back-left rim, weak in interior/right
      let ridge = Math.pow(backness, 1.9) * (0.25 + 0.75 * Math.pow(leftness, 1.15));
      ridge = clamp(ridge + 0.55 * Math.pow(rimBand, 2.2) + 0.55 * Math.pow(backWall, 2.0), 0, 1);

      // Main height field
      let y = (n * 9.5 + n2 * 6.0) * ridge;

      // Extra lift in a narrow back band (keeps the ridge on the rim)
      y += Math.pow(backWall, 1.7) * (2.2 + n * 1.0);

      // Turbine peaks (so turbines are always on "alps")
      for (const peak of turbinePeaks){
        const dx = x - peak.x;
        const dz = z - peak.z;
        const d2 = dx*dx + dz*dz;
        const r2 = peak.rad * peak.rad;
        if (d2 < r2){
          const falloff = Math.exp(-d2 / (r2 * 0.6));
          y += peak.amp * falloff;
        }
      }

      // Central valley channel
      const valley = Math.exp(-Math.pow((x * 0.06), 2)) * (1.0 - ridge * 0.75);
      const valleyScale = lerp(2.0, 0.9, ridge);
      y -= valley * valleyScale;

      // Small rolling hills in the flatter area
      y += (1.0 - ridge) * (n * 1.35);

      // Edge uplift so alps sit on the border 
      const edgeStart = half - 14;  // last ~14 units
      const edgeWall = clamp((Math.max(Math.abs(x), Math.abs(z)) - edgeStart) / 14, 0, 1);
      y += Math.pow(edgeWall, 1.8) * (1.6 + ridge * 2.0);

      // Avoid negative pits
      y = Math.max(y, -0.65);

      pos.setY(i, y);

      // Vertex color by height
      if (y < 1.2){
        c.set("#3ddc84"); // valley green
      } else if (y < 5.5){
        c.set("#25b56a"); // hillside
      } else if (y < 9.5){
        c.set("#8ea3a5"); // rock
      } else {
        c.set("#f2f6f7"); // snow
      }
      colors.push(c.r, c.g, c.b);
    }

    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: true,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return { mesh, geo };
  }

  // Terrain base slab
  function makeBase(){
    const g = new THREE.Group();

    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(80, 2.2, 80),
      new THREE.MeshStandardMaterial({ color:"#2fbf72", roughness:0.95, metalness:0.0 })
    );
    slab.position.y = -1.1;
    slab.receiveShadow = true;
    slab.castShadow = true;
    g.add(slab);

  
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(82, 0.6, 82),
      new THREE.MeshStandardMaterial({ color:"#1a8f53", roughness:0.95 })
    );
    rim.position.y = -2.0;
    rim.receiveShadow = true;
    g.add(rim);

    return g;
  }

  function chaikinSmoothClosed(points, iterations = 2){
    let pts = points.map(p => ({ x: p.x, z: p.z }));
    for (let it = 0; it < iterations; it++){
      const out = [];
      for (let i = 0; i < pts.length; i++){
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        out.push({ x: 0.75 * a.x + 0.25 * b.x, z: 0.75 * a.z + 0.25 * b.z });
        out.push({ x: 0.25 * a.x + 0.75 * b.x, z: 0.25 * a.z + 0.75 * b.z });
      }
      pts = out;
    }
    return pts;
  }

  //Lakes and shoreline
 
  function polygonAreaXZ(pts){
  
    let a = 0;
    for (let i=0, j=pts.length-1; i<pts.length; j=i++){
      a += (pts[j].x * pts[i].z) - (pts[i].x * pts[j].z);
    }
    return a * 0.5;
  }

  function makeShoreRibbon(points, waterY, terrainHeightAt, opts={}){
    if (!points || points.length < 3) return null;
 
    const pts = points.slice();
    const last = pts[pts.length-1];
    if (last.x === pts[0].x && last.z === pts[0].z) pts.pop();
    if (pts.length < 3) return null;

    const innerOffset = opts.innerOffset ?? -0.12; 
    const outerOffset = opts.outerOffset ?? 1.05;
    const lift = opts.lift ?? 0.03;

   
    const maxRise = opts.maxRise ?? 0.45;
    const maxDrop = opts.maxDrop ?? 0.75;

    const color = opts.color ?? "#c5bdac";

    // polygon orientation 
    let area = 0;
    for (let i=0,j=pts.length-1;i<pts.length;j=i++){
      area += (pts[j].x * pts[i].z) - (pts[i].x * pts[j].z);
    }
    const ccw = area > 0;

    const N = pts.length;
    const positions = new Float32Array(N * 4 * 3);
    const indices = [];

    for (let i=0; i<N; i++){
      const a = pts[i];
      const b = pts[(i+1) % N];

      // edge direction
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const dl = Math.hypot(dx, dz) || 1e-6;
      dx /= dl; dz /= dl;

      // outward normal from right normal for CCW
      const nx = ccw ? dz : -dz;
      const nz = ccw ? -dx : dx;

      const inAx = a.x + nx * innerOffset;
      const inAz = a.z + nz * innerOffset;
      const outAx = a.x + nx * outerOffset;
      const outAz = a.z + nz * outerOffset;

      const inBx = b.x + nx * innerOffset;
      const inBz = b.z + nz * innerOffset;
      const outBx = b.x + nx * outerOffset;
      const outBz = b.z + nz * outerOffset;

      const h = (x,z) => (typeof terrainHeightAt === "function") ? terrainHeightAt(x,z) : waterY;

      const inAy = clamp(h(inAx, inAz), waterY - maxDrop, waterY + maxRise) + lift;
      const outAy = clamp(h(outAx, outAz), waterY - maxDrop, waterY + maxRise) + lift;
      const inBy = clamp(h(inBx, inBz), waterY - maxDrop, waterY + maxRise) + lift;
      const outBy = clamp(h(outBx, outBz), waterY - maxDrop, waterY + maxRise) + lift;

      // 4 verts per segment: inA, outA, inB, outB
      const base = i * 12;

      positions[base + 0] = inAx;  positions[base + 1] = inAy;  positions[base + 2] = inAz;
      positions[base + 3] = outAx; positions[base + 4] = outAy; positions[base + 5] = outAz;
      positions[base + 6] = inBx;  positions[base + 7] = inBy;  positions[base + 8] = inBz;
      positions[base + 9] = outBx; positions[base +10] = outBy;  positions[base +11] = outBz;

      const vi = i * 4;
      indices.push(vi+0, vi+1, vi+2,  vi+1, vi+3, vi+2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });

    const sand = new THREE.Mesh(geo, mat);
    sand.castShadow = false;
    sand.receiveShadow = true;
    sand.renderOrder = 4; 
    return sand;
  }

  function shapeLake(points){
    const s = new THREE.Shape();
    s.moveTo(points[0].x, points[0].z);
    for (let i=1;i<points.length;i++) s.lineTo(points[i].x, points[i].z);
    s.closePath();

    // store footprint for shoreline ribbon
    s.userData = { points: points.map(p => ({x:p.x, z:p.z})) };
    return s;
  }

  let cachedWaterNormal = null;
  function makeWaterNormalTexture(){
    if (cachedWaterNormal) return cachedWaterNormal;
    const size = 64;
    const heights = new Float32Array(size * size);
    const data = new Uint8Array(size * size * 3);

    const heightAt = (x, z) => {
      const nx = (x / size) * Math.PI * 2;
      const nz = (z / size) * Math.PI * 2;
      return (
        Math.sin(nx * 2.2) * 0.45 +
        Math.cos(nz * 1.6) * 0.35 +
        Math.sin((nx + nz) * 1.3) * 0.25
      );
    };

    for (let z = 0; z < size; z++){
      for (let x = 0; x < size; x++){
        heights[z * size + x] = heightAt(x, z);
      }
    }

    const scale = 0.9;
    for (let z = 0; z < size; z++){
      for (let x = 0; x < size; x++){
        const xl = (x - 1 + size) % size;
        const xr = (x + 1) % size;
        const zd = (z - 1 + size) % size;
        const zu = (z + 1) % size;

        const hL = heights[z * size + xl];
        const hR = heights[z * size + xr];
        const hD = heights[zd * size + x];
        const hU = heights[zu * size + x];

        const dx = (hR - hL) * scale;
        const dz = (hU - hD) * scale;

        let nx = -dx;
        let ny = 1.0;
        let nz = -dz;
        const invLen = 1.0 / Math.hypot(nx, ny, nz);
        nx *= invLen; ny *= invLen; nz *= invLen;

        const i = (z * size + x) * 3;
        data[i + 0] = Math.floor((nx * 0.5 + 0.5) * 255);
        data[i + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
        data[i + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    cachedWaterNormal = tex;
    return tex;
  }

  function makeLake(shape, y, colorOrOpts="#2b78ff", opacity=0.92, terrainHeightAt){
    const opts = (colorOrOpts && typeof colorOrOpts === "object") ? colorOrOpts : {};
    const color = (typeof colorOrOpts === "string") ? colorOrOpts : (opts.color ?? "#2b78ff");
    const useOpacity = (typeof colorOrOpts === "object") ? (opts.opacity ?? 0.92) : opacity;
    // water
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI/2);

    const mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.10,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      transparent: true,
      opacity: useOpacity,
      depthWrite: false
    });
    const normalTex = makeWaterNormalTexture().clone();
    normalTex.wrapS = THREE.RepeatWrapping;
    normalTex.wrapT = THREE.RepeatWrapping;
    normalTex.repeat.set(3.5, 3.5);
    normalTex.needsUpdate = true;
    mat.normalMap = normalTex;
    mat.normalScale = new THREE.Vector2(0.28, 0.28);

    // Shoreline tint: shallower = lighter/greener, deeper = bluer.
    const pts = shape?.userData?.points || [];
    const shallowColor = opts.shallowColor ?? null;
    const deepColor = opts.deepColor ?? null;
    const shoreBlend = opts.shoreBlend ?? 2.6;
    if (pts.length && shallowColor && deepColor){
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const cShallow = new THREE.Color(shallowColor);
      const cDeep = new THREE.Color(deepColor);

      const distToSeg = (px,pz, ax,az, bx,bz)=>{
        const abx = bx-ax, abz = bz-az;
        const apx = px-ax, apz = pz-az;
        const ab2 = abx*abx + abz*abz || 1e-6;
        let t = (apx*abx + apz*abz) / ab2;
        t = clamp(t, 0, 1);
        const cx = ax + abx*t, cz = az + abz*t;
        const dx = px - cx, dz = pz - cz;
        return Math.sqrt(dx*dx + dz*dz);
      };
      const distToPolyEdge = (x,z)=>{
        let d = Infinity;
        for (let i=0;i<pts.length;i++){
          const j = (i+1) % pts.length;
          d = Math.min(d, distToSeg(x,z, pts[i].x, pts[i].z, pts[j].x, pts[j].z));
        }
        return d;
      };

      for (let i=0;i<pos.count;i++){
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const d = distToPolyEdge(x, z);
        const t = clamp(d / shoreBlend, 0, 1);
        const c = cShallow.clone().lerp(cDeep, t);
        const idx = i * 3;
        colors[idx] = c.r;
        colors[idx + 1] = c.g;
        colors[idx + 2] = c.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      mat.vertexColors = true;
      mat.needsUpdate = true;
    }

    const water = new THREE.Mesh(geo, mat);
    water.position.y = y;
    water.receiveShadow = false;
    water.renderOrder = 2;
    water.userData.waterScroll = new THREE.Vector2(0.015, 0.008);

    // shoreline ribbon 
    const sand = makeShoreRibbon(pts, y, terrainHeightAt, {
      innerOffset: -0.08,
      outerOffset: 0.95,
      lift: 0.03,
      maxRise: 0.30,
      maxDrop: 0.55,
      color: "#e8d8b8"
    });

    return { water, sand };
  }

  // Shore stones along lake edge
  function makeShoreStones(points, waterY, terrainHeightAt, count = 220){
    if (!points?.length) return null;

    const g = new THREE.Group();
    const geo = new THREE.DodecahedronGeometry(0.18, 0);
    const mat = new THREE.MeshStandardMaterial({
      color:"#a7a399", roughness:0.95, metalness:0.05, flatShading:true
    });

    // polygon orientation
    const ccw = polygonAreaXZ(points) > 0;

    
    const inPoly = (x,z)=>{
      let inside = false;
      for (let i=0,j=points.length-1;i<points.length;j=i++){
        const xi = points[i].x, zi = points[i].z;
        const xj = points[j].x, zj = points[j].z;
        const intersect = ((zi > z) !== (zj > z)) &&
          (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-6) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    for (let i=0;i<count;i++){
      const a = points[i % points.length];
      const b = points[(i+1) % points.length];

      // edge tangent
      let dx = b.x - a.x, dz = b.z - a.z;
      const dl = Math.hypot(dx, dz) || 1e-6;
      dx /= dl; dz /= dl;

      // outward normal
      const nx = ccw ? dz : -dz;
      const nz = ccw ? -dx : dx;

      // base point along edge
      const t = Math.random();
      let x = a.x + (b.x - a.x) * t;
      let z = a.z + (b.z - a.z) * t;

      // push outward and  small along-shore jitter
      const outward = 0.25 + Math.random() * 0.95;
      const along   = (Math.random()*2 - 1) * 0.35;
      x += nx * outward + dx * along;
      z += nz * outward + dz * along;

      // ensure outside lake
      if (inPoly(x,z)){
        x -= nx * outward * 2.0;
        z -= nz * outward * 2.0;
      }

      const groundY = terrainHeightAt ? terrainHeightAt(x, z) : waterY;
      const y = Math.max(groundY, waterY) + 0.05;

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(Math.random()*0.35, Math.random()*Math.PI*2, Math.random()*0.25);
      mesh.scale.setScalar(0.55 + Math.random()*0.7);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }

    return g;
  }

  //Trees
  function makeTrees(terrainGeo, {
    lakePolys = [],
    lakeY = null,
    lakePad = 3.0,
    excludeBoxes = []
  } = {}){
    const trees = new THREE.Group();

    const trunkGeo = new THREE.CylinderGeometry(0.08, 0.10, 0.7, 6);
    const crownGeo = new THREE.ConeGeometry(0.42, 1.25, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color:"#6b3f2b", roughness:0.95 });
    const crownMat = new THREE.MeshStandardMaterial({ color:"#1aa45f", roughness:0.98, flatShading:true });

    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, 650);
    const crown = new THREE.InstancedMesh(crownGeo, crownMat, 650);
    trunk.castShadow = true;
    crown.castShadow = true;

    const pos = terrainGeo.attributes.position;
   
    const dummy = new THREE.Object3D();
    let count = 0;

    
    const LAKE_POLYS = lakePolys;
    const LAKE_BOXES = LAKE_POLYS.map(p => bboxFromPoints(p, lakePad)); 
   
    const leftLakeClear  = { minX: 9999, maxX: 10000, minZ: 9999, maxZ: 10000 };
    const rightLakeClear = { minX: 9999, maxX: 10000, minZ: 9999, maxZ: 10000 };

    const EXCLUDE_BOXES = excludeBoxes;
    const inExclude = (x,z)=> EXCLUDE_BOXES.some(b => inBox(x,z,b));

    function inBox(x,z,b){ return x>=b.minX && x<=b.maxX && z>=b.minZ && z<=b.maxZ; }
    function inPoly(x,z,poly){
      let inside = false;
      for (let i=0,j=poly.length-1;i<poly.length;j=i++){
        const xi = poly[i].x, zi = poly[i].z;
        const xj = poly[j].x, zj = poly[j].z;
        const intersect = ((zi > z) !== (zj > z)) &&
          (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-6) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }
    const inLake = (x,z)=> {
      for (let i=0;i<LAKE_POLYS.length;i++){
        const box = LAKE_BOXES[i];
        if (!(x>=box.minX && x<=box.maxX && z>=box.minZ && z<=box.maxZ)) continue;
        if (inPoly(x,z, LAKE_POLYS[i])) return true;
      }
      return false;
    };
    const distToLakeEdge = (x,z)=>{
      let best = Infinity;
      for (const poly of LAKE_POLYS){
        for (let i=0;i<poly.length;i++){
          const a = poly[i];
          const b = poly[(i+1)%poly.length];
          const abx = b.x - a.x, abz = b.z - a.z;
          const apx = x - a.x, apz = z - a.z;
          const ab2 = abx*abx + abz*abz || 1e-6;
          let t = (apx*abx + apz*abz) / ab2;
          t = clamp(t, 0, 1);
          const cx = a.x + abx*t, cz = a.z + abz*t;
          const dx = x - cx, dz = z - cz;
          const d2 = dx*dx + dz*dz;
          if (d2 < best) best = d2;
        }
      }
      return Math.sqrt(best);
    };
    const inLeftLakeClear = (x,z)=> inBox(x,z, leftLakeClear);
    const inRightLakeClear = (x,z)=> inBox(x,z, rightLakeClear);

    for (let i=0;i<pos.count && count<trunk.count;i+=3){
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);

      // skip lakes AND  flat valley center corridor
      if (inLake(x,z) || inLeftLakeClear(x,z) || inRightLakeClear(x,z) || inExclude(x,z)) continue;
      if (lakeY !== null && y <= lakeY + 0.05) continue; 
      if (Math.abs(x) < 4 && z < 10) continue;

      
      if (y < 0.6 || y > 6.8) continue;

      // random thinning (denser near lake edge)
      const nearLake = distToLakeEdge(x,z) < 6 && !inLake(x,z);
      const keepProb = nearLake ? 0.55 : 0.22;
      if (Math.random() > keepProb) continue;

      const s = 0.75 + Math.random()*0.75;
      const px = x + (Math.random()-0.5)*0.4;
      const pz = z + (Math.random()-0.5)*0.4;
      if (inLake(px,pz) || inLeftLakeClear(px,pz) || inRightLakeClear(px,pz) || inExclude(px,pz)) continue;
      if (lakeY !== null && y <= lakeY + 0.05) continue;
      dummy.position.set(px, y + 0.08, pz);
      dummy.rotation.y = Math.random()*Math.PI*2;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      trunk.setMatrixAt(count, dummy.matrix);

      dummy.position.y += 0.95*s;
      dummy.updateMatrix();
      crown.setMatrixAt(count, dummy.matrix);

      count++;
    }

    trunk.count = count;
    crown.count = count;

    trees.add(trunk, crown);
    return trees;
  }

  // Clouds
  function makeClouds(){
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color:"#d8dbe0", roughness:0.98, flatShading:true });

    for (let i=0;i<7;i++){
      const c = new THREE.Group();
      const parts = 6 + Math.floor(Math.random()*6);
      for (let p=0;p<parts;p++){
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2 + Math.random()*1.2), mat);
        m.position.set((Math.random()-0.5)*4.5, (Math.random()-0.5)*1.2, (Math.random()-0.5)*3.0);
        m.castShadow = true;
        c.add(m);
      }
      c.position.set(-25 + Math.random()*50, 30 + Math.random()*12, -25 + Math.random()*50);
      c.scale.setScalar(1.6 + Math.random()*1.2);
      c.userData.speed = 0.3 + Math.random()*0.4;
      g.add(c);
    }
    return g;
  }

  // Wind turbine
  function makeWindTurbine(){
    const g = new THREE.Group();

    const plinthMat = new THREE.MeshStandardMaterial({ color:"#c7cdd6", roughness:0.92 });
    const towerMat  = new THREE.MeshStandardMaterial({ color:"#eef2f6", roughness:0.58, metalness:0.08 });
    const detailMat = new THREE.MeshStandardMaterial({ color:"#d5dbe4", roughness:0.65, metalness:0.10 });

    //concrete plinth
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.75, 1.2, 8),
      plinthMat
    );
    plinth.position.y = 0.6;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    g.add(plinth);

    //tapered tower
    const TOWER_H = 16.0;
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.42, TOWER_H, 26),
      towerMat
    );
    // bottom of tower
    tower.position.y = 1.2 + TOWER_H * 0.5;
    tower.castShadow = true;
    tower.receiveShadow = true;
    g.add(tower);

    //yaw bearing ring
    const yawRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.18, 24),
      detailMat
    );
    yawRing.position.y = 1.2 + TOWER_H + 0.09;
    yawRing.castShadow = true;
    g.add(yawRing);

    // Hub (top) height in local space
    const HUB_Y = 1.2 + TOWER_H;

 
    const yaw = new THREE.Group();
    yaw.position.y = HUB_Y;
    g.add(yaw);


    const nacelle = new THREE.Group();

    const nacBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 1.9, 18, 1, false),
      towerMat
    );
    nacBody.rotation.z = Math.PI / 2;   
    nacBody.position.set(0.90, 0.25, 0);
    nacBody.castShadow = true;
    nacelle.add(nacBody);

    const nacCapF = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 18), towerMat);
    nacCapF.position.set(1.85, 0.25, 0);
    nacCapF.castShadow = true;
    nacelle.add(nacCapF);

    const nacCapB = nacCapF.clone();
    nacCapB.position.set(-0.05, 0.25, 0);
    nacelle.add(nacCapB);

    // Tail fin
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.85), towerMat);
    fin.position.set(-0.48, 0.55, 0);
    fin.castShadow = true;
    nacelle.add(fin);

    yaw.add(nacelle);

    //rotor group at front
    const rotor = new THREE.Group();
    rotor.position.set(2.05, 0.25, 0);
    yaw.add(rotor);

    // Hub AND  spinner 
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 18), towerMat);
    hub.castShadow = true;
    rotor.add(hub);

    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.75, 20), towerMat);
    spinner.rotation.z = -Math.PI / 2; 
    spinner.position.x = 0.55;
    spinner.castShadow = true;
    rotor.add(spinner);

    //blades (length along Y, distributed around X axis)
    const L = 6.0;

    // Width (X), Length (Y), Thickness (Z)
    const bladeGeo = new THREE.BoxGeometry(0.55, L, 0.12, 1, 26, 1);

    // Root at y=0, tip at y=L
    bladeGeo.translate(0, L * 0.5, 0);

    // Taper; twist and camber
    const p = bladeGeo.attributes.position;
    for (let i = 0; i < p.count; i++){
      const y = p.getY(i);
      const t = clamp(y / L, 0, 1);

      // taper chord + thickness
      let x = p.getX(i) * lerp(1.00, 0.28, t);  
      let z = p.getZ(i) * lerp(1.00, 0.18, t);  

      // gentle camber for slight curve
      x += Math.sin(t * Math.PI) * 0.06;

      // twist around blade axis (Y)
      const ang = lerp(0.42, 0.10, t);          
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const x2 = x * ca - z * sa;
      const z2 = x * sa + z * ca;
      x = x2; z = z2;

      p.setX(i, x);
      p.setZ(i, z);
    }
    bladeGeo.computeVertexNormals();

    
    const bladeMat = new THREE.MeshStandardMaterial({
      color: "#f5f7fb",
      roughness: 0.70,
      metalness: 0.02,
      emissive: "#000000",
      emissiveIntensity: 0.0
    });

    for (let i = 0; i < 3; i++){
      const b = new THREE.Mesh(bladeGeo, bladeMat);
      // root slightly forward into the hub
      b.position.x = 0.08;
      // distribute blades around rotor axis (X)
      b.rotation.x = (i * Math.PI * 2) / 3;
      b.castShadow = true;
      rotor.add(b);
    }

    // store refs for animation
    g.userData.rotor = rotor;
    g.userData.yaw = yaw;

    return g;
  }

  //House
  function makeHouse(){
    const g = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(5.0, 3.6, 4.0),
      new THREE.MeshStandardMaterial({ color:"#f1f3f4", roughness:0.9 })
    );
    body.position.y = 1.8;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // gable roof
    const roofMat = new THREE.MeshStandardMaterial({ color:"#9a5b3a", roughness:0.9 });
    const roof1 = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.25, 2.5), roofMat);
    roof1.position.set(0, 3.7, 0.9);
    roof1.rotation.x = -0.55;
    roof1.castShadow = true;
    g.add(roof1);

    const roof2 = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.25, 2.5), roofMat);
    roof2.position.set(0, 3.7, -0.9);
    roof2.rotation.x = 0.55;
    roof2.castShadow = true;
    g.add(roof2);

    // chimney
    const chim = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.2, 0.5),
      new THREE.MeshStandardMaterial({ color:"#7b4b35", roughness:0.95 })
    );
    chim.position.set(1.4, 4.2, -0.6);
    chim.castShadow = true;
    g.add(chim);

    // windows glow
    const winMat = new THREE.MeshStandardMaterial({ color:"#ffe7a6", emissive:"#ffd36b", emissiveIntensity:1.0, roughness:0.5 });
    glowMats.push(winMat);
    const w1 = new THREE.Mesh(new THREE.BoxGeometry(0.65,0.85,0.05), winMat);
    w1.position.set(-1.4, 2.1, 2.02);
    g.add(w1);
    const w2 = w1.clone(); w2.position.set(1.4, 2.1, 2.02); g.add(w2);
    const w3 = w1.clone(); w3.position.set(-1.4, 1.2, 2.02); g.add(w3);

    // small porch/bulb to show service power
    const bulbMat = new THREE.MeshStandardMaterial({
      color:"#fff7d1",
      emissive:"#ffef9a",
      emissiveIntensity:0.12,
      roughness:0.35,
      metalness:0.05
    });
    glowMats.push(bulbMat);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), bulbMat);
    bulb.position.set(2.2, 2.4, -2.0); 
    bulb.castShadow = true;
    g.add(bulb);

    g.userData.windowMats = [winMat];
    g.userData.bulbMat = bulbMat;
    return g;
  }
 //HOSPITAL
  function makeHospital(){
    const g = new THREE.Group();

    const baseMat = new THREE.MeshStandardMaterial({ color:"#f5f6f7", roughness:0.86 });
    const wingMat = new THREE.MeshStandardMaterial({ color:"#eef1f3", roughness:0.86 });

    const main = new THREE.Mesh(new THREE.BoxGeometry(10.0, 4.2, 6.0), baseMat);
    main.position.y = 2.1;
    main.castShadow = true; main.receiveShadow = true;
    g.add(main);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(7.0, 3.6, 5.0), wingMat);
    wing.position.set(-4.9, 1.8, -3.0);
    wing.castShadow = true; wing.receiveShadow = true;
    g.add(wing);

    // windows emissive
    const winMat = new THREE.MeshStandardMaterial({ color:"#ffe7a6", emissive:"#ffd36b", emissiveIntensity:1.0, roughness:0.5 });
    glowMats.push(winMat);
    for (let i=0;i<6;i++){
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.9,0.06), winMat);
      w.position.set(-3.5 + i*1.2, 2.1, 3.03);
      g.add(w);
    }

    // medical cross (front)
    const crossMat = new THREE.MeshStandardMaterial({ color:"#ffffff", emissive:"#ffffff", emissiveIntensity:0.9 });
    glowMats.push(crossMat);
    const h = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.12), crossMat);
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.12), crossMat);
    h.position.set(3.4, 2.6, 3.05);
    v.position.set(3.4, 2.6, 3.05);
    g.add(h, v);

    // outline glow strips
    const glowMat = new THREE.MeshBasicMaterial({ color:"#bff9ff", transparent:true, opacity:0.50 });
    const stripH = new THREE.BoxGeometry(10.35, 0.10, 0.10);
    const stripV = new THREE.BoxGeometry(0.10, 0.10, 6.35);
    const s1 = new THREE.Mesh(stripH, glowMat); s1.position.set(0, 4.25, 3.05); g.add(s1);
    const s2 = new THREE.Mesh(stripH, glowMat); s2.position.set(0, 4.25,-3.05); g.add(s2);
    const s3 = new THREE.Mesh(stripV, glowMat); s3.position.set( 5.02, 4.25, 0);  g.add(s3);
    const s4 = new THREE.Mesh(stripV, glowMat); s4.position.set(-5.02, 4.25, 0);  g.add(s4);
   

    g.userData.glowMat = glowMat;
    g.userData.winMat = winMat;
    return g;
  }

  function makeMeterPole(){
    const g = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({ color:"#9da3ac", roughness:0.85 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.14,4.6,12), poleMat);
    pole.position.y = 2.3;
    pole.castShadow = true;
    g.add(pole);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6,0.12,0.14), poleMat);
    arm.position.set(0, 4.2, 0);
    arm.castShadow = true;
    g.add(arm);

    // meter box
    const meterMat = new THREE.MeshStandardMaterial({ color:"#e9edf3", roughness:0.4, metalness:0.15, emissive:"#c7d2e3", emissiveIntensity:0.08 });
    const meter = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.75,0.25), meterMat);
    meter.position.set(0.28, 1.5, 0.0);
    meter.castShadow = true;
    g.add(meter);

    // simple insulators
    const insMat = new THREE.MeshStandardMaterial({ color:"#f7fafc", roughness:0.3 });
    for (let i=-1;i<=1;i++){
      const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,0.20,10), insMat);
      ins.position.set(i*0.55, 4.2, 0);
      g.add(ins);
    }

    g.userData.meterMat = meterMat;
    return g;
  }

  function makePowerStation(){
    const g = new THREE.Group();

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(11.5, 3.5, 7.0),
      new THREE.MeshStandardMaterial({ color:"#8a8f98", roughness:0.9 })
    );
    base.position.y = 1.75;
    base.castShadow = true; base.receiveShadow = true;
    g.add(base);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(12.0, 0.35, 7.5),
      new THREE.MeshStandardMaterial({ color:"#727880", roughness:0.95 })
    );
    roof.position.y = 3.6;
    roof.castShadow = true;
    g.add(roof);

    // tall stacks
    const stackMat = new THREE.MeshStandardMaterial({ color:"#5b6068", roughness:0.85 });
    const stacks = [];
    for (let i=0;i<2;i++){
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 10.5, 18), stackMat);
      st.position.set(-2.0 + i*4.0, 8.2, -1.2);
      st.castShadow = true;
      g.add(st);

      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.6, 18), stackMat);
      cap.position.set(st.position.x, 13.65, st.position.z);
      g.add(cap);
      stacks.push(st);
    }

    // warning beacons
    const beaconMat = new THREE.MeshStandardMaterial({ color:"#ffefe2", emissive:"#ffcf73", emissiveIntensity:1.2 });
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), beaconMat);
    b.position.set(5.0, 3.9, 3.0);
    g.add(b);

    // smoke puffs
    const smokeMat = new THREE.MeshStandardMaterial({ color:"#cfd3d8", roughness:0.98, transparent:true, opacity:0.85 });
    const smokes = [];
    for (let s=0;s<12;s++){
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.55 + Math.random()*0.25, 10, 10), smokeMat);
      puff.position.set(stacks[s%2].position.x, 14.2 + s*0.35, stacks[s%2].position.z);
      puff.userData.baseY = puff.position.y;
      puff.userData.phase = Math.random()*Math.PI*2;
      puff.castShadow = true;
      g.add(puff);
      smokes.push(puff);
    }

    g.userData.beaconMat = beaconMat;
    g.userData.smokes = smokes;
    return g;
  }

// Hydro dam AND  river
  function makeHydroDamAndRiver(){
    const g = new THREE.Group();
 
    g.position.y = 3.5;

    // cool concrete tones to match the reference dam style
    const concrete = new THREE.MeshStandardMaterial({ color:"#d5d7dc", roughness:0.85, metalness:0.02 });
    const concreteDark = new THREE.MeshStandardMaterial({ color:"#b9bdc4", roughness:0.9, metalness:0.02 });
    const bayShadow = new THREE.MeshStandardMaterial({ color:"#7c8794", roughness:0.98, metalness:0.0 });

    const damWidth = 14.0;
    const damHeight = 7.0;
    const damDepth = 3.6;
    const damCenter = new THREE.Vector3(-20, 2.9, 18.0);

    // main wall
    const damCore = new THREE.Mesh(new THREE.BoxGeometry(damWidth, damHeight, damDepth), concrete);
    damCore.position.copy(damCenter);
    damCore.castShadow = true;
    damCore.receiveShadow = true;
    g.add(damCore);

    // sloped spillway face
    const face = new THREE.Mesh(new THREE.BoxGeometry(damWidth + 0.6, damHeight, 1.2), concreteDark);
    face.position.set(damCenter.x, damCenter.y - 0.2, damCenter.z + 1.5);
    face.rotation.x = -0.30;
    face.castShadow = true;
    face.receiveShadow = true;
    g.add(face);

    // side pylons
    const pylonGeo = new THREE.BoxGeometry(1.8, 8.4, 4.0);
    const pylonL = new THREE.Mesh(pylonGeo, concreteDark);
    pylonL.position.set(damCenter.x - 6.5, damCenter.y + 1.2, damCenter.z);
    pylonL.castShadow = true;
    pylonL.receiveShadow = true;
    g.add(pylonL);
    const pylonR = pylonL.clone();
    pylonR.position.x = damCenter.x + 6.5;
    g.add(pylonR);

    // crest deck and  control huts
    const deck = new THREE.Mesh(new THREE.BoxGeometry(damWidth + 0.8, 0.4, 3.0), concrete);
    deck.position.set(damCenter.x, damCenter.y + 3.6, damCenter.z - 0.1);
    deck.castShadow = true;
    deck.receiveShadow = true;
    g.add(deck);

    const ctrlGeo = new THREE.BoxGeometry(1.6, 1.2, 1.8);
    const ctrlL = new THREE.Mesh(ctrlGeo, concreteDark);
    ctrlL.position.set(damCenter.x - 5.8, damCenter.y + 4.6, damCenter.z - 0.2);
    ctrlL.castShadow = true;
    g.add(ctrlL);
    const ctrlR = ctrlL.clone();
    ctrlR.position.x = damCenter.x + 5.8;
    g.add(ctrlR);

    // bay piers and  recesses
    const pierGeo = new THREE.BoxGeometry(0.9, 6.3, 3.2);
    for (let i=0;i<4;i++){
      const pier = new THREE.Mesh(pierGeo, concreteDark);
      pier.position.set(damCenter.x - 4.8 + i * 3.2, damCenter.y + 0.4, damCenter.z + 0.6);
      pier.castShadow = true;
      pier.receiveShadow = true;
      g.add(pier);
    }

    const bayGeo = new THREE.BoxGeometry(2.1, 4.8, 0.7);
    for (let i=0;i<3;i++){
      const bay = new THREE.Mesh(bayGeo, bayShadow);
      bay.position.set(damCenter.x - 3.2 + i * 3.2, damCenter.y + 0.1, damCenter.z + 1.1);
      bay.castShadow = false;
      bay.receiveShadow = false;
      g.add(bay);
    }

    // stepped spillway apron
    for (let s=0; s<4; s++){
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(damWidth - 2.4, 0.45, 1.3),
        concreteDark
      );
      step.position.set(damCenter.x, 1.2 - s * 0.35, 17.2 - s * 1.1);
      step.castShadow = true;
      step.receiveShadow = true;
      g.add(step);
    }

    // retaining slopes
    const slopeMat = new THREE.MeshStandardMaterial({ color:"#6ca06a", roughness:0.95, metalness:0.0 });
    const slopeL = new THREE.Mesh(new THREE.BoxGeometry(3.6, 4.4, 4.6), slopeMat);
    slopeL.position.set(-26.1, 2.0, 18.1);
    slopeL.rotation.y = 0.18;
    slopeL.castShadow = true; slopeL.receiveShadow = true;
    g.add(slopeL);
    const slopeR = slopeL.clone();
    slopeR.position.set(-13.9, 2.0, 18.1);
    slopeR.rotation.y = -0.18;
    g.add(slopeR);

    // powerhouse block
    const houseMat = new THREE.MeshStandardMaterial({ color:"#cfd3d9", roughness:0.9, metalness:0.02 });
    const houseBase = new THREE.Mesh(new THREE.BoxGeometry(6.2, 2.4, 4.8), houseMat);
    houseBase.position.set(-24.0, 1.5, 13.4);
    houseBase.castShadow = true; houseBase.receiveShadow = true;
    g.add(houseBase);
    const houseUpper = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.8, 3.2), houseMat);
    houseUpper.position.set(-23.6, 2.9, 13.0);
    houseUpper.castShadow = true; houseUpper.receiveShadow = true;
    g.add(houseUpper);

    // transformer/switchyard pad beside powerhouse
    const xfPad = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.25, 2.6), new THREE.MeshStandardMaterial({ color:"#cfd4db", roughness:0.9 }));
    xfPad.position.set(-22.0, 0.45, 12.4);
    xfPad.receiveShadow = true;
    g.add(xfPad);
    const transformer = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.6, 1.6),
      new THREE.MeshStandardMaterial({ color:"#aeb4bf", roughness:0.85, metalness:0.08 })
    );
    transformer.position.set(-22.0, 1.4, 12.4);
    transformer.castShadow = true; transformer.receiveShadow = true;
    g.add(transformer);
    const gridTie = new THREE.Object3D();
    gridTie.position.set(-22.0, 1.4, 12.4);
    g.add(gridTie);
    g.userData.gridTie = gridTie;

    // penstock feed highlight
    const penstock = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 4.2, 12),
      new THREE.MeshStandardMaterial({ color:"#7fb5ff", roughness:0.35, metalness:0.25 })
    );
    penstock.position.set(-22.8, 2.2, 16.2);
    penstock.rotation.set(Math.PI/2, 0.35, 0);
    penstock.castShadow = true;
    g.add(penstock);

    // tailrace splash pad
    const splash = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 26),
      new THREE.MeshBasicMaterial({ color:"#e4fbff", transparent:true, opacity:0.45, blending:THREE.AdditiveBlending, depthWrite:false })
    );
    splash.rotation.x = -Math.PI/2;
    splash.position.set(-20, 0.28, 14.4);
    g.add(splash);

    // small pool at base of spill
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(3.5, 32),
      new THREE.MeshPhysicalMaterial({
        color: "#2aa9a6",
        roughness: 0.12,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        transparent: true,
        opacity: 0.95,
        depthWrite: false
      })
    );
    pool.rotation.x = -Math.PI/2;
    pool.position.set(-20.0, 0.26, 14.4);
    g.add(pool);

    // world-space river will start from this marker 
    const outflow = new THREE.Object3D();
    outflow.position.set(-20.0, 3.6, 19.6);
    g.add(outflow);
    g.userData.outflow = outflow;

    // reservoir surface marker
    const reservoirLevel = new THREE.Object3D();
    reservoirLevel.position.set(-20.0, 4.05, 23.5); 
    g.add(reservoirLevel);
    g.userData.reservoirLevel = reservoirLevel;

    g.userData.foamMat = null;
    g.userData.whitewaterDots = null;

    // waterfall particles
    const fallGeom = new THREE.BufferGeometry();
    const N = 700;
    const fallPos = new Float32Array(N*3);
    const fallVel = new Float32Array(N);
    for (let i=0;i<N;i++){
      const x = -22.6 + Math.random()*4.6;
      const y = 3.6 - Math.random()*4.8;
      const z = 19.5 + Math.random()*0.7;
      fallPos[i*3+0]=x; fallPos[i*3+1]=y; fallPos[i*3+2]=z;
      fallVel[i] = 0.05 + Math.random()*0.08;
    }
    fallGeom.setAttribute("position", new THREE.BufferAttribute(fallPos,3));
    const fallMat = new THREE.PointsMaterial({
      color:"#c8f5ff",
      size:0.11,
      transparent:true,
      opacity:0.85,
      sizeAttenuation:true,
      depthWrite:false,
      blending:THREE.AdditiveBlending
    });
    const waterfall = new THREE.Points(fallGeom, fallMat);
    g.add(waterfall);

    // misty spray at base of falls
    const mistN = 120;
    const mistPos = new Float32Array(mistN*3);
    const mistGeo = new THREE.BufferGeometry();
    const mistPhase = new Float32Array(mistN);
    const mistBase = new Float32Array(mistN*3);
    for (let i=0;i<mistN;i++){
      mistPos[i*3+0] = -20 + (Math.random()-0.5)*2.2;
      mistPos[i*3+1] = 0.55 + Math.random()*1.8;
      mistPos[i*3+2] = 14.2 + (Math.random()-0.5)*2.0;
      mistBase[i*3+0] = mistPos[i*3+0];
      mistBase[i*3+1] = mistPos[i*3+1];
      mistBase[i*3+2] = mistPos[i*3+2];
      mistPhase[i] = Math.random()*Math.PI*2;
    }
    mistGeo.setAttribute("position", new THREE.BufferAttribute(mistPos,3));
    const mist = new THREE.Points(mistGeo, new THREE.PointsMaterial({
      color:"#d8f7ff",
      size:0.18,
      transparent:true,
      opacity:0.35,
      depthWrite:false,
      blending:THREE.AdditiveBlending
    }));
    g.add(mist);

    g.userData.waterfall = waterfall;
    g.userData.fallPos = fallPos;
    g.userData.fallN = N;
    g.userData.fallVel = fallVel;
    g.userData.fallMat = fallMat;
    g.userData.splash = splash;
    g.userData.mist = { points: mist, phase: mistPhase, geo: mistGeo, pos: mistPos, base: mistBase };
    return g;
  }

  //Grid poles and wires
  function makePole(){
    const pole = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color:"#a3a8b0", roughness:0.9 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.14,4.2,10), mat);
    post.position.y = 2.1;
    post.castShadow = true;
    pole.add(post);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.10, 0.10), mat);
    arm.position.set(0, 3.9, 0);
    arm.castShadow = true;
    pole.add(arm);

    const insMat = new THREE.MeshStandardMaterial({ color:"#dfe6ea", roughness:0.7 });
    for (let i=-1;i<=1;i++){
      const ins = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), insMat);
      ins.position.set(i*0.6, 3.9, 0);
      pole.add(ins);
    }
    return pole;
  }

  function tubeAlong(points, radius, color, opacity=1.0, dashed=false){
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, 80, radius, 8, false);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.9,
      metalness: 0.0,
      transparent: opacity < 1.0,
      opacity
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    return { mesh, curve };
  }

  function makeGridLine(houseObj, windCollectorObj){
    const g = new THREE.Group();

    // Route: wind collector to house transformer pole with 4 poles, bases sit on terrain
    const hx = houseObj.position.x, hz = houseObj.position.z;
    const cx = windCollectorObj.position.x, cz = windCollectorObj.position.z;

    const routeXZ = [
      {x: hx - 3.5, z: hz - 1.0},
      {x: hx - 6.0, z: hz + 5.5},
      {x: hx - 2.0, z: (hz + cz) * 0.5},
      {x: cx,       z: cz}
    ];
    const route = routeXZ.map(p => new THREE.Vector3(p.x, terrainHeightAt(p.x, p.z) + 0.05, p.z));


    // poles
    for (let i=0;i<route.length;i++){
      const p = makePole();
      p.position.copy(route[i]);
      g.add(p);
    }

    // small pole-top transformer beside house
    const txGroup = new THREE.Group();
    txGroup.position.copy(route[0]);
    txGroup.position.y += 3.5; 
    // drum body (vertical)
    const txBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 1.0, 16),
      new THREE.MeshStandardMaterial({ color:"#dfe4ec", roughness:0.65, metalness:0.12 })
    );
    txBody.castShadow = true;
    txGroup.add(txBody);
    // lid
    const txCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.08, 16),
      new THREE.MeshStandardMaterial({ color:"#c8cdd5", roughness:0.6 })
    );
    txCap.position.y = 0.54;
    txCap.castShadow = true;
    txGroup.add(txCap);
    // bushing insulators
    const insMat = new THREE.MeshStandardMaterial({ color:"#f1f5f9", roughness:0.4, metalness:0.08 });
    for (let i=0;i<3;i++){
      const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.2, 10), insMat);
      ins.position.set(-0.16 + i*0.16, 0.58, 0.20);
      txGroup.add(ins);
    }
    g.add(txGroup);

    // wires (3 parallel slightly sagging)
    const wireMat = new THREE.MeshStandardMaterial({ color:"#545a63", roughness:0.95 });
    const wireGeo = new THREE.CylinderGeometry(0.03,0.03,1,6);
    // build tube wires using TubeGeometry for nicer curves
    for (let w=-1; w<=1; w++){
      const pts = route.map((v, idx) => {
        const t = idx/(route.length-1);
        const sag = Math.sin(t*Math.PI) * 0.55;
        return new THREE.Vector3(v.x, v.y + 3.5 - sag, v.z + w*0.22);
      });
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 120, 0.035, 8, false);
      const wire = new THREE.Mesh(geo, wireMat);
      g.add(wire);
    }

    // service drop from transformer pole to the house service entrance
const houseSvcEnd = (()=>{
  houseObj.updateMatrixWorld(true);
  // side of house facing the pole 
  return houseObj.localToWorld(new THREE.Vector3(2.2, 2.6, -2.0));
})();

const svcPts = [
  new THREE.Vector3(route[0].x, route[0].y + 3.5, route[0].z),
  new THREE.Vector3((route[0].x + houseSvcEnd.x) * 0.5, houseSvcEnd.y + 1.2, (route[0].z + houseSvcEnd.z) * 0.5),
  houseSvcEnd.clone()
];
    const svcCurve = new THREE.CatmullRomCurve3(svcPts);
    const svc = new THREE.Mesh(
      new THREE.TubeGeometry(svcCurve, 40, 0.045, 8, false),
      new THREE.MeshStandardMaterial({
        color:"#2dd4bf",
        roughness:0.6,
        metalness:0.1,
        transparent:true,
        opacity:0.6,
        emissive:"#2dd4bf",
        emissiveIntensity:0.3
      })
    );
    svc.castShadow = false;
    g.add(svc);
    g.userData.serviceWire = svc;
    g.userData.transformerBody = txBody;
    g.userData.housePoleTop = new THREE.Vector3(route[0].x, route[0].y + 3.5, route[0].z);

    return g;
  }

  // transmission tower model
  function makeTransmissionTower(){
    const t = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color:"#8b929c", roughness:0.65, metalness:0.15 });

    const leg = new THREE.CylinderGeometry(0.14, 0.18, 5.5, 8);
    const legs = [
      new THREE.Mesh(leg, steel),
      new THREE.Mesh(leg, steel),
      new THREE.Mesh(leg, steel),
      new THREE.Mesh(leg, steel)
    ];
    const spread = 1.6;
    legs[0].position.set( spread, 2.75,  spread);
    legs[1].position.set(-spread, 2.75,  spread);
    legs[2].position.set( spread, 2.75, -spread);
    legs[3].position.set(-spread, 2.75, -spread);
    legs.forEach(l => { l.castShadow = true; t.add(l); });

    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.24, 6.8, 10), steel);
    spine.position.y = 6.5;
    spine.castShadow = true;
    t.add(spine);

    const cross = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 0.28), steel);
    cross.position.y = 6.6;
    cross.castShadow = true;
    t.add(cross);

    // insulators/arms for three phases
    const armGeo = new THREE.BoxGeometry(0.22, 0.22, 1.2);
    for (let i=-1;i<=1;i++){
      const arm = new THREE.Mesh(armGeo, steel);
      arm.position.set(2.5*i, 6.6, 0.65);
      t.add(arm);
      const arm2 = arm.clone();
      arm2.position.z = -0.65;
      t.add(arm2);
    }

    return t;
  }

  function makeSubstation(){
    const g = new THREE.Group();
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.2, 8),
      new THREE.MeshStandardMaterial({ color:"#9fb4a4", roughness:0.92 })
    );
    pad.position.y = 0.1;
    pad.receiveShadow = true;
    g.add(pad);

    const steel = new THREE.MeshStandardMaterial({ color:"#7d8791", roughness:0.65, metalness:0.15 });
    for (let i=0;i<3;i++){
      const bay = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 6.0), steel);
      bay.position.set(-3 + i*3, 1.2, 0);
      bay.castShadow = true;
      g.add(bay);
    }

    // small transformers
    for (let i=0;i<2;i++){
      const xf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 1.0), new THREE.MeshStandardMaterial({ color:"#c9d0d8", roughness:0.85 }));
      xf.position.set(-2 + i*4, 0.7, -2.0);
      xf.castShadow = true; xf.receiveShadow = true;
      g.add(xf);
    }

    // bus wires
    const busPts = [
      new THREE.Vector3(-4, 2.5, 2.2),
      new THREE.Vector3(0, 2.4, 2.2),
      new THREE.Vector3(4, 2.5, 2.2)
    ];
    const bus = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(busPts), 40, 0.03, 6, false),
      new THREE.MeshStandardMaterial({ color:"#4b5563", roughness:0.9 })
    );
    g.add(bus);

    return g;
  }

  function makeWindCollector(){
    const g = new THREE.Group();

    // small pad
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.2, 4),
      new THREE.MeshStandardMaterial({ color:"#a7b6a6", roughness:0.92 })
    );
    pad.position.y = 0.1;
    pad.receiveShadow = true;
    g.add(pad);

    // transformer
    const xf = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.4, 1.2),
      new THREE.MeshStandardMaterial({ color:"#c9d0d8", roughness:0.85, metalness:0.05 })
    );
    xf.position.set(-1.2, 1.0, 0);
    xf.castShadow = true; xf.receiveShadow = true;
    g.add(xf);

    // battery cabinet
    const batt = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.1, 1.6),
      new THREE.MeshStandardMaterial({ color:"#5b7086", roughness:0.65, metalness:0.08, emissive:"#2dd4bf", emissiveIntensity:0.12 })
    );
    batt.position.set(1.4, 0.85, 0);
    batt.castShadow = true; batt.receiveShadow = true;
    g.add(batt);

    // short poles for interconnect
    const poleMat = new THREE.MeshStandardMaterial({ color:"#727a84", roughness:0.85 });
    for (let i=-1;i<=1;i++){
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 8), poleMat);
      pole.position.set(i*1.2, 0.7, -1.2);
      pole.castShadow = true;
      g.add(pole);
    }

    //jumper wires turbine to transformer and  battery to bus
    const wireMat = new THREE.MeshBasicMaterial({ color:"#7dd3fc", transparent:true, opacity:0.85, blending:THREE.AdditiveBlending, depthWrite:false });
    const busPts = [
      new THREE.Vector3(-2.8, 1.4, 1.0),
      new THREE.Vector3(-1.2, 1.5, 0.0),
      new THREE.Vector3(1.4, 1.4, 0.0),
      new THREE.Vector3(2.6, 1.3, -1.1)
    ];
    const busCurve = new THREE.CatmullRomCurve3(busPts);
    const bus = new THREE.Mesh(new THREE.TubeGeometry(busCurve, 32, 0.05, 6, false), wireMat);
    g.add(bus);

    return g;
  }

  // Energy flow: glowing moving dots along curves
  function addHospitalEnergySystem(hospitalGroup){
    const sys = new THREE.Group();
    sys.name = "HospitalEnergySystem";

  
    const roofMainY = 4.20;
    const roofWingY = 3.60;

    // inverter wall parameters
    const WALL_X = 5.18;    
    const wallAnchor = new THREE.Vector3(WALL_X, 2.15, 0.0); 
    const wallStandOff = 0.26; 
    const wallFaceZ = wallAnchor.z + wallStandOff;

    //PV arrays
    const pvMat = new THREE.MeshStandardMaterial({
      color: "#1f3b78",
      roughness: 0.25,
      metalness: 0.15
    });

    const frameMat = new THREE.MeshStandardMaterial({
      color: "#cfd6df",
      roughness: 0.55
    });

    const pvGroup = new THREE.Group();
    pvGroup.name = "HospitalPV";

    function addPVArray({
      centerX, centerZ, roofY,
      roofW, roofD,
      cols, rows,
      inset = 0.45,
      gapX = 0.18,
      gapZ = 0.18,
      lift = 0.06
    }){
      const g = new THREE.Group();

  
      const usableW = Math.max(roofW - 2*inset - (cols-1)*gapX, 0.6);
      const usableD = Math.max(roofD - 2*inset - (rows-1)*gapZ, 0.6);
      const pW = usableW / cols;
      const pD = usableD / rows;

      const railMat = new THREE.MeshStandardMaterial({ color:"#b7c0cb", roughness:0.75 });
      const rail1 = new THREE.Mesh(new THREE.BoxGeometry(roofW - inset*1.2, 0.05, 0.08), railMat);
      const rail2 = rail1.clone();
      rail1.position.set(centerX, roofY + lift*0.55, centerZ - (roofD*0.25));
      rail2.position.set(centerX, roofY + lift*0.55, centerZ + (roofD*0.25));
      rail1.castShadow = true; rail2.castShadow = true;
      g.add(rail1, rail2);

      const startX = centerX - (usableW/2) + (pW/2);
      const startZ = centerZ - (usableD/2) + (pD/2);

      for (let r=0; r<rows; r++){
        for (let c=0; c<cols; c++){
          const x = startX + c*(pW + gapX);
          const z = startZ + r*(pD + gapZ);

          const panel = new THREE.Mesh(new THREE.BoxGeometry(pW, 0.045, pD), pvMat);
          panel.position.set(x, roofY + lift, z);
          panel.castShadow = true;
          g.add(panel);

          const frame = new THREE.Mesh(new THREE.BoxGeometry(pW + 0.05, 0.055, pD + 0.05), frameMat);
          frame.position.copy(panel.position);
          frame.position.y -= 0.006;
          frame.castShadow = true;
          g.add(frame);
        }
      }

      return g;
    }

    // Main roof array
    const pvMain = addPVArray({
      centerX: 0.0,
      centerZ: 0.0,
      roofY: roofMainY,
      roofW: 10.0,
      roofD: 6.0,
      cols: 6,
      rows: 4,
      inset: 0.55,
      gapX: 0.16,
      gapZ: 0.18,
      lift: 0.07
    });
    pvGroup.add(pvMain);

    // Wing roof array
    const pvWing = addPVArray({
      centerX: -4.9,
      centerZ: -3.0,
      roofY: roofWingY,
      roofW: 7.0,
      roofD: 5.0,
      cols: 4,
      rows: 3,
      inset: 0.50,
      gapX: 0.16,
      gapZ: 0.18,
      lift: 0.07
    });
    pvGroup.add(pvWing);

    sys.add(pvGroup);

    // energy system components
    const pvStartLocal = new THREE.Vector3(4.3, roofMainY + 0.10, 1.2);
    const OUT_X = WALL_X + 0.18;
    const OUT_Z = 0.55; 

    //inverter box
    const inverterMat = new THREE.MeshStandardMaterial({ color:"#e6eaef", roughness:0.82, metalness:0.08 });
    const inverter = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.35), inverterMat);
    inverter.position.set(wallAnchor.x + 0.35, wallAnchor.y - 0.30, wallFaceZ + 0.02);
    inverter.castShadow = true;
    sys.add(inverter);

    //breaker box
    const breaker = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.25), inverterMat);
    breaker.position.set(wallAnchor.x + 0.12, wallAnchor.y + 0.65, wallFaceZ + 0.02);
    breaker.castShadow = true;
    sys.add(breaker);

    //DC conduit: PV array to inverter
    const dcLine = makeFlowTube([
      new THREE.Vector3(4.3, 4.35, 1.2),                      
      new THREE.Vector3(OUT_X, 4.10, OUT_Z),                 
      new THREE.Vector3(OUT_X, 2.55, OUT_Z),                
      new THREE.Vector3(OUT_X, inverter.position.y + 0.25, OUT_Z),
      new THREE.Vector3(inverter.position.x - 0.42, inverter.position.y + 0.25, inverter.position.z)
    ], FLOW_COLORS.DC, 0.10);
    sys.add(dcLine);

    //AC conduit: inverter and  breaker and wall
    const acLine = makeFlowTube([
      new THREE.Vector3(inverter.position.x + 0.45, inverter.position.y + 0.10, inverter.position.z),
      new THREE.Vector3(OUT_X, inverter.position.y + 0.10, OUT_Z),
      new THREE.Vector3(OUT_X, breaker.position.y, OUT_Z),
      new THREE.Vector3(breaker.position.x - 0.35, breaker.position.y, breaker.position.z),
      new THREE.Vector3(OUT_X, wallAnchor.y, OUT_Z),
      new THREE.Vector3(WALL_X, wallAnchor.y, 0.0)
    ], FLOW_COLORS.AC, 0.10);
    sys.add(acLine);
    //Utility pole and  meter
    const poleGroup = new THREE.Group();

    const poleMat = new THREE.MeshStandardMaterial({ color:"#cfd6df", roughness:0.75 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 7.8, 10), poleMat);
    pole.position.set(wallAnchor.x+1.8, 3.9, wallAnchor.z+0.8);
    pole.castShadow = true;
    poleGroup.add(pole);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.12), poleMat);
    arm.position.set(pole.position.x+0.9, pole.position.y+2.3, pole.position.z);
    arm.castShadow = true;
    poleGroup.add(arm);

    const insMat = new THREE.MeshStandardMaterial({ color:"#6b7280", roughness:0.9 });
    for (let i=0;i<3;i++){
      const ins = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), insMat);
      ins.position.set(arm.position.x-0.65 + i*0.65, arm.position.y, arm.position.z);
      poleGroup.add(ins);
    }

    const meterMat = new THREE.MeshStandardMaterial({ color:"#f1f3f4", roughness:0.9 });
    const meter = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.70, 0.25), meterMat);
    meter.position.set(pole.position.x-0.35, pole.position.y-0.6, pole.position.z+0.35);
    poleGroup.add(meter);

    // utility feed conduit
    const poleTop = new THREE.Vector3(arm.position.x, arm.position.y, arm.position.z);
    const meterIn = meter.position.clone();
    meterIn.y += 0.25;
    const wallFeed = new THREE.Vector3(wallAnchor.x+0.2, wallAnchor.y+0.45, wallFaceZ + 0.18);
    const wallEntry = new THREE.Vector3(wallAnchor.x+0.05, wallAnchor.y+0.20, wallFaceZ + 0.12);
    const gridWire = tubeAlong([
      poleTop,
      new THREE.Vector3(poleTop.x-1.4, poleTop.y-0.35, poleTop.z+0.50),
      meterIn,
      new THREE.Vector3(wallFeed.x+2.4, wallFeed.y+0.2, wallFeed.z+0.25),
      wallFeed,
      wallEntry
    ], 0.08, "#97a3ad");
    gridWire.mesh.renderOrder = 8;
    poleGroup.add(gridWire.mesh);
    registerHover(gridWire.mesh, "Utility feed (grid → hospital)");

    sys.add(poleGroup);
    // expose grid conduit 
    hospitalGroup.userData.serviceWire = gridWire.mesh;
    hospitalGroup.userData.serviceFlow = null;

    //DEMO PANEL
    const panel = new THREE.Group();
    panel.name = "HospitalWallPanel";

    // rotate so the panel faces outward (+X)
    panel.position.set(WALL_X + 0.10, 2.35, -0.2);
    panel.rotation.y = -Math.PI/2;

    // backplate
    const plateGeo = new THREE.BoxGeometry(3.10, 1.85, 0.10);
    const plateMat = new THREE.MeshStandardMaterial({ color:"#2b2f36", roughness:0.85, metalness:0.05 });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.castShadow = true;
    plate.receiveShadow = true;
    panel.add(plate);
    addOutline(plate, "#ffffff", 0.18);

    // subtle backlight
    const glowMat = new THREE.MeshStandardMaterial({
      color:"#111318",
      emissive:"#0b0f18",
      emissiveIntensity: 0.65
    });
    const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(3.05, 1.80), glowMat);
    glowPlane.position.z = 0.06;
    glowPlane.renderOrder = 29;
    panel.add(glowPlane);

    // label header for printed on panel
    const title = makeTextLabelMesh("HOSPITAL PV SYSTEM", { w: 2.8, h: 0.28, fg:"#eaf0ff" });
    title.position.set(0.0, 0.72, 0.065);
    panel.add(title);

    // mini components for big and spaced
    const compMat = new THREE.MeshStandardMaterial({ color:"#f0f3f6", roughness:0.85, metalness:0.02 });

    // PV tile
    const pvTile = new THREE.Mesh(new THREE.BoxGeometry(0.90, 0.45, 0.06), new THREE.MeshStandardMaterial({
      color:"#173a78", roughness:0.35, metalness:0.15
    }));
    pvTile.position.set(-1.05, 0.10, 0.075);
    panel.add(pvTile);

    const pvLbl = makeTextLabelMesh("PV", { w: 0.5, h: 0.20, fg:"#eaf0ff" });
    pvLbl.position.set(-1.05, -0.22, 0.075);
    panel.add(pvLbl);

    // Inverter
    const invBox = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.70, 0.08), compMat);
    invBox.position.set(-0.05, 0.10, 0.075);
    panel.add(invBox);

    const invLbl = makeTextLabelMesh("INVERTER", { w: 1.1, h: 0.20, fg:"#eaf0ff" });
    invLbl.position.set(-0.05, -0.32, 0.075);
    panel.add(invLbl);

    // Breaker
    const brkBox = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.45, 0.08), compMat);
    brkBox.position.set(0.95, 0.10, 0.075);
    panel.add(brkBox);

    const brkLbl = makeTextLabelMesh("BREAKER", { w: 1.0, h: 0.20, fg:"#eaf0ff" });
    brkLbl.position.set(0.95, -0.32, 0.075);
    panel.add(brkLbl);

    // LEDs for DC / AC status
    const dcLedMat = new THREE.MeshStandardMaterial({ color:"#ff9a1a", emissive:"#ff9a1a", emissiveIntensity:0.20 });
    const acLedMat = new THREE.MeshStandardMaterial({ color:"#ff3b30", emissive:"#ff3b30", emissiveIntensity:0.12 });
    glowMats.push(dcLedMat, acLedMat);

    const dcLed = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 14), dcLedMat);
    dcLed.position.set(-0.55, -0.58, 0.085);
    panel.add(dcLed);

    const acLed = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 14), acLedMat);
    acLed.position.set(0.55, -0.58, 0.085);
    panel.add(acLed);

    const dcLbl = makeTextLabelMesh("DC", { w: 0.45, h: 0.20, fg:"#eaf0ff" });
    dcLbl.position.set(-0.55, -0.82, 0.085);
    panel.add(dcLbl);

    const acLbl = makeTextLabelMesh("AC", { w: 0.45, h: 0.20, fg:"#eaf0ff" });
    acLbl.position.set(0.55, -0.82, 0.085);
    panel.add(acLbl);

    // spotlight so it pops
    const spot = new THREE.SpotLight("#ffffff", 0.65, 12, Math.PI/5, 0.35, 1.0);
    spot.position.set(WALL_X + 1.8, 4.2, 0.8);
    spot.target = hospitalGroup;
    spot.castShadow = false;
    sys.add(spot);

    // store refs for animation
    sys.userData.demo = { dcLedMat, acLedMat };

    // add panel to system
    sys.add(panel);
    registerHover(panel, "Hospital wall demo panel");
    registerHover(pvTile, "PV (demo)");
    registerHover(invBox, "Inverter (demo)");
    registerHover(brkBox, "Breaker (demo)");
    //Hover-only labels
    registerHover(pvGroup, "Solar panels");
    registerHover(dcLine, "DC conduit (PV → inverter)");
    registerHover(inverter, "Inverter");
    registerHover(acLine, "AC conduit (inverter → breaker)");
    registerHover(breaker, "Breaker");
    registerHover(meter, "Meter");
    registerHover(poleGroup, "Utility grid");

    // store refs for animation
    sys.userData.lines = { dcLine, acLine, gridLine: gridWire.mesh };
    sys.userData.pvGroup = pvGroup;
    sys.userData.inverter = inverter;
    sys.userData.breaker = breaker;
    sys.userData.pole = poleGroup;

    // expose key materials for animation
    sys.userData.pvMat = pvMat;
    sys.userData.meterMat = meterMat;
    hospitalGroup.userData.pvMat = pvMat;
    hospitalGroup.userData.meterMat = meterMat;
    // expose tubes for wall animation
    hospitalGroup.userData.pvDcTube = dcLine;
    hospitalGroup.userData.pvAcTube = acLine;

    hospitalGroup.add(sys);
    return sys;
  }

  function makeRiverRibbon(curve, {
    widthStart = 1.8,
    widthEnd   = 3.4,
    segments   = 220,
    yOffset    = 0.05,
    color      = "#2b78ff",
    material   = null,
    additive   = false,
    opacity    = 0.95
  } = {}) {
    const positions = [];
    const uvs = [];
    const indices = [];

    const side = new THREE.Vector3();
    const tan  = new THREE.Vector3();

    for (let i = 0; i <= segments; i++) {
      const u = i / segments;

      const p = curve.getPointAt(u);
      tan.copy(curve.getTangentAt(u));
      tan.y = 0; 
      if (tan.lengthSq() < 1e-8) tan.set(1, 0, 0);
      tan.normalize();

      // perpendicular in XZ
      side.set(-tan.z, 0, tan.x);

      // widen downstream
      const w = THREE.MathUtils.lerp(widthStart, widthEnd, Math.pow(u, 0.75)) * 0.5;

      const lx = p.x + side.x * w;
      const lz = p.z + side.z * w;
      const rx = p.x - side.x * w;
      const rz = p.z - side.z * w;

      positions.push(lx, p.y + yOffset, lz);
      positions.push(rx, p.y + yOffset, rz);

      // UVs tiled along length
      uvs.push(0, u * 8);
      uvs.push(1, u * 8);

      if (i < segments) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    let mat = material;
    if (!mat) {
      mat = additive
        ? new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          })
        : new THREE.MeshPhysicalMaterial({
            color,
            roughness: 0.12,
            metalness: 0.0,
            clearcoat: 1.0,
            clearcoatRoughness: 0.08,
            transmission: 0.18,
            thickness: 0.4,
            transparent: true,
            opacity,
            ior: 1.33,
            depthWrite: true
          });
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    return mesh;
  }

  function makeWhitewaterDots(curve, count = 110) {
    const dotGeo = new THREE.SphereGeometry(0.12, 10, 10);
    const dotMat = new THREE.MeshBasicMaterial({
      color: "#e9fdff",
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const dots = new THREE.InstancedMesh(dotGeo, dotMat, count);
    dots.frustumCulled = false;

  // set initial positions
    dots.userData.curve = {
      getPointAt(u) {
        const a = 0.04;
        const b = 0.38;
        return curve.getPointAt(THREE.MathUtils.lerp(a, b, u));
      }
    };

    return dots;
  }

  // hydroelectric dam along lake river system
  function makeHydroRiverToLake(hydro, targetLake, terrainHeightAt) {
    const g = new THREE.Group();

    const lakeY = targetLake.water.position.y + 0.02;

    // world position of dam outflow (because hydro group is lifted)
    const outflowW = hydro.userData.outflow.getWorldPosition(new THREE.Vector3());

    // tailrace point on terrain directly below outflow
    const tailrace = outflowW.clone();
    tailrace.y = terrainHeightAt(tailrace.x, tailrace.z) + 0.08;

    // control points (XZ path across valley, Y sampled from terrain)
    const ctrl = [
      // Route from dam tailrace toward the reservoir lake behind the dam (left/top)
      { x: -22, z: 16 },
      { x: -24, z: 18 },
      { x: -26, z: 20 },
      { x: -28, z: 22 },
      { x: -27, z: 24 },
      { x: -25, z: 26 },
      { x: -23, z: 27 },
      { x: -22, z: 26 }
    ];

    const pts = [];
    pts.push(outflowW.clone());  
    pts.push(tailrace);           

    for (const p of ctrl) {
      const y = terrainHeightAt(p.x, p.z) + 0.06;
      pts.push(new THREE.Vector3(p.x, y, p.z));
    }

    // force end INSIDE lake
    pts[pts.length - 1].y = lakeY;

    const curve = new THREE.CatmullRomCurve3(pts);
    curve.curveType = "catmullrom";
    curve.tension = 0.45;

    const water = makeRiverRibbon(curve, {
      widthStart: 1.8,
      widthEnd: 3.0,
      segments: 220,
      yOffset: 0.05,
      color: "#2aa9a6",
      opacity: 0.9
    });
    g.add(water);

    //foam ribbon overlay
    const foam = makeRiverRibbon(curve, {
      widthStart: 2.3,
      widthEnd: 3.6,
      segments: 220,
      yOffset: 0.06,
      color: "#e9fdff",
      additive: true,
      opacity: 0.55
    });
    g.add(foam);

    //whitewater ribbon
    const wwCurve = new THREE.CatmullRomCurve3([
      tailrace.clone(),
      curve.getPointAt(0.08),
      curve.getPointAt(0.12)
    ]);
    const wwPatch = makeRiverRibbon(wwCurve, {
      widthStart: 5.6,
      widthEnd: 7.4,
      segments: 60,
      yOffset: 0.08,
      color: "#f2feff",
      additive: true,
      opacity: 0.75
    });
    g.add(wwPatch);

    // animated dots
    const dots = makeWhitewaterDots(curve, 110);
    g.add(dots);

    // hook into existing animation system
    hydro.userData.foamMat = foam.material;
    hydro.userData.whitewaterDots = dots;

    //handy references
    g.userData.curve = curve;
    g.userData.water = water;
    g.userData.banks = null;

    return g;
  }

  // WORLD BUILDING
  const world = new THREE.Group();
  scene.add(world);

  world.add(makeBase());

  const { mesh: terrain, geo: terrainGeo } = makeTerrain();
  world.add(terrain);

  // terrain height via raycast
  const raycaster = new THREE.Raycaster();
  function terrainHeightAt(x, z){
    raycaster.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
    const hit = raycaster.intersectObject(terrain, false)[0];
    return hit ? hit.point.y : 0;
  }


// flatten a small terrain patch so buildings sit on a pad
function flattenTerrainPatch(geo, cx, cz, radius){
  const pos = geo.attributes.position;
  const inner = radius * 0.55;

  // average height near the center
  let sum = 0, count = 0;
  for (let i=0;i<pos.count;i++){
    const dx = pos.getX(i) - cx;
    const dz = pos.getZ(i) - cz;
    const d = Math.hypot(dx, dz);
    if (d < inner){
      sum += pos.getY(i);
      count++;
    }
  }
  if (!count) return;
  const targetY = sum / count;

  // blend vertices toward targetY based on distance
  for (let i=0;i<pos.count;i++){
    const dx = pos.getX(i) - cx;
    const dz = pos.getZ(i) - cz;
    const d = Math.hypot(dx, dz);
    if (d > radius) continue;

    const t = clamp(1.0 - (d / radius), 0, 1);
    const w = t*t*(3 - 2*t);
    const y = lerp(pos.getY(i), targetY, w);
    pos.setY(i, y);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  if (geo.attributes.normal) geo.attributes.normal.needsUpdate = true;
}

 

    const RESERVOIR_POINTS = [
      {x:-14.0, z:-26.0},
      {x:-15.8, z:-21.8},
      {x:-20.0, z:-20.0},
      {x:-24.2, z:-21.8},
      {x:-26.0, z:-26.0},
      {x:-24.2, z:-30.2},
      {x:-20.0, z:-32.0},
      {x:-15.8, z:-30.2}
    ];

    const WORTHERSEE_POINTS = [
  
  {x:  2, z: 32},
  {x:  6, z: 27},
  {x: 14, z: 25},
  {x: 24, z: 25},
  {x: 30, z: 28},
  {x: 32, z: 32},
  {x: 30, z: 36},
  {x: 22, z: 38},
  {x: 12, z: 38},
  {x:  4, z: 36}
];



    const reservoirPoly = chaikinSmoothClosed(RESERVOIR_POINTS, 3);
    const worPoly       = chaikinSmoothClosed(WORTHERSEE_POINTS, 3);

    const reservoirShape = shapeLake(reservoirPoly);
    const worShape       = shapeLake(worPoly);

    function bboxFromPoints(points, pad = 0){
      const xs = points.map(p => p.x);
      const zs = points.map(p => p.z);
      return {
        minX: Math.min(...xs) - pad,
        maxX: Math.max(...xs) + pad,
        minZ: Math.min(...zs) - pad,
        maxZ: Math.max(...zs) + pad
      };
    }

    function lakeHeightForShape(points, { offset = -0.12, percentileP = 0.10, edgeMargin = 0.02 } = {}){
    
      const samplesArr = [];

      const inPoly = (x,z)=>{
        let inside = false;
        for (let i=0,j=points.length-1;i<points.length;j=i++){
          const xi = points[i].x, zi = points[i].z;
          const xj = points[j].x, zj = points[j].z;
          const intersect = ((zi > z) !== (zj > z)) &&
            (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-6) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      };

      const bb = bboxFromPoints(points, 0);
      const samples = 14;

      for (let ix=0; ix<=samples; ix++){
        for (let iz=0; iz<=samples; iz++){
          const x = bb.minX + (bb.maxX - bb.minX) * (ix / samples);
          const z = bb.minZ + (bb.maxZ - bb.minZ) * (iz / samples);
          if (!inPoly(x,z)) continue;
          const h = terrainHeightAt(x, z);
          if (isFinite(h)) samplesArr.push(h);
        }
      }

      if (!samplesArr.length){
        for (const p of points){
          const h = terrainHeightAt(p.x, p.z);
          if (isFinite(h)) samplesArr.push(h);
        }
      }
      if (!samplesArr.length) return 0 + offset;

      samplesArr.sort((a,b)=>a-b);
      const p = clamp(percentileP, 0, 1);
      const idx = Math.floor(p * (samplesArr.length - 1));
      const interiorBase = samplesArr[idx] + offset;

      const edgeHeights = points.map(pt => terrainHeightAt(pt.x, pt.z)).filter(isFinite);
      const edgeMin = edgeHeights.length ? Math.min(...edgeHeights) : interiorBase;
      const edgeClamp = edgeMin - edgeMargin;

      return Math.min(interiorBase, edgeClamp);
    }

    function carveLakeIntoTerrain(geo, points, waterY, opts = {}){
      const shore   = opts.shore ?? 1.8;
      const depth   = opts.depth ?? 1.0;
      const shallow = opts.shallow ?? 0.18;

      //smooth outside a bit so no vertical walls
      const shoreOutside = opts.shoreOutside ?? 1.8;

      //safety limits
      const maxAboveWater = opts.maxAboveWater ?? 2.6;
      const maxCut        = opts.maxCut ?? 2.2;

      const pos = geo.attributes.position;

      const xs = points.map(p => p.x);
      const zs = points.map(p => p.z);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minZ = Math.min(...zs), maxZ = Math.max(...zs);

      const inPoly = (x,z)=>{
        let inside = false;
        for (let i=0,j=points.length-1;i<points.length;j=i++){
          const xi = points[i].x, zi = points[i].z;
          const xj = points[j].x, zj = points[j].z;
          const intersect = ((zi > z) !== (zj > z)) &&
            (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-6) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      };

      const distToSeg = (px,pz, ax,az, bx,bz)=>{
        const abx = bx-ax, abz = bz-az;
        const apx = px-ax, apz = pz-az;
        const ab2 = abx*abx + abz*abz || 1e-6;
        let t = (apx*abx + apz*abz) / ab2;
        t = clamp(t, 0, 1);
        const cx = ax + abx*t, cz = az + abz*t;
        const dx = px - cx, dz = pz - cz;
        return Math.sqrt(dx*dx + dz*dz);
      };

      const distToPolyEdge = (x,z)=>{
        let d = Infinity;
        for (let i=0;i<points.length;i++){
          const j = (i+1) % points.length;
          d = Math.min(d, distToSeg(x,z, points[i].x, points[i].z, points[j].x, points[j].z));
        }
        return d;
      };

      const margin = Math.max(shore, shoreOutside);

      for (let i=0;i<pos.count;i++){
        const x = pos.getX(i);
        const z = pos.getZ(i);
        if (x < (minX-margin) || x > (maxX+margin) || z < (minZ-margin) || z > (maxZ+margin)) continue;

        const inside = inPoly(x,z);
        const dEdge = distToPolyEdge(x,z);
        if (!inside && dEdge > shoreOutside) continue;

        const y0 = pos.getY(i);
        if (y0 > waterY + maxAboveWater) continue;

        let target = y0;

        if (inside){
          const t = clamp(dEdge / shore, 0, 1);
          target = lerp(waterY - shallow, waterY - depth, t);
        } else {
          const w = 1.0 - clamp(dEdge / shoreOutside, 0, 1);
          target = lerp(y0, waterY - shallow, w);
        }

        if (target < y0){
          pos.setY(i, Math.max(target, y0 - maxCut));
        }
      }

      pos.needsUpdate = true;
      geo.computeVertexNormals();
      if (geo.attributes.normal) geo.attributes.normal.needsUpdate = true;
    }

    // Hydro dam needs to exist before we place downstream assets
    const hydro = makeHydroDamAndRiver();
    world.add(hydro);
    registerHover(hydro, "Hydro plant");

    // pick water levels from local terrain
    const WOR_DROP = 0.50;

    // Match reservoir level to surrounding terrain (high percentile), with dam marker fallback
    const reservoirTerrainY = lakeHeightForShape(reservoirPoly, {
      offset: 0.02,
      percentileP: 0.85,
      edgeMargin: 0.02
    });
    const reservoirMarkerY = hydro.userData.reservoirLevel.getWorldPosition(new THREE.Vector3()).y - 0.02;
    const reservoirEdgeMax = Math.max(...reservoirPoly.map((p) => terrainHeightAt(p.x, p.z)));
    const reservoirY = Math.max(
      reservoirTerrainY,
      reservoirMarkerY,
      reservoirEdgeMax + 0.05
    );
    const worY       = lakeHeightForShape(worPoly, { offset: -0.12, percentileP: 0.10, edgeMargin: 0.03 }) - WOR_DROP;

    carveLakeIntoTerrain(terrainGeo, reservoirPoly, reservoirY, {
      shore: 2.0, depth: 1.60, shallow: 0.24,
      shoreOutside: 2.2, maxAboveWater: 999.0, maxCut: 999.0
    });

    carveLakeIntoTerrain(terrainGeo, worPoly, worY, {
      shore: 2.0, depth: 1.15, shallow: 0.22,
      shoreOutside: 2.2, maxAboveWater: 4.0, maxCut: 3.6
    });

    // flatten pads for key assets so they sit on flat ground
flattenTerrainPatch(terrainGeo, LAYOUT.house.x,        LAYOUT.house.z,        6.5);
flattenTerrainPatch(terrainGeo, LAYOUT.windCollector.x,LAYOUT.windCollector.z,6.0);
flattenTerrainPatch(terrainGeo, LAYOUT.factory.x,      LAYOUT.factory.z,      6.0);
flattenTerrainPatch(terrainGeo, LAYOUT.substation.x,   LAYOUT.substation.z,   6.0);
flattenTerrainPatch(terrainGeo, LAYOUT.hospital.x,     LAYOUT.hospital.z,     7.5);


    // build lake meshes
    const reservoirLake = makeLake(
      reservoirShape,
      reservoirY,
      {
        color: "#1b8a84",
        opacity: 0.96,
        shallowColor: "#5fd4c5",
        deepColor: "#0b3f4c",
        shoreBlend: 3.1
      },
      terrainHeightAt
    );
    world.add(reservoirLake.water);
    const worLake = makeLake(
      worShape,
      worY,
      {
        color: "#2b78ff",
        opacity: 0.92,
        shallowColor: "#6fb5ff",
        deepColor: "#184a9e",
        shoreBlend: 2.6
      },
      terrainHeightAt
    );
    world.add(worLake.water);
    worLake.water.position.y -= 0.02;

    registerHover(reservoirLake.water, "Reservoir");
    registerHover(worLake.water, "Wörthersee");
    waterMeshes.push(reservoirLake.water, worLake.water);

    const hydroTieWorld = hydro.userData?.gridTie
      ? hydro.userData.gridTie.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(-22.0, 0.0, 12.4);
    const hydroTie = { x: hydroTieWorld.x, z: hydroTieWorld.z };

    // Forest 
    const boxAround = (cx,cz,rx,rz)=>({ minX:cx-rx, maxX:cx+rx, minZ:cz-rz, maxZ:cz+rz });
const excludeBoxes = [
  boxAround(LAYOUT.house.x,        LAYOUT.house.z,        7.0, 6.0),
  boxAround(LAYOUT.windCollector.x,LAYOUT.windCollector.z,6.0, 5.0),
  boxAround(LAYOUT.factory.x,      LAYOUT.factory.z,      10.0, 9.0),
  boxAround(LAYOUT.substation.x,   LAYOUT.substation.z,   10.0, 9.0),
  boxAround(LAYOUT.hospital.x,     LAYOUT.hospital.z,     10.0, 9.0),
  boxAround(-20, 18.2, 14.0, 12.0)
];

const trees = makeTrees(terrainGeo, {
  lakePolys: [reservoirPoly, worPoly],
  lakeY: Math.min(reservoirY, worY),
  lakePad: 1.4,
  excludeBoxes
});
world.add(trees);

// Clouds
  const clouds = makeClouds();
  scene.add(clouds);

  // Wind turbines 
  const turbines = [];

 
  const turbinePositions = [
    new THREE.Vector3(-30, 0, 34),
    new THREE.Vector3(-12, 0, 32),
    new THREE.Vector3(6,   0, 34),
  ];

  for (const p of turbinePositions){
    const t = makeWindTurbine();

   
    const groundY = terrainHeightAt(p.x, p.z);
    t.position.set(p.x, groundY, p.z);

  
    t.rotation.y = -0.55 + (Math.random() - 0.5) * 0.20;

    world.add(t);
    turbines.push(t);
  }

  // Wind collector: transformer and  battery at base of ridge
  const windCollector = makeWindCollector();
  windCollector.scale.setScalar(2.0);
  windCollector.position.set(LAYOUT.windCollector.x, terrainHeightAt(LAYOUT.windCollector.x, LAYOUT.windCollector.z) + 0.1, LAYOUT.windCollector.z);
  world.add(windCollector);
  registerHover(windCollector, "Wind collector (battery + transformer)");

const hydroLine = new THREE.Group();
const hydroLineRouteXZ = [

  hydroTie,

  {x:-22, z: 9.0},
  {x:-18, z: 9.0},
  {x: LAYOUT.substation.x, z: LAYOUT.substation.z}
];
const hydroLineRoute = hydroLineRouteXZ.map(p => new THREE.Vector3(p.x, terrainHeightAt(p.x, p.z), p.z));
  for (const p of hydroLineRoute){
    const tower = makeTransmissionTower();
    tower.position.copy(p);
    hydroLine.add(tower);
  }
  // three visible conductors with gentle sag between towers
  const anchorHeight = 6.6; 
  const conductorOffsets = [-0.35, 0, 0.35];
  const anchors = hydroLineRoute.map(p => new THREE.Vector3(p.x, p.y + anchorHeight, p.z));
  hydroGlowAnchors = anchors.map(a => a.clone()); 
  for (const zOff of conductorOffsets){
    const pts = [];
    for (let i=0;i<anchors.length;i++){
      const a = anchors[i];
      const base = new THREE.Vector3(a.x, a.y, a.z + zOff);
      pts.push(base);
      if (i>0 && i<anchors.length-1){
        const sag = base.clone();
        sag.y -= 0.9;
        pts.push(sag);
      }
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const wire = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 140, 0.035, 8, false),
      new THREE.MeshStandardMaterial({ color:"#545a63", roughness:0.95 })
    );
    wire.castShadow = false;
    hydroLine.add(wire);
  }
  world.add(hydroLine);

  // House 
  const house = makeHouse();
  house.scale.setScalar(2.0);
  house.position.set(LAYOUT.house.x, terrainHeightAt(LAYOUT.house.x, LAYOUT.house.z) + 0.6, LAYOUT.house.z);
  world.add(house);
  registerHover(house, "House (Wind Turbine consumer)");

  // Hospital
  const HOSPITAL_X = LAYOUT.hospital.x;
  const HOSPITAL_Z = LAYOUT.hospital.z;
  const hospital = makeHospital();
  hospital.scale.setScalar(2.0);
  hospital.position.set(HOSPITAL_X, terrainHeightAt(HOSPITAL_X, HOSPITAL_Z) + 0.6, HOSPITAL_Z);
  world.add(hospital);
  registerHover(hospital, "Hospital (PV consumer)");
  const hospitalSystem = addHospitalEnergySystem(hospital);


  // Factory
  const factory = makePowerStation();
  factory.position.set(LAYOUT.factory.x, terrainHeightAt(LAYOUT.factory.x, LAYOUT.factory.z) + 0.55, LAYOUT.factory.z);
  world.add(factory);
  registerHover(factory, "Factory (Hydro consumer)");

  // Substation yard near factory (receives hydro line)
  const substation = makeSubstation();
  substation.position.set(LAYOUT.substation.x, terrainHeightAt(LAYOUT.substation.x, LAYOUT.substation.z), LAYOUT.substation.z);
  world.add(substation);
  registerHover(substation, "Substation");

  // Short feeder from substation to factory
  const feederRoute = [
  new THREE.Vector3(LAYOUT.substation.x, terrainHeightAt(LAYOUT.substation.x, LAYOUT.substation.z) + 2.2, LAYOUT.substation.z),
  new THREE.Vector3((LAYOUT.substation.x + LAYOUT.factory.x) * 0.5, Math.max(terrainHeightAt(LAYOUT.substation.x, LAYOUT.substation.z), terrainHeightAt(LAYOUT.factory.x, LAYOUT.factory.z)) + 3.0, (LAYOUT.substation.z + LAYOUT.factory.z) * 0.5),
  new THREE.Vector3(LAYOUT.factory.x, terrainHeightAt(LAYOUT.factory.x, LAYOUT.factory.z) + 2.2, LAYOUT.factory.z)
];

  const feederCurve = new THREE.CatmullRomCurve3(feederRoute);
  const feeder = new THREE.Mesh(
    new THREE.TubeGeometry(feederCurve, 80, 0.03, 8, false),
    new THREE.MeshStandardMaterial({ color:"#545a63", roughness:0.95 })
  );
  feeder.castShadow = false;
  feeder.receiveShadow = true;
  world.add(feeder);

  // Visible power grid poles/wires
  const gridLine = makeGridLine(house, windCollector);
  world.add(gridLine);

  //Flow curves (
  const junction = new THREE.Vector3(0, 4.5, 6);

  function worldPoint(obj, local){
    obj.updateMatrixWorld(true);
    return obj.localToWorld(local.clone());
  }

  function turbineHubWorld(t){
    const r = t.userData?.rotor;
    if (!r) return t.position.clone().add(new THREE.Vector3(0, 16, 0));
    r.updateMatrixWorld(true);
    return r.getWorldPosition(new THREE.Vector3());
  }

  // start = average hub position
  const hubPts = turbines.map(turbineHubWorld);
  const windStart = hubPts.reduce((a,p)=>a.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, hubPts.length));

  // collector + house targets
  const collectorTop = worldPoint(windCollector, new THREE.Vector3(0, 2.6, 0));
  const houseEntry   = worldPoint(house, new THREE.Vector3(0, 2.4, 2.05));
  const housePoleTop = gridLine?.userData?.housePoleTop ? gridLine.userData.housePoleTop.clone() : houseEntry.clone();

  // lift midpoints above terrain
  const liftAbove = (v, extra=7) => {
    const y = terrainHeightAt(v.x, v.z) + extra;
    v.y = Math.max(v.y, y);
    return v;
  };

  const midA = liftAbove(windStart.clone().lerp(collectorTop, 0.45), 10);
  const midB = liftAbove(collectorTop.clone().lerp(houseEntry, 0.45), 9);


  const windCurveGen = new THREE.CatmullRomCurve3([
    windStart.clone(),
    midA,
    collectorTop.clone()
  ]);

  const windCurveToHouse = new THREE.CatmullRomCurve3([
    collectorTop.clone(),
    midB,
    housePoleTop.clone()
  ]);

  function makeCable(points, radius=0.04, color="#39424e"){

    const curve = new THREE.CatmullRomCurve3(points);
    const geom = new THREE.TubeGeometry(curve, 120, radius, 8, false);
    const mat = new THREE.MeshStandardMaterial({ color, roughness:0.95, metalness:0.05 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 5;
    return mesh;
  }
  const windCable = makeCable([windStart, midA, collectorTop, midB, housePoleTop], 0.035);
  world.add(windCable);
  registerHover(windCable, "Wind line (turbines → battery/transformer → house)");

  const hydroStart = new THREE.Vector3(-20, terrainHeightAt(-20, 18) + 6.0, 18);
const subTop = new THREE.Vector3(LAYOUT.substation.x, terrainHeightAt(LAYOUT.substation.x, LAYOUT.substation.z) + 3.0, LAYOUT.substation.z);
const factoryTop = new THREE.Vector3(LAYOUT.factory.x, terrainHeightAt(LAYOUT.factory.x, LAYOUT.factory.z) + 3.0, LAYOUT.factory.z);

const hydroToSubCurve = hydroGlowAnchors
  ? new THREE.CatmullRomCurve3(hydroGlowAnchors)
  : new THREE.CatmullRomCurve3([hydroStart, subTop]);

const subToFactoryCurve = new THREE.CatmullRomCurve3([
  subTop.clone(),
  new THREE.Vector3((subTop.x + factoryTop.x) * 0.5, Math.max(subTop.y, factoryTop.y) + 0.8, (subTop.z + factoryTop.z) * 0.5),
  factoryTop.clone()
]);


  //Solar
  hospital.updateMatrixWorld(true);
  const solarStart = hospital.localToWorld(new THREE.Vector3(4.3, 4.30, 1.2)); 
  const solarMid1  = hospital.localToWorld(new THREE.Vector3(4.6, 3.60, 1.0)); 
  const solarMid2  = hospital.localToWorld(new THREE.Vector3(3.4, 2.70, 0.6)); 
  const solarEnd   = hospital.localToWorld(new THREE.Vector3(2.6, 1.90, 0.0)); 

  const solarCurve = new THREE.CatmullRomCurve3([
    solarStart.clone(),
    solarMid1.clone(),
    solarMid2.clone(),
    solarEnd.clone()
  ]);

  const flowWindGen = new FlowDots(windCurveGen, "#67e8f9", 55);
  const flowWindToHouse = new FlowDots(windCurveToHouse, "#7dd3fc", 55);
  const flowHydroToSub = new FlowDots(hydroToSubCurve, "#38bdf8", 60);
  const flowHydro = flowHydroToSub; 
  const flowSubToFactory = new FlowDots(subToFactoryCurve, "#38bdf8", 40);
  const flowSolar = new FlowDots(solarCurve, "#fbbf24", 55);
  flowSolar.mesh.visible = false; 

  flowWindGen.mesh.visible = true;
  flowWindToHouse.mesh.visible = true;
  flowHydroToSub.mesh.visible = true;
  flowSubToFactory.mesh.visible = true;

  world.add(flowWindGen.mesh, flowWindToHouse.mesh, flowHydroToSub.mesh, flowSubToFactory.mesh, flowSolar.mesh);

  return {
    world,
    turbines,
    hydro,
    house,
    factory,
    hospital,
    gridLine,
    clouds,
    waterMeshes,
    flowWindGen,
    flowWindToHouse,
    flowHydro,
    flowHydroToSub,
    flowSubToFactory,
    flowSolar,
    hospitalSystem,
  };
}
