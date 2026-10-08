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
