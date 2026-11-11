import { describe, expect, it } from "vitest";
import { hasEndedEnrollment } from "./enrollments";

describe("hasEndedEnrollment", () => {
  it("is false while the Student's Enrollment is active", () => {
    expect(hasEndedEnrollment({ enrollmentId: 12 })).toBe(false);
  });

  it("is true once the Student's Enrollment has ended", () => {
    expect(hasEndedEnrollment({ enrollmentId: null })).toBe(true);
  });
});
