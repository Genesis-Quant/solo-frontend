import type { KeyboardEvent } from "react";

export function isInputMethodComposing(event: KeyboardEvent<HTMLElement>) {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}
