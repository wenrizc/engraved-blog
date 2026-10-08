# Local Admin

This project includes a local-only HTML admin UI for editing Astro content without a hosted CMS.

## Start

```bash
npm run admin
```

Then open the URL printed in the terminal, usually:

```text
http://127.0.0.1:9797/
```

## Open from the local subnet

The default server only listens on this computer. To open the admin from another device on the same trusted Wi-Fi or wired network, start it with:

```bash
ADMIN_HOST=0.0.0.0 npm run admin
```

The terminal will print the available LAN URL, for example:

```text
http://192.168.1.23:9797/
```

Open that URL on the other device. Both devices must be on the same subnet. If the port is occupied, use the port shown in the terminal; the server automatically tries the next port. A host firewall may also need to allow that TCP port.

On Windows PowerShell, use:

```powershell
$env:ADMIN_HOST = "0.0.0.0"
npm run admin
```

The admin can write this project’s content files and has no login protection, so only expose it on a network you trust. Stop it with `Ctrl+C` when finished.

## What It Edits

- Article Markdown: `src/content/articles/*.md`
- Interview Markdown (separate library, nested folders supported): `src/content/interviews/**/*.md`
- Photography Markdown: `src/content/photos/*.md`
- Photo assets copied into: `src/assets/photos/*`

## Workflow

1. Start the local admin with `npm run admin`.
2. Edit or create Article or Photography content in the browser.
3. For Photography, choose one or more image files and click `Upload Selected Photos`.
4. Click `Save Markdown`.
5. Run `npm run build`.
6. Commit and push to GitHub.

## Notes

- This is local-only and writes files through `local-admin/server.mjs`.
- The HTML page alone cannot write files in a normal browser; the small Node server provides that filesystem access.
- Default URL is usually `http://127.0.0.1:9797/`; set `ADMIN_HOST=0.0.0.0` to listen on the local subnet. If the port is occupied, the server automatically tries the next available port and prints the final URL.
- Delete is intentionally conservative: it moves Markdown files into `.local-admin-trash` instead of deleting photo assets.

## 面试八股管理

后台的“面试八股”tab 使用独立内容库 `src/content/interviews/`，不会进入主站文章或主题。

- 新建和编辑文章时，可填写目录，例如 `Java/并发`；文件会保存到对应子目录。
- 可批量选择 `.md` 文件，或选择文件夹导入。文件夹导入保留所选根文件夹及内部层级，仅导入 Markdown。
- 同名路径不会覆盖已有文章，导入结果逐篇显示；已有文章请在内容列表中编辑。
- Markdown 支持 YAML 元数据（包括多行标签）。缺少标题时使用一级标题或文件名，缺少日期时使用导入当天日期。
- `draft: true` 的文章仅在后台可见，不进入文章列表、主题或搜索。
- `src/content/interviews/template.md` 是草稿模板，可在后台参考其格式。
- 面试区入口是主站“链接 → 面试八股”，导航为文章、主题、搜索。搜索覆盖标题、目录、标签、摘要和正文。
- 导入只复制 Markdown；文中的本地图片需要另行放入网站公开资源目录并使用有效 URL。

示例：`src/content/interviews/Java/并发/线程池.md`

```markdown
---
title: 线程池的工作原理
description: 核心线程、任务队列与拒绝策略
date: 2026-10-02
tags:
  - Java
  - 并发
draft: false
---

## 线程池如何处理任务？

在这里填写回答。
```
