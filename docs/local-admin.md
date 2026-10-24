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

Requests validate the host and browser origin, and write endpoints require JSON to prevent cross-site writes and DNS rebinding. These checks do not authenticate other devices on your LAN. The admin is a separate local process and must not be deployed as a public service.

## What It Edits

- Article Markdown: `src/content/articles/*.md`
- Interview Markdown (separate library, nested folders supported): `src/content/interviews/**/*.md`
- Photography Markdown: `src/content/photos/*.md`
- Photo assets copied into: `src/assets/photos/*`

## Workflow

1. Start the local admin with `npm run admin`.
2. Select or create Article, Photography, or Interview content in the library. New content starts as a draft.
3. Write in the editor and use split or reading preview to check the current unsaved content.
4. For Photography, select or drop images, arrange them, choose a cover, and add captions. Click `保存 Markdown` (Ctrl / Cmd + S) to upload pending images and save the whole entry.
5. Run `npm run build`.
6. Commit and push to GitHub.

## Writing and Photo Management

- The header keeps preview and save controls available while scrolling. The library supports title/tag/directory search, status filters, and date/title sorting.
- Existing content keeps its filename when the title or date changes. Saving keeps the current entry selected. Interview directories can be changed independently.
- Images appear immediately after selection. Drag the handle, use arrows, or edit the position number to reorder the gallery. The cover is selected separately from the gallery order.
- Uploaded photos have EXIF/XMP/IPTC metadata removed, including GPS and device information. SVG uploads become PNG images so embedded scripts cannot run. Keep original photographs outside the Git repository if you need their metadata.
- Replace preserves a photo’s caption, position, and cover status. Gallery operations support undo. The image editor supports rotation and ratio cropping with adjustable crop position, creating a new PNG copy.
- Text and pending images are automatically stashed in this browser. Switching with unsaved edits offers save, stash, or cancel. After a refresh, use the recovery banner to restore the local draft.
- Local drafts are tied to this browser and server URL. They are separate from Markdown files and the public/draft visibility setting.
- Desktop and phone reading previews include unsaved Markdown and photos. They do not reproduce the complete Astro site or execute embedded HTML/MDX.
- Saving checks file revisions and reports conflicts instead of overwriting a version changed since it was opened.
- Interview imports open in a separate dialog and refresh the library without clearing the active editor.

Design research and workflow details: [管理页编写流程重设计](admin-redesign.md).

## Tests

```bash
npm run test:admin
```

These tests use temporary project directories, so they do not modify your content or photos. `ADMIN_PROJECT_ROOT` is available for isolated testing; normal use does not need it.

`npm run test:layout` also runs against a temporary site copy. Its sample article and three sample albums are published only in that copy, independent of your current draft choices.

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
- `draft: true` 的文章不进入构建后的网站列表、主题、搜索或详情页。草稿源文件仍会进入 Git；公开仓库中的草稿可以被任何人读取，请不要在其中保存秘密。
- `src/content/interviews/template.md` 目前是一篇已填写并公开的进程、线程、协程笔记；文件名沿用了原来的模板名称。
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
