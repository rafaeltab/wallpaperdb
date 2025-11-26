# NATS JetStream Setup

This directory contains scripts for setting up NATS JetStream streams for WallpaperDB.

## Quick Start

After starting the infrastructure, run the setup script:

```bash
make nats-setup-streams
```

This will create all required streams for the application.

## Available Scripts

### `setup-streams.sh`
Main setup script that creates all required NATS JetStream streams.

- **Idempotent**: Safe to run multiple times (checks if stream exists first)
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

### `create-wallpaper-stream.sh`
Creates only the WALLPAPER stream.

**Usage:**
```bash
./infra/nats/init/create-wallpaper-stream.sh
```

## Stream Definitions

### WALLPAPER Stream
- **Subjects**: `wallpaper.*` (e.g., `wallpaper.uploaded`, `wallpaper.processed`)
- **Storage**: File-based persistence
- **Retention**: Limits-based (no automatic deletion)
- **Max Age**: 1 year
- **Max Messages**: Unlimited
- **Max Bytes**: Unlimited

Used by:
- **Ingestor Service**: Publishes `wallpaper.uploaded` events
- **Media Service**: Consumes `wallpaper.uploaded` events

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
create_stream_if_not_exists "STREAM_NAME" "subject.pattern.>"
```

Example:
```bash
create_stream_if_not_exists "ANALYTICS" "analytics.>"
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
This is normal - the script is idempotent and will skip existing streams.

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
- **Max Age**: 1 year
- **Max Message Size**: Unlimited (-1)
- **Discard Policy**: Old (discard oldest when limits reached)
- **Acknowledgments**: Enabled
- **Duplicate Window**: 2 minutes

These defaults can be customized per-stream in `setup-streams.sh`.
