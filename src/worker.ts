import { handle } from "@astrojs/cloudflare/handler";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

export interface ClassificationBatchParams {
  boardId: string;
}

export class ClassificationBatchWorkflow extends WorkflowEntrypoint<Env, ClassificationBatchParams> {
  async run(_event: WorkflowEvent<ClassificationBatchParams>, _step: WorkflowStep) {
    // Sync + classification steps implemented in Phase 4.
  }
}

export default {
  fetch: handle,
  async scheduled(_controller, _env, _ctx) {
    // Cron dispatcher implemented in Phase 4.
  },
} satisfies ExportedHandler<Env>;
