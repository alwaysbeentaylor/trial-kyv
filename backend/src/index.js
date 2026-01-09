require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Routes
const importRoutes = require('./routes/import');
const guestRoutes = require('./routes/guests');
const { router: researchRoutes, resumeActiveQueues } = require('./routes/research');
const reportRoutes = require('./routes/reports');
const analyticsRoutes = require('./routes/analytics');

// Database
const db = require('./db/database');

// Resume any abandoned background tasks
resumeActiveQueues();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',  // Next.js landing page dev
  process.env.FRONTEND_URL,
  process.env.LANDING_URL,   // Production landing page URL
  // Also allow any Render frontend URLs (for production)
  process.env.RENDER_EXTERNAL_URL ? new URL(process.env.RENDER_EXTERNAL_URL).origin : null
].filter(Boolean);

// Log allowed origins for debugging
console.log('🌐 CORS allowed origins:', allowedOrigins);

app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if origin is in allowed list OR if it's a Vercel preview URL
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }

    // Log the rejected origin for debugging
    console.warn(`⚠️ CORS blocked origin: ${origin}`);
    console.warn(`   Allowed origins: ${allowedOrigins.join(', ')}`);
    const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
    return callback(new Error(msg), false);
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/import', importRoutes);
app.use('/api/guests', guestRoutes);
app.use('/api/research', researchRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Dashboard stats
app.get('/api/dashboard/stats', (req, res) => {
  try {
    const stats = {
      totalGuests: db.prepare('SELECT COUNT(*) as count FROM guests').get().count,
      vipGuests: db.prepare('SELECT COUNT(*) as count FROM research_results WHERE vip_score >= 7').get().count,
      pendingResearch: db.prepare(`
        SELECT COUNT(*) as count FROM guests g 
        WHERE NOT EXISTS (SELECT 1 FROM research_results r WHERE r.guest_id = g.id)
      `).get().count,
      recentImports: db.prepare(`
        SELECT COUNT(DISTINCT guest_id) as count FROM reservations 
        WHERE imported_at >= datetime('now', '-7 days')
      `).get().count
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Er is iets misgegaan!' });
});

app.listen(PORT, () => {
  console.log(`🏨 VIP Research Tool server draait op http://localhost:${PORT}`);
});

module.exports = app;
