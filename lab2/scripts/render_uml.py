#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime, timezone, timedelta
import argparse, subprocess, json, hashlib

lab=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--jar',required=True,help='PlantUML jar文件路径')
args=parser.parse_args()
files=sorted((lab/'UML').glob('*.puml'))
now=lambda:datetime.now(timezone(timedelta(hours=8))).isoformat()
started=now()
run=subprocess.run(['java','-Xmx1024m','-Djava.awt.headless=true','-DPLANTUML_LIMIT_SIZE=12000','-jar',str(Path(args.jar).resolve()),'-charset','UTF-8','-tpng',*[str(p) for p in files]],capture_output=True,text=True)
record={'started':started,'ended':now(),'sources':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files},'exitCode':run.returncode,'stdout':run.stdout,'stderr':run.stderr,'pngFiles':[p.with_suffix('.png').name for p in files if p.with_suffix('.png').exists()]}
(lab/'process/uml-render-final.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(record,ensure_ascii=False,indent=2))
raise SystemExit(run.returncode)
