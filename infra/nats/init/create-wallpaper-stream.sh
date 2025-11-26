#!/bin/bash
# Create WALLPAPER stream for wallpaper-related events
# This stream handles events like wallpaper.uploaded, wallpaper.processed, etc.

set -e

echo "Creating WALLPAPER stream..."

nats stream add WALLPAPER \
  --subjects "wallpaper.>" \
  --storage file \
  --retention limits \
  --max-msgs=-1 \
  --max-bytes=-1 \
  --max-age=1y \
  --max-msg-size=-1 \
  --discard old \
  --server nats://localhost:4222

echo "✅ WALLPAPER stream created successfully"
echo ""
echo "Stream details:"
nats stream info WALLPAPER --server nats://localhost:4222
