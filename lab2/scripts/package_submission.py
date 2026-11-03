#!/usr/bin/env python3
"""Package the reviewed files and the actual local Git history without pushing."""
from pathlib import Path
from datetime import datetime, timezone, timedelta
import hashlib, json, subprocess, zipfile

lab=Path(__file__).resolve().parents[1]
repo=lab.parent
folder='实验2_241220090_葛茹月'
archive=lab/(folder+'.zip')
git=lambda *args:subprocess.run(['git','-C',str(repo),*args],check=True,capture_output=True,text=True).stdout
exports={
    'git-log.txt':git('log','--date=iso-strict','--format=commit %H%nAuthor: %an <%ae>%nDate: %aI%n%n    %s%n','--','lab2'),
    'git-tags.txt':git('show-ref','--tags'),
    'git-diff-summary.txt':git('diff','--stat','lab2-ui-ai-draft','HEAD','--','lab2')
}
for name,content in exports.items():(lab/'process'/name).write_text(content)
bundle=lab/'process/lab2-history.bundle'
git('bundle','create',str(bundle),'--all')
verification=subprocess.run(['git','-C',str(repo),'bundle','verify',str(bundle)],capture_output=True,text=True,check=True)
excluded_dirs={'.transient','report-preview','ui-ai-01-preview','ui-reviewed-preview','ui-muji-preview','node_modules','__pycache__'}
excluded_files={'submission-check.json','figma-tools.json'}
selected=[]
for name in ['实验报告.pdf','实验报告.tex','README.md','package.json']:
    selected.append(lab/name)
for name in ['UML','UI界面','design','scripts','template','process']:
    for p in sorted((lab/name).rglob('*')):
        if not p.is_file() or any(part in excluded_dirs for part in p.relative_to(lab).parts):continue
        if p.name in excluded_files or p.name.endswith('-guidance.json'):continue
        selected.append(p)
manifest={p.relative_to(lab).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in selected}
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in selected:z.write(p,folder+'/'+p.relative_to(lab).as_posix())
    z.writestr(folder+'/文件校验.json',json.dumps({'algorithm':'SHA256','files':manifest},ensure_ascii=False,indent=2)+'\n')
with zipfile.ZipFile(archive) as z:
    bad=z.testzip();names=z.namelist()
    uml_png=[n for n in names if n.startswith(folder+'/UML/') and n.endswith('.png')]
    uml_src=[n for n in names if n.startswith(folder+'/UML/') and n.endswith('.puml')]
    ui_png=[n for n in names if n.startswith(folder+'/UI界面/') and n.endswith('.png')]
    assert bad is None
    assert len(uml_png)==len(uml_src)==8
    assert len(ui_png)==24
    assert folder+'/实验报告.pdf' in names
    assert all(n.startswith(folder+'/') for n in names)
    assert hashlib.sha256(z.read(folder+'/实验报告.pdf')).hexdigest()==manifest['实验报告.pdf']
record={'time':datetime.now(timezone(timedelta(hours=8))).isoformat(),'archive':archive.name,'archiveBytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'gitHead':git('rev-parse','HEAD').strip(),'gitBundleVerified':verification.returncode==0,'files':len(names),'umlPng':len(uml_png),'umlPuml':len(uml_src),'uiPng':len(ui_png),'crc':'passed','singleRoot':folder,'pdfMatchesSource':True}
(lab/'process/submission-check.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(record,ensure_ascii=False,indent=2))
