import test from "node:test";
import assert from "node:assert/strict";

import { WebWorker } from "./index.js";
import type { ClickResult, FillResult, PageObservation, PreviewResult, SubmitResult, WebAdapter } from "./types.js";

function getOutput(result: { output: unknown }) {
  return result.output as {
    harness: string;
    system_id: string;
    record_id?: string;
    summary?: string;
    observation: PageObservation;
  };
}

class StubExtensionBridgeAdapter implements WebAdapter {
  readonly harnessName = "extension_bridge";

  async openSystem(systemId: string): Promise<PageObservation> {
    return {
      sessionId: "live-session-1",
      systemId,
      pageId: "live_page",
      url: "https://example.test/live",
      title: "Live Page",
      summary: "Observed via live chrome adapter.",
      domOutline: "[search]<button key=search>Search />",
      finalActionButton: "Submit",
      interactiveElements: []
    };
  }

  async observe(systemId: string): Promise<PageObservation> {
    return this.openSystem(systemId);
  }

  async fillForm(systemId: string, values: Record<string, unknown>): Promise<FillResult> {
    return {
      draftId: "WEBDRAFT-live",
      filledFields: values,
      observation: await this.openSystem(systemId)
    };
  }

  async clickElement(systemId: string, targetKey: string): Promise<ClickResult> {
    return {
      clickId: `WEBCLICK-${targetKey}`,
      targetKey,
      observation: await this.openSystem(systemId)
    };
  }

  async previewSubmission(systemId: string): Promise<PreviewResult> {
    return {
      previewId: "PREVIEW-live",
      observation: await this.openSystem(systemId)
    };
  }

  async submit(systemId: string): Promise<SubmitResult> {
    return {
      recordId: "REC-live",
      observation: await this.openSystem(systemId)
    };
  }

  async followNavigation(systemId: string): Promise<PageObservation> {
    return this.openSystem(systemId);
  }
}

test("web worker fills, previews, and submits a form", async () => {
  const worker = new WebWorker();

  const open = await worker.execute({
    request_id: "TR-0",
    case_id: "CASE-1",
    step_id: "register_security_portal",
    tool_name: "open_system",
    mode: "preview",
    input: {
      system_id: "security_portal"
    }
  });

  assert.equal(open.success, true);
  const openOutput = getOutput(open);
  assert.equal(openOutput.harness, "page_agent_dom");
  assert.equal(openOutput.observation.finalActionButton, "등록");
  assert.ok(Array.isArray(openOutput.observation.semanticBlocks));
  assert.ok((openOutput.observation.semanticBlocks ?? []).length > 0);
  assert.equal(typeof openOutput.observation.domOutline, "string");
  assert.match(String(openOutput.observation.domOutline), /\[/);

  const fill = await worker.execute({
    request_id: "TR-1",
    case_id: "CASE-1",
    step_id: "register_security_portal",
    tool_name: "fill_web_form",
    mode: "draft",
    input: {
      system_id: "security_portal",
      field_values: {
        traveler_name: "Kim",
        destination_country: "Germany",
        customs_number: "GB-8839-22"
      }
    }
  });

  assert.equal(fill.success, true);
  const fillOutput = getOutput(fill);
  assert.equal(fillOutput.system_id, "security_portal");
  assert.equal(fillOutput.harness, "page_agent_dom");
  assert.equal(fillOutput.observation.interactiveElements[0].value, "Kim");
  assert.equal(typeof fillOutput.observation.interactiveElements[0].importance, "number");

  const preview = await worker.execute({
    request_id: "TR-2",
    case_id: "CASE-1",
    step_id: "register_security_portal",
    tool_name: "preview_web_submission",
    mode: "preview",
    input: {
      system_id: "security_portal"
    }
  });

  assert.equal(preview.success, true);
  const previewOutput = getOutput(preview);
  assert.equal(previewOutput.observation.finalActionButton, "등록");

  const submit = await worker.execute({
    request_id: "TR-3",
    case_id: "CASE-1",
    step_id: "register_security_portal",
    tool_name: "submit_web_form",
    mode: "commit",
    input: {
      system_id: "security_portal",
      expected_button: "등록"
    }
  });

  assert.equal(submit.success, true);
  const submitOutput = getOutput(submit);
  assert.ok(submitOutput.record_id);
  assert.equal(submitOutput.harness, "page_agent_dom");
});

test("web worker reports extension_bridge harness when extension adapter is injected", async () => {
  const worker = new WebWorker({
    adapter: new StubExtensionBridgeAdapter()
  });

  const open = await worker.execute({
    request_id: "TR-live-0",
    case_id: "CASE-2",
    step_id: "create_dhl_shipment",
    tool_name: "open_system",
    mode: "preview",
    input: {
      system_id: "dhl"
    }
  });

  assert.equal(open.success, true);
  const openOutput = getOutput(open);
  assert.equal(openOutput.harness, "extension_bridge");
  assert.equal(openOutput.observation.title, "Live Page");
  assert.equal(typeof openOutput.observation.domOutline, "string");
});

test("web worker can read the current page without extracting a final answer", async () => {
  const worker = new WebWorker();

  await worker.execute({
    request_id: "TR-R-0",
    case_id: "CASE-R",
    step_id: "generic_search",
    tool_name: "open_system",
    mode: "preview",
    input: {
      system_id: "web_generic",
      target_url: "https://search.example.test"
    }
  });

  const read = await worker.execute({
    request_id: "TR-R-1",
    case_id: "CASE-R",
    step_id: "generic_search",
    tool_name: "read_web_page",
    mode: "preview",
    input: {
      system_id: "web_generic"
    }
  });

  assert.equal(read.success, true);
  const readOutput = getOutput(read) as typeof getOutput extends (result: { output: unknown }) => infer R ? R : never;
  assert.equal((read.output as { artifact_kind: string }).artifact_kind, "web_read");
  assert.equal(readOutput.observation.title, "Generic Search");
  assert.equal(typeof (read.output as { dom_outline?: string }).dom_outline, "string");
});

test("web worker can click a generic search result and read detail text", async () => {
  const worker = new WebWorker();

  await worker.execute({
    request_id: "TR-N-0",
    case_id: "CASE-N",
    step_id: "generic_search",
    tool_name: "open_system",
    mode: "preview",
    input: {
      system_id: "web_generic",
      target_url: "https://search.example.test"
    }
  });

  await worker.execute({
    request_id: "TR-N-1",
    case_id: "CASE-N",
    step_id: "generic_search",
    tool_name: "fill_web_form",
    mode: "draft",
    input: {
      system_id: "web_generic",
      field_values: {
        query: "SK hynix stock price"
      }
    }
  });

  await worker.execute({
    request_id: "TR-N-2",
    case_id: "CASE-N",
    step_id: "generic_search",
    tool_name: "click_web_element",
    mode: "preview",
    input: {
      system_id: "web_generic",
      target_key: "search_action"
    }
  });

  const clickResult = await worker.execute({
    request_id: "TR-N-3a",
    case_id: "CASE-N",
    step_id: "generic_search",
    tool_name: "click_web_element",
    mode: "preview",
    input: {
      system_id: "web_generic",
      target_key: "result_1"
    }
  });

  assert.equal(clickResult.success, true);

  const detailRead = await worker.execute({
    request_id: "TR-N-3",
    case_id: "CASE-N",
    step_id: "generic_search",
    tool_name: "read_web_page",
    mode: "preview",
    input: {
      system_id: "web_generic"
    }
  });

  assert.equal(detailRead.success, true);
  const readOutput = getOutput(detailRead);
  assert.match(String(readOutput.summary), /SK hynix/i);
  assert.match(String(readOutput.observation.pageText), /210,000 KRW/i);
});

test("web worker can follow navigation and preserve session metadata", async () => {
  const worker = new WebWorker({
    adapter: new StubExtensionBridgeAdapter()
  });

  const follow = await worker.execute({
    request_id: "TR-live-follow",
    case_id: "CASE-3",
      step_id: "follow",
      tool_name: "follow_web_navigation",
      mode: "preview",
      input: {
        system_id: "web_generic",
        session_id: "live-session-1"
      }
    });

  assert.equal(follow.success, true);
  const output = getOutput(follow);
  assert.equal(output.harness, "extension_bridge");
  assert.equal(output.observation.sessionId, "live-session-1");
});
