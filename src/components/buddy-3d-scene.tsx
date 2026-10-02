/**
 * Real-time 3D Buddy (spec §10). Browser-only: imported lazily from buddy-3d.tsx.
 * The starter GLBs are not skeletal-rigged yet, so emotions are expressed with
 * procedural whole-body motion (float, lean, nod, pulse) — no fake lip sync.
 */

import { Center, useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import type { Group } from "three";

import type { BuddyEmotion } from "@/components/buddy-avatar";

function Model({ url, emotion }: { url: string; emotion: BuddyEmotion }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const ref = useRef<Group>(null);

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    g.position.y = Math.sin(t * 1.6) * 0.04;
    switch (emotion) {
      case "listening":
        g.rotation.x = -0.08;
        g.rotation.y = Math.sin(t * 0.6) * 0.15;
        break;
      case "thinking":
        g.rotation.z = Math.sin(t * 1.2) * 0.06;
        g.rotation.y = 0.35 + Math.sin(t * 0.8) * 0.1;
        break;
      case "speaking":
        g.rotation.x = Math.sin(t * 6) * 0.03;
        g.rotation.y = Math.sin(t * 0.9) * 0.2;
        break;
      case "happy":
      case "celebrate":
        g.position.y = Math.abs(Math.sin(t * 4)) * 0.12;
        g.rotation.y = t * (emotion === "celebrate" ? 2 : 0.6);
        break;
      case "concerned":
        g.rotation.x = 0.1;
        g.rotation.y = Math.sin(t * 0.5) * 0.08;
        break;
      default:
        g.rotation.set(0, Math.sin(t * 0.4) * 0.25, 0);
    }
  });

  return (
    <group ref={ref}>
      <Center>
        <primitive object={cloned} />
      </Center>
    </group>
  );
}

export default function Buddy3DScene({
  url,
  emotion,
  quality,
}: {
  url: string;
  emotion: BuddyEmotion;
  quality: "balanced" | "high";
}) {
  return (
    <Canvas
      dpr={quality === "high" ? [1, 2] : 1}
      frameloop="always"
      camera={{ position: [0, 0.4, 3.2], fov: 35 }}
      gl={{ antialias: quality === "high", powerPreference: "low-power" }}
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[2, 3, 2]} intensity={1.2} />
      <directionalLight position={[-2, 1, -1]} intensity={0.4} />
      <Suspense fallback={null}>
        <Model url={url} emotion={emotion} />
      </Suspense>
    </Canvas>
  );
}
