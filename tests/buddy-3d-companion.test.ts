import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPANION_EMOTION_STATES,
  clipNameForCompanionState,
  detectPrivacyTrigger,
  normalizeCompanionState,
  resolveAutoCompanionState,
  shouldTransitionCompanionState,
} from "../src/lib/buddy-animation-engine";
import { buddyModelUrl } from "../src/lib/buddy-visuals";

const ROOT = process.cwd();

const EXPECTED_VARIANTS = [
  "general",
  "friendly",
  "ca",
  "legal",
  "ecommerce",
  "developer",
  "business",
  "operations",
  "marketing",
  "research",
  "detective",
  "data",
  "content",
  "design",
  "professor",
  "dadaji",
];

function parseGlbJsonChunk(filePath: string) {
  const buf = fs.readFileSync(filePath);
  // Header: magic (4), version (4), totalLength (4)
  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  const totalLen = buf.readUInt32LE(8);
  const chunk0Len = buf.readUInt32LE(12);
  const chunk0Type = buf.readUInt32LE(16);
  const jsonText = buf.subarray(20, 20 + chunk0Len).toString("utf8");
  return {
    magic,
    version,
    totalLen,
    byteLength: buf.byteLength,
    chunk0Type,
    gltf: JSON.parse(jsonText) as {
      nodes?: Array<{ name?: string }>;
      animations?: Array<{ name?: string }>;
      meshes?: Array<{ name?: string }>;
    },
  };
}

describe("3D Buddy GLB Mascot Assets & Shared Rig", () => {
  it("bundles valid glTF 2.0 GLBs for every Buddy variant in both public/models/buddies and extension/models", () => {
    const requiredRigNodes = [
      "Root",
      "Pelvis",
      "Torso",
      "Head",
      "Eye_L",
      "Eye_R",
      "Shoulder_R",
      "Shoulder_L",
    ];
    const requiredClips = ["Idle", "Wave", "Point", "Talk"];

    for (const variant of EXPECTED_VARIANTS) {
      const publicPath = path.join(ROOT, "public", "models", "buddies", `${variant}.glb`);
      const extPath = path.join(ROOT, "extension", "models", `${variant}.glb`);
      expect(fs.existsSync(publicPath)).toBe(true);
      expect(fs.existsSync(extPath)).toBe(true);

      const parsed = parseGlbJsonChunk(extPath);
      expect(parsed.magic).toBe(0x46546c67); // "glTF"
      expect(parsed.version).toBe(2);
      expect(parsed.totalLen).toBe(parsed.byteLength);
      expect(parsed.byteLength).toBeGreaterThan(100_000);

      const nodeNames = new Set((parsed.gltf.nodes || []).map((n) => n.name));
      for (const node of requiredRigNodes) {
        expect(nodeNames.has(node)).toBe(true);
      }

      const clipNames = new Set((parsed.gltf.animations || []).map((a) => a.name));
      for (const clip of requiredClips) {
        expect(clipNames.has(clip)).toBe(true);
      }
    }
  });

  it("preserves distinct outfits and props per specialist variant (not identical clones)", () => {
    const devSize = fs.statSync(path.join(ROOT, "extension", "models", "developer.glb")).size;
    const generalSize = fs.statSync(path.join(ROOT, "extension", "models", "general.glb")).size;
    const caSize = fs.statSync(path.join(ROOT, "extension", "models", "ca.glb")).size;
    const businessSize = fs.statSync(path.join(ROOT, "extension", "models", "business.glb")).size;

    const sizes = new Set([devSize, generalSize, caSize, businessSize]);
    expect(sizes.size).toBeGreaterThanOrEqual(3);
  });

  it("maps buddy ids cleanly to local glb URLs via buddyModelUrl", () => {
    expect(buddyModelUrl("friendly")).toBe("/models/buddies/general.glb");
    expect(buddyModelUrl("developer")).toBe("/models/buddies/developer.glb");
    expect(buddyModelUrl("ca")).toBe("/models/buddies/ca.glb");
    expect(buddyModelUrl("ecommerce")).toBe("/models/buddies/ecommerce.glb");
    expect(buddyModelUrl(undefined)).toBe("/models/buddies/general.glb");
  });
});

describe("Automatic Emotion & Privacy Companion Engine", () => {
  it("supports all 12 core emotion states and normalizes aliases safely", () => {
    expect(COMPANION_EMOTION_STATES).toHaveLength(12);
    expect(normalizeCompanionState("curious")).toBe("confused");
    expect(normalizeCompanionState("celebrate")).toBe("excited");
    expect(normalizeCompanionState("speaking")).toBe("talking");
    expect(normalizeCompanionState("working")).toBe("thinking");
    expect(normalizeCompanionState("sad")).toBe("concerned");
    expect(normalizeCompanionState("look_away")).toBe("privacy");
    expect(normalizeCompanionState("done")).toBe("success");
    expect(normalizeCompanionState("failed")).toBe("error");
    expect(normalizeCompanionState(undefined)).toBe("idle");
  });

  it("triggers privacy posture automatically on sensitive fields or explicit requests", () => {
    expect(detectPrivacyTrigger({ userText: "Buddy please look away" })).toEqual({
      isPrivacy: true,
      reason: "explicit_request",
    });
    expect(detectPrivacyTrigger({ userText: "aankhein band karo" }).isPrivacy).toBe(true);
    expect(detectPrivacyTrigger({ pageHasPasswordFocused: true }).isPrivacy).toBe(true);
    expect(detectPrivacyTrigger({ activeFieldType: "password" }).isPrivacy).toBe(true);
    expect(detectPrivacyTrigger({ activeFieldLabel: "Enter OTP Code" }).isPrivacy).toBe(true);
    expect(detectPrivacyTrigger({ actionTarget: "CVV" }).isPrivacy).toBe(true);
    expect(detectPrivacyTrigger({ userText: "Fill my Aadhaar number" }).isPrivacy).toBe(true);
    expect(detectPrivacyTrigger({ userText: "Search laptops on Flipkart" }).isPrivacy).toBe(false);
  });

  it("never claims verified success when verification fails or errors exist, and prioritizes privacy", () => {
    expect(
      resolveAutoCompanionState({
        event: "task_complete",
        verified: false,
      }),
    ).toBe("concerned");

    expect(
      resolveAutoCompanionState({
        event: "task_complete",
        verified: true,
      }),
    ).toBe("success");

    expect(
      resolveAutoCompanionState({
        event: "task_complete",
        verified: true,
        activeFieldType: "password",
      }),
    ).toBe("privacy");

    expect(
      resolveAutoCompanionState({
        event: "clicking",
        verified: false,
      }),
    ).toBe("concerned");

    expect(
      resolveAutoCompanionState({
        event: "pointing",
        actionTarget: "Submit Order",
      }),
    ).toBe("pointing");
  });

  it("maps core states to base GLB clips and throttles non-urgent jitter", () => {
    expect(clipNameForCompanionState("pointing")).toBe("Point");
    expect(clipNameForCompanionState("talking")).toBe("Talk");
    expect(clipNameForCompanionState("success")).toBe("Wave");
    expect(clipNameForCompanionState("privacy")).toBe("Idle");

    expect(shouldTransitionCompanionState("idle", "privacy", 10)).toBe(true);
    expect(shouldTransitionCompanionState("privacy", "idle", 400)).toBe(false);
    expect(shouldTransitionCompanionState("idle", "thinking", 50)).toBe(false);
    expect(shouldTransitionCompanionState("idle", "thinking", 200)).toBe(true);
  });
});

describe("One Buddy Everywhere & Offline MV3 Compliance", () => {
  it("removes duplicate webpage mascot overlay while preserving ring highlight & callout in extension/background.js", () => {
    const bgCode = fs.readFileSync(path.join(ROOT, "extension", "background.js"), "utf8");
    expect(bgCode).not.toContain("buddy-anchor");
    expect(bgCode).not.toContain('id="buddyAnchor"');
    expect(bgCode).toContain(".ring");
    expect(bgCode).toContain(".card");
    expect(bgCode).toContain("pointerOrigin");
    expect(bgCode).toContain("pointerTip");
  });

  it("wires local offline 3D runtime & removes manual animation trigger UI from extension/sidepanel.html", () => {
    const html = fs.readFileSync(path.join(ROOT, "extension", "sidepanel.html"), "utf8");
    expect(html).toContain('id="buddy3dCanvasWrap"');
    expect(html).toContain('<script src="vendor/buddy-3d-runtime.js"></script>');
    expect(html).toContain('<option value="3d" selected>');
    expect(html).not.toContain("btnEmoCurious");
    expect(html).not.toContain("testArmWaveBtn");
    expect(html).not.toContain("testMouthTalkBtn");
    expect(html).not.toContain("Test CSS Emotion Animations");
  });

  it("bundles standalone offline extension/vendor/buddy-3d-runtime.js without remote CDN links", () => {
    const runtimePath = path.join(ROOT, "extension", "vendor", "buddy-3d-runtime.js");
    expect(fs.existsSync(runtimePath)).toBe(true);
    const code = fs.readFileSync(runtimePath, "utf8");
    expect(code.length).toBeGreaterThan(50_000);
    expect(code).not.toMatch(/https?:\/\/(?:cdn\.|unpkg\.com|esm\.sh)/i);
  });
});
