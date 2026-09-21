# So, I like This & That

Hemangi's interactive cinema portfolio prototype. Drag any of the five reels onto the projector, or click/tap one. Each loads a 24-second animated preview with countdown, pause, seek, replay, and eject.

Run `python -m http.server 4173 --directory dist` to preview locally. No build or installation needed. Category definitions are in `dist/app.js`. The real videos will be added later.

Pushes to `main` deploy `dist` to GitHub Pages. All asset paths are relative.

Keyboard: Tab then Enter/Space to choose a reel. Escape to eject. Touch: tap a reel or drag to the projector. Reduced-motion preferences are respected.
