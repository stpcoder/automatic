import { z } from "zod";

import { observationSchema } from "../../contracts/src/index.js";

export const bridgeCommandSchema = z.object({
  command_id: z.string(),
  system_id: z.string(),
  type: z.enum(["fill", "submit", "click", "scroll"]),
  payload: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(["pending", "completed", "failed"]).default("pending"),
  created_at: z.string(),
  completed_at: z.string().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional()
});
export type BridgeCommand = z.infer<typeof bridgeCommandSchema>;

export const bridgeBrowserTaskSchema = z.object({
  task_id: z.string(),
  type: z.enum(["open_tab"]),
  payload: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(["pending", "completed", "failed"]).default("pending"),
  created_at: z.string(),
  completed_at: z.string().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional()
});
export type BridgeBrowserTask = z.infer<typeof bridgeBrowserTaskSchema>;

export const bridgeSessionSchema = z.object({
  session_id: z.string(),
  parent_session_id: z.string().optional(),
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

interface SessionSelector {
  sessionId?: string;
  systemId?: string;
  urlContains?: string;
  titleContains?: string;
}

export class BrowserBridgeCoordinator {
  private readonly sessions = new Map<string, BridgeSessionState>();
  private readonly browserTasks: BridgeBrowserTask[] = [];
  private readonly observationTimeoutMs = Number(process.env.BRIDGE_OBSERVATION_TIMEOUT_MS ?? "30000");
  private readonly commandTimeoutMs = Number(process.env.BRIDGE_COMMAND_TIMEOUT_MS ?? "30000");
  private readonly sessionFreshnessMs = Number(process.env.BRIDGE_SESSION_FRESHNESS_MS ?? "10000");

  reset(): void {
    this.sessions.clear();
    this.browserTasks.length = 0;
  }

  registerSession(input: {
    session_id: string;
    parent_session_id?: string;
    system_id: string;
    title?: string;
    url?: string;
  }): BridgeSession {
    const now = new Date().toISOString();
    const existing = this.sessions.get(input.session_id);
    const session = bridgeSessionSchema.parse({
      session_id: input.session_id,
      parent_session_id: input.parent_session_id,
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

  listSessions(): Array<BridgeSession & { has_observation: boolean; is_stale: boolean }> {
    return [...this.sessions.values()].map(({ session, latestObservation }) => ({
      ...session,
      has_observation: Boolean(latestObservation),
      is_stale: this.isStale(session)
    }));
  }

  listBrowserTasks(): BridgeBrowserTask[] {
    return [...this.browserTasks];
  }

  getLatestObservation(systemId: string, preferredSessionId?: string): z.infer<typeof observationSchema> | undefined {
    if (preferredSessionId) {
      const preferred = this.sessions.get(preferredSessionId);
      if (preferred && !this.isStale(preferred.session)) {
        return preferred.latestObservation;
      }
      return undefined;
    }
    const candidates = [...this.sessions.values()]
      .filter((session) => session.session.system_id === systemId && session.latestObservation && !this.isStale(session.session))
      .sort((left, right) => right.session.updated_at.localeCompare(left.session.updated_at));
    return candidates[0]?.latestObservation;
  }

  getObservationBySelector(selector: SessionSelector): z.infer<typeof observationSchema> | undefined {
    const session = this.findSessionBySelector(selector, false);
    return session?.latestObservation;
  }

  enqueueCommand(
    systemId: string,
    type: BridgeCommand["type"],
    payload: Record<string, unknown>,
    preferredSessionId?: string
  ): BridgeCommand {
    const state = preferredSessionId ? this.requireSession(preferredSessionId) : this.findLatestSessionState(systemId)!;
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

  enqueueOpenTab(url: string): BridgeBrowserTask {
    const task = bridgeBrowserTaskSchema.parse({
      task_id: `BT-${crypto.randomUUID()}`,
      type: "open_tab",
      payload: {
        url
      },
      status: "pending",
      created_at: new Date().toISOString()
    });
    this.browserTasks.push(task);
    return task;
  }

  pullPendingBrowserTasks(): BridgeBrowserTask[] {
    return this.browserTasks.filter((task) => task.status === "pending");
  }

  completeBrowserTask(taskId: string, input: { success: boolean; result?: Record<string, unknown>; error?: string }): BridgeBrowserTask {
    const index = this.browserTasks.findIndex((task) => task.task_id === taskId);
    if (index === -1) {
      throw new Error(`Browser task ${taskId} not found`);
    }
    const updated = bridgeBrowserTaskSchema.parse({
      ...this.browserTasks[index],
      status: input.success ? "completed" : "failed",
      completed_at: new Date().toISOString(),
      result: input.result,
      error: input.error
    });
    this.browserTasks[index] = updated;
    return updated;
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

  getCommand(systemId: string, commandId: string, preferredSessionId?: string): BridgeCommand | undefined {
    const state = preferredSessionId
      ? this.getFreshSessionState(preferredSessionId)
      : this.findLatestSessionState(systemId, false);
    return state?.commands.find((command) => command.command_id === commandId);
  }

  async waitForObservation(
    systemId: string,
    timeoutMs = this.observationTimeoutMs,
    preferredSessionId?: string
  ): Promise<z.infer<typeof observationSchema>> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const observation = this.getLatestObservation(systemId, preferredSessionId);
      if (observation) {
        return observation;
      }
      await sleep(150);
    }
    throw new Error(`Timed out waiting for bridge observation for system ${systemId}`);
  }

  async waitForObservationBySelector(
    selector: SessionSelector,
    timeoutMs = this.observationTimeoutMs
  ): Promise<z.infer<typeof observationSchema>> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const observation = this.getObservationBySelector(selector);
      if (observation) {
        return observation;
      }
      await sleep(150);
    }

    throw new Error(
      `Timed out waiting for bridge observation for selector session=${selector.sessionId ?? "-"} system=${selector.systemId ?? "-"} url=${selector.urlContains ?? "-"} title=${selector.titleContains ?? "-"}`
    );
  }

  async waitForCommandResult(
    systemId: string,
    commandId: string,
    timeoutMs = this.commandTimeoutMs,
    preferredSessionId?: string
  ): Promise<BridgeCommand> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const command = this.getCommand(systemId, commandId, preferredSessionId);
      if (command && command.status !== "pending") {
        return command;
      }
      await sleep(150);
    }
    throw new Error(`Timed out waiting for command result ${commandId} on system ${systemId}`);
  }

  async waitForNavigation(
    sessionId: string,
    timeoutMs = this.observationTimeoutMs
  ): Promise<{ session: BridgeSession; observation: z.infer<typeof observationSchema> }> {
    const baseline = this.requireSession(sessionId);
    const baselineUpdatedAt = baseline.session.updated_at;
    const baselineUrl = baseline.session.url ?? "";
    const baselineSystemId = baseline.session.system_id;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const current = this.sessions.get(sessionId);
      if (current?.latestObservation) {
        const navigationChanged =
          current.session.updated_at > baselineUpdatedAt &&
          (current.session.url !== baselineUrl || current.session.system_id !== baselineSystemId);
        if (navigationChanged) {
          return {
            session: current.session,
            observation: current.latestObservation
          };
        }
      }

      const child = [...this.sessions.values()]
        .filter((candidate) => candidate.session.parent_session_id === sessionId && candidate.latestObservation)
        .sort((left, right) => right.session.updated_at.localeCompare(left.session.updated_at))[0];
      if (child && child.session.updated_at > baselineUpdatedAt) {
        return {
          session: child.session,
          observation: child.latestObservation!
        };
      }

      await sleep(150);
    }

    throw new Error(`Timed out waiting for navigation follow from session ${sessionId}`);
  }

  private requireSession(sessionId: string): BridgeSessionState {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Bridge session ${sessionId} not found`);
    }
    return state;
  }

  private getFreshSessionState(sessionId: string): BridgeSessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return undefined;
    }
    return this.isStale(state.session) ? undefined : state;
  }

  private findLatestSessionState(systemId: string, required = true): BridgeSessionState | undefined {
    const latest = [...this.sessions.values()]
      .filter((session) => session.session.system_id === systemId && !this.isStale(session.session))
      .sort((left, right) => right.session.updated_at.localeCompare(left.session.updated_at))[0];
    if (!latest && required) {
      throw new Error(`No fresh bridge session registered for system ${systemId}`);
    }
    return latest;
  }

  private findSessionBySelector(selector: SessionSelector, required = true): BridgeSessionState | undefined {
    if (selector.sessionId) {
      const direct = this.getFreshSessionState(selector.sessionId);
      if (direct) {
        return direct;
      }
      if (required) {
        throw new Error(`No fresh bridge session registered for session ${selector.sessionId}`);
      }
      return undefined;
    }

    const normalizedUrlContains = selector.urlContains?.trim().toLowerCase();
    const normalizedTitleContains = selector.titleContains?.trim().toLowerCase();
    const candidates = [...this.sessions.values()]
      .filter((state) => !this.isStale(state.session))
      .filter((state) => !selector.systemId || state.session.system_id === selector.systemId)
      .filter((state) => !normalizedUrlContains || String(state.session.url ?? "").toLowerCase().includes(normalizedUrlContains))
      .filter((state) => !normalizedTitleContains || String(state.session.title ?? "").toLowerCase().includes(normalizedTitleContains))
      .sort((left, right) => right.session.updated_at.localeCompare(left.session.updated_at));

    const match = candidates[0];
    if (!match && required) {
      throw new Error(
        `No fresh bridge session matched selector system=${selector.systemId ?? "-"} url=${selector.urlContains ?? "-"} title=${selector.titleContains ?? "-"}`
      );
    }
    return match;
  }

  private isStale(session: BridgeSession): boolean {
    const updatedAtMs = Date.parse(session.updated_at);
    if (Number.isNaN(updatedAtMs)) {
      return true;
    }
    return Date.now() - updatedAtMs > this.sessionFreshnessMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const browserBridgeCoordinator = new BrowserBridgeCoordinator();

export function pullPendingExtensionBrowserTasks(): BridgeBrowserTask[] {
  return browserBridgeCoordinator.pullPendingBrowserTasks();
}

export function completeExtensionBrowserTask(
  taskId: string,
  input: { success: boolean; result?: Record<string, unknown>; error?: string }
): BridgeBrowserTask {
  return browserBridgeCoordinator.completeBrowserTask(taskId, input);
}
