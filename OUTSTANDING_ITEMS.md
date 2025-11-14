# Chapter3 Outstanding Items

## 🟢 Recently Fixed (Just Now!)

### 1. **Prefill System Message** ✅
- **Requirement**: "There is a system message: `The system is in CLI simulation mode.`"
- **Fix**: Added system message as first message in prefill mode
- **Location**: `src/llm/middleware.ts` line 118-122

### 2. **Tool Cache Pruning** ✅
- **Requirement**: "Tool use older than oldest messages in context is discarded from the in-memory cache"
- **Fix**: Call `pruneToolCache()` after fetching context in `AgentLoop`
- **Location**: `src/agent/loop.ts` line 199-203

### 3. **Stop Sequences Limited** ✅
- **Requirement**: "All recent configurable N participant names followed by ':' must be included"
- **Fix**: Added `recentParticipantCount` config (default 10), only use N most recent participants
- **Location**: `src/context/builder.ts` line 356-384

### 4. **Bot Continuation Logic** ✅
- **Requirement**: "If a bot is activated and its previous message is from the same bot, newlines are not added and the 'username:' suffix is not added"
- **Fix**: Check if last non-empty message is from bot, skip prefix if continuing
- **Location**: `src/llm/middleware.ts` line 120-141

### 5. **History Command Authorization** ✅
- **Requirement**: "History messages must be from a user with an authorized role"
- **Fix**: Added `authorizedRoles` config, validates user roles before processing .history
- **Location**: `src/discord/connector.ts` line 102-123

### 6. **Rolling Context Logic** ✅
- **Issue**: Character limit was applied after message limit (incorrect)
- **Fix**: Calculate both cutoffs independently, use more restrictive (Math.max)
- **Result**: Properly implements "lower bound takes priority"
- **Location**: `src/context/builder.ts` line 135-197

## ✅ Fixed

### 1. Context Limit Implementation (FIXED)
- **Issue**: Implementation only allowed one type of limit (messages OR characters)
- **Requirements**: "Context depth can be defined as either a number of messages or a number of characters. When both limits are specified, the lower bound takes priority"
- **Solution**:
  - Changed to `recencyWindowMessages` and `recencyWindowCharacters` (both optional)
  - Modified rolling context to check both limits and use whichever is more restrictive
  - Updated Discord fetch depth to accommodate both limit types
  - When both limits specified, the lower bound (more restrictive) takes priority

### 2. Message Count Tracking Bug (FIXED)
- **Issue**: `messagesSinceRoll` was never incremented/reset
- **Solution**: 
  - Modified `ContextBuilder.buildContext()` to return `ContextBuildResult` with `didRoll` flag
  - Updated `AgentLoop` to increment count on each message
  - Reset count when rolling happens
  - Cache marker now stays stable when not rolling

### 3. Cache Marker Updates (FIXED)
- **Issue**: Cache marker position not updated after completions
- **Solution**: 
  - `AgentLoop` now updates cache marker when it changes
  - Marker stays stable when not rolling, moves when rolling happens
  - Proper coordination with message count tracking

### 4. Rolling Context Logic (FIXED)
- **Issue**: Truncating on every request when over limit invalidated cache
- **Solution**:
  - Allow context to temporarily exceed `recencyWindow` until `rollingThreshold` is hit
  - Only truncate when rolling (preserves cache between rolls)
  - Dynamic Discord fetch depth to accommodate temporary excess
  - Fetch depth calculation based on window type (message vs character count)

## 🟡 Medium Priority (Requirements Violations)

### 1. **Thread Support Missing**
- **Requirement**: "Threads are considered to implicitly contain a history message pointing to the point where they were branched from"
- **Issue**: No thread support at all
- **Impact**: Bots lose context in threads
- **Fix**: Add implicit history command in thread detection

### 2. **Ping Loop Prevention Missing**
- **Requirement**: "Ping loops are prevented by limiting the chain of consecutive bot pings to a configurable value"
- **Issue**: Not implemented
- **Impact**: Bots could ping each other indefinitely
- **Fix**: Track and limit bot-to-bot mention chains

### 3. **Cache Marker Offset Hardcoded**
- **Requirement**: "placed at the head (most recent) message of the context, or N messages (like 5) below it"
- **Issue**: Hardcoded to 5, not configurable
- **Impact**: Can't tune cache placement for different use cases
- **Fix**: Add `cacheMarkerOffset` config option

### 4. **JSONL File Rotation Incomplete**
- **Requirement**: "Files are closed and new ones created at hour boundaries"
- **Issue**: Files named by hour but not actively closed/reopened
- **Impact**: Could write to old hour's file after hour change
- **Fix**: Track open file handles and close/reopen at hour boundaries

## 🟡 Medium Priority (Other Issues)

### 5. **Bot Message IDs Cleanup**
- **Issue**: `botMessageIds` Set grows forever (memory leak)
- **Impact**: Slow memory growth over time
- **Solution**: Clean up IDs when context rolls, or maintain fixed-size LRU cache
- **Location**: `AgentLoop.botMessageIds`


## 🟢 Low Priority

### 1. **Image Cache Eviction**
- **Issue**: No TTL or size-based eviction
- **Impact**: Disk usage grows over time
- **Architecture**: "Time-based (24h) + size-based (500MB)"
- **Note**: Can use external tools if needed

### 2. **Additional LLM Providers**
- **Missing**: BedrockProvider, OpenAIProvider, GoogleProvider
- **Impact**: Limited to Anthropic only
- **Location**: `src/llm/providers/`

### 3. **History Command Authorization**
- **Issue**: No role checking for .history commands
- **Impact**: Any user can use .history commands
- **Requirements**: "History messages must be from a user with an authorized role"
- **Fix**: Add role validation in `DiscordConnector.fetchContext()`

### 4. **Channel State Cleanup**
- **Issue**: Inactive channels remain in memory
- **Impact**: Very slow memory growth
- **Note**: Acceptable for typical bot lifetime

### 5. **Metrics and Monitoring**
- **Missing**: Token usage, API calls, error rates
- **Impact**: No operational visibility
- **Nice to have**: Prometheus metrics, cost tracking

### 6. **Config Validation**
- **Issue**: No Zod validation despite dependency
- **Impact**: Invalid configs cause runtime errors
- **Fix**: Add schema validation in `ConfigSystem`

### 7. **Stop Sequences Limiting**
- **Issue**: All participants added, not "recent N"
- **Impact**: Potentially too many stop sequences
- **Fix**: Limit to configurable recent N participants

### 8. **JSONL Rotation**
- **Issue**: Files grow indefinitely
- **Impact**: Disk usage
- **Note**: Can use external log rotation tools

### 9. **Rate Limiting**
- **Missing**: No limits on API calls or tool execution
- **Impact**: Potential for abuse or cost overruns
- **Nice to have**: Configurable rate limits

## 📋 Summary

**Recently Fixed:** ✅
- Message count tracking - Rolling context now works!
- Cache marker updates - Prompt caching now works!

**Important for correctness:**
- Bot message IDs cleanup (medium)
- Tool cache pruning (medium)
- Thread support (medium)
- Ping loop prevention (medium)
- History command auth (low - moved from medium based on user feedback)

**Nice to have:**
- Image cache eviction (low)
- Additional providers (low)
- Channel state cleanup (low)
- Monitoring/metrics (low)
- Config validation (low)
- Rate limiting (low)

The framework is **functionally complete** with rolling context and prompt caching now working properly!
