export const CSS = `
:root{--bg:#14172A;--txt:#E8EEF2;--grass:#7BC96F;--amber:#F2C14E;--verd:#5CFFB0;--red:#FF5A5A;--panel:#262B45}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--txt);font:16px/1.4 'Pixelify Sans',system-ui,sans-serif}
#app{min-height:100%}
.px,h1,h2{font-family:Silkscreen,monospace;margin:0}
button,input{font:inherit}
button{cursor:pointer;background:var(--panel);color:var(--txt);border:0;padding:9px 14px;box-shadow:4px 4px 0 #000;font:700 12px Silkscreen,monospace}
button:active{transform:translate(2px,2px);box-shadow:2px 2px 0 #000}
button:disabled{opacity:.45;cursor:not-allowed}
button:focus-visible,input:focus-visible{outline:3px solid var(--amber);outline-offset:2px}
input{background:#0E1120;color:var(--txt);border:2px solid #3A4266;padding:8px 10px}
.pu{display:none}
.pu.on{display:block}
/* lobby */
.pu-lobby{max-width:460px;margin:0 auto;padding:48px 20px;text-align:center}
.pu-logo{font-size:56px;letter-spacing:6px}
.pu-logo span:first-child{color:var(--grass)}.pu-logo span:last-child{color:var(--amber)}
.pu-card{background:var(--panel);box-shadow:6px 6px 0 #000;padding:20px;margin-top:22px;display:grid;gap:14px}
.pu-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;align-items:center}
.pu-code{font:700 44px Silkscreen,monospace;letter-spacing:10px;color:var(--verd)}
#pu-codein{width:120px;text-transform:uppercase;text-align:center;letter-spacing:6px;font:700 18px Silkscreen,monospace}
.pu-err{color:var(--red);min-height:22px}
.pu-status{min-height:22px;opacity:.9}
/* game */
.pu-game header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:12px 20px}
.pu-game header h1{font-size:28px;letter-spacing:3px}
.pu-prog{display:flex;gap:6px}
.pu-prog div{width:28px;height:28px;display:flex;align-items:center;justify-content:center;font:700 13px Silkscreen,monospace;background:var(--panel);box-shadow:inset -3px -3px 0 #1B1F35}
.pu-prog div.ok{background:var(--verd);color:#0E2A1E;box-shadow:inset -3px -3px 0 #2FB37A}
.pu-prog div.here{outline:2px solid var(--txt)}
.pu-prog div.portal{background:#7A3FD1;box-shadow:inset -3px -3px 0 #4E2390}
.pu-stats{display:flex;gap:16px;align-items:center;font:700 13px Silkscreen,monospace}
.pu-stats .x{color:var(--red)}
.pu-main{display:flex;gap:20px;justify-content:center;align-items:flex-start;flex-wrap:wrap;padding:0 20px 20px}
.pu-panel{padding:14px;box-shadow:6px 6px 0 #000}
.pu-panel.out{background:#1B2A22;border:4px solid var(--grass)}
.pu-panel.in{background:#1C1A28;border:4px solid var(--amber)}
.pu-ph{display:flex;justify-content:space-between;gap:12px;align-items:baseline;margin-bottom:8px;font:700 13px Silkscreen,monospace;flex-wrap:wrap}
.pu-panel.out .pu-ph h2{color:var(--grass)}.pu-panel.in .pu-ph h2{color:var(--amber)}
.pu-ph h2{font-size:20px}
.pu-stage{display:grid;grid-template-columns:auto auto auto;grid-template-rows:auto auto auto;justify-content:center;align-items:center;gap:6px}
.pu-edge{font:400 11px Silkscreen,monospace;opacity:.8;text-align:center;white-space:nowrap}
.pu-et{grid-column:2;grid-row:1}.pu-eb{grid-column:2;grid-row:3}
.pu-el{grid-column:1;grid-row:2;writing-mode:vertical-rl;transform:rotate(180deg)}
.pu-er{grid-column:3;grid-row:2;writing-mode:vertical-rl}
#game{grid-column:2;grid-row:2;line-height:0;box-shadow:0 0 0 4px #000}
#game canvas{image-rendering:pixelated;display:block}
.pu-obj{margin:12px auto 0;max-width:520px;min-height:44px}
.pu-carry{font:700 12px Silkscreen,monospace;color:var(--amber);min-height:18px}
.pu-keys{font:400 11px Silkscreen,monospace;opacity:.6;text-align:center;margin-top:6px}
.pu-side{width:300px;display:grid;gap:14px}
.pu-box{background:var(--panel);box-shadow:6px 6px 0 #000;padding:12px}
.pu-box h3{font:700 12px Silkscreen,monospace;margin:0 0 8px;opacity:.8}
.pu-log{height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;font-size:15px}
.pu-log b{font:700 11px Silkscreen,monospace}
.pu-log .out b{color:var(--grass)}.pu-log .in b{color:var(--amber)}.pu-log .ai b{color:#C08CFF}
.pu-log .typing{opacity:.6;font-style:italic}
#pu-chat{width:100%;margin-top:8px}
.pu-voice{display:grid;gap:8px;font-size:14px}
.pu-bars{display:inline-flex;gap:3px;align-items:flex-end;height:16px;vertical-align:middle}
.pu-bars i{width:5px;background:#3A4266}.pu-bars i:nth-child(1){height:6px}.pu-bars i:nth-child(2){height:11px}.pu-bars i:nth-child(3){height:16px}
.pu-bars i.on{background:var(--verd)}
.pu-dot{display:inline-block;width:10px;height:10px;background:#3A4266;margin-right:6px}
.pu-dot.on{background:var(--verd);box-shadow:0 0 8px var(--verd)}
.pu-warn{color:var(--red)}
.pu-banner{background:#5A2A2A;padding:6px 10px;font:700 12px Silkscreen,monospace;text-align:center}
.pu-win{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(10,12,22,.92);z-index:9}
.pu-win.on{display:flex}
.pu-win .card{background:var(--panel);padding:34px 40px;text-align:center;box-shadow:8px 8px 0 #000;border:4px solid var(--verd)}
.pu-win h2{font-size:28px;color:var(--verd);margin-bottom:10px}
`;
