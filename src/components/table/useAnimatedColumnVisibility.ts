import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

export type ColumnAnimationPhase = "entering" | "exiting";
export type ColumnVisibility = Record<string, boolean>;
type VisibilityUpdater = ColumnVisibility | ((current: ColumnVisibility) => ColumnVisibility);

const animationDuration = 200;

export function useAnimatedColumnVisibility(initialVisibility: ColumnVisibility) {
  const reducedMotion = useReducedMotion();
  const duration = reducedMotion ? 0 : animationDuration;
  const targetRef = useRef(initialVisibility);
  const renderedRef = useRef(initialVisibility);
  const timers = useRef(new Map<string, number>());
  const [targetVisibility, setTargetVisibility] = useState(initialVisibility);
  const [renderedVisibility, setRenderedVisibility] = useState(initialVisibility);
  const [animationPhases, setAnimationPhases] = useState<Record<string, ColumnAnimationPhase>>({});

  const clearTimer = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const setVisibility = useCallback((updater: VisibilityUpdater) => {
    const previous = targetRef.current;
    const next = typeof updater === "function" ? updater(previous) : updater;
    targetRef.current = next;
    setTargetVisibility(next);

    const ids = new Set([...Object.keys(previous), ...Object.keys(next)]);
    ids.forEach((id) => {
      const wasVisible = previous[id] !== false;
      const visible = next[id] !== false;
      if (wasVisible === visible) return;

      clearTimer(id);
      if (visible) {
        renderedRef.current = { ...renderedRef.current, [id]: true };
        setRenderedVisibility(renderedRef.current);
        if (!duration) {
          setAnimationPhases((current) => omit(current, id));
          return;
        }
        setAnimationPhases((current) => ({ ...current, [id]: "entering" }));
        timers.current.set(id, window.setTimeout(() => {
          timers.current.delete(id);
          setAnimationPhases((current) => omit(current, id));
        }, duration));
        return;
      }

      if (!duration) {
        renderedRef.current = { ...renderedRef.current, [id]: false };
        setRenderedVisibility(renderedRef.current);
        setAnimationPhases((current) => omit(current, id));
        return;
      }
      setAnimationPhases((current) => ({ ...current, [id]: "exiting" }));
      timers.current.set(id, window.setTimeout(() => {
        timers.current.delete(id);
        renderedRef.current = { ...renderedRef.current, [id]: false };
        setRenderedVisibility(renderedRef.current);
        setAnimationPhases((current) => omit(current, id));
      }, duration));
    });
  }, [clearTimer, duration]);

  const resetVisibility = useCallback((visibility: ColumnVisibility) => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
    targetRef.current = visibility;
    renderedRef.current = visibility;
    setTargetVisibility(visibility);
    setRenderedVisibility(visibility);
    setAnimationPhases({});
  }, []);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  return { animationPhases, renderedVisibility, resetVisibility, setVisibility, targetVisibility };
}

function omit<T>(record: Record<string, T>, id: string) {
  if (!(id in record)) return record;
  const next = { ...record };
  delete next[id];
  return next;
}
