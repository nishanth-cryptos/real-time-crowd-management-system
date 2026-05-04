const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const DBSCAN = require('density-clustering').DBSCAN;
require('dotenv').config();

const Zone    = require('./models/Zone');
const Booking = require('./models/Booking');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/crowd_management';
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB Connected');
  })
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    console.error('\n💡 MongoDB is not running or not installed.');
    console.error('   Option 1: Install MongoDB locally');
    console.error('   Option 2: Use MongoDB Atlas (cloud): https://cloud.mongodb.com');
    console.error('   Option 3: Run with Docker: docker run -d -p 27017:27017 mongo\n');
  });

// Handle MongoDB connection issues
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected');
});


// Campus zones configuration
const ZONES = [
  { id: 'AB1', name: 'AB1', capacity: 5880 },
  { id: 'AB2', name: 'AB2', capacity: 250 },
  { id: 'AB3', name: 'AB3', capacity: 5880 },
  { id: 'AB4', name: 'AB4', capacity: 5880 },
  { id: 'Library', name: 'Library', capacity: 300 },
  { id: 'Admin', name: 'Admin Block', capacity: 250 },
  { id: 'North', name: 'North Square', capacity: 200 },
  { id: 'Gazebo', name: 'Gazebo', capacity: 200 },
  { id: 'MBA', name: 'MBA Amphitheater', capacity: 150 }
];

// Campus topology — zones as routers, edges as network links (base weights = distance)
const CAMPUS_GRAPH = {
  'AB1':     { 'AB2': 1, 'North': 2, 'Admin': 3 },
  'AB2':     { 'AB1': 1, 'AB3': 1, 'Library': 2 },
  'AB3':     { 'AB2': 1, 'AB4': 1, 'Gazebo': 2 },
  'AB4':     { 'AB3': 1, 'MBA': 2 },
  'Library': { 'AB2': 2, 'Admin': 1 },
  'Admin':   { 'AB1': 3, 'Library': 1, 'North': 1 },
  'North':   { 'AB1': 2, 'Admin': 1, 'Gazebo': 1 },
  'Gazebo':  { 'AB3': 2, 'North': 1, 'MBA': 1 },
  'MBA':     { 'AB4': 2, 'Gazebo': 1 }
};

// Exit zones = campus gates where students evacuate to
const EXIT_ZONES = ['AB1', 'AB3'];

let evacuationMode = false;
let lastZoneData = [];

// ── Alert system ──────────────────────────────────────────────────────────────
const alertLog = [];          // newest-first, capped at 100
const activeAlerts = new Set(); // tracks currently active alert keys (dedup)
let alertIdCounter = 0;

function makeAlert({ type, zone, message, severity }) {
  return { id: ++alertIdCounter, timestamp: new Date().toISOString(), type, zone, message, severity };
}
function pushAlert(alert) {
  alertLog.unshift(alert);
  if (alertLog.length > 100) alertLog.pop();
  io.emit('newAlert', alert);
}

// Dijkstra's algorithm — finds shortest weighted path from source to all nodes
// Edge weights scale up with neighbor congestion (congested routers = slow links)
function dijkstra(source, currentZones) {
  const dist = {};
  const prev = {};
  const visited = new Set();

  Object.keys(CAMPUS_GRAPH).forEach(n => {
    dist[n] = Infinity;
    prev[n] = null;
  });
  dist[source] = 0;

  while (true) {
    let u = null;
    Object.keys(dist).forEach(n => {
      if (!visited.has(n) && (u === null || dist[n] < dist[u])) u = n;
    });
    if (u === null || dist[u] === Infinity) break;
    visited.add(u);

    Object.entries(CAMPUS_GRAPH[u] || {}).forEach(([v, baseWeight]) => {
      const neighborState = currentZones.find(z => z.zoneId === v);
      const congestion = neighborState ? (neighborState.population / neighborState.capacity) : 0;
      // Cost rises with congestion — heavily loaded routers slow down packet forwarding
      const cost = dist[u] + baseWeight * (1 + congestion);
      if (cost < dist[v]) {
        dist[v] = cost;
        prev[v] = u;
      }
    });
  }
  return { dist, prev };
}

// For every zone, compute the cheapest Dijkstra path to any exit
function getEvacuationRoutes(currentZones) {
  const routes = {};

  Object.keys(CAMPUS_GRAPH).forEach(zoneId => {
    let bestExit = null;
    let bestPath = [];
    let bestCost = Infinity;

    EXIT_ZONES.forEach(exit => {
      const { dist, prev } = dijkstra(zoneId, currentZones);
      if (dist[exit] < bestCost) {
        bestCost = dist[exit];
        bestExit = exit;

        // Reconstruct path by walking prev[] backwards
        const path = [];
        let cur = exit;
        while (cur !== null) {
          path.unshift(cur);
          cur = prev[cur];
        }
        bestPath = path;
      }
    });

    routes[zoneId] = {
      exit: bestExit,
      path: bestPath,
      cost: Math.round(bestCost * 10) / 10
    };
  });

  return routes;
}

// Student flow between connected zones — directional, driven by load differential
// High-load zones push students toward lower-load neighbors along graph edges
function computeFlowData(zones) {
  const zoneMap = {};
  zones.forEach(z => zoneMap[z.zoneId] = z);

  const flows = [];
  const seen = new Set();

  Object.entries(CAMPUS_GRAPH).forEach(([fromId, neighbors]) => {
    Object.entries(neighbors).forEach(([toId]) => {
      const edgeKey = [fromId, toId].sort().join('|');
      if (seen.has(edgeKey)) return;
      seen.add(edgeKey);

      const a = zoneMap[fromId], b = zoneMap[toId];
      if (!a || !b) return;

      const loadA = a.population / a.capacity;
      const loadB = b.population / b.capacity;
      const diff  = Math.abs(loadA - loadB);

      if (diff < 0.05) return; // negligible pressure — no meaningful flow

      const [src, tgt] = loadA > loadB ? [a, b] : [b, a];
      const value = Math.max(1, Math.round(diff * Math.min(src.population, 600) * 0.12));

      flows.push({
        from:       src.zoneId,
        fromName:   src.zoneName,
        to:         tgt.zoneId,
        toName:     tgt.zoneName,
        value,
        fromStatus: src.status,
        toStatus:   tgt.status,
        fromLoad:   Math.round(loadA * 100),
        toLoad:     Math.round(loadB * 100),
      });
    });
  });

  // Return strongest flows first, cap at 8 for readability
  return flows.sort((a, b) => b.value - a.value).slice(0, 8);
}

// Campus health score: 0 (critical) → 100 (healthy)
function calculateHealthScore(zones) {
  if (!zones.length) return { score: 100, grade: 'A' };

  const totalCapacity = zones.reduce((s, z) => s + z.capacity, 0);
  const totalPop = zones.reduce((s, z) => s + z.population, 0);
  const overcrowded = zones.filter(z => z.status === 'overcrowded').length;
  const moderate = zones.filter(z => z.status === 'moderate').length;

  const occupancyScore = Math.max(0, 100 - ((totalPop / totalCapacity) * 100));
  const score = Math.max(0, Math.min(100, Math.round(
    occupancyScore - (overcrowded * 10) - (moderate * 3)
  )));
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

  return { score, grade };
}

// Simulate network activity and generate crowd data
function generateNetworkActivity() {
  const data = ZONES.map(zone => {
    // Simulate Wi-Fi connected devices with realistic variance
    const basePopulation = zone.capacity * 0.3; // 30% base occupancy
    const variance = Math.random() * zone.capacity * 0.5; // Up to 50% variance
    const population = Math.floor(basePopulation + variance);
    
    // Generate random coordinates for DBSCAN clustering
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      population: population,
      capacity: zone.capacity,
      coordinates: [x, y]
    };
  });
  
  return data;
}

// Apply DBSCAN clustering to detect crowd density
function applyDBSCAN(zoneData) {
  const dbscan = new DBSCAN();
  
  // Extract coordinates for clustering
  const coordinates = zoneData.map(z => z.coordinates);
  
  // Run DBSCAN (epsilon: 30, minPoints: 2)
  const clusters = dbscan.run(coordinates, 30, 2);
  
  // Assign cluster IDs to zones
  const clusteredData = zoneData.map((zone, idx) => {
    let clusterId = -1; // Noise point by default
    
    clusters.forEach((cluster, clusterIdx) => {
      if (cluster.includes(idx)) {
        clusterId = clusterIdx;
      }
    });
    
    // Calculate density based on population and capacity
    const density = Math.floor((zone.population / zone.capacity) * 120);
    
    // Determine crowd status
    const percentage = (zone.population / zone.capacity) * 100;
    let status = 'normal';
    if (percentage > 85) status = 'overcrowded';
    else if (percentage > 60) status = 'moderate';
    
    return {
      zoneId: zone.zoneId,
      zoneName: zone.zoneName,
      population: zone.population,
      density: density,
      cluster: clusterId === -1 ? 0 : clusterId + 1,
      capacity: zone.capacity,
      status: status,
      timestamp: new Date()
    };
  });
  
  return clusteredData;
}

// Save zone data to MongoDB
async function saveZoneData(zoneData) {
  try {
    await Zone.insertMany(zoneData);
    console.log('📊 Zone data saved to MongoDB');
  } catch (error) {
    console.error('❌ Error saving zone data:', error);
  }
}

// Real-time data generation and broadcasting
function startRealTimeUpdates() {
  setInterval(async () => {
    console.log('🔄 Generating new crowd data...');
    
    // Generate network activity
    const networkData = generateNetworkActivity();
    
    // Apply DBSCAN clustering
    const clusteredData = applyDBSCAN(networkData);
    
    // Save to MongoDB
    await saveZoneData(clusteredData);

    // Cache latest zone state for on-demand evacuation computation
    lastZoneData = clusteredData;

    // Compute evacuation routes if mode is active
    const evacuationRoutes = evacuationMode ? getEvacuationRoutes(clusteredData) : null;
    const health = calculateHealthScore(clusteredData);

    // ── Alert generation ──────────────────────────────────────────────────────
    // Per-zone overcrowded / resolved alerts
    clusteredData.forEach(zone => {
      const key = `zone:${zone.zoneId}`;
      const isOvercrowded = zone.status === 'overcrowded';
      if (isOvercrowded && !activeAlerts.has(key)) {
        activeAlerts.add(key);
        const pct = Math.round((zone.population / zone.capacity) * 100);
        pushAlert(makeAlert({
          type: 'overcrowded', zone: zone.zoneId, severity: 'critical',
          message: `${zone.zoneName} is overcrowded at ${pct}% capacity (${zone.population}/${zone.capacity})`
        }));
      }
      if (!isOvercrowded && activeAlerts.has(key)) {
        activeAlerts.delete(key);
        const pct = Math.round((zone.population / zone.capacity) * 100);
        pushAlert(makeAlert({
          type: 'resolved', zone: zone.zoneId, severity: 'info',
          message: `${zone.zoneName} returned to normal — now at ${pct}% capacity`
        }));
      }
    });
    // Campus health alert
    const healthKey = 'health:low';
    if (health.score < 50 && !activeAlerts.has(healthKey)) {
      activeAlerts.add(healthKey);
      pushAlert(makeAlert({
        type: 'health', zone: null, severity: 'warning',
        message: `Campus health dropped to ${health.score} (Grade ${health.grade}) — multiple zones critical`
      }));
    } else if (health.score >= 50) {
      activeAlerts.delete(healthKey);
    }

    // Broadcast to all connected clients
    io.emit('zoneUpdate', {
      zones: clusteredData,
      evacuationMode,
      evacuationRoutes,
      health,
      flowData: computeFlowData(clusteredData),
      serverTimestamp: Date.now()
    });

    console.log(`✅ Data broadcasted | Health: ${health.score} (${health.grade}) | Evacuation: ${evacuationMode}`);
  }, 5000); // Update every 5 seconds
}

// REST API Endpoints

// Get latest zone data
app.get('/api/zones', async (req, res) => {
  try {
    const zones = await Zone.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$zoneId',
          zoneName: { $first: '$zoneName' },
          population: { $first: '$population' },
          density: { $first: '$density' },
          cluster: { $first: '$cluster' },
          capacity: { $first: '$capacity' },
          status: { $first: '$status' },
          timestamp: { $first: '$timestamp' }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: zones,
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get historical data for a specific zone
app.get('/api/history/:zoneId', async (req, res) => {
  try {
    const { zoneId } = req.params;
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    const history = await Zone.find({
      zoneId: zoneId,
      timestamp: { $gte: fifteenMinutesAgo }
    }).sort({ timestamp: 1 });
    
    res.json({
      success: true,
      zoneId: zoneId,
      data: history,
      count: history.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get alert log (newest first, max 100)
app.get('/api/alerts', (req, res) => {
  res.json({ success: true, alerts: alertLog, count: alertLog.length });
});

// Simple OLS linear regression over [{x, y}] points
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y || 0 };
  const sumX  = points.reduce((s, p) => s + p.x, 0);
  const sumY  = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX || 1);
  return { slope, intercept: (sumY - slope * sumX) / n };
}

// Forecast next 6 hours for a zone using linear regression on last 20 snapshots
app.get('/api/forecast/:zoneId', async (req, res) => {
  try {
    const { zoneId } = req.params;
    const history = await Zone.find({ zoneId })
      .sort({ timestamp: -1 })
      .limit(20)
      .lean();

    if (history.length < 2) {
      return res.json({ success: true, zoneId, forecast: [] });
    }

    history.reverse(); // oldest first
    const points = history.map((doc, i) => ({ x: i, y: doc.population }));
    const { slope, intercept } = linearRegression(points);
    const capacity = history[history.length - 1].capacity;

    // Last 5 actual points
    const actual = history.slice(-5).map(doc => ({
      time: new Date(doc.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      population: doc.population,
      predicted: false,
    }));

    // 6 predicted points: 1h … 6h ahead (720 ticks × 5s per tick = 1 hour)
    const TICKS_PER_HOUR = 720;
    const baseX = points.length - 1;
    const predicted = Array.from({ length: 6 }, (_, i) => {
      const futureX = baseX + TICKS_PER_HOUR * (i + 1);
      const raw = Math.round(slope * futureX + intercept);
      return {
        time: `+${i + 1}h`,
        population: Math.max(0, Math.min(capacity, raw)),
        predicted: true,
      };
    });

    res.json({ success: true, zoneId, forecast: [...actual, ...predicted] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get summary statistics
app.get('/api/summary', async (req, res) => {
  try {
    const latestZones = await Zone.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$zoneId',
          population: { $first: '$population' },
          status: { $first: '$status' }
        }
      }
    ]);
    
    const totalPopulation = latestZones.reduce((sum, z) => sum + z.population, 0);
    const activeZones = latestZones.filter(z => z.population > 0).length;
    const overcrowdedZones = latestZones.filter(z => z.status === 'overcrowded').length;
    const health = calculateHealthScore(latestZones);

    res.json({
      success: true,
      summary: {
        totalPopulation,
        activeZones,
        overcrowdedZones,
        totalZones: ZONES.length,
        health
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Activate evacuation mode — runs Dijkstra across all zones and broadcasts routes
app.post('/api/evacuation/start', (req, res) => {
  evacuationMode = true;
  const routes = getEvacuationRoutes(lastZoneData);
  const health = calculateHealthScore(lastZoneData);
  io.emit('zoneUpdate', {
    zones: lastZoneData,
    evacuationMode: true,
    evacuationRoutes: routes,
    health
  });
  pushAlert(makeAlert({
    type: 'evacuation', zone: null, severity: 'critical',
    message: 'EVACUATION MODE ACTIVATED — Dijkstra routes computed for all zones'
  }));
  console.log('🚨 Evacuation mode ACTIVATED');
  res.json({ success: true, routes });
});

// Deactivate evacuation mode
app.post('/api/evacuation/stop', (req, res) => {
  evacuationMode = false;
  const health = calculateHealthScore(lastZoneData);
  io.emit('zoneUpdate', {
    zones: lastZoneData,
    evacuationMode: false,
    evacuationRoutes: null,
    health
  });
  pushAlert(makeAlert({
    type: 'evacuation', zone: null, severity: 'info',
    message: 'Evacuation mode deactivated — campus returned to normal operations'
  }));
  console.log('✅ Evacuation mode DEACTIVATED');
  res.json({ success: true });
});

// Return campus graph topology + current evacuation state
app.get('/api/graph', (req, res) => {
  const routes = evacuationMode ? getEvacuationRoutes(lastZoneData) : null;
  res.json({
    success: true,
    graph: CAMPUS_GRAPH,
    exits: EXIT_ZONES,
    evacuationMode,
    routes
  });
});

// HTTP polling endpoint — same data as /api/zones but with server timestamp for latency calc
app.get('/api/poll', async (req, res) => {
  const serverTimestamp = Date.now();
  try {
    const zones = await Zone.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$zoneId',
          zoneName: { $first: '$zoneName' },
          population: { $first: '$population' },
          density: { $first: '$density' },
          cluster: { $first: '$cluster' },
          capacity: { $first: '$capacity' },
          status: { $first: '$status' },
          timestamp: { $first: '$timestamp' }
        }
      }
    ]);
    res.json({ success: true, data: zones, serverTimestamp, timestamp: new Date() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Replay snapshots — returns batched zone state history grouped by update cycle
app.get('/api/snapshots', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 60, 120);
    const snapshots = await Zone.aggregate([
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%dT%H:%M:%S', date: '$timestamp' } },
          zones: {
            $push: {
              zoneId: '$zoneId',
              zoneName: '$zoneName',
              population: '$population',
              density: '$density',
              cluster: '$cluster',
              capacity: '$capacity',
              status: '$status'
            }
          },
          timestamp: { $first: '$timestamp' }
        }
      },
      { $sort: { timestamp: -1 } },
      { $limit: limit },
      { $sort: { timestamp: 1 } }
    ]);
    res.json({ success: true, snapshots, count: snapshots.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── BOOKING ROUTES ────────────────────────────────────────────────────────────

// Compute live booking status based on current time
function computeStatus(booking) {
  const now = new Date();
  if (booking.status === 'cancelled') return 'cancelled';
  if (now >= booking.endTime)   return 'completed';
  if (now >= booking.startTime) return 'active';
  return 'upcoming';
}

// Get all bookings (non-cancelled, status computed live)
app.get('/api/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find({ status: { $ne: 'cancelled' } }).sort({ startTime: 1 });
    const result = bookings.map(b => ({
      ...b.toObject(),
      status: computeStatus(b)
    }));
    res.json({ success: true, bookings: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get bookings for a specific zone
app.get('/api/bookings/zone/:zoneId', async (req, res) => {
  try {
    const bookings = await Booking.find({
      zoneId: req.params.zoneId,
      status: { $ne: 'cancelled' }
    }).sort({ startTime: 1 });
    const result = bookings.map(b => ({ ...b.toObject(), status: computeStatus(b) }));
    res.json({ success: true, bookings: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Suggest alternative zones — filters by capacity, checks for time conflicts, ranks by live congestion
app.get('/api/bookings/alternatives/:zoneId', async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { startTime, endTime, expectedAttendance } = req.query;
    const minCap = parseInt(expectedAttendance) || 0;

    const candidates = ZONES.filter(z => z.id !== zoneId && z.capacity >= minCap);
    const alternatives = [];

    for (const zone of candidates) {
      const conflict = await Booking.hasConflict(zone.id, startTime, endTime);
      if (!conflict) {
        const current = lastZoneData.find(z => z.zoneId === zone.id);
        const occupancyPct = current ? Math.round((current.population / zone.capacity) * 100) : 0;
        alternatives.push({
          zoneId:           zone.id,
          zoneName:         zone.name,
          capacity:         zone.capacity,
          currentOccupancy: current ? current.population : 0,
          occupancyPct,
          status:           current ? current.status : 'normal'
        });
      }
    }

    // Least congested first
    alternatives.sort((a, b) => a.occupancyPct - b.occupancyPct);
    res.json({ success: true, alternatives: alternatives.slice(0, 3) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Create a booking — validates capacity and checks for conflicts
app.post('/api/bookings', async (req, res) => {
  try {
    const { zoneId, eventName, organizer, expectedAttendance, startTime, endTime } = req.body;

    const zone = ZONES.find(z => z.id === zoneId);
    if (!zone) return res.status(400).json({ success: false, error: 'Zone not found' });

    if (expectedAttendance > zone.capacity) {
      return res.status(400).json({
        success: false,
        error: `Expected attendance (${expectedAttendance}) exceeds zone capacity (${zone.capacity})`
      });
    }

    if (new Date(endTime) <= new Date(startTime)) {
      return res.status(400).json({ success: false, error: 'End time must be after start time' });
    }

    const conflict = await Booking.hasConflict(zoneId, startTime, endTime);
    if (conflict) {
      return res.status(409).json({ success: false, error: 'This zone is already booked for that time slot' });
    }

    const booking = await Booking.create({
      zoneId, zoneName: zone.name, eventName, organizer,
      expectedAttendance, startTime: new Date(startTime), endTime: new Date(endTime)
    });

    // Broadcast updated bookings to all clients
    const all = await Booking.find({ status: { $ne: 'cancelled' } }).sort({ startTime: 1 });
    io.emit('bookingUpdate', all.map(b => ({ ...b.toObject(), status: computeStatus(b) })));

    console.log(`📅 New booking: ${eventName} @ ${zone.name} by ${organizer}`);
    res.status(201).json({ success: true, booking: { ...booking.toObject(), status: computeStatus(booking) } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Cancel a booking
app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelled' },
      { new: true }
    );
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const all = await Booking.find({ status: { $ne: 'cancelled' } }).sort({ startTime: 1 });
    io.emit('bookingUpdate', all.map(b => ({ ...b.toObject(), status: computeStatus(b) })));

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('👤 Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('👋 Client disconnected:', socket.id);
  });
  
  socket.on('requestUpdate', async () => {
    const networkData = generateNetworkActivity();
    const clusteredData = applyDBSCAN(networkData);
    const evacuationRoutes = evacuationMode ? getEvacuationRoutes(clusteredData) : null;
    const health = calculateHealthScore(clusteredData);
    socket.emit('zoneUpdate', { zones: clusteredData, evacuationMode, evacuationRoutes, health });
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.IO server active`);
  
  // Start real-time updates
  startRealTimeUpdates();
});

module.exports = { app, server };