import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const lab=path.resolve(dir,'..');
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE || new URL('../package.json',import.meta.url));
const {chromium}=require('playwright');
const screens=JSON.parse(fs.readFileSync(path.join(lab,'design/screens.json')));
const out=path.join(lab,process.argv[2] || 'UI界面');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1.5});
const report=[];const baseURL=process.env.PREVIEW_URL || 'http://127.0.0.1:8766';
for(const s of screens){
  await page.goto(`${baseURL}/ui.html?screen=${s.key}${s.query?'&'+s.query:''}&capture=1`,{waitUntil:'networkidle'});
  await page.evaluate(()=>document.fonts.ready);
  const dimensions=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,viewport:{width:innerWidth,height:innerHeight},text:document.body.innerText.length}));
  if(dimensions.text<80)throw new Error('Empty UI: '+s.id);
  const name=`${s.id}_${s.name}.png`;
  await page.screenshot({path:path.join(out,name),fullPage:true});
  report.push({...s,file:name,...dimensions});
}
await browser.close();
fs.writeFileSync(path.join(lab,'process/ui-render-check.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.map(({id,width,height,text})=>({id,width,height,text})),null,2));
