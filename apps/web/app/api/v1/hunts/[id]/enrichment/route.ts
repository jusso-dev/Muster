import { requireCapability } from "@muster/authz";
import { HuntResultSchema } from "@muster/contracts";
import { database, schema } from "@muster/database";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { IntegrationActionDomainService } from "@/lib/integration-action-domain";
import { JessieHuntDomainService } from "@/lib/jessie-hunt-domain";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "kelpie.cases.update");
    const { id } = await params;
    const hunt = await new JessieHuntDomainService().get(subject, id);
    if (hunt.status !== "completed") {
      throw new ApiProblem(
        409,
        "Hunt incomplete",
        "Only a completed hunt can propose case enrichment.",
      );
    }
    const result = HuntResultSchema.parse(hunt.result);
    const proposal = result.enrichmentProposal;
    if (!proposal || !hunt.linkedCaseId) {
      throw new ApiProblem(
        409,
        "Case link required",
        "The completed hunt is not linked to a Kelpie case.",
      );
    }
    const [kelpie] = await database()
      .select({ id: schema.integrationRecords.id })
      .from(schema.integrationRecords)
      .innerJoin(
        schema.integrationConnectorCredentials,
        and(
          eq(
            schema.integrationConnectorCredentials.organisationId,
            subject.organisationId,
          ),
          eq(
            schema.integrationConnectorCredentials.integrationId,
            schema.integrationRecords.id,
          ),
        ),
      )
      .where(
        and(
          eq(schema.integrationRecords.organisationId, subject.organisationId),
          eq(schema.integrationRecords.product, "kelpie"),
          inArray(schema.integrationRecords.status, ["configured", "healthy"]),
        ),
      )
      .orderBy(desc(schema.integrationRecords.updatedAt))
      .limit(1);
    if (!kelpie) {
      throw new ApiProblem(
        409,
        "Kelpie unavailable",
        "No enabled Kelpie connector exists for this organisation.",
      );
    }
    const evidenceReferences = proposal.evidenceReferences.map(
      (reference) => reference.reference,
    );
    const delivery = await new IntegrationActionDomainService().request(
      subject,
      {
        operation: "kelpie.timeline.comment",
        integrationId: kelpie.id,
        caseId: hunt.linkedCaseId,
        body: [
          proposal.timelineEntry,
          "",
          `Proposed finding: ${proposal.finding}`,
          ...(proposal.observables.length > 0
            ? [
                "",
                "Normalized observables:",
                ...proposal.observables.map(
                  (observable) =>
                    `- ${observable.type}: ${observable.value} — ${observable.description}`,
                ),
              ]
            : []),
        ].join("\n"),
        evidenceReferences,
        roomId: hunt.roomId,
        taskId: hunt.taskId ?? undefined,
        idempotencyKey: `jessie-hunt-enrichment:${hunt.id}`,
      },
      traceId,
    );
    return Response.json({ data: delivery, traceId }, { status: 202 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
