import { useEffect, useState } from "react";

import AppShell from "../../components/layout/AppShell";
import { useAuth } from "../../hooks/useAuth";
import { useRole } from "../../hooks/useRole";
import { supabase } from "../../lib/supabase";

function formatDate(ts) {
  return new Date(ts).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ConfirmDeleteModal({ announcement, onConfirm, onCancel, deleting, error }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal confirm-delete-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">Delete announcement?</h2>
          <button className="modal__close" onClick={onCancel} aria-label="Close">✕</button>
        </div>
        <p className="confirm-delete-modal__body">
          <strong>"{announcement.title}"</strong> will be permanently removed from the feed.
        </p>
        {error && (
          <div className="announcements-state announcements-state--error">
            <p className="announcements-state__text">Failed to delete: {error}</p>
          </div>
        )}
        <div className="confirm-delete-modal__actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={deleting}>
            Cancel
          </button>
          <button className="btn announcement-delete-btn" onClick={onConfirm} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AnnouncementDetail({ announcement, onBack, isAdmin, onRequestDelete }) {
  return (
    <div className="announcement-detail">
      <div className="announcement-detail__topbar">
        <button className="btn btn-ghost announcement-back" onClick={onBack}>
          ← Back to announcements
        </button>
        {isAdmin && (
          <button className="btn announcement-delete-btn" onClick={() => onRequestDelete(announcement)}>
            Delete
          </button>
        )}
      </div>
      <article className="content-card announcement-detail__card">
        <div className="announcement-detail__header">
          <div className="chip-row">
            <span className="chip chip-blue">{announcement.audience}</span>
            <span className="chip chip-gray">{formatDate(announcement.created_at)}</span>
          </div>
          <h2 className="announcement-detail__title">{announcement.title}</h2>
          {announcement.profiles?.full_name && (
            <p className="announcement-detail__author">
              By {announcement.profiles.full_name}
            </p>
          )}
        </div>
        <p className="announcement-detail__body">{announcement.body}</p>
      </article>
    </div>
  );
}

function AnnouncementCard({ announcement, onClick, isAdmin, onRequestDelete }) {
  return (
    <div className="announcement-card-wrapper">
      <button className="announcement-card" onClick={onClick}>
        <div className="announcement-card__meta">
          <span className="chip chip-blue">{announcement.audience}</span>
          <time className="announcement-card__date">
            {formatDate(announcement.created_at)}
          </time>
        </div>
        <h3 className="announcement-card__title">{announcement.title}</h3>
        <p className="announcement-card__preview">{announcement.body}</p>
        {announcement.profiles?.full_name && (
          <span className="announcement-card__author">
            {announcement.profiles.full_name}
          </span>
        )}
      </button>
      {isAdmin && (
        <button
          className="announcement-card__delete"
          onClick={(e) => { e.stopPropagation(); onRequestDelete(announcement); }}
          aria-label="Delete announcement"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function PostAnnouncementForm({ onPosted }) {
  const { profile } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("all");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [postError, setPostError] = useState(null);

  const validate = () => {
    const e = {};
    if (!title.trim()) e.title = "Title is required.";
    if (!body.trim()) e.body = "Body is required.";
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const e2 = validate();
    if (Object.keys(e2).length) {
      setErrors(e2);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setPostError(null);

    const { data, error } = await supabase
      .from("announcements")
      .insert({
        author_id: profile.id,
        title: title.trim(),
        body: body.trim(),
        audience,
      })
      .select("id, title, body, audience, created_at, profiles(full_name)")
      .single();

    setSubmitting(false);

    if (error) {
      setPostError(error.message);
      return;
    }

    setTitle("");
    setBody("");
    setAudience("all");
    onPosted(data);
  };

  return (
    <form className="announcement-form__fields" onSubmit={handleSubmit} noValidate>
        <div className="field">
          <span>Title</span>
          <input
            type="text"
            placeholder="e.g. Campus closed on Friday"
            value={title}
            className={errors.title ? "has-error" : ""}
            onChange={(e) => setTitle(e.target.value)}
          />
          {errors.title && <small>{errors.title}</small>}
        </div>
        <div className="field">
          <span>Body</span>
          <textarea
            placeholder="Write the announcement details…"
            value={body}
            className={errors.body ? "has-error" : ""}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
          />
          {errors.body && <small>{errors.body}</small>}
        </div>
        <div className="field">
          <span>Audience</span>
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="all">Everyone</option>
            <option value="students">Students</option>
            <option value="staff">Staff</option>
            <option value="parents">Parents</option>
          </select>
        </div>
        {postError && (
          <div className="form-banner announcement-form__error">{postError}</div>
        )}
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Posting…" : "Post announcement"}
        </button>
    </form>
  );
}

export default function AnnouncementsPage() {
  const { role } = useRole();
  const isAdmin = role === "admin";
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const handleRequestDelete = (announcement) => {
    setDeleteError(null);
    setPendingDelete(announcement);
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase
      .from("announcements")
      .delete()
      .eq("id", pendingDelete.id);
    setDeleting(false);
    if (error) {
      setDeleteError(error.message);
      return;
    }
    setAnnouncements((prev) => prev.filter((a) => a.id !== pendingDelete.id));
    if (selected?.id === pendingDelete.id) setSelected(null);
    setPendingDelete(null);
  };

  useEffect(() => {
    async function fetchAnnouncements() {
      const { data, error } = await supabase
        .from("announcements")
        .select("id, title, body, audience, created_at, profiles(full_name)")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("announcements fetch error:", error);
        setError(error.message);
      } else {
        console.log("announcements fetched:", data);
        setAnnouncements(data ?? []);
      }
      setLoading(false);
    }

    fetchAnnouncements();
  }, []);

  return (
    <AppShell
      title="Announcements"
      subtitle="Stay informed about the latest university updates."
    >
      <section className="dashboard-stack">
        {pendingDelete && (
          <ConfirmDeleteModal
            announcement={pendingDelete}
            onConfirm={handleConfirmDelete}
            onCancel={() => { setPendingDelete(null); setDeleteError(null); }}
            deleting={deleting}
            error={deleteError}
          />
        )}
        {selected ? (
          <AnnouncementDetail
            announcement={selected}
            onBack={() => setSelected(null)}
            isAdmin={isAdmin}
            onRequestDelete={handleRequestDelete}
          />
        ) : (
          <>
            {isAdmin && (
              <>
                <button
                  className="btn btn-primary announcement-composer__toggle"
                  onClick={() => setFormOpen(true)}
                >
                  + New announcement
                </button>
                {formOpen && (
                  <div className="modal-backdrop" onClick={() => setFormOpen(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                      <div className="modal__header">
                        <h2 className="modal__title">Post an announcement</h2>
                        <button
                          className="modal__close"
                          onClick={() => setFormOpen(false)}
                          aria-label="Close"
                        >
                          ✕
                        </button>
                      </div>
                      <PostAnnouncementForm
                        onPosted={(a) => {
                          setAnnouncements((prev) => [a, ...prev]);
                          setFormOpen(false);
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
            {loading && (
              <div className="announcements-state">
                <p className="announcements-state__text">Loading announcements…</p>
              </div>
            )}

            {!loading && error && (
              <div className="announcements-state announcements-state--error">
                <p className="announcements-state__text">Failed to load announcements: {error}</p>
              </div>
            )}

            {!loading && !error && announcements.length === 0 && (
              <div className="announcements-state">
                <p className="announcements-state__icon">📭</p>
                <p className="announcements-state__text">No announcements yet.</p>
                <p className="announcements-state__sub">
                  Check back later for updates from the university.
                </p>
              </div>
            )}

            {!loading && !error && announcements.length > 0 && (
              <div className="announcements-feed">
                {announcements.map((a) => (
                  <AnnouncementCard
                    key={a.id}
                    announcement={a}
                    onClick={() => setSelected(a)}
                    isAdmin={isAdmin}
                    onRequestDelete={handleRequestDelete}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
