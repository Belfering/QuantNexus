#!/bin/sh
# Ensure data directories exist and have correct permissions
# This runs at container start, after volumes are mounted

mkdir -p /app/server/data
mkdir -p /app/ticker-data/data/ticker_data_parquet

# Start the server with boot wrapper for debug logging
exec node server/boot.mjs
