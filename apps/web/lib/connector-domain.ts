import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import {
  ConnectorConfigurationSchema,
  ExecuteConnectorQuerySchema,
  QueryTemplateSchema,
  connectorPresets,
  encryptConnectorAuth,
  encryptConnectorPayload,
} from "@muster/integrations";
import { z } from "zod";
import { ApiProblem } from "./api-context.ts";

const ConfigureRequestSchema = ConnectorConfigurationSchema.extend({
  templates: z.array(QueryTemplateSchema).max(100).default([]),
});
const RotateRequestSchema = ConnectorConfigurationSchema.shape.auth;

function encryptionKey() {
  const key = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!key)
    throw new ApiProblem(
      503,
      "Connector unavailable",
      "Connector encryption is not configured.",
    );
  return key;
}

export class ConnectorDomainService {
  constructor(private readonly db = database()) {}

  async list(subject: AuthorisationSubject) {
    requireCapability(subject, "administration.manage");
    const records = await this.db
      .select()
      .from(schema.integrationRecords)
      .where(
        eq(schema.integrationRecords.organisationId, subject.organisationId),
      )
      .orderBy(desc(schema.integrationRecords.updatedAt));
    return records.map((record) => ({
      id: record.id,
      product: record.product,
      instanceId: record.instanceId,
      displayName: record.displayName,
      status: record.status,
      health: record.health,
      lastSyncAt: record.lastSyncAt,
      configuration: record.configuration,
    }));
  }

  async configure(
    subject: AuthorisationSubject,
    raw: unknown,
    traceId: string,
  ) {
    requireCapability(subject, "administration.manage");
    const request = ConfigureRequestSchema.parse(raw);
    const { auth, templates, ...publicConfiguration } = request;
    const encryptedCredential = encryptConnectorAuth(auth, encryptionKey());
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: schema.integrationRecords.id })
        .from(schema.integrationRecords)
        .where(
          and(
            eq(
              schema.integrationRecords.organisationId,
              subject.organisationId,
            ),
            eq(schema.integrationRecords.product, request.product),
            eq(schema.integrationRecords.instanceId, request.instanceId),
          ),
        )
        .limit(1);
      const integrationId = existing?.id ?? newId();
      if (existing) {
        await tx
          .update(schema.integrationRecords)
          .set({
            displayName: request.displayName,
            status: "configured",
            mock: request.testMode,
            configuration: { ...publicConfiguration, authType: auth.type },
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.integrationRecords.id, integrationId),
              eq(
                schema.integrationRecords.organisationId,
                subject.organisationId,
              ),
            ),
          );
      } else {
        await tx.insert(schema.integrationRecords).values({
          id: integrationId,
          organisationId: subject.organisationId,
          product: request.product,
          instanceId: request.instanceId,
          displayName: request.displayName,
          status: "configured",
          mock: request.testMode,
          configuration: { ...publicConfiguration, authType: auth.type },
        });
      }
      await tx
        .insert(schema.integrationConnectorCredentials)
        .values({
          organisationId: subject.organisationId,
          integrationId,
          encryptedCredential,
          rotatedByActorId: subject.actorId,
        })
        .onConflictDoUpdate({
          target: schema.integrationConnectorCredentials.integrationId,
          set: {
            encryptedCredential,
            rotationVersion: sql`${schema.integrationConnectorCredentials.rotationVersion} + 1`,
            rotatedByActorId: subject.actorId,
            rotatedAt: new Date(),
          },
        });
      const definitions = [
        ...(connectorPresets[request.product] ?? []),
        ...templates,
      ];
      for (const definition of definitions) {
        const templateId = newId();
        await tx
          .insert(schema.integrationQueryTemplates)
          .values({
            id: templateId,
            organisationId: subject.organisationId,
            integrationId,
            templateKey: definition.key,
            version: definition.version,
            definition,
            createdByActorId: subject.actorId,
          })
          .onConflictDoNothing();
      }
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: existing ? "connector.updated" : "connector.configured",
        targetType: "integration",
        targetId: integrationId,
        metadata: {
          product: request.product,
          instanceId: request.instanceId,
          authType: auth.type,
          templateCount: definitions.length,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "connector.configured",
        aggregateType: "integration",
        aggregateId: integrationId,
        queueName: "muster-integrations",
        payload: { integrationId },
        idempotencyKey: `connector.configured:${integrationId}:${Date.now()}`,
        traceId,
      });
      return { id: integrationId, status: "configured" as const };
    });
  }

  async rotate(
    subject: AuthorisationSubject,
    integrationId: string,
    raw: unknown,
    traceId: string,
  ) {
    requireCapability(subject, "administration.manage");
    const auth = RotateRequestSchema.parse(raw);
    const encryptedCredential = encryptConnectorAuth(auth, encryptionKey());
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.integrationConnectorCredentials)
        .set({
          encryptedCredential,
          rotationVersion: sql`${schema.integrationConnectorCredentials.rotationVersion} + 1`,
          rotatedByActorId: subject.actorId,
          rotatedAt: new Date(),
        })
        .where(
          and(
            eq(
              schema.integrationConnectorCredentials.organisationId,
              subject.organisationId,
            ),
            eq(
              schema.integrationConnectorCredentials.integrationId,
              integrationId,
            ),
          ),
        )
        .returning({
          version: schema.integrationConnectorCredentials.rotationVersion,
        });
      if (!updated)
        throw new ApiProblem(
          404,
          "Connector not found",
          "Connector does not exist.",
        );
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "connector.credential.rotated",
        targetType: "integration",
        targetId: integrationId,
        metadata: { authType: auth.type },
        traceId,
      });
      return { id: integrationId, rotationVersion: updated.version };
    });
  }

  async queueQuery(
    subject: AuthorisationSubject,
    integrationId: string,
    raw: unknown,
    traceId: string,
  ) {
    const request = ExecuteConnectorQuerySchema.parse(raw);
    const [integration] = await this.db
      .select({
        configuration: schema.integrationRecords.configuration,
        status: schema.integrationRecords.status,
      })
      .from(schema.integrationRecords)
      .where(
        and(
          eq(schema.integrationRecords.organisationId, subject.organisationId),
          eq(schema.integrationRecords.id, integrationId),
        ),
      )
      .limit(1);
    if (!integration)
      throw new ApiProblem(
        404,
        "Connector not found",
        "Connector does not exist.",
      );
    if (!["configured", "healthy"].includes(integration.status))
      throw new ApiProblem(
        409,
        "Connector unavailable",
        "Connector is not enabled for queries.",
      );
    const limits = ConnectorConfigurationSchema.shape.limits.parse(
      (integration.configuration as Record<string, unknown>).limits,
    );
    const [recent] = await this.db
      .select({ value: count() })
      .from(schema.integrationQueryRuns)
      .where(
        and(
          eq(
            schema.integrationQueryRuns.organisationId,
            subject.organisationId,
          ),
          eq(schema.integrationQueryRuns.integrationId, integrationId),
          gte(
            schema.integrationQueryRuns.createdAt,
            new Date(Date.now() - 60_000),
          ),
        ),
      );
    if ((recent?.value ?? 0) >= limits.requestsPerMinute)
      throw new ApiProblem(
        429,
        "Connector rate limited",
        "Connector request rate limit reached.",
      );
    const [template] = await this.db
      .select()
      .from(schema.integrationQueryTemplates)
      .where(
        and(
          eq(
            schema.integrationQueryTemplates.organisationId,
            subject.organisationId,
          ),
          eq(schema.integrationQueryTemplates.integrationId, integrationId),
          eq(schema.integrationQueryTemplates.templateKey, request.templateKey),
          eq(schema.integrationQueryTemplates.enabled, true),
        ),
      )
      .orderBy(desc(schema.integrationQueryTemplates.version))
      .limit(1);
    if (!template)
      throw new ApiProblem(
        404,
        "Template not found",
        "Enabled connector template does not exist.",
      );
    const definition = QueryTemplateSchema.parse(template.definition);
    requireCapability(subject, definition.requiredCapability);
    const [actor] = await this.db
      .select({
        actorType: schema.actors.actorType,
        capabilities: schema.actors.capabilityAssignments,
      })
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.organisationId, subject.organisationId),
          eq(schema.actors.id, subject.actorId),
          eq(schema.actors.status, "active"),
        ),
      )
      .limit(1);
    if (
      !actor ||
      !Array.isArray(actor.capabilities) ||
      !actor.capabilities.includes(definition.requiredCapability)
    )
      throw new ApiProblem(
        403,
        "Forbidden",
        "Authoritative connector capability is missing.",
      );
    return this.db.transaction(async (tx) => {
      const [duplicate] = await tx
        .select({
          id: schema.integrationQueryRuns.id,
          status: schema.integrationQueryRuns.status,
        })
        .from(schema.integrationQueryRuns)
        .where(
          and(
            eq(
              schema.integrationQueryRuns.organisationId,
              subject.organisationId,
            ),
            eq(
              schema.integrationQueryRuns.idempotencyKey,
              request.idempotencyKey,
            ),
          ),
        )
        .limit(1);
      if (duplicate) return { ...duplicate, duplicate: true };
      const id = newId();
      await tx.insert(schema.integrationQueryRuns).values({
        id,
        organisationId: subject.organisationId,
        integrationId,
        templateId: template.id,
        requestedByActorId: subject.actorId,
        idempotencyKey: request.idempotencyKey,
        traceId,
        input: {
          envelope: encryptConnectorPayload(request.input, encryptionKey()),
        },
        requestMetadata: {
          templateKey: definition.key,
          templateVersion: definition.version,
        },
      });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: actor.actorType,
        action: "connector.query.queued",
        targetType: "integration_query",
        targetId: id,
        metadata: {
          integrationId,
          templateKey: definition.key,
          templateVersion: definition.version,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "connector.query.queued",
        aggregateType: "integration_query",
        aggregateId: id,
        queueName: "muster-integrations",
        payload: { queryRunId: id },
        idempotencyKey: `connector.query:${id}`,
        traceId,
      });
      return { id, status: "queued" as const, duplicate: false };
    });
  }

  async run(subject: AuthorisationSubject, id: string) {
    const [run] = await this.db
      .select({
        id: schema.integrationQueryRuns.id,
        integrationId: schema.integrationQueryRuns.integrationId,
        status: schema.integrationQueryRuns.status,
        result: schema.integrationQueryRuns.result,
        requestMetadata: schema.integrationQueryRuns.requestMetadata,
        responseMetadata: schema.integrationQueryRuns.responseMetadata,
        errorCode: schema.integrationQueryRuns.errorCode,
        errorMessage: schema.integrationQueryRuns.errorMessage,
        startedAt: schema.integrationQueryRuns.startedAt,
        completedAt: schema.integrationQueryRuns.completedAt,
        createdAt: schema.integrationQueryRuns.createdAt,
      })
      .from(schema.integrationQueryRuns)
      .where(
        and(
          eq(
            schema.integrationQueryRuns.organisationId,
            subject.organisationId,
          ),
          eq(schema.integrationQueryRuns.id, id),
        ),
      )
      .limit(1);
    if (!run)
      throw new ApiProblem(
        404,
        "Query not found",
        "Connector query does not exist.",
      );
    return run;
  }
}
