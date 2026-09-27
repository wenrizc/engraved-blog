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

## What It Edits

- Article Markdown: `src/content/articles/*.md`
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
- Default URL is usually `http://127.0.0.1:9797/`. If that port is occupied, the server automatically tries the next available port and prints the final URL.
- Delete is intentionally conservative: it moves Markdown files into `.local-admin-trash` instead of deleting photo assets.
