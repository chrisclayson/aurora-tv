#!/usr/bin/env python3
"""Generate the Aurora app icon (512x512 PNG) with no external assets."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SIZE = 512
canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

# Diagonal gradient: deep navy -> aurora blue -> violet.
grad = Image.new("RGB", (SIZE, SIZE))
px = grad.load()
for y in range(SIZE):
    for x in range(SIZE):
        t = (x / SIZE) * 0.45 + (y / SIZE) * 0.55
        if t < 0.5:
            k = t / 0.5
            c1, c2 = (10, 16, 38), (37, 74, 191)
        else:
            k = (t - 0.5) / 0.5
            c1, c2 = (37, 74, 191), (104, 58, 190)
        px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * k) for i in range(3))

mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=118, fill=255)
canvas.paste(grad, (0, 0), mask)

# Soft highlight in the upper-left.
glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((-150, -210, 380, 320), fill=(150, 190, 255, 90))
glow = glow.filter(ImageFilter.GaussianBlur(90))
canvas.alpha_composite(Image.composite(glow, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), mask))

draw = ImageDraw.Draw(canvas)
font = None
for path in (
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/SFNSDisplay-Bold.otf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
):
    try:
        font = ImageFont.truetype(path, 320)
        break
    except Exception:
        continue
if font is None:
    font = ImageFont.load_default()

text = "A"
bbox = draw.textbbox((0, 0), text, font=font)
w = bbox[2] - bbox[0]
h = bbox[3] - bbox[1]
draw.text(((SIZE - w) / 2 - bbox[0], (SIZE - h) / 2 - bbox[1] - 14), text, font=font, fill=(255, 255, 255, 255))

# Fine inner border.
draw.rounded_rectangle((3, 3, SIZE - 4, SIZE - 4), radius=116, outline=(255, 255, 255, 40), width=3)

canvas.save("icon.png")
print("wrote icon.png")
