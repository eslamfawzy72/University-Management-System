import { useCallback, useEffect, useState } from "react";

import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";

function formatAssignmentRole(role) {
  if (!role) return "Teaching Assistant";

  const normalized = role.replaceAll("_", " ").trim();

  if (normalized.toLowerCase() === "ta") {
    return "Teaching Assistant";
  }

  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCourseType(type) {
  if (!type) return "Not set";
  return type.replace(/\b\w/g, (char) => char.toUpperCase());
}

function responsibilityItems(role, courseName) {
  const normalizedRole = role?.toLowerCase() ?? "ta";

  const commonItems = [
    `Support student questions and day-to-day coordination for ${courseName}.`,
    "Keep track of published coursework, due dates, and faculty requests.",
  ];

  if (normalizedRole.includes("lab")) {
    return [
      `Prepare and support lab sessions for ${courseName}.`,
      "Help students during hands-on activities and report blockers quickly.",
      ...commonItems,
    ];
  }

  if (normalizedRole.includes("grading")) {
    return [
      `Monitor grading follow-up and submission reviews for ${courseName}.`,
      "Escalate feedback or rubric issues to the course professor.",
      ...commonItems,
    ];
  }

  if (normalizedRole.includes("discussion") || normalizedRole.includes("recitation")) {
    return [
      `Lead discussion support and attendance follow-up for ${courseName}.`,
      "Surface recurring student questions before the next class meeting.",
      ...commonItems,
    ];
  }

  return [
    `Assist the teaching team for ${courseName}.`,
    "Follow up on student questions, activity support, and class coordination.",
    ...commonItems,
  ];
}

function sortAssignments(items) {
  return [...items].sort((left, right) => {
    const leftCode = left.course?.code ?? "";
    const rightCode = right.course?.code ?? "";

    return leftCode.localeCompare(rightCode) || (left.course?.name ?? "").localeCompare(right.course?.name ?? "");
  });
}

export default function TaAssignedCoursesPanel() {
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [staffRecord, setStaffRecord] = useState(null);
  const [assignments, setAssignments] = useState([]);

  const loadAssignments = useCallback(async () => {
    if (!profile?.id) {
      setStaffRecord(null);
      setAssignments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data: staffRow, error: staffError } = await supabase
      .from("staff")
      .select("id, title, department, office_hours, office_location")
      .eq("profile_id", profile.id)
      .maybeSingle();

    if (staffError) {
      setError(staffError.message);
      setStaffRecord(null);
      setAssignments([]);
      setLoading(false);
      return;
    }

    if (!staffRow) {
      setStaffRecord(null);
      setAssignments([]);
      setLoading(false);
      return;
    }

    const { data: courseStaffRows, error: courseStaffError } = await supabase
      .from("course_staff")
      .select(
        "id, role, courses(id, code, name, description, type, capacity, is_active, departments(name, code))"
      )
      .eq("staff_id", staffRow.id);

    if (courseStaffError) {
      setError(courseStaffError.message);
      setStaffRecord(staffRow);
      setAssignments([]);
      setLoading(false);
      return;
    }

    const mappedAssignments = sortAssignments(
      (courseStaffRows ?? [])
        .filter((item) => item.courses)
        .map((item) => ({
          id: item.id,
          role: item.role,
          course: item.courses,
          responsibilities: responsibilityItems(item.role, item.courses.name),
        }))
    );

    setStaffRecord(staffRow);
    setAssignments(mappedAssignments);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  const activeCourses = assignments.filter((item) => item.course.is_active).length;
  const totalResponsibilities = assignments.reduce(
    (count, item) => count + item.responsibilities.length,
    0
  );
  const summaryValue = (value) => (loading ? "--" : value);

  return (
    <>
      <div className="summary-grid">
        <article className="summary-card">
          <span>Assigned courses</span>
          <strong>{summaryValue(assignments.length)}</strong>
        </article>
        <article className="summary-card">
          <span>Active courses</span>
          <strong>{summaryValue(activeCourses)}</strong>
        </article>
        <article className="summary-card">
          <span>Tracked duties</span>
          <strong>{summaryValue(totalResponsibilities)}</strong>
        </article>
      </div>

      <article className="content-card ta-profile-card">
        <div className="ta-profile-card__header">
          <div>
            <p className="eyebrow">Teaching profile</p>
            <h2>TA assignment overview</h2>
          </div>
          <span className="chip chip-gold">TA</span>
        </div>

        {loading && <p className="text-muted ta-profile-card__message">Loading assigned courses...</p>}
        {error && <p className="error-msg ta-profile-card__message">{error}</p>}

        {!loading && !error && !assignments.length && (
          <div className="ta-empty-state">
            <p className="empty-state">No assigned courses</p>
            <p className="text-muted">
              Your TA assignments will appear here as soon as the teaching team links you to a course.
            </p>
          </div>
        )}

        {!loading && !error && assignments.length > 0 && (
          <>
            <div className="ta-meta-grid">
              <div className="ta-meta-item">
                <span>Title</span>
                <strong>{staffRecord?.title || "Teaching Assistant"}</strong>
              </div>
              <div className="ta-meta-item">
                <span>Department</span>
                <strong>{staffRecord?.department || "Not set"}</strong>
              </div>
              <div className="ta-meta-item">
                <span>Office hours</span>
                <strong>{staffRecord?.office_hours || "Not set"}</strong>
              </div>
              <div className="ta-meta-item">
                <span>Office location</span>
                <strong>{staffRecord?.office_location || "Not set"}</strong>
              </div>
            </div>

            <div className="ta-assignment-list">
              {assignments.map((assignment) => (
                <article key={assignment.id} className="ta-assignment-card">
                  <div className="ta-assignment-card__header">
                    <div className="chip-row">
                      <span className="code-badge">{assignment.course.code}</span>
                      <span className={`chip ${assignment.course.is_active ? "chip-green" : "chip-gray"}`}>
                        {assignment.course.is_active ? "Active" : "Inactive"}
                      </span>
                      <span className="chip chip-gold">{formatAssignmentRole(assignment.role)}</span>
                    </div>
                    <h3 className="ta-assignment-card__title">{assignment.course.name}</h3>
                    <p className="text-muted ta-assignment-card__subtitle">
                      {assignment.course.departments?.name || "General studies"} |{" "}
                      {formatCourseType(assignment.course.type)}
                    </p>
                  </div>

                  <div className="ta-meta-grid ta-meta-grid--compact">
                    <div className="ta-meta-item">
                      <span>Course type</span>
                      <strong>{formatCourseType(assignment.course.type)}</strong>
                    </div>
                    <div className="ta-meta-item">
                      <span>Capacity</span>
                      <strong>{assignment.course.capacity ?? "Not set"}</strong>
                    </div>
                    <div className="ta-meta-item">
                      <span>Department code</span>
                      <strong>{assignment.course.departments?.code || "N/A"}</strong>
                    </div>
                  </div>

                  <div className="ta-assignment-card__tasks">
                    <h4>Current responsibilities</h4>
                    <ul className="feature-list">
                      {assignment.responsibilities.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </article>
    </>
  );
}
