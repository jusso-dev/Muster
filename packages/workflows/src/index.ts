import { parseDocument } from "yaml";
import {
  AgentStructuredOutputSchemas,
  WorkflowDefinitionSchema,
  type AgentStructuredOutputName,
  type WorkflowDefinition,
  type WorkflowStep,
} from "@muster/contracts";

export class WorkflowValidationError extends Error {
  override readonly name = "WorkflowValidationError";
  constructor(
    message: string,
    readonly issues: readonly string[],
  ) {
    super(message);
  }
}

export function parseWorkflow(yaml: string): WorkflowDefinition {
  if (Buffer.byteLength(yaml, "utf8") > 256_000) {
    throw new WorkflowValidationError("Workflow is too large", [
      "Maximum workflow size is 256 KB",
    ]);
  }
  const document = parseDocument(yaml, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length) {
    throw new WorkflowValidationError(
      "Workflow YAML could not be parsed",
      document.errors.map((error) => error.message),
    );
  }
  const result = WorkflowDefinitionSchema.safeParse(
    document.toJS({ maxAliasCount: 20 }),
  );
  if (!result.success) {
    throw new WorkflowValidationError(
      "Workflow contract is invalid",
      result.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
      ),
    );
  }
  validateSteps(result.data.steps);
  return result.data;
}

function validateSteps(steps: readonly WorkflowStep[], seen = new Set<string>()) {
  for (const step of steps) {
    if (seen.has(step.id)) {
      throw new WorkflowValidationError("Workflow step IDs must be unique", [
        step.id,
      ]);
    }
    seen.add(step.id);
    const executableKinds = [
      step.action,
      step.agent,
      step.query,
      step.condition,
      step.approval,
      step.delay,
      step.notification,
      step.parallel,
      step.foreach,
      step.subworkflow,
    ].filter(Boolean);
    if (executableKinds.length !== 1) {
      throw new WorkflowValidationError(
        "Each workflow step requires exactly one execution kind",
        [step.id],
      );
    }
    if (
      step.outputSchema &&
      !(step.outputSchema in AgentStructuredOutputSchemas)
    ) {
      throw new WorkflowValidationError("Unknown agent output schema", [
        `${step.id}: ${step.outputSchema}`,
      ]);
    }
    if (step.parallel) validateSteps(step.parallel, seen);
    if (step.foreach) validateSteps(step.foreach.steps, seen);
  }
}

function lookup(context: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || !(key in value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, context);
}

const conditionPattern =
  /^\{\{\s*([a-zA-Z0-9_.-]+)\s*(==|!=)\s*('([^']*)'|"([^"]*)"|true|false|\d+)\s*\}\}$/;

export function evaluateCondition(expression: string, context: unknown): boolean {
  const match = conditionPattern.exec(expression);
  if (!match) throw new WorkflowValidationError("Unsafe workflow condition", [expression]);
  const [, path, operator, rawValue, singleQuoted, doubleQuoted] = match;
  const expected =
    singleQuoted ??
    doubleQuoted ??
    (rawValue === "true"
      ? true
      : rawValue === "false"
        ? false
        : Number(rawValue));
  const actual = lookup(context, path ?? "");
  return operator === "==" ? actual === expected : actual !== expected;
}

export function validateAgentStepOutput(
  schemaName: AgentStructuredOutputName,
  value: unknown,
) {
  return AgentStructuredOutputSchemas[schemaName].parse(value);
}
