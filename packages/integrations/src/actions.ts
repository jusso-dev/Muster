import { z } from "zod";

const ActionBaseSchema = z.object({
  integrationId: z.uuid(),
  idempotencyKey: z.string().min(8).max(200),
  roomId: z.uuid().optional(),
  taskId: z.uuid().optional(),
});

export const IntegrationActionRequestSchema = z.discriminatedUnion(
  "operation",
  [
    ActionBaseSchema.extend({
      operation: z.literal("tawny.isolate_host"),
      agentId: z.uuid(),
      reason: z.string().trim().min(1).max(1_000),
    }),
    ActionBaseSchema.extend({
      operation: z.literal("kelpie.case.create"),
      title: z.string().trim().min(1).max(300),
      summary: z.string().trim().max(20_000).default(""),
      severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      tlp: z
        .enum(["clear", "green", "amber", "amber_strict", "red"])
        .default("amber"),
      pap: z.enum(["clear", "green", "amber", "red"]).default("amber"),
      classification: z
        .enum([
          "malware",
          "phishing",
          "unauthorised_access",
          "data_breach",
          "dos",
          "policy_violation",
          "other",
        ])
        .default("other"),
      tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
      evidenceReferences: z
        .array(z.string().trim().min(1).max(500))
        .max(100)
        .default([]),
      investigationId: z.uuid().optional(),
    }),
    ActionBaseSchema.extend({
      operation: z.literal("kelpie.case.update"),
      caseId: z.string().trim().min(1).max(200),
      version: z.number().int().positive().optional(),
      status: z
        .enum([
          "open",
          "in_progress",
          "contained",
          "eradicated",
          "recovered",
          "closed",
        ])
        .optional(),
      summary: z.string().trim().max(20_000).optional(),
    }).refine((value) => value.status || value.summary !== undefined, {
      message: "A Kelpie case update must change status or summary",
    }),
    ActionBaseSchema.extend({
      operation: z.literal("kelpie.timeline.comment"),
      caseId: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(20_000),
      evidenceReferences: z
        .array(z.string().trim().min(1).max(500))
        .max(100)
        .default([]),
    }),
    ActionBaseSchema.extend({
      operation: z.literal("kelpie.observable.add"),
      caseId: z.string().trim().min(1).max(200),
      observableType: z.enum([
        "ip",
        "domain",
        "url",
        "file_hash",
        "email",
        "hostname",
        "username",
        "registry_key",
        "other",
      ]),
      value: z.string().trim().min(1).max(4_000),
      tlp: z
        .enum(["clear", "green", "amber", "amber_strict", "red"])
        .default("amber"),
      description: z.string().trim().max(2_000).optional(),
      isIoc: z.boolean().default(true),
      tags: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    }),
  ],
);

export type IntegrationActionRequest = z.infer<
  typeof IntegrationActionRequestSchema
>;
