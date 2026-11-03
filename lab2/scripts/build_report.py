#!/usr/bin/env python3
"""Build the report from the reviewed Markdown and the actual diagram/UI exports."""
from pathlib import Path
from datetime import datetime, timezone, timedelta
import json, os, re, shutil, subprocess
from PIL import Image

LAB = Path(__file__).resolve().parents[1]
BUILD = LAB / 'process' / '.transient' / 'report'
BUILD.mkdir(parents=True, exist_ok=True)

def esc(s):
    replacements = {'\\': r'\textbackslash{}', '&': r'\&', '%': r'\%', '$': r'\$', '#': r'\#', '_': r'\_\allowbreak{}', '{': r'\{', '}': r'\}', '~': r'\textasciitilde{}', '^': r'\textasciicircum{}'}
    return ''.join(replacements.get(c, c) for c in s).replace('/', r'/\allowbreak{}')

def cell(s):
    parts = re.split(r'(`[^`]+`|\[[^\]]+\]\([^\)]+\))', s.strip())
    out = []
    for part in parts:
        if part.startswith('`') and part.endswith('`'):
            out.append(r'\texttt{' + esc(part[1:-1]) + '}')
        elif part.startswith('['):
            match = re.match(r'\[([^\]]+)\]\(([^\)]+)\)', part)
            out.append(r'\href{' + match[2] + '}{' + esc(match[1]) + '}' if match else esc(part))
        else:
            out.append(esc(part))
    return re.sub(r'(?<=[a-z])(?=[A-Z])', r'\\allowbreak{}', ''.join(out))

def table(lines):
    rows = [[c.strip() for c in line.strip().strip('|').split('|')] for line in lines]
    rows = [r for r in rows if not all(re.fullmatch(r'[:\s-]+', c) for c in r)]
    n = len(rows[0])
    if n == 3:
        widths = [.18, .44, .38]
    elif n == 4:
        widths = [.20, .25, .25, .30]
    elif n == 6:
        widths = [.075, .265, .18, .09, .21, .18]
    else:
        widths = [1 / n] * n
    # Tabcolsep is included in the width calculation to keep all tables inside the page.
    specs = ''.join(r'>{\RaggedRight\arraybackslash}p{\dimexpr ' + str(w) + r'\linewidth-' + str(2 * 4) + r'pt\relax}' for w in widths)
    head = ' & '.join(r'\bfseries ' + cell(c) for c in rows[0]) + r' \\'
    result = [r'\begingroup\small\setlength{\tabcolsep}{4pt}\renewcommand{\arraystretch}{1.28}', r'\begin{longtable}{' + specs + '}', r'\toprule', head, r'\midrule\endfirsthead', r'\toprule', head, r'\midrule\endhead', r'\midrule\multicolumn{' + str(n) + r'}{r}{\footnotesize 续下页}\endfoot', r'\bottomrule\endlastfoot']
    result += [' & '.join(cell(c) for c in row) + r' \\' for row in rows[1:]]
    result += [r'\end{longtable}\endgroup']
    return '\n'.join(result)

def md(text, heading_shift=0):
    lines = text.splitlines()
    chunks, ordinary = [], []
    def flush():
        if ordinary:
            src = '\n'.join(ordinary)
            result = subprocess.run(['pandoc', '--from=gfm', '--to=latex', '--wrap=none'], input=src, text=True, capture_output=True, check=True).stdout
            chunks.append(result)
            ordinary.clear()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.lstrip().startswith('|'):
            flush(); block = []
            while i < len(lines) and lines[i].lstrip().startswith('|'):
                block.append(lines[i]); i += 1
            chunks.append(table(block)); continue
        match = re.match(r'^(#+)\s+(.*)', line)
        if match:
            level = min(6, len(match[1]) + heading_shift)
            title = re.sub(r'^\d+(?:\.\d+)*\.\s*', '', match[2])
            line = '#' * level + ' ' + title
        ordinary.append(line); i += 1
    flush()
    return '\n'.join(chunks).replace(r'\_', r'\_\allowbreak{}')

def read(name):
    return (LAB / 'design' / name).read_text()

def image_tex(path, width, height):
    # Paths are kept relative to lab2 so report.tex is portable with its source directory.
    rel = path.relative_to(LAB).as_posix()
    return r'\includegraphics[width=' + width + ',height=' + height + r',keepaspectratio]{\detokenize{' + rel + '}}'

def paper(w, h):
    return '\n' + r'\clearpage\newgeometry{layoutwidth=' + str(w) + 'mm,layoutheight=' + str(h) + r'mm,layoutoffset=0pt,left=16mm,right=16mm,top=15mm,bottom=16mm,headheight=0pt,headsep=0pt,footskip=9mm}\gdef\CurrentPaper{' + str(w) + 'mm,' + str(h) + 'mm}\n'

def main():
    template = LAB / 'template'; template.mkdir(exist_ok=True)
    for filename in ['elegantpaper.cls', 'elegantpaper-LICENSE']:
        if (LAB.parent / filename).exists():
            shutil.copyfile(LAB.parent / filename, template / filename)
        elif not (template / filename).exists():
            raise FileNotFoundError(template / filename)
    report = read('report-body.md')
    narrative, assistant = report.split('## 辅助工具的实际使用与取舍', 1)
    # Drawings are printed at readable sizes in the explicitly named diagram atlas.
    narrative = re.sub(r'!\[(.*?)\]\(.*?\)', lambda m: '**' + m[1] + '**, 见UML图册对应图号.', narrative)
    design = read('design.md')
    storage = design.split('## 7. 数据库设计', 1)[1].split('## 9. 查询统计', 1)[0]
    storage = '## 数据库设计' + storage
    storage = storage.replace('## 8. 核心接口与错误结果', '## 核心接口与错误结果')
    sources = design.split('## 11. 技术依据', 1)[1]
    content = []
    content.append(md(narrative + '\n' + read('uml-selection.md')))
    content.append(md('# 数据存储与接口契约\n' + storage))
    content.append(md(read('ui-notes.md')))
    content.append(md('# 辅助工具使用与修改过程\n## 大模型的两次真实交互\n' + assistant + '\n' + read('tools-report.md').split('\n',1)[1]))
    content.append(r'\begingroup\small\setlength{\parskip}{.1em}' + md('# 参考资料\n' + sources + '\n- MUJI HOTEL GINZA. Rooms. https://hotel.muji.com/ginza/en/rooms/\n- Unsplash. License. https://unsplash.com/license\n- Figma. MCP server tool limits. https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/') + r'\endgroup')
    content.append(paper(420,297) + md('# 需求追溯表\n' + (LAB/'design/traceability.md').read_text().split('\n',1)[1]))
    content.append(paper(420,297) + md('# 边界情境与验证安排\n' + (LAB/'design/boundary-cases.md').read_text().split('\n',1)[1]))
    diagram_notes = {
        'B01': ('结构性图 / 包图', '分层与模块依赖. 展示层进入应用服务, 领域规则集中在聚合, 基础设施实现应用端口, 成功业务与审计共用事务.'),
        'B02': ('结构性图 / 类图', '必画类图. 实心菱形表示订单拥有行程, 夜价和分房记录; 日售与实体房为独立资源. 字段私有, 修改通过受控方法.'),
        'B03': ('结构性图 / 对象图', '同一时刻的两间三晚订单和201/202分房快照, 总价1700. 当前日售300和原成交260分别保存.'),
        'B04': ('行为性图 / 状态图', '五种订单状态, 明确20分钟, 18点, 实际入住和更正入住人的守卫, 终态不可恢复.'),
        'B05': ('行为性图 / 活动图', '新接受价格和同程继续都重新进入提交校验; 等待决定时不持有数据库锁或新增库存占用.'),
        'B06': ('交互性图 / 时序图', '同一个operationId跨内容绑定, 业务提交与失败记录保持互斥, 同号重试回放结果, 每个夜晚整体成功或回滚.'),
        'B07': ('交互性图 / 时序图', '改单锁齐必要资源后取时检查旧期限与政策截止, 住宿变化重开期限, 单改入住人保留旧期限.'),
        'B08': ('结构性图 / 部署图', '单应用与MySQL同机, 持久任务和数据落在本地数据库, 固定性能与正确性样本分别验证.')
    }
    for i,p in enumerate(sorted((LAB/'UML').glob('*.png'))):
        key=p.name[:3]; kind,note=diagram_notes[key]
        w,h=Image.open(p).size; landscape=w/h>1.25
        content.append(paper(420 if landscape else 297,297 if landscape else 420))
        if i==0:
            content.append(r'\section{UML图册}')
            content.append('共8张, 7种: 包图, 类图, 对象图, 状态图, 活动图, 时序图和部署图. 三类均覆盖. 每张PNG与同名PlantUML源一起交付.' + r'\par\medskip' + '\n')
        content.append(r'\subsection*{' + key + ' / ' + kind + '}\n' + esc(note) + '\\par\\medskip\n')
        maxheight=('185mm' if i==0 else '210mm') if landscape else ('300mm' if i==0 else '350mm')
        content.append(r'\begin{center}' + image_tex(p, r'.98\linewidth', maxheight) + r'\end{center}')
    screens=json.loads((LAB/'design/screens.json').read_text())
    cutdir=LAB/'process/.transient/report-ui';cutdir.mkdir(parents=True,exist_ok=True)
    for i,s in enumerate(screens):
        p=LAB/'UI界面'/f"{s['id']}_{s['name']}.png"
        im=Image.open(p)
        # Split only the two very long catalog pages, with a small overlap for continuity.
        parts=[p]
        if s['key'] in ['search','hotel']:
            parts=[]; cut=1800; start=0
            while start<im.height:
                end=min(im.height,start+cut)
                part=cutdir/(s['id']+'-'+str(len(parts)+1)+'.png')
                im.crop((0,start,im.width,end)).save(part);parts.append(part)
                if end==im.height:break
                start=end-100
        for j,part in enumerate(parts):
            content.append(paper(420,297))
            if i==0 and j==0:content.append(r'\section{界面图册}')
            label=s['id']+' / '+s['name']+(f' ({j+1}/{len(parts)})' if len(parts)>1 else '')
            content.append(r'\subsection*{'+esc(label)+'}\n')
            content.append(esc(s['module'])+' / '+', '.join('REQ-'+str(n).zfill(3) for n in s['requirements'])+r'\par\smallskip'+'\n')
            maxheight='210mm' if i==0 else '235mm'
            content.append(r'\begin{center}'+image_tex(part,r'.99\linewidth',maxheight)+r'\end{center}')
    preamble = r'''\documentclass[cn,nofont,11pt,a4paper]{elegantpaper}
\setCJKmainfont[AutoFakeBold=2,ItalicFont=KaiTi]{SimSun}
\setCJKsansfont[AutoFakeBold=2]{Microsoft YaHei}
\setCJKmonofont{SimSun}
\setmonofont{DejaVu Sans Mono}[Scale=.85]
\usepackage{longtable,array,ragged2e,needspace}
\usepackage{titlesec,atbegshi,bookmark}
\definecolor{wood}{HTML}{765F46}
\definecolor{paperline}{HTML}{CFC3AF}
\titleformat{\section}{\Large\sffamily\color{wood}}{\thesection}{.8em}{}
\titleformat{\subsection}{\large\sffamily\color{wood}}{\thesubsection}{.7em}{}
\hypersetup{pdftitle={实验二 软件设计与建模 - 泊序酒店预订系统},pdfauthor={},pdfsubject={软件工程实验二},pdfkeywords={},linkcolor=wood,urlcolor=wood}
\geometry{left=23mm,right=23mm,top=23mm,bottom=23mm,footskip=12mm}
\providecommand{\tightlist}{\setlength{\itemsep}{0pt}\setlength{\parskip}{0pt}}
\providecommand{\passthrough}[1]{#1}
\setlength{\emergencystretch}{3em}
\setlength{\parskip}{.35em}
\setcounter{tocdepth}{1}
\newcommand{\CurrentPaper}{210mm,297mm}
\AtBeginShipout{\AtBeginShipoutAddToBox{\special{papersize=\CurrentPaper}}}
\pagestyle{plain}
\begin{document}
\begin{titlepage}
\thispagestyle{empty}
{\sffamily\color{wood}\large 软件工程 / 实验二\par}
\vspace{28mm}
{\sffamily\fontsize{32}{43}\selectfont 软件设计与建模\par}
\vspace{8mm}
{\sffamily\fontsize{24}{32}\selectfont 泊序酒店预订系统\par}
\vspace{14mm}
\noindent{\color{paperline}\rule{\linewidth}{1pt}}\par
\vspace{8mm}
{\large 从多间连住到整体分房\par}
\vspace{10mm}
\begin{tabular}{@{}lrrr@{}}
住宿日 & 每间价格 & 间数 & 小计\\\midrule
11月6日 & 260 & 2 & 520\\
11月7日 & 280 & 2 & 560\\
11月8日 & 310 & 2 & 620\\\midrule
全程 & & 2间 / 3晚 & 1700元
\end{tabular}\par
\vspace{10mm}
\small 一笔订单, 每个住宿夜, 两个实体房号.\par
\vfill
\begin{tabular}{@{}ll}
学号 & 241220090\\
姓名 & 葛茹月\\
项目 & 酒店预订系统\\
设计基线 & 实验一26条需求
\end{tabular}
\end{titlepage}
\pagenumbering{Roman}
\tableofcontents
\clearpage\pagenumbering{arabic}
'''
    tex=preamble+'\n'.join(content)+'\n\\end{document}\n'
    (LAB/'实验报告.tex').write_text(tex)
    env=os.environ.copy();env['TEXINPUTS']=str(template)+os.pathsep+env.get('TEXINPUTS','');env['TZ']='Asia/Shanghai'
    start=datetime.now(timezone(timedelta(hours=8))).isoformat()
    for i in range(2):
        r=subprocess.run(['xelatex','-interaction=nonstopmode','-halt-on-error','-output-directory='+str(BUILD),'实验报告.tex'],cwd=LAB,env=env,capture_output=True,text=True)
        (BUILD/f'pass-{i+1}.txt').write_text(r.stdout+'\n'+r.stderr)
        if r.returncode:
            print(r.stdout[-4500:]);raise SystemExit(r.returncode)
    shutil.copyfile(BUILD/'实验报告.pdf',LAB/'实验报告.pdf')
    log=(BUILD/'实验报告.log').read_text(errors='replace')
    record={'started':start,'ended':datetime.now(timezone(timedelta(hours=8))).isoformat(),'engine':'XeLaTeX','passes':2,'pdfBytes':(LAB/'实验报告.pdf').stat().st_size,'overfull':re.findall(r'Overfull[^\n]+',log),'missingCharacters':re.findall(r'Missing character:[^\n]+',log)}
    (LAB/'process/report-build.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(record,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
