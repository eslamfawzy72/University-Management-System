import { useEffect, useRef, useState } from "react";

import AppShell from "../../components/layout/AppShell";
import { useAuth } from "../../hooks/useAuth";
import { useRole } from "../../hooks/useRole";
import { supabase } from "../../lib/supabase";

function formatTime(ts) {
  // Supabase returns timestamps without timezone suffix — append Z to treat as UTC
  const normalized = ts && !ts.endsWith("Z") ? ts + "Z" : ts;
  return new Date(normalized).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ContactList({ contacts, selected, onSelect, emptyText, emptySub }) {
  if (contacts.length === 0) {
    return (
      <div className="msg-empty-professors">
        <p className="announcements-state__text">{emptyText}</p>
        <p className="announcements-state__sub">{emptySub}</p>
      </div>
    );
  }

  return (
    <ul className="msg-professor-list">
      {contacts.map((c) => (
        <li key={c.id}>
          <button
            className={`msg-professor-item${selected?.id === c.id ? " msg-professor-item--active" : ""}${c.hasUnread ? " msg-professor-item--unread" : ""}`}
            onClick={() => onSelect(c)}
          >
            <span className="msg-professor-avatar">
              {(c.full_name ?? "?")[0].toUpperCase()}
            </span>
            <span className="msg-professor-info">
              <strong>{c.full_name}</strong>
              <span className="msg-contact-preview">
                {c.preview ?? c.subtitle}
              </span>
            </span>
            {c.hasUnread && <span className="msg-unread-dot" aria-label="Unread messages" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

function MessageBubble({ message, isMine }) {
  return (
    <div className={`msg-bubble-row${isMine ? " msg-bubble-row--mine" : ""}`}>
      <div className={`msg-bubble${isMine ? " msg-bubble--mine" : " msg-bubble--theirs"}`}>
        <p>{message.body}</p>
        <time className="msg-bubble-time">{formatTime(message.sent_at)}</time>
      </div>
    </div>
  );
}

function ConversationPane({ contact, authUserId, onMessagesRead }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [bodyError, setBodyError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!contact || !authUserId) return;

    setLoading(true);
    setMessages([]);

    async function fetchMessages() {
      const { data, error } = await supabase
        .from("messages")
        .select("id, sender_id, receiver_id, body, is_read, sent_at")
        .or(
          `and(sender_id.eq.${authUserId},receiver_id.eq.${contact.id}),and(sender_id.eq.${contact.id},receiver_id.eq.${authUserId})`
        )
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: true, nullsFirst: false });

      if (!error) {
        setMessages(data ?? []);
        // Mark all unread messages from this contact as read
        const unreadIds = (data ?? [])
          .filter((m) => !m.is_read && m.sender_id === contact.id)
          .map((m) => m.id);
        if (unreadIds.length > 0) {
          await supabase
            .from("messages")
            .update({ is_read: true })
            .in("id", unreadIds);
          onMessagesRead?.(contact.id);
        }
      }
      setLoading(false);
    }

    fetchMessages();
  }, [contact, authUserId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    setBodyError(null);
    setSendError(null);

    if (!body.trim()) {
      setBodyError("Message cannot be empty.");
      return;
    }

    setSending(true);

    const { error } = await supabase
      .from("messages")
      .insert({
        sender_id: authUserId,
        receiver_id: contact.id,
        body: body.trim(),
        is_read: false,
        sent_at: new Date().toISOString(),
      });

    setSending(false);

    if (error) {
      setSendError(error.message);
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        sender_id: authUserId,
        receiver_id: contact.id,
        body: body.trim(),
        is_read: false,
        sent_at: new Date().toISOString(),
      },
    ]);
    setBody("");
  };

  return (
    <div className="msg-conversation">
      <div className="msg-conversation__header">
        <span className="msg-professor-avatar msg-professor-avatar--lg">
          {(contact.full_name ?? "?")[0].toUpperCase()}
        </span>
        <div>
          <strong className="msg-conversation__name">{contact.full_name}</strong>
          <span className="msg-conversation__role">{contact.subtitle}</span>
        </div>
      </div>

      <div className="msg-thread">
        {loading && <p className="msg-thread-state">Loading messages…</p>}
        {!loading && messages.length === 0 && (
          <p className="msg-thread-state">No messages yet. Say hello!</p>
        )}
        {!loading &&
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isMine={m.sender_id === authUserId}
            />
          ))}
        <div ref={bottomRef} />
      </div>

      <form className="msg-compose" onSubmit={handleSend} noValidate>
        <div className="msg-compose__field">
          <textarea
            className={`msg-compose__input${bodyError ? " has-error" : ""}`}
            placeholder="Type a message…"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              if (bodyError) setBodyError(null);
            }}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
          />
          {bodyError && <small className="msg-compose__error">{bodyError}</small>}
        </div>
        <button
          className="btn btn-primary msg-compose__send"
          type="submit"
          disabled={sending}
        >
          {sending ? "Sending…" : "Send"}
        </button>
        {sendError && (
          <p className="msg-compose__error msg-compose__error--banner">{sendError}</p>
        )}
      </form>
    </div>
  );
}

function useStudentContacts(profile) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!profile?.id) return;

    async function fetch() {
      const { data: studentRow, error: e1 } = await supabase
        .from("students")
        .select("id")
        .eq("profile_id", profile.id)
        .maybeSingle();

      if (e1) { setError(e1.message); setLoading(false); return; }
      if (!studentRow) { setError("No student record found for your profile."); setLoading(false); return; }

      const { data: enrollments, error: e2 } = await supabase
        .from("course_enrollments")
        .select("course_id")
        .eq("student_id", studentRow.id);

      if (e2) { setError(e2.message); setLoading(false); return; }

      const courseIds = (enrollments ?? []).map((e) => e.course_id);
      if (courseIds.length === 0) { setLoading(false); return; }

      const { data: courseStaff, error: e3 } = await supabase
        .from("course_staff")
        .select("staff_id")
        .in("course_id", courseIds)
        .in("role", ["professor", "ta"]);

      if (e3) { setError(e3.message); setLoading(false); return; }

      const staffIds = [...new Set((courseStaff ?? []).map((r) => r.staff_id))];
      if (staffIds.length === 0) { setLoading(false); return; }

      const { data: staffRows, error: e4 } = await supabase
        .from("staff")
        .select("id, title, profile_id")
        .in("id", staffIds);

      if (e4) { setError(e4.message); setLoading(false); return; }

      const profileIds = [...new Set(staffRows.map((s) => s.profile_id).filter(Boolean))];

      const { data: profileRows, error: e5 } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .in("id", profileIds);

      if (e5) { setError(e5.message); setLoading(false); return; }

      // Fetch unread messages sent to this student from any professor
      const { data: unreadMsgs } = await supabase
        .from("messages")
        .select("sender_id")
        .eq("receiver_id", profile.id)
        .eq("is_read", false);

      const unreadSet = new Set((unreadMsgs ?? []).map((m) => m.sender_id));

      // Fetch latest message per professor for preview
      const { data: latestMsgs } = await supabase
        .from("messages")
        .select("sender_id, receiver_id, body, sent_at")
        .or(
          profileIds.map((pid) =>
            `and(sender_id.eq.${profile.id},receiver_id.eq.${pid}),and(sender_id.eq.${pid},receiver_id.eq.${profile.id})`
          ).join(",")
        )
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false });

      // Build map: other_party_id → latest message body
      const previewMap = {};
      for (const m of latestMsgs ?? []) {
        const otherId = m.sender_id === profile.id ? m.receiver_id : m.sender_id;
        if (!previewMap[otherId]) previewMap[otherId] = m.body;
      }

      const profileMap = Object.fromEntries(profileRows.map((p) => [p.id, p]));
      const seen = new Set();
      const unique = [];
      for (const s of staffRows) {
        const p = profileMap[s.profile_id];
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        unique.push({
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          subtitle: s.title || (p.role === "ta" ? "TA" : "Professor"),
          preview: previewMap[p.id] ?? null,
          hasUnread: unreadSet.has(p.id),
        });
      }

      setContacts(unique);
      setLoading(false);
    }

    fetch();
  }, [profile]);

  return { contacts, setContacts, loading, error };
}

function useStaffContacts(authUserId) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!authUserId) return;

    async function fetch() {
      // Fetch all messages received with body for preview
      const { data: msgs, error: e1 } = await supabase
        .from("messages")
        .select("sender_id, is_read, body, sent_at")
        .eq("receiver_id", authUserId)
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false });

      if (e1) { setError(e1.message); setLoading(false); return; }

      const senderIds = [...new Set((msgs ?? []).map((m) => m.sender_id))];
      if (senderIds.length === 0) { setLoading(false); return; }

      // Track which senders have at least one unread message
      const unreadSet = new Set(
        (msgs ?? []).filter((m) => !m.is_read).map((m) => m.sender_id)
      );

      // Latest message body per sender for preview
      const previewMap = {};
      for (const m of msgs ?? []) {
        if (!previewMap[m.sender_id]) previewMap[m.sender_id] = m.body;
      }

      const { data: profileRows, error: e2 } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .in("id", senderIds);

      if (e2) { setError(e2.message); setLoading(false); return; }

      setContacts(
        (profileRows ?? []).map((p) => ({
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          subtitle: p.role ?? "Student",
          preview: previewMap[p.id] ?? null,
          hasUnread: unreadSet.has(p.id),
        }))
      );
      setLoading(false);
    }

    fetch();
  }, [authUserId]);

  return { contacts, setContacts, loading, error };
}

export default function MessagesPage() {
  const { profile, session } = useAuth();
  const { role } = useRole();
  const authUserId = session?.user?.id;

  const isStaff = role === "professor" || role === "ta" || role === "admin" || role === "parent";

  const studentData = useStudentContacts(isStaff ? null : profile);
  const staffData = useStaffContacts(isStaff ? authUserId : null);

  const { contacts, setContacts, loading, error } = isStaff ? staffData : studentData;

  const [selected, setSelected] = useState(null);

  function handleMessagesRead(senderId) {
    setContacts?.((prev) =>
      prev.map((c) => (c.id === senderId ? { ...c, hasUnread: false } : c))
    );
  }

  return (
    <AppShell
      title="Messages"
      subtitle={isStaff ? "View messages from your students." : "Send direct messages to your professors."}
    >
      <div className="msg-layout">
        <aside className="msg-sidebar">
          <p className="msg-sidebar__heading">{isStaff ? "Students" : "My Professors"}</p>
          {loading && <p className="msg-thread-state">Loading…</p>}
          {!loading && error && (
            <p className="msg-thread-state msg-thread-state--error">{error}</p>
          )}
          {!loading && !error && (
            <ContactList
              contacts={contacts}
              selected={selected}
              onSelect={setSelected}
              emptyText={isStaff ? "No messages yet." : "No professors found."}
              emptySub={isStaff ? "Students will appear here when they message you." : "Enroll in a course to message its professor."}
            />
          )}
        </aside>

        <div className="msg-main">
          {!selected ? (
            <div className="msg-placeholder">
              <p className="announcements-state__text">
                {isStaff ? "Select a student to view the conversation." : "Select a professor to start messaging."}
              </p>
            </div>
          ) : (
            <ConversationPane
              contact={selected}
              authUserId={authUserId}
              onMessagesRead={handleMessagesRead}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
