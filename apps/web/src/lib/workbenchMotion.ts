import { useLayoutEffect, useRef, useState } from "react";
import { useMediaQuery } from "~/hooks/useMediaQuery";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
export const workbenchEase = "cubic-bezier(.2,.8,.2,1)";

/** One finite DOM animation; preference changes and unmounts cancel it. */
export function animateWorkbenchOnce(
  element: Element,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
): () => void {
  const preference = window.matchMedia(REDUCED_MOTION);
  if (preference.matches || typeof element.animate !== "function") return () => {};
  let animation: Animation;
  try {
    animation = element.animate(frames, options);
  } catch {
    // Older clients may not support a pseudo-element animation; the live DOM is already correct.
    return () => {};
  }
  const stop = () => {
    preference.removeEventListener("change", stop);
    animation.removeEventListener("finish", stop);
    animation.removeEventListener("cancel", stop);
    animation.cancel();
  };
  preference.addEventListener("change", stop);
  animation.addEventListener("finish", stop);
  animation.addEventListener("cancel", stop);
  return stop;
}

export function useInboxCountBounce(count: number) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(count);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Animate the DOM badge once when the committed count changes.
  useLayoutEffect(() => {
    const changed = previous.current !== count;
    previous.current = count;
    if (!changed || !ref.current) return;
    return animateWorkbenchOnce(
      ref.current,
      [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }],
      { duration: 300, easing: workbenchEase },
    );
  }, [count]);
  return ref;
}

export function useInboxExitRows<T extends { key: string }>(
  rows: readonly T[],
  allKeys: Set<string>,
) {
  const reduced = useMediaQuery(REDUCED_MOTION);
  const signature = JSON.stringify(rows);
  const [previous, setPrevious] = useState({ signature, rows });
  const [exiting, setExiting] = useState<readonly T[]>([]);
  const timers = useRef(new Map<T, ReturnType<typeof setTimeout>>());
  if (previous.signature !== signature) {
    setPrevious({ signature, rows });
    const removed = previous.rows.filter((row) => !allKeys.has(row.key));
    if (removed.length && !reduced) {
      setExiting([...exiting.filter((row) => !removed.some((r) => r.key === row.key)), ...removed]);
    }
  }
  if (reduced && exiting.length) setExiting([]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Each inert DOM snapshot gets one removal deadline, independent of later removals.
  useLayoutEffect(() => {
    const pending = timers.current;
    for (const [row, timer] of pending) {
      if (reduced || !exiting.includes(row)) {
        clearTimeout(timer);
        pending.delete(row);
      }
    }
    if (reduced) return;
    for (const row of exiting) {
      if (pending.has(row)) continue;
      pending.set(
        row,
        setTimeout(() => {
          pending.delete(row);
          setExiting((current) => current.filter((entry) => entry !== row));
        }, 350),
      );
    }
  }, [exiting, reduced]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Cancel pending finite DOM-removal deadlines when the inbox unmounts.
  useLayoutEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);
  return reduced ? [] : exiting.filter((row) => !allKeys.has(row.key));
}
