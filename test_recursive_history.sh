#!/bin/bash

# Test script for recursive history traversal
# Uses the controlled test case with a1-a10 and b1-b10 messages

echo "Testing recursive history traversal..."
echo "======================================="
echo ""
echo "Test Setup:"
echo "  Channel A: a1 -> a10 (1314075947724705843)"
echo "  Channel B: b1 -> b10 (1314075974693945356)"
echo "  .history between b5 and b6 -> a6"
echo ""
echo "API Request:"
echo "  last: b8 (https://discord.com/channels/1289595876716707911/1314075974693945356/1442580562345984121)"
echo "  first: a3 (https://discord.com/channels/1289595876716707911/1314075947724705843/1442580356179169392)"
echo ""
echo "Expected result: [a3, a4, a5, a6, b6, b7, b8] (7 messages)"
echo ""
echo "======================================="
echo ""

# Make the API call
curl -X POST http://localhost:3000/api/messages/export \
  -H "Content-Type: application/json" \
  -d '{
    "last": "https://discord.com/channels/1289595876716707911/1314075974693945356/1442580562345984121",
    "first": "https://discord.com/channels/1289595876716707911/1314075947724705843/1442580356179169392",
    "recencyWindow": {
      "messages": 200
    }
  }' | jq '.messages | map(.content)' 2>/dev/null

echo ""
echo "Check the output above. It should show:"
echo '["a3", "a4", "a5", "a6", "b6", "b7", "b8"]'
echo ""
echo "If you see more messages (like 95+), the issue is confirmed."
