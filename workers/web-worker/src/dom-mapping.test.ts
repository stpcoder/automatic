import test from "node:test";
import assert from "node:assert/strict";

import { mapLiveDomElements, normalizeDomText, resolveSemanticKey } from "./dom-mapping.js";
import { getWebSystemDefinition } from "./system-definitions.js";

test("normalizeDomText collapses casing and whitespace", () => {
  assert.equal(normalizeDomText("  Receiver   Address "), "receiver address");
});

test("resolveSemanticKey matches configured aliases", () => {
  const definition = getWebSystemDefinition("security_portal");
  const key = resolveSemanticKey(
    {
      tagName: "input",
      label: "통관번호",
      name: "customNumber"
    },
    definition
  );

  assert.equal(key, "customs_number");
});

test("mapLiveDomElements converts live snapshots to structured observation items", () => {
  const definition = getWebSystemDefinition("dhl");
  const mapped = mapLiveDomElements(
    [
      {
        tagName: "input",
        label: "Receiver Address",
        value: "Berlin",
        required: true
      },
      {
        tagName: "button",
        text: "Submit"
      }
    ],
    definition
  );

  assert.equal(mapped[0].key, "receiver_address");
  assert.equal(mapped[0].value, "Berlin");
  assert.equal(mapped[1].type, "button");
});
