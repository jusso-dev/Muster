import { sql } from "drizzle-orm";
import {
  ConnectorConfigurationSchema,
  connectorPresets,
  decryptConnectorAuth,
  encryptConnectorAuth,
  publicConnectorConfiguration,
  type ConnectorAuth,
  type ConnectorConfiguration,
} from "@muster/integrations";
import {
  appendAuditEvent,
  newId,
  schema,
  writeOutbox,
  type database,
} from "./index.ts";
import { starterIds } from "./seed-data.ts";

type Db = ReturnType<typeof database>;

type EnvironmentConnector = {
  configuration: ConnectorConfiguration;
  auth: ConnectorAuth;
};

function optionalEnvironmentConnector(input: {
  product: "kelpie" | "tawny" | "unifi";
  instanceId: string;
  displayName: string;
  baseUrl: string | undefined;
  token: string | undefined;
  tlsCaCertificateBase64?: string | undefined;
  auth: (token: string) => ConnectorAuth;
}): EnvironmentConnector | null {
  const baseUrl = input.baseUrl?.trim();
  const token = input.token?.trim();
  if (!baseUrl || !token) return null;
  const parsedUrl = new URL(baseUrl);
  const auth = input.auth(token);
  return {
    auth,
    configuration: ConnectorConfigurationSchema.parse({
      product: input.product,
      instanceId: input.instanceId,
      displayName: input.displayName,
      baseUrl: parsedUrl.toString(),
      allowedHosts: [parsedUrl.hostname.toLowerCase()],
      allowPrivateNetwork: true,
      testMode: false,
      ...(input.tlsCaCertificateBase64?.trim()
        ? {
            tlsCaCertificateBase64: input.tlsCaCertificateBase64.trim(),
          }
        : {}),
      auth,
      limits: {
        timeoutMs: 10_000,
        maxResponseBytes: 1_000_000,
        maxRecords: 1_000,
        maxPages: 10,
        requestsPerMinute: 60,
      },
    }),
  };
}

function configuredConnectors() {
  return [
    optionalEnvironmentConnector({
      product: "kelpie",
      instanceId: "homelab-kelpie",
      displayName: "Kelpie homelab",
      baseUrl: process.env.KELPIE_BASE_URL,
      token: process.env.KELPIE_API_TOKEN,
      auth: (token) => ({ type: "bearer", token }),
    }),
    optionalEnvironmentConnector({
      product: "tawny",
      instanceId: "homelab-tawny",
      displayName: "Tawny homelab",
      baseUrl: process.env.TAWNY_BASE_URL,
      token: process.env.TAWNY_API_TOKEN,
      auth: (token) => ({ type: "bearer", token }),
    }),
    optionalEnvironmentConnector({
      product: "unifi",
      instanceId: "homelab-unifi",
      displayName: "UniFi homelab",
      baseUrl: process.env.UNIFI_BASE_URL,
      token: process.env.UNIFI_API_KEY,
      tlsCaCertificateBase64: process.env.UNIFI_TLS_CA_CERTIFICATE_BASE64,
      auth: (token) => ({
        type: "api_key",
        headerName: process.env.UNIFI_API_KEY_HEADER?.trim() || "X-API-Key",
        token,
      }),
    }),
  ].filter((connector): connector is EnvironmentConnector =>
    Boolean(connector),
  );
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function bootstrapEnvironmentConnectors(db: Db) {
  const encryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY?.trim();
  const connectors = configuredConnectors();
  if (!connectors.length) return;
  if (!encryptionKey)
    throw new Error(
      "CONNECTOR_ENCRYPTION_KEY is required for configured homelab connectors",
    );

  for (const { configuration, auth } of connectors) {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          record: schema.integrationRecords,
          credential: schema.integrationConnectorCredentials,
        })
        .from(schema.integrationRecords)
        .leftJoin(
          schema.integrationConnectorCredentials,
          sql`${schema.integrationConnectorCredentials.organisationId} = ${schema.integrationRecords.organisationId}
            and ${schema.integrationConnectorCredentials.integrationId} = ${schema.integrationRecords.id}`,
        )
        .where(
          sql`${schema.integrationRecords.organisationId} = ${starterIds.organisation}
            and ${schema.integrationRecords.product} = ${configuration.product}
            and ${schema.integrationRecords.instanceId} = ${configuration.instanceId}`,
        )
        .limit(1);
      const integrationId = existing?.record.id ?? newId();
      const publicConfiguration = {
        ...publicConnectorConfiguration(configuration),
        authType: auth.type,
      };
      let credentialMatches = false;
      if (existing?.credential) {
        try {
          credentialMatches = sameJson(
            decryptConnectorAuth(
              existing.credential.encryptedCredential,
              encryptionKey,
            ),
            auth,
          );
        } catch {
          credentialMatches = false;
        }
      }
      const configurationMatches =
        existing?.record.mock === false &&
        existing.record.archivedAt === null &&
        sameJson(existing.record.configuration, publicConfiguration);
      const changed = !configurationMatches || !credentialMatches;

      if (existing) {
        await tx
          .update(schema.integrationRecords)
          .set({
            displayName: configuration.displayName,
            status: changed ? "configured" : existing.record.status,
            mock: false,
            configuration: publicConfiguration,
            archivedAt: null,
            updatedAt: changed ? new Date() : existing.record.updatedAt,
          })
          .where(
            sql`${schema.integrationRecords.organisationId} = ${starterIds.organisation}
              and ${schema.integrationRecords.id} = ${integrationId}`,
          );
      } else {
        await tx.insert(schema.integrationRecords).values({
          id: integrationId,
          organisationId: starterIds.organisation,
          product: configuration.product,
          instanceId: configuration.instanceId,
          displayName: configuration.displayName,
          status: "configured",
          mock: false,
          configuration: publicConfiguration,
        });
      }

      if (!credentialMatches) {
        await tx
          .insert(schema.integrationConnectorCredentials)
          .values({
            organisationId: starterIds.organisation,
            integrationId,
            encryptedCredential: encryptConnectorAuth(auth, encryptionKey),
            rotatedByActorId: starterIds.actors.jordan,
          })
          .onConflictDoUpdate({
            target: schema.integrationConnectorCredentials.integrationId,
            set: {
              encryptedCredential: encryptConnectorAuth(auth, encryptionKey),
              rotationVersion: sql`${schema.integrationConnectorCredentials.rotationVersion} + 1`,
              rotatedByActorId: starterIds.actors.jordan,
              rotatedAt: new Date(),
            },
          });
      }

      for (const definition of connectorPresets[configuration.product] ?? []) {
        await tx
          .insert(schema.integrationQueryTemplates)
          .values({
            id: newId(),
            organisationId: starterIds.organisation,
            integrationId,
            templateKey: definition.key,
            version: definition.version,
            definition,
            enabled: true,
            createdByActorId: starterIds.actors.jordan,
          })
          .onConflictDoUpdate({
            target: [
              schema.integrationQueryTemplates.organisationId,
              schema.integrationQueryTemplates.integrationId,
              schema.integrationQueryTemplates.templateKey,
              schema.integrationQueryTemplates.version,
            ],
            set: {
              definition,
              enabled: true,
              updatedAt: new Date(),
            },
          });
      }

      if (!changed) return;
      const traceId = `bootstrap-connector-${configuration.product}-${integrationId}`;
      await appendAuditEvent(tx, {
        organisationId: starterIds.organisation,
        actorId: starterIds.actors.jordan,
        actorType: "human",
        action: existing ? "connector.updated" : "connector.configured",
        targetType: "integration",
        targetId: integrationId,
        metadata: {
          source: "environment-bootstrap",
          product: configuration.product,
          instanceId: configuration.instanceId,
          authType: auth.type,
          templateCount: (connectorPresets[configuration.product] ?? []).length,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: starterIds.organisation,
        eventType: "connector.configured",
        aggregateType: "integration",
        aggregateId: integrationId,
        queueName: "muster-integrations",
        payload: { integrationId, source: "environment-bootstrap" },
        idempotencyKey: `connector.configured:bootstrap:${integrationId}:${Date.now()}`,
        traceId,
      });
    });
  }
}
