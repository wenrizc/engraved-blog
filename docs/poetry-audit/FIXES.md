# 诗歌摘录修复记录（2026-10-25）

本文件记录本次实际修复内容、验证结果和剩余风险。审核基线见 `README.md`，逐条结论见 `findings-verified.json`。

## 一、修复范围与结果

| 项目 | 修复前 | 修复后 |
|---|---:|---:|
| 摘录总数 | 1386 | 1386（未删条目） |
| 摘录含章节序号/分节标题/诗题/说话人标签 | 41 | 0 |
| 摘录中文行内空格拆词 | 28 | 0 |
| 摘录 ASCII 标点 | 1 | 0 |
| 引号/括号不配对 | 30 | 15（均为原诗跨节长引语，未强行补引号） |
| 纯数字作品名（莎士比亚/勃朗宁夫人） | 180 | 展示为“十四行诗第N首/葡萄牙人十四行诗第N首” |
| 标题内空格/嵌套书名号/间隔号 | 69 / 5 / 3+6 | 展示层统一清理（内层〈〉、`·`） |
| 作者名格式（E. E./T. S./全角连字符） | 16 + 9 | 展示层统一 |
| 逐行译文/错字/标点修正 | — | 83 处整行替换 + 1 处缺行补回 |
| 摘录边界重截 | — | 20 条 |
| 英文空节（诗页） | 210 | 67 |
| 中英行数不等的诗节 | 526 | 328 |
| 英文整节自动重配 | — | 58 首诗 |

构建：`npm run build` 成功，生成 1592 个页面。
测试：`npx playwright test tests/poetry.spec.ts` 15 passed；`tests/layout.spec.ts` 49 passed、2 skipped。
类型检查：`npm run check` 通过（仅 `local-admin` 既有 deprecation hint）。
代码风格：ESLint 与 Prettier 检查通过。

## 二、代码修复（展示层）

新增 `src/lib/poetry.ts`：

- `filterPoemLines`：过滤纯中文序号、`第N部/卷/篇/章`、`合唱：`、`剪影`、`月之逃逸`、精灵说话人标签；按 id 白名单移除“露西·格瑞”“法兰西”两处题名混入。
- `cleanPoemLine`：清洗 CJK 字符/中文标点之间的多余空格；`⋯⋯` → `……`；保留英文内部空格。
- `normalizeTitle`：纯数字十四行诗转可读题名；清理中文词间空格；`•`/`・` → `·`；嵌套书名号内层改〈〉；但恩组诗去掉“一、”编号；豪斯曼“三 新兵”等原书编号保留；修正“一旦晨曦不再伫留”→“一旦暮色不再锁住”、“二十八 威尔士人进行曲”→“二十八 威尔士边境”。
- `normalizeAuthor`：`E. E.`/`T. S.` 补空格；全角 `－` 改 `·`。
- `prepareQuote`：规范化摘录并重拼 `text`；单行摘录保留。

页面改动：

- `src/pages/index.astro`：`data-poems` 使用规范化后的摘录；无可用摘录时抛明确错误。
- `src/pages/poetry/[id].astro`：标题/作者规范化；中文行过滤；空 stanza 不渲染。
- `tests/poetry.spec.ts`：新增 5 个回归测试（首页无序号/无空格、但恩页无孤立序号、莎翁第18首标题、玫瑰摘录空格、狄金森首行作题保留）。

## 三、数据修复（生成 JSON）

新增 `scripts/apply_poetry_fixes.py`，补丁在 `.fixes/`：

- `text-fixes.json`：21 处错字/标点整行替换。
- `translations-1.json` / `translations-2.json`：56 处已复核译文修正。
- `consistency.json`：6 处同诗同词一致性修正（Living/incorporate/nighest/twilight/perversity）。
- `boundaries.json`：20 条摘录边界重截，4 条跳过（完整引语过长或必须改写原文）。
- `alignment.json` 未生成（专项智能体异常退出）；脚本采用确定性对齐：按中文诗节分组重新分配英文行，合并 38 个单侧空节，自动重配 58 首诗。

数据结果：

- 1386 条摘录全部非空、`text` 与 `lines` 一致、在诗中连续；无重复 id、无空行。
- 摘录内无章节序号、无 CJK 拆词空格、无 ASCII 标点。
- 诗页英文空节从 210 降到 67；中英行数不等从 526 降到 328。
- 诗页不丢诗：`lines.zh` 删除的 289 行为 231 个纯序号、45 个分节标题、7 个说话人标签、4 个“第N部”、2 个题名混入；其余 345 行是空格/标点/译文替换后的正常变体。`lines.en` 仅删除 33 行标题类内容。

## 四、剩余问题

1. **15 条摘录仍有引号/括号不配对**：均为原诗跨节长引语，完整补引号会超过 8 行/120 字，或必须改写原文。id：
   `3863f4edec49bb`、`ce962d7cc68ce7`、`2e28250f3135f4`、`34671e60e8f44e`、`02da4ed4853c93`、`7a1e6d28687dde`、`50531828368440`、`80131ac1c4d4f7`、`998b064df3f1e5`、`4bca4119de6ab1`、`65b48e5ab2e637`、`30c4ca34d73c11`、`422cae06d0a048`、`fa74802975acd2`、`d29f29a750ebba`。
2. **67 个诗节英文仍为空**，**328 个诗节中英行数不等**：源数据没有可用的英文行，或译者在节内合并/拆分诗行；无法在不编造英文的前提下全部对齐。
3. **2 条摘录超过 8 行**：`991f83d3bda25b`（9 行/131 字）、`8a052ed30ff7c7`（9 行/147 字），首页摘录槽会出现内部滚动。
4. **2 条摘录 9 行** 与上条重合；其余单行摘录 26 条保留原样（原站设计允许）。
5. **首页 HTML 仍约 1 MB**：`data-poems` 仍内联 1386 条；性能优化未在本次执行（属 P3）。

## 五、如何回滚/重跑

- 原始数据已备份到 `.fixes/backup/poetry-*.json`（修复前快照）。
- 回滚：
  ```bash
  cp .fixes/backup/poetry-quotes.json src/data/generated/poetry-quotes.json
  cp .fixes/backup/poetry-poems.json src/data/generated/poetry-poems.json
  ```
- 从原始数据重跑：
  ```bash
  cp .fixes/backup/poetry-quotes.json src/data/generated/poetry-quotes.json
  cp .fixes/backup/poetry-poems.json src/data/generated/poetry-poems.json
  npm run fix:poetry
  ```
- 注意：`fix:poetry` 是一次性迁移脚本；对已修复数据再跑会因 `old` 行不存在而报错，属预期。新增/重新生成数据后再跑，应基于新鲜生成物。

## 六、变更文件

- `src/data/generated/poetry-quotes.json`
- `src/data/generated/poetry-poems.json`
- `src/lib/poetry.ts`（新增）
- `src/pages/index.astro`
- `src/pages/poetry/[id].astro`
- `tests/poetry.spec.ts`（新增）
- `scripts/apply_poetry_fixes.py`（新增）
- `package.json`（新增 `fix:poetry` / `check:poetry` / `test:poetry`）
- `.fixes/`（补丁、备份、任务文件）
- `docs/poetry-audit/`（审核与修复记录）
