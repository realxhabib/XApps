"""Assemble the promo from captured frame folders.

python3 compose.py edl.json out.mp4 [--preview] [--sheet sheet.jpg]
EDL: {"size": [1920,1080], "clips": [ {"src": "home", "start": 0, "end": 180,
        "xfade": 8,                   # crossfade frames with the previous clip (0 = hard cut)
        "crop": [x,y,w,h] | {"from": [x,y,w,h], "to": [x,y,w,h], "ease": true},
        "step": 1,                    # source frame step (2 = double speed)
        "hold": 0,                    # repeat the last frame n extra times
        "caption": {"dir": "cap-x", "at": 10} } ] }
"""
import json, os, subprocess, sys
from PIL import Image
import imageio_ffmpeg

VID = os.path.dirname(os.path.abspath(__file__))
FR = os.path.join(VID, "frames")


def ease(t):
    return 4 * t * t * t if t < 0.5 else 1 - pow(-2 * t + 2, 3) / 2


def load(src, i):
    for ext in ("jpg", "png"):
        p = os.path.join(FR, src, f"{i:05d}.{ext}")
        if os.path.exists(p):
            return Image.open(p).convert("RGB")
    raise FileNotFoundError(f"{src}/{i}")


def clip_frames(c, W, H):
    step = c.get("step", 1)
    idx = list(range(c["start"], c["end"], step))
    idx += [idx[-1]] * c.get("hold", 0)
    n = len(idx)
    cap = c.get("caption")
    capn = 0
    if cap:
        capn = len([f for f in os.listdir(os.path.join(FR, cap["dir"])) if f.endswith(".png")])
    for k, i in enumerate(idx):
        im = load(c["src"], i)
        crop = c.get("crop")
        if crop is not None:
            if isinstance(crop, dict):
                t = k / max(1, n - 1)
                if crop.get("ease", True):
                    t = ease(t)
                a, b = crop["from"], crop["to"]
                r = [a[j] + (b[j] - a[j]) * t for j in range(4)]
            else:
                r = crop
            im = im.resize((W, H), Image.LANCZOS, box=(r[0], r[1], r[0] + r[2], r[1] + r[3]))
        elif im.size != (W, H):
            im = im.resize((W, H), Image.LANCZOS)
        if cap:
            j = k - cap.get("at", 0)
            if 0 <= j < capn:
                ov = Image.open(os.path.join(FR, cap["dir"], f"{j:05d}.png")).convert("RGBA")
                if ov.size != (W, H):
                    ov = ov.resize((W, H), Image.LANCZOS)
                im = Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB")
        yield im


def main():
    edl = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    preview = "--preview" in sys.argv
    W, H = edl.get("size", [1920, 1080])
    ow, oh = (W // 2, H // 2) if preview else (W, H)
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{ow}x{oh}", "-r", "30", "-i", "-"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast" if preview else "slow", "-crf", "26" if preview else next((a.split("=")[1] for a in sys.argv if a.startswith("--crf=")), "17"),
            "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart", out]
    ff_p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    tail = []  # frames held back for crossfading into the next clip
    total = 0
    times = []

    def emit(im):
        nonlocal total
        if preview:
            im = im.resize((ow, oh), Image.BILINEAR)
        ff_p.stdin.write(im.tobytes())
        total += 1

    for ci, c in enumerate(edl["clips"]):
        nxt = edl["clips"][ci + 1] if ci + 1 < len(edl["clips"]) else None
        keep = nxt.get("xfade", 0) if nxt else 0
        x = c.get("xfade", 0)
        frames = clip_frames(c, W, H)
        start_t = total - len(tail) if x else total
        times.append((c.get("name", c["src"]), start_t))
        buf = []
        for k, im in enumerate(frames):
            if k < x and tail:
                a = tail.pop(0)
                t = (k + 1) / (x + 1)
                im = Image.blend(a, im, t)
            buf.append(im)
            if len(buf) > keep:
                emit(buf.pop(0))
        for a in tail:  # previous clip longer than overlap window
            emit(a)
        tail = buf
    for a in tail:
        emit(a)
    ff_p.stdin.close()
    ff_p.wait()
    print(f"frames {total} = {total / 30:.2f}s")
    for name, t in times:
        print(f"  {t / 30:6.2f}s  {name}")
    json.dump({"total": total, "times": times}, open(out + ".json", "w"))


if __name__ == "__main__":
    main()
