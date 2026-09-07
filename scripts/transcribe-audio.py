"""Transcribe locally with Python 3.9+ and faster-whisper.

Install: python -m pip install faster-whisper==1.2.1
Usage: python scripts/transcribe-audio.py reference/recording.m4a
Models download on first use; audio is processed locally on the CPU.
"""

import argparse
from pathlib import Path


def timestamp(seconds: float) -> str:
    total = round(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path, help="Audio file, including M4A, MP3, or WAV")
    parser.add_argument("--model", default="small", help="Whisper model or local model directory (default: small)")
    parser.add_argument("--language", default="id", help="Language code, or auto to detect (default: id)")
    parser.add_argument("--output", type=Path, help="Output text path (default: <audio>.transcript.txt)")
    args = parser.parse_args()

    if not args.audio.is_file():
        parser.error(f"Audio file not found: {args.audio}")
    output = args.output or args.audio.with_suffix(".transcript.txt")
    if output.exists():
        parser.error(f"Output already exists; choose another --output: {output}")
    if not output.parent.is_dir():
        parser.error(f"Output directory does not exist: {output.parent}")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        parser.exit(1, "Install dependency: python -m pip install faster-whisper==1.2.1\n")

    try:
        print(f"Loading model {args.model} on CPU (may download on first use)...", flush=True)
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            str(args.audio),
            language=None if args.language == "auto" else args.language,
            vad_filter=True,
            beam_size=5,
            # Avoid carrying hallucinated repetitions through long recordings.
            condition_on_previous_text=False,
            temperature=0,
        )
        print(f"Language: {info.language}; duration: {timestamp(info.duration)}", flush=True)
        lines = [
            f"Source: {args.audio.name}",
            f"Model: {args.model}; language: {info.language}",
            "Automatic transcript; verify names, numbers, and unclear passages against the audio.",
            "",
        ]
        for segment in segments:
            line = f"[{timestamp(segment.start)} - {timestamp(segment.end)}] {segment.text.strip()}"
            lines.append(line)
            print(line, flush=True)
        # Only create the final transcript after inference completes successfully.
        with output.open("x", encoding="utf-8") as transcript:
            transcript.write("\n".join(lines) + "\n")
        print(f"Transcript saved: {output}", flush=True)
    except (OSError, RuntimeError, ValueError) as error:
        parser.exit(1, f"Transcription failed: {error}\n")


if __name__ == "__main__":
    main()
