"""Synthesize a restrained pad + soft pulse bed with ffmpeg lavfi.
python3 audio.py <duration_s> <pulse_start_s> <pulse_end_s> out.wav
"""
import subprocess, sys
import imageio_ffmpeg

D = float(sys.argv[1]); P0 = float(sys.argv[2]); P1 = float(sys.argv[3]); out = sys.argv[4]
BPM = 112
B = 60 / BPM
L = 16 * B  # four bars per chord
CHORDS = [
    [87.31, 130.81, 164.81, 220.00, 392.00],   # Fmaj9
    [110.00, 164.81, 196.00, 261.63, 293.66],  # Am7(11)
    [130.81, 196.00, 246.94, 329.63],          # Cmaj7
    [98.00, 146.83, 220.00, 293.66, 329.63],   # G6/9
]
ff = imageio_ffmpeg.get_ffmpeg_exe()
inputs, filters, labels = [], [], []
for k, ch in enumerate(CHORDS):
    terms = []
    for i, f in enumerate(ch):
        a = 0.055 if f < 150 else 0.04 if f < 300 else 0.022
        # two slightly detuned partials + a quiet octave for air; slow per-voice shimmer
        terms.append(f"{a}*(sin(2*PI*{f}*t)+0.8*sin(2*PI*{f*1.0035:.3f}*t+{i})+0.12*sin(2*PI*{2*f}*t))*(0.85+0.15*sin(2*PI*{0.11 + 0.03*i:.2f}*t+{k+i}))")
    expr = "+".join(terms)
    inputs += ["-f", "lavfi", "-i", f"aevalsrc='{expr}':s=48000:d={D}"]
    x = f"mod(t-{k*L:.4f}+0.9+{4*L:.4f},{4*L:.4f})"
    w = f"if(lt({x},1.8),{x}/1.8,if(lt({x},{L:.4f}),1,if(lt({x},{L+1.8:.4f}),1-({x}-{L:.4f})/1.8,0)))"
    filters.append(f"[{k}:a]volume=eval=frame:volume='{w}'[p{k}]")
    labels.append(f"[p{k}]")
# soft kick: 110→46 Hz sweep, short decay; only between P0 and P1
b = f"mod(t-{P0},{2*B:.5f})"
kick = f"0.42*sin(2*PI*(46*{b}+(64/28)*(1-exp(-28*{b}))))*exp(-11*{b})*gte(t,{P0})*lte(t,{P1})"
inputs += ["-f", "lavfi", "-i", f"aevalsrc='{kick}':s=48000:d={D}"]
nk = len(CHORDS)
# pad ducks under the pulse (gentle sidechain feel)
duck = f"if(between(t,{P0},{P1}),1-0.25*exp(-5*mod(t-{P0},{2*B:.5f})),1)"
filters.append(f"{''.join(labels)}amix=inputs={nk}:normalize=0,lowpass=f=2400,aecho=0.8:0.6:180|310:0.22|0.14,volume=eval=frame:volume='{duck}'[pad]")
filters.append(f"[{nk}:a]lowpass=f=220[k]")
filters.append(f"[pad][k]amix=inputs=2:normalize=0,highpass=f=30,afade=t=in:st=0:d=2.2,afade=t=out:st={D-3.2}:d=3.2,alimiter=limit=0.5,volume=0.55[out]")
cmd = [ff, "-y", *inputs, "-filter_complex", ";".join(filters), "-map", "[out]", "-ac", "2", "-ar", "48000", out]
subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL)
r = subprocess.run([ff, "-i", out, "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
print("\n".join(l for l in r.stderr.splitlines() if "volume" in l))
