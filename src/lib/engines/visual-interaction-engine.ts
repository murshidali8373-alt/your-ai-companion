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
