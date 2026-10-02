---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-28-llm-classification-source

[English](2026-09-28-llm-classification-source.md) | 中文

## 概述

为持久化的 assistant-attempt、retry 与终态错误证据增加可选字段 `LlmFailure.classificationSource`。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

该字段为可选，因此已有 Session 事件仍可读取，旧读取器可忽略此字段而不改变回放或重试行为。新读取器仍接受未包含该字段的记录；Session 写入版本保持不变。

<a id="verification"></a>
## 验证

LLM 适配器、pi-ai 分类、重试与服务聚焦测试通过 209/209；pi-ai 全量测试通过 336/336；session-format-corpus 通过 437/437；pnpm run test:docs 通过 20/20。无密钥 DSH_SNAPSHOT=replay headless snapshot 在构建库模式下 1/1 通过；该场景采用 60 秒子进程上限与 90 秒测试期限，为超时处理和清理留出时间。

<a id="dev-note"></a>
## 开发备注

无。
