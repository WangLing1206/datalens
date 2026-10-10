"""
Measure the real duration of each TTS segment with ffprobe (bundled with
imageio-ffmpeg), then write the timeline the recorder and the muxer share.

Run:  python tools/video/durations.py
Out:  tools/video/out/timeline.json
"""
from __future__ import annotations

import json
import os
import subprocess

import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")


def ffmpeg_exe() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def probe_duration(path: str, ffmpeg: str) -> float:
    """ffmpeg -i prints stream info to stderr; parse the duration from it."""
    proc = subprocess.run(
        [ffmpeg, "-i", path, "-f", "null", "-"],
        capture_output=True, text=True, errors="replace",
    )
    for line in proc.stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            stamp = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = stamp.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise RuntimeError(f"could not read duration of {path}")


def main() -> None:
    ffmpeg = ffmpeg_exe()
    print("ffmpeg:", ffmpeg)

    scenes = json.load(open(os.path.join(OUT, "scenes.json"), encoding="utf-8"))
    timeline = []
    cursor = 0.0

    for i, scene in enumerate(scenes):
        seg = os.path.join(OUT, f"seg-{i:02d}.mp3")
        audio = probe_duration(seg, ffmpeg)
        # Scene length = narration + a little breathing room.
        length = audio + float(scene.get("hold", 0.6))
        timeline.append({
            "index": i,
            "id": scene["id"],
            "audio": round(audio, 3),
            "start": round(cursor, 3),
            "length": round(length, 3),
            "zh": scene["zh"],
            "en": scene["en"],
        })
        cursor += length

    with open(os.path.join(OUT, "timeline.json"), "w", encoding="utf-8") as f:
        json.dump({"total": round(cursor, 3), "scenes": timeline}, f, ensure_ascii=False, indent=1)

    print(f"\ntotal runtime: {cursor:.1f}s  ({cursor / 60:.2f} min)")
    for t in timeline:
        print(f"  [{t['index']:02d}] {t['id']:<12} audio {t['audio']:6.2f}s  scene {t['length']:6.2f}s  @{t['start']:7.2f}s")


if __name__ == "__main__":
    main()
