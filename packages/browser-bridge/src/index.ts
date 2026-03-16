import { z } from "zod";

import { observationSchema } from "../../contracts/src/index.js";

export const bridgeCommandSchema = z.object({
  command_id: z.string(),
  system_id: z.string(),
  type: z.enum(["fill", "submit", "click"]),
  payload: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(["pending", "completed", "failed"]).default("pending"),
  created_at: z.string(),
  completed_at: z.string().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional()
});
export type BridgeCommand = z.infer<typeof bridgeCommandSchema>;

export const bridgeSessionSchema = z.object({
  session_id: z.string(),
  system_id: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string()
});
export type BridgeSession = z.infer<typeof bridgeSessionSchema>;

interface BridgeSessionState {
  session: BridgeSession;
  latestObservation?: z.infer<typeof observationSchema>;
  commands: BridgeCommand[];
}

export class BrowserBridgeCoordinator {
  private readonly sessions = new Map<string, BridgeSessionState>();

  reset(): void {
    this.sessions.clear();
  }

  registerSession(input: { session_id: string; system_id: string; title?: string; url?: string }): BridgeSession {
    const now = new Date().toISOString();
    const existing = this.sessions.get(input.session_id);
    const session = bridgeSessionSchema.parse({
      session_id: input.session_id,
      system_id: input.system_id,
      title: input.title,
      url: input.url,
      created_at: existing?.session.created_at ?? now,
      updated_at: now
    });
    this.sessions.set(input.session_id, {
      session,
      latestObservation: existing?.latestObservation,
      commands: existing?.commands ?? []
    });
    return session;
  }

  updateObservation(sessionId: string, observation: unknown): z.infer<typeof observationSchema> {
    const state = this.requireSession(sessionId);
    const parsed = observationSchema.parse(observation);
    state.latestObservation = parsed;
    state.session = {
      ...state.session,
      updated_at: new Date().toISOString(),
      title: typeof parsed.payload.title === "string" ? parsed.payload.title : state.session.title,
      url: typeof parsed.payload.url === "string" ? parsed.payload.url : state.session.url
    };
    this.sessions.set(sessionId, state);
    return parsed;
  }

  listSessions(): Array<BridgeSession & { has_observation: boolean }> {
    return [...this.sessions.values()].map(({ session, latestObservation }) => ({
      ...session,
      has_observation: Boolean(latestObservation)
    }));
  }

  getLatestObservation(systemId: string): z.infer<typeof observationSchema> | undefined {
    const candidates = [...this.sessions.values()]
      .filter((session) => session.session.system_id === systemId && session.latestObservation)
      .sort((left, right) => right.session.updated_at.localeCompare(left.session.updated_at));
    return candidates[0]?.latestObservation;
  }

  enqueueCommand(systemId: string, type: BridgeCommand["type"], payload: Record<string, unknown>): BridgeCommand {
    const state = this.findLatestSessionState(systemId)!;
    const command = bridgeCommandSchema.parse({
      command_id: `BC-${crypto.randomUUID()}`,
      system_id: systemId,
      type,
      payload,
      status: "pending",
      created_at: new Date().toISOString()
    });
    state.commands.push(command);
    this.sessions.set(state.session.session_id, state);
    return command;
  }

  pullPendingCommands(sessionId: string): BridgeCommand[] {
    const state = this.requireSession(sessionId);
    return state.commands.filter((command) => command.status === "pending");
  }

  completeCommand(sessionId: string, commandId: string, input: { success: boolean; result?: Record<string, unknown>; error?: string }): BridgeCommand {
    const state = this.requireSession(sessionId);
    const index = state.commands.findIndex((command) => command.command_id === commandId);
    if (index === -1) {
      throw new Error(`Command ${commandId} not found for session ${sessionId}`);
    }
    const updated = bridgeCommandSchema.parse({
      ...state.commands[index],
      status: input.success ? "completed" : "failed",
      completed_at: new Date().toISOString(),
      result: input.result,
      error: input.error
    });
    state.commands[index] = updated;
    this.sessions.set(sessionId, state);
    return updated;
  }

  getCommand(systemId: string, commandId: string): BridgeCommand | undefined {
    const state = this.findLatestSessionState(systemId, false);
    return state?.commands.find((command) => command.command_id === commandId);
  }

  async waitForObservation(systemId: string, timeoutMs = 15_000): Promise<z.infer<typeof observationSchema>> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const observation = this.getLatestObservation(systemId);
      if (observation) {
        return observation;
      }
      await sleep(150);
    }
    throw new Error(`Timed out waiting for bridge observation for system ${systemId}`);
  }

  async waitForCommandResult(systemId: string, commandId: string, timeoutMs = 15_000): Promise<BridgeCommand> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const command = this.getCommand(systemId, commandId);
      if (command && command.status !== "pending") {
        return command;
      }
      await sleep(150);
    }
    throw new Error(`Timed out waiting for command result ${commandId} on system ${systemId}`);
  }

  private requireSession(sessionId: string): BridgeSessionState {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Bridge session ${sessionId} not found`);
    }
    return state;
  }

  private findLatestSessionState(systemId: string, required = true): BridgeSessionState | undefined {
    const latest = [...this.sessions.values()]
      .filter((session) => session.session.system_id === systemId)
      .sort((left, right) => right.session.updated_at.localeCompare(left.session.updated_at))[0];
    if (!latest && required) {
      throw new Error(`No bridge session registered for system ${systemId}`);
    }
    return latest;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const browserBridgeCoordinator = new BrowserBridgeCoordinator();
