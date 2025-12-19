#!/bin/bash
# Run all bots simultaneously

cd "$(dirname "$0")"

echo "Starting all bots..."

# Bot 1: Default token (discord_token)
DISCORD_TOKEN_FILE=./discord_token CACHE_PATH=./cache1 npm run dev &
PID1=$!
echo "Started bot 1 (PID: $PID1)"

# Bot 2: claude3sonnet (discord_token_2)
DISCORD_TOKEN_FILE=./discord_token_2 CACHE_PATH=./cache2 npm run dev &
PID2=$!
echo "Started bot 2 (PID: $PID2)"

echo ""
echo "All bots started. Press Ctrl+C to stop all."

# Wait for any to exit
wait
