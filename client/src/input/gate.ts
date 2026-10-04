// The one place that says "the game is not listening to movement keys right now":
// a menu or panel is open on top of it (pause, settings, win), or Tab is holding the
// cube map and the arrows turn the map instead. The server keeps running; this only
// blocks local input.

let mapHeld = false;

export function setMapHeld(held: boolean): void {
  mapHeld = held;
}

export const isMapHeld = (): boolean => mapHeld;

export function inputPaused(): boolean {
  return mapHeld || !!document.querySelector('.cu-modal.on');
}
