import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  approvalSchema,
  artifactSchema,
  caseEventSchema,
  caseRecordSchema,
  expectationSchema,
  type Approval,
  type Artifact,
  type CaseEvent,
  type CaseRecord,
  type Expectation
} from "../../../packages/contracts/src/index.js";
import type { CaseStore } from "./store.js";

export class SqliteStore implements CaseStore {
  private readonly db: DatabaseSync;

  constructor(private readonly dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cases (
        case_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS expectations (
        expectation_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_expectations_case_id ON expectations(case_id);
      CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_case_id ON approvals(case_id);
      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_case_id ON artifacts(case_id);
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_case_id ON events(case_id);
    `);
  }

  saveCase(record: CaseRecord): void {
    this.upsert("cases", "case_id", record.case_id, record);
  }

  getCase(caseId: string): CaseRecord | undefined {
    const row = this.db.prepare("SELECT payload FROM cases WHERE case_id = ?").get(caseId) as { payload?: string } | undefined;
    return row?.payload ? caseRecordSchema.parse(JSON.parse(row.payload)) : undefined;
  }

  addExpectation(expectation: Expectation): void {
    this.upsert("expectations", "expectation_id", expectation.expectation_id, expectation, {
      case_id: expectation.case_id,
      step_id: expectation.step_id
    });
  }

  listExpectationsForCase(caseId: string): Expectation[] {
    const rows = this.db.prepare("SELECT payload FROM expectations WHERE case_id = ?").all(caseId) as Array<{ payload: string }>;
    return rows.map((row) => expectationSchema.parse(JSON.parse(row.payload)));
  }

  addApproval(approval: Approval): void {
    this.upsert("approvals", "approval_id", approval.approval_id, approval, {
      case_id: approval.case_id,
      step_id: approval.step_id
    });
  }

  getApproval(approvalId: string): Approval | undefined {
    const row = this.db.prepare("SELECT payload FROM approvals WHERE approval_id = ?").get(approvalId) as { payload?: string } | undefined;
    return row?.payload ? approvalSchema.parse(JSON.parse(row.payload)) : undefined;
  }

  listApprovals(caseId?: string): Approval[] {
    const rows = caseId
      ? (this.db.prepare("SELECT payload FROM approvals WHERE case_id = ?").all(caseId) as Array<{ payload: string }>)
      : (this.db.prepare("SELECT payload FROM approvals").all() as Array<{ payload: string }>);
    return rows.map((row) => approvalSchema.parse(JSON.parse(row.payload)));
  }

  listApprovalsForStep(caseId: string, stepId: string): Approval[] {
    const rows = this.db
      .prepare("SELECT payload FROM approvals WHERE case_id = ? AND step_id = ?")
      .all(caseId, stepId) as Array<{ payload: string }>;
    return rows.map((row) => approvalSchema.parse(JSON.parse(row.payload)));
  }

  addArtifact(artifact: Artifact): void {
    this.upsert("artifacts", "artifact_id", artifact.artifact_id, artifact, {
      case_id: artifact.case_id,
      step_id: artifact.step_id
    });
  }

  listArtifacts(caseId?: string): Artifact[] {
    const rows = caseId
      ? (this.db.prepare("SELECT payload FROM artifacts WHERE case_id = ?").all(caseId) as Array<{ payload: string }>)
      : (this.db.prepare("SELECT payload FROM artifacts").all() as Array<{ payload: string }>);
    return rows.map((row) => artifactSchema.parse(JSON.parse(row.payload)));
  }

  listArtifactsForStep(caseId: string, stepId: string): Artifact[] {
    const rows = this.db
      .prepare("SELECT payload FROM artifacts WHERE case_id = ? AND step_id = ?")
      .all(caseId, stepId) as Array<{ payload: string }>;
    return rows.map((row) => artifactSchema.parse(JSON.parse(row.payload)));
  }

  addEvent(event: CaseEvent): void {
    this.upsert("events", "event_id", event.event_id, event, {
      case_id: event.case_id,
      created_at: event.created_at
    });
  }

  listEventsForCase(caseId: string): CaseEvent[] {
    const rows = this.db
      .prepare("SELECT payload FROM events WHERE case_id = ? ORDER BY created_at ASC")
      .all(caseId) as Array<{ payload: string }>;
    return rows.map((row) => caseEventSchema.parse(JSON.parse(row.payload)));
  }

  private upsert(
    table: string,
    idColumn: string,
    idValue: string,
    payload: unknown,
    extraColumns: Record<string, string> = {}
  ): void {
    const columns = [idColumn, ...Object.keys(extraColumns), "payload"];
    const placeholders = columns.map(() => "?").join(", ");
    const updates = columns.filter((column) => column !== idColumn).map((column) => `${column} = excluded.${column}`).join(", ");
    const values = [idValue, ...Object.values(extraColumns), JSON.stringify(payload)];
    this.db
      .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT(${idColumn}) DO UPDATE SET ${updates}`)
      .run(...values);
  }
}
