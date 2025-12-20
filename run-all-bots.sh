#!/bin/bash
# Run all bots simultaneously (strangeopus45 + all available numbered bots)

cd "$(dirname "$0")"

echo "Starting all bots..."

BOT_COUNT=0

# strangeopus45 (original bot)
if [ -f "./discord_token" ]; then
    DISCORD_TOKEN_FILE=./discord_token CACHE_PATH=./cache_opus npm run dev &
    echo "Started strangeopus45 (PID: $!)"
    ((BOT_COUNT++))
fi

# Loop through all available numbered token files (discord_token_0, discord_token_1, etc.)
i=0
while [ -f "./discord_token_$i" ]; do
    DISCORD_TOKEN_FILE="./discord_token_$i" CACHE_PATH="./cache$i" npm run dev &
    echo "Started claude$i (PID: $!)"
    ((BOT_COUNT++))
    ((i++))
done

echo ""
echo "All $BOT_COUNT bots started. Press Ctrl+C to stop all."

wait
