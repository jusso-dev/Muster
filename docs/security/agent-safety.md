# Agent safety and learning

Agent prompt segments are typed:

```text
system_policy
trusted_instruction
human_request
untrusted_evidence
tool_result
approval_record
```

External content never becomes a system instruction. Each tool call passes the agent definition allowlist, actor capability check, Zod argument schema, mutation policy, URL allowlist, record/range limit, and approval binding. Output must match a named schema before becoming a finding.

The gateway owns cancellation, token/cost/runtime ceilings, progress, audit, runtime adapters, and the global kill switch. General BullMQ workers never become shell runners.

## Governed continuous learning

Agents may write evidence-linked, classified memory notes within retention policy. They may propose a new skill version after repeated outcomes. A proposal contains evidence references, prompt version, evaluation suite, measured result, risk notes, and a content hash.

A proposal cannot publish itself. Publication requires:

1. deterministic validation and regression evaluation
2. no expansion of tools, capabilities, room access, data classification, runtime, token budget, or cost ceiling
3. human approval with `agents.manage`
4. immutable version creation and audit event
5. rollback pointer to the previous version

This preserves useful continuous improvement without silent policy mutation or self-authorised privilege growth.
