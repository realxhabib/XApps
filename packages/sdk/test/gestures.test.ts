import { describe, expect, it } from "vitest";
import { calmPage, lockGestures } from "../src/gestures";

function touch(type: string): TouchEvent {
  return new Event(type, { cancelable: true, bubbles: true }) as TouchEvent;
}

describe("lockGestures", () => {
  it("stops touch scrolling on the element and undoes it", () => {
    const el = document.createElement("canvas");
    el.style.touchAction = "pan-y";
    document.body.appendChild(el);
    const unlock = lockGestures(el);
    expect(el.style.touchAction).toBe("none");
    const move = touch("touchmove");
    el.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);

    unlock();
    expect(el.style.touchAction).toBe("pan-y");
    const after = touch("touchmove");
    el.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("is a no-op without an element", () => {
    expect(() => lockGestures(null)()).not.toThrow();
  });
});

describe("calmPage", () => {
  it("switches off overscroll on html and body", () => {
    calmPage(document);
    expect(document.documentElement.style.overscrollBehavior).toBe("none");
    expect(document.body.style.overscrollBehavior).toBe("none");
  });
});
