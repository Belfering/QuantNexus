#!/bin/sh
# Ensure data directories exist and have correct permissions
# This runs at container start, after volumes are mounted

# Create server data directory (for SQLite databases)
mkdir -p /app/server/data

# Create ticker data directories
# If RAILWAY_VOLUME_MOUNT_PATH is set, use it for parquet data (persistent)
# Otherwise use local path (ephemeral, for local development)
if [ -n "$RAILWAY_VOLUME_MOUNT_PATH" ]; then
    echo "[entrypoint] Railway volume detected at: $RAILWAY_VOLUME_MOUNT_PATH"

    # Create parquet directory on the persistent volume
    mkdir -p "$RAILWAY_VOLUME_MOUNT_PATH/ticker_data_parquet"

    # Export the path so the Node.js app uses it
    export PARQUET_DIR="$RAILWAY_VOLUME_MOUNT_PATH/ticker_data_parquet"
    echo "[entrypoint] PARQUET_DIR set to: $PARQUET_DIR"

    # Also create server/data on volume for persistence
    mkdir -p "$RAILWAY_VOLUME_MOUNT_PATH/server_data"

    # Symlink if the server/data is empty (first deploy)
    if [ ! -f "/app/server/data/atlas.db" ] && [ -f "$RAILWAY_VOLUME_MOUNT_PATH/server_data/atlas.db" ]; then
        echo "[entrypoint] Restoring server data from volume..."
        cp -r "$RAILWAY_VOLUME_MOUNT_PATH/server_data"/* /app/server/data/ 2>/dev/null || true
    fi
else
    echo "[entrypoint] No Railway volume, using local paths"
    mkdir -p /app/ticker-data/data/ticker_data_parquet
fi

# Start the server with boot wrapper for debug logging
exec node server/boot.mjs
