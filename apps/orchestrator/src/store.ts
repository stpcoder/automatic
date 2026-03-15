import type { Approval, Artifact, CaseEvent, CaseRecord, Expectation } from "../../../packages/contracts/src/index.js";

export class InMemoryStore {
  readonly cases = new Map<string, CaseRecord>();
  readonly expectations = new Map<string, Expectation>();
  readonly approvals = new Map<string, Approval>();
  readonly artifacts = new Map<string, Artifact>();
  readonly events = new Map<string, CaseEvent[]>();

  saveCase(record: CaseRecord): void {
    this.cases.set(record.case_id, record);
  }

  addExpectation(expectation: Expectation): void {
    this.expectations.set(expectation.expectation_id, expectation);
  }

  addApproval(approval: Approval): void {
    this.approvals.set(approval.approval_id, approval);
  }

  addArtifact(artifact: Artifact): void {
    this.artifacts.set(artifact.artifact_id, artifact);
  }

  addEvent(event: CaseEvent): void {
    const current = this.events.get(event.case_id) ?? [];
    current.push(event);
    this.events.set(event.case_id, current);
  }

  listArtifactsForStep(caseId: string, stepId: string): Artifact[] {
    return [...this.artifacts.values()].filter((artifact) => artifact.case_id === caseId && artifact.step_id === stepId);
  }

  listApprovalsForStep(caseId: string, stepId: string): Approval[] {
    return [...this.approvals.values()].filter((approval) => approval.case_id === caseId && approval.step_id === stepId);
  }

  listExpectationsForCase(caseId: string): Expectation[] {
    return [...this.expectations.values()].filter((expectation) => expectation.case_id === caseId);
  }

  listEventsForCase(caseId: string): CaseEvent[] {
    return this.events.get(caseId) ?? [];
  }
}
