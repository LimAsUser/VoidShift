// Local-only visual acceptance server; public game files, no API or user data.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baseline=path.join(root,'.wrangler','phantom-before-v1');
const prior=new Set(['index.html','js/config.js','js/entities.js','js/game.js','js/renderer.js','js/player-art.js']);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.avif':'image/avif','.webp':'image/webp','.gif':'image/gif','.mp3':'audio/mpeg','.woff2':'font/woff2'};
const profile=view=>`SaveRewards.key='phantom-qa-${view}-save';SaveRewards.journalKey='phantom-qa-${view}-journal';`;
const controls=view=>`addEventListener('load',()=>{
  const style='position:fixed;right:12px;z-index:99999;padding:10px;background:#102d3c;color:#d8edf3;border:1px solid #65ddeb';
  const b=document.createElement('button');b.textContent='导出游戏画布';b.style.cssText=style+';bottom:12px';
  b.onclick=()=>{const world=document.querySelector('canvas#gameCanvas'),vision=document.querySelector('canvas#visionCanvas');if(!world?.width||!world.height)return;
    const c=document.createElement('canvas');c.width=world.width;c.height=world.height;const ctx=c.getContext('2d');ctx.drawImage(world,0,0);if(vision?.width&&vision.height)ctx.drawImage(vision,0,0,c.width,c.height);
    c.toBlob(blob=>{const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download='phantom-${view}.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});};
  const bench=document.createElement('button'),out=document.createElement('p');bench.textContent='测量绘制提交';bench.style.cssText=style+';bottom:62px';
  out.style.cssText='position:fixed;left:12px;bottom:12px;z-index:99999;color:#d8edf3;background:#07131ddd;padding:8px;font:13px monospace';
  bench.onclick=()=>{const g=window.game;if(!g?.state.running){out.textContent='请先进入训练舰';return;}for(let i=0;i<10;i++)g.render();const samples=[];
    for(let i=0;i<120;i++){const t=performance.now();g.render();samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);
    out.textContent='${view}:120帧 CPU提交均值 '+(samples.reduce((a,b)=>a+b,0)/120).toFixed(3)+'ms / P95 '+samples[113].toFixed(3)+'ms（非FPS，未含GPU完成时间）';};
  document.body.append(b,bench,out);
});`;
const server=http.createServer((req,res)=>{try{
  const url=new URL(req.url,'http://preview.invalid'),pathname=decodeURIComponent(url.pathname);
  if(pathname==='/__qa-profile.js'||pathname==='/__qa-controls.js'){
    const view=url.searchParams.get('view')==='before'?'before':'after';
    res.writeHead(200,{'Content-Type':types['.js'],'Cache-Control':'no-store'}).end(pathname.includes('profile')?profile(view):controls(view));return;
  }
  const match=pathname.match(/^\/(before|after)\/(.*)$/),view=match?.[1];
  let relative=match?(match[2]||'index.html'):pathname.slice(1);
  if(!/^(?:index\.html|(?:styles|menu)\.css|js\/[\w-]+\.js|resources\/[\w ./-]+\.(?:png|jpg|jpeg|webp|avif|gif|mp3|woff2?)|design\/phantom-player-preview\.html)$/.test(relative)){
    res.writeHead(404).end();return;
  }
  const base=view==='before'&&prior.has(relative)?baseline:root,target=path.resolve(base,relative);
  if(!target.startsWith(base+path.sep)||!fs.existsSync(target)){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});
  if(view&&relative==='index.html'){
    let html=fs.readFileSync(target,'utf8');
    html=html.replace(/(<script src="js\/rewards\.js[^\"]*"><\/script>)/,`$1<script src="/__qa-profile.js?view=${view}"></script>`);
    res.end(html.replace('</body>',`<script src="/__qa-controls.js?view=${view}"></script></body>`));
  }else fs.createReadStream(target).pipe(res);
}catch{res.writeHead(400).end();}});
server.listen(Number(process.argv[2])||0,'127.0.0.1',()=>console.log(`Local visual acceptance: http://127.0.0.1:${server.address().port}/design/phantom-player-preview.html`));
process.once('SIGINT',()=>server.close(()=>process.exit(0)));
process.once('SIGTERM',()=>server.close(()=>process.exit(0)));
