import { END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { createNodes, type GraphDependencies } from "./nodes.ts";
import { RuntimeStateAnnotation, type RuntimeState } from "./state.ts";

/**
 * The execution graph from the runtime design: identity and scope, thread
 * state, memory, bounded context, planning, tool authorisation with denial and
 * approval branches, execution, validation, memory proposal and result
 * persistence.
 */
export function buildAgentGraph(
  dependencies: GraphDependencies,
  checkpointer: BaseCheckpointSaver,
) {
  const nodes = createNodes(dependencies);
  const graph = new StateGraph(RuntimeStateAnnotation)
    .addNode("resolveIdentityAndScope", nodes.resolveIdentityAndScope)
    .addNode("loadThreadState", nodes.loadThreadState)
    .addNode("retrieveRelevantMemory", nodes.retrieveRelevantMemory)
    .addNode("buildBoundedContext", nodes.buildBoundedContext)
    .addNode("planNextStep", nodes.planNextStep)
    .addNode("authoriseTool", nodes.authoriseTool)
    .addNode("recordDenial", nodes.recordDenial)
    .addNode("requestApproval", nodes.requestApproval)
    .addNode("awaitApproval", nodes.awaitApproval)
    .addNode("executeTool", nodes.executeTool)
    .addNode("validateResult", nodes.validateResult)
    .addNode("proposeMemories", nodes.proposeMemories)
    .addNode("persistRunResult", nodes.persistRunResult)
    .addEdge(START, "resolveIdentityAndScope")
    .addEdge("resolveIdentityAndScope", "loadThreadState")
    .addEdge("loadThreadState", "retrieveRelevantMemory")
    .addEdge("retrieveRelevantMemory", "buildBoundedContext")
    .addEdge("buildBoundedContext", "planNextStep")
    .addConditionalEdges("planNextStep", selectToolOrRespond, [
      "authoriseTool",
      "proposeMemories",
    ])
    .addConditionalEdges("authoriseTool", routeAuthorisation, [
      "executeTool",
      "requestApproval",
      "recordDenial",
    ])
    .addEdge("requestApproval", "awaitApproval")
    .addConditionalEdges("awaitApproval", routeApproval, [
      "executeTool",
      "recordDenial",
    ])
    .addEdge("executeTool", "validateResult")
    .addEdge("validateResult", "buildBoundedContext")
    .addEdge("recordDenial", "buildBoundedContext")
    .addEdge("proposeMemories", "persistRunResult")
    .addConditionalEdges("persistRunResult", routeAfterPersist, [
      END,
      "buildBoundedContext",
    ]);
  return graph.compile({ checkpointer });
}

export function selectToolOrRespond(state: RuntimeState): string {
  return state.pendingToolCall ? "authoriseTool" : "proposeMemories";
}

export function routeAuthorisation(state: RuntimeState): string {
  if (state.toolAuthorisation === "allowed") return "executeTool";
  if (state.toolAuthorisation === "approval_required") return "requestApproval";
  return "recordDenial";
}

export function routeApproval(state: RuntimeState): string {
  return state.toolAuthorisation === "allowed" ? "executeTool" : "recordDenial";
}

/**
 * A schema-invalid final response gets one bounded correction turn; anything
 * else is terminal.
 */
export function routeAfterPersist(state: RuntimeState): string {
  return state.settled ? END : "buildBoundedContext";
}

export type CompiledAgentGraph = ReturnType<typeof buildAgentGraph>;
