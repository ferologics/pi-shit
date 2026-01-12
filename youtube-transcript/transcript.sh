#!/bin/bash
# Extract YouTube transcript using yt-dlp

set -e

if [ -z "$1" ]; then
  echo "Usage: transcript.sh <video-url-or-id> [language]"
  echo "  language: en (default), pl, de, es, ja, etc."
  exit 1
fi

URL="$1"
LANG="${2:-en}"
TMPFILE="/tmp/yt-transcript-$$"

trap "rm -f ${TMPFILE}.*.json3" EXIT

# Download subtitles (suppress all output)
yt-dlp --skip-download --write-auto-subs --sub-lang "$LANG" --sub-format json3 \
  -o "$TMPFILE" "$URL" >/dev/null 2>&1

SUBFILE=$(ls ${TMPFILE}.*.json3 2>/dev/null | head -1)

if [ -z "$SUBFILE" ]; then
  echo "Error: No subtitles found for language '$LANG'" >&2
  exit 1
fi

# Extract text with timestamps
jq -r '
  .events[] 
  | select(.segs) 
  | {
      time: (.tStartMs / 1000 | floor),
      text: ([.segs[].utf8 // ""] | join(""))
    }
  | select(.text | test("^\\s*$") | not)
  | "[\(.time | tostring | 
      if (. | tonumber) >= 3600 then
        "\((. | tonumber) / 3600 | floor):\(((. | tonumber) % 3600 / 60) | floor | tostring | if length == 1 then "0" + . else . end):\(((. | tonumber) % 60) | tostring | if length == 1 then "0" + . else . end)"
      elif (. | tonumber) >= 60 then
        "\((. | tonumber) / 60 | floor):\(((. | tonumber) % 60) | tostring | if length == 1 then "0" + . else . end)"
      else
        "0:\(. | if length == 1 then "0" + . else . end)"
      end)] \(.text)"
' "$SUBFILE"
