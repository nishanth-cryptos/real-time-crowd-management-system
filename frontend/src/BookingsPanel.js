import React, { useState } from 'react';
import { Calendar, Clock, Users, Trash2, CheckCircle, Activity, AlertCircle } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

const STATUS_STYLES = {
  active:    { bg: 'bg-emerald-500/10 border-emerald-500/30', badge: 'bg-emerald-600',  label: 'Active Now' },
  upcoming:  { bg: 'bg-blue-500/10 border-blue-500/30',       badge: 'bg-blue-600',     label: 'Upcoming'   },
  completed: { bg: 'bg-slate-700/30 border-slate-600',         badge: 'bg-slate-600',    label: 'Completed'  },
  cancelled: { bg: 'bg-red-500/10 border-red-500/30',          badge: 'bg-red-700',      label: 'Cancelled'  },
};

const StatusIcon = ({ status }) =>
  status === 'active'    ? <Activity className="w-4 h-4" />    :
  status === 'completed' ? <CheckCircle className="w-4 h-4" /> :
  status === 'upcoming'  ? <Clock className="w-4 h-4" />       :
                           <AlertCircle className="w-4 h-4" />;

const fmt = (dt) => new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (dt) => new Date(dt).toLocaleDateString([], { month: 'short', day: 'numeric' });

export default function BookingsPanel({ bookings, onCancel }) {
  const [tab, setTab] = useState('all');
  const [cancelling, setCancelling] = useState(null);

  const tabs = [
    { key: 'all',      label: 'All',       items: bookings },
    { key: 'active',   label: 'Active',    items: bookings.filter(b => b.status === 'active') },
    { key: 'upcoming', label: 'Upcoming',  items: bookings.filter(b => b.status === 'upcoming') },
    { key: 'done',     label: 'Completed', items: bookings.filter(b => b.status === 'completed') },
  ];

  const displayed = tabs.find(t => t.key === tab)?.items || [];

  const handleCancel = async (id) => {
    if (!window.confirm('Cancel this booking?')) return;
    setCancelling(id);
    try {
      await axios.delete(`${API_URL}/bookings/${id}`);
      onCancel();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to cancel booking');
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-xl p-6">
      <div className="flex justify-between items-center mb-5">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-400" />
          Zone Bookings
        </h3>
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                tab === t.key ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
            >
              {t.label}
              {t.items.length > 0 && (
                <span className="ml-1.5 bg-slate-600 text-slate-300 rounded-full px-1.5 py-0.5 text-xs">
                  {t.items.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {displayed.length === 0 ? (
        <div className="text-center text-slate-500 py-10">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No bookings in this category</p>
          <p className="text-xs mt-1">Click "Book" on any zone card to reserve a space</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map(b => {
            const s = STATUS_STYLES[b.status] || STATUS_STYLES.upcoming;
            return (
              <div key={b._id} className={`border rounded-xl p-4 ${s.bg}`}>
                <div className="flex justify-between items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 ${s.badge} text-white`}>
                        <StatusIcon status={b.status} />
                        {s.label}
                      </span>
                      <span className="text-xs text-blue-400 font-semibold">{b.zoneName}</span>
                    </div>

                    <p className="font-semibold text-white truncate">{b.eventName}</p>
                    <p className="text-slate-400 text-sm mt-0.5">Organised by {b.organizer}</p>

                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {fmtDate(b.startTime)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {fmt(b.startTime)} – {fmt(b.endTime)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {b.expectedAttendance.toLocaleString()} expected
                      </span>
                    </div>
                  </div>

                  {b.status === 'upcoming' && (
                    <button
                      onClick={() => handleCancel(b._id)}
                      disabled={cancelling === b._id}
                      className="shrink-0 text-slate-400 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-900/30"
                      title="Cancel booking"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
