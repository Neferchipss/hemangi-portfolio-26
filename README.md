# An Unpredictable Person

Hemangi's portfolio as a little picture house. Five film reels sit at the front: Prequel (singing), Act 1 (painting), Act 2 (art, craft & clay), Sequel (fashion) and The Spin-off (brewing). Drag one onto the projector, or just click it. A countdown leader and a title card play, then her work shows on the cinema screen.

- **Desktop:** drag a reel to the projector, or click it. Use ← → to page through, `F` for theatre mode and `Esc` to eject.
- **Phones:** the stage zooms in on the screen and the reels move to a shelf below. Tap to play, swipe to page through.
- **Credits:** the top-right button opens an about/contact card.

## Updating the content: `/admin`

Open `https://<site>/admin/` (for example `https://neferchipss.github.io/hemangi-portfolio-26/admin/`). This is the *Projection Booth*.

1. Create a fine-grained GitHub token limited to this repository, with **Contents: Read and write** (and optionally **Actions: Read-only**, so the booth can say when the site is live). The booth's "How do I get a token?" section walks through it.
2. Paste it once. It is saved only in that browser.
3. For each reel you can edit the act label, the title and the title-card tagline, and add photos, videos, audio or links (YouTube, Vimeo, SoundCloud, Spotify or Instagram). Add captions and drag to reorder. The *Site & credits* tab holds the bio, email and social links.
4. **Preview** shows the unpublished draft in the real site. **Publish** makes one commit to `main` with `dist/content.json` and any new files under `dist/media/`. It also removes media that no reel uses any more. The Pages workflow redeploys in about a minute.

Large photos are resized in the browser (2400 px, WebP) before upload. GitHub refuses files over 100 MB, so long videos are better hosted on YouTube or Vimeo and added as links.

## Development

No build step. Preview locally with:

```
python -m http.server 4173 --directory dist
```

- `dist/index.html`, `style.css`, `app.js`: the cinema
- `dist/content.json`: everything that is editable (this is what the admin writes)
- `dist/admin/`: the Projection Booth
- `dist/media/`: uploaded work
- `assets/`: layered source art. `tools/build-assets.py` turns it into `dist/assets/` (see `ASSETS.md`).

Pushes to `main` deploy `dist/` to GitHub Pages via `.github/workflows/pages.yml`. All paths are relative, so the site works from a sub-path.
