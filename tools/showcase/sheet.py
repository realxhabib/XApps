import sys
from PIL import Image, ImageDraw
d, idx, out = sys.argv[1], [int(x) for x in sys.argv[2].split(',')], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 3
W = 640; H = 360
rows = (len(idx) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, H * rows), 'black')
for k, i in enumerate(idx):
    try: im = Image.open(f'{d}/{i:05d}.jpg').resize((W, H))
    except Exception: continue
    ImageDraw.Draw(im).text((6, 4), str(i), fill='yellow')
    sheet.paste(im, ((k % cols) * W, (k // cols) * H))
sheet.save(out, quality=85)
