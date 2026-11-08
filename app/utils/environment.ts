export const isTouchDevice =
  typeof window !== "undefined" &&
  (("ontouchstart" in window) || (navigator.maxTouchPoints ?? 0) > 0);

export const prefersReducedMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
