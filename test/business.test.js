import assert from "assert/strict";
import test from "node:test";
import { canMoveStatus, canRequestService } from "../lib/business.js";

test("allows only the FixMate status transitions", () => {
  assert.equal(canMoveStatus("requested", "accepted"), true);
  assert.equal(canMoveStatus("requested", "rejected"), true);
  assert.equal(canMoveStatus("accepted", "in-progress"), true);
  assert.equal(canMoveStatus("in-progress", "completed"), true);
  assert.equal(canMoveStatus("requested", "completed"), false);
  assert.equal(canMoveStatus("completed", "paid"), false);
  assert.equal(canMoveStatus("cancelled", "accepted"), false);
});

test("prevents a technician from requesting their own service", () => {
  assert.equal(canRequestService("tech@example.com", "tech@example.com"), false);
  assert.equal(canRequestService("customer@example.com", "tech@example.com"), true);
});
