"""Generate every app icon from the Azuria logo (brand/azuria-logo-original.png)."""
from PIL import Image, ImageDraw
import struct, io, os, json
BG = (0x26, 0x0E, 0x0D)
logo = Image.open('brand/azuria-logo-original.png').convert('RGB')

def square(size, logo_width=0.86, rounded=False, margin=0.0):
    s = size * 4
    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    inner = int(s * (1 - 2 * margin))
    off = (s - inner) // 2
    tile = Image.new('RGBA', (inner, inner), BG + (255,))
    w = int(inner * logo_width); h = round(logo.height * w / logo.width)
    tile.paste(logo.resize((w, h), Image.LANCZOS), ((inner - w) // 2, (inner - h) // 2))
    if rounded:
        mask = Image.new('L', (inner, inner), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, inner - 1, inner - 1], radius=int(inner * 0.225), fill=255)
        tile.putalpha(mask)
    canvas.paste(tile, (off, off), tile)
    return canvas.resize((size, size), Image.LANCZOS)

def opaque(img): return img.convert('RGB')

os.makedirs('public', exist_ok=True)
square(192, rounded=True).save('public/icon-192.png')
square(512, rounded=True).save('public/icon-512.png')
opaque(square(512, logo_width=0.72)).save('public/icon-maskable-512.png')   # content inside the maskable safe zone
opaque(square(180)).save('public/apple-touch-icon.png')                     # iOS rounds it itself
opaque(square(1024)).save('public/icon-1024.png')
square(64, logo_width=0.95, rounded=True).save('public/favicon.png')

# iOS app icon (must be opaque, no transparency)
d = 'ios/App/App/Assets.xcassets/AppIcon.appiconset'
if os.path.isdir(d):
    for img in json.load(open(d + '/Contents.json'))['images']:
        if 'filename' in img: opaque(square(1024)).save(os.path.join(d, img['filename']))

# macOS .icns: Apple's squircle-ish tile with transparent margin, PNG entries
def icns(path):
    entries = [(b'ic07', 128), (b'ic08', 256), (b'ic09', 512), (b'ic10', 1024), (b'ic11', 32), (b'ic12', 64), (b'ic13', 256), (b'ic14', 512)]
    chunks = b''
    for code, px in entries:
        buf = io.BytesIO(); square(px, rounded=True, margin=0.1, logo_width=0.84).save(buf, 'PNG')
        data = buf.getvalue(); chunks += code + struct.pack('>I', len(data) + 8) + data
    open(path, 'wb').write(b'icns' + struct.pack('>I', len(chunks) + 8) + chunks)
os.makedirs('electron', exist_ok=True)
icns('electron/icon.icns')
square(512, rounded=True, margin=0.1, logo_width=0.84).save('electron/icon.png')
print('icons done')

# ---------- Android ----------
res = 'android/app/src/main/res'
if os.path.isdir(res):
    BGHEX = '#260E0D'
    dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
    for d, k in dens.items():
        folder = f'{res}/mipmap-{d}'
        os.makedirs(folder, exist_ok=True)
        legacy = int(48 * k)
        opaque(square(legacy, logo_width=0.86)).save(f'{folder}/ic_launcher.png')
        # round legacy icon
        r = square(legacy * 4, logo_width=0.80).convert('RGBA')
        m = Image.new('L', r.size, 0); ImageDraw.Draw(m).ellipse([0, 0, r.size[0] - 1, r.size[1] - 1], fill=255); r.putalpha(m)
        r.resize((legacy, legacy), Image.LANCZOS).save(f'{folder}/ic_launcher_round.png')
        # adaptive foreground: 108dp canvas, logo inside the 66dp safe circle, transparent around it
        fg = int(108 * k)
        canvas = Image.new('RGBA', (fg * 4, fg * 4), (0, 0, 0, 0))
        lw = int(fg * 4 * 0.58); lh = round(logo.height * lw / logo.width)
        tl = Image.open('src/assets/azuria-logo.png').convert('RGBA')  # transparent-background logo
        lh = round(tl.height * lw / tl.width)
        canvas.paste(tl.resize((lw, lh), Image.LANCZOS), ((fg * 4 - lw) // 2, (fg * 4 - lh) // 2), tl.resize((lw, lh), Image.LANCZOS))
        canvas.resize((fg, fg), Image.LANCZOS).save(f'{folder}/ic_launcher_foreground.png')
    open(f'{res}/values/ic_launcher_background.xml', 'w').write(f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{BGHEX}</color>\n</resources>\n')
    # launch screens: espresso with the logo centred
    for folder in os.listdir(res):
        p = f'{res}/{folder}/splash.png'
        if os.path.exists(p):
            w, h = Image.open(p).size
            s = Image.new('RGB', (w, h), BG)
            tl = Image.open('src/assets/azuria-logo.png').convert('RGBA')
            lw = int(min(w, h) * 0.55); lh = round(tl.height * lw / tl.width)
            t = tl.resize((lw, lh), Image.LANCZOS)
            s.paste(t, ((w - lw) // 2, (h - lh) // 2), t)
            s.save(p)
    print('android icons done')
