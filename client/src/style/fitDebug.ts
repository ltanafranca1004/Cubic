import { device, layout, onFit, safeInsets, viewport, viewZoom, uiScale, hudScale } from './scale';

/**
 * ?debug=fit: the numbers the layout comes from, in a corner of the screen, on any device
 * (also in a production build). For the browsers nobody has on their desk: open the page
 * with it and read what that browser reports.
 */
export function mountFitDebug(): void {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:99;margin:0;padding:4px 6px;font:11px/14px monospace;color:#fff;background:rgba(0,0,0,.8);pointer-events:none;white-space:pre;text-transform:none';
  document.body.appendChild(el);
  const media = (q: string) => (window.matchMedia?.(q).matches ? 'y' : 'n');
  const show = () => {
    const vv = window.visualViewport;
    const d = device();
    const v = viewport();
    const i = safeInsets();
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('canvas')].map((c) => {
      const r = c.getBoundingClientRect();
      return `${c.closest('#game') ? 'game ' : 'stage'} ${c.width}x${c.height} css ${c.style.width || '-'} ${c.style.height || '-'} box ${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`;
    });
    el.textContent = [
      `inner ${window.innerWidth}x${window.innerHeight}  client ${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
      `visual ${vv ? `${vv.width.toFixed(1)}x${vv.height.toFixed(1)} s${vv.scale.toFixed(2)} @${vv.offsetLeft.toFixed(0)},${vv.offsetTop.toFixed(0)}` : 'none'}  screen ${screen.width}x${screen.height}`,
      `dpr ${window.devicePixelRatio}  coarse ${media('(pointer: coarse)')} any-coarse ${media('(any-pointer: coarse)')} hover-none ${media('(hover: none)')}`,
      `fit ${v.width}x${v.height}  touch ${d.touch ? 'y' : 'n'} dpr ${d.dpr}  layout ${layout()}`,
      `ui ${uiScale()} hud ${hudScale()} zoom ${viewZoom()}  safe ${i.top},${i.right},${i.bottom},${i.left}`,
      ...canvases,
    ].join('\n');
  };
  onFit(() => setTimeout(show, 50));
  setInterval(show, 1000);
  show();
}
