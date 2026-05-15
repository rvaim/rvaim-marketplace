import test from "node:test";
import assert from "node:assert/strict";

import { StatusPollingGate, STATUS_POLL_INTERVAL_MS } from "./status-polling-gate.mjs";

test("run_worker with no_wait forces the first status check to wait 300 seconds", () => {
  let now = 0;
  const gate = new StatusPollingGate({ now: () => now });

  assert.equal(gate.observeToolCall("run_worker", { task_id: "task-1", no_wait: true }), 0);
  assert.equal(gate.observeToolCall("get_worker_status", { task_id: "task-1" }), STATUS_POLL_INTERVAL_MS);
});

test("status polling stays locked to 300-second intervals per task", () => {
  let now = 0;
  const gate = new StatusPollingGate({ now: () => now });

  gate.observeToolCall("run_worker", { task_id: "task-1", no_wait: true });

  assert.equal(gate.observeToolCall("watch_worker", { task_id: "task-1" }), STATUS_POLL_INTERVAL_MS);

  now = STATUS_POLL_INTERVAL_MS;
  assert.equal(gate.observeToolCall("get_worker_status", { task_id: "task-1" }), STATUS_POLL_INTERVAL_MS);

  now = STATUS_POLL_INTERVAL_MS * 2;
  assert.equal(gate.observeToolCall("get_worker_status", { task_id: "task-1" }), STATUS_POLL_INTERVAL_MS);
});

test("different task ids keep independent polling gates", () => {
  let now = 0;
  const gate = new StatusPollingGate({ now: () => now });

  gate.observeToolCall("run_worker", { task_id: "task-1", no_wait: true });
  gate.observeToolCall("run_worker", { task_id: "task-2", no_wait: true });

  assert.equal(gate.observeToolCall("get_worker_status", { task_id: "task-1" }), STATUS_POLL_INTERVAL_MS);
  assert.equal(gate.observeToolCall("get_worker_status", { task_id: "task-2" }), STATUS_POLL_INTERVAL_MS);
});
