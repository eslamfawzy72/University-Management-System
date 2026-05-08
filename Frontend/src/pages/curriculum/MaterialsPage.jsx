import { useState, useEffect, useCallback, useRef } from "react";
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

export default function MaterialsPage() {
  const { isAny } = useRole();
  const { profile } = useAuth();
  const canUpload = isAny(["professor", "ta", "admin"]);
  const isStaff = profile?.role === "professor" || profile?.role === "ta";

  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [matsLoading, setMatsLoading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    async function loadCourses() {
      setCoursesLoading(true);

      let assignedCourseIds = null;
      if (isStaff && profile?.id) {
        const { data: staffRec } = await supabase
          .from("staff").select("id").eq("profile_id", profile.id).maybeSingle();
        if (staffRec?.id) {
          const { data: assigned } = await supabase
            .from("course_staff").select("course_id").eq("staff_id", staffRec.id);
          assignedCourseIds = new Set((assigned || []).map((r) => r.course_id));
        } else {
          assignedCourseIds = new Set();
        }
      }

      const { data } = await supabase
        .from("courses")
        .select("id, name, code")
        .eq("is_active", true)
        .order("code");

      const list = assignedCourseIds
        ? (data || []).filter((c) => assignedCourseIds.has(c.id))
        : (data || []);

      setCourses(list);
      if (list.length) setSelectedCourse(list[0].id);
      setCoursesLoading(false);
    }
    loadCourses();
  }, [isStaff, profile?.id]);

  const loadMaterials = useCallback(async () => {
    if (!selectedCourse) return;
    setMatsLoading(true);
    const { data } = await supabase
      .from("materials")
      .select("*, profiles(full_name)")
      .eq("course_id", selectedCourse)
      .order("created_at", { ascending: false });
    setMaterials(data || []);
    setMatsLoading(false);
  }, [selectedCourse]);

  useEffect(() => { loadMaterials(); }, [loadMaterials]);

  async function handleUpload(e) {
    e.preventDefault();
    if (!uploadFile || !selectedCourse) return;
    setUploading(true);
    setUploadError(null);

    const filePath = `${selectedCourse}/${Date.now()}-${uploadFile.name}`;
    const { data: stored, error: storeErr } = await supabase.storage
      .from("course-materials")
      .upload(filePath, uploadFile);

    if (storeErr) {
      setUploadError(storeErr.message);
      setUploading(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from("course-materials")
      .getPublicUrl(stored.path);

    const { error: insertErr } = await supabase.from("materials").insert({
      course_id: selectedCourse,
      uploaded_by: profile.id,
      title: uploadTitle.trim() || uploadFile.name,
      file_url: publicUrl,
      file_type: uploadFile.type,
    });

    setUploading(false);
    if (insertErr) { setUploadError(insertErr.message); return; }

    setUploadTitle("");
    setUploadFile(null);
    if (fileRef.current) fileRef.current.value = "";
    loadMaterials();
  }

  async function handleRemove(material) {
    const pathMatch = material.file_url.split("/course-materials/");
    if (pathMatch[1]) {
      await supabase.storage.from("course-materials").remove([decodeURIComponent(pathMatch[1])]);
    }
    await supabase.from("materials").delete().eq("id", material.id);
    loadMaterials();
  }

  const selectedName = courses.find((c) => c.id === selectedCourse)?.name ?? "";

  return (
    <AppShell
      title="Course Materials"
      subtitle={canUpload ? "Upload and manage learning materials" : "Access your course materials"}
    >
      <div className="dashboard-stack">
        {coursesLoading && <p className="text-muted">Loading courses…</p>}

        {!coursesLoading && (
          <div className="content-card">
            <h2>Select Course</h2>
            <div className="course-tabs">
              {courses.length === 0 && <p className="empty-state">No active courses found.</p>}
              {courses.map((c) => (
                <button
                  key={c.id}
                  className={`course-tab${selectedCourse === c.id ? " course-tab--active" : ""}`}
                  onClick={() => setSelectedCourse(c.id)}
                >
                  <span className="code-badge">{c.code}</span>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {canUpload && selectedCourse && (
          <div className="content-card">
            <h2>Upload Material</h2>
            {uploadError && <p className="error-msg">{uploadError}</p>}
            <form className="upload-form" onSubmit={handleUpload}>
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
          </div>
        )}

        {selectedCourse && (
          <div className="content-card">
            <h2>{selectedName} — Materials</h2>
            {matsLoading && <p className="text-muted">Loading…</p>}
            {!matsLoading && materials.length === 0 && (
              <p className="empty-state">No materials uploaded for this course yet.</p>
            )}
            {!matsLoading && materials.length > 0 && (
              <div className="file-list">
                {materials.map((m) => (
                  <div key={m.id} className="file-item">
                    <span className="file-icon">{fileIcon(m.file_type)}</span>
                    <div className="file-info">
                      <strong>{m.title}</strong>
                      <span className="text-muted">
                        {m.profiles?.full_name ?? "Unknown"} · {new Date(m.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="file-actions">
                      <a href={m.file_url} target="_blank" rel="noopener noreferrer">
                        <BtnGhost className="btn-xs">Download</BtnGhost>
                      </a>
                      {canUpload && (
                        <BtnGhost className="btn-xs btn-ghost-danger" onClick={() => handleRemove(m)}>
                          Remove
                        </BtnGhost>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
