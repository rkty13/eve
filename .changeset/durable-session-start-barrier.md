---
"eve": patch
---

Add an awaited `beforeSessionStart` barrier for authorization-critical setup before the first turn or stream. Frontend session creation now uses create-once operation IDs so failed setup can resume without duplicating the first message.
