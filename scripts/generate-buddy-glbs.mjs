import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

// Polyfill FileReader in Node.js so GLTFExporter binary:true outputs an ArrayBuffer cleanly
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class NodeFileReader {
    constructor() {
      this.result = null;
      this.onload = null;
      this.onloadend = null;
      this.onerror = null;
    }
    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          if (typeof this.onload === "function") this.onload({ target: this });
          if (typeof this.onloadend === "function") this.onloadend({ target: this });
        })
        .catch((err) => {
          if (typeof this.onerror === "function") this.onerror(err);
        });
    }
  };
}

const BUDDY_SPECS = [
  {
    id: "general",
    aliases: ["friendly", "dadaji"],
    outfitType: "jacket",
    outfitColor: 0x356876,
    outfitTrimColor: 0x2a5561,
    shirtColor: 0xf4f3ef,
    hasShirtCollar: false,
    tieColor: null,
    shortsColor: 0xb9a389,
    prop: "none",
  },
  {
    id: "developer",
    aliases: [],
    outfitType: "hoodie",
    outfitColor: 0x383d46,
    outfitTrimColor: 0x2b3038,
    shirtColor: 0x383d46,
    hasShirtCollar: false,
    tieColor: null,
    shortsColor: 0x2e3239,
    prop: "laptop",
  },
  {
    id: "ca",
    aliases: [],
    outfitType: "blazer",
    outfitColor: 0x3d4146,
    outfitTrimColor: 0x2d3035,
    shirtColor: 0xf3eee6,
    hasShirtCollar: true,
    tieColor: null,
    shortsColor: 0x3e4042,
    prop: "ledger",
  },
  {
    id: "legal",
    aliases: [],
    outfitType: "blazer",
    outfitColor: 0x3a3f4a,
    outfitTrimColor: 0x2c303a,
    shirtColor: 0xf3f1ee,
    hasShirtCollar: true,
    tieColor: 0x7c2233,
    shortsColor: 0x333741,
    prop: "legal_book",
  },
  {
    id: "ecommerce",
    aliases: [],
    outfitType: "jacket",
    outfitColor: 0x2f5e67,
    outfitTrimColor: 0x244a52,
    shirtColor: 0xf2e4cf,
    hasShirtCollar: false,
    tieColor: null,
    shortsColor: 0x3c4146,
    prop: "parcel",
  },
  {
    id: "business",
    aliases: ["operations"],
    outfitType: "blazer",
    outfitColor: 0x2c3e5a,
    outfitTrimColor: 0x213047,
    shirtColor: 0xf3f4f6,
    hasShirtCollar: true,
    tieColor: 0x2c4268,
    shortsColor: 0x26354d,
    prop: "briefcase",
  },
  {
    id: "marketing",
    aliases: [],
    outfitType: "jacket",
    outfitColor: 0xd67e67,
    outfitTrimColor: 0xc06953,
    shirtColor: 0xf3eadf,
    hasShirtCollar: false,
    tieColor: null,
    shortsColor: 0x1f2126,
    prop: "chart_card",
  },
  {
    id: "research",
    aliases: ["detective"],
    outfitType: "blazer",
    outfitColor: 0x5c7258,
    outfitTrimColor: 0x4b5f48,
    shirtColor: 0xf3eee4,
    hasShirtCollar: false,
    tieColor: null,
    shortsColor: 0x495a45,
    prop: "green_book",
  },
  {
    id: "data",
    aliases: [],
    outfitType: "cardigan",
    outfitColor: 0x3b5882,
    outfitTrimColor: 0x2e466a,
    shirtColor: 0xf3f2ef,
    hasShirtCollar: true,
    tieColor: null,
    shortsColor: 0x375177,
    prop: "data_tablet",
  },
  {
    id: "content",
    aliases: [],
    outfitType: "sweater",
    outfitColor: 0x6b2334,
    outfitTrimColor: 0x561b29,
    shirtColor: 0xf2ebe1,
    hasShirtCollar: true,
    tieColor: null,
    shortsColor: 0xd8c9b6,
    prop: "pen_notebook",
  },
  {
    id: "design",
    aliases: [],
    outfitType: "jacket",
    outfitColor: 0xa194bf,
    outfitTrimColor: 0x897ba8,
    shirtColor: 0xf5ecd9,
    hasShirtCollar: false,
    tieColor: null,
    shortsColor: 0x9b8e7e,
    prop: "swatches",
  },
  {
    id: "professor",
    aliases: [],
    outfitType: "cardigan",
    outfitColor: 0x6b7748,
    outfitTrimColor: 0x59643a,
    shirtColor: 0xf2e8d7,
    hasShirtCollar: false,
    tieColor: null,
    shortsColor: 0x7c5a3c,
    prop: "green_book",
  },
];

function makeMatteMat(color, roughness = 0.72, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
  });
}

/**
 * Builds the signature pearl-cream teardrop head with curled swirl crown.
 * Pure closed parametric surface (smooth cheeks, curved crown tip +X).
 */
function createCreamDropHeadGeometry(uSegs = 32, vSegs = 26) {
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let iu = 0; iu <= uSegs; iu++) {
    const u = iu / uSegs; // 0 = bottom pole (neck join), 1 = top swirl tip
    // Height from -0.27 up to +0.47
    const y = -0.27 + u * 0.74;

    // Smooth teardrop radius curve: rounded lower cheeks (peak around u=0.38) -> graceful crown taper
    let baseR;
    if (u <= 0) {
      baseR = 0;
    } else if (u >= 1) {
      baseR = 0;
    } else if (u < 0.42) {
      const k = u / 0.42;
      baseR = 0.342 * Math.sin((k * Math.PI) / 2) ** 0.78;
    } else {
      const k = (u - 0.42) / 0.58;
      // Smooth dome taper curving into a cozy tapered peak
      baseR = 0.342 * Math.cos((k * Math.PI) / 2) ** 1.18 * (1 - 0.18 * k * k);
    }

    // Swirl bend above u = 0.55 leaning organically toward +X and subtly -Z
    const s = Math.max(0, (u - 0.54) / 0.46);
    const bendX = 0.145 * Math.pow(s, 1.85);
    const bendZ = -0.028 * Math.pow(s, 2.0);
    // Slight head cheek breadth: wider X, cozy round Z
    const scaleX = 1.05 - 0.12 * s;
    const scaleZ = 0.94 - 0.08 * s;

    for (let iv = 0; iv <= vSegs; iv++) {
      const v = (iv / vSegs) * Math.PI * 2;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);
      // Slight softer forward cheek fullness when cos(v) ~ +/-1, subtle flat forehead
      const px = bendX + baseR * scaleX * sinV;
      const pz = bendZ + baseR * scaleZ * cosV;
      const py = y - 0.02 * Math.pow(s, 3.0) * (1 - sinV); // slight curl dip on right tip

      positions.push(px, py, pz);
      uvs.push(iv / vSegs, u);
    }
  }

  for (let iu = 0; iu < uSegs; iu++) {
    for (let iv = 0; iv < vSegs; iv++) {
      const a = iu * (vSegs + 1) + iv;
      const b = a + vSegs + 1;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, c, b);
      indices.push(c, d, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds curved cozy torso shell or jacket shell wrapping 360° smoothly.
 */
function createTorsoLathe(
  radiusBottom = 0.185,
  radiusMid = 0.215,
  radiusTop = 0.165,
  height = 0.44,
  thetaLength = Math.PI * 2,
  thetaStart = 0,
) {
  const pts = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r =
      t < 0.35
        ? THREE.MathUtils.lerp(radiusBottom, radiusMid, Math.sin((t / 0.35) * (Math.PI / 2)))
        : THREE.MathUtils.lerp(radiusMid, radiusTop, Math.pow((t - 0.35) / 0.65, 1.3));
    pts.push(new THREE.Vector2(r, t * height));
  }
  const geo = new THREE.LatheGeometry(pts, 28, thetaStart, thetaLength);
  geo.scale(1.06, 1.0, 0.88);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds rounded chunky sleeve capsule with smooth shoulder/wrist taper.
 */
function createSleeveGeometry(length = 0.19, rTop = 0.068, rBot = 0.056) {
  const geo = new THREE.CylinderGeometry(rTop, rBot, length, 18, 8);
  geo.translate(0, -length / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds rounded chunky shoe sticking gently forward (+Z).
 */
function createShoeMesh(skinMat) {
  const shoeGroup = new THREE.Group();
  const upperGeo = new THREE.SphereGeometry(0.088, 20, 14);
  upperGeo.scale(0.95, 0.64, 1.32);
  const upper = new THREE.Mesh(upperGeo, skinMat);
  upper.position.set(0, 0.055, 0.025);
  upper.castShadow = true;
  upper.receiveShadow = true;
  shoeGroup.add(upper);

  const soleGeo = new THREE.CylinderGeometry(0.084, 0.086, 0.022, 20);
  soleGeo.scale(0.96, 1, 1.3);
  const soleMat = makeMatteMat(0xe2d8c9, 0.85, 0.0);
  const sole = new THREE.Mesh(soleGeo, soleMat);
  sole.position.set(0, 0.011, 0.025);
  shoeGroup.add(sole);
  return shoeGroup;
}

function buildOutfitAndArms(spec, skinMat) {
  const outfitMat = makeMatteMat(spec.outfitColor, 0.78, 0.02);
  const trimMat = makeMatteMat(spec.outfitTrimColor, 0.82, 0.02);
  const shirtMat = makeMatteMat(spec.shirtColor, 0.76, 0.01);
  const buttonMat = makeMatteMat(0x282c32, 0.45, 0.15);

  const torsoOutfitGroup = new THREE.Group();
  torsoOutfitGroup.name = "Outfit";

  // 1. Inner torso (always full 360° solid core so there are zero gaps at any camera angle)
  const innerCore = new THREE.Mesh(createTorsoLathe(0.175, 0.205, 0.152, 0.44), shirtMat);
  innerCore.name = "InnerShirt";
  innerCore.castShadow = true;
  innerCore.receiveShadow = true;
  torsoOutfitGroup.add(innerCore);

  // Shirt Collar for CA, Legal, Business, Data, Content
  if (spec.hasShirtCollar) {
    const collarGeo = new THREE.TorusGeometry(0.105, 0.024, 10, 22);
    collarGeo.rotateX(Math.PI / 2 - 0.18);
    const collar = new THREE.Mesh(collarGeo, shirtMat);
    collar.position.set(0, 0.435, 0.01);
    torsoOutfitGroup.add(collar);
  }

  // Necktie for Legal and Business
  if (spec.tieColor) {
    const tieMat = makeMatteMat(spec.tieColor, 0.55, 0.06);
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.04, 0.03), tieMat);
    knot.position.set(0, 0.39, 0.155);
    torsoOutfitGroup.add(knot);

    const bladeGeo = new THREE.ConeGeometry(0.036, 0.21, 4);
    bladeGeo.rotateY(Math.PI / 4);
    bladeGeo.rotateX(Math.PI);
    bladeGeo.scale(0.95, 1, 0.32);
    const blade = new THREE.Mesh(bladeGeo, tieMat);
    blade.position.set(0, 0.275, 0.176);
    blade.rotation.x = -0.1;
    torsoOutfitGroup.add(blade);
  }

  // 2. Outerwear Shell by outfitType
  if (spec.outfitType === "hoodie" || spec.outfitType === "sweater") {
    // Full wrap pullover shell
    const shell = new THREE.Mesh(createTorsoLathe(0.194, 0.226, 0.168, 0.43), outfitMat);
    shell.castShadow = true;
    shell.receiveShadow = true;
    torsoOutfitGroup.add(shell);

    // Lower ribbed hem band
    const hemGeo = new THREE.TorusGeometry(0.194, 0.024, 10, 28);
    hemGeo.rotateX(Math.PI / 2);
    hemGeo.scale(1.06, 0.88, 1);
    const hem = new THREE.Mesh(hemGeo, trimMat);
    hem.position.set(0, 0.025, 0);
    torsoOutfitGroup.add(hem);

    if (spec.outfitType === "hoodie") {
      // Sculpted 3D back/neck hood ring
      const hoodGeo = new THREE.TorusGeometry(0.138, 0.048, 14, 26, Math.PI * 1.55);
      hoodGeo.rotateX(Math.PI / 2 + 0.3);
      hoodGeo.rotateZ(-0.78);
      const hood = new THREE.Mesh(hoodGeo, outfitMat);
      hood.position.set(0, 0.415, -0.025);
      hood.castShadow = true;
      torsoOutfitGroup.add(hood);

      // Front kangaroo pouch pocket
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.125, 0.048), trimMat);
      pocket.position.set(0, 0.12, 0.185);
      torsoOutfitGroup.add(pocket);

      // Drawstring cords
      const cordMat = makeMatteMat(0x22262e, 0.65, 0.05);
      for (const sx of [-0.045, 0.045]) {
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.14, 8), cordMat);
        cord.position.set(sx, 0.34, 0.185);
        cord.rotation.z = sx * 0.6;
        torsoOutfitGroup.add(cord);
      }
    } else {
      // Burgundy V-neck collar inset showing inner cream shirt
      const vPatch = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.13, 3), shirtMat);
      vPatch.rotation.x = Math.PI;
      vPatch.scale.set(1, 1, 0.35);
      vPatch.position.set(0, 0.385, 0.16);
      torsoOutfitGroup.add(vPatch);
    }
  } else {
    // Open-front jacket / blazer / cardigan: wrap ~295° around sides & back so inner shirt is cleanly visible in front!
    const openAngle =
      spec.outfitType === "cardigan" ? 0.85 : spec.outfitType === "blazer" ? 0.72 : 0.92;
    const shell = new THREE.Mesh(
      createTorsoLathe(0.194, 0.226, 0.168, 0.43, Math.PI * 2 - openAngle, openAngle / 2),
      outfitMat,
    );
    shell.castShadow = true;
    shell.receiveShadow = true;
    torsoOutfitGroup.add(shell);

    // Collar / Lapels wrapping cleanly around neck and front V
    const lapelHeight = spec.outfitType === "jacket" ? 0.15 : 0.22;
    for (const side of [-1, 1]) {
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.062, lapelHeight, 0.028), trimMat);
      lapel.position.set(side * 0.088, 0.39 - lapelHeight * 0.22, 0.155);
      lapel.rotation.z = -side * 0.36;
      lapel.rotation.y = side * 0.24;
      torsoOutfitGroup.add(lapel);
    }

    // Back collar neckband so side/back views look tailored
    const backCollarGeo = new THREE.TorusGeometry(0.125, 0.026, 10, 22, Math.PI * 1.25);
    backCollarGeo.rotateX(Math.PI / 2 - 0.1);
    backCollarGeo.rotateZ(Math.PI * 0.875);
    const backCollar = new THREE.Mesh(backCollarGeo, outfitMat);
    backCollar.position.set(0, 0.428, -0.01);
    torsoOutfitGroup.add(backCollar);

    // Front buttons
    const btnX = spec.outfitType === "jacket" ? -0.08 : 0.0;
    const btnYs = spec.outfitType === "cardigan" ? [0.1, 0.17, 0.24] : [0.14, 0.23];
    for (const by of btnYs) {
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 12), buttonMat);
      btn.rotation.x = Math.PI / 2;
      btn.position.set(btnX, by, 0.198);
      torsoOutfitGroup.add(btn);
    }

    // Hip patch pockets
    for (const side of [-1, 1]) {
      const pkt = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.082, 0.025), trimMat);
      pkt.position.set(side * 0.132, 0.115, 0.152);
      pkt.rotation.y = side * 0.42;
      torsoOutfitGroup.add(pkt);
    }
  }

  return { torsoOutfitGroup, outfitMat, trimMat };
}

function buildArmLimb(
  side /* -1 for Right limb on screen-left, +1 for Left limb on screen-right */,
  outfitMat,
  trimMat,
  skinMat,
) {
  const isRight = side < 0; // -X = character Right arm (screen-left)
  const shoulder = new THREE.Group();
  shoulder.name = isRight ? "Shoulder_R" : "Shoulder_L";
  shoulder.position.set(side * 0.215, 0.37, 0.01);

  const arm = new THREE.Group();
  arm.name = isRight ? "Arm_R" : "Arm_L";
  shoulder.add(arm);

  // Upper shoulder cap + sleeve
  const shoulderCap = new THREE.Mesh(new THREE.SphereGeometry(0.068, 16, 12), outfitMat);
  shoulderCap.castShadow = true;
  arm.add(shoulderCap);

  const upperSleeve = new THREE.Mesh(createSleeveGeometry(0.155, 0.068, 0.059), outfitMat);
  upperSleeve.castShadow = true;
  arm.add(upperSleeve);

  // Elbow pivot
  const forearm = new THREE.Group();
  forearm.name = isRight ? "Forearm_R" : "Forearm_L";
  forearm.position.set(0, -0.15, 0);
  arm.add(forearm);

  const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.056, 14, 10), outfitMat);
  forearm.add(elbowBall);

  const lowerSleeve = new THREE.Mesh(createSleeveGeometry(0.125, 0.058, 0.05), outfitMat);
  lowerSleeve.castShadow = true;
  forearm.add(lowerSleeve);

  // Ribbed wrist cuff
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.024, 16), trimMat);
  cuff.position.set(0, -0.125, 0);
  forearm.add(cuff);

  // Hand pivot + rounded pearl-cream hand + cute thumb/fingers
  const hand = new THREE.Group();
  hand.name = isRight ? "Hand_R" : "Hand_L";
  hand.position.set(0, -0.155, 0);
  forearm.add(hand);

  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 12), skinMat);
  palm.scale.set(0.92, 1.05, 0.85);
  palm.castShadow = true;
  hand.add(palm);

  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.024, 6, 10), skinMat);
  thumb.position.set(-side * 0.036, 0.008, 0.024);
  thumb.rotation.z = side * 0.5;
  hand.add(thumb);

  return { shoulder, arm, forearm, hand };
}

function attachVariantProp(spec, handR, handL, torso) {
  const mount = new THREE.Group();
  mount.name = "PropMount";

  if (spec.prop === "none") return;

  if (spec.prop === "laptop") {
    const laptop = new THREE.Group();
    const metal = makeMatteMat(0xb6b8bd, 0.35, 0.65);
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x182230,
      emissive: 0x0d9488,
      emissiveIntensity: 0.28,
      roughness: 0.25,
    });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.014, 0.16), metal);
    laptop.add(base);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.012), metal);
    lid.position.set(0, 0.075, -0.078);
    lid.rotation.x = -0.22;
    laptop.add(lid);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.125), screenMat);
    glow.position.set(0, 0.075, -0.07);
    glow.rotation.x = -0.22;
    laptop.add(glow);
    const emblem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.004, 16),
      makeMatteMat(0xe5e7eb, 0.4, 0.3),
    );
    emblem.rotation.x = Math.PI / 2 - 0.22;
    emblem.position.set(0, 0.075, -0.086);
    laptop.add(emblem);
    laptop.position.set(-0.02, 0.04, 0.09);
    laptop.rotation.set(0.08, -0.35, 0);
    handL.add(laptop);
  } else if (spec.prop === "ledger" || spec.prop === "legal_book" || spec.prop === "green_book") {
    const coverColor =
      spec.prop === "ledger" ? 0x7d4b27 : spec.prop === "legal_book" ? 0x7c2233 : 0x204d3b;
    const coverMat = makeMatteMat(coverColor, 0.62, 0.04);
    const pagesMat = makeMatteMat(0xf4efe6, 0.85, 0.0);
    const book = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.21, 0.155), coverMat);
    cover.castShadow = true;
    book.add(cover);
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.195, 0.145), pagesMat);
    pages.position.set(spec.prop === "green_book" ? -0.005 : 0.005, 0, 0.006);
    book.add(pages);
    const spineBand = new THREE.Mesh(
      new THREE.BoxGeometry(0.046, 0.018, 0.158),
      makeMatteMat(0xcaa258, 0.45, 0.3),
    );
    spineBand.position.set(0, 0.075, 0);
    book.add(spineBand);

    if (spec.prop === "green_book") {
      book.position.set(-0.02, 0.055, 0.055);
      book.rotation.set(0.18, 0.35, -0.18);
      handL.add(book);
    } else {
      book.position.set(0.02, 0.055, 0.055);
      book.rotation.set(0.18, -0.35, 0.18);
      handR.add(book);
    }
  } else if (spec.prop === "parcel") {
    const parcel = new THREE.Group();
    const boxMat = makeMatteMat(0xc49464, 0.85, 0.0);
    const tapeMat = makeMatteMat(0xe7dbc6, 0.62, 0.02);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.16), boxMat);
    box.castShadow = true;
    parcel.add(box);
    const tapeTop = new THREE.Mesh(new THREE.BoxGeometry(0.184, 0.016, 0.038), tapeMat);
    tapeTop.position.set(0, 0.068, 0);
    parcel.add(tapeTop);
    const tapeCross = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.144, 0.164), tapeMat);
    parcel.add(tapeCross);
    parcel.position.set(-0.03, 0.065, 0.08);
    parcel.rotation.set(0.08, -0.3, 0.05);
    handL.add(parcel);
  } else if (spec.prop === "briefcase") {
    const caseGrp = new THREE.Group();
    const leather = makeMatteMat(0x28272a, 0.55, 0.08);
    const brass = makeMatteMat(0xc59a45, 0.3, 0.78);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.165, 0.22), leather);
    body.castShadow = true;
    caseGrp.add(body);
    const flap = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.07, 0.222),
      makeMatteMat(0x222124, 0.5, 0.1),
    );
    flap.position.set(0, 0.048, 0);
    caseGrp.add(flap);
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.03, 0.028), brass);
    clasp.position.set(0, 0.015, 0);
    caseGrp.add(clasp);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.009, 8, 16, Math.PI), leather);
    handle.rotation.y = Math.PI / 2;
    handle.position.set(0, 0.085, 0);
    caseGrp.add(handle);
    caseGrp.position.set(-0.02, -0.095, 0.01);
    caseGrp.rotation.y = 0.15;
    handR.add(caseGrp);
  } else if (spec.prop === "chart_card") {
    const card = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, 0.18, 0.016),
      makeMatteMat(0xf5efe6, 0.7, 0.02),
    );
    bg.castShadow = true;
    card.add(bg);
    const barMat = makeMatteMat(0xdc6d50, 0.45, 0.05);
    [
      [-0.04, -0.025, 0.045],
      [0.0, -0.008, 0.078],
      [0.04, 0.01, 0.115],
    ].forEach(([x, y, h]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.026, h, 0.02), barMat);
      bar.position.set(x, y, 0.006);
      card.add(bar);
    });
    card.position.set(-0.025, 0.06, 0.065);
    card.rotation.set(0.08, -0.25, -0.08);
    handL.add(card);
  } else if (spec.prop === "data_tablet") {
    const tablet = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.21, 0.25, 0.018),
      makeMatteMat(0x21242b, 0.42, 0.2),
    );
    frame.castShadow = true;
    tablet.add(frame);
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.215, 0.02),
      makeMatteMat(0xf7f8fa, 0.3, 0.0),
    );
    tablet.add(screen);
    const barMat = makeMatteMat(0x4b87d6, 0.4, 0.05);
    [
      [-0.054, -0.032, 0.045],
      [-0.018, -0.018, 0.074],
      [0.018, -0.002, 0.105],
      [0.054, 0.014, 0.136],
    ].forEach(([x, y, h]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.024, h, 0.024), barMat);
      bar.position.set(x, y, 0.002);
      tablet.add(bar);
    });
    tablet.position.set(0, 0.2, 0.235);
    tablet.rotation.x = -0.08;
    torso.add(tablet);
  } else if (spec.prop === "pen_notebook") {
    // Notebook on Hand_L
    const nb = new THREE.Group();
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.185, 0.14),
      makeMatteMat(0x2c2f36, 0.65, 0.05),
    );
    nb.add(cover);
    const pages = new THREE.Mesh(
      new THREE.BoxGeometry(0.026, 0.172, 0.13),
      makeMatteMat(0xf3eee6, 0.85, 0.0),
    );
    pages.position.set(-0.004, 0, 0.005);
    nb.add(pages);
    nb.position.set(-0.02, 0.055, 0.055);
    nb.rotation.set(0.15, 0.3, -0.2);
    handL.add(nb);

    // Stylus pen in Hand_R
    const pen = new THREE.Group();
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.17, 10),
      makeMatteMat(0x252830, 0.35, 0.4),
    );
    pen.add(barrel);
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.008, 0.022, 10),
      makeMatteMat(0xd1d5db, 0.25, 0.7),
    );
    tip.position.set(0, -0.095, 0);
    tip.rotation.x = Math.PI;
    pen.add(tip);
    pen.position.set(0.015, 0.01, 0.035);
    pen.rotation.set(0.7, 0, -0.5);
    handR.add(pen);
  } else if (spec.prop === "swatches") {
    const fan = new THREE.Group();
    const colors = [0xb3a5cf, 0xa8c6b8, 0x89aac9, 0xe889a7, 0xeb7b5d];
    colors.forEach((col, i) => {
      const card = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.165, 0.006),
        makeMatteMat(col, 0.55, 0.02),
      );
      card.position.set((i - 2) * 0.022, 0.06, i * 0.008);
      card.rotation.z = -(i - 2) * 0.19;
      fan.add(card);
    });
    fan.position.set(-0.02, 0.04, 0.065);
    fan.rotation.set(0.12, -0.25, 0);
    handL.add(fan);
  }
}

function buildMasterBuddy(spec) {
  const scene = new THREE.Scene();

  const skinMat = makeMatteMat(0xf5ede2, 0.62, 0.01);
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x1f1713,
    roughness: 0.12,
    metalness: 0.05,
  });
  const eyeSparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const smileMat = makeMatteMat(0x524038, 0.55, 0.02);
  const mouthOpenMat = makeMatteMat(0x9b2c2c, 0.45, 0.0);
  const browMat = makeMatteMat(0x6e594f, 0.6, 0.0);
  const shortsMat = makeMatteMat(spec.shortsColor, 0.8, 0.01);

  // Master Rig Root
  const root = new THREE.Group();
  root.name = "Root";
  scene.add(root);

  // Pelvis / Hips (y = 0.25)
  const pelvis = new THREE.Group();
  pelvis.name = "Pelvis";
  pelvis.position.set(0, 0.25, 0);
  root.add(pelvis);

  const hipsMesh = new THREE.Mesh(new THREE.SphereGeometry(0.175, 22, 14), shortsMat);
  hipsMesh.scale.set(1.06, 0.52, 0.88);
  hipsMesh.position.set(0, 0.0, 0);
  hipsMesh.castShadow = true;
  pelvis.add(hipsMesh);

  // Left (+X) & Right (-X) legs + shorts cuffs + rounded shoes resting cleanly at y = 0
  for (const [nameLeg, nameFoot, sx] of [
    ["Leg_R", "Foot_R", -0.098],
    ["Leg_L", "Foot_L", 0.098],
  ]) {
    const leg = new THREE.Group();
    leg.name = nameLeg;
    leg.position.set(sx, -0.01, 0);
    pelvis.add(leg);

    const shortLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.082, 0.125, 18), shortsMat);
    shortLeg.position.set(0, -0.06, 0);
    shortLeg.castShadow = true;
    leg.add(shortLeg);

    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.081, 0.012, 8, 18), shortsMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, -0.118, 0);
    leg.add(cuff);

    const ankle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.048, 0.045, 14), skinMat);
    ankle.position.set(0, -0.145, 0);
    leg.add(ankle);

    const foot = createShoeMesh(skinMat);
    foot.name = nameFoot;
    foot.position.set(0, -0.24, 0); // Pelvis 0.25 - 0.24 = 0.01 -> shoe sits squarely on y=0!
    leg.add(foot);
  }

  // Torso (anchored at pelvis y = 0.25)
  const torso = new THREE.Group();
  torso.name = "Torso";
  torso.position.set(0, 0.01, 0);
  pelvis.add(torso);

  const { torsoOutfitGroup, outfitMat, trimMat } = buildOutfitAndArms(spec, skinMat);
  torso.add(torsoOutfitGroup);

  // Arms: Right (-X, screen-left) and Left (+X, screen-right)
  const {
    shoulder: shoulderR,
    forearm: forearmR,
    hand: handR,
  } = buildArmLimb(-1, outfitMat, trimMat, skinMat);
  const {
    shoulder: shoulderL,
    forearm: forearmL,
    hand: handL,
  } = buildArmLimb(+1, outfitMat, trimMat, skinMat);

  // Set natural default resting poses per prop type
  shoulderR.rotation.set(0.08, 0, -0.22);
  forearmR.rotation.set(-0.28, 0, 0.34);

  shoulderL.rotation.set(0.08, 0, 0.22);
  forearmL.rotation.set(-0.28, 0, -0.34);

  if (
    spec.prop === "laptop" ||
    spec.prop === "parcel" ||
    spec.prop === "chart_card" ||
    spec.prop === "swatches" ||
    spec.prop === "green_book"
  ) {
    shoulderL.rotation.set(-0.25, 0, 0.28);
    forearmL.rotation.set(-1.15, 0, -0.35);
  } else if (spec.prop === "ledger" || spec.prop === "legal_book") {
    shoulderR.rotation.set(-0.25, 0, -0.28);
    forearmR.rotation.set(-1.15, 0, 0.35);
  } else if (spec.prop === "briefcase") {
    shoulderR.rotation.set(0.04, 0, -0.14);
    forearmR.rotation.set(-0.12, 0, 0.06);
  } else if (spec.prop === "data_tablet") {
    shoulderR.rotation.set(-0.45, 0, -0.18);
    forearmR.rotation.set(-0.95, 0, 0.42);
    shoulderL.rotation.set(-0.45, 0, 0.18);
    forearmL.rotation.set(-0.95, 0, -0.42);
  } else if (spec.prop === "pen_notebook") {
    shoulderL.rotation.set(-0.25, 0, 0.26);
    forearmL.rotation.set(-1.12, 0, -0.32);
    shoulderR.rotation.set(-0.48, 0, -0.15);
    forearmR.rotation.set(-0.95, 0, 0.35);
  }

  torso.add(shoulderR);
  torso.add(shoulderL);

  attachVariantProp(spec, handR, handL, torso);

  // Neck
  const neck = new THREE.Group();
  neck.name = "Neck";
  neck.position.set(0, 0.43, 0);
  torso.add(neck);

  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.105, 0.095, 20), skinMat);
  neckMesh.position.set(0, 0.035, 0);
  neck.add(neckMesh);

  // Head pivot
  const head = new THREE.Group();
  head.name = "Head";
  head.position.set(0, 0.31, 0);
  neck.add(head);

  const headMesh = new THREE.Mesh(createCreamDropHeadGeometry(), skinMat);
  headMesh.name = "HeadMesh";
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  head.add(headMesh);

  // Face features cleanly seated on front cheek surface (u~0.48 => z ≈ 0.321)
  const makeEye = (name, x) => {
    const eyeGrp = new THREE.Group();
    eyeGrp.name = name;
    eyeGrp.position.set(x, -0.02, 0.308);
    eyeGrp.rotation.y = x * 0.45; // contour slightly along curved cheeks

    const eyeBall = new THREE.Mesh(new THREE.SphereGeometry(0.034, 18, 14), eyeMat);
    eyeBall.scale.set(0.78, 1.18, 0.55);
    eyeGrp.add(eyeBall);

    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), eyeSparkMat);
    spark.position.set(-0.008, 0.015, 0.017);
    eyeGrp.add(spark);

    return eyeGrp;
  };

  head.add(makeEye("Eye_R", -0.125));
  head.add(makeEye("Eye_L", 0.125));

  // Expressive movable eyebrows (kept tiny/subtle when neutral so original face stays clean!)
  const makeBrow = (name, x) => {
    const browGrp = new THREE.Group();
    browGrp.name = name;
    browGrp.position.set(x, 0.038, 0.314);
    browGrp.rotation.y = x * 0.42;
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.032, 4, 8), browMat);
    mesh.rotation.z = Math.PI / 2;
    browGrp.add(mesh);
    return browGrp;
  };
  head.add(makeBrow("Brow_R", -0.125));
  head.add(makeBrow("Brow_L", 0.125));

  // Curved 3D smile tube
  const smileCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.056, -0.072, 0.308),
    new THREE.Vector3(0, -0.098, 0.326),
    new THREE.Vector3(0.056, -0.072, 0.308),
  );
  const smileMesh = new THREE.Mesh(
    new THREE.TubeGeometry(smileCurve, 18, 0.0065, 8, false),
    smileMat,
  );
  smileMesh.name = "MouthSmile";
  head.add(smileMesh);

  // Subtle MouthOpen (hidden at scale 0.01 when idle, expands smoothly during Talk!)
  const mouthOpen = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 10), mouthOpenMat);
  mouthOpen.name = "MouthOpen";
  mouthOpen.position.set(0, -0.088, 0.312);
  mouthOpen.scale.set(1.15, 0.05, 0.38);
  head.add(mouthOpen);

  // Soft cheek blush circles
  const blushMat = new THREE.MeshStandardMaterial({
    color: 0xeeb5a2,
    roughness: 0.85,
    transparent: true,
    opacity: 0.35,
  });
  for (const [bName, bx] of [
    ["Cheek_R", -0.175],
    ["Cheek_L", 0.175],
  ]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), blushMat);
    cheek.name = bName;
    cheek.scale.set(1.15, 0.72, 0.25);
    cheek.position.set(bx, -0.068, 0.275);
    cheek.rotation.y = bx * 1.4;
    head.add(cheek);
  }

  return {
    scene,
    refs: { root, pelvis, torso, head, shoulderR, forearmR, shoulderL, forearmL },
  };
}

/**
 * Generates the 4 reusable skeletal node AnimationClips (`Idle`, `Wave`, `Point`, `Talk`)
 * using exact node paths matching buildMasterBuddy().
 */
function createReusableClips(spec, refs) {
  const baseRShoulderQ = refs.shoulderR.quaternion.clone();
  const baseRForearmQ = refs.forearmR.quaternion.clone();
  const baseLShoulderQ = refs.shoulderL.quaternion.clone();
  const baseLForearmQ = refs.forearmL.quaternion.clone();

  const quatKeys = (rx, ry, rz) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    return [q.x, q.y, q.z, q.w];
  };
  const quatFromBase = (baseQ, dx, dy, dz) => {
    const d = new THREE.Quaternion().setFromEuler(new THREE.Euler(dx, dy, dz));
    const q = baseQ.clone().multiply(d);
    return [q.x, q.y, q.z, q.w];
  };

  // 1. IDLE (4.0s gentle breathing, head sway, eye blink)
  const idleClip = new THREE.AnimationClip("Idle", 4.0, [
    new THREE.VectorKeyframeTrack(
      "Torso.position",
      [0, 1.0, 2.0, 3.0, 4.0],
      [0, 0.01, 0, 0, 0.022, 0, 0, 0.01, 0, 0, 0.02, 0, 0, 0.01, 0],
    ),
    new THREE.QuaternionKeyframeTrack(
      "Head.quaternion",
      [0, 1.3, 2.6, 4.0],
      [
        ...quatKeys(0, 0, 0),
        ...quatKeys(0.02, 0.05, -0.03),
        ...quatKeys(-0.01, -0.05, 0.03),
        ...quatKeys(0, 0, 0),
      ],
    ),
    // Periodic blink at t ~ 2.4s
    new THREE.VectorKeyframeTrack(
      "Eye_L.scale",
      [0, 2.25, 2.35, 2.45, 4.0],
      [1, 1, 1, 1, 1, 1, 1, 0.08, 1, 1, 1, 1, 1, 1, 1],
    ),
    new THREE.VectorKeyframeTrack(
      "Eye_R.scale",
      [0, 2.25, 2.35, 2.45, 4.0],
      [1, 1, 1, 1, 1, 1, 1, 0.08, 1, 1, 1, 1, 1, 1, 1],
    ),
  ]);

  // 2. WAVE (1.8s cheerful right-side greeting raise on screen-left or free arm)
  // Prefer free arm so props stay crisp!
  const waveUsesRight = !["ledger", "legal_book", "briefcase", "data_tablet"].includes(spec.prop);
  const waveShoulder = waveUsesRight ? "Shoulder_R" : "Shoulder_L";
  const waveForearm = waveUsesRight ? "Forearm_R" : "Forearm_L";
  const waveBaseS = waveUsesRight ? baseRShoulderQ : baseLShoulderQ;
  const waveBaseF = waveUsesRight ? baseRForearmQ : baseLForearmQ;
  const dirS = waveUsesRight ? -1 : 1;

  const waveClip = new THREE.AnimationClip("Wave", 1.8, [
    new THREE.QuaternionKeyframeTrack(
      `${waveShoulder}.quaternion`,
      [0, 0.35, 0.75, 1.15, 1.5, 1.8],
      [
        ...quatFromBase(waveBaseS, 0, 0, 0),
        ...quatFromBase(waveBaseS, -0.35, 0, dirS * 1.45),
        ...quatFromBase(waveBaseS, -0.35, 0, dirS * 1.15),
        ...quatFromBase(waveBaseS, -0.35, 0, dirS * 1.48),
        ...quatFromBase(waveBaseS, -0.2, 0, dirS * 0.9),
        ...quatFromBase(waveBaseS, 0, 0, 0),
      ],
    ),
    new THREE.QuaternionKeyframeTrack(
      `${waveForearm}.quaternion`,
      [0, 0.35, 0.75, 1.15, 1.8],
      [
        ...quatFromBase(waveBaseF, 0, 0, 0),
        ...quatFromBase(waveBaseF, -0.25, 0, -dirS * 0.35),
        ...quatFromBase(waveBaseF, -0.25, 0, dirS * 0.15),
        ...quatFromBase(waveBaseF, -0.25, 0, -dirS * 0.35),
        ...quatFromBase(waveBaseF, 0, 0, 0),
      ],
    ),
    new THREE.QuaternionKeyframeTrack(
      "Head.quaternion",
      [0, 0.5, 1.2, 1.8],
      [
        ...quatKeys(0, 0, 0),
        ...quatKeys(-0.04, 0, dirS * 0.08),
        ...quatKeys(-0.04, 0, dirS * 0.04),
        ...quatKeys(0, 0, 0),
      ],
    ),
  ]);

  // 3. POINT (1.6s extending Shoulder_R screen-left toward webpage + coordinated head look)
  const pointClip = new THREE.AnimationClip("Point", 1.6, [
    new THREE.QuaternionKeyframeTrack(
      "Shoulder_R.quaternion",
      [0, 0.35, 1.25, 1.6],
      [
        ...quatFromBase(baseRShoulderQ, 0, 0, 0),
        ...quatKeys(-0.22, -0.18, -1.28),
        ...quatKeys(-0.24, -0.2, -1.32),
        ...quatKeys(-0.22, -0.18, -1.28),
      ],
    ),
    new THREE.QuaternionKeyframeTrack(
      "Forearm_R.quaternion",
      [0, 0.35, 1.25, 1.6],
      [
        ...quatFromBase(baseRForearmQ, 0, 0, 0),
        ...quatKeys(-0.05, 0, 0.05),
        ...quatKeys(-0.05, 0, 0.05),
        ...quatKeys(-0.05, 0, 0.05),
      ],
    ),
    new THREE.QuaternionKeyframeTrack(
      "Head.quaternion",
      [0, 0.35, 1.25, 1.6],
      [
        ...quatKeys(0, 0, 0),
        ...quatKeys(0.03, -0.32, 0.06),
        ...quatKeys(0.03, -0.34, 0.06),
        ...quatKeys(0.03, -0.32, 0.06),
      ],
    ),
  ]);

  // 4. TALK (1.2s natural rhythmic speech nods & animated MouthOpen syllable pulse)
  const talkClip = new THREE.AnimationClip("Talk", 1.2, [
    new THREE.QuaternionKeyframeTrack(
      "Head.quaternion",
      [0, 0.3, 0.6, 0.9, 1.2],
      [
        ...quatKeys(0, 0, 0),
        ...quatKeys(0.06, 0.05, 0.02),
        ...quatKeys(-0.03, -0.04, -0.02),
        ...quatKeys(0.05, 0.03, 0.02),
        ...quatKeys(0, 0, 0),
      ],
    ),
    new THREE.VectorKeyframeTrack(
      "Torso.position",
      [0, 0.3, 0.6, 0.9, 1.2],
      [0, 0.01, 0, 0, 0.024, 0, 0, 0.012, 0, 0, 0.026, 0, 0, 0.01, 0],
    ),
    new THREE.VectorKeyframeTrack(
      "MouthOpen.scale",
      [0, 0.15, 0.35, 0.55, 0.75, 0.95, 1.2],
      [
        1.15, 0.05, 0.38, 1.15, 0.75, 0.42, 1.15, 0.25, 0.38, 1.15, 0.85, 0.42, 1.15, 0.18, 0.38,
        1.15, 0.65, 0.42, 1.15, 0.05, 0.38,
      ],
    ),
  ]);

  return [idleClip, waveClip, pointClip, talkClip];
}

async function main() {
  const outPublic = path.resolve("public/models/buddies");
  const outExt = path.resolve("extension/models");
  fs.mkdirSync(outPublic, { recursive: true });
  fs.mkdirSync(outExt, { recursive: true });

  const exporter = new GLTFExporter();

  for (const spec of BUDDY_SPECS) {
    const { scene, refs } = buildMasterBuddy(spec);
    scene.updateMatrixWorld(true);
    const clips = createReusableClips(spec, refs);

    const glbBuffer = await new Promise((resolve, reject) => {
      exporter.parse(
        scene,
        (res) => resolve(Buffer.from(res)),
        (err) => reject(err),
        { binary: true, animations: clips },
      );
    });

    const pubPath = path.join(outPublic, `${spec.id}.glb`);
    const extPath = path.join(outExt, `${spec.id}.glb`);
    fs.writeFileSync(pubPath, glbBuffer);
    fs.writeFileSync(extPath, glbBuffer);

    for (const alias of spec.aliases) {
      fs.writeFileSync(path.join(outPublic, `${alias}.glb`), glbBuffer);
      fs.writeFileSync(path.join(outExt, `${alias}.glb`), glbBuffer);
    }

    console.log(
      `Generated ${spec.id}.glb (${(glbBuffer.byteLength / 1024).toFixed(1)} KB) | outfit=${spec.outfitType} prop=${spec.prop} clips=${clips.map((c) => c.name).join(",")}`,
    );
  }
}

main().catch((err) => {
  console.error("Failed generating Buddy GLBs:", err);
  process.exit(1);
});
