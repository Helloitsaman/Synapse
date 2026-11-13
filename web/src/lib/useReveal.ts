import { useEffect, useRef } from "react";
import gsap from "gsap";

/**
 * Subtle staggered entrance for elements marked `.reveal` within the scope.
 * Honors prefers-reduced-motion (no animation, elements just appear). Uses a
 * gsap.context for automatic cleanup — no scroll triggers, so the dashboard
 * stays fast.
 */
export function useReveal(deps: unknown[] = []) {
  const scope = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !scope.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".reveal", {
        opacity: 0,
        y: 12,
        duration: 0.4,
        ease: "power2.out",
        stagger: 0.05,
        clearProps: "all",
      });
    }, scope);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return scope;
}
