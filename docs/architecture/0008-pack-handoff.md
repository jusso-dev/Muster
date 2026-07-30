# ADR 0008 — Pack handoff v1 (governed agent-to-agent delegation)

## Status

Accepted (2026-07-30)

## Context

Parker, Jessie, and Alfie each own part of an operational picture. Until now a
thread that needed a second agent had to go back through a human, or an agent
had to attempt work outside its own capability envelope. Both are bad: the
first loses time, the second erodes the capability boundary.

The obvious implementation — let any agent invoke any other agent — is a free
mesh. It produces unbounded delegation chains, makes attribution unclear, and
hands a compromised or prompt-injected agent a way to escalate through a peer.

## Decision

1. **Explicit route graph, not a mesh.** `PACK_HANDOFF_EDGES` in
   `@muster/agents` is an allow-list of `(from, to, reasons)` triples. Parker is
   the only bidirectional hub. `Jessie → Alfie` exists for research; the answer
   returns through Parker. Everything unlisted is refused, including
   self-handoff and any agent outside the pack.
2. **Own domain record.** `pack_handoffs` is organisation-scoped with composite
   foreign keys `(actor_id, organisation_id)`, so a cross-organisation handoff
   cannot be persisted even if an application check is bypassed. Status is
   constrained in the database, not only in code.
3. **Capability plus policy.** Requesting requires `agents.handoff` **and**
   `agents.invoke`. The policy graph is evaluated separately, so holding the
   capability never implies a route is open.
4. **Approval for high-risk.** A handoff naming a state-changing capability
   (`tawny.response.*`, `sentinel.rules.publish`, `bower.policy.publish`,
   `kelpie.cases.update`, `investigations.close`, `administration.manage`), or
   carrying the `response` reason, lands in `awaiting_approval` with an
   approval row under `pack.handoff.high-risk`. It never dispatches until a
   human decides.
5. **Refusals are persisted.** A denied route is written as a `blocked` row and
   surfaced as an attention item, rather than discarded into logs.
6. **The brief is evidence, not instructions.** On dispatch the worker attaches
   the handoff payload to the target run as `untrustedHandoffEvidence` with an
   explicit `trust: "untrusted_evidence"` marker. It is deliberately not merged
   into `humanRequest`, so a confused or compromised source agent cannot reach
   the target agent's trusted prompt surface.
7. **One implementation, three edges.** The domain lives in `@muster/agents` and
   is called identically by the web API (`/api/v1/pack-handoffs`), the remote
   MCP tool (`muster_request_agent_handoff`), and the Slack harness. There is no
   second, weaker path to a handoff.

## Consequences

- Adding a route is a deliberate code change with a test, not configuration.
- Audit records `pack_handoff.requested`, `.blocked`, `.accepted`, `.rejected`,
  `.dispatched` on the organisation's hash chain.
- The OS shows handoffs on task and mission detail and raises stalled ones on
  Command. It never starts one — that is an agent action.
- Slack posts a notice into the originating thread only; no thread is created.
- `agents.handoff` is granted to roles that already hold `agents.invoke`, and
  backfilled for existing installs by migration `0023`.

## Alternatives considered

- **Extend `governed_mission_runs`.** Rejected: missions model Hermes cron
  delivery, and overloading them would confuse two different lifecycles.
- **Reuse the existing `AgentHandoff` projection.** Rejected: that is an
  agent-to-human completion report derived from finished runs, not a request.
- **Auto-accept everything and rely on the target's own capability checks.**
  Rejected: it makes the delegation chain, not the capability set, the real
  authority boundary.
