#!/bin/bash
# Simple example stream creation for NATS JetStream

nats stream add EXAMPLE_STREAM \
  --subjects "example.>" \
  --storage file \
  --retention limits \
  --max-msgs=-1 \
  --max-bytes=-1 \
  --max-age=1y \
  --max-msg-size=-1 \
  --discard old \
  --server nats://localhost:4222
