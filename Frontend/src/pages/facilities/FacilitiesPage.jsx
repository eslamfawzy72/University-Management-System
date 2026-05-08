import { useState, useEffect, useCallback } from "react";
import AppShell from "../../components/layout/AppShell";
import { BtnPrimary, BtnGhost } from "../../components/ui/Buttons";
import { useRole } from "../../hooks/useRole";
import { useAuth } from "../../hooks/useAuth";
import { supabase } from "../../lib/supabase";

// ─── Constants ────────────────────────────────────────────────────────────────

const _now = new Date();
const TODAY = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;

// 0=Monday … 6=Sunday  (base date 1970-01-05 = Monday)
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString();
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Render date or "Every Monday" for the schedule column. */
function fmtSchedule(res) {
  if (res.recurrence === "weekly" && res.day_of_week != null)
    return `Every ${DAYS[res.day_of_week]}`;
  return fmtDate(res.start_time);
}

/** Pad a number to 2 digits. */
function p2(n) { return String(n).padStart(2, "0"); }

/**
 * Build a local-time ISO string (with timezone offset) so Supabase stores
 * the exact wall-clock time the user entered, regardless of the browser's
 * UTC offset. Example: "2026-05-08T10:00:00+02:00"
 */
function localIso(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}`);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const hh = p2(Math.floor(Math.abs(off) / 60));
  const mm = p2(Math.abs(off) % 60);
  return `${dateStr}T${timeStr}:00${sign}${hh}:${mm}`;
}

/**
 * Build an ISO timestamp for a weekly slot.
 * Uses the canonical week 1970-01-05 (Mon) … 1970-01-11 (Sun).
 */
function weeklyTs(dayIdx, timeStr) {
  const dateStr = `1970-01-${p2(5 + dayIdx)}`;
  return localIso(dateStr, timeStr);
}

/** JS getDay() (0=Sun) → our 0=Mon system */
function jsDayToMyDay(jsDay) {
  return jsDay === 0 ? 6 : jsDay - 1;
}

function localDateToISO(date, time) {
  return localIso(date, time);
}

function isoToLocalDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function isoToLocalTime(ts) {
  return new Date(ts).toTimeString().slice(0, 5);
}

function typeChipClass(type) {
  return type === "lab" ? "chip chip-gold" : "chip chip-blue";
}

function typeLabel(type) {
  if (type === "lab")       return "Lab";
  if (type === "classroom") return "Classroom";
  return type ?? "—";
}

function statusChipClass(status) {
  switch (status) {
    case "confirmed": return "chip chip-green";
    case "cancelled": return "chip chip-red";
    default:          return "chip chip-gold";
  }
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

const EMPTY_ROOM = {
  name:     "",
  type:     "classroom",
  capacity: "",
  building: "",
  location: "",
};

function validateRoomForm(f) {
  const errs = {};
  if (!f.name?.trim())                          errs.name     = "Room name is required.";
  if (!f.type)                                  errs.type     = "Type is required.";
  if (!f.capacity && f.capacity !== 0)          errs.capacity = "Capacity is required.";
  else if (isNaN(Number(f.capacity)) || Number(f.capacity) < 1)
                                                errs.capacity = "Capacity must be a positive number.";
  if (!f.location?.trim())                      errs.location = "Location is required.";
  return errs;
}

const EMPTY_BOOK = {
  label:       "",
  recurrence:  "one_time",   // "one_time" | "weekly"
  date:        TODAY,
  start:       "09:00",
  end:         "10:00",
  dayOfWeek:   0,            // 0=Mon … 6=Sun
  reservedFor: "",
};

const WORK_START = "08:00";
const WORK_END   = "22:00";

function validateForm(f) {
  const errs = {};
  if (!f.label?.trim())                                       errs.label       = "Label is required.";
  if (!f.start)                                               errs.start       = "Start time is required.";
  else if (f.start < WORK_START || f.start >= WORK_END)      errs.start       = "Start time must be between 08:00 and 22:00.";
  if (!f.end)                                                 errs.end         = "End time is required.";
  else if (f.end > WORK_END)                                  errs.end         = "End time cannot exceed 22:00.";
  if (!errs.start && !errs.end && f.start && f.end && f.start >= f.end)
                                                              errs.end         = "End time must be after start.";
  if (f.recurrence === "one_time" && !f.date)                 errs.date        = "Date is required.";
  if (!f.reservedFor)                                         errs.reservedFor = "Select who this reservation is for.";
  return errs;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FacilitiesPage() {
  const { isAny, is } = useRole();
  const { profile }   = useAuth();
  const isAdmin       = is("admin");
  const canReserve    = isAny(["admin", "professor", "ta"]);

  // ── tabs ──
  const [tab, setTab] = useState("rooms");

  // ── rooms ──
  const [rooms,        setRooms]        = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);

  // ── availability filter ──
  const [filterDate,  setFilterDate]  = useState(TODAY);
  const [filterStart, setFilterStart] = useState("09:00");
  const [filterEnd,   setFilterEnd]   = useState("10:00");
  const [filterType,  setFilterType]  = useState("all");
  const [bookedIds,   setBookedIds]   = useState(null);   // null=unchecked, Set=checked
  const [checking,    setChecking]    = useState(false);
  const [availError,  setAvailError]  = useState("");

  // ── booking modal ──
  const [bookingRoom, setBookingRoom] = useState(null);
  const [bookForm,    setBookForm]    = useState(EMPTY_BOOK);
  const [bookErrors,  setBookErrors]  = useState({});
  const [booking,     setBooking]     = useState(false);
  const [bookError,   setBookError]   = useState("");
  const [bookSuccess, setBookSuccess] = useState("");

  // ── staff profiles (admin "reserve for") ──
  const [staffProfiles, setStaffProfiles] = useState([]);

  // ── my reservations ──
  const [myRes,              setMyRes]              = useState([]);
  const [myResLoading,       setMyResLoading]       = useState(false);
  const [myResFilterDate,    setMyResFilterDate]    = useState("");
  const [myResFilterRoom,    setMyResFilterRoom]    = useState("");
  const [myResFilterType,    setMyResFilterType]    = useState("");
  const [myResShowCancelled, setMyResShowCancelled] = useState(false);

  // ── all reservations (admin) ──
  const [allRes,           setAllRes]           = useState([]);
  const [allResLoading,    setAllResLoading]    = useState(false);
  const [allResError,      setAllResError]      = useState(null);
  const [allResFilterDate,    setAllResFilterDate]    = useState("");
  const [allResFilterRoom,    setAllResFilterRoom]    = useState("");
  const [allResFilterType,    setAllResFilterType]    = useState("");
  const [allResShowCancelled, setAllResShowCancelled] = useState(false);

  // ── edit modal ──
  const [editingRes, setEditingRes] = useState(null);
  const [editForm,   setEditForm]   = useState({ ...EMPTY_BOOK, status: "confirmed" });
  const [editErrors, setEditErrors] = useState({});
  const [saving,     setSaving]     = useState(false);
  const [editError,  setEditError]  = useState("");

  // ── cancel confirm ──
  const [cancelId,   setCancelId]   = useState(null);
  const [cancelling, setCancelling] = useState(false);

  // ── room search ──
  const [roomSearch, setRoomSearch] = useState("");

  // ── maintenance requests (admin) ──
  const [maintRequests, setMaintRequests] = useState([]);
  const [maintLoading,  setMaintLoading]  = useState(false);
  const [maintError,    setMaintError]    = useState(null);
  const [markingDoneId, setMarkingDoneId] = useState(null);

  // ── add room modal (admin only) ──
  const [addRoomOpen,    setAddRoomOpen]    = useState(false);
  const [addRoomForm,    setAddRoomForm]    = useState(EMPTY_ROOM);
  const [addRoomErrors,  setAddRoomErrors]  = useState({});
  const [addRoomSaving,  setAddRoomSaving]  = useState(false);
  const [addRoomError,   setAddRoomError]   = useState("");
  const [addRoomSuccess, setAddRoomSuccess] = useState("");

  // ─── Data loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.from("rooms").select("*").order("name")
      .then(({ data }) => { setRooms(data || []); setRoomsLoading(false); });
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from("profiles").select("id, full_name, role")
      .in("role", ["admin", "professor", "ta"]).order("full_name")
      .then(({ data }) => setStaffProfiles(data || []));
  }, [isAdmin]);

  const loadMyRes = useCallback(async () => {
    if (!profile?.id) return;
    setMyResLoading(true);
    const { data } = await supabase
      .from("reservations")
      .select("*, rooms(name, type, building, location)")
      .eq("reserved_by", profile.id)
      .order("start_time", { ascending: false });
    setMyRes(data || []);
    setMyResLoading(false);
  }, [profile?.id]);

  const loadAllRes = useCallback(async () => {
    if (!isAdmin) return;
    setAllResLoading(true);
    setAllResError(null);
    const { data, error } = await supabase
      .from("reservations")
      .select("*, rooms(name, type, building), reserver:profiles!reserved_by(full_name)")
      .order("start_time", { ascending: false });
    if (error) setAllResError(error.message);
    else setAllRes(data || []);
    setAllResLoading(false);
  }, [isAdmin]);

  const loadMaintRequests = useCallback(async () => {
    if (!isAdmin) return;
    setMaintLoading(true);
    setMaintError(null);
    const { data, error } = await supabase
      .from("maintenance_requests")
      .select("*, rooms(name, building), submitter:profiles!submitted_by(full_name, email)")
      .order("created_at", { ascending: false });
    if (error) setMaintError(error.message);
    else setMaintRequests(data || []);
    setMaintLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    if (tab === "mine")        loadMyRes();
    if (tab === "all")         loadAllRes();
    if (tab === "maintenance") loadMaintRequests();
  }, [tab, loadMyRes, loadAllRes, loadMaintRequests]);

  // ─── Availability check ─────────────────────────────────────────────────────

  async function checkAvailability() {
    if (!filterDate)  { setAvailError("Please select a date.");       return; }
    if (!filterStart) { setAvailError("Please select a start time."); return; }
    if (!filterEnd)   { setAvailError("Please select an end time.");  return; }
    if (filterStart < WORK_START || filterStart >= WORK_END) { setAvailError("Start time must be between 08:00 and 22:00."); return; }
    if (filterEnd > WORK_END)   { setAvailError("End time cannot exceed 22:00."); return; }
    if (filterStart >= filterEnd) { setAvailError("Start time must be before end time."); return; }
    setAvailError("");
    setChecking(true);

    const startTs  = localDateToISO(filterDate, filterStart);
    const endTs    = localDateToISO(filterDate, filterEnd);
    // Parse with T00:00 so the date is treated as local time, not UTC midnight
    const dayIdx   = jsDayToMyDay(new Date(`${filterDate}T00:00`).getDay());
    const wStart   = weeklyTs(dayIdx, filterStart);
    const wEnd     = weeklyTs(dayIdx, filterEnd);

    // Check one-time AND weekly conflicts for the selected date
    const [{ data: otBooked }, { data: wkBooked }] = await Promise.all([
      supabase.from("reservations").select("room_id")
        .neq("status", "cancelled").eq("recurrence", "one_time")
        .lt("start_time", endTs).gt("end_time", startTs),
      supabase.from("reservations").select("room_id")
        .neq("status", "cancelled").eq("recurrence", "weekly")
        .eq("day_of_week", dayIdx)
        .lt("start_time", wEnd).gt("end_time", wStart),
    ]);

    const ids = [...(otBooked || []), ...(wkBooked || [])].map((r) => r.room_id);
    setBookedIds(new Set(ids));
    setChecking(false);
  }

  // ─── Derived room list ──────────────────────────────────────────────────────

  const visibleRooms   = rooms.filter((r) => filterType === "all" || r.type === filterType);
  const availableRooms = bookedIds !== null
    ? visibleRooms.filter((r) => !bookedIds.has(r.id))
    : visibleRooms;
  const displayedRooms = roomSearch.trim()
    ? availableRooms.filter((r) => {
        const q = roomSearch.trim().toLowerCase();
        return (r.name || "").toLowerCase().includes(q) ||
               (r.building || "").toLowerCase().includes(q);
      })
    : availableRooms;

  // ─── Booking modal ──────────────────────────────────────────────────────────

  function openBook(room) {
    const dayIdx = filterDate ? jsDayToMyDay(new Date(`${filterDate}T00:00`).getDay()) : 0;
    setBookingRoom(room);
    setBookForm({
      ...EMPTY_BOOK,
      date:        filterDate  || TODAY,
      start:       filterStart || "09:00",
      end:         filterEnd   || "10:00",
      dayOfWeek:   dayIdx,
      reservedFor: profile?.id || "",
    });
    setBookErrors({});
    setBookError("");
    setBookSuccess("");
  }

  function bField(key, val) {
    setBookForm((f) => ({ ...f, [key]: val }));
    setBookErrors((prev) => {
      const next = { ...prev, [key]: undefined };
      if (key === "start" || key === "end") {
        const s = key === "start" ? val : bookForm.start;
        const e = key === "end"   ? val : bookForm.end;
        if (key === "start" && s && (s < WORK_START || s >= WORK_END))
          next.start = "Start time must be between 08:00 and 22:00.";
        else if (key === "end" && e && e > WORK_END)
          next.end = "End time cannot exceed 22:00.";
        else if (!next.start && s && e && s >= e)
          next.end = "End time must be after start.";
        else
          next.end = undefined;
      }
      return next;
    });
  }

  async function handleBook() {
    const errs = validateForm(bookForm);
    if (Object.keys(errs).length) { setBookErrors(errs); return; }

    setBooking(true);
    setBookError("");

    const isWeekly = bookForm.recurrence === "weekly";
    const startTs  = isWeekly
      ? weeklyTs(bookForm.dayOfWeek, bookForm.start)
      : localDateToISO(bookForm.date, bookForm.start);
    const endTs    = isWeekly
      ? weeklyTs(bookForm.dayOfWeek, bookForm.end)
      : localDateToISO(bookForm.date, bookForm.end);

    // Conflict check — same recurrence type
    let q = supabase.from("reservations").select("id")
      .eq("room_id", bookingRoom.id).neq("status", "cancelled")
      .eq("recurrence", bookForm.recurrence)
      .lt("start_time", endTs).gt("end_time", startTs);
    if (isWeekly) q = q.eq("day_of_week", bookForm.dayOfWeek);

    const { data: conflicts } = await q;
    if (conflicts?.length) {
      setBookError(
        isWeekly
          ? `This room already has a weekly booking on ${DAYS[bookForm.dayOfWeek]}s at that time.`
          : "This room is already booked for the selected time. Please choose a different slot."
      );
      setBooking(false);
      return;
    }

    // For one-time bookings also check weekly reservations on the same weekday
    if (!isWeekly) {
      const dayOfBooking = jsDayToMyDay(new Date(`${bookForm.date}T00:00`).getDay());
      const wStart = weeklyTs(dayOfBooking, bookForm.start);
      const wEnd   = weeklyTs(dayOfBooking, bookForm.end);
      const { data: wkConflicts } = await supabase.from("reservations").select("id")
        .eq("room_id", bookingRoom.id).neq("status", "cancelled")
        .eq("recurrence", "weekly").eq("day_of_week", dayOfBooking)
        .lt("start_time", wEnd).gt("end_time", wStart);
      if (wkConflicts?.length) {
        setBookError("This room has a recurring weekly booking at that time.");
        setBooking(false);
        return;
      }
    }

    const { error } = await supabase.from("reservations").insert({
      room_id:     bookingRoom.id,
      reserved_by: bookForm.reservedFor,
      start_time:  startTs,
      end_time:    endTs,
      status:      "confirmed",
      label:       bookForm.label.trim(),
      recurrence:  bookForm.recurrence,
      day_of_week: isWeekly ? bookForm.dayOfWeek : null,
    });

    setBooking(false);
    if (error) { setBookError(error.message); return; }

    const when = isWeekly
      ? `every ${DAYS[bookForm.dayOfWeek]}, ${bookForm.start}–${bookForm.end}`
      : `${fmtDate(startTs)}, ${bookForm.start}–${bookForm.end}`;
    setBookSuccess(`"${bookingRoom.name}" reserved successfully — ${when}.`);
    loadMyRes();
    if (isAdmin) loadAllRes();
    if (bookedIds !== null) checkAvailability();
  }

  // ─── Edit modal ─────────────────────────────────────────────────────────────

  function openEdit(res) {
    const isWeekly = res.recurrence === "weekly";
    setEditingRes(res);
    setEditForm({
      label:       res.label       || "",
      recurrence:  res.recurrence  || "one_time",
      date:        isWeekly ? TODAY : isoToLocalDate(res.start_time),
      start:       isoToLocalTime(res.start_time),
      end:         isoToLocalTime(res.end_time),
      dayOfWeek:   res.day_of_week ?? 0,
      status:      res.status,
      reservedFor: res.reserved_by,
    });
    setEditErrors({});
    setEditError("");
  }

  function eField(key, val) {
    setEditForm((f) => ({ ...f, [key]: val }));
    setEditErrors((prev) => {
      const next = { ...prev, [key]: undefined };
      if (key === "start" || key === "end") {
        const s = key === "start" ? val : editForm.start;
        const e = key === "end"   ? val : editForm.end;
        if (key === "start" && s && (s < WORK_START || s >= WORK_END))
          next.start = "Start time must be between 08:00 and 22:00.";
        else if (key === "end" && e && e > WORK_END)
          next.end = "End time cannot exceed 22:00.";
        else if (!next.start && s && e && s >= e)
          next.end = "End time must be after start.";
        else
          next.end = undefined;
      }
      return next;
    });
  }

  async function handleSaveEdit() {
    const errs = validateForm(editForm);
    if (Object.keys(errs).length) { setEditErrors(errs); return; }

    setSaving(true);
    setEditError("");

    const isWeekly = editForm.recurrence === "weekly";
    const startTs  = isWeekly
      ? weeklyTs(editForm.dayOfWeek, editForm.start)
      : localDateToISO(editForm.date, editForm.start);
    const endTs    = isWeekly
      ? weeklyTs(editForm.dayOfWeek, editForm.end)
      : localDateToISO(editForm.date, editForm.end);

    // Conflict check (exclude self) — same recurrence type
    let q = supabase.from("reservations").select("id")
      .eq("room_id", editingRes.room_id).neq("id", editingRes.id)
      .neq("status", "cancelled").eq("recurrence", editForm.recurrence)
      .lt("start_time", endTs).gt("end_time", startTs);
    if (isWeekly) q = q.eq("day_of_week", editForm.dayOfWeek);

    const { data: conflicts } = await q;
    if (conflicts?.length) {
      setEditError(
        isWeekly
          ? `Another weekly booking exists on ${DAYS[editForm.dayOfWeek]}s at that time.`
          : "This room is already booked for the selected time."
      );
      setSaving(false);
      return;
    }

    // For one-time edits also check weekly reservations on the same weekday
    if (!isWeekly) {
      const dayOfBooking = jsDayToMyDay(new Date(`${editForm.date}T00:00`).getDay());
      const wStart = weeklyTs(dayOfBooking, editForm.start);
      const wEnd   = weeklyTs(dayOfBooking, editForm.end);
      const { data: wkConflicts } = await supabase.from("reservations").select("id")
        .eq("room_id", editingRes.room_id).neq("id", editingRes.id)
        .neq("status", "cancelled")
        .eq("recurrence", "weekly").eq("day_of_week", dayOfBooking)
        .lt("start_time", wEnd).gt("end_time", wStart);
      if (wkConflicts?.length) {
        setEditError("This room has a recurring weekly booking at that time.");
        setSaving(false);
        return;
      }
    }

    const { error } = await supabase.from("reservations")
      .update({
        label:       editForm.label.trim(),
        recurrence:  editForm.recurrence,
        start_time:  startTs,
        end_time:    endTs,
        day_of_week: isWeekly ? editForm.dayOfWeek : null,
        status:      editForm.status,
        reserved_by: editForm.reservedFor,
      })
      .eq("id", editingRes.id);

    setSaving(false);
    if (error) { setEditError(error.message); return; }

    setEditingRes(null);
    loadMyRes();
    if (isAdmin) loadAllRes();
    if (bookedIds !== null) checkAvailability();
  }

  // ─── Cancel ─────────────────────────────────────────────────────────────────

  async function handleCancel() {
    setCancelling(true);
    await supabase.from("reservations").update({ status: "cancelled" }).eq("id", cancelId);
    setCancelling(false);
    setCancelId(null);
    loadMyRes();
    if (isAdmin) loadAllRes();
    if (bookedIds !== null) checkAvailability();
  }

  // ─── Maintenance ────────────────────────────────────────────────────────────

  async function handleMarkDone(id) {
    setMarkingDoneId(id);
    await supabase
      .from("maintenance_requests")
      .update({ status: "done", resolved_at: new Date().toISOString() })
      .eq("id", id);
    setMarkingDoneId(null);
    loadMaintRequests();
  }

  // ─── Add room ───────────────────────────────────────────────────────────────

  function openAddRoom() {
    setAddRoomForm(EMPTY_ROOM);
    setAddRoomErrors({});
    setAddRoomError("");
    setAddRoomSuccess("");
    setAddRoomOpen(true);
  }

  function rField(key, val) {
    setAddRoomForm((f) => ({ ...f, [key]: val }));
    setAddRoomErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function handleAddRoom() {
    const errs = validateRoomForm(addRoomForm);
    if (Object.keys(errs).length) { setAddRoomErrors(errs); return; }

    setAddRoomSaving(true);
    setAddRoomError("");

    const { data: existing } = await supabase
      .from("rooms").select("id").ilike("name", addRoomForm.name.trim()).limit(1);
    if (existing?.length) {
      setAddRoomError("A room with this name already exists.");
      setAddRoomSaving(false);
      return;
    }

    const { error } = await supabase.from("rooms").insert({
      name:     addRoomForm.name.trim(),
      type:     addRoomForm.type,
      capacity: Number(addRoomForm.capacity),
      building: addRoomForm.building.trim() || null,
      location: addRoomForm.location.trim(),
    });

    setAddRoomSaving(false);
    if (error) { setAddRoomError(error.message); return; }

    setAddRoomSuccess(`"${addRoomForm.name.trim()}" has been added successfully.`);
    const { data } = await supabase.from("rooms").select("*").order("name");
    setRooms(data || []);
  }

  // ─── Shared reservations table ───────────────────────────────────────────────

  function ReservationsTable({ rows, showReserver }) {
    if (!rows.length) return <p className="empty-state">No reservations found.</p>;
    return (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Room</th>
              <th>Type</th>
              {showReserver && <th>Reserved by</th>}
              <th>Recurrence</th>
              <th>Schedule</th>
              <th>Time</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((res) => (
              <tr key={res.id}>
                <td className="col-name">{res.label || "—"}</td>
                <td>{res.rooms?.name || "—"}</td>
                <td>
                  {res.rooms?.type
                    ? <span className={typeChipClass(res.rooms.type)}>{typeLabel(res.rooms.type)}</span>
                    : "—"}
                </td>
                {showReserver && <td>{res.reserver?.full_name || "—"}</td>}
                <td>
                  <span className={res.recurrence === "weekly" ? "chip chip-blue" : "chip chip-gray"}>
                    {res.recurrence === "weekly" ? "Weekly" : "One-time"}
                  </span>
                </td>
                <td>{fmtSchedule(res)}</td>
                <td className="res-time">{fmtTime(res.start_time)} – {fmtTime(res.end_time)}</td>
                <td>
                  <span className={statusChipClass(res.status)}>
                    {res.status ? res.status.charAt(0).toUpperCase() + res.status.slice(1) : "—"}
                  </span>
                </td>
                <td className="actions-cell">
                  {res.status !== "cancelled" ? (
                    <>
                      <BtnGhost className="btn-xs" onClick={() => openEdit(res)}>Edit</BtnGhost>
                      <BtnGhost className="btn-xs btn-ghost-danger" onClick={() => setCancelId(res.id)}>
                        Cancel
                      </BtnGhost>
                    </>
                  ) : (
                    <span className="text-muted" style={{ fontSize: 12 }}>Cancelled</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ─── Recurrence toggle (reused in both modals) ───────────────────────────────

  function RecurrenceToggle({ value, onChange }) {
    return (
      <div className="recurrence-toggle">
        <button
          type="button"
          className={`recurrence-btn${value === "one_time" ? " recurrence-btn--active" : ""}`}
          onClick={() => onChange("one_time")}
        >
          One-time
        </button>
        <button
          type="button"
          className={`recurrence-btn${value === "weekly" ? " recurrence-btn--active" : ""}`}
          onClick={() => onChange("weekly")}
        >
          Weekly
        </button>
      </div>
    );
  }

  // ─── My-reservations filter ──────────────────────────────────────────────────

  const filteredMyRes = myRes.filter((res) => {
    if (!myResShowCancelled && res.status === "cancelled") return false;
    if (myResFilterRoom && res.room_id !== myResFilterRoom) return false;
    if (myResFilterType && res.rooms?.type !== myResFilterType) return false;
    if (myResFilterDate) {
      if (res.recurrence === "weekly") {
        const dayIdx = jsDayToMyDay(new Date(`${myResFilterDate}T00:00`).getDay());
        if (res.day_of_week !== dayIdx) return false;
      } else {
        if (isoToLocalDate(res.start_time) !== myResFilterDate) return false;
      }
    }
    return true;
  });

  // ─── All-reservations filter ─────────────────────────────────────────────────

  const filteredAllRes = allRes.filter((res) => {
    if (!allResShowCancelled && res.status === "cancelled") return false;
    if (allResFilterRoom && res.room_id !== allResFilterRoom) return false;
    if (allResFilterType && res.rooms?.type !== allResFilterType) return false;
    if (allResFilterDate) {
      if (res.recurrence === "weekly") {
        const dayIdx = jsDayToMyDay(new Date(`${allResFilterDate}T00:00`).getDay());
        if (res.day_of_week !== dayIdx) return false;
      } else {
        if (isoToLocalDate(res.start_time) !== allResFilterDate) return false;
      }
    }
    return true;
  });

  // ─── Render ──────────────────────────────────────────────────────────────────

  const TABS = [
    { id: "rooms", label: "Available Rooms" },
    { id: "mine",  label: "My Reservations" },
    ...(isAdmin ? [{ id: "all",         label: "All Reservations" }] : []),
    ...(isAdmin ? [{ id: "maintenance", label: "Maintenance" }]     : []),
  ];

  return (
    <AppShell title="Facilities">
      <div className="dashboard-stack">

        {/* ── Tab bar ── */}
        <div className="content-card" style={{ padding: "0 20px" }}>
          <nav className="facilities-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`facilities-tab${tab === t.id ? " facilities-tab--active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ══ BROWSE ROOMS ══ */}
        {tab === "rooms" && (
          <>
            <div className="content-card">
              <h2>Check Availability</h2>
              {availError && <p className="error-msg">{availError}</p>}
              <div className="facilities-filter">
                <div className="field">
                  <span>Date</span>
                  <input type="date" value={filterDate} min={TODAY}
                    onChange={(e) => { setFilterDate(e.target.value); setBookedIds(null); }} />
                </div>
                <div className="field">
                  <span>Start time</span>
                  <input type="time" value={filterStart} min={WORK_START} max={WORK_END}
                    onChange={(e) => { setFilterStart(e.target.value); setBookedIds(null); }} />
                </div>
                <div className="field">
                  <span>End time</span>
                  <input type="time" value={filterEnd} min={WORK_START} max={WORK_END}
                    onChange={(e) => { setFilterEnd(e.target.value); setBookedIds(null); }} />
                </div>
                <div className="field">
                  <span>Type</span>
                  <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                    <option value="all">All types</option>
                    <option value="classroom">Classroom</option>
                    <option value="lab">Lab</option>
                  </select>
                </div>
                <div className="field facilities-filter__btn">
                  <span>&nbsp;</span>
                  <BtnPrimary onClick={checkAvailability} disabled={checking}>
                    {checking ? "Checking…" : "Check Availability"}
                  </BtnPrimary>
                </div>
              </div>
            </div>

            <div className="content-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>
                  {bookedIds !== null ? "Available Rooms" : "All Rooms"}
                  {bookedIds !== null && (
                    <span className="admission-filter-count" style={{ marginLeft: 8 }}>
                      {displayedRooms.length} available
                    </span>
                  )}
                </h2>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    className="search-input"
                    placeholder="Search by name or building…"
                    value={roomSearch}
                    onChange={(e) => setRoomSearch(e.target.value)}
                    style={{ width: 220 }}
                  />
                  {isAdmin && (
                    <BtnPrimary onClick={openAddRoom}>+ Add Room</BtnPrimary>
                  )}
                </div>
              </div>

              {roomsLoading && <p className="text-muted">Loading rooms…</p>}

              {!roomsLoading && displayedRooms.length === 0 && (
                <p className="empty-state">
                  {bookedIds !== null
                    ? "No available rooms for the selected time slot."
                    : "No rooms found."}
                </p>
              )}

              {!roomsLoading && displayedRooms.length > 0 && (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Room</th>
                        <th>Type</th>
                        <th>Capacity</th>
                        <th>Building</th>
                        <th>Location</th>
                        {canReserve && <th>Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRooms.map((room) => (
                        <tr key={room.id}>
                          <td className="col-name">{room.name}</td>
                          <td><span className={typeChipClass(room.type)}>{typeLabel(room.type)}</span></td>
                          <td>{room.capacity ?? "—"}</td>
                          <td>{room.building || "—"}</td>
                          <td>{room.location || "—"}</td>
                          {canReserve && (
                            <td>
                              <BtnPrimary className="btn-xs" onClick={() => openBook(room)}>
                                Reserve
                              </BtnPrimary>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ══ MY RESERVATIONS ══ */}
        {tab === "mine" && (
          <div className="content-card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>
                My Reservations
                {(myResFilterDate || myResFilterRoom || myResFilterType) && (
                  <span className="admission-filter-count" style={{ marginLeft: 8 }}>
                    {filteredMyRes.length} result{filteredMyRes.length !== 1 ? "s" : ""}
                  </span>
                )}
              </h2>
            </div>

            <div className="facilities-filter" style={{ marginBottom: 16 }}>
              <div className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={myResFilterDate}
                  onChange={(e) => setMyResFilterDate(e.target.value)}
                />
              </div>
              <div className="field">
                <span>Room</span>
                <select value={myResFilterRoom} onChange={(e) => setMyResFilterRoom(e.target.value)}>
                  <option value="">All rooms</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span>Type</span>
                <select value={myResFilterType} onChange={(e) => setMyResFilterType(e.target.value)}>
                  <option value="">All types</option>
                  <option value="classroom">Classroom</option>
                  <option value="lab">Lab</option>
                </select>
              </div>
              <div className="field" style={{ justifyContent: "flex-end" }}>
                <span>&nbsp;</span>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={myResShowCancelled}
                    onChange={(e) => setMyResShowCancelled(e.target.checked)}
                  />
                  Show cancelled
                </label>
              </div>
              {(myResFilterDate || myResFilterRoom || myResFilterType) && (
                <div className="field facilities-filter__btn">
                  <span>&nbsp;</span>
                  <BtnGhost onClick={() => { setMyResFilterDate(""); setMyResFilterRoom(""); setMyResFilterType(""); }}>
                    Clear filters
                  </BtnGhost>
                </div>
              )}
            </div>

            {myResLoading
              ? <p className="text-muted">Loading…</p>
              : <ReservationsTable rows={filteredMyRes} showReserver={false} />}
          </div>
        )}

        {/* ══ ALL RESERVATIONS (admin) ══ */}
        {tab === "all" && isAdmin && (
          <div className="content-card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>
                All Reservations
                {(allResFilterDate || allResFilterRoom || allResFilterType) && (
                  <span className="admission-filter-count" style={{ marginLeft: 8 }}>
                    {filteredAllRes.length} result{filteredAllRes.length !== 1 ? "s" : ""}
                  </span>
                )}
              </h2>
            </div>

            <div className="facilities-filter" style={{ marginBottom: 16 }}>
              <div className="field">
                <span>Date</span>
                <input
                  type="date"
                  value={allResFilterDate}
                  onChange={(e) => setAllResFilterDate(e.target.value)}
                />
              </div>
              <div className="field">
                <span>Room</span>
                <select value={allResFilterRoom} onChange={(e) => setAllResFilterRoom(e.target.value)}>
                  <option value="">All rooms</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span>Type</span>
                <select value={allResFilterType} onChange={(e) => setAllResFilterType(e.target.value)}>
                  <option value="">All types</option>
                  <option value="classroom">Classroom</option>
                  <option value="lab">Lab</option>
                </select>
              </div>
              <div className="field" style={{ justifyContent: "flex-end" }}>
                <span>&nbsp;</span>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={allResShowCancelled}
                    onChange={(e) => setAllResShowCancelled(e.target.checked)}
                  />
                  Show cancelled
                </label>
              </div>
              {(allResFilterDate || allResFilterRoom || allResFilterType) && (
                <div className="field facilities-filter__btn">
                  <span>&nbsp;</span>
                  <BtnGhost onClick={() => { setAllResFilterDate(""); setAllResFilterRoom(""); setAllResFilterType(""); }}>
                    Clear filters
                  </BtnGhost>
                </div>
              )}
            </div>

            {allResLoading && <p className="text-muted">Loading…</p>}
            {allResError   && <p className="error-msg">{allResError}</p>}
            {!allResLoading && !allResError && (
              <ReservationsTable rows={filteredAllRes} showReserver={true} />
            )}
          </div>
        )}

        {/* ══ MAINTENANCE REQUESTS (admin) ══ */}
        {tab === "maintenance" && isAdmin && (
          <div className="content-card">
            <h2>Maintenance Requests</h2>
            {maintLoading && <p className="text-muted">Loading…</p>}
            {maintError   && <p className="error-msg">{maintError}</p>}
            {!maintLoading && !maintError && (
              maintRequests.length === 0 ? (
                <p className="empty-state">No maintenance requests yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Room</th>
                        <th>Submitted by</th>
                        <th>Description</th>
                        <th>Status</th>
                        <th>Submitted</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {maintRequests.map((req) => (
                        <tr key={req.id}>
                          <td className="col-name">
                            {req.rooms?.name ?? "—"}
                            {req.rooms?.building ? <span className="text-muted"> · {req.rooms.building}</span> : null}
                          </td>
                          <td>{req.submitter?.full_name ?? "—"}</td>
                          <td style={{ maxWidth: 300 }}>{req.description}</td>
                          <td>
                            <span className={req.status === "done" ? "chip chip-green" : "chip chip-gold"}>
                              {req.status === "done" ? "Done" : "Open"}
                            </span>
                          </td>
                          <td>{fmtDate(req.created_at)}</td>
                          <td className="actions-cell">
                            {req.status === "open" ? (
                              <BtnPrimary
                                className="btn-xs"
                                disabled={markingDoneId === req.id}
                                onClick={() => handleMarkDone(req.id)}
                              >
                                {markingDoneId === req.id ? "Saving…" : "Mark Done"}
                              </BtnPrimary>
                            ) : (
                              <span className="text-muted" style={{ fontSize: 12 }}>
                                Resolved {fmtDate(req.resolved_at)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* ══ BOOKING MODAL ══ */}
      {bookingRoom && (
        <div className="modal-overlay" onClick={() => { if (!bookSuccess) setBookingRoom(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>

            {bookSuccess ? (
              <>
                <h2 className="modal__title">Reservation Confirmed</h2>
                <p className="modal__body">{bookSuccess}</p>
                <div className="modal-actions">
                  <BtnPrimary onClick={() => { setBookingRoom(null); setTab("mine"); }}>
                    View My Reservations
                  </BtnPrimary>
                  <BtnGhost onClick={() => setBookingRoom(null)}>Done</BtnGhost>
                </div>
              </>
            ) : (
              <>
                <h2 className="modal__title">Reserve {bookingRoom.name}</h2>
                <div style={{ display: "flex", gap: 8, marginTop: 6, marginBottom: 4, flexWrap: "wrap", alignItems: "center" }}>
                  <span className={typeChipClass(bookingRoom.type)}>{typeLabel(bookingRoom.type)}</span>
                  {bookingRoom.capacity && <span className="chip chip-gray">Capacity {bookingRoom.capacity}</span>}
                  {bookingRoom.building && (
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                      {bookingRoom.building}{bookingRoom.location ? ` · ${bookingRoom.location}` : ""}
                    </span>
                  )}
                </div>

                {bookError && <p className="error-msg">{bookError}</p>}

                <div className="auth-form">
                  {/* Admin: reserve for someone else */}
                  {isAdmin && (
                    <div className="field">
                      <span>Reserve for <span className="text-danger">*</span></span>
                      <select value={bookForm.reservedFor}
                        className={bookErrors.reservedFor ? "has-error" : ""}
                        onChange={(e) => bField("reservedFor", e.target.value)}>
                        <option value="">— Select person —</option>
                        {staffProfiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>
                        ))}
                      </select>
                      {bookErrors.reservedFor && <small>{bookErrors.reservedFor}</small>}
                    </div>
                  )}

                  {/* Label */}
                  <div className="field">
                    <span>Label / Subject <span className="text-danger">*</span></span>
                    <input
                      placeholder="e.g. CS101 Lecture, Lab Session…"
                      value={bookForm.label}
                      className={bookErrors.label ? "has-error" : ""}
                      onChange={(e) => bField("label", e.target.value)}
                    />
                    {bookErrors.label && <small>{bookErrors.label}</small>}
                  </div>

                  {/* Recurrence */}
                  <div className="field">
                    <span>Recurrence</span>
                    <RecurrenceToggle
                      value={bookForm.recurrence}
                      onChange={(v) => bField("recurrence", v)}
                    />
                  </div>

                  {/* Date (one-time) or Day of week (weekly) */}
                  {bookForm.recurrence === "one_time" ? (
                    <div className="field">
                      <span>Date <span className="text-danger">*</span></span>
                      <input type="date" value={bookForm.date} min={TODAY}
                        className={bookErrors.date ? "has-error" : ""}
                        onChange={(e) => bField("date", e.target.value)} />
                      {bookErrors.date && <small>{bookErrors.date}</small>}
                    </div>
                  ) : (
                    <div className="field">
                      <span>Day of week <span className="text-danger">*</span></span>
                      <select value={bookForm.dayOfWeek}
                        onChange={(e) => bField("dayOfWeek", Number(e.target.value))}>
                        {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Start / End times */}
                  <div className="form-row-2">
                    <div className="field">
                      <span>Start time <span className="text-danger">*</span></span>
                      <input type="time" value={bookForm.start} min={WORK_START} max={WORK_END}
                        className={bookErrors.start ? "has-error" : ""}
                        onChange={(e) => bField("start", e.target.value)} />
                      {bookErrors.start
                        ? <small>{bookErrors.start}</small>
                        : <small style={{ color: "var(--text-muted)" }}>08:00 – 22:00</small>}
                    </div>
                    <div className="field">
                      <span>End time <span className="text-danger">*</span></span>
                      <input type="time" value={bookForm.end} min={WORK_START} max={WORK_END}
                        className={bookErrors.end ? "has-error" : ""}
                        onChange={(e) => bField("end", e.target.value)} />
                      {bookErrors.end && <small>{bookErrors.end}</small>}
                    </div>
                  </div>
                </div>

                <div className="modal-actions">
                  <BtnGhost onClick={() => setBookingRoom(null)}>Cancel</BtnGhost>
                  <BtnPrimary disabled={booking} onClick={handleBook}>
                    {booking ? "Reserving…" : "Confirm Reservation"}
                  </BtnPrimary>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ EDIT MODAL ══ */}
      {editingRes && (
        <div className="modal-overlay" onClick={() => setEditingRes(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">Edit Reservation</h2>
            {editError && <p className="error-msg">{editError}</p>}

            <div className="auth-form">
              {isAdmin && (
                <div className="field">
                  <span>Reserved for</span>
                  <select value={editForm.reservedFor}
                    onChange={(e) => eField("reservedFor", e.target.value)}>
                    {staffProfiles.map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="field">
                <span>Label / Subject <span className="text-danger">*</span></span>
                <input placeholder="e.g. CS101 Lecture" value={editForm.label}
                  className={editErrors.label ? "has-error" : ""}
                  onChange={(e) => eField("label", e.target.value)} />
                {editErrors.label && <small>{editErrors.label}</small>}
              </div>

              <div className="field">
                <span>Recurrence</span>
                <RecurrenceToggle
                  value={editForm.recurrence}
                  onChange={(v) => eField("recurrence", v)}
                />
              </div>

              {editForm.recurrence === "one_time" ? (
                <div className="field">
                  <span>Date <span className="text-danger">*</span></span>
                  <input type="date" value={editForm.date}
                    className={editErrors.date ? "has-error" : ""}
                    onChange={(e) => eField("date", e.target.value)} />
                  {editErrors.date && <small>{editErrors.date}</small>}
                </div>
              ) : (
                <div className="field">
                  <span>Day of week</span>
                  <select value={editForm.dayOfWeek}
                    onChange={(e) => eField("dayOfWeek", Number(e.target.value))}>
                    {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}

              <div className="form-row-2">
                <div className="field">
                  <span>Start time <span className="text-danger">*</span></span>
                  <input type="time" value={editForm.start} min={WORK_START} max={WORK_END}
                    className={editErrors.start ? "has-error" : ""}
                    onChange={(e) => eField("start", e.target.value)} />
                  {editErrors.start
                    ? <small>{editErrors.start}</small>
                    : <small style={{ color: "var(--text-muted)" }}>08:00 – 22:00</small>}
                </div>
                <div className="field">
                  <span>End time <span className="text-danger">*</span></span>
                  <input type="time" value={editForm.end} min={WORK_START} max={WORK_END}
                    className={editErrors.end ? "has-error" : ""}
                    onChange={(e) => eField("end", e.target.value)} />
                  {editErrors.end && <small>{editErrors.end}</small>}
                </div>
              </div>

              <div className="field">
                <span>Status</span>
                <select value={editForm.status}
                  onChange={(e) => eField("status", e.target.value)}>
                  <option value="confirmed">Confirmed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div className="modal-actions">
              <BtnGhost onClick={() => setEditingRes(null)}>Cancel</BtnGhost>
              <BtnPrimary disabled={saving} onClick={handleSaveEdit}>
                {saving ? "Saving…" : "Save Changes"}
              </BtnPrimary>
            </div>
          </div>
        </div>
      )}

      {/* ══ ADD ROOM MODAL (admin) ══ */}
      {addRoomOpen && (
        <div className="modal-overlay" onClick={() => { if (!addRoomSuccess) setAddRoomOpen(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {addRoomSuccess ? (
              <>
                <h2 className="modal__title">Room Added</h2>
                <p className="modal__body">{addRoomSuccess}</p>
                <div className="modal-actions">
                  <BtnPrimary onClick={() => { setAddRoomOpen(false); }}>Done</BtnPrimary>
                </div>
              </>
            ) : (
              <>
                <h2 className="modal__title">Add New Room</h2>
                {addRoomError && <p className="error-msg">{addRoomError}</p>}
                <div className="auth-form">
                  <div className="field">
                    <span>Room Name <span className="text-danger">*</span></span>
                    <input
                      placeholder="e.g. Lab 101, Classroom A"
                      value={addRoomForm.name}
                      className={addRoomErrors.name ? "has-error" : ""}
                      onChange={(e) => rField("name", e.target.value)}
                    />
                    {addRoomErrors.name && <small>{addRoomErrors.name}</small>}
                  </div>

                  <div className="field">
                    <span>Type <span className="text-danger">*</span></span>
                    <select value={addRoomForm.type}
                      className={addRoomErrors.type ? "has-error" : ""}
                      onChange={(e) => rField("type", e.target.value)}>
                      <option value="classroom">Classroom</option>
                      <option value="lab">Lab</option>
                    </select>
                    {addRoomErrors.type && <small>{addRoomErrors.type}</small>}
                  </div>

                  <div className="field">
                    <span>Capacity <span className="text-danger">*</span></span>
                    <input
                      type="number" min="1"
                      placeholder="e.g. 30"
                      value={addRoomForm.capacity}
                      className={addRoomErrors.capacity ? "has-error" : ""}
                      onChange={(e) => rField("capacity", e.target.value)}
                    />
                    {addRoomErrors.capacity && <small>{addRoomErrors.capacity}</small>}
                  </div>

                  <div className="field">
                    <span>Location <span className="text-danger">*</span></span>
                    <input
                      placeholder="e.g. Floor 2, Wing B"
                      value={addRoomForm.location}
                      className={addRoomErrors.location ? "has-error" : ""}
                      onChange={(e) => rField("location", e.target.value)}
                    />
                    {addRoomErrors.location && <small>{addRoomErrors.location}</small>}
                  </div>

                  <div className="field">
                    <span>Building</span>
                    <input
                      placeholder="e.g. Engineering Building"
                      value={addRoomForm.building}
                      onChange={(e) => rField("building", e.target.value)}
                    />
                  </div>
                </div>

                <div className="modal-actions">
                  <BtnGhost onClick={() => setAddRoomOpen(false)}>Cancel</BtnGhost>
                  <BtnPrimary disabled={addRoomSaving} onClick={handleAddRoom}>
                    {addRoomSaving ? "Adding…" : "Add Room"}
                  </BtnPrimary>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ CANCEL CONFIRMATION ══ */}
      {cancelId && (
        <div className="modal-overlay" onClick={() => setCancelId(null)}>
          <div className="modal modal--sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal__title">Cancel Reservation?</h2>
            <p className="modal__body">
              The time slot will become available again. This cannot be undone.
            </p>
            <div className="modal-actions">
              <BtnGhost onClick={() => setCancelId(null)}>Keep it</BtnGhost>
              <BtnPrimary className="btn-danger" disabled={cancelling} onClick={handleCancel}>
                {cancelling ? "Cancelling…" : "Yes, Cancel"}
              </BtnPrimary>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
