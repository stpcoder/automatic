import { type Expectation } from "../../../packages/contracts/src/index.js";

export interface SchedulerSignal {
  expectation_id: string;
  action: "remind" | "escalate";
}

export class SchedulerWorker {
  evaluate(expectations: Expectation[], now = new Date()): SchedulerSignal[] {
    const nowMs = now.getTime();
    return expectations.flatMap((expectation) => {
      if (expectation.status !== "waiting") {
        return [];
      }

      const signals: SchedulerSignal[] = [];
      if (nowMs >= new Date(expectation.remind_at).getTime()) {
        signals.push({ expectation_id: expectation.expectation_id, action: "remind" });
      }
      if (nowMs >= new Date(expectation.escalate_at).getTime()) {
        signals.push({ expectation_id: expectation.expectation_id, action: "escalate" });
      }
      return signals;
    });
  }
}
