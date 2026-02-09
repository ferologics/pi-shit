---
name: youtube-transcript
description: Fetch transcripts from YouTube videos using yt-dlp. Supports any language with auto-generated or manual captions. Use for summarization, analysis, or translation tasks.
---

# YouTube Transcript

Fetch transcripts from YouTube videos using `yt-dlp`.

## Requirements

```bash
brew install yt-dlp jq
```

## Usage

```bash
{baseDir}/transcript.sh <video-url-or-id> [language]
```

## Examples

```bash
# English (default)
{baseDir}/transcript.sh "https://youtu.be/dQw4w9WgXcQ"

# Polish
{baseDir}/transcript.sh "https://youtu.be/ksWAT3uqlWA" pl

# German
{baseDir}/transcript.sh "https://www.youtube.com/watch?v=VIDEO_ID" de

# Just video ID works too
{baseDir}/transcript.sh dQw4w9WgXcQ
```

## Output

Timestamped transcript:

```
[0:00] [Music]
[0:18] We're no strangers to
[0:21] love. You know the rules...
[1:23] Never gonna give you up
```

## Supported Languages

Any language code: `en`, `pl`, `de`, `es`, `ja`, `pt`, `fr`, `it`, etc.

Use `yt-dlp --list-subs <url>` to see available languages for a video.

## Notes

- Works with auto-generated and manual captions
- Falls back to auto-subs if manual not available
- No npm/node required - just yt-dlp and jq
