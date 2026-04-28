import AppShell from "../../components/layout/AppShell";
import { useAuth } from "../../hooks/useAuth";
import { roleChipClass, roleLabel } from "../../lib/roles";

const DASHBOARD_COPY = {
  student: {
    title: "Student dashboard",
    subtitle: "Track classes, submissions, and grades from one place.",
    summary: [
      { label: "Courses", value: "5" },
      { label: "Pending tasks", value: "3" },
      { label: "Average grade", value: "91%" },
    ],
    highlights: [
      "Enrolled course materials are available for instant reading.",
      "Assignment deadlines stay visible in the dashboard timeline.",
      "Grades and feedback stay tied to your profile row in Supabase.",
    ],
  },
  parent: {
    title: "Parent dashboard",
    subtitle: "Monitor progress and stay in contact with the teaching team.",
    summary: [
      { label: "Linked students", value: "1" },
      { label: "Unread messages", value: "2" },
      { label: "Alerts", value: "1" },
    ],
    highlights: [
      "Check the latest grades for the linked student account.",
      "Follow upcoming assignments and announcements.",
      "Message the teaching team without leaving the portal.",
    ],
  },
  staff: {
    title: "Staff dashboard",
    subtitle: "Manage teaching tasks, materials, and communication.",
    summary: [
      { label: "Active courses", value: "4" },
      { label: "Submissions", value: "18" },
      { label: "Announcements", value: "6" },
    ],
    highlights: [
      "Publish materials and assignments to assigned courses.",
      "Review submissions and record grades for your classes.",
      "Coordinate with students and parents through messages.",
    ],
  },
};

export default function DashboardPage({ variant }) {
  const { profile } = useAuth();
  const copy = DASHBOARD_COPY[variant];
  const currentRole = profile?.role ?? variant;

  return (
    <AppShell title={copy.title} subtitle={copy.subtitle}>
      <section className="dashboard-stack">
        <div className="chip-row">
          <span className={`chip ${roleChipClass(currentRole)}`}>{roleLabel(currentRole)}</span>
          <span className="chip chip-gray">Signed in</span>
        </div>

        <div className="summary-grid">
          {copy.summary.map((item) => (
            <article key={item.label} className="summary-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>

        <article className="content-card">
          <h2>What you can do here</h2>
          <ul className="feature-list">
            {copy.highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </AppShell>
  );
}
