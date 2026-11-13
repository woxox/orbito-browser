#!/usr/bin/env python3
"""Usage: python3 scripts/dev-icons.py  (needs: pip install cairosvg pillow)

Regenerates configs/branding-dev/release/ from configs/branding-dev/icon.svg. Each
icon mirrors its release counterpart in configs/branding/release/ (canvas size and
tile placement), so dev and release builds line up everywhere the icon shows.
"""
import io
import json
import os
import shutil
import struct
import subprocess
import tempfile
from functools import partial
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "configs/branding-dev/icon.svg"
RELEASE = ROOT / "configs/branding/release"
OUT = ROOT / "configs/branding-dev/release"
FULL_VIEWBOX = 'viewBox="0 0 1024 1024"'
TILE_VIEWBOX = 'viewBox="40 40 944 944"'
MAC_SIZES = (16, 32, 128, 256, 512)


def tile_svg():
    svg = SVG.read_text()
    assert FULL_VIEWBOX in svg, f"{SVG} must use {FULL_VIEWBOX}"
    return svg.replace(FULL_VIEWBOX, TILE_VIEWBOX, 1).encode()


def render(size, box):
    left, top, right, bottom = box
    tile = cairosvg.svg2png(bytestring=tile_svg(), output_width=right - left, output_height=bottom - top)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.paste(Image.open(io.BytesIO(tile)).convert("RGBA"), (left, top))
    return canvas


def encode(image):
    buf = io.BytesIO()
    image.save(buf, "PNG")
    return buf.getvalue()


def mirror(ref):
    ref = ref.convert("RGBA")
    return render(ref.size, ref.getchannel("A").getbbox())


def png(rel):
    return encode(mirror(Image.open(RELEASE / rel)))


def ico_frames(data):
    _, _, count = struct.unpack_from("<HHH", data, 0)
    for i in range(count):
        size, offset = struct.unpack_from("<II", data, 6 + 16 * i + 8)
        frame = data[offset:offset + size]
        assert frame.startswith(b"\x89PNG"), "release .ico frames are expected to be PNG"
        yield frame


def ico(rel):
    frames = [encode(mirror(Image.open(io.BytesIO(f)))) for f in ico_frames((RELEASE / rel).read_bytes())]
    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = len(header) + 16 * len(frames)
    entries = b""
    for frame in frames:
        w, h = Image.open(io.BytesIO(frame)).size
        # ICO stores 256 as 0.
        entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(frame), offset)
        offset += len(frame)
    return header + entries + b"".join(frames)


def svg_copy(rel):
    return SVG.read_bytes()


def about(size, rel):
    # surfer makes about-logo*.png by resizing logo.png, so do the same.
    logo = Image.open(io.BytesIO(png("logo.png")))
    return encode(logo.resize((size, size), Image.LANCZOS))


def assets_car(rel):
    has_actool = shutil.which("xcrun") and subprocess.run(["xcrun", "--find", "actool"], capture_output=True).returncode == 0
    if not has_actool:
        print(f"skipped {rel}: needs Xcode actool (macOS); existing file left as is")
        return None
    ref = Image.open(RELEASE / "logo-mac.png").convert("RGBA")
    ref_bbox, ref_size = ref.getchannel("A").getbbox(), ref.size[0]
    with tempfile.TemporaryDirectory() as tmp:
        appiconset = Path(tmp) / "Assets.xcassets/AppIcon.appiconset"
        appiconset.mkdir(parents=True)
        images = []
        for size in MAC_SIZES:
            for scale in (1, 2):
                px = size * scale
                name = f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
                box = tuple(round(v * px / ref_size) for v in ref_bbox)
                (appiconset / name).write_bytes(encode(render((px, px), box)))
                images.append({"idiom": "mac", "size": f"{size}x{size}", "scale": f"{scale}x", "filename": name})
        (appiconset / "Contents.json").write_text(json.dumps({"images": images, "info": {"version": 1, "author": "xcode"}}, indent=2))
        subprocess.run(
            ["xcrun", "actool", "--compile", tmp, "--platform", "macosx", "--minimum-deployment-target", "11.0",
             "--app-icon", "AppIcon", "--output-partial-info-plist", f"{tmp}/p.plist", str(appiconset.parent)],
            check=True, stdout=subprocess.DEVNULL,
        )
        return (Path(tmp) / "Assets.car").read_bytes()


TARGETS = [
    *((f"logo{n}.png", png) for n in (16, 22, 24, 32, 48, 64, 128, 256, 512)),
    ("logo.png", png),
    ("logo-mac.png", png),
    ("VisualElements_150.png", png),
    ("VisualElements_70.png", png),
    ("firefox.ico", ico),
    ("firefox64.ico", ico),
    ("content/about-logo.svg", svg_copy),
    ("content/about-logo.png", partial(about, 512)),
    ("content/about-logo@2x.png", partial(about, 1024)),
    ("Assets.car", assets_car),
]


def main():
    for rel, build in TARGETS:
        data = build(rel)
        if data is None:
            continue
        dest = OUT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, dest)
        print(f"wrote {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
