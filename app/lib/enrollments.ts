/** A Student on the roster whose Enrollment has ended. */
export function hasEndedEnrollment(student: {
  enrollmentId: number | null;
}): boolean {
  return student.enrollmentId === null;
}
