---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-28-llm-classification-source

English | [中文](2026-09-28-llm-classification-source.zh.md)

## Summary

Adds the optional `LlmFailure.classificationSource` field to persisted assistant-attempt, retry, and terminal-error evidence.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-28-llm-classification-source
baseline: false
changes:
  - root: "event:assistant/attempt"
    previous: "2026-09-16-session-format-v4"
    after: "9c637457babd010d106ce90debb66b5ceca439576e3f261adb4e30029a9e1a71"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "5139a09cf45df8ab3fa971d696ddd8c0cdb66a6fb3d186ca2a85fdca34539625"
    decision: same-version
  - root: "event:llm/retry"
    previous: "2026-09-14-image-offload"
    after: "9750d6ddd7a90b990865f14016cc7044dc97e7e46bc371b8e51e8a518aa5779a"
    decision: same-version
  - root: "event:turn/end"
    previous: "2026-09-16-session-format-v4"
    after: "decbe9f1c9da537ae4155c1d3205824eaf3cbb26f6b3334b1be01daec3711534"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The new property is optional, so existing Session events remain readable and older readers can ignore it without changing replay or retry behavior. New readers continue to accept records that omit it; the Session writer version remains unchanged.

<a id="verification"></a>
## Verification

Focused LLM adapter, pi-ai classification, retry, and service tests passed 209/209; the full pi-ai suite passed 336/336; the session-format corpus passed 437/437; pnpm run test:docs passed 20/20. The keyless `DSH_SNAPSHOT=replay` headless snapshot passed 1/1 in built-library mode with a 60-second child bound and a 90-second test deadline for cleanup.

<a id="dev-note"></a>
## Dev Note

None.
