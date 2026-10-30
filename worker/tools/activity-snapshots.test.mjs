import assert from "node:assert/strict";
import test from "node:test";
import { activitySnapshotPair } from "../src/activity-snapshots.ts";

test("captures safe before and after values for operational edits", () => {
  assert.deepEqual(activitySnapshotPair(
    { status: "open", priority: "low", assigned_to_user_id: null },
    [{ field: "status", value: "in_progress" }, { field: "priority", value: "high" }, { field: "assigned_to_user_id", value: "employee-1" }],
  ), {
    before: { status: "open", priority: "low", assigned_to_user_id: null },
    after: { status: "in_progress", priority: "high", assigned_to_user_id: "employee-1" },
  });
});

test("omits address, phone, and free-text fields", () => {
  assert.deepEqual(activitySnapshotPair(
    { address: "private", phone: "555", status: "pending" },
    [{ field: "address", value: "new private" }, { field: "phone", value: "999" }, { field: "status", value: "approved" }],
  ), { before: { status: "pending" }, after: { status: "approved" } });
});

test("returns no snapshots when an edit has no allowlisted fields", () => {
  assert.deepEqual(activitySnapshotPair({}, [{ field: "notes", value: "sensitive free text" }]), {});
});
