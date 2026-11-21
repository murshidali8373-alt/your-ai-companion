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
