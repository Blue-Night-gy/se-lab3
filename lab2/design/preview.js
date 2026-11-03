if(!new URLSearchParams(location.search).has('capture')){
 const badge=document.createElement('div');badge.dataset.preview='true';badge.style.cssText='position:fixed;right:18px;bottom:15px;background:#fffefbed;border:1px solid #d6dfec;border-radius:4px;padding:9px 14px;font:11px sans-serif;color:#587298;z-index:9999;box-shadow:0 2px 10px #153e8010';badge.innerHTML='<span style="color:#3a8b72;margin-right:9px">●</span>泊序实时预览　 |　 <a href="/">全部23屏 ↗</a>';document.body.append(badge);
 let signature;setInterval(async()=>{try{const r=await Promise.all(['ui.html','ui.css','ui.js'].map(f=>fetch(f,{cache:'no-store'}).then(r=>r.text())));const next=r.join('');if(signature&&signature!==next)location.reload();signature=next}catch{}},1800)
}
