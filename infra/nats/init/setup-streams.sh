#!/bin/sh
# Setup all required NATS JetStream streams for WallpaperDB
# Run this after starting the NATS infrastructure

set -e

NATS_SERVER="${NATS_SERVER:-nats://localhost:4222}"

echo "================================================"
echo "Setting up NATS JetStream streams"
echo "Server: $NATS_SERVER"
echo "================================================"
echo ""

# Preserve retained events while applying the configured age limit on every setup.
ensure_stream() {
  local stream_name=$1
  local subjects=$2
  local max_age=${3:-0}

  echo "Checking stream: $stream_name"

  if nats stream info "$stream_name" --server "$NATS_SERVER" >/dev/null 2>&1; then
    nats stream edit "$stream_name" \
      --max-age="$max_age" \
      --server "$NATS_SERVER" \
      --force
    echo "  ✓ Stream $stream_name retention updated; gateway startup reconciles its message budget and retained history"
  else
    echo "  → Creating stream $stream_name with subjects: $subjects"
    nats stream add "$stream_name" \
      --subjects "$subjects" \
      --storage file \
      --retention limits \
      --max-msgs=-1 \
      --max-bytes=-1 \
      --max-age="$max_age" \
      --max-msg-size=65536 \
      --discard old \
      --server "$NATS_SERVER" \
      --defaults
    echo "  ✓ Stream $stream_name created successfully"
  fi
  echo ""
}

# Create WALLPAPER stream. Keep publication history for ownership projection rebuilds.
# Handles: wallpaper.uploaded, wallpaper.processed, wallpaper.deleted, etc.
ensure_stream "WALLPAPER" "wallpaper.>" "0"

# Profile state changes are retained independently for read-model rebuilds.
ensure_stream "PROFILE" "profile.>" "0"

# Add more streams here as needed
# Example:
# ensure_stream "ANALYTICS" "analytics.>"
# ensure_stream "NOTIFICATIONS" "notifications.>"

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
