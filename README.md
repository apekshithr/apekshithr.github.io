# Notes — a minimal personal blog

Zero dependencies. Just Node.

## Write
Add a Markdown file to `posts/`, e.g. `posts/2026-12-01-my-idea.md`:

```
---
title: My idea
date: 2026-12-01
description: One sentence that shows on the home page and in LinkedIn previews.
image: /images/my-idea.jpg   (optional, 1200×627 for LinkedIn)
draft: true                  (optional, hides the post)
---

Your words here.
```

Supported: `## headings`, paragraphs, **bold**, *italic*, [links](https://…), `> quotes`, lists, code blocks, `---` rules, and `![caption](/images/x.jpg)` images (put files in `static/images/`).

## Preview
    node build.mjs --serve     # http://localhost:4000, rebuilds on save

## Publish (GitHub Pages, free)
Every push to `main` builds the site on GitHub and publishes it
(`.github/workflows/deploy.yml`). No need to commit `dist/`.

One-time setup:
1. On github.com, create a **public** repository named exactly `<your-username>.github.io`
   (empty: no README, licence or .gitignore).
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. In `site.config.json`, set `"url": "https://<your-username>.github.io"`.
4. From this folder:

       git add -A
       git commit -m "First version of the blog"
       git remote add origin https://github.com/<your-username>/<your-username>.github.io.git
       git push -u origin main

5. Watch it build under the repo's **Actions** tab. When it's green, the site is live.

After that, publishing a post is just:

    git add -A && git commit -m "New post" && git push

Using your own domain later: add it under **Settings → Pages → Custom domain**, point the
domain's DNS at GitHub Pages, tick **Enforce HTTPS**, then update `url` in `site.config.json`.

## LinkedIn preview cards
Every build renders a 1200×627 share image per post (and one for the home page) with your
installed Chrome, cached in `.cache/og/`. A post's own `image:` overrides it. If Chrome isn't
found, the build skips the cards; set `CHROME_PATH` to point at it.
