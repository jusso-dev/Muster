import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  actorTypeValues,
  alertStatusValues,
  approvalStatusValues,
  investigationStatusValues,
  messageTypeValues,
  roomTypeValues,
  severityValues,
  taskPriorityValues,
  taskStatusValues,
} from "@muster/contracts";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const actorTypeEnum = pgEnum("actor_type", actorTypeValues);
export const severityEnum = pgEnum("severity", severityValues);
export const roomTypeEnum = pgEnum("room_type", roomTypeValues);
export const messageTypeEnum = pgEnum("message_type", messageTypeValues);
export const alertStatusEnum = pgEnum("alert_status", alertStatusValues);
export const investigationStatusEnum = pgEnum(
  "investigation_status",
  investigationStatusValues,
);
export const approvalStatusEnum = pgEnum(
  "approval_status",
  approvalStatusValues,
);
export const taskStatusEnum = pgEnum("task_status", taskStatusValues);
export const taskPriorityEnum = pgEnum("task_priority", taskPriorityValues);

export const organisations = pgTable(
  "organisations",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    dataRegion: text("data_region").notNull().default("australia"),
    defaultTimezone: text("default_timezone")
      .notNull()
      .default("Australia/Sydney"),
    retentionPolicy: jsonb("retention_policy").notNull().default({}),
    authenticationPolicy: jsonb("authentication_policy").notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("organisations_slug_unique").on(table.slug),
    check(
      "organisations_status_check",
      sql`${table.status} in ('active','suspended')`,
    ),
  ],
);

// Better Auth tables remain separate from organisation-scoped domain profiles.
export const authUsers = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  ...timestamps,
});

export const authSessions = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps,
  },
  (table) => [index("auth_sessions_user_idx").on(table.userId)],
);

export const authAccounts = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [
    index("auth_accounts_user_idx").on(table.userId),
    uniqueIndex("auth_accounts_provider_unique").on(
      table.providerId,
      table.accountId,
    ),
  ],
);

export const authVerifications = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("auth_verification_identifier_idx").on(table.identifier)],
);

export const authTwoFactors = pgTable(
  "auth_two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (table) => [uniqueIndex("auth_two_factor_user_unique").on(table.userId)],
);

export const authPasskeys = pgTable(
  "auth_passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    aaguid: text("aaguid"),
  },
  (table) => [index("auth_passkey_user_idx").on(table.userId)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    betterAuthUserId: text("better_auth_user_id")
      .notNull()
      .references(() => authUsers.id),
    displayName: text("display_name").notNull(),
    email: text("email").notNull(),
    avatar: text("avatar"),
    jobTitle: text("job_title"),
    team: text("team"),
    presenceState: text("presence_state").notNull().default("offline"),
    timezone: text("timezone").notNull().default("Australia/Sydney"),
    notificationPreferences: jsonb("notification_preferences")
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("users_org_email_unique").on(table.organisationId, table.email),
    uniqueIndex("users_better_auth_unique").on(table.betterAuthUserId),
    index("users_org_idx").on(table.organisationId),
  ],
);

export const actors = pgTable(
  "actors",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    actorType: actorTypeEnum("actor_type").notNull(),
    displayName: text("display_name").notNull(),
    avatar: text("avatar"),
    icon: text("icon"),
    status: text("status").notNull().default("active"),
    identityReference: text("identity_reference"),
    capabilityAssignments: jsonb("capability_assignments")
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("actors_org_type_idx").on(table.organisationId, table.actorType),
    uniqueIndex("actors_org_identity_unique")
      .on(table.organisationId, table.identityReference)
      .where(sql`${table.identityReference} is not null`),
  ],
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description").notNull().default(""),
    roomType: roomTypeEnum("room_type").notNull(),
    visibility: text("visibility").notNull().default("organisation"),
    topic: text("topic").notNull().default(""),
    createdByActorId: uuid("created_by_actor_id")
      .notNull()
      .references(() => actors.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    linkedInvestigationId: uuid("linked_investigation_id"),
    linkedKelpieCaseId: text("linked_kelpie_case_id"),
    defaultSeverity: severityEnum("default_severity"),
    tlp: text("tlp").notNull().default("amber"),
    retentionPolicy: jsonb("retention_policy").notNull().default({}),
  },
  (table) => [
    uniqueIndex("rooms_org_slug_unique").on(table.organisationId, table.slug),
    index("rooms_org_type_idx").on(table.organisationId, table.roomType),
  ],
);

export const roomMemberships = pgTable(
  "room_memberships",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    membershipRole: text("membership_role").notNull(),
    notificationLevel: text("notification_level").notNull().default("all"),
    notifyReplies: boolean("notify_replies").notNull().default(true),
    notifyFollowedThreads: boolean("notify_followed_threads")
      .notNull()
      .default(true),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastReadEventId: uuid("last_read_event_id"),
    muted: boolean("muted").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.actorId] }),
    index("room_memberships_org_actor_idx").on(
      table.organisationId,
      table.actorId,
    ),
    check(
      "room_membership_role_check",
      sql`${table.membershipRole} in ('owner','moderator','member','guest','agent_member')`,
    ),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    sourceProduct: text("source_product").notNull(),
    sourceInstance: text("source_instance").notNull(),
    externalReference: text("external_reference").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    severity: severityEnum("severity").notNull(),
    status: alertStatusEnum("status").notNull().default("new"),
    ruleName: text("rule_name"),
    ruleId: text("rule_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    assignedActorId: uuid("assigned_actor_id").references(() => actors.id),
    entities: jsonb("entities").notNull().default([]),
    observables: jsonb("observables").notNull().default([]),
    rawReferenceMetadata: jsonb("raw_reference_metadata").notNull().default({}),
    investigationId: uuid("investigation_id"),
    kelpieCaseId: text("kelpie_case_id"),
    roomId: uuid("room_id").references(() => rooms.id),
    dedupeKey: text("dedupe_key").notNull(),
    correlationKey: text("correlation_key"),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("alerts_org_source_ref_unique").on(
      table.organisationId,
      table.sourceProduct,
      table.sourceInstance,
      table.externalReference,
    ),
    uniqueIndex("alerts_org_dedupe_unique").on(
      table.organisationId,
      table.dedupeKey,
    ),
    index("alerts_org_queue_idx").on(
      table.organisationId,
      table.status,
      table.severity,
      table.receivedAt,
    ),
    index("alerts_search_idx").using(
      "gin",
      sql`to_tsvector('english', ${table.title} || ' ' || ${table.description})`,
    ),
  ],
);

export const investigations = pgTable(
  "investigations",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    investigationNumber: text("investigation_number").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    status: investigationStatusEnum("status").notNull().default("open"),
    severity: severityEnum("severity").notNull(),
    leadActorId: uuid("lead_actor_id").references(() => actors.id),
    roomId: uuid("room_id").references(() => rooms.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    recommendation: text("recommendation"),
    disposition: text("disposition"),
    promotionDecision: jsonb("promotion_decision"),
    linkedKelpieCaseId: text("linked_kelpie_case_id"),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("investigations_org_number_unique").on(
      table.organisationId,
      table.investigationNumber,
    ),
    index("investigations_org_queue_idx").on(
      table.organisationId,
      table.status,
      table.severity,
      table.lastActivityAt,
    ),
    index("investigations_search_idx").using(
      "gin",
      sql`to_tsvector('english', ${table.title} || ' ' || ${table.summary})`,
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    threadParentId: uuid("thread_parent_id"),
    authorActorId: uuid("author_actor_id")
      .notNull()
      .references(() => actors.id),
    messageType: messageTypeEnum("message_type").notNull(),
    document: jsonb("document").notNull(),
    plainText: text("plain_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    dataClassification: text("data_classification")
      .notNull()
      .default("internal"),
    relatedAlertId: uuid("related_alert_id").references(() => alerts.id),
    relatedInvestigationId: uuid("related_investigation_id").references(
      () => investigations.id,
    ),
    relatedCaseId: text("related_case_id"),
    relatedAgentRunId: uuid("related_agent_run_id"),
    relatedWorkflowRunId: uuid("related_workflow_run_id"),
    idempotencyKey: text("idempotency_key"),
  },
  (table) => [
    index("messages_org_room_time_idx").on(
      table.organisationId,
      table.roomId,
      table.createdAt,
    ),
    index("messages_thread_idx").on(table.threadParentId, table.createdAt),
    uniqueIndex("messages_org_idempotency_unique")
      .on(table.organisationId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("messages_search_idx").using(
      "gin",
      sql`to_tsvector('english', ${table.plainText})`,
    ),
  ],
);

export const reactions = pgTable(
  "reactions",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.actorId, table.emoji] }),
  ],
);

export const reactionOperations = pgTable(
  "reaction_operations",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    emoji: text("emoji").notNull(),
    active: boolean("active").notNull(),
    resultCount: integer("result_count").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("reaction_operations_org_idempotency_unique").on(
      table.organisationId,
      table.idempotencyKey,
    ),
    index("reaction_operations_org_message_idx").on(
      table.organisationId,
      table.messageId,
    ),
  ],
);

export const messageRevisions = pgTable(
  "message_revisions",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    revisionType: text("revision_type").notNull(),
    previousDocument: jsonb("previous_document").notNull(),
    previousPlainText: text("previous_plain_text").notNull(),
    nextDocument: jsonb("next_document"),
    nextPlainText: text("next_plain_text"),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("message_revisions_org_message_idx").on(
      table.organisationId,
      table.messageId,
      table.createdAt,
    ),
    check(
      "message_revision_type_check",
      sql`${table.revisionType} in ('edit','delete')`,
    ),
    uniqueIndex("message_revisions_org_idempotency_unique").on(
      table.organisationId,
      table.idempotencyKey,
    ),
  ],
);

export const messagePins = pgTable(
  "message_pins",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    pinnedByActorId: uuid("pinned_by_actor_id")
      .notNull()
      .references(() => actors.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.messageId] }),
    index("message_pins_org_room_idx").on(
      table.organisationId,
      table.roomId,
      table.createdAt,
    ),
  ],
);

export const messageSaves = pgTable(
  "message_saves",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.actorId] }),
    index("message_saves_org_actor_idx").on(
      table.organisationId,
      table.actorId,
      table.createdAt,
    ),
  ],
);

export const threadFollows = pgTable(
  "thread_follows",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    rootMessageId: uuid("root_message_id")
      .notNull()
      .references(() => messages.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.rootMessageId, table.actorId] }),
    index("thread_follows_org_actor_idx").on(
      table.organisationId,
      table.actorId,
    ),
  ],
);

export const messageMentions = pgTable(
  "message_mentions",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    mentionedActorId: uuid("mentioned_actor_id").references(() => actors.id),
    mentionType: text("mention_type").notNull(),
    mentionKey: text("mention_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.messageId, table.mentionType, table.mentionKey],
    }),
    index("message_mentions_org_actor_idx").on(
      table.organisationId,
      table.mentionedActorId,
      table.createdAt,
    ),
    check(
      "message_mention_type_check",
      sql`${table.mentionType} in ('actor','room','everyone')`,
    ),
  ],
);

export const hypotheses = pgTable(
  "hypotheses",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigations.id),
    statement: text("statement").notNull(),
    status: text("status").notNull().default("unverified"),
    confidence: integer("confidence").notNull().default(50),
    createdByActorId: uuid("created_by_actor_id")
      .notNull()
      .references(() => actors.id),
    supportingFindingIds: jsonb("supporting_finding_ids").notNull().default([]),
    contradictingFindingIds: jsonb("contradicting_finding_ids")
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("hypotheses_org_investigation_idx").on(
      table.organisationId,
      table.investigationId,
    ),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigations.id),
    createdByActorId: uuid("created_by_actor_id")
      .notNull()
      .references(() => actors.id),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    confidence: integer("confidence").notNull(),
    severity: severityEnum("severity").notNull(),
    supportingEvidence: jsonb("supporting_evidence").notNull().default([]),
    relatedEntities: jsonb("related_entities").notNull().default([]),
    relatedObservables: jsonb("related_observables").notNull().default([]),
    recommendedAction: text("recommended_action"),
    agentProvenance: jsonb("agent_provenance"),
    humanReviewedAt: timestamp("human_reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    index("findings_org_investigation_idx").on(
      table.organisationId,
      table.investigationId,
      table.createdAt,
    ),
    index("findings_search_idx").using(
      "gin",
      sql`to_tsvector('english', ${table.title} || ' ' || ${table.summary})`,
    ),
  ],
);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    decision: text("decision").notNull(),
    rationale: text("rationale").notNull(),
    decisionMakerActorId: uuid("decision_maker_actor_id")
      .notNull()
      .references(() => actors.id),
    alternativesConsidered: jsonb("alternatives_considered")
      .notNull()
      .default([]),
    evidenceReferences: jsonb("evidence_references").notNull().default([]),
    relatedInvestigationId: uuid("related_investigation_id").references(
      () => investigations.id,
    ),
    relatedCaseId: text("related_case_id"),
    relatedWorkflowRunId: uuid("related_workflow_run_id"),
    approvalId: uuid("approval_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("decisions_org_investigation_idx").on(
      table.organisationId,
      table.relatedInvestigationId,
    ),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    requestingActorId: uuid("requesting_actor_id")
      .notNull()
      .references(() => actors.id),
    actionType: text("action_type").notNull(),
    target: jsonb("target").notNull(),
    riskSummary: text("risk_summary").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    requiredCapability: text("required_capability").notNull(),
    requiredApprovalCount: integer("required_approval_count")
      .notNull()
      .default(1),
    status: approvalStatusEnum("status").notNull().default("pending"),
    decisions: jsonb("decisions").notNull().default([]),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("approvals_org_idempotency_unique").on(
      table.organisationId,
      table.idempotencyKey,
    ),
    index("approvals_org_status_idx").on(
      table.organisationId,
      table.status,
      table.expiresAt,
    ),
  ],
);

export const agentDefinitions = pgTable(
  "agent_definitions",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    name: text("name").notNull(),
    description: text("description").notNull(),
    avatar: text("avatar"),
    runtime: text("runtime").notNull(),
    model: text("model").notNull(),
    ownerActorId: uuid("owner_actor_id")
      .notNull()
      .references(() => actors.id),
    status: text("status").notNull().default("active"),
    systemPromptVersion: text("system_prompt_version").notNull(),
    allowedTools: jsonb("allowed_tools").notNull().default([]),
    allowedRooms: jsonb("allowed_rooms").notNull().default([]),
    capabilityRequirements: jsonb("capability_requirements")
      .notNull()
      .default([]),
    maximumRuntimeSeconds: integer("maximum_runtime_seconds")
      .notNull()
      .default(300),
    maximumTokenBudget: integer("maximum_token_budget")
      .notNull()
      .default(20_000),
    maximumCostCents: integer("maximum_cost_cents").notNull().default(500),
    dataClassificationAllowance: jsonb("data_classification_allowance")
      .notNull()
      .default(["internal"]),
    approvalRequirements: jsonb("approval_requirements").notNull().default({}),
    killSwitch: boolean("kill_switch").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("agent_definitions_org_name_unique").on(
      table.organisationId,
      table.name,
    ),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentDefinitions.id),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    roomId: uuid("room_id").references(() => rooms.id),
    investigationId: uuid("investigation_id").references(
      () => investigations.id,
    ),
    workflowRunId: uuid("workflow_run_id"),
    requestedByActorId: uuid("requested_by_actor_id")
      .notNull()
      .references(() => actors.id),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("queued"),
    request: jsonb("request").notNull().default({}),
    progress: jsonb("progress").notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    cancellationRequestedAt: timestamp("cancellation_requested_at", {
      withTimezone: true,
    }),
    workerId: text("worker_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    inputHash: text("input_hash").notNull(),
    promptHash: text("prompt_hash"),
    outputHash: text("output_hash"),
    outputSchema: text("output_schema"),
    promptVersion: text("prompt_version").notNull(),
    runtime: text("runtime").notNull(),
    model: text("model").notNull(),
    maximumRuntimeSeconds: integer("maximum_runtime_seconds")
      .notNull()
      .default(300),
    maximumTokenBudget: integer("maximum_token_budget")
      .notNull()
      .default(20_000),
    maximumCostCents: integer("maximum_cost_cents").notNull().default(500),
    tokenUsage: jsonb("token_usage").notNull().default({}),
    estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    diagnostics: jsonb("diagnostics").notNull().default({}),
    failureCode: text("failure_code"),
    error: text("error"),
    cancellationReason: text("cancellation_reason"),
    structuredOutput: jsonb("structured_output"),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (table) => [
    uniqueIndex("agent_runs_org_idempotency_unique").on(
      table.organisationId,
      table.idempotencyKey,
    ),
    index("agent_runs_org_status_idx").on(
      table.organisationId,
      table.status,
      table.startedAt,
    ),
    index("agent_runs_recovery_idx").on(
      table.status,
      table.leaseExpiresAt,
      table.startedAt,
    ),
  ],
);

export const agentRunEvents = pgTable(
  "agent_run_events",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id),
    eventType: text("event_type").notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_run_events_org_run_idx").on(
      table.organisationId,
      table.runId,
      table.createdAt,
    ),
  ],
);

export const agentRunSources = pgTable(
  "agent_run_sources",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    contentHash: text("content_hash").notNull(),
    classification: text("classification").notNull().default("internal"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_run_sources_org_run_unique").on(
      table.organisationId,
      table.runId,
      table.sourceType,
      table.sourceId,
    ),
    index("agent_run_sources_org_run_idx").on(
      table.organisationId,
      table.runId,
      table.createdAt,
    ),
  ],
);

export const agentToolCalls = pgTable(
  "agent_tool_calls",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id),
    toolName: text("tool_name").notNull(),
    capability: text("capability").notNull(),
    classification: text("classification").notNull(),
    argumentsHash: text("arguments_hash").notNull(),
    resultHash: text("result_hash"),
    approvalId: uuid("approval_id").references(() => approvals.id),
    status: text("status").notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_tool_calls_org_run_idx").on(
      table.organisationId,
      table.runId,
      table.startedAt,
    ),
  ],
);

// Agent learning is evidence-backed and versioned. Runs may propose notes and
// skills, but only reviewed skill versions can enter trusted instructions.
export const agentMemories = pgTable(
  "agent_memories",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentDefinitions.id),
    sourceRunId: uuid("source_run_id")
      .notNull()
      .references(() => agentRuns.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    evidenceReferences: jsonb("evidence_references").notNull().default([]),
    confidence: integer("confidence").notNull(),
    classification: text("classification").notNull().default("internal"),
    status: text("status").notNull().default("active"),
    supersedesMemoryId: uuid("supersedes_memory_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reviewedByActorId: uuid("reviewed_by_actor_id").references(() => actors.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_memories_org_agent_idx").on(
      table.organisationId,
      table.agentId,
      table.createdAt,
    ),
    check(
      "agent_memories_kind_check",
      sql`${table.kind} in ('fact','preference','lesson','failure','procedure_hint')`,
    ),
    check(
      "agent_memories_status_check",
      sql`${table.status} in ('active','superseded','expired','rejected')`,
    ),
    check(
      "agent_memories_confidence_check",
      sql`${table.confidence} between 0 and 100`,
    ),
  ],
);

export const agentSkills = pgTable(
  "agent_skills",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentDefinitions.id),
    skillKey: text("skill_key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("draft"),
    activeVersionId: uuid("active_version_id"),
    createdByActorId: uuid("created_by_actor_id")
      .notNull()
      .references(() => actors.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("agent_skills_org_agent_key_unique").on(
      table.organisationId,
      table.agentId,
      table.skillKey,
    ),
    check(
      "agent_skills_status_check",
      sql`${table.status} in ('draft','evaluating','published','retired')`,
    ),
  ],
);

export const agentSkillVersions = pgTable(
  "agent_skill_versions",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => agentSkills.id),
    version: integer("version").notNull(),
    sourceRunId: uuid("source_run_id")
      .notNull()
      .references(() => agentRuns.id),
    basedOnVersionId: uuid("based_on_version_id"),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    changeRationale: text("change_rationale").notNull(),
    evidenceReferences: jsonb("evidence_references").notNull().default([]),
    requiredCapabilities: jsonb("required_capabilities").notNull().default([]),
    allowedTools: jsonb("allowed_tools").notNull().default([]),
    state: text("state").notNull().default("proposed"),
    approvedByActorId: uuid("approved_by_actor_id").references(() => actors.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_skill_versions_skill_version_unique").on(
      table.skillId,
      table.version,
    ),
    uniqueIndex("agent_skill_versions_content_hash_unique").on(
      table.organisationId,
      table.contentHash,
    ),
    check(
      "agent_skill_versions_state_check",
      sql`${table.state} in ('proposed','evaluating','approved','rejected','published','rolled_back')`,
    ),
  ],
);

export const agentSkillEvaluations = pgTable(
  "agent_skill_evaluations",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    skillVersionId: uuid("skill_version_id")
      .notNull()
      .references(() => agentSkillVersions.id),
    evaluatorActorId: uuid("evaluator_actor_id")
      .notNull()
      .references(() => actors.id),
    suite: text("suite").notNull(),
    passed: boolean("passed").notNull(),
    score: integer("score").notNull(),
    baselineScore: integer("baseline_score"),
    regressions: jsonb("regressions").notNull().default([]),
    result: jsonb("result").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_skill_evaluations_version_idx").on(
      table.organisationId,
      table.skillVersionId,
      table.createdAt,
    ),
    check(
      "agent_skill_evaluations_score_check",
      sql`${table.score} between 0 and 100`,
    ),
  ],
);

export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    workflowKey: text("workflow_key").notNull(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    status: text("status").notNull().default("draft"),
    yaml: text("yaml").notNull(),
    parsed: jsonb("parsed").notNull(),
    ownerActorId: uuid("owner_actor_id")
      .notNull()
      .references(() => actors.id),
    enabled: boolean("enabled").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workflow_defs_org_key_version_unique").on(
      table.organisationId,
      table.workflowKey,
      table.version,
    ),
  ],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    workflowDefinitionId: uuid("workflow_definition_id")
      .notNull()
      .references(() => workflowDefinitions.id),
    status: text("status").notNull().default("queued"),
    triggerEventId: text("trigger_event_id"),
    roomId: uuid("room_id").references(() => rooms.id),
    investigationId: uuid("investigation_id").references(
      () => investigations.id,
    ),
    requestedByActorId: uuid("requested_by_actor_id").references(
      () => actors.id,
    ),
    state: jsonb("state").notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    error: text("error"),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (table) => [
    uniqueIndex("workflow_runs_org_idempotency_unique").on(
      table.organisationId,
      table.idempotencyKey,
    ),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    uploadedByActorId: uuid("uploaded_by_actor_id")
      .notNull()
      .references(() => actors.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    classification: text("classification").notNull(),
    relatedRoomId: uuid("related_room_id").references(() => rooms.id),
    relatedInvestigationId: uuid("related_investigation_id").references(
      () => investigations.id,
    ),
    relatedCaseId: text("related_case_id"),
    source: text("source").notNull(),
    originalTimestamp: timestamp("original_timestamp", { withTimezone: true }),
    storageKey: text("storage_key").notNull(),
    scanState: text("scan_state").notNull().default("pending"),
    retentionState: text("retention_state").notNull().default("active"),
    legalHold: boolean("legal_hold").notNull().default(false),
    objectLockMetadata: jsonb("object_lock_metadata").notNull().default({}),
  },
  (table) => [
    uniqueIndex("evidence_org_hash_unique").on(
      table.organisationId,
      table.sha256,
    ),
    index("evidence_search_idx").using(
      "gin",
      sql`to_tsvector('english', ${table.fileName} || ' ' || ${table.source})`,
    ),
  ],
);

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    investigationId: uuid("investigation_id").references(
      () => investigations.id,
    ),
    roomId: uuid("room_id").references(() => rooms.id),
    externalCaseId: text("external_case_id"),
    actorId: uuid("actor_id").references(() => actors.id),
    eventType: text("event_type").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("timeline_org_investigation_time_idx").on(
      table.organisationId,
      table.investigationId,
      table.occurredAt,
    ),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    safePreview: text("safe_preview"),
    target: jsonb("target").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("notifications_org_actor_read_idx").on(
      table.organisationId,
      table.actorId,
      table.readAt,
      table.createdAt,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: taskStatusEnum("status").notNull().default("backlog"),
    priority: taskPriorityEnum("priority").notNull().default("normal"),
    assignedActorId: uuid("assigned_actor_id").references(() => actors.id),
    createdByActorId: uuid("created_by_actor_id")
      .notNull()
      .references(() => actors.id),
    roomId: uuid("room_id").references(() => rooms.id),
    investigationId: uuid("investigation_id").references(
      () => investigations.id,
    ),
    relatedCaseId: text("related_case_id"),
    approvalRequired: boolean("approval_required").notNull().default(false),
    dueAt: timestamp("due_at", { withTimezone: true }),
    agentRunId: text("agent_run_id"),
    agentRunStatus: text("agent_run_status"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("tasks_org_status_idx").on(
      table.organisationId,
      table.status,
      table.updatedAt,
    ),
    index("tasks_org_assignee_idx").on(
      table.organisationId,
      table.assignedActorId,
      table.status,
    ),
  ],
);

export const integrationRecords = pgTable(
  "integration_records",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    product: text("product").notNull(),
    instanceId: text("instance_id").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull(),
    mock: boolean("mock").notNull().default(false),
    configuration: jsonb("configuration").notNull().default({}),
    health: jsonb("health").notNull().default({}),
    cursor: jsonb("cursor").notNull().default({}),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("integrations_org_product_instance_unique").on(
      table.organisationId,
      table.product,
      table.instanceId,
    ),
  ],
);

export const integrationEntities = pgTable(
  "integration_entities",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrationRecords.id),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull(),
    posture: jsonb("posture").notNull().default({}),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("integration_entities_org_external_unique").on(
      table.organisationId,
      table.integrationId,
      table.entityType,
      table.externalId,
    ),
  ],
);

export const integrationDeliveries = pgTable(
  "integration_deliveries",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrationRecords.id),
    direction: text("direction").notNull(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    requestMetadata: jsonb("request_metadata").notNull().default({}),
    responseMetadata: jsonb("response_metadata").notNull().default({}),
    error: text("error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("integration_delivery_org_idempotency_unique").on(
      table.organisationId,
      table.idempotencyKey,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organisationId, table.scope, table.key] }),
    index("idempotency_expiry_idx").on(table.expiresAt),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    queueName: text("queue_name").notNull(),
    payload: jsonb("payload").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    traceId: text("trace_id").notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("outbox_idempotency_unique").on(table.idempotencyKey),
    index("outbox_pending_idx")
      .on(table.availableAt, table.createdAt)
      .where(sql`${table.dispatchedAt} is null`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id),
    actorType: actorTypeEnum("actor_type").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    previousHash: text("previous_hash").notNull(),
    eventHash: text("event_hash").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    traceId: text("trace_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("audit_org_sequence_unique").on(
      table.organisationId,
      table.sequence,
    ),
    uniqueIndex("audit_org_hash_unique").on(
      table.organisationId,
      table.eventHash,
    ),
    index("audit_org_target_idx").on(
      table.organisationId,
      table.targetType,
      table.targetId,
    ),
  ],
);
