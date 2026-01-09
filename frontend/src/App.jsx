import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { apiFetch } from './utils/api';
import Dashboard from './pages/Dashboard';
import Import from './pages/Import';
import Guests from './pages/Guests';
import WelcomeModal from './components/ui/WelcomeModal';

function App() {
  const [stats, setStats] = useState({
    totalGuests: 0,
    vipGuests: 0,
    pendingResearch: 0
  });

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const data = await apiFetch('/api/dashboard/stats');
      setStats(data);
    } catch (error) {
      console.log('Backend nog niet gestart of niet bereikbaar');
    }
  };

  const [showHelp, setShowHelp] = useState(false);

  return (
    <Router>
      <div className="min-h-screen bg-[var(--color-bg-secondary)]">
        <WelcomeModal forceOpen={showHelp} onClose={() => setShowHelp(false)} />
        {/* Header */}
        <header className="bg-white border-b border-[var(--color-border)]">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="font-heading text-2xl font-semibold tracking-tight">
                  VIP Guest Research
                </h1>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                  Gastonderzoek & Rapportage Tool
                </p>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--color-text-secondary)]">Gasten:</span>
                  <span className="font-semibold">{stats.totalGuests}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--color-accent-gold)]">★</span>
                  <span className="font-semibold">{stats.vipGuests} VIPs</span>
                </div>
                {/* Help Button */}
                <button
                  onClick={() => setShowHelp(true)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold transition-all hover:scale-110 hover:shadow-lg"
                  style={{
                    background: 'linear-gradient(135deg, #c9a227, #f4d03f)',
                    boxShadow: '0 2px 8px rgba(201, 162, 39, 0.4)'
                  }}
                  title="Help & Handleiding"
                >
                  ?
                </button>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <nav className="tab-nav max-w-7xl mx-auto">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/import"
              className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
            >
              Importeren
            </NavLink>
            <NavLink
              to="/guests"
              className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
            >
              Gasten
            </NavLink>
          </nav>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-6 py-8">
          <Routes>
            <Route path="/" element={<Dashboard onUpdate={fetchStats} />} />
            <Route path="/import" element={<Import onUpdate={fetchStats} />} />
            <Route path="/guests" element={<Guests onUpdate={fetchStats} />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
