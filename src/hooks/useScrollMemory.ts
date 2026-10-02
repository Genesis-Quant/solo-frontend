import { useCallback, useLayoutEffect, useRef, type UIEvent } from "react";

import { isPrimaryPage, rememberPrimaryPage, usePageMemory } from "@/store/pageMemory";

export function useScrollMemory(pathname: string, contentReady = true) {
  const contentRef = useRef<HTMLDivElement>(null);
  const saveScroll = usePageMemory((state) => state.saveScroll);
  const pending = useRef<{ path: string; top: number; timer: number } | null>(null);
  const flushPending = useCallback(() => {
    if (!pending.current) return;
    window.clearTimeout(pending.current.timer);
    saveScroll(pending.current.path, pending.current.top);
    pending.current = null;
  }, [saveScroll]);

  useLayoutEffect(() => {
    rememberPrimaryPage(pathname);
    const element = contentRef.current;
    if (contentReady && element) {
      const primary = isPrimaryPage(pathname);
      const top = primary ? usePageMemory.getState().scroll[pathname] ?? 0 : 0;
      // Readiness means the real content is mounted; a shorter list should clamp once, not retry later.
      element.scrollTop = top;
      if (primary && element.scrollTop !== top) saveScroll(pathname, element.scrollTop);
    }

    function flushWhenHidden() {
      if (document.hidden) flushPending();
    }
    window.addEventListener("pagehide", flushPending);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushPending);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      flushPending();
    };
  }, [pathname, contentReady, saveScroll, flushPending]);

  function onScroll(event: UIEvent<HTMLDivElement>) {
    if (!contentReady || !isPrimaryPage(pathname)) return;
    const top = event.currentTarget.scrollTop;
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = { path: pathname, top, timer: window.setTimeout(flushPending, 150) };
  }

  return { contentRef, onScroll };
}
