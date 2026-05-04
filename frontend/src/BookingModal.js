import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, XCircle, Users, Clock, Calendar, User, Tag } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

const today = () => new Date().toISOString().split('T')[0];
const nowTime = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function BookingModal({ zone, onClose, onBooked }) {
  const [form, setForm] = useState({
    eventName: '',
    organizer: '',
    expectedAttendance: '',
    date: today(),
    startTime: nowTime(),
    endTime: '',
  });

  const [conflicts,     setConflicts]     = useState([]);
  const [alternatives,  setAlternatives]  = useState([]);
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState('');
  const [checkingConflict, setCheckingConflict] = useState(false);

  const pct = form.expectedAttendance
    ? Math.round((parseInt(form.expectedAttendance) / zone.capacity) * 100)
    : 0;

  // ── Capacity analysis ──────────────────────────────────────────────────────
  const capacityStatus = (() => {
    if (!form.expectedAttendance) return null;
    if (pct > 100) return { level: 'error',   label: `Over capacity by ${pct - 100}%`,          color: 'text-red-400',    icon: 'x' };
    if (pct > 85)  return { level: 'warning', label: `High load — ${pct}% of capacity`,          color: 'text-yellow-400', icon: 'warn' };
    if (pct > 60)  return { level: 'caution', label: `Moderate load — ${pct}% of capacity`,      color: 'text-orange-400', icon: 'warn' };
    return          { level: 'ok',      label: `Good fit — only ${pct}% of capacity used`,        color: 'text-emerald-400', icon: 'check' };
  })();

  // ── Live zone occupancy indicator ──────────────────────────────────────────
  const liveOccPct = Math.round((zone.population / zone.capacity) * 100);
  const liveStatus = zone.status === 'overcrowded' ? { label: 'Currently Overcrowded', color: 'text-red-400' }
                   : zone.status === 'moderate'    ? { label: 'Currently Moderate',    color: 'text-yellow-400' }
                   :                                 { label: 'Currently Available',    color: 'text-emerald-400' };

  // ── Check conflicts whenever date/time changes ─────────────────────────────
  useEffect(() => {
    if (!form.date || !form.startTime || !form.endTime) return;
    const start = new Date(`${form.date}T${form.startTime}`);
    const end   = new Date(`${form.date}T${form.endTime}`);
    if (end <= start) return;

    setCheckingConflict(true);
    axios.get(`${API_URL}/bookings/zone/${zone.id}`)
      .then(res => {
        if (!res.data.success) return;
        const overlapping = res.data.bookings.filter(b => {
          const bs = new Date(b.startTime), be = new Date(b.endTime);
          return bs < end && be > start && b.status !== 'cancelled' && b.status !== 'completed';
        });
        setConflicts(overlapping);
      })
      .catch(() => {})
      .finally(() => setCheckingConflict(false));
  }, [form.date, form.startTime, form.endTime, zone.id]);

  // ── Fetch alternatives whenever conflict exists or capacity exceeded ────────
  useEffect(() => {
    if (!form.date || !form.startTime || !form.endTime || !form.expectedAttendance) {
      setAlternatives([]);
      return;
    }
    const hasIssue = conflicts.length > 0 || pct > 100;
    if (!hasIssue) { setAlternatives([]); return; }

    const start = `${form.date}T${form.startTime}`;
    const end   = `${form.date}T${form.endTime}`;
    axios.get(`${API_URL}/bookings/alternatives/${zone.id}`, {
      params: { startTime: start, endTime: end, expectedAttendance: form.expectedAttendance }
    }).then(res => {
      if (res.data.success) setAlternatives(res.data.alternatives);
    }).catch(() => {});
  }, [conflicts.length, pct, form.date, form.startTime, form.endTime, form.expectedAttendance, zone.id]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setError('');
    if (!form.eventName || !form.organizer || !form.expectedAttendance || !form.endTime) {
      setError('Please fill all fields.'); return;
    }
    const start = new Date(`${form.date}T${form.startTime}`);
    const end   = new Date(`${form.date}T${form.endTime}`);
    if (end <= start) { setError('End time must be after start time.'); return; }

    setSubmitting(true);
    try {
      await axios.post(`${API_URL}/bookings`, {
        zoneId:             zone.id,
        eventName:          form.eventName,
        organizer:          form.organizer,
        expectedAttendance: parseInt(form.expectedAttendance),
        startTime:          start.toISOString(),
        endTime:            end.toISOString(),
      });
      onBooked();
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Booking failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const canBook = capacityStatus?.level !== 'error' && conflicts.length === 0 && form.eventName && form.organizer && form.expectedAttendance && form.endTime;

  const StatusIcon = ({ type }) =>
    type === 'check' ? <CheckCircle className="w-4 h-4" /> :
    type === 'x'     ? <XCircle className="w-4 h-4" /> :
                       <AlertTriangle className="w-4 h-4" />;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* ── Header ── */}
        <div className="flex justify-between items-start p-6 border-b border-slate-700">
          <div>
            <h2 className="text-2xl font-bold">Book {zone.name}</h2>
            <p className="text-slate-400 text-sm mt-1">Reserve this space for your event</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-6">

          {/* ── Live Zone Status ── */}
          <div className="bg-slate-800/60 border border-slate-600 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">Live Zone Status</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-slate-400 mb-1">Right Now</p>
                <p className={`font-bold text-sm ${liveStatus.color}`}>{liveStatus.label}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Occupancy</p>
                <p className="font-bold text-white">{zone.population.toLocaleString()} / {zone.capacity.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Fill Level</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${zone.status === 'overcrowded' ? 'bg-red-500' : zone.status === 'moderate' ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(liveOccPct, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-white">{liveOccPct}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Booking Form ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-sm text-slate-400 mb-1 flex items-center gap-1">
                <Tag className="w-3 h-3" /> Event Name
              </label>
              <input
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="e.g. Annual Tech Symposium"
                value={form.eventName}
                onChange={e => setForm(f => ({ ...f, eventName: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1 flex items-center gap-1">
                <User className="w-3 h-3" /> Organizer Name
              </label>
              <input
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="Your name"
                value={form.organizer}
                onChange={e => setForm(f => ({ ...f, organizer: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1 flex items-center gap-1">
                <Users className="w-3 h-3" /> Expected Attendance
              </label>
              <input
                type="number" min="1" max={zone.capacity + 100}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder={`Max ${zone.capacity.toLocaleString()}`}
                value={form.expectedAttendance}
                onChange={e => setForm(f => ({ ...f, expectedAttendance: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Date
              </label>
              <input
                type="date" min={today()}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm text-slate-400 mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Start
                </label>
                <input
                  type="time"
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                  value={form.startTime}
                  onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> End
                </label>
                <input
                  type="time"
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                  value={form.endTime}
                  onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                />
              </div>
            </div>
          </div>

          {/* ── Smart Analysis ── */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-300">Smart Analysis</h3>

            {/* Capacity check */}
            {capacityStatus && (
              <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-slate-800/60 ${capacityStatus.color}`}>
                <StatusIcon type={capacityStatus.icon} />
                {capacityStatus.label}
                {pct <= 100 && (
                  <span className="ml-auto text-slate-500 text-xs">{pct}% used</span>
                )}
              </div>
            )}

            {/* Conflict check */}
            {form.endTime && form.startTime && (
              checkingConflict
                ? <div className="text-xs text-slate-400 px-3 py-2 bg-slate-800/60 rounded-lg">Checking availability…</div>
                : conflicts.length > 0
                  ? conflicts.map(c => (
                      <div key={c._id} className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg bg-red-900/30 text-red-400 border border-red-500/30">
                        <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>
                          Conflict: <span className="font-semibold">{c.eventName}</span> by {c.organizer}
                          {' · '}
                          {new Date(c.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –
                          {new Date(c.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))
                  : form.expectedAttendance && (
                      <div className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-emerald-900/30 text-emerald-400">
                        <CheckCircle className="w-4 h-4" />
                        No conflicts — this slot is free
                      </div>
                    )
            )}

            {/* Live status warning */}
            {zone.status !== 'normal' && (
              <div className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-yellow-900/30 text-yellow-400">
                <AlertTriangle className="w-4 h-4" />
                Note: Zone is {zone.status} right now. Plan for crowd management during your event.
              </div>
            )}
          </div>

          {/* ── Alternative Zones ── */}
          {alternatives.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-300 mb-2">
                {conflicts.length > 0 ? 'Try These Available Zones Instead' : 'Alternative Zones with More Capacity'}
              </h3>
              <div className="space-y-2">
                {alternatives.map(alt => {
                  const altColor = alt.status === 'overcrowded' ? 'text-red-400' : alt.status === 'moderate' ? 'text-yellow-400' : 'text-emerald-400';
                  return (
                    <div key={alt.zoneId} className="flex items-center justify-between bg-slate-800/60 border border-slate-600 rounded-lg px-4 py-3">
                      <div>
                        <span className="font-semibold text-white">{alt.zoneName}</span>
                        <span className="text-slate-400 text-xs ml-2">Capacity: {alt.capacity.toLocaleString()}</span>
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-semibold ${altColor}`}>{alt.occupancyPct}% full</span>
                        <p className={`text-xs ${altColor}`}>{alt.status}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Error message ── */}
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/30 border border-red-500/30 rounded-lg px-4 py-3">
              <XCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}

          {/* ── Action Buttons ── */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 bg-slate-700 hover:bg-slate-600 px-6 py-3 rounded-xl font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canBook || submitting}
              className={`flex-1 px-6 py-3 rounded-xl font-semibold transition-all ${
                canBook && !submitting
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'
              }`}
            >
              {submitting ? 'Booking…' : canBook ? 'Confirm Booking' : 'Fix Issues Above'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
