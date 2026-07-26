ALTER TABLE "agent_definitions" ADD CONSTRAINT "agent_definitions_requested_permission_check" CHECK ("agent_definitions"."requested_permission_mode" in ('read_only','approval_gated'));--> statement-breakpoint
ALTER TABLE "agent_readiness_snapshots" ADD CONSTRAINT "agent_readiness_evidence_states_check" CHECK ("agent_readiness_snapshots"."gateway_state" in ('reported','unavailable','unknown')
        and "agent_readiness_snapshots"."authentication_state" in ('reported','unavailable','unknown')
        and "agent_readiness_snapshots"."observer_state" in ('reported','unavailable','unknown')
        and "agent_readiness_snapshots"."lifecycle_evidence_state" in ('reported','unavailable','unknown')
        and "agent_readiness_snapshots"."capability_state" in ('reported','unavailable','unknown')
        and "agent_readiness_snapshots"."tool_state" in ('reported','unavailable','unknown')
        and "agent_readiness_snapshots"."permission_state" in ('reported','unavailable','unknown'));--> statement-breakpoint
ALTER TABLE "agent_readiness_snapshots" ADD CONSTRAINT "agent_readiness_lifecycle_state_check" CHECK ("agent_readiness_snapshots"."lifecycle_state" in ('idle','running','stopped','failed','unknown'));--> statement-breakpoint
ALTER TABLE "agent_readiness_snapshots" ADD CONSTRAINT "agent_readiness_permission_modes_check" CHECK ("agent_readiness_snapshots"."requested_permission_mode" in ('read_only','approval_gated','unknown')
        and "agent_readiness_snapshots"."effective_permission_mode" in ('read_only','approval_gated','unknown'));