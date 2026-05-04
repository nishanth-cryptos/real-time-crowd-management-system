import React, { useState, useEffect } from 'react';
import { X, Bell, AlertTriangle, Info, CheckCircle, Trash2 } from 'lucide-react';
import axios from 'axios';
import socket from './socket';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString)) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

const SEVERITY = {
  critical: { Icon: AlertTriangle, color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30'     },
  warning:  { Icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  info:     { Icon: Info,          color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/30'   },
};

const TABS = ['all', 'critical', 'warning', 'info'];

export default function AlertPanel({ isOpen, onClose }) {
  const [alerts,    setAlerts]    = useState([]);
  const [tab,       setTab]       = useState('all');
  const [dismissed, setDismissed] = useState(new Set());
  const [toasts,    setToasts]    = useState([]);

  // Load initial alert history
  useEffect(() => {
    axios.get(`${API_URL}/alerts`)
      .then(res => { if (res.data.success) setAlerts(res.data.alerts); })
      .catch(console.error);
  }, []);

  // Listen for live alerts
  useEffect(() => {
    const handler = (alert) => {
      setAlerts(prev => [alert, ...prev].slice(0, 100));
      setToasts(prev => [...prev, alert]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== alert.id));
      }, 4000);
    };
    socket.on('newAlert', handler);
    return () => socket.off('newAlert', handler);
  }, []);

  const visibleAlerts = alerts.filter(a =>
    !dismissed.has(a.id) && (tab === 'all' || a.severity === tab)
  );

  const countFor = (t) =>
    t === 'all'
      ? alerts.filter(a => !dismissed.has(a.id)).length
      : alerts.filter(a => !dismissed.has(a.id) && a.severity === t).length;

  const dismiss = (id) => setDismissed(prev => new Set([...prev, id]));
  const clearAll = () => setDismissed(new Set(alerts.map(a => a.id)));

  return (
    <>
      {/* Toast stack — always visible, top-right */}
      <div className="fixed top-4 right-4 z-[60] space-y-2 w-80 pointer-events-none">
        {toasts.map(t => {
          const { Icon, color, bg } = SEVERITY[t.severity] || SEVERITY.info;
          return (
            <div key={t.id}
              className={`flex items-start gap-3 p-3 rounded-lg border ${bg} shadow-xl pointer-events-auto`}
            >
              <Icon className={`w-4 h-4 mt-0.5 ${color} shrink-0`} />
              <p className="text-sm text-white leading-snug">{t.message}</p>
            </div>
          );
        })}
      </div>

      {/* Slide-in alert panel */}
      <div
        className={`fixed top-0 right-0 h-full w-96 bg-slate-900 border-l border-slate-700 z-50
                    transform transition-transform duration-300 ease-in-out shadow-2xl flex flex-col
                    ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700 shrink-0">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Bell className="w-5 h-5 text-yellow-400" />
            Alert Log
            <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-400">
              {countFor('all')}
            </span>
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={clearAll}
              className="text-slate-400 hover:text-white text-xs flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3 h-3" /> Clear all
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 p-3 border-b border-slate-700 shrink-0">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all
                          ${tab === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
            >
              {t}
              <span className="ml-1 text-slate-500 font-normal">({countFor(t)})</span>
            </button>
          ))}
        </div>

        {/* Alert list */}
        <div className="overflow-y-auto flex-1 p-3 space-y-2">
          {visibleAlerts.length === 0 && (
            <div className="text-center text-slate-500 mt-16">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No alerts</p>
            </div>
          )}
          {visibleAlerts.map(alert => {
            const { Icon, color, bg } = SEVERITY[alert.severity] || SEVERITY.info;
            return (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-3 rounded-lg border ${bg} group`}
              >
                <Icon className={`w-4 h-4 mt-0.5 ${color} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white leading-snug">{alert.message}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {alert.zone && (
                      <span className="text-xs text-slate-500 font-mono">{alert.zone}</span>
                    )}
                    <span className="text-xs text-slate-600">{timeAgo(alert.timestamp)}</span>
                  </div>
                </div>
                <button
                  onClick={() => dismiss(alert.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-slate-300 transition-all shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
