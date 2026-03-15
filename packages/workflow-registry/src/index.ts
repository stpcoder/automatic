import { readFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { workflowDefinitionSchema, type WorkflowDefinition, type WorkflowStep } from "../../contracts/src/index.js";

export class WorkflowRegistry {
  private readonly workflows = new Map<string, WorkflowDefinition["workflow"]>();

  static async fromExampleDirectory(exampleDir: string): Promise<WorkflowRegistry> {
    const registry = new WorkflowRegistry();
    const files = [
      "workflow_overseas_shipment.yaml",
      "workflow_sample_intake.yaml"
    ];

    for (const file of files) {
      const fullPath = path.join(exampleDir, file);
      const raw = await readFile(fullPath, "utf8");
      const parsed = YAML.parse(raw);
      const workflow = workflowDefinitionSchema.parse(parsed).workflow;
      registry.workflows.set(workflow.workflow_id, workflow);
    }

    return registry;
  }

  getWorkflow(workflowId: string): WorkflowDefinition["workflow"] {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    return workflow;
  }

  getStep(workflowId: string, stepId: string): WorkflowStep {
    const workflow = this.getWorkflow(workflowId);
    const step = workflow.steps.find((candidate) => candidate.step_id === stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found in workflow ${workflowId}`);
    }
    return step;
  }

  getNextStep(workflowId: string, currentStepId: string): WorkflowStep | undefined {
    const workflow = this.getWorkflow(workflowId);
    const index = workflow.steps.findIndex((candidate) => candidate.step_id === currentStepId);
    if (index === -1) {
      throw new Error(`Step ${currentStepId} not found in workflow ${workflowId}`);
    }
    return workflow.steps[index + 1];
  }
}
