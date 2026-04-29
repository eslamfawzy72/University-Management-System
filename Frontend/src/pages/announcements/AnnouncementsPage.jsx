import { useEffect, useState } from "react";

import AppShell from "../../components/layout/AppShell";
import { useAuth } from "../../hooks/useAuth";
import { useRole } from "../../hooks/useRole";
import { supabase } from "../../lib/supabase";

function formatDate(ts) {
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function AnnouncementDetail({ announcement, onBack }) {
  return (
    <div className="announcement-detail">
      <button className="btn btn-ghost announcement-back" onClick={onBack}>
        ← Back to announcements
      </button>
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

function AnnouncementCard({ announcement, onClick }) {
  return (
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
  );
}

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

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
        {selected ? (
          <AnnouncementDetail
            announcement={selected}
            onBack={() => setSelected(null)}
          />
        ) : (
          <>
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
