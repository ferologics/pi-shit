#!/bin/bash
set -e

# Defaults
TARGET_MB=10
SCALE=1920
NO_AUDIO=false

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-audio) NO_AUDIO=true; shift ;;
    --scale) SCALE="$2"; shift 2 ;;
    --target) TARGET_MB="$2"; shift 2 ;;
    -*) echo "Unknown option: $1"; exit 1 ;;
    *) 
      if [[ -z "$INPUT" ]]; then INPUT="$1"
      elif [[ -z "$OUTPUT" ]]; then OUTPUT="$1"
      else echo "Too many arguments"; exit 1
      fi
      shift ;;
  esac
done

if [[ -z "$INPUT" || -z "$OUTPUT" ]]; then
  echo "Usage: compress.sh <input> <output> [options]"
  echo ""
  echo "Options:"
  echo "  --target MB    Target size in MB (default: 10)"
  echo "  --scale WIDTH  Scale to width, 0 to disable (default: 1920)"
  echo "  --no-audio     Remove audio track"
  echo ""
  echo "Examples:"
  echo "  compress.sh video.mov out.mp4                    # 10MB default"
  echo "  compress.sh video.mov out.mp4 --target 25       # 25MB for Slack"
  echo "  compress.sh video.mov out.mp4 --no-audio        # No audio"
  echo "  compress.sh video.mov out.mp4 --scale 1280      # Lower res"
  exit 1
fi

if [[ ! -f "$INPUT" ]]; then
  echo "Error: Input file not found: $INPUT"
  exit 1
fi

# Get duration
DURATION=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$INPUT")
DURATION_INT=${DURATION%.*}

echo "Input: $INPUT"
echo "Duration: ${DURATION_INT}s"
echo "Target: ${TARGET_MB}MB"

# Calculate bitrate (use 95% of target to stay safely under)
SAFE_TARGET=$(echo "$TARGET_MB * 0.95" | bc)
TARGET_KBITS=$(echo "$SAFE_TARGET * 8000 / 1" | bc)

if [[ "$NO_AUDIO" == "true" ]]; then
  VIDEO_BITRATE=$((TARGET_KBITS / DURATION_INT))
  AUDIO_OPTS="-an"
  echo "Audio: disabled"
else
  AUDIO_BITRATE=64
  VIDEO_BITRATE=$((TARGET_KBITS / DURATION_INT - AUDIO_BITRATE))
  AUDIO_OPTS="-c:a aac -b:a ${AUDIO_BITRATE}k"
  echo "Audio: ${AUDIO_BITRATE}k"
fi

# Ensure minimum bitrate
if [[ $VIDEO_BITRATE -lt 100 ]]; then
  echo "Warning: Target too small for duration, using minimum bitrate"
  VIDEO_BITRATE=100
fi

# Build video filter
if [[ "$SCALE" == "0" ]]; then
  VF="fps=30"
  echo "Scale: original"
else
  VF="scale=${SCALE}:-2,fps=30"
  echo "Scale: ${SCALE}px width"
fi

echo "Video: ${VIDEO_BITRATE}k"
echo ""

# Two-pass encoding
echo "Pass 1/2..."
ffmpeg -y -i "$INPUT" \
  -vf "$VF" \
  -c:v libx264 -b:v "${VIDEO_BITRATE}k" -pass 1 \
  -an -f null /dev/null 2>/dev/null

echo "Pass 2/2..."
ffmpeg -y -i "$INPUT" \
  -vf "$VF" \
  -c:v libx264 -b:v "${VIDEO_BITRATE}k" -pass 2 \
  $AUDIO_OPTS \
  "$OUTPUT" 2>/dev/null

# Cleanup
rm -f ffmpeg2pass-0.log ffmpeg2pass-0.log.mbtree 2>/dev/null

# Report
FINAL_SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
echo ""
echo "Done: $OUTPUT ($FINAL_SIZE)"
