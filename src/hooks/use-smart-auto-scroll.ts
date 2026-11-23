import { useCallback, useEffect, useRef, useState } from "react";

export const DEFAULT_SCROLL_THRESHOLD_PX = 48;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Pure helper to determine whether the scroll viewport is anchored at/near the bottom.
 */
export function isNearBottom(
  metrics: ScrollMetrics,
  thresholdPx: number = DEFAULT_SCROLL_THRESHOLD_PX,
): boolean {
  if (metrics.scrollHeight <= metrics.clientHeight) return true;
  const distanceFromBottom = metrics.scrollHeight - (metrics.scrollTop + metrics.clientHeight);
  return distanceFromBottom <= thresholdPx;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function getAutoScrollBehavior(reduced: boolean = prefersReducedMotion()): ScrollBehavior {
  return reduced ? "auto" : "smooth";
}

/**
 * Determines whether a content update should scroll automatically or show the unread jump control.
 */
export function evaluateScrollUpdate(params: { wasAtBottom: boolean; userSentMessage: boolean }): {
  shouldScroll: boolean;
  markUnread: boolean;
} {
  if (params.userSentMessage || params.wasAtBottom) {
    return { shouldScroll: true, markUnread: false };
  }
  return { shouldScroll: false, markUnread: true };
}

export function useSmartAutoScroll<T extends HTMLElement = HTMLDivElement>({
  depKey,
  thresholdPx = DEFAULT_SCROLL_THRESHOLD_PX,
}: {
  depKey: unknown;
  thresholdPx?: number;
}) {
  const containerRef = useRef<T | null>(null);
  const isAtBottomRef = useRef(true);
  const pendingUserSendRef = useRef(false);
  const initialMountRef = useRef(true);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);

  const scrollToBottom = useCallback((forceInstant = false) => {
    const el = containerRef.current;
    if (!el) return;
    const behavior: ScrollBehavior = forceInstant ? "auto" : getAutoScrollBehavior();
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    setHasUnread(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const near = isNearBottom(
      {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      },
      thresholdPx,
    );
    isAtBottomRef.current = near;
    setIsAtBottom(near);
    if (near) {
      setHasUnread(false);
    }
  }, [thresholdPx]);

  const jumpToLatest = useCallback(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  const notifyUserMessageSent = useCallback(() => {
    pendingUserSendRef.current = true;
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    setHasUnread(false);
  }, []);

  // React to message / transcript updates without forcing scroll when user scrolled up
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      scrollToBottom(true);
      return;
    }
    const userSent = pendingUserSendRef.current;
    pendingUserSendRef.current = false;

    const decision = evaluateScrollUpdate({
      wasAtBottom: isAtBottomRef.current,
      userSentMessage: userSent,
    });

    if (decision.shouldScroll) {
      scrollToBottom(userSent && prefersReducedMotion());
    } else if (decision.markUnread) {
      setHasUnread(true);
    }
  }, [depKey, scrollToBottom]);

  // Keep pinned if inner content expands dynamically while user is already at bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (isAtBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  return {
    containerRef,
    isAtBottom,
    hasUnread,
    handleScroll,
    jumpToLatest,
    notifyUserMessageSent,
  };
}
