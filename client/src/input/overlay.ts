// The one place that says "something in the DOM is on top of the menu canvas and owns the
// input right now": a modal is open (settings, pause, win), or the player is typing in a
// text field (chat). The menu scenes then ignore keys (scenes/flow.ts) and the stage
// canvas ignores the pointer (scenes/stage.ts).

export function overlayOwnsInput(): boolean {
  const focus = document.activeElement;
  return focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement || !!document.querySelector('.cu-modal.on');
}

/**
 * The pointer gate for a canvas under the DOM. Call `step()` once per frame: it returns
 * false while an overlay owns the input and for one whole frame after it has gone, so the
 * very click or tap that closed the overlay can never land on a canvas button behind it.
 */
export function pointerGate(): { step(): boolean } {
  /** Frames left before the pointer is the canvas's again. */
  let hold = 0;
  return {
    step() {
      if (overlayOwnsInput()) hold = 2;
      else if (hold > 0) hold--;
      return hold === 0;
    },
  };
}
