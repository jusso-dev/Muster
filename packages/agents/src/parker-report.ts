import { ReportManifestSchema } from "@muster/contracts";
import { z } from "zod";

const PeriodSchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((period) => period.from < period.to, {
    message: "Report start must precede end.",
  });

export const CreateParkerReportSchema = z.object({
  roomId: z.uuid(),
  taskId: z.uuid().optional(),
  audience: z.enum(["analyst", "leadership", "executive"]).default("analyst"),
  period: PeriodSchema,
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((timezone) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
        return true;
      } catch {
        return false;
      }
    }, "Timezone must be an IANA timezone.")
    .default("UTC"),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export type ParkerReportInput = z.infer<typeof CreateParkerReportSchema>;

type TimestampedStatus = {
  startedAt?: Date | null;
  completedAt?: Date | null;
  status: string;
};

export type ParkerAggregateData = {
  alerts: Array<{
    id: string;
    receivedAt: Date;
    investigationId: string | null;
    correlationKey: string | null;
  }>;
  investigations: Array<{
    id: string;
    createdAt: Date;
    closedAt: Date | null;
  }>;
  approvals: Array<{
    requestedAt: Date;
    decisionAt: Date | null;
  }>;
  agentRuns: TimestampedStatus[];
  workflowRuns: TimestampedStatus[];
};

type Metric = z.infer<typeof ReportManifestSchema>["values"][number];

function inside(date: Date | null | undefined, from: Date, to: Date) {
  return Boolean(date && date >= from && date < to);
}

function metric(key: string, values: number[]): Metric {
  if (!values.length) {
    return {
      key,
      value: null,
      unit: "minutes",
      state: "not_applicable",
      sampleSize: 0,
    };
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    key,
    value: Number(average.toFixed(2)),
    unit: "minutes",
    state: "available",
    sampleSize: values.length,
  };
}

function rate(key: string, failed: number, total: number): Metric {
  if (!total) {
    return {
      key,
      value: null,
      unit: "percent",
      state: "not_applicable",
      sampleSize: 0,
    };
  }
  return {
    key,
    value: Number(((failed / total) * 100).toFixed(2)),
    unit: "percent",
    state: failed === 0 ? "zero" : "available",
    sampleSize: total,
  };
}

export function buildParkerManifest(
  input: ParkerReportInput,
  data: ParkerAggregateData,
) {
  const { from, to } = input.period;
  const periodAlerts = data.alerts.filter((row) =>
    inside(row.receivedAt, from, to),
  );
  const periodInvestigations = data.investigations.filter((row) =>
    inside(row.createdAt, from, to),
  );
  const periodApprovals = data.approvals.filter((row) =>
    inside(row.requestedAt, from, to),
  );
  const periodAgentRuns = data.agentRuns.filter((row) =>
    inside(row.startedAt ?? row.completedAt, from, to),
  );
  const periodWorkflowRuns = data.workflowRuns.filter((row) =>
    inside(row.startedAt ?? row.completedAt, from, to),
  );
  const investigationsById = new Map(
    data.investigations.map((row) => [row.id, row]),
  );
  const investigationMinutes = periodAlerts
    .flatMap((alert) => {
      const investigation = alert.investigationId
        ? investigationsById.get(alert.investigationId)
        : undefined;
      return investigation
        ? [
            (investigation.createdAt.getTime() - alert.receivedAt.getTime()) /
              60_000,
          ]
        : [];
    })
    .filter((value) => value >= 0);
  const approvalMinutes = periodApprovals
    .flatMap((row) =>
      row.decisionAt
        ? [(row.decisionAt.getTime() - row.requestedAt.getTime()) / 60_000]
        : [],
    )
    .filter((value) => value >= 0);
  const resolutionMinutes = periodInvestigations
    .flatMap((row) =>
      row.closedAt
        ? [(row.closedAt.getTime() - row.createdAt.getTime()) / 60_000]
        : [],
    )
    .filter((value) => value >= 0);
  const keyCounts = new Map<string, number>();
  for (const alert of periodAlerts) {
    if (alert.correlationKey) {
      keyCounts.set(
        alert.correlationKey,
        (keyCounts.get(alert.correlationKey) ?? 0) + 1,
      );
    }
  }
  const recurringAlertCount = periodAlerts.filter(
    (alert) =>
      alert.correlationKey && (keyCounts.get(alert.correlationKey) ?? 0) > 1,
  ).length;
  const values: Metric[] = [
    {
      key: "mtta",
      value: null,
      unit: "minutes",
      state: "unavailable",
      sampleSize: 0,
    },
    metric("time_to_investigation", investigationMinutes),
    {
      key: "time_to_promotion",
      value: null,
      unit: "minutes",
      state: "unavailable",
      sampleSize: 0,
    },
    metric("approval_wait", approvalMinutes),
    metric("mttr", resolutionMinutes),
    rate("recurrence_rate", recurringAlertCount, periodAlerts.length),
    rate(
      "agent_failure_rate",
      periodAgentRuns.filter((row) => row.status === "failed").length,
      periodAgentRuns.length,
    ),
    rate(
      "workflow_failure_rate",
      periodWorkflowRuns.filter((row) => row.status === "failed").length,
      periodWorkflowRuns.length,
    ),
  ];
  const metricDefinitions = [
    [
      "mtta",
      "Mean alert acknowledgement time.",
      "Acknowledged alerts in period.",
      "Unavailable: acknowledgement timestamps are not stored.",
    ],
    [
      "time_to_investigation",
      "Mean received-to-investigation creation time.",
      "Alerts received in period linked to an investigation.",
      "Unlinked alerts and negative durations excluded.",
    ],
    [
      "time_to_promotion",
      "Mean investigation-to-Kelpie promotion time.",
      "Promoted investigations in period.",
      "Unavailable: promotion timestamps are not stored.",
    ],
    [
      "approval_wait",
      "Mean approval request-to-decision time.",
      "Approvals requested in period with a decision.",
      "Pending approvals and negative durations excluded.",
    ],
    [
      "mttr",
      "Mean investigation creation-to-closure time.",
      "Investigations created in period and closed.",
      "Open investigations and negative durations excluded.",
    ],
    [
      "recurrence_rate",
      "Share of alerts whose correlation key repeats in the period.",
      "Alerts received in period.",
      "Alerts without a correlation key are not recurrent.",
    ],
    [
      "agent_failure_rate",
      "Share of durable agent runs ending failed.",
      "Agent runs started or completed in period.",
      "Cancelled runs remain in the denominator.",
    ],
    [
      "workflow_failure_rate",
      "Share of workflow runs ending failed.",
      "Workflow runs started or completed in period.",
      "Cancelled runs remain in the denominator.",
    ],
  ].map(([key, definition, population, exclusions]) => ({
    key,
    definition,
    population,
    exclusions,
  }));
  const available = values.filter((value) =>
    ["available", "zero"].includes(value.state),
  );
  const narrative =
    input.audience === "executive"
      ? `Operational briefing for ${from.toISOString()} to ${to.toISOString()}. ${available.length} of ${values.length} governed metrics have authoritative values; unavailable metrics are explicitly withheld.`
      : `Parker calculated ${available.length} authoritative metrics for the requested period. Every value retains its population, exclusions, and stored query parameters.`;
  const periodQuery = {
    gte: from.toISOString(),
    lt: to.toISOString(),
  };
  return ReportManifestSchema.parse({
    version: "parker-report-v1",
    audience: input.audience,
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      timezone: input.timezone,
      comparisonPeriod: null,
    },
    filters: {
      organisationScoped: true,
      period: { from: from.toISOString(), to: to.toISOString() },
    },
    metricDefinitions,
    values,
    sourceReferences: [
      {
        source: "alerts",
        query: { receivedAt: periodQuery, organisationScoped: true },
      },
      {
        source: "investigations",
        query: { createdAt: periodQuery, organisationScoped: true },
      },
      {
        source: "approvals",
        query: { requestedAt: periodQuery, organisationScoped: true },
      },
      {
        source: "agent_runs",
        query: {
          startedAtOrCompletedAt: periodQuery,
          organisationScoped: true,
        },
      },
      {
        source: "workflow_runs",
        query: {
          startedAtOrCompletedAt: periodQuery,
          organisationScoped: true,
        },
      },
    ],
    narrative,
    caveats: values
      .filter((value) =>
        ["unavailable", "not_applicable"].includes(value.state),
      )
      .map((value) => `${value.key}: ${value.state.replace("_", " ")}.`),
    classification: input.audience === "executive" ? "internal" : "restricted",
  });
}
