import type { Approval, Artifact, CaseEvent, CaseRecord, Expectation } from "../../../packages/contracts/src/index.js";

export interface CaseStore {
  close?(): void;

  saveCase(record: CaseRecord): void;
  getCase(caseId: string): CaseRecord | undefined;

  addExpectation(expectation: Expectation): void;
  listExpectationsForCase(caseId: string): Expectation[];

  addApproval(approval: Approval): void;
  getApproval(approvalId: string): Approval | undefined;
  listApprovals(caseId?: string): Approval[];
  listApprovalsForStep(caseId: string, stepId: string): Approval[];

  addArtifact(artifact: Artifact): void;
  listArtifacts(caseId?: string): Artifact[];
  listArtifactsForStep(caseId: string, stepId: string): Artifact[];

  addEvent(event: CaseEvent): void;
  listEventsForCase(caseId: string): CaseEvent[];
}

export class InMemoryStore implements CaseStore {
  readonly cases = new Map<string, CaseRecord>();
  readonly expectations = new Map<string, Expectation>();
  readonly approvals = new Map<string, Approval>();
  readonly artifacts = new Map<string, Artifact>();
  readonly events = new Map<string, CaseEvent[]>();

  saveCase(record: CaseRecord): void {
    this.cases.set(record.case_id, record);
  }

  getCase(caseId: string): CaseRecord | undefined {
    return this.cases.get(caseId);
  }

  addExpectation(expectation: Expectation): void {
    this.expectations.set(expectation.expectation_id, expectation);
  }

  listExpectationsForCase(caseId: string): Expectation[] {
    return [...this.expectations.values()].filter((item) => item.case_id === caseId);
  }

  addApproval(approval: Approval): void {
    this.approvals.set(approval.approval_id, approval);
  }

  getApproval(approvalId: string): Approval | undefined {
    return this.approvals.get(approvalId);
  }

  listApprovals(caseId?: string): Approval[] {
    const approvals = [...this.approvals.values()];
    return caseId ? approvals.filter((item) => item.case_id === caseId) : approvals;
  }

  listApprovalsForStep(caseId: string, stepId: string): Approval[] {
    return [...this.approvals.values()].filter((item) => item.case_id === caseId && item.step_id === stepId);
  }

  addArtifact(artifact: Artifact): void {
    this.artifacts.set(artifact.artifact_id, artifact);
  }

  listArtifacts(caseId?: string): Artifact[] {
    const artifacts = [...this.artifacts.values()];
    return caseId ? artifacts.filter((item) => item.case_id === caseId) : artifacts;
  }

  listArtifactsForStep(caseId: string, stepId: string): Artifact[] {
    return [...this.artifacts.values()].filter((item) => item.case_id === caseId && item.step_id === stepId);
  }

  addEvent(event: CaseEvent): void {
    const current = this.events.get(event.case_id) ?? [];
    current.push(event);
    this.events.set(event.case_id, current);
  }

  listEventsForCase(caseId: string): CaseEvent[] {
    return this.events.get(caseId) ?? [];
  }

  close(): void {}
}
