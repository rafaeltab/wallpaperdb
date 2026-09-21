# NATS JetStream Setup

This directory contains scripts for setting up NATS JetStream streams for WallpaperDB.

## Quick Start

After starting the infrastructure, run the setup script:

```bash
make nats-setup-streams
```

This creates missing streams and updates existing streams' age limits in place, preserving their messages and other settings.

## Available Scripts

### `setup-streams.sh`
Main setup script that creates required NATS JetStream streams and applies their retention age limits.

- **Idempotent**: Safe to run multiple times; existing streams are updated without replacement
- **Environment variable**: Set `NATS_SERVER` to override default (`nats://localhost:4222`)

**Usage:**
```bash
# Using Make (recommended)
make nats-setup-streams

# Direct execution
./infra/nats/init/setup-streams.sh

# Custom server
NATS_SERVER=nats://other-host:4222 ./infra/nats/init/setup-streams.sh
```

## Stream Definitions

### WALLPAPER Stream
- **Subjects**: `wallpaper.>` (e.g., `wallpaper.uploaded`, `wallpaper.variant.available`)
- **Storage**: File-based persistence
- **Retention**: Limits-based (no automatic deletion)
- **Max Age**: Unlimited pending the cross-application retention review in issue #162
- **Max Messages**: Unlimited
- **Max Bytes**: Unlimited

Used by:
- **Ingestor Service**: Publishes `wallpaper.uploaded` events
- **Media Service**: Consumes `wallpaper.uploaded` events
- **User Service**: Replays publication events into the Biography wallpaper ownership projection

### PROFILE Stream
- **Subjects**: `profile.>` (e.g., `profile.created`)
- **Storage**: File-based persistence
- **Retention**: Limits-based
- **Max Age**: Unlimited pending the cross-application retention review in issue #162

Used by the User Service transactional outbox and downstream Profile projections.

Run setup when upgrading an existing installation to remove the former one-year WALLPAPER age limit. [NATS defines a zero maximum age as unlimited](https://nats-io.github.io/nats.js/jetstream/types/StreamUpdateConfig.html); the setup script applies this through the CLI without deleting or recreating streams. Events already expired before the upgrade cannot be recovered by replay.

## Management Commands

View all streams:
```bash
make nats-stream-list
```

View WALLPAPER stream details:
```bash
make nats-stream-info
```

## Adding New Streams

To add a new stream, edit `setup-streams.sh` and add:

```bash
ensure_stream "STREAM_NAME" "subject.pattern.>"
```

Example:
```bash
ensure_stream "ANALYTICS" "analytics.>"
```

## Testing vs Production

**Tests**: Streams are created automatically by the `NatsTesterBuilder`:
```typescript
tester.withStream('WALLPAPER')
```

**Production/Local Dev**: Use the setup script:
```bash
make nats-setup-streams
```

## Troubleshooting

### Stream already exists
This is normal: the script updates the configured age limit in place and preserves retained messages.

### Connection refused
Ensure NATS is running:
```bash
docker ps | grep nats
```

Start infrastructure if needed:
```bash
make infra-start
```

### NATS CLI not found
Install the NATS CLI:
```bash
# macOS
brew install nats-io/nats-tools/nats

# Linux
curl -L https://github.com/nats-io/natscli/releases/latest/download/nats-linux-amd64 -o nats
chmod +x nats
sudo mv nats /usr/local/bin/
```

## Stream Configuration Details

All streams use the following default configuration:
- **Storage**: File (persistent across restarts)
- **Retention**: Limits-based
- **Max Messages**: Unlimited (-1)
- **Max Bytes**: Unlimited (-1)
- **Max Age**: Unlimited (0)
- **Max Message Size**: 64 KiB (65536 bytes), including headers
- **Discard Policy**: Old (discard oldest when limits reached)
- **Acknowledgments**: Enabled
- **Duplicate Window**: 2 minutes

These defaults can be customized per-stream in `setup-streams.sh`.

Existing streams are reconciled by gateway startup, which preserves stricter message limits and audits retained history before certifying that it fits the quarantine budget. See the [gateway projection delivery documentation](../../../apps/docs/content/docs/services/gateway.mdx#projection-delivery) before changing these limits or resolving oversized historical messages.
