import { and, eq } from "drizzle-orm";
import {
  requireCapability,
  type AuthorisationSubject,
  type Capability,
} from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
} from "@muster/database";
import { z } from "zod";
import { ApiProblem } from "./api-context.ts";

const CAPABILITY_RE = /^[a-z0-9][a-z0-9._-]*$/i;

const OnboardAgentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z][A-Za-z0-9 _.-]*$/, "Use a clear agent display name"),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Slug: lowercase letters, numbers, dashes")
    .optional(),
  description: z.string().trim().min(1).max(2_000),
  runtime: z
    .enum(["codex-subscription", "codex", "http", "mock"])
    .default("codex-subscription"),
  model: z.string().trim().min(1).max(120).default("configured"),
  systemPromptVersion: z.string().trim().min(1).max(80).default("v1"),
  capabilityRequirements: z
    .array(z.string().trim().regex(CAPABILITY_RE).max(100))
    .max(40)
    .default(["agents.read", "alerts.read"]),
  allowedTools: z
    .array(z.string().trim().min(1).max(100))
    .max(40)
    .default([]),
  maximumRuntimeSeconds: z.number().int().min(30).max(7_200).default(900),
  maximumTokenBudget: z.number().int().min(1_000).max(200_000).default(30_000),
  maximumCostCents: z.number().int().min(0).max(50_000).default(500),
});

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Onboard a pack agent: creates matching actor + agent_definitions row
 * (same id pattern as Alfie/Jessie/Parker) under the calling organisation.
 */
export async function onboardAgent(
  subject: AuthorisationSubject,
  raw: unknown,
  traceId: string,
) {
  requireCapability(subject, "agents.manage");
  const input = OnboardAgentSchema.parse(raw);
  const slug = input.slug?.trim() || slugify(input.name);
  const identityReference = `agent:${slug}`;
  const db = database();

  const [nameConflict] = await db
    .select({ id: schema.agentDefinitions.id })
    .from(schema.agentDefinitions)
    .where(
      and(
        eq(schema.agentDefinitions.organisationId, subject.organisationId),
        eq(schema.agentDefinitions.name, input.name),
      ),
    )
    .limit(1);
  if (nameConflict)
    throw new ApiProblem(
      409,
      "Agent exists",
      "An agent with this name already exists.",
    );

  const [identityConflict] = await db
    .select({ id: schema.actors.id })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, subject.organisationId),
        eq(schema.actors.identityReference, identityReference),
      ),
    )
    .limit(1);
  if (identityConflict)
    throw new ApiProblem(
      409,
      "Agent exists",
      "An agent with this identity slug already exists.",
    );

  const id = newId();
  const caps = input.capabilityRequirements as Capability[];
  const tools =
    input.allowedTools.length > 0
      ? input.allowedTools
      : input.capabilityRequirements;

  await db.transaction(async (tx) => {
    await tx.insert(schema.actors).values({
      id,
      organisationId: subject.organisationId,
      actorType: "agent",
      displayName: input.name,
      status: "active",
      identityReference,
      capabilityAssignments: caps,
    });
    await tx.insert(schema.agentDefinitions).values({
      id,
      organisationId: subject.organisationId,
      name: input.name,
      description: input.description,
      runtime: input.runtime,
      model: input.model,
      ownerActorId: subject.actorId,
      status: "active",
      systemPromptVersion: input.systemPromptVersion,
      allowedTools: tools,
      allowedRooms: [],
      capabilityRequirements: caps,
      maximumRuntimeSeconds: input.maximumRuntimeSeconds,
      maximumTokenBudget: input.maximumTokenBudget,
      maximumCostCents: input.maximumCostCents,
      approvalRequirements: { externalWrites: "human" },
      killSwitch: false,
    });
    await appendAuditEvent(tx, {
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      actorType: "human",
      action: "agent.onboarded",
      targetType: "agent",
      targetId: id,
      metadata: {
        name: input.name,
        identityReference,
        runtime: input.runtime,
        via: "web",
      },
      traceId,
    });
  });

  return {
    id,
    name: input.name,
    identityReference,
    description: input.description,
    runtime: input.runtime,
    model: input.model,
    status: "active",
    nextSteps: [
      "Open the agent profile and confirm tools / capabilities.",
      "Expose the agent in Slack (Settings → Slack exposures) if chat access is required.",
      "Assign work from Operations or accept handoffs from other pack agents.",
      "Kill switch is available on the agent profile if you need to stop it.",
    ],
  };
}
