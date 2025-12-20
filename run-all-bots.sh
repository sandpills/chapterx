#!/bin/bash
# Run all bots simultaneously (strangeopus45 + claude0-4)

cd "$(dirname "$0")"

echo "Starting all bots..."

# strangeopus45 (original bot)
DISCORD_TOKEN_FILE=./discord_token CACHE_PATH=./cache_opus npm run dev &
echo "Started strangeopus45 (PID: $!)"

# claude0
DISCORD_TOKEN_FILE=./discord_token_0 CACHE_PATH=./cache0 npm run dev &
echo "Started claude0 (PID: $!)"

# claude1
DISCORD_TOKEN_FILE=./discord_token_1 CACHE_PATH=./cache1 npm run dev &
echo "Started claude1 (PID: $!)"

# claude2
DISCORD_TOKEN_FILE=./discord_token_2 CACHE_PATH=./cache2 npm run dev &
echo "Started claude2 (PID: $!)"

# claude3
DISCORD_TOKEN_FILE=./discord_token_3 CACHE_PATH=./cache3 npm run dev &
echo "Started claude3 (PID: $!)"

# claude4
DISCORD_TOKEN_FILE=./discord_token_4 CACHE_PATH=./cache4 npm run dev &
echo "Started claude4 (PID: $!)"

echo ""
echo "All 6 bots started. Press Ctrl+C to stop all."

wait
