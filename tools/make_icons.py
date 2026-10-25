#!/usr/bin/env python3
"""Gera os ícones e a tela de abertura (splash) do app Android a partir de UMA imagem.

  python3 tools/make_icons.py minha_imagem.png          # copia para assets/icon.png e gera tudo
  python3 tools/make_icons.py                           # regenera a partir de assets/icon.png
  python3 tools/make_icons.py img.png --full            # a imagem preenche o ícone inteiro (sem margem)
  python3 tools/make_icons.py img.png --bg "#101020"    # cor de fundo (padrão: tirada das bordas da imagem)
  python3 tools/make_icons.py --placeholder             # arte provisória (coração + estrela)

A saída vai para android-res/ (fica no repositório); tools/android_customize.py copia para o projeto Android.
Imagem quadrada, de preferência 1024×1024. Requer Pillow (pip install pillow)."""
import os, sys, shutil
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT, SRC = os.path.join(ROOT, 'android-res'), os.path.join(ROOT, 'assets', 'icon.png')
DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
SPLASH = {'port': {'mdpi': (320, 480), 'hdpi': (480, 800), 'xhdpi': (720, 1280), 'xxhdpi': (960, 1600), 'xxxhdpi': (1280, 1920)},
          'land': {'mdpi': (480, 320), 'hdpi': (800, 480), 'xhdpi': (1280, 720), 'xxhdpi': (1600, 960), 'xxxhdpi': (1920, 1280)}}

def placeholder(path, size=1024):
    """Arte provisória própria: SOUL (coração) vermelho e uma estrela, em pixel-art, sobre preto."""
    heart = ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....']
    star = ['...X...', '...X...', '..XXX..', 'XXXXXXX', '..XXX..', '...X...', '...X...']
    img = Image.new('RGBA', (size, size), (0, 0, 0, 255)); d = ImageDraw.Draw(img)
    def blit(rows, cell, ox, oy, color):
        for y, r in enumerate(rows):
            for x, c in enumerate(r):
                if c == 'X': d.rectangle([ox + x * cell, oy + y * cell, ox + (x + 1) * cell - 1, oy + (y + 1) * cell - 1], fill=color)
    c = size // 16
    blit(heart, c, (size - 9 * c) // 2, (size - 8 * c) // 2 + c, (255, 0, 0, 255))
    blit(star, c // 2, size // 2 + 2 * c, c, (255, 255, 255, 255))
    for x, y in ((2, 3), (13, 8), (3, 13)): d.rectangle([x * c, y * c, x * c + c // 2 - 1, y * c + c // 2 - 1], fill=(255, 255, 255, 255))
    img.save(path)

def load_square(path, size=1024):
    im = Image.open(path).convert('RGBA'); w, h = im.size
    if w != h:  # completa com transparente, sem cortar nada da imagem
        s = max(w, h); sq = Image.new('RGBA', (s, s), (0, 0, 0, 0)); sq.paste(im, ((s - w) // 2, (s - h) // 2)); im = sq
    return im.resize((size, size), Image.LANCZOS)

def edge_color(im):
    """Cor média das bordas (ignora pixels transparentes); preto se a imagem não tem fundo."""
    px, n = im.load(), im.size[0]; acc = [0, 0, 0]; cnt = 0
    for i in range(0, n, max(1, n // 64)):
        for x, y in ((i, 0), (i, n - 1), (0, i), (n - 1, i)):
            r, g, b, a = px[x, y]
            if a > 200: acc[0] += r; acc[1] += g; acc[2] += b; cnt += 1
    return tuple(v // cnt for v in acc) if cnt > 40 else (0, 0, 0)

def fit(im, box, cover=False):
    s = box if cover else box
    return im.resize((s, s), Image.LANCZOS)

def mask(size, shape):
    m = Image.new('L', (size * 4, size * 4), 0); d = ImageDraw.Draw(m)
    if shape == 'circle': d.ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
    else: d.rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=int(size * 4 * 0.22), fill=255)
    return m.resize((size, size), Image.LANCZOS)

def legacy(im, bg, size, shape, full):
    base = Image.new('RGBA', (size, size), bg + (255,))
    art = fit(im, size if full else int(size * 0.80)); base.alpha_composite(art, ((size - art.size[0]) // 2, (size - art.size[1]) // 2))
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0)); out.paste(base, (0, 0), mask(size, shape)); return out

def main():
    args = sys.argv[1:]; full = '--full' in args; bg = None
    if '--bg' in args: h = args[args.index('--bg') + 1].lstrip('#'); bg = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    files = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] != '--bg')]
    os.makedirs(os.path.dirname(SRC), exist_ok=True)
    if '--placeholder' in args: placeholder(SRC)
    elif files:
        if os.path.abspath(files[0]) != os.path.abspath(SRC): shutil.copyfile(files[0], SRC)
    elif not os.path.exists(SRC): sys.exit('Sem imagem: passe um arquivo ou use --placeholder')
    im = load_square(SRC); bg = bg or edge_color(im)
    shutil.rmtree(OUT, ignore_errors=True)
    for d, f in DENS.items():
        os.makedirs(f'{OUT}/mipmap-{d}', exist_ok=True)
        s = round(48 * f); legacy(im, bg, s, 'square', full).save(f'{OUT}/mipmap-{d}/ic_launcher.png')
        legacy(im, bg, s, 'circle', full).save(f'{OUT}/mipmap-{d}/ic_launcher_round.png')
        fs = round(108 * f); fg = Image.new('RGBA', (fs, fs), (0, 0, 0, 0))   # adaptativo: 108 dp; só o miolo (66 dp) é sempre visível
        art = fit(im, fs if full else round(fs * 66 / 108)); fg.alpha_composite(art, ((fs - art.size[0]) // 2, (fs - art.size[1]) // 2))
        fg.save(f'{OUT}/mipmap-{d}/ic_launcher_foreground.png')
    os.makedirs(f'{OUT}/values', exist_ok=True)
    open(f'{OUT}/values/ic_launcher_background.xml', 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#%02X%02X%02X</color>\n</resources>\n' % bg)
    for o, sizes in SPLASH.items():       # abertura: fundo da cor do ícone com a arte no centro
        for d, (w, h) in sizes.items():
            sp = Image.new('RGB', (w, h), bg); a = fit(im, int(min(w, h) * 0.30)); sp.paste(a, ((w - a.size[0]) // 2, (h - a.size[1]) // 2), a); os.makedirs(f'{OUT}/drawable-{o}-{d}', exist_ok=True); sp.save(f'{OUT}/drawable-{o}-{d}/splash.png')
    os.makedirs(f'{OUT}/drawable', exist_ok=True)
    sp = Image.new('RGB', (480, 320), bg); a = fit(im, 96); sp.paste(a, (192, 112), a); sp.save(f'{OUT}/drawable/splash.png')
    print('ícones e splash gerados em android-res/  (fundo #%02x%02x%02x, %s)' % (bg + ('imagem inteira' if full else 'com margem',)))

if __name__ == '__main__': main()
