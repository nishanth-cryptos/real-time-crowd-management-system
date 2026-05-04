import React, { useState, useEffect } from 'react';
import { X, TrendingUp, TrendingDown, Minus, BarChart2, Clock } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

export default function AnalyticsPanel({ zone, onClose }) {
  const [history,  setHistory]  = useState([]);
  const [forecast, setForecast] = useState([]);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!zone) return;
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const [histRes, fcastRes] = await Promise.all([
          axios.get(`${API_URL}/history/${zone.id}`),
          axios.get(`${API_URL}/forecast/${zone.id}`),
        ]);
        if (!active) return;
        if (histRes.data.success)  setHistory(histRes.data.data);
        if (fcastRes.data.success) setForecast(fcastRes.data.forecast);
      } catch (e) {
        console.error('Analytics fetch error:', e);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    const interval = setInterval(load, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [zone?.id]);

  if (!zone) return null;

  // History chart: last 30 min (360 ticks × 5s)
  const historyChartData = history.slice(-360).map(doc => ({
    time: new Date(doc.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    population: doc.population,
  }));

  // Forecast chart: split into actual vs predicted series (null for the other)
  const forecastChartData = forecast.map(p => ({
    time:      p.time,
    actual:    p.predicted ? null : p.population,
    predicted: p.predicted ? p.population : null,
  }));

  // Derived stats
  const populations = history.map(d => d.population);
  const peakOccupancy = populations.length ? Math.max(...populations) : 0;
  const avgPop        = populations.length
    ? Math.round(populations.reduce((s, p) => s + p, 0) / populations.length)
    : 0;

  let trend = 'Stable', TrendIcon = Minus, trendColor = 'text-slate-400';
  if (populations.length >= 6) {
    const recent = populations.slice(-3).reduce((s, p) => s + p, 0) / 3;
    const older  = populations.slice(-6, -3).reduce((s, p) => s + p, 0) / 3;
    const diff   = ((recent - older) / (older || 1)) * 100;
    if (diff > 3)       { trend = 'Rising';  TrendIcon = TrendingUp;   trendColor = 'text-red-400'; }
    else if (diff < -3) { trend = 'Falling'; TrendIcon = TrendingDown; trendColor = 'text-emerald-400'; }
  }

  const pct = Math.round((zone.population / zone.capacity) * 100);
  const threshold85 = Math.round(zone.capacity * 0.85);

  return (
    <div className="fixed top-0 right-0 h-full w-[600px] bg-slate-900 border-l border-slate-700 z-40
                    overflow-y-auto shadow-2xl">

      {/* Header */}
      <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-5 flex justify-between items-center z-10">
        <div>
          <h2 className="text-xl font-bold">{zone.name}</h2>
          <p className="text-slate-400 text-sm">Zone Analytics — last 15 min + 6h forecast</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
          <X className="w-6 h-6" />
        </button>
      </div>

      {loading && history.length === 0 && (
        <div className="flex justify-center items-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      )}

      <div className="p-5 space-y-6">

        {/* Key stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800 rounded-lg p-4">
            <p className="text-slate-400 text-xs mb-1">Current Occupancy</p>
            <p className="text-2xl font-bold text-white">{pct}%</p>
            <p className="text-xs text-slate-500">{zone.population.toLocaleString()} / {zone.capacity.toLocaleString()}</p>
          </div>
          <div className="bg-slate-800 rounded-lg p-4">
            <p className="text-slate-400 text-xs mb-1">Peak (15 min)</p>
            <p className="text-2xl font-bold text-orange-400">{peakOccupancy.toLocaleString()}</p>
            <p className="text-xs text-slate-500">avg: {avgPop.toLocaleString()}</p>
          </div>
          <div className="bg-slate-800 rounded-lg p-4">
            <p className="text-slate-400 text-xs mb-1">Trend</p>
            <p className={`text-2xl font-bold flex items-center gap-1 ${trendColor}`}>
              <TrendIcon className="w-5 h-5" /> {trend}
            </p>
            <p className="text-xs text-slate-500">last 6 samples</p>
          </div>
        </div>

        {/* History chart */}
        <div className="bg-slate-800/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-slate-300">
            <Clock className="w-4 h-4 text-blue-400" />
            Population — Last 15 Minutes
          </h3>
          {historyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={historyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" stroke="#94a3b8" style={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis stroke="#94a3b8" style={{ fontSize: 10 }} domain={[0, zone.capacity]} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', fontSize: 11, borderRadius: 8 }}
                />
                <ReferenceLine
                  y={threshold85} stroke="#ef4444" strokeDasharray="4 2"
                  label={{ value: '85%', fill: '#ef4444', fontSize: 10 }}
                />
                <Line
                  type="monotone" dataKey="population" name="Population"
                  stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-500 text-sm text-center py-8">
              {loading ? 'Loading…' : 'No history data yet — check back in a few seconds.'}
            </p>
          )}
        </div>

        {/* Forecast chart */}
        <div className="bg-slate-800/50 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-2 text-slate-300">
            <BarChart2 className="w-4 h-4 text-purple-400" />
            Forecast — Next 6 Hours
          </h3>
          <p className="text-xs text-slate-500 mb-3">Linear regression on last 20 snapshots</p>
          {forecastChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={forecastChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" stroke="#94a3b8" style={{ fontSize: 10 }} />
                <YAxis stroke="#94a3b8" style={{ fontSize: 10 }} domain={[0, zone.capacity]} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', fontSize: 11, borderRadius: 8 }}
                  formatter={(v, name) => [`${Number(v).toLocaleString()} people`, name]}
                />
                <Legend />
                <Line
                  type="monotone" dataKey="actual" name="Actual"
                  stroke="#3b82f6" strokeWidth={2}
                  dot={{ r: 4, fill: '#3b82f6' }} connectNulls={false} isAnimationActive={false}
                />
                <Line
                  type="monotone" dataKey="predicted" name="Forecast"
                  stroke="#a855f7" strokeWidth={2} strokeDasharray="6 3"
                  dot={{ r: 3, fill: '#a855f7' }} connectNulls={false} isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-500 text-sm text-center py-8">
              {loading ? 'Loading…' : 'Forecast available after 20 data points accumulate (~2 min).'}
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
