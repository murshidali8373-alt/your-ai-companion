/**
 * ENGINE 6: VISUAL INTERACTION ENGINE
 *
 * Responsibilities:
 * - Kinematic calculation of connected arm pointing gestures (shoulder anchor → target element)
 * - Organic Bezier path calculations with elbow curvature and wrist articulation
 * - Target highlight ring positioning and explanatory callout geometry
 * - Buddy emotion mapping and mouth phoneme transitions
 */

export interface ArmKinematicsResult {
  shoulder: { x: number; y: number };
  elbow: { x: number; y: number };
  wrist: { x: number; y: number };
  target: { x: number; y: number };
  bezierPath: string;
  handAngleDeg: number;
}

export interface HighlightCalloutCoordinates {
  ringRect: { left: number; top: number; width: number; height: number };
  cardRect: { left: number; top: number };
}

/**
 * Calculates connected arm Bezier spline from Buddy's shoulder on viewport edge to target element
 */
export function calculateArmKinematics(
  targetRect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
  buddyAnchorWidth = 72,
): ArmKinematicsResult {
  // Buddy is fixed on right edge of viewport
  const shoulderX = viewport.width - buddyAnchorWidth / 2 - 12;
  const targetCenterY = targetRect.top + targetRect.height / 2;
  const shoulderY = Math.max(120, Math.min(viewport.height - 120, targetCenterY * 0.85));

  const targetX = Math.max(20, targetRect.left + targetRect.width / 2);
  const targetY = targetCenterY;

  // Intermediate elbow joint
  const midX = (shoulderX + targetX) / 2;
  const dy = targetY - shoulderY;
  const elbowCurveOffset = Math.sin(Math.min(Math.PI, Math.abs(dy) / 400)) * 60;
  const elbowX = midX + 25;
  const elbowY = (shoulderY + targetY) / 2 + (dy > 0 ? -elbowCurveOffset : elbowCurveOffset);

  // Wrist is positioned slightly before target fingertip
  const angleRad = Math.atan2(targetY - elbowY, targetX - elbowX);
  const wristX = targetX - Math.cos(angleRad) * 22;
  const wristY = targetY - Math.sin(angleRad) * 22;

  const handAngleDeg = Math.round((angleRad * 180) / Math.PI);

  const bezierPath = `M ${shoulderX.toFixed(1)} ${shoulderY.toFixed(1)} Q ${elbowX.toFixed(1)} ${elbowY.toFixed(1)} ${wristX.toFixed(1)} ${wristY.toFixed(1)}`;

  return {
    shoulder: { x: shoulderX, y: shoulderY },
    elbow: { x: elbowX, y: elbowY },
    wrist: { x: wristX, y: wristY },
    target: { x: targetX, y: targetY },
    bezierPath,
    handAngleDeg,
  };
}

/**
 * Computes optimal positioning for target ring and callout card
 */
export function calculateCalloutCoordinates(
  targetRect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
): HighlightCalloutCoordinates {
  const padding = 6;
  const ringRect = {
    left: Math.max(0, targetRect.left - padding),
    top: Math.max(0, targetRect.top - padding),
    width: targetRect.width + padding * 2,
    height: targetRect.height + padding * 2,
  };

  const cardWidth = 280;
  let cardLeft = targetRect.left;
  if (cardLeft + cardWidth > viewport.width - 20) {
    cardLeft = Math.max(10, viewport.width - cardWidth - 20);
  }

  let cardTop = targetRect.top + targetRect.height + 12;
  if (cardTop + 100 > viewport.height) {
    cardTop = Math.max(10, targetRect.top - 80);
  }

  return {
    ringRect,
    cardRect: { left: cardLeft, top: cardTop },
  };
}

export interface ViewportSnapshotMetrics {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  devicePixelRatio: number;
  zoomScale: number;
}

export interface CoordinateTargetValidation {
  valid: boolean;
  reason?: string;
  adjustedX?: number;
  adjustedY?: number;
}

/**
 * Validates that visual screenshot coordinates are still valid in the active viewport
 * and accounts for scroll, zoomScale, devicePixelRatio, and staleness expiry.
 */
export function validateCoordinateTarget(
  target: {
    x: number;
    y: number;
    scrollX: number;
    scrollY: number;
    viewportWidth: number;
    viewportHeight: number;
    devicePixelRatio: number;
    zoomScale: number;
    capturedAt: number;
    maxAgeMs?: number;
  },
  current: ViewportSnapshotMetrics,
  nowMs = Date.now(),
): CoordinateTargetValidation {
  const maxAgeMs = target.maxAgeMs ?? 8000;
  if (nowMs - target.capturedAt > maxAgeMs) {
    return { valid: false, reason: "Coordinate snapshot expired due to timeout." };
  }
  if (
    Math.abs(target.viewportWidth - current.width) > 12 ||
    Math.abs(target.viewportHeight - current.height) > 12
  ) {
    return { valid: false, reason: "Viewport resized; captured coordinates are stale." };
  }
  if (
    Math.abs(target.devicePixelRatio - current.devicePixelRatio) > 0.05 ||
    Math.abs(target.zoomScale - current.zoomScale) > 0.05
  ) {
    return { valid: false, reason: "Zoom level or DPR changed; captured coordinates invalidated." };
  }
  if (
    Math.abs(target.scrollX - current.scrollX) > 24 ||
    Math.abs(target.scrollY - current.scrollY) > 24
  ) {
    return { valid: false, reason: "Page scrolled after screenshot; coordinates invalidated." };
  }
  const adjustedX = Math.round(target.x);
  const adjustedY = Math.round(target.y);
  if (adjustedX < 0 || adjustedY < 0 || adjustedX > current.width || adjustedY > current.height) {
    return { valid: false, reason: "Target coordinate is outside current viewport." };
  }
  return { valid: true, adjustedX, adjustedY };
}

/**
 * Converts screenshot pixel coordinates (often DPR-scaled) to CSS viewport coordinates.
 */
export function scaleScreenshotPointToViewport(
  point: { x: number; y: number },
  screenshotSize: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const scaleX = screenshotSize.width > 0 ? viewport.width / screenshotSize.width : 1;
  const scaleY = screenshotSize.height > 0 ? viewport.height / screenshotSize.height : 1;
  return {
    x: Math.max(0, Math.min(viewport.width, Math.round(point.x * scaleX))),
    y: Math.max(0, Math.min(viewport.height, Math.round(point.y * scaleY))),
  };
}

/**
 * Zoom-aware arm kinematics accounting for visualViewport scale changes.
 */
export function calculateZoomAwareArmKinematics(
  targetRect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number; zoomScale?: number },
  buddyAnchorWidth = 72,
): ArmKinematicsResult {
  const zoom = viewport.zoomScale && viewport.zoomScale > 0 ? viewport.zoomScale : 1;
  const effectiveViewport = {
    width: viewport.width / zoom,
    height: viewport.height / zoom,
  };
  return calculateArmKinematics(targetRect, effectiveViewport, buddyAnchorWidth);
}

/**
 * Compares before vs after visual metadata (DPR-safe base64 lengths + URL + overlay status).
 */
export function compareVisualSnapshots(
  before: { url: string; screenshotBase64?: string | null },
  after: { url: string; screenshotBase64?: string | null },
): { visualChanged: boolean; urlChanged: boolean; summary: string } {
  const urlChanged = before.url !== after.url;
  const bData = (before.screenshotBase64 || "").replace(/^data:image\/[^;]+;base64,/, "");
  const aData = (after.screenshotBase64 || "").replace(/^data:image\/[^;]+;base64,/, "");
  const hasBothImages = Boolean(bData && aData);
  const visualChanged = urlChanged || (hasBothImages && bData !== aData);

  return {
    visualChanged,
    urlChanged,
    summary: urlChanged
      ? `Visual state navigated from ${before.url} to ${after.url}.`
      : visualChanged
        ? "Visible screenshot pixels changed after action."
        : hasBothImages
          ? "No visual pixel change detected between before and after screenshots."
          : "Screenshot comparison skipped (screenshot unavailable).",
  };
}

export interface DomVisualFusionInput {
  domRect?: { left: number; top: number; width: number; height: number } | null;
  visualPoint?: {
    x: number;
    y: number;
    screenshotWidth: number;
    screenshotHeight: number;
    scrollX: number;
    scrollY: number;
    devicePixelRatio: number;
    zoomScale: number;
    capturedAt: number;
  } | null;
  viewport: ViewportSnapshotMetrics;
  isOccluded?: boolean;
  isDetached?: boolean;
  nowMs?: number;
}

export interface DomVisualFusionResult {
  ok: boolean;
  source: "dom_and_visual" | "dom_only" | "visual_fallback" | "rejected";
  targetRect?: { left: number; top: number; width: number; height: number };
  centerPoint?: { x: number; y: number };
  armKinematics?: ArmKinematicsResult;
  callout?: HighlightCalloutCoordinates;
  reason?: string;
}

/**
 * Fuses DOM bounding box with DPR/zoom-scaled visual coordinates, rejecting detached,
 * occluded, scrolled, resized, or stale visual targets honestly.
 */
export function fuseDomAndVisualTarget(input: DomVisualFusionInput): DomVisualFusionResult {
  if (input.isDetached) {
    return { ok: false, source: "rejected", reason: "DOM element is detached from document." };
  }
  if (input.isOccluded) {
    return {
      ok: false,
      source: "rejected",
      reason: "Target element is occluded by a modal, overlay, or offscreen container.",
    };
  }

  let scaledVisual: { x: number; y: number } | undefined;
  let visualFailureReason: string | undefined;

  if (input.visualPoint) {
    const vpScaled = scaleScreenshotPointToViewport(
      { x: input.visualPoint.x, y: input.visualPoint.y },
      { width: input.visualPoint.screenshotWidth, height: input.visualPoint.screenshotHeight },
      { width: input.viewport.width, height: input.viewport.height },
    );
    const val = validateCoordinateTarget(
      {
        x: vpScaled.x,
        y: vpScaled.y,
        scrollX: input.visualPoint.scrollX,
        scrollY: input.visualPoint.scrollY,
        viewportWidth: input.viewport.width,
        viewportHeight: input.viewport.height,
        devicePixelRatio: input.visualPoint.devicePixelRatio,
        zoomScale: input.visualPoint.zoomScale,
        capturedAt: input.visualPoint.capturedAt,
      },
      input.viewport,
      input.nowMs ?? Date.now(),
    );
    if (val.valid && val.adjustedX !== undefined && val.adjustedY !== undefined) {
      scaledVisual = { x: val.adjustedX, y: val.adjustedY };
    } else {
      visualFailureReason = val.reason;
    }
  }

  if (input.domRect && input.domRect.width > 0 && input.domRect.height > 0) {
    const centerDom = {
      x: Math.round(input.domRect.left + input.domRect.width / 2),
      y: Math.round(input.domRect.top + input.domRect.height / 2),
    };
    const armKinematics = calculateZoomAwareArmKinematics(input.domRect, input.viewport);
    const callout = calculateCalloutCoordinates(input.domRect, input.viewport);

    if (scaledVisual) {
      const insideDom =
        scaledVisual.x >= input.domRect.left - 16 &&
        scaledVisual.x <= input.domRect.left + input.domRect.width + 16 &&
        scaledVisual.y >= input.domRect.top - 16 &&
        scaledVisual.y <= input.domRect.top + input.domRect.height + 16;

      return {
        ok: true,
        source: insideDom ? "dom_and_visual" : "dom_only",
        targetRect: input.domRect,
        centerPoint: centerDom,
        armKinematics,
        callout,
        reason: insideDom
          ? undefined
          : "Visual coordinate diverged from DOM bounding rect; anchored safely to live DOM rect.",
      };
    }

    return {
      ok: true,
      source: "dom_only",
      targetRect: input.domRect,
      centerPoint: centerDom,
      armKinematics,
      callout,
      reason: visualFailureReason,
    };
  }

  if (scaledVisual) {
    const syntheticRect = {
      left: Math.max(0, scaledVisual.x - 16),
      top: Math.max(0, scaledVisual.y - 16),
      width: 32,
      height: 32,
    };
    return {
      ok: true,
      source: "visual_fallback",
      targetRect: syntheticRect,
      centerPoint: scaledVisual,
      armKinematics: calculateZoomAwareArmKinematics(syntheticRect, input.viewport),
      callout: calculateCalloutCoordinates(syntheticRect, input.viewport),
    };
  }

  return {
    ok: false,
    source: "rejected",
    reason:
      visualFailureReason || "Neither valid DOM rect nor valid visual coordinates were available.",
  };
}

export type ContextualCommandType =
  | "fill_remaining_fields"
  | "click_previous_target"
  | "return_original_tab"
  | "undo_last_change"
  | "continue_where_stopped"
  | "compare_two_pages";

export function parseMultiTurnContextualCommand(instruction: string): {
  matched: boolean;
  commandType?: ContextualCommandType;
  explanation?: string;
} {
  const norm = instruction.toLowerCase().trim();
  if (
    /\b(?:fill\s+remaining\s+fields|remaining\s+fields|baaki\s+(?:fields?|sab)\s+(?:bhar|fill)\b)/i.test(
      norm,
    )
  ) {
    return {
      matched: true,
      commandType: "fill_remaining_fields",
      explanation: "Identify remaining unfilled fields from current form session state.",
    };
  }
  if (
    /\b(?:click\s+(?:that|this|it)\s+instead|us(?:par|ko)\s+click|doosre\s+wale\s+par\s+click)\b/i.test(
      norm,
    )
  ) {
    return {
      matched: true,
      commandType: "click_previous_target",
      explanation: "Resolve contextual target reference from active session history.",
    };
  }
  if (
    /\b(?:return\s+to\s+(?:the\s+)?original\s+tab|previous\s+tab|pichle\s+tab\s+(?:par|pe)\s+(?:wapas|jao))\b/i.test(
      norm,
    )
  ) {
    return {
      matched: true,
      commandType: "return_original_tab",
      explanation: "Switch browser focus back to recorded origin tab.",
    };
  }
  if (
    /\b(?:undo\s+(?:the\s+)?last\s+change|undo\s+last|pichla\s+change\s+undo|revert\s+last)\b/i.test(
      norm,
    )
  ) {
    return {
      matched: true,
      commandType: "undo_last_change",
      explanation: "Restore last reversible field/DOM modification from checkpoint.",
    };
  }
  if (
    /\b(?:continue\s+where\s+(?:you|we)\s+stopped|jahan\s+ruke\s+the\s+wahan\s+se|resume\s+checkpoint)\b/i.test(
      norm,
    )
  ) {
    return {
      matched: true,
      commandType: "continue_where_stopped",
      explanation: "Resume multi-step execution from last verified checkpoint.",
    };
  }
  if (
    /\b(?:compare\s+(?:(?:the|these|those|both)\s+)?(?:two\s+)?(?:pages?|tabs?)|(?:in\s+|ye\s+)?dono\s+(?:pages?|tabs?)\s+(?:ko\s+)?compare(?:\s+(?:karo|kro|(?:kar|kr)\s*do))?|dono\s+(?:pages?|tabs?)\s+ka\s+compar(?:e|ison)(?:\s+(?:karo|kro|dikhao))?)\b/i.test(
      norm,
    )
  ) {
    return {
      matched: true,
      commandType: "compare_two_pages",
      explanation: "Compare structured snapshots between active and origin/secondary tabs.",
    };
  }
  return { matched: false };
}
