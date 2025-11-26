#!/bin/bash
# Setup all required NATS JetStream streams for WallpaperDB
# Run this after starting the NATS infrastructure

set -e

NATS_SERVER="${NATS_SERVER:-nats://localhost:4222}"

echo "================================================"
echo "Setting up NATS JetStream streams"
echo "Server: $NATS_SERVER"
echo "================================================"
echo ""

# Function to create a stream if it doesn't exist
create_stream_if_not_exists() {
  local stream_name=$1
  local subjects=$2

  echo "Checking stream: $stream_name"

  if nats stream info "$stream_name" --server "$NATS_SERVER" &>/dev/null; then
    echo "  ✓ Stream $stream_name already exists"
  else
    echo "  → Creating stream $stream_name with subjects: $subjects"
    nats stream add "$stream_name" \
      --subjects "$subjects" \
      --storage file \
      --retention limits \
      --max-msgs=-1 \
      --max-bytes=-1 \
      --max-age=1y \
      --max-msg-size=-1 \
      --discard old \
      --server "$NATS_SERVER" \
      --defaults
    echo "  ✓ Stream $stream_name created successfully"
  fi
  echo ""
}

# Create WALLPAPER stream
# Handles: wallpaper.uploaded, wallpaper.processed, wallpaper.deleted, etc.
create_stream_if_not_exists "WALLPAPER" "wallpaper.>"

# Add more streams here as needed
# Example:
# create_stream_if_not_exists "ANALYTICS" "analytics.>"
# create_stream_if_not_exists "NOTIFICATIONS" "notifications.>"

echo "================================================"
echo "✅ All streams setup complete!"
echo "================================================"
echo ""
echo "View all streams:"
echo "  nats stream list --server $NATS_SERVER"
echo ""
echo "Monitor a stream:"
echo "  nats stream info WALLPAPER --server $NATS_SERVER"
echo ""
