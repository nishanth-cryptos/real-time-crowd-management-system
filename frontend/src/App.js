import React, { useState, useEffect, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import {
  Users, Activity, TrendingUp, AlertCircle, RefreshCw,
  Wifi, WifiOff, AlertTriangle, Play, Pause, SkipBack,
  Zap, Shield, Server, Share2, CalendarPlus, BookOpen, Bell
} from 'lucide-react';
import {
  subscribeToZoneUpdates, requestManualUpdate, getConnectionStatus,
  disconnectSocket, connectSocket
} from './socket';
import axios from 'axios';
import BookingModal    from './BookingModal';
import BookingsPanel   from './BookingsPanel';
import SankeyChart     from './SankeyChart';
import AlertPanel      from './AlertPanel';
import AnalyticsPanel  from './AnalyticsPanel';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

// ─── Campus topology (mirrors backend CAMPUS_GRAPH) ─────────────────────────
const ZONE_POSITIONS = {
  AB1:     { x: 80,  y: 80  },
  AB2:     { x: 240, y: 80  },
  AB3:     { x: 400, y: 80  },
  AB4:     { x: 560, y: 80  },
  Admin:   { x: 80,  y: 220 },
  Library: { x: 240, y: 220 },
  Gazebo:  { x: 400, y: 220 },
  MBA:     { x: 560, y: 220 },
  North:   { x: 160, y: 340 },
};

const CAMPUS_EDGES = [
  ['AB1', 'AB2'], ['AB2', 'AB3'], ['AB3', 'AB4'],
  ['AB1', 'Admin'], ['AB2', 'Library'], ['AB3', 'Gazebo'], ['AB4', 'MBA'],
  ['Admin', 'Library'], ['Admin', 'North'], ['AB1', 'North'],
  ['North', 'Gazebo'], ['Gazebo', 'MBA'],
];

const EXIT_ZONES = ['AB1', 'AB3'];

// ─── Network-mode label system ───────────────────────────────────────────────
const NETWORK_LABELS = {
  population: 'Packets',
  density:    'Queue Depth',
  capacity:   'Buffer Size',
  cluster:    'Subnet',
  normal:     'Routing',
  moderate:   'Congested',
  overcrowded:'Buffer Overflow',
  zone:       'Router',
};

const NORMAL_LABELS = {
  population: 'Population',
  density:    'Density',
  capacity:   'Capacity',
  cluster:    'Cluster',
  normal:     'Normal',
  moderate:   'Moderate',
  overcrowded:'Overcrowded',
  zone:       'Zone',
};

// ─── Health Gauge (SVG circle) ───────────────────────────────────────────────
const HealthGauge = ({ score, grade }) => {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#eab308' : '#ef4444';
  return (
    <div className="flex flex-col items-center">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#1e293b" strokeWidth="9" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dasharray 1s ease' }}
        />
        <text x="50" y="45" textAnchor="middle" fill="white" fontSize="20" fontWeight="bold">{score}</text>
        <text x="50" y="63" textAnchor="middle" fill={color} fontSize="13" fontWeight="bold">{grade}</text>
      </svg>
      <p className="text-slate-400 text-xs mt-1">Campus Health</p>
    </div>
  );
};

// ─── Network Topology SVG ─────────────────────────────────────────────────────
const NetworkTopologyView = ({ zones, evacuationRoutes }) => {
  // Collect all edges that appear in any evacuation path
  const evacuationEdgeSet = new Set();
  Object.values(evacuationRoutes || {}).forEach(({ path }) => {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      evacuationEdgeSet.add(`${a}-${b}`);
      evacuationEdgeSet.add(`${b}-${a}`);
    }
  });

  const statusColor = (zoneId) => {
    const z = zones.find(z => z.id === zoneId);
    if (!z) return '#64748b';
    if (z.status === 'overcrowded') return '#ef4444';
    if (z.status === 'moderate')    return '#eab308';
    return '#10b981';
  };

  const isExit = (id) => EXIT_ZONES.includes(id);

  return (
    <svg viewBox="0 0 660 400" className="w-full" style={{ maxHeight: 380 }}>
      {/* Edges */}
      {CAMPUS_EDGES.map(([a, b]) => {
        const pa = ZONE_POSITIONS[a], pb = ZONE_POSITIONS[b];
        if (!pa || !pb) return null;
        const isEvac = evacuationEdgeSet.has(`${a}-${b}`);
        return (
          <g key={`${a}-${b}`}>
            <line
              x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
              stroke={isEvac ? '#f97316' : '#334155'}
              strokeWidth={isEvac ? 3 : 1.5}
              strokeDasharray={isEvac ? '6 3' : undefined}
            />
            {isEvac && (
              <text
                x={(pa.x + pb.x) / 2} y={(pa.y + pb.y) / 2 - 6}
                fill="#f97316" fontSize="9" textAnchor="middle"
              >route</text>
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {Object.entries(ZONE_POSITIONS).map(([id, pos]) => {
        const color = statusColor(id);
        const exit = isExit(id);
        const zone = zones.find(z => z.id === id);
        const pct = zone ? Math.round((zone.population / zone.capacity) * 100) : 0;
        return (
          <g key={id}>
            {exit && (
              <circle cx={pos.x} cy={pos.y} r={28} fill="none"
                stroke="#f97316" strokeWidth={2} strokeDasharray="4 2" opacity={0.6} />
            )}
            <circle cx={pos.x} cy={pos.y} r={22} fill="#1e293b" stroke={color} strokeWidth={2.5} />
            <text x={pos.x} y={pos.y - 3} textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">
              {id.length > 5 ? id.slice(0, 5) : id}
            </text>
            <text x={pos.x} y={pos.y + 9} textAnchor="middle" fill={color} fontSize="8">
              {pct}%
            </text>
            {exit && (
              <text x={pos.x} y={pos.y + 37} textAnchor="middle" fill="#f97316" fontSize="8" fontWeight="bold">
                EXIT
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

// ─── Normalize zones from REST (_id) or socket (zoneId) ──────────────────────
const normalizeZones = (raw) =>
  raw.map(z => ({
    id:         z._id || z.zoneId,
    name:       z.zoneName,
    population: z.population,
    density:    z.density,
    cluster:    z.cluster,
    capacity:   z.capacity,
    status:     z.status,
  }));

// ─── App ──────────────────────────────────────────────────────────────────────
const App = () => {
  const [zones,          setZones]          = useState([]);
  const [trendData,      setTrendData]      = useState([]);
  const [forecastData,   setForecastData]   = useState([]);
  const [currentTime,    setCurrentTime]    = useState(new Date());
  const [isConnected,    setIsConnected]    = useState(false);
  const [summary,        setSummary]        = useState({ totalPopulation: 0, activeZones: 0, avgDensity: 0, flowTrend: 0 });

  // ── Phase 2 state ──
  const [evacuationMode,   setEvacuationMode]   = useState(false);
  const [evacuationRoutes, setEvacuationRoutes] = useState({});
  const [networkMode,      setNetworkMode]      = useState(false);
  const [protocolMode,     setProtocolMode]     = useState('websocket');
  const [latency,          setLatency]          = useState({ ws: 0, poll: 0, history: [] });
  const [replayMode,       setReplayMode]       = useState(false);
  const [replaySnapshots,  setReplaySnapshots]  = useState([]);
  const [replayIndex,      setReplayIndex]      = useState(0);
  const [replayPlaying,    setReplayPlaying]    = useState(false);
  const [healthScore,      setHealthScore]      = useState({ score: 100, grade: 'A' });

  // ── Flow / Sankey state ──
  const [flowData, setFlowData] = useState([]);

  // ── Booking state ──
  const [bookings,          setBookings]          = useState([]);
  const [showBookingsPanel, setShowBookingsPanel] = useState(false);
  const [bookingZone,       setBookingZone]       = useState(null); // zone object for modal

  // ── Alert panel state ──
  const [showAlertPanel,   setShowAlertPanel]   = useState(false);
  const [unreadAlertCount, setUnreadAlertCount] = useState(0);
  const alertPanelOpenRef = useRef(false);

  // ── Analytics panel state ──
  const [analyticsZone, setAnalyticsZone] = useState(null);

  const pollingRef = useRef(null);
  const labels = networkMode ? NETWORK_LABELS : NORMAL_LABELS;

  // ── Initial data fetch ────────────────────────────────────────────────────
  const fetchInitialData = async () => {
    try {
      const [zonesRes, summaryRes, bookingsRes] = await Promise.all([
        axios.get(`${API_URL}/zones`),
        axios.get(`${API_URL}/summary`),
        axios.get(`${API_URL}/bookings`),
      ]);
      if (zonesRes.data.success)    setZones(normalizeZones(zonesRes.data.data));
      if (summaryRes.data.success) {
        const s = summaryRes.data.summary;
        setSummary(prev => ({ ...prev, totalPopulation: s.totalPopulation, activeZones: s.activeZones }));
        if (s.health) setHealthScore(s.health);
      }
      if (bookingsRes.data.success) setBookings(bookingsRes.data.bookings);
    } catch (e) {
      console.error('Fetch error:', e);
    }
  };

  const fetchBookings = async () => {
    try {
      const res = await axios.get(`${API_URL}/bookings`);
      if (res.data.success) setBookings(res.data.bookings);
    } catch (e) { console.error('Bookings fetch error:', e); }
  };

  useEffect(() => { fetchInitialData(); }, []);

  // ── WebSocket subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (protocolMode !== 'websocket') return;

    const unsubscribe = subscribeToZoneUpdates((payload) => {
      // Measure WS latency using server timestamp
      if (payload.serverTimestamp) {
        const wsMs = Date.now() - payload.serverTimestamp;
        setLatency(prev => ({
          ...prev,
          ws: wsMs,
          history: [...prev.history.slice(-29), { t: Date.now(), mode: 'ws', value: wsMs }]
        }));
      }

      const data = payload.zones || payload;
      const normalized = normalizeZones(data);

      if (!replayMode) setZones(normalized);

      // Evacuation state
      if (payload.evacuationMode !== undefined) setEvacuationMode(payload.evacuationMode);
      if (payload.evacuationRoutes)             setEvacuationRoutes(payload.evacuationRoutes);
      if (payload.health)                       setHealthScore(payload.health);
      if (payload.flowData)                     setFlowData(payload.flowData);

      // Trend
      const totalPop   = data.reduce((s, z) => s + z.population, 0);
      const activeZones = data.filter(z => z.population > 0).length;
      const avgDensity  = Math.floor(data.reduce((s, z) => s + z.density, 0) / data.length);

      setTrendData(prev => {
        const next = [...prev];
        if (next.length >= 12) next.shift();
        next.push({ time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), population: totalPop });
        return next;
      });

      setSummary(prev => ({
        totalPopulation: totalPop,
        activeZones,
        avgDensity,
        flowTrend: prev.flowTrend,
      }));
    });

    // Listen for real-time booking changes pushed by server
    const { default: socketInstance } = require('./socket');
    const onBookingUpdate = (updated) => setBookings(updated);
    socketInstance.on('bookingUpdate', onBookingUpdate);

    // Listen for real-time alerts — increment badge when panel is closed
    const onNewAlert = () => {
      if (!alertPanelOpenRef.current) {
        setUnreadAlertCount(c => c + 1);
      }
    };
    socketInstance.on('newAlert', onNewAlert);

    const connInterval = setInterval(() => setIsConnected(getConnectionStatus()), 1000);
    return () => {
      unsubscribe();
      socketInstance.off('bookingUpdate', onBookingUpdate);
      socketInstance.off('newAlert', onNewAlert);
      clearInterval(connInterval);
    };
  }, [protocolMode, replayMode]);

  // ── HTTP Polling mode ─────────────────────────────────────────────────────
  useEffect(() => {
    if (protocolMode === 'websocket') {
      connectSocket();
      clearInterval(pollingRef.current);
      return;
    }

    disconnectSocket();
    setIsConnected(false);

    pollingRef.current = setInterval(async () => {
      const t0 = Date.now();
      try {
        const res = await axios.get(`${API_URL}/poll`);
        const pollMs = Date.now() - t0;
        if (res.data.success) {
          const normalized = normalizeZones(res.data.data);
          if (!replayMode) setZones(normalized);

          const totalPop = res.data.data.reduce((s, z) => s + z.population, 0);
          const avgDensity = Math.floor(res.data.data.reduce((s, z) => s + z.density, 0) / res.data.data.length);

          setTrendData(prev => {
            const next = [...prev];
            if (next.length >= 12) next.shift();
            next.push({ time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), population: totalPop });
            return next;
          });

          setSummary(prev => ({ ...prev, totalPopulation: totalPop, avgDensity }));
          setLatency(prev => ({
            ...prev,
            poll: pollMs,
            history: [...prev.history.slice(-29), { t: Date.now(), mode: 'poll', value: pollMs }]
          }));
        }
      } catch (e) { console.error('Poll error:', e); }
    }, 2000);

    return () => clearInterval(pollingRef.current);
  }, [protocolMode, replayMode]);

  // ── Clock ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Keep ref in sync so socket handler doesn't capture stale showAlertPanel
  useEffect(() => { alertPanelOpenRef.current = showAlertPanel; }, [showAlertPanel]);

  // ── Forecast (real — linear regression via /api/forecast per zone) ─────────
  useEffect(() => {
    if (!zones.length) return;
    Promise.all(
      zones.map(z => axios.get(`${API_URL}/forecast/${z.id}`).catch(() => null))
    ).then(results => {
      const totals = {};
      results.forEach(res => {
        if (!res?.data?.success) return;
        res.data.forecast.filter(p => p.predicted).forEach(p => {
          totals[p.time] = (totals[p.time] || 0) + p.population;
        });
      });
      const aggregated = Object.entries(totals).map(([time, population]) => ({ time, population }));
      if (aggregated.length) setForecastData(aggregated);
    });
  }, [zones]);

  // ── Replay playback ticker ────────────────────────────────────────────────
  useEffect(() => {
    if (!replayPlaying) return;
    const t = setInterval(() => {
      setReplayIndex(i => {
        if (i >= replaySnapshots.length - 1) { setReplayPlaying(false); return i; }
        return i + 1;
      });
    }, 600);
    return () => clearInterval(t);
  }, [replayPlaying, replaySnapshots.length]);

  // Sync replay frame → zones display
  useEffect(() => {
    if (!replayMode || !replaySnapshots[replayIndex]) return;
    setZones(normalizeZones(replaySnapshots[replayIndex].zones));
  }, [replayIndex, replayMode, replaySnapshots]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleRefresh = () => { requestManualUpdate(); fetchInitialData(); };

  const handleEvacuationToggle = async () => {
    try {
      const endpoint = evacuationMode ? '/evacuation/stop' : '/evacuation/start';
      const res = await axios.post(`${API_URL}${endpoint}`);
      if (res.data.success) {
        setEvacuationMode(!evacuationMode);
        if (res.data.routes) setEvacuationRoutes(res.data.routes);
        else setEvacuationRoutes({});
      }
    } catch (e) { console.error('Evacuation toggle error:', e); }
  };

  const loadReplaySnapshots = async () => {
    try {
      const res = await axios.get(`${API_URL}/snapshots?limit=60`);
      if (res.data.success && res.data.snapshots.length) {
        setReplaySnapshots(res.data.snapshots);
        setReplayIndex(0);
        setReplayMode(true);
        setReplayPlaying(false);
      }
    } catch (e) { console.error('Replay load error:', e); }
  };

  const exitReplay = () => { setReplayMode(false); setReplayPlaying(false); };

  // ── Derived helpers ───────────────────────────────────────────────────────
  const displayZones = zones;

  const calculateFlowTrend = () => {
    if (trendData.length < 2) return '0.0';
    const a = trendData[trendData.length - 2].population;
    const b = trendData[trendData.length - 1].population;
    return (((b - a) / (a || 1)) * 100).toFixed(1);
  };

  const getStatusColor  = s => s === 'overcrowded' ? 'bg-red-500'    : s === 'moderate' ? 'bg-yellow-500'    : 'bg-emerald-500';
  const getStatusBg     = s => s === 'overcrowded' ? 'bg-red-500/10 border-red-500/30' : s === 'moderate' ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-emerald-500/10 border-emerald-500/30';
  const getStatusRing   = s => s === 'overcrowded' ? 'text-red-400'  : s === 'moderate' ? 'text-yellow-400'  : 'text-emerald-400';

  // Latency chart data — last 20 data points
  const latencyChartData = latency.history.slice(-20).map((p, i) => ({
    i,
    latency: p.value,
    mode: p.mode,
  }));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">

      {/* ── HEADER ── */}
      <div className="flex justify-between items-start mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-lg ${evacuationMode ? 'bg-red-600 animate-pulse' : 'bg-blue-600'}`}>
            {evacuationMode ? <AlertTriangle className="w-8 h-8" /> : <Users className="w-8 h-8" />}
          </div>
          <div>
            <h1 className="text-3xl font-bold">
              {networkMode ? 'Campus Network Monitor' : 'Crowd Management System'}
            </h1>
            <p className="text-slate-400 text-sm">
              {networkMode
                ? 'Students = Packets · Zones = Routers · Capacity = Buffer Size'
                : 'Real-time crowd monitoring with DBSCAN clustering'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Alerts bell */}
          <button
            onClick={() => { setShowAlertPanel(p => !p); setUnreadAlertCount(0); }}
            className="relative p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            title="Alerts"
          >
            <Bell className="w-5 h-5 text-slate-300" />
            {unreadAlertCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full
                               w-4 h-4 flex items-center justify-center font-bold leading-none">
                {unreadAlertCount > 9 ? '9+' : unreadAlertCount}
              </span>
            )}
          </button>

          <HealthGauge score={healthScore.score} grade={healthScore.grade} />

          {/* Network Mode Toggle */}
          <button
            onClick={() => setNetworkMode(m => !m)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              networkMode ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-cyan-700'
            }`}
          >
            <Share2 className="w-4 h-4" />
            {networkMode ? 'Network View ON' : 'Network View'}
          </button>

          {/* Bookings */}
          <button
            onClick={() => setShowBookingsPanel(p => !p)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all relative ${
              showBookingsPanel ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            Bookings
            {bookings.filter(b => b.status === 'active').length > 0 && (
              <span className="absolute -top-1 -right-1 bg-emerald-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                {bookings.filter(b => b.status === 'active').length}
              </span>
            )}
          </button>

          {/* Replay */}
          <button
            onClick={loadReplaySnapshots}
            className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm transition-all"
          >
            <SkipBack className="w-4 h-4" />
            Replay
          </button>

          {/* Evacuation */}
          <button
            onClick={handleEvacuationToggle}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
              evacuationMode
                ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                : 'bg-slate-700 hover:bg-red-600 text-slate-300'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            {evacuationMode ? 'EVACUATION ACTIVE' : 'Evacuation Mode'}
          </button>

          {/* Refresh + connection */}
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors text-sm"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <div className="flex items-center gap-2">
            {isConnected
              ? <Wifi className="w-4 h-4 text-emerald-500" />
              : <WifiOff className="w-4 h-4 text-red-500" />}
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-sm">{isConnected ? 'Live' : protocolMode === 'polling' ? 'Polling' : 'Disconnected'}</span>
          </div>
          <div className="text-sm text-slate-400">{currentTime.toLocaleTimeString()}</div>
        </div>
      </div>

      {/* ── NETWORK METRICS (packet-router analogy panel) ── */}
      {networkMode && (
        <div className="bg-cyan-900/20 border border-cyan-500/30 rounded-xl p-5 mb-8">
          <h3 className="text-cyan-400 font-semibold mb-4 flex items-center gap-2">
            <Server className="w-5 h-5" /> Network Packet Metrics
            <span className="text-xs text-slate-400 font-normal ml-2">
              Students = Packets · Zones = Routers · Capacity = Buffer Size
            </span>
          </h3>
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-slate-800/60 rounded-lg p-4">
              <p className="text-cyan-400 text-xs mb-1">Buffer Overflows</p>
              <p className="text-2xl font-bold text-red-400">
                {displayZones.filter(z => z.status === 'overcrowded').length}
              </p>
              <p className="text-slate-500 text-xs mt-1">routers at capacity</p>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-4">
              <p className="text-cyan-400 text-xs mb-1">Congested Routers</p>
              <p className="text-2xl font-bold text-yellow-400">
                {displayZones.filter(z => z.status === 'moderate').length}
              </p>
              <p className="text-slate-500 text-xs mt-1">above 60% load</p>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-4">
              <p className="text-cyan-400 text-xs mb-1">Avg Queue Depth</p>
              <p className="text-2xl font-bold text-cyan-300">{summary.avgDensity}</p>
              <p className="text-slate-500 text-xs mt-1">packets/unit</p>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-4">
              <p className="text-cyan-400 text-xs mb-1">Total Packets</p>
              <p className="text-2xl font-bold text-white">{summary.totalPopulation.toLocaleString()}</p>
              <p className="text-slate-500 text-xs mt-1">in-flight campus-wide</p>
            </div>
          </div>
        </div>
      )}

      {/* ── STATS CARDS ── */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-xl p-6 hover:border-slate-600 transition-all">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-slate-400 text-sm mb-1">{networkMode ? 'Total Packets' : 'Total Population'}</p>
              <h3 className="text-3xl font-bold">{summary.totalPopulation.toLocaleString()}</h3>
              <p className="text-slate-400 text-xs mt-1 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> campus-wide
              </p>
            </div>
            <div className="bg-emerald-500 p-3 rounded-lg"><Users className="w-6 h-6" /></div>
          </div>
        </div>

        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-xl p-6 hover:border-slate-600 transition-all">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-slate-400 text-sm mb-1">{networkMode ? 'Active Routers' : 'Active Zones'}</p>
              <h3 className="text-3xl font-bold">{summary.activeZones}</h3>
              <p className="text-slate-400 text-xs mt-1 flex items-center gap-1">
                <Activity className="w-3 h-3" /> online
              </p>
            </div>
            <div className="bg-purple-500 p-3 rounded-lg"><Activity className="w-6 h-6" /></div>
          </div>
        </div>

        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-xl p-6 hover:border-slate-600 transition-all">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-slate-400 text-sm mb-1">{networkMode ? 'Avg Queue Depth' : 'Avg Density'}</p>
              <h3 className="text-3xl font-bold">{summary.avgDensity}</h3>
              <p className="text-slate-400 text-xs mt-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> ppl/unit
              </p>
            </div>
            <div className="bg-orange-500 p-3 rounded-lg"><AlertCircle className="w-6 h-6" /></div>
          </div>
        </div>

        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-xl p-6 hover:border-slate-600 transition-all">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-slate-400 text-sm mb-1">Flow Trend</p>
              <h3 className="text-3xl font-bold">{calculateFlowTrend()}%</h3>
              <p className="text-slate-400 text-xs mt-1 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> vs last update
              </p>
            </div>
            <div className="bg-blue-500 p-3 rounded-lg"><Activity className="w-6 h-6" /></div>
          </div>
        </div>
      </div>

      {/* ── PROTOCOL COMPARISON PANEL ── */}
      <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-xl p-6 mb-8">
        <div className="flex justify-between items-center mb-5">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              Protocol Comparison — HTTP Polling vs WebSocket
            </h3>
            <p className="text-slate-400 text-xs mt-1">
              Live proof: toggle the protocol and watch latency change in real time
            </p>
          </div>
          <button
            onClick={() => setProtocolMode(p => p === 'websocket' ? 'polling' : 'websocket')}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg font-semibold transition-all ${
              protocolMode === 'websocket'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-orange-600 hover:bg-orange-700'
            }`}
          >
            {protocolMode === 'websocket' ? <Wifi className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
            {protocolMode === 'websocket' ? 'WebSocket Active — Switch to Polling' : 'HTTP Polling Active — Switch to WebSocket'}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className={`rounded-lg p-4 text-center border ${protocolMode === 'websocket' ? 'border-emerald-500/50 bg-emerald-900/20' : 'border-slate-600 bg-slate-800/40'}`}>
            <p className="text-slate-400 text-xs mb-1">WebSocket Latency</p>
            <p className="text-4xl font-bold text-emerald-400">{latency.ws}<span className="text-lg">ms</span></p>
            <p className="text-slate-500 text-xs mt-1">push-based, persistent connection</p>
          </div>
          <div className={`rounded-lg p-4 text-center border ${protocolMode === 'polling' ? 'border-orange-500/50 bg-orange-900/20' : 'border-slate-600 bg-slate-800/40'}`}>
            <p className="text-slate-400 text-xs mb-1">HTTP Poll Latency</p>
            <p className="text-4xl font-bold text-orange-400">{latency.poll || '—'}<span className="text-lg">ms</span></p>
            <p className="text-slate-500 text-xs mt-1">request/response every 2s</p>
          </div>
          <div className="rounded-lg p-4 text-center border border-slate-600 bg-slate-800/40">
            <p className="text-slate-400 text-xs mb-1">Speedup Factor</p>
            <p className="text-4xl font-bold text-cyan-400">
              {latency.ws && latency.poll ? `${Math.round(latency.poll / latency.ws)}x` : '—'}
            </p>
            <p className="text-slate-500 text-xs mt-1">WebSocket is faster</p>
          </div>
        </div>

        {latencyChartData.length > 1 && (
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={latencyChartData}>
              <XAxis dataKey="i" hide />
              <YAxis hide />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: 11 }}
                formatter={(v) => [`${v}ms`, 'Latency']}
              />
              <Line type="monotone" dataKey="latency" stroke={protocolMode === 'websocket' ? '#10b981' : '#f97316'}
                strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── CHARTS ── */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">
            {networkMode ? 'Packet Flow (Past Updates)' : 'Population Trend (Past Updates)'}
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" style={{ fontSize: '12px' }} />
              <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} />
              <Legend />
              <Line type="monotone" dataKey="population"
                name={networkMode ? 'Packets' : 'Population'}
                stroke="#3b82f6" strokeWidth={2}
                dot={{ fill: '#3b82f6', r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold mb-4">Forecast (Next 6 Hours)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={forecastData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#94a3b8" style={{ fontSize: '12px' }} />
              <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} />
              <Legend />
              <Bar dataKey="population" name={networkMode ? 'Packets' : 'Population'} fill="#10b981" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── SANKEY FLOW CHART ── */}
      <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-xl p-6 mb-8">
        <div className="flex justify-between items-center mb-2">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Zap className="w-5 h-5 text-purple-400" />
              {networkMode ? 'Packet Flow — Router-to-Router Movement' : 'Student Flow — Zone-to-Zone Movement'}
            </h3>
            <p className="text-slate-400 text-xs mt-1">
              Streams show where students are moving right now. Wider = more movement. Driven by density differential between connected zones.
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>Updates every 5s</p>
            <p className="text-purple-400 font-semibold">{flowData.length} active flows</p>
          </div>
        </div>
        <SankeyChart flows={flowData} zones={displayZones} />
      </div>

      {/* ── BOOKINGS PANEL ── */}
      {showBookingsPanel && (
        <div className="mb-8">
          <BookingsPanel bookings={bookings} onCancel={fetchBookings} />
        </div>
      )}

      {/* ── EVACUATION TOPOLOGY PANEL ── */}
      {evacuationMode && (
        <div className="bg-red-900/10 border border-red-500/40 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-red-400 font-semibold text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Dijkstra Evacuation Routing — Active
            </h3>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <span className="inline-block w-8 h-0.5 bg-orange-500 border-dashed border-t-2 border-orange-500"></span>
                Evacuation path
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full border-2 border-orange-400"></span>
                Exit gate
              </span>
            </div>
          </div>
          <NetworkTopologyView zones={displayZones} evacuationRoutes={evacuationRoutes} />
          <div className="grid grid-cols-3 gap-3 mt-4">
            {Object.entries(evacuationRoutes).slice(0, 6).map(([zoneId, r]) => (
              <div key={zoneId} className="bg-slate-800/60 rounded-lg px-3 py-2 text-xs">
                <span className="text-white font-semibold">{zoneId}</span>
                <span className="text-slate-400 mx-1">→</span>
                <span className="text-orange-400">{r.path.join(' → ')}</span>
                <span className="text-slate-500 ml-1">(cost {r.cost})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ZONE CARDS ── */}
      <div>
        <h3 className="text-xl font-semibold mb-4">
          {networkMode ? 'Router Status' : 'Zone-wise Population'}
          {replayMode && (
            <span className="ml-3 text-sm bg-blue-600 px-2 py-1 rounded font-normal">
              REPLAY — {replaySnapshots[replayIndex]
                ? new Date(replaySnapshots[replayIndex].timestamp).toLocaleTimeString()
                : ''}
            </span>
          )}
        </h3>

        <div className="grid grid-cols-3 gap-4">
          {displayZones.map(zone => {
            const pct = Math.round((zone.population / zone.capacity) * 100);
            const evac = evacuationRoutes[zone.id];

            return (
              <div
                key={zone.id}
                onClick={() => setAnalyticsZone(zone)}
                className={`border rounded-xl p-5 transition-all duration-500 hover:scale-105 cursor-pointer ${getStatusBg(zone.status)}`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h4 className="font-semibold text-lg">{zone.name}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <div className={`w-2 h-2 rounded-full ${getStatusColor(zone.status)}`} />
                      <span className={`text-xs capitalize ${getStatusRing(zone.status)}`}>
                        {labels[zone.status] || zone.status}
                      </span>
                      {networkMode && <span className="text-xs text-slate-500">({labels.zone})</span>}
                    </div>
                  </div>
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(zone.status)}`} />
                </div>

                {/* Occupancy / buffer fill bar */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>{networkMode ? 'Buffer fill' : 'Occupancy'}</span>
                    <span className={getStatusRing(zone.status)}>{pct}%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-700 ${
                        pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">{labels.population}:</span>
                    <span className="font-semibold text-blue-400">{zone.population.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">{labels.capacity}:</span>
                    <span className="font-semibold text-slate-300">{zone.capacity.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">{labels.density}:</span>
                    <span className="font-semibold text-cyan-400">{zone.density}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">{labels.cluster}:</span>
                    <span className="font-semibold text-purple-400">#{zone.cluster}</span>
                  </div>
                </div>

                {/* Active booking badge */}
                {(() => {
                  const activeBooking = bookings.find(b => b.zoneId === zone.id && b.status === 'active');
                  const upcomingCount = bookings.filter(b => b.zoneId === zone.id && b.status === 'upcoming').length;
                  return (activeBooking || upcomingCount > 0) && (
                    <div className="mt-3 pt-3 border-t border-slate-600">
                      {activeBooking && (
                        <div className="flex items-center gap-2 text-xs text-emerald-400 mb-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="font-semibold">{activeBooking.eventName}</span>
                          <span className="text-slate-500">— in progress</span>
                        </div>
                      )}
                      {upcomingCount > 0 && (
                        <p className="text-xs text-blue-400">{upcomingCount} upcoming booking{upcomingCount > 1 ? 's' : ''}</p>
                      )}
                    </div>
                  );
                })()}

                {/* Book button */}
                <button
                  onClick={(e) => { e.stopPropagation(); setBookingZone(zone); }}
                  className="mt-3 w-full flex items-center justify-center gap-2 bg-slate-700/60 hover:bg-blue-600 border border-slate-600 hover:border-blue-500 text-slate-300 hover:text-white text-xs font-semibold py-2 rounded-lg transition-all"
                >
                  <CalendarPlus className="w-3 h-3" /> Book This Zone
                </button>

                {/* Evacuation route overlay */}
                {evacuationMode && evac && (
                  <div className="mt-3 pt-3 border-t border-red-500/30">
                    <div className="text-xs text-red-400 font-semibold mb-1 flex items-center gap-1">
                      <Shield className="w-3 h-3" /> Evacuation Route
                    </div>
                    <div className="text-xs text-slate-300">
                      {evac.path.join(' → ')}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Exit: <span className="text-orange-400 font-semibold">{evac.exit}</span>
                      <span className="ml-2">Cost: {evac.cost}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── BOOKING MODAL ── */}
      {bookingZone && (
        <BookingModal
          zone={bookingZone}
          onClose={() => setBookingZone(null)}
          onBooked={fetchBookings}
        />
      )}

      {/* ── ALERT PANEL ── */}
      <AlertPanel isOpen={showAlertPanel} onClose={() => setShowAlertPanel(false)} />

      {/* ── ANALYTICS PANEL ── */}
      <AnalyticsPanel zone={analyticsZone} onClose={() => setAnalyticsZone(null)} />

      {/* ── REPLAY BAR (fixed bottom) ── */}
      {replayMode && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/97 border-t border-slate-700 px-6 py-3 flex items-center gap-4 z-50">
          <span className="text-slate-400 text-xs font-semibold w-14">REPLAY</span>

          <button
            onClick={() => setReplayIndex(0)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={() => setReplayPlaying(p => !p)}
            className="bg-blue-600 hover:bg-blue-700 p-1.5 rounded transition-colors"
          >
            {replayPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <input
            type="range" min={0} max={Math.max(0, replaySnapshots.length - 1)}
            value={replayIndex}
            onChange={e => { setReplayPlaying(false); setReplayIndex(Number(e.target.value)); }}
            className="flex-1 accent-blue-500"
          />

          <span className="text-slate-400 text-xs w-44 text-right shrink-0">
            {replayIndex + 1} / {replaySnapshots.length}
            {' · '}
            {replaySnapshots[replayIndex]
              ? new Date(replaySnapshots[replayIndex].timestamp).toLocaleTimeString()
              : ''}
          </span>

          <button
            onClick={exitReplay}
            className="text-slate-400 hover:text-white text-xs border border-slate-600 px-3 py-1 rounded transition-colors"
          >
            Exit Replay
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
