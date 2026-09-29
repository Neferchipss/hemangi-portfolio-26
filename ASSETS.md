# Assets

Source layers live in `assets/`. `python tools/build-assets.py` turns them into the web images in `dist/assets/` (it needs Pillow, NumPy and SciPy).

| Source | Output | What the script does |
| --- | --- | --- |
| `bg.PNG` (1670×942) | `bg.webp`, `bg-front.webp` | `bg.webp` is the theatre. `bg-front.webp` is the same image with the cream screen cut out, so whatever plays sits *behind* the girl's head and the drawn screen frame. |
| `reels.PNG` | `reel-singing/painting/craft/fashion/brewing.webp` | Splits the vertical sheet at its transparent gaps and trims each reel. |
| `camera.PNG` | `camera.webp` | Removes the baked-in checkerboard, working inward from the edges, and trims. |
| `text.PNG` | `title.webp` | Trims. This is the "An Unpredictable Person" title on the welcome screen. |

The stage is authored in the background's 1670×942 coordinates. If the background changes, update the screen box (`.screen` in `style.css`), the projector and reel positions, and the beam polygon in `index.html` to match.
