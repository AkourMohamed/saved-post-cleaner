"""
Generates Saved Post Cleaner's icon set (icon16/48/128.png) from scratch with
Pillow — no external image/template, so no licensing questions. Deliberately
NOT an Instagram lookalike (different shape, different gradient) to avoid
any implication of official affiliation, which matters for a Chrome Web
Store listing.

Design: a bookmark ribbon (the universal "saved" symbol) with two sparkle
accents suggesting "cleaned up", on a blue→teal circular badge.

This script is a one-off local tool, not part of the shipped extension —
only the .png files it produces are referenced from manifest.json. Re-run
it any time after editing to regenerate all sizes from one definition.

Usage: python generate_icons.py
"""

import math
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
MASTER_SIZE = 1024
GRADIENT_RES = 256  # computed small, then upscaled — plenty smooth, much faster
TARGET_SIZES = [16, 48, 128]

COLOR_START = (47, 111, 237)  # blue
COLOR_END = (0, 194, 168)  # teal
RIBBON_COLOR = (255, 255, 255, 255)
SPARKLE_COLOR = (255, 255, 255, 230)


def lerp(a, b, t):
    return a + (b - a) * t


def build_gradient(size):
    """Small diagonal-gradient tile, upscaled later for smooth results fast."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    max_t = 2 * (size - 1)
    for y in range(size):
        for x in range(size):
            t = (x + y) / max_t
            px[x, y] = (
                int(lerp(COLOR_START[0], COLOR_END[0], t)),
                int(lerp(COLOR_START[1], COLOR_END[1], t)),
                int(lerp(COLOR_START[2], COLOR_END[2], t)),
            )
    return img


def build_circle_mask(size):
    """Anti-aliased circle mask via 4x supersampling."""
    ss = 4
    big = Image.new("L", (size * ss, size * ss), 0)
    d = ImageDraw.Draw(big)
    pad = size * ss * 0.03  # slight inset so the edge isn't clipped
    d.ellipse([pad, pad, size * ss - pad, size * ss - pad], fill=255)
    return big.resize((size, size), Image.LANCZOS)


def ribbon_polygon(cx, cy, w, h, notch_depth):
    """Classic bookmark-ribbon silhouette: a rectangle with a V notch cut
    into the bottom edge."""
    left = cx - w / 2
    right = cx + w / 2
    top = cy - h / 2
    bottom = cy + h / 2
    return [
        (left, top),
        (right, top),
        (right, bottom),
        (cx, bottom - notch_depth),
        (left, bottom),
    ]


def sparkle_polygon(cx, cy, size):
    """Simple 4-point sparkle/star, drawn as two overlapping stretched
    diamonds via 8 points around the center."""
    pts = []
    for i in range(8):
        angle = math.pi / 4 * i
        r = size if i % 2 == 0 else size * 0.35
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    return pts


def build_master():
    gradient = build_gradient(GRADIENT_RES).resize((MASTER_SIZE, MASTER_SIZE), Image.LANCZOS)
    mask = build_circle_mask(MASTER_SIZE)

    master = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), (0, 0, 0, 0))
    master.paste(gradient, (0, 0), mask)

    # Draw ribbon + sparkles on a supersampled layer for clean anti-aliased
    # edges once downscaled.
    ss = 4
    overlay = Image.new("RGBA", (MASTER_SIZE * ss, MASTER_SIZE * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    # Bold and simple on purpose — this gets downscaled to 16px, where fine
    # detail (the earlier sparkle accents, a slimmer ribbon) just turns to
    # mush. A single big glyph is what actually stays legible that small.
    cx, cy = MASTER_SIZE * ss / 2, MASTER_SIZE * ss / 2 * 1.04
    ribbon_w = MASTER_SIZE * ss * 0.44
    ribbon_h = MASTER_SIZE * ss * 0.58
    d.polygon(
        ribbon_polygon(cx, cy, ribbon_w, ribbon_h, notch_depth=ribbon_h * 0.30),
        fill=RIBBON_COLOR,
    )

    overlay = overlay.resize((MASTER_SIZE, MASTER_SIZE), Image.LANCZOS)
    master = Image.alpha_composite(master, overlay)
    return master


def main():
    master = build_master()
    master.save(os.path.join(OUT_DIR, "icon-master.png"))

    for size in TARGET_SIZES:
        resized = master.resize((size, size), Image.LANCZOS)
        resized.save(os.path.join(OUT_DIR, f"icon{size}.png"))

    print("Generated:", ", ".join(f"icon{s}.png" for s in TARGET_SIZES), "and icon-master.png")


if __name__ == "__main__":
    main()
