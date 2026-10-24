# 文日小栈

文章、摄影、诗歌与面试笔记。使用 Astro 构建静态网页，通过 GitHub Pages 发布。

- 网站：https://wenrihotel.com/
- 源码：https://github.com/wenrizc/engraved-blog
- 旧版源码：https://github.com/wenrizc/wenrihotel

## 本地使用

使用 Node 24，安装依赖后启动博客或内容管理页：

```bash
npm ci
npm run dev
npm run admin
```

管理页用于修改本地 Markdown 和图片文件，说明见 [本地内容管理](docs/local-admin.md)。后台没有登录认证，只应在本机或可信局域网使用。

## 发布

推送到 `main` 后，`.github/workflows/pages.yml` 自动安装依赖、检查代码、构建、执行冒烟测试，并部署 `dist/` 到 GitHub Pages。也可在 Actions 页面手动运行工作流。

正式构建使用 `SITE_URL=https://wenrihotel.com`。GitHub Pages 使用 GitHub Actions 作为构建来源，自定义域名为 `wenrihotel.com`。

```bash
SITE_URL=https://wenrihotel.com npm run build
npm run smoke
```

只有静态构建产物会发布为网站。后台程序、源书籍、环境变量文件和本机备份不进入网站产物。公开源码仓库中的草稿仍可被读取；不要在仓库中保存秘密或私人原始文件。

## 检查

```bash
npm run lint
npm run format:check
npm run test:admin
npm run test:layout
```

发布前审查和处理记录见 [安全审查](docs/security-review.md)。
