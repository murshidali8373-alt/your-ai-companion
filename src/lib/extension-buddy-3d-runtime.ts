import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  COMPANION_EMOTION_STATES,
  clipNameForCompanionState,
  detectPrivacyTrigger,
  normalizeCompanionState,
  resolveAutoCompanionState,
  shouldTransitionCompanionState,
  type CompanionEmotionState,
} from "./buddy-animation-engine";

export interface StageViewerOptions {
  initialVariant?: string | undefined;
  modelsBaseUrl?: string | undefined;
  onError?: ((err: unknown) => void) | undefined;
  onLoaded?: ((variant: string) => void) | undefined;
  onInteract?: (() => void) | undefined;
}

export interface StageViewerHandle {
  loadVariant: (slugOrId: string) => Promise<void>;
  setEmotion: (emotion: string) => void;
  setSpeaking: (speaking: boolean) => void;
  lookAt: (nx: number, ny: number) => void;
  setReducedMotion: (reduced: boolean) => void;
  getState: () => { variant: string; emotion: CompanionEmotionState };
  resize: () => void;
  destroy: () => void;
}

const VALID_VARIANTS: Record<string, string> = {
  general: "general",
  friendly: "general",
  dadaji: "general",
  ca: "ca",
  legal: "legal",
  ecommerce: "ecommerce",
  "e-commerce": "ecommerce",
  developer: "developer",
  tech: "developer",
  business: "business",
  operations: "business",
  marketing: "marketing",
  research: "research",
  detective: "research",
  data: "data",
  content: "content",
  design: "design",
  professor: "professor",
  study: "professor",
};

export function resolveModelVariantSlug(slugOrId?: string | null): string {
  const clean = String(slugOrId || "general")
    .toLowerCase()
    .trim();
  if (clean.startsWith("custom:")) return "ecommerce";
  return VALID_VARIANTS[clean] || "general";
}

function detectSoftwareWebGL(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return false;
    const rendererStr = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || "");
    return /SwiftShader|llvmpipe|softpipe/i.test(rendererStr);
  } catch {
    return false;
  }
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
    grad.addColorStop(0, "rgba(6, 10, 20, 0.55)");
    grad.addColorStop(0.55, "rgba(6, 10, 20, 0.22)");
    grad.addColorStop(1, "rgba(6, 10, 20, 0.0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function disposeObjectTree(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        for (const k of Object.keys(m)) {
          const val = (m as unknown as Record<string, unknown>)[k];
          if (val && typeof val === "object" && "isTexture" in val) {
            (val as THREE.Texture).dispose();
          }
        }
        m.dispose();
      }
    }
  });
}

export function isWebGLSupported(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function createStageViewer(
  containerEl: HTMLElement,
  options: StageViewerOptions = {},
): StageViewerHandle {
  const modelsBaseUrl = (options.modelsBaseUrl || "./models").replace(/\/$/, "");
  let currentVariant = resolveModelVariantSlug(options.initialVariant || "general");
  let currentEmotion: CompanionEmotionState = "idle";
  let isSpeaking = false;
  let reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  const glCtx = renderer.getContext();
  const isSoftwareGl = detectSoftwareWebGL(glCtx);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setPixelRatio(
    isSoftwareGl
      ? 1
      : Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2),
  );
  renderer.shadowMap.enabled = !isSoftwareGl;
  if (!isSoftwareGl) {
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "pan-y";
  containerEl.innerHTML = "";
  containerEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Studio IBL via RoomEnvironment
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envTarget = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.72;
  roomEnv.dispose();

  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 20);
  camera.position.set(0, 0.92, 3.05);
  camera.lookAt(0, 0.78, 0);

  // Cohesive warm key / cool sky + fill lighting
  const hemiLight = new THREE.HemisphereLight(0xdcebff, 0x262c3a, 0.78);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff1de, 1.55);
  keyLight.position.set(2.2, 3.6, 2.8);
  if (!isSoftwareGl) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(512, 512);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 9;
    keyLight.shadow.camera.left = -1.2;
    keyLight.shadow.camera.right = 1.2;
    keyLight.shadow.camera.top = 2.0;
    keyLight.shadow.camera.bottom = -0.3;
    keyLight.shadow.bias = -0.0005;
  }
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x9fe6dc, 0.65);
  rimLight.position.set(-2.4, 2.1, -2.0);
  scene.add(rimLight);

  // Grounded contact shadow disc
  const shadowTex = createContactShadowTexture();
  const shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.95),
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
    }),
  );
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.set(0, 0.002, 0.03);
  scene.add(shadowMesh);

  const characterAnchor = new THREE.Group();
  scene.add(characterAnchor);

  const loader = new GLTFLoader();
  let activeModelRoot: THREE.Object3D | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let actions: Record<string, THREE.AnimationAction> = {};
  let activeClipName: "Idle" | "Wave" | "Point" | "Talk" = "Idle";

  // Node handles for responsive procedural expression overlays
  let rigHead: THREE.Object3D | null = null;
  let rigTorso: THREE.Object3D | null = null;
  let rigPelvis: THREE.Object3D | null = null;
  let rigEyeL: THREE.Object3D | null = null;
  let rigEyeR: THREE.Object3D | null = null;
  let rigBrowL: THREE.Object3D | null = null;
  let rigBrowR: THREE.Object3D | null = null;
  let rigMouthOpen: THREE.Object3D | null = null;
  let rigMouthSmile: THREE.Object3D | null = null;

  // Interactive turntable rotation (inspect front / side / back cleanly)
  let dragYaw = 0;
  let isDragging = false;
  let pointerStartX = 0;
  let pointerMoved = false;
  let gazeX = 0;
  let gazeY = 0;

  // Additive procedural damp targets
  const cur = {
    bodyYaw: 0,
    bodyY: 0,
    headX: 0,
    headY: 0,
    headZ: 0,
    torsoX: 0,
    torsoZ: 0,
    eyeScaleY: 1,
    browTilt: 0,
    browLift: 0,
    mouthOpenY: 0.05,
    smileScale: 1,
  };

  // Pre-allocated math helpers outside render loop
  let disposed = false;
  let rafId = 0;
  let swTimerId: ReturnType<typeof setTimeout> | null = null;
  let lastTime = typeof performance !== "undefined" ? performance.now() : 0;
  let loadSeq = 0;

  function resize() {
    if (disposed) return;
    const w = Math.max(containerEl.clientWidth || 128, 96);
    const h = Math.max(containerEl.clientHeight || 128, 96);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function switchAnimationClip(clipName: "Idle" | "Wave" | "Point" | "Talk") {
    if (!mixer || !actions[clipName]) return;
    if (activeClipName === clipName && actions[clipName].isRunning()) return;
    const prevAction = actions[activeClipName];
    const nextAction = actions[clipName];
    nextAction.reset();
    nextAction.setEffectiveWeight(1);
    nextAction.setEffectiveTimeScale(1);
    nextAction.play();
    if (prevAction && prevAction !== nextAction) {
      prevAction.crossFadeTo(nextAction, 0.25, true);
    }
    activeClipName = clipName;
  }

  async function loadVariant(slugOrId: string) {
    const slug = resolveModelVariantSlug(slugOrId);
    const url = `${modelsBaseUrl}/${slug}.glb`;
    const seq = ++loadSeq;
    try {
      const gltf = await loader.loadAsync(url);
      if (disposed || seq !== loadSeq) {
        disposeObjectTree(gltf.scene);
        return;
      }

      if (activeModelRoot) {
        characterAnchor.remove(activeModelRoot);
        disposeObjectTree(activeModelRoot);
        activeModelRoot = null;
      }
      if (mixer) {
        mixer.stopAllAction();
        mixer = null;
      }
      actions = {};

      const model = gltf.scene;
      model.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          node.castShadow = !isSoftwareGl;
          node.receiveShadow = !isSoftwareGl;
        }
      });

      characterAnchor.add(model);
      activeModelRoot = model;
      currentVariant = slug;

      rigHead = model.getObjectByName("Head") || null;
      rigTorso = model.getObjectByName("Torso") || null;
      rigPelvis = model.getObjectByName("Pelvis") || null;
      rigEyeL = model.getObjectByName("Eye_L") || null;
      rigEyeR = model.getObjectByName("Eye_R") || null;
      rigBrowL = model.getObjectByName("Brow_L") || null;
      rigBrowR = model.getObjectByName("Brow_R") || null;
      rigMouthOpen = model.getObjectByName("MouthOpen") || null;
      rigMouthSmile = model.getObjectByName("MouthSmile") || null;

      mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations || []) {
        actions[clip.name] = mixer.clipAction(clip);
      }

      const targetClip = clipNameForCompanionState(isSpeaking ? "talking" : currentEmotion);
      if (actions[targetClip]) {
        activeClipName = targetClip;
        actions[targetClip].play();
      } else if (actions.Idle) {
        activeClipName = "Idle";
        actions.Idle.play();
      }

      options.onLoaded?.(slug);
    } catch (err) {
      if (!disposed) {
        options.onError?.(err);
      }
    }
  }

  function setEmotion(rawEmotion: string) {
    currentEmotion = normalizeCompanionState(rawEmotion);
    const targetState = isSpeaking && currentEmotion !== "privacy" ? "talking" : currentEmotion;
    switchAnimationClip(clipNameForCompanionState(targetState));
  }

  function setSpeaking(speaking: boolean) {
    isSpeaking = Boolean(speaking);
    if (currentEmotion === "privacy") return;
    const targetState = isSpeaking ? "talking" : currentEmotion;
    switchAnimationClip(clipNameForCompanionState(targetState));
  }

  function lookAt(nx: number, ny: number) {
    gazeX = THREE.MathUtils.clamp(nx, -1, 1);
    gazeY = THREE.MathUtils.clamp(ny, -1, 1);
  }

  function setReducedMotion(val: boolean) {
    reducedMotion = Boolean(val);
    if (mixer) mixer.timeScale = reducedMotion ? 0 : 1;
  }

  // Pointer handlers (allow dragging to inspect 360 front/side/back OR quick click to interact)
  const onPointerDown = (e: PointerEvent) => {
    isDragging = true;
    pointerMoved = false;
    pointerStartX = e.clientX;
    renderer.domElement.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - pointerStartX;
    if (Math.abs(dx) > 4) pointerMoved = true;
    dragYaw += dx * 0.015;
    pointerStartX = e.clientX;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    renderer.domElement.releasePointerCapture?.(e.pointerId);
    if (!pointerMoved) {
      options.onInteract?.();
    }
  };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  ro?.observe(containerEl);
  resize();

  function tick(now: number) {
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;
    const t = now * 0.001;

    if (mixer) {
      mixer.update(reducedMotion ? 0 : dt);
    }

    // Smoothly return dragYaw back to front/resting orientation when released
    if (!isDragging) {
      dragYaw = THREE.MathUtils.damp(dragYaw, 0, 4.5, dt);
    }

    // Compute procedural expression overlay targets for all 12 core emotional states
    const effective = isSpeaking && currentEmotion !== "privacy" ? "talking" : currentEmotion;
    let targetBodyYaw = dragYaw;
    let targetBodyY = 0;
    let targetHeadX = gazeY * 0.1;
    let targetHeadY = gazeX * 0.22;
    let targetHeadZ = 0;
    let targetTorsoX = 0;
    let targetTorsoZ = 0;
    let targetEyeScaleY = 1;
    let targetBrowTilt = 0;
    let targetBrowLift = 0;
    let targetMouthOpen = 0.05;
    let targetSmileScale = 1;

    switch (effective) {
      case "privacy":
        // Smoothly turns head & torso away from screen and closes eyelids
        targetBodyYaw = dragYaw + 0.62;
        targetHeadY = 0.72;
        targetHeadX = 0.14;
        targetHeadZ = -0.06;
        targetEyeScaleY = 0.07;
        targetBrowLift = -0.004;
        targetSmileScale = 0.85;
        break;
      case "happy":
      case "success":
        targetBodyY = reducedMotion ? 0 : Math.abs(Math.sin(t * 5.2)) * 0.032;
        targetHeadX = -0.05;
        targetHeadZ = Math.sin(t * 2.8) * 0.05;
        targetBrowLift = 0.01;
        targetSmileScale = 1.15;
        break;
      case "excited":
        targetBodyY = reducedMotion ? 0 : Math.abs(Math.sin(t * 7.2)) * 0.055;
        targetHeadX = -0.08;
        targetHeadZ = Math.sin(t * 4.5) * 0.07;
        targetBrowLift = 0.014;
        targetSmileScale = 1.22;
        break;
      case "thinking":
        targetHeadX = -0.06;
        targetHeadY = 0.22 + gazeX * 0.1;
        targetHeadZ = 0.13;
        targetTorsoZ = 0.04;
        targetBrowTilt = 0.14;
        targetSmileScale = 0.82;
        break;
      case "pointing":
        targetHeadY = -0.22;
        targetHeadX = 0.03;
        targetTorsoZ = -0.05;
        targetBrowLift = 0.008;
        break;
      case "talking":
        targetHeadX = Math.sin(t * 6.0) * 0.04;
        targetMouthOpen = reducedMotion ? 0.3 : 0.25 + Math.abs(Math.sin(t * 14.0)) * 0.65;
        targetBrowLift = 0.006;
        break;
      case "listening":
        targetTorsoX = 0.08;
        targetHeadX = 0.05 + gazeY * 0.08;
        targetHeadZ = -0.08;
        targetBrowLift = 0.01;
        break;
      case "confused":
        targetHeadZ = 0.17;
        targetHeadY = -0.1;
        targetBrowTilt = 0.26;
        targetSmileScale = 0.78;
        break;
      case "concerned":
        targetHeadX = 0.12;
        targetTorsoX = 0.05;
        targetBrowTilt = -0.22;
        targetBrowLift = -0.006;
        targetSmileScale = 0.72;
        break;
      case "error":
        targetHeadX = 0.1;
        targetHeadZ = reducedMotion ? 0 : Math.sin(t * 10.0) * 0.06;
        targetBrowTilt = -0.28;
        targetBrowLift = -0.008;
        targetSmileScale = 0.68;
        break;
      case "idle":
      default:
        break;
    }

    const dampRate = 9.0;
    cur.bodyYaw = THREE.MathUtils.damp(cur.bodyYaw, targetBodyYaw, dampRate, dt);
    cur.bodyY = THREE.MathUtils.damp(cur.bodyY, targetBodyY, dampRate, dt);
    cur.headX = THREE.MathUtils.damp(cur.headX, targetHeadX, dampRate, dt);
    cur.headY = THREE.MathUtils.damp(cur.headY, targetHeadY, dampRate, dt);
    cur.headZ = THREE.MathUtils.damp(cur.headZ, targetHeadZ, dampRate, dt);
    cur.torsoX = THREE.MathUtils.damp(cur.torsoX, targetTorsoX, dampRate, dt);
    cur.torsoZ = THREE.MathUtils.damp(cur.torsoZ, targetTorsoZ, dampRate, dt);
    cur.eyeScaleY = THREE.MathUtils.damp(cur.eyeScaleY, targetEyeScaleY, 14.0, dt);
    cur.browTilt = THREE.MathUtils.damp(cur.browTilt, targetBrowTilt, dampRate, dt);
    cur.browLift = THREE.MathUtils.damp(cur.browLift, targetBrowLift, dampRate, dt);
    cur.mouthOpenY = THREE.MathUtils.damp(cur.mouthOpenY, targetMouthOpen, 18.0, dt);
    cur.smileScale = THREE.MathUtils.damp(cur.smileScale, targetSmileScale, dampRate, dt);

    characterAnchor.rotation.y = cur.bodyYaw;
    characterAnchor.position.y = cur.bodyY;

    if (rigTorso) {
      rigTorso.rotation.x = cur.torsoX;
      rigTorso.rotation.z = cur.torsoZ;
    }
    if (rigHead) {
      rigHead.rotation.x += cur.headX;
      rigHead.rotation.y += cur.headY;
      rigHead.rotation.z += cur.headZ;
    }
    if (rigEyeL && rigEyeR) {
      if (effective === "privacy") {
        rigEyeL.scale.y = cur.eyeScaleY;
        rigEyeR.scale.y = cur.eyeScaleY;
      } else if (effective === "confused") {
        rigEyeR.scale.y = Math.min(rigEyeR.scale.y, 0.72);
      }
    }
    if (rigBrowL && rigBrowR) {
      rigBrowL.position.y = 0.038 + cur.browLift;
      rigBrowR.position.y = 0.038 + cur.browLift;
      rigBrowL.rotation.z = cur.browTilt;
      rigBrowR.rotation.z = -cur.browTilt * 0.75;
    }
    if (rigMouthOpen && effective === "talking") {
      rigMouthOpen.scale.y = cur.mouthOpenY;
    }
    if (rigMouthSmile) {
      rigMouthSmile.scale.set(
        cur.smileScale,
        effective === "error" || effective === "concerned" ? -0.55 : cur.smileScale,
        1,
      );
      if (effective === "error" || effective === "concerned") {
        rigMouthSmile.position.y = -0.155;
      } else {
        rigMouthSmile.position.y = 0;
      }
    }
    if (rigPelvis) {
      shadowMesh.scale.setScalar(1 - cur.bodyY * 1.4);
    }

    renderer.render(scene, camera);

    if (isSoftwareGl) {
      swTimerId = setTimeout(() => {
        rafId = requestAnimationFrame(tick);
      }, 45);
    } else {
      rafId = requestAnimationFrame(tick);
    }
  }

  rafId = requestAnimationFrame(tick);
  loadVariant(currentVariant);

  return {
    loadVariant,
    setEmotion,
    setSpeaking,
    lookAt,
    setReducedMotion,
    getState: () => ({ variant: currentVariant, emotion: currentEmotion }),
    resize,
    destroy: () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      if (swTimerId) clearTimeout(swTimerId);
      ro?.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (activeModelRoot) disposeObjectTree(activeModelRoot);
      disposeObjectTree(shadowMesh);
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      containerEl.innerHTML = "";
    },
  };
}

// Expose self-contained runtime globally for Chrome Extension MV3 sidepanel
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).Buddy3DRuntime = {
    COMPANION_EMOTION_STATES,
    isSupported: isWebGLSupported,
    createStageViewer,
    resolveModelVariantSlug,
    normalizeCompanionState,
    detectPrivacyTrigger,
    resolveAutoCompanionState,
    clipNameForCompanionState,
    shouldTransitionCompanionState,
  };
}
