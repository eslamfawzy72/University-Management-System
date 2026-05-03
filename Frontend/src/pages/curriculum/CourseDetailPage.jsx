import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AppShell from "../../components/layout/AppShell";
import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useRole } from "../../hooks/useRole";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";

function fileIcon(type) {
  if (!type) return "📄";
  if (type.includes("pdf")) return "📑";
  if (type.includes("image")) return "🖼️";
  if (type.includes("video")) return "🎬";
  if (type.includes("presentation") || type.includes("powerpoint")) return "📊";
  if (type.includes("word") || type.includes("document")) return "📝";
  return "📄";
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isPastDue(due) {
  return due && new Date(due) < new Date();
}

const EMPTY_ASSIGNMENT = { title: "", type: "assignment", due_date: "", is_published: false };

export default function CourseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { is } = useRole();
  const { profile } = useAuth();
  const isStudent = is("student");
  const isAdmin = is("admin");

  const [course, setCourse] = useState(null);
  const [enrollmentStatus, setEnrollmentStatus] = useState(null); // student's own status
  const [enrollmentRequests, setEnrollmentRequests] = useState([]); // for professor view
  const [materials, setMaterials] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [courseStaff, setCourseStaff] = useState([]); // [{ role, staff: { id, profile_id, full_name } }]
  const [myAssignedRole, setMyAssignedRole] = useState(null); // "professor" | "ta" | null
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [matsError, setMatsError] = useState(null);

  const canManage = isAdmin || myAssignedRole === "professor" || myAssignedRole === "ta";
  const canApproveEnrollment = isAdmin || myAssignedRole === "professor";

  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileRef = useRef(null);

  const [assignModal, setAssignModal] = useState(false);
  const [assignForm, setAssignForm] = useState(EMPTY_ASSIGNMENT);
  const [assignSaving, setAssignSaving] = useState(false);

  // Submissions: { [assignmentId]: { id, content, submitted_at } } — student's own
  const [mySubmissions, setMySubmissions] = useState({});
  // Grades visible to current student: { [assignmentId]: { score, max_score, feedback } }
  const [myGrades, setMyGrades] = useState({});
  // Submit modal state
  const [submitModal, setSubmitModal] = useState(null); // assignment object
  const [submitContent, setSubmitContent] = useState("");
  const [submitSaving, setSubmitSaving] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [myStudentId, setMyStudentId] = useState(null);

  const loadCourse = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("courses")
      .select("*, departments(name)")
      .eq("id", id)
      .single();
    if (err) setError(err.message);
    else setCourse(data);
  }, [id]);

  const loadCourseStaff = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("course_staff")
      .select("id, role, staff:staff_id(id, profile_id, profiles(full_name, email))")
      .eq("course_id", id);
    if (err) return;
    const rows = (data || [])
      .filter((r) => r.staff)
      .map((r) => ({
        id: r.id,
        role: r.role,
        staffId: r.staff.id,
        profileId: r.staff.profile_id,
        fullName: r.staff.profiles?.full_name ?? null,
        email: r.staff.profiles?.email ?? null,
      }));
    setCourseStaff(rows);

    if (profile?.id) {
      const mine = rows.find((r) => r.profileId === profile.id);
      setMyAssignedRole(mine ? mine.role : null);
    } else {
      setMyAssignedRole(null);
    }
  }, [id, profile?.id]);

  const loadStudentAccess = useCallback(async () => {
    if (!isStudent || !profile?.id) return;
    const { data: studentRec } = await supabase
      .from("students")
      .select("id")
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (!studentRec) return;
    setMyStudentId(studentRec.id);

    const { data: enrollment } = await supabase
      .from("course_enrollments")
      .select("status")
      .eq("course_id", id)
      .eq("student_id", studentRec.id)
      .maybeSingle();
    setEnrollmentStatus(enrollment?.status ?? null);

    // Load my submissions + grades for this course's assignments
    const { data: courseAssignments } = await supabase
      .from("assignments")
      .select("id")
      .eq("course_id", id);
    const assignmentIds = (courseAssignments || []).map((a) => a.id);
    if (assignmentIds.length === 0) return;

    const [{ data: subs }, { data: grades }] = await Promise.all([
      supabase
        .from("assignment_submissions")
        .select("id, assignment_id, content, submitted_at")
        .eq("student_id", studentRec.id)
        .in("assignment_id", assignmentIds),
      supabase
        .from("assignment_grades")
        .select("assignment_id, score, max_score, feedback")
        .eq("student_id", studentRec.id)
        .in("assignment_id", assignmentIds),
    ]);

    const subMap = {};
    (subs || []).forEach((s) => { subMap[s.assignment_id] = s; });
    setMySubmissions(subMap);

    const gradeMap = {};
    (grades || []).forEach((g) => { gradeMap[g.assignment_id] = g; });
    setMyGrades(gradeMap);
  }, [id, isStudent, profile?.id]);

  const loadRequests = useCallback(async () => {
    if (isStudent) return;
    const { data } = await supabase
      .from("course_enrollments")
      .select("id, status, enrolled_at, students(id, profile_id, profiles(full_name, email))")
      .eq("course_id", id)
      .order("enrolled_at", { ascending: true });
    setEnrollmentRequests(data || []);
  }, [id, isStudent]);

  const loadMaterials = useCallback(async () => {
    setMatsError(null);
    const { data, error: err } = await supabase
      .from("materials")
      .select("*, profiles(full_name)")
      .eq("course_id", id)
      .order("created_at", { ascending: false });
    if (err) setMatsError(err.message);
    else setMaterials(data || []);
  }, [id]);

  const loadAssignments = useCallback(async () => {
    const { data } = await supabase
      .from("assignments")
      .select("*")
      .eq("course_id", id)
      .order("due_date", { ascending: true });
    setAssignments(data || []);
  }, [id]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([
        loadCourse(),
        loadCourseStaff(),
        loadStudentAccess(),
        loadRequests(),
        loadMaterials(),
        loadAssignments(),
      ]);
      setLoading(false);
    }
    init();
  }, [loadCourse, loadCourseStaff, loadStudentAccess, loadRequests, loadMaterials, loadAssignments]);

  async function handleApprove(enrollmentId) {
    // Capacity guard — refuse to push enrollment past the course capacity.
    // Re-query live so we don't rely on stale UI state. Skipped when capacity is null (unlimited).
    if (course?.capacity != null) {
      const { count, error: countErr } = await supabase
        .from("course_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("course_id", id)
        .eq("status", "enrolled");
      if (countErr) { alert("Could not verify capacity: " + countErr.message); return; }
      if ((count ?? 0) >= course.capacity) {
        alert(
          `Cannot approve — the course is at full capacity (${count}/${course.capacity}). ` +
          `Revoke an existing enrollment first, or increase the course capacity.`
        );
        loadRequests();
        return;
      }
    }

    const { data, error: err } = await supabase
      .from("course_enrollments")
      .update({ status: "enrolled" })
      .eq("id", enrollmentId)
      .select();
    if (err) { alert("Approve failed: " + err.message); return; }
    if (!data || data.length === 0) {
      alert("Approve was blocked by row-level security. You may not be the assigned professor for this course.");
      return;
    }
    loadRequests();
  }

  async function handleReject(enrollmentId) {
    const { data, error: err } = await supabase
      .from("course_enrollments")
      .update({ status: "rejected" })
      .eq("id", enrollmentId)
      .select();
    if (err) { alert("Reject failed: " + err.message); return; }
    if (!data || data.length === 0) {
      alert("Reject was blocked by row-level security. You may not be the assigned professor for this course.");
      return;
    }
    loadRequests();
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);

    const filePath = `${id}/${Date.now()}-${uploadFile.name}`;
    const { data: stored, error: storeErr } = await supabase.storage
      .from("course-materials")
      .upload(filePath, uploadFile);

    if (storeErr) { setUploadError(storeErr.message); setUploading(false); return; }

    const { data: { publicUrl } } = supabase.storage
      .from("course-materials")
      .getPublicUrl(stored.path);

    const { error: insertErr } = await supabase.from("materials").insert({
      course_id: id,
      uploaded_by: profile.id,
      title: uploadTitle.trim() || uploadFile.name,
      file_url: publicUrl,
      file_type: uploadFile.type,
      created_at: new Date().toISOString(),
    });

    setUploading(false);
    if (insertErr) { setUploadError(insertErr.message); return; }
    setUploadTitle("");
    setUploadFile(null);
    if (fileRef.current) fileRef.current.value = "";
    loadMaterials();
  }

  async function handleRemoveMaterial(material) {
    const pathMatch = material.file_url.split("/course-materials/");
    if (pathMatch[1]) {
      await supabase.storage.from("course-materials").remove([decodeURIComponent(pathMatch[1])]);
    }
    await supabase.from("materials").delete().eq("id", material.id);
    loadMaterials();
  }

  async function handleCreateAssignment(e) {
    e.preventDefault();
    setAssignSaving(true);
    const { error: err } = await supabase.from("assignments").insert({
      ...assignForm,
      course_id: id,
      created_by: profile.id,
      due_date: assignForm.due_date || null,
    });
    setAssignSaving(false);
    if (err) { alert(err.message); return; }
    setAssignModal(false);
    setAssignForm(EMPTY_ASSIGNMENT);
    loadAssignments();
  }

  async function togglePublish(assignment) {
    await supabase.from("assignments")
      .update({ is_published: !assignment.is_published })
      .eq("id", assignment.id);
    loadAssignments();
  }

  async function deleteAssignment(assignId) {
    if (!window.confirm("Delete this assignment?")) return;
    await supabase.from("assignments").delete().eq("id", assignId);
    loadAssignments();
  }

  function openSubmit(assignment) {
    if (isPastDue(assignment.due_date)) return;
    setSubmitModal(assignment);
    setSubmitContent(mySubmissions[assignment.id]?.content ?? "");
    setSubmitError(null);
  }

  async function handleSubmitAssignment(e) {
    e.preventDefault();
    if (!submitModal || !myStudentId) return;
    if (isPastDue(submitModal.due_date)) {
      setSubmitError("This assignment is closed — the deadline has passed.");
      return;
    }
    setSubmitSaving(true);
    setSubmitError(null);

    const existing = mySubmissions[submitModal.id];
    let err;
    if (existing) {
      ({ error: err } = await supabase
        .from("assignment_submissions")
        .update({ content: submitContent, submitted_at: new Date().toISOString() })
        .eq("id", existing.id));
    } else {
      ({ error: err } = await supabase.from("assignment_submissions").insert({
        assignment_id: submitModal.id,
        student_id: myStudentId,
        content: submitContent,
      }));
    }
    setSubmitSaving(false);
    if (err) { setSubmitError(err.message); return; }
    setSubmitModal(null);
    setSubmitContent("");
    loadStudentAccess();
  }

  // ── Loading & error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <AppShell title="Loading…" subtitle="">
        <p className="text-muted">Loading course…</p>
      </AppShell>
    );
  }

  if (error || !course) {
    return (
      <AppShell title="Error" subtitle="">
        <p className="error-msg">{error || "Course not found."}</p>
        <BtnGhost onClick={() => navigate("/curriculum/courses")} style={{ marginTop: 16 }}>
          ← Back to Courses
        </BtnGhost>
      </AppShell>
    );
  }

  // ── Student access gate ───────────────────────────────────────────────────

  if (isStudent && enrollmentStatus !== "enrolled") {
    return (
      <AppShell title={course.name} subtitle={course.departments?.name || ""}>
        <div className="dashboard-stack">
          <div className="course-detail-header">
            <BtnGhost className="btn-xs" onClick={() => navigate("/curriculum/courses")}>
              ← Courses
            </BtnGhost>
            <div className="course-detail-meta">
              <span className="code-badge">{course.code}</span>
              <span className={course.type === "core" ? "chip chip-blue" : "chip chip-gold"}>
                {course.type === "core" ? "Core" : "Elective"}
              </span>
            </div>
          </div>

          <div className="enrollment-gate">
            {enrollmentStatus === "pending" ? (
              <>
                <div className="enrollment-gate__icon">⏳</div>
                <h3 className="enrollment-gate__title">Awaiting Professor Approval</h3>
                <p className="enrollment-gate__msg">
                  Your enrollment request has been submitted. You'll be able to access course materials and assignments once the professor approves your request.
                </p>
                <span className="chip chip-gold">Pending Approval</span>
              </>
            ) : enrollmentStatus === "rejected" ? (
              <>
                <div className="enrollment-gate__icon">❌</div>
                <h3 className="enrollment-gate__title">Enrollment Rejected</h3>
                <p className="enrollment-gate__msg">
                  Your enrollment request was not approved. Please contact your professor for more information.
                </p>
                <span className="chip chip-red">Rejected</span>
              </>
            ) : (
              <>
                <div className="enrollment-gate__icon">🔒</div>
                <h3 className="enrollment-gate__title">Enrollment Required</h3>
                <p className="enrollment-gate__msg">
                  You need to request enrollment in this course before accessing its content.
                </p>
                <BtnGhost onClick={() => navigate("/curriculum/courses")}>
                  Go to Courses to Enroll
                </BtnGhost>
              </>
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  // ── Full course content (enrolled students + professors/admins) ───────────

  const pending = enrollmentRequests.filter((r) => r.status === "pending");
  const enrolledRequests = enrollmentRequests.filter((r) => r.status === "enrolled");

  return (
    <AppShell title={course.name} subtitle={course.departments?.name || ""}>
      <div className="dashboard-stack">

        {/* Course header */}
        <div className="course-detail-header">
          <BtnGhost className="btn-xs" onClick={() => navigate("/curriculum/courses")}>
            ← Courses
          </BtnGhost>
          <div className="course-detail-meta">
            <span className="code-badge">{course.code}</span>
            <span className={course.type === "core" ? "chip chip-blue" : "chip chip-gold"}>
              {course.type === "core" ? "Core" : "Elective"}
            </span>
            {course.capacity && <span className="text-muted">{course.capacity} seats</span>}
          </div>
          {course.description && <p className="course-detail-desc">{course.description}</p>}

          {courseStaff.length > 0 && (
            <div className="course-detail-staff">
              {courseStaff.some((r) => r.role === "professor") && (
                <div className="course-detail-staff__row">
                  <span className="course-detail-staff__label">Professor</span>
                  <span className="course-detail-staff__value">
                    {courseStaff
                      .filter((r) => r.role === "professor")
                      .map((r) => r.fullName || "—")
                      .join(", ")}
                  </span>
                </div>
              )}
              {courseStaff.some((r) => r.role === "ta") && (
                <div className="course-detail-staff__row">
                  <span className="course-detail-staff__label">
                    TA{courseStaff.filter((r) => r.role === "ta").length > 1 ? "s" : ""}
                  </span>
                  <span className="course-detail-staff__value">
                    {courseStaff
                      .filter((r) => r.role === "ta")
                      .map((r) => r.fullName || "—")
                      .join(", ")}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Enrollment Requests — assigned professor or admin */}
        {!isStudent && (
          <div className="content-card">
            <div className="section-header">
              <h2>Enrollment Requests</h2>
              <div style={{ display: "flex", gap: 8 }}>
                {pending.length > 0 && (
                  <span className="chip chip-gold">{pending.length} pending</span>
                )}
                <span className="chip chip-green">{enrolledRequests.length} enrolled</span>
              </div>
            </div>

            {enrollmentRequests.length === 0 ? (
              <p className="empty-state">No enrollment requests yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Email</th>
                      <th>Requested</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollmentRequests.map((r) => {
                      const studentProfile = r.students?.profiles;
                      return (
                        <tr key={r.id}>
                          <td className="col-name">{studentProfile?.full_name ?? "—"}</td>
                          <td className="text-muted">{studentProfile?.email ?? "—"}</td>
                          <td>{formatDate(r.enrolled_at)}</td>
                          <td>
                            {r.status === "pending" && <span className="chip chip-gold">Pending</span>}
                            {r.status === "enrolled" && <span className="chip chip-green">Enrolled</span>}
                            {r.status === "rejected" && <span className="chip chip-red">Rejected</span>}
                          </td>
                          <td className="actions-cell">
                            {canApproveEnrollment ? (
                              <>
                                {r.status === "pending" && (
                                  <>
                                    <BtnPrimary className="btn-xs" onClick={() => handleApprove(r.id)}>
                                      Approve
                                    </BtnPrimary>
                                    <BtnGhost className="btn-xs btn-ghost-danger" onClick={() => handleReject(r.id)}>
                                      Reject
                                    </BtnGhost>
                                  </>
                                )}
                                {r.status === "enrolled" && (
                                  <BtnGhost className="btn-xs btn-ghost-danger" onClick={() => handleReject(r.id)}>
                                    Revoke
                                  </BtnGhost>
                                )}
                                {r.status === "rejected" && (
                                  <BtnGhost className="btn-xs" onClick={() => handleApprove(r.id)}>
                                    Re-approve
                                  </BtnGhost>
                                )}
                              </>
                            ) : (
                              <span className="text-muted" style={{ fontSize: 12 }}>View only</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Materials */}
        <div className="content-card">
          <div className="section-header">
            <h2>Materials</h2>
            <span className="section-count">{materials.length} file{materials.length !== 1 ? "s" : ""}</span>
          </div>

          {canManage && (
            <form className="upload-form" onSubmit={handleUpload}>
              {uploadError && <p className="error-msg">{uploadError}</p>}
              <div className="form-row-2">
                <div className="field">
                  <span>Title</span>
                  <input
                    placeholder="e.g. Week 1 Lecture Slides"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                  />
                </div>
                <div className="field">
                  <span>File</span>
                  <input
                    ref={fileRef}
                    type="file"
                    required
                    className="file-input"
                    onChange={(e) => setUploadFile(e.target.files[0] || null)}
                  />
                </div>
              </div>
              <div>
                <BtnPrimary type="submit" disabled={uploading || !uploadFile}>
                  {uploading ? "Uploading…" : "Upload"}
                </BtnPrimary>
              </div>
            </form>
          )}

          {matsError && <p className="error-msg">Error loading materials: {matsError}</p>}

          {!matsError && materials.length === 0 && (
            <p className="empty-state">No materials uploaded for this course yet.</p>
          )}

          {!matsError && materials.length > 0 && (
            <div className="file-list">
              {materials.map((m) => (
                <div key={m.id} className="file-item">
                  <span className="file-icon">{fileIcon(m.file_type)}</span>
                  <div className="file-info">
                    <strong>{m.title}</strong>
                    <span className="text-muted">
                      {m.profiles?.full_name ?? "Unknown"} · {m.created_at ? new Date(m.created_at).toLocaleDateString() : "—"}
                    </span>
                  </div>
                  <div className="file-actions">
                    <a href={m.file_url} target="_blank" rel="noopener noreferrer">
                      <BtnGhost className="btn-xs">Download</BtnGhost>
                    </a>
                    {canManage && (
                      <BtnGhost className="btn-xs btn-ghost-danger" onClick={() => handleRemoveMaterial(m)}>
                        Remove
                      </BtnGhost>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assignments */}
        <div className="content-card">
          <div className="section-header">
            <h2>Assignments &amp; Quizzes</h2>
            {canManage && (
              <BtnPrimary className="btn-xs" onClick={() => setAssignModal(true)}>+ New</BtnPrimary>
            )}
          </div>

          {(() => {
            const visibleAssignments = isStudent
              ? assignments.filter((a) => a.is_published)
              : assignments;
            if (visibleAssignments.length === 0) {
              return <p className="empty-state">No assignments for this course yet.</p>;
            }
            return (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Type</th>
                      <th>Due Date</th>
                      <th>Status</th>
                      {isStudent && <th>My Submission</th>}
                      {isStudent && <th>Grade</th>}
                      {(canManage || isStudent) && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAssignments.map((a) => {
                      const closed = isPastDue(a.due_date);
                      const sub = mySubmissions[a.id];
                      const grade = myGrades[a.id];
                      return (
                        <tr key={a.id}>
                          <td className="col-name">{a.title}</td>
                          <td>
                            <span className={a.type === "quiz" ? "chip chip-gold" : "chip chip-blue"}>
                              {a.type === "quiz" ? "Quiz" : "Assignment"}
                            </span>
                          </td>
                          <td>{formatDate(a.due_date)}</td>
                          <td>
                            {!a.is_published ? (
                              <span className="chip chip-gray">Draft</span>
                            ) : closed ? (
                              <span className="chip chip-red">Closed</span>
                            ) : (
                              <span className="chip chip-green">Open</span>
                            )}
                          </td>
                          {isStudent && (
                            <td>
                              {sub ? (
                                <span className="chip chip-green">
                                  Submitted {formatDate(sub.submitted_at)}
                                </span>
                              ) : closed ? (
                                <span className="chip chip-red">Missed</span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          )}
                          {isStudent && (
                            <td className="score-cell">
                              {grade ? (
                                <div className="grade-cell">
                                  <span className="grade-cell__score">
                                    {grade.score} / {grade.max_score}
                                    {grade.max_score > 0 && (
                                      <span className="grade-cell__pct">
                                        {" "}({Math.round((grade.score / grade.max_score) * 100)}%)
                                      </span>
                                    )}
                                  </span>
                                  {grade.feedback && (
                                    <span className="grade-cell__feedback" title={grade.feedback}>
                                      {grade.feedback}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          )}
                          {(canManage || isStudent) && (
                            <td className="actions-cell">
                              {canManage && (
                                <>
                                  <BtnGhost className="btn-xs" onClick={() => togglePublish(a)}>
                                    {a.is_published ? "Unpublish" : "Publish"}
                                  </BtnGhost>
                                  <BtnGhost className="btn-xs btn-ghost-danger" onClick={() => deleteAssignment(a.id)}>
                                    Delete
                                  </BtnGhost>
                                </>
                              )}
                              {isStudent && a.is_published && !closed && (
                                <BtnPrimary className="btn-xs" onClick={() => openSubmit(a)}>
                                  {sub ? "Edit Submission" : "Submit"}
                                </BtnPrimary>
                              )}
                              {isStudent && closed && !sub && (
                                <span className="text-muted" style={{ fontSize: 12 }}>Closed</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>

      </div>

      {submitModal && (
        <div className="modal-overlay" onClick={() => setSubmitModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">
              {mySubmissions[submitModal.id] ? "Edit Submission" : "Submit Assignment"}
            </h2>
            <p className="modal__body">
              <strong>{submitModal.title}</strong> · Due {formatDate(submitModal.due_date)}
            </p>
            {submitError && <p className="error-msg">{submitError}</p>}
            <form className="auth-form" onSubmit={handleSubmitAssignment}>
              <div className="field">
                <span>Your Submission</span>
                <textarea
                  required
                  rows={6}
                  placeholder="Type your answer or paste a link to your work…"
                  value={submitContent}
                  onChange={(e) => setSubmitContent(e.target.value)}
                />
              </div>
              <div className="modal-actions">
                <BtnGhost type="button" onClick={() => setSubmitModal(null)}>Cancel</BtnGhost>
                <BtnPrimary type="submit" disabled={submitSaving}>
                  {submitSaving ? "Saving…" : "Submit"}
                </BtnPrimary>
              </div>
            </form>
          </div>
        </div>
      )}

      {assignModal && (
        <div className="modal-overlay" onClick={() => setAssignModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">New Assignment</h2>
            <form className="auth-form" onSubmit={handleCreateAssignment}>
              <div className="field">
                <span>Title</span>
                <input
                  required
                  placeholder="e.g. Week 3 Problem Set"
                  value={assignForm.title}
                  onChange={(e) => setAssignForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="form-row-2">
                <div className="field">
                  <span>Type</span>
                  <select value={assignForm.type} onChange={(e) => setAssignForm((f) => ({ ...f, type: e.target.value }))}>
                    <option value="assignment">Assignment</option>
                    <option value="quiz">Quiz</option>
                  </select>
                </div>
                <div className="field">
                  <span>Due Date</span>
                  <input
                    type="datetime-local"
                    value={assignForm.due_date}
                    onChange={(e) => setAssignForm((f) => ({ ...f, due_date: e.target.value }))}
                  />
                </div>
              </div>
              <label className="field-checkbox">
                <input
                  type="checkbox"
                  checked={assignForm.is_published}
                  onChange={(e) => setAssignForm((f) => ({ ...f, is_published: e.target.checked }))}
                />
                <span>Publish immediately</span>
              </label>
              <div className="modal-actions">
                <BtnGhost type="button" onClick={() => setAssignModal(false)}>Cancel</BtnGhost>
                <BtnPrimary type="submit" disabled={assignSaving}>
                  {assignSaving ? "Saving…" : "Create"}
                </BtnPrimary>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
