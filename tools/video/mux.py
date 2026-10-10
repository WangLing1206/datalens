"""
Mux the recorded screen capture with the TTS narration into a shareable MP4.

The narration is concatenated in scene order, then delayed so it lines up with
the picture. The delay is derived from the recording itself (recorded length
minus the planned scene total), so it self-corrects rather than relying on a
hard-coded lead-in.

Run:  python tools/video/mux.py
Out:  tools/video/out/datalens-demo.mp4  (+ datalens-demo.srt)
"""
from __future__ import annotations

import json
import os
import subprocess

import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")

# Measured by tools/video/calibrate.mjs: the recording's t=0 lands this many
# seconds before the timestamp taken right after `page.goto` returned.
VIDEO_START_OFFSET = 0.5


def ffmpeg() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def duration(path: str, exe: str) -> float:
    proc = subprocess.run([exe, "-i", path, "-f", "null", "-"],
                          capture_output=True, text=True, errors="replace")
    for line in proc.stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            stamp = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = stamp.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise RuntimeError(f"no duration for {path}")


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def build_narration(scenes: list[dict], exe: str) -> str:
    """One track where each segment starts exactly at its scene's start time.

    Concatenating the segments back to back would drift: every scene's audio is
    a little shorter than its scene, so by the last scene the narration runs
    ~10s ahead of the picture. Padding each segment with silence to the scene
    length keeps the audio on the same grid as the video and the subtitles.
    """
    parts: list[str] = []
    for i, sc in enumerate(scenes):
        seg = os.path.join(OUT, f"seg-{i:02d}.mp3")
        padded = os.path.join(OUT, f"pad-{i:02d}.wav")
        want = float(sc["length"])
        subprocess.run(
            [exe, "-y", "-i", seg, "-af", f"apad=whole_dur={want:.3f}", "-ar", "44100", "-ac", "2", padded],
            check=True, capture_output=True,
        )
        parts.append(padded)

    list_path = os.path.join(OUT, "audio-list.txt")
    with open(list_path, "w", encoding="utf-8") as f:
        for p in parts:
            f.write(f"file '{p.replace(os.sep, '/')}'\n")

    narration = os.path.join(OUT, "narration.wav")
    subprocess.run(
        [exe, "-y", "-f", "concat", "-safe", "0", "-i", list_path, "-c", "copy", narration],
        check=True, capture_output=True,
    )
    return narration


def main() -> None:
    exe = ffmpeg()
    rec = json.load(open(os.path.join(OUT, "recorded.json"), encoding="utf-8"))
    video = rec["video"]
    scenes = rec["scenes"]
    planned = float(rec["plannedSeconds"])

    video_len = duration(video, exe)

    # Where scene 0 sits inside the webm. The recorder logs wall-clock marks;
    # tools/video/calibrate.mjs measures how video time maps onto that clock
    # (the capture begins at the app's first paint, a fraction of a second
    # before goto returns). Falling back to the duration difference keeps the
    # mux usable if the marks are missing.
    marks = rec.get("marks") or []
    t_after_load = rec.get("tAfterLoad")
    if marks and t_after_load:
        lead_in = VIDEO_START_OFFSET + (marks[0] - t_after_load) / 1000.0
    else:
        lead_in = max(0.0, video_len - planned)

    # Trim the page-load dead time, keeping a short beat so the opening caption
    # is readable before the narration starts.
    KEEP = 0.8
    trim = max(0.0, min(lead_in - KEEP, lead_in))
    audio_offset = lead_in - trim
    print(f"video {video_len:.2f}s | planned {planned:.2f}s | lead-in {lead_in:.2f}s | trim {trim:.2f}s")

    # --- 1. narration, padded to the scene grid -----------------------------
    narration = build_narration(scenes, exe)
    print(f"narration: {duration(narration, exe):.2f}s")

    # --- 2. mux -------------------------------------------------------------
    out_mp4 = os.path.join(OUT, "datalens-demo.mp4")
    cmd = [
        exe, "-y",
        *(["-ss", f"{trim:.3f}"] if trim > 0.05 else []),
        "-i", video,
        "-itsoffset", f"{audio_offset:.3f}", "-i", narration,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", "25",
        "-c:a", "aac", "-b:a", "160k", "-ac", "2",
        "-movflags", "+faststart",
        out_mp4,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if proc.returncode != 0:
        print(proc.stderr[-3000:])
        raise SystemExit("ffmpeg mux failed")
    print(f"\nwrote {out_mp4}  ({os.path.getsize(out_mp4) / 1024 / 1024:.1f} MB)")
    print(f"final duration: {duration(out_mp4, exe):.2f}s")

    # --- 3. bilingual SRT ---------------------------------------------------
    srt_path = os.path.join(OUT, "datalens-demo.srt")
    lines: list[str] = []
    for i, sc in enumerate(scenes):
        start = audio_offset + float(sc["start"])
        end = start + float(sc["length"])
        lines.append(str(i + 1))
        lines.append(f"{srt_time(start)} --> {srt_time(end)}")
        lines.append(sc["zh"])
        lines.append(sc["en"])
        lines.append("")
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"wrote {srt_path}")


if __name__ == "__main__":
    main()
