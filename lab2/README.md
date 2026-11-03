# 实验二: 泊序酒店预订系统

学号241220090, 葛茹月. 以实验一26条需求为基线, 交付设计模型与界面原型.

- 实验报告.pdf: 正文, 数据与接口, 工具过程, 追溯表, UML及界面图册.
- UML/: 8张PNG与同名PlantUML源, 共7种UML图.
- UI界面/: 24张完整PNG, 2160px宽.
- design/: 界面源文件, 设计说明, 素材与来源.
- process/: 原始模型输入输出, 实际复核, 工具和导出记录.
- scripts/: 重绘, 界面验证和报告构建脚本.
- template/: ElegantPaper类文件与原许可.

界面采用MUJI HOTEL客房目录的图文分区作为参照, 配色为木色与米色. 摄影来自Unsplash, 完整出处见design/assets/sources.json.

Figma定稿: https://www.figma.com/design/PX6gIiPxgMNzgMRJXKmV7C?node-id=5-2 . 木色24屏为定稿, 蓝色节点2:2为中间稿. 已检查Auto layout与可编辑文字层. 库发现受Starter调用限额限制, 当前屏幕为原生图层, 并未链接发布组件库. PNG统一由同一界面源在浏览器导出.

## 查看与重绘

在本目录运行:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory design
```

打开http://localhost:8766/, 目录列出24屏. 源文件变化会自动刷新. 查询, 订单和房态按钮展示设计样例的状态跳转, 不连接酒店后端.

导出与验证界面需要Node.js及Playwright:

```sh
npm install
npx playwright install chromium
npm run export:ui
npm run check:ui
```

可用环境变量PREVIEW_URL指定预览地址, 默认为http://127.0.0.1:8766. 已有Playwright安装时, PLAYWRIGHT_PACKAGE可指定其package.json路径.

重绘UML需要Java及PlantUML jar:

```sh
python3 scripts/render_uml.py --jar /path/to/plantuml.jar
```

构建报告需要Python3/Pillow, Pandoc和XeLaTeX. 本次环境使用SimSun, KaiTi和Microsoft YaHei中文字体. 执行`python3 scripts/build_report.py`生成实验报告.tex与PDF; 编译中间文件保存在process/.transient, 不作为提交材料.

## 过程与验证

两轮设计模型输入输出完整保留. 标签lab2-ui-ai-draft和lab2-uml-ai-draft固定首次原稿, 后续提交记录真实修订. Git仅在本地使用, 未推送remote. 包内process/git-log.txt和可恢复的Git bundle用于查看阶段差异.

实际完成的是8图渲染, 24屏布局和6条关键界面跳转, 金额/库存差额/统计样例核算, PDF排版和打包完整性检查. 22个后端边界场景列在design/boundary-cases.md, 留待后端实现后运行. 所有本轮过程时间均为实际UTC+8时间.
