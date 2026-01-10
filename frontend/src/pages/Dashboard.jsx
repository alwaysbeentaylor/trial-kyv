import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { useLanguage } from '../contexts/LanguageContext';

function Dashboard({ onUpdate }) {
    const { t } = useLanguage();
    const [stats, setStats] = useState({
        totalGuests: 0,
        vipGuests: 0,
        pendingResearch: 0,
        recentImports: 0
    });
    const [recentGuests, setRecentGuests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [enrichmentProgress, setEnrichmentProgress] = useState(null);

    useEffect(() => {
        fetchData();

        // Initial check for active queue
        checkActiveQueue();

        // Poll for active queue
        const interval = setInterval(checkActiveQueue, 3000);
        return () => clearInterval(interval);
    }, []);

    // Refresh data if research is ongoing
    useEffect(() => {
        if (enrichmentProgress && enrichmentProgress.status === 'running') {
            const interval = setInterval(() => {
                fetchData();
                if (onUpdate) onUpdate();
            }, 5000);
            return () => clearInterval(interval);
        }
    }, [enrichmentProgress]);

    const checkActiveQueue = async () => {
        try {
            const data = await apiFetch('/api/research/queue/active');
            if (data.active) {
                setEnrichmentProgress(data);
            } else if (enrichmentProgress) {
                setEnrichmentProgress(null);
                fetchData(); // One last fetch when it finishes
            }
        } catch (err) {
            console.error('Fout bij checken actieve queue:', err);
        }
    };

    const fetchData = async () => {
        try {
            const [statsData, guestsData] = await Promise.all([
                apiFetch('/api/dashboard/stats'),
                apiFetch('/api/guests?limit=10&minVipScore=5')
            ]);

            setStats(statsData);
            setRecentGuests(guestsData.guests || []);
        } catch (error) {
            console.log('Backend nog niet beschikbaar');
        } finally {
            setLoading(false);
        }
    };

    const getVIPBadgeClass = (score) => {
        if (!score) return 'vip-badge low';
        if (score >= 8) return 'vip-badge high';
        if (score >= 5) return 'vip-badge medium';
        return 'vip-badge low';
    };

    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

    const handleDownloadDailyReport = async (date) => {
        const targetDate = date || selectedDate;
        try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || '';
            const response = await fetch(`${API_BASE_URL}/api/reports/daily/pdf?date=${targetDate}`);
            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `dagrapport-${targetDate}.pdf`;
                a.click();
                window.URL.revokeObjectURL(url);
            } else {
                alert(`Geen aankomsten gevonden op ${targetDate}. Controleer de datum in je Mews import.`);
            }
        } catch (error) {
            console.error('Dagrapport download mislukt:', error);
            alert('Download mislukt. Controleer of er gasten zijn voor deze datum.');
        }
    };


    const handlePauseQueue = async () => {
        if (!enrichmentProgress?.queueId) return;
        setEnrichmentProgress(prev => ({ ...prev, status: 'paused' }));
        try {
            await apiFetch(`/api/research/queue/${enrichmentProgress.queueId}/pause`, { method: 'POST' });
        } catch (error) {
            console.error('Pauzeren mislukt:', error);
        }
    };

    const handleResumeQueue = async () => {
        if (!enrichmentProgress?.queueId) return;
        setEnrichmentProgress(prev => ({ ...prev, status: 'running' }));
        try {
            await apiFetch(`/api/research/queue/${enrichmentProgress.queueId}/resume`, { method: 'POST' });
        } catch (error) {
            console.error('Hervatten mislukt:', error);
        }
    };

    const handleStopQueue = async () => {
        if (!enrichmentProgress?.queueId) return;
        setEnrichmentProgress(prev => ({ ...prev, status: 'stopped' }));
        try {
            await apiFetch(`/api/research/queue/${enrichmentProgress.queueId}/stop`, { method: 'POST' });
        } catch (error) {
            console.error('Stoppen mislukt:', error);
        }
    };

    const handleSkipGuest = async () => {
        if (!enrichmentProgress?.queueId) return;
        try {
            await apiFetch(`/api/research/queue/${enrichmentProgress.queueId}/skip`, { method: 'POST' });
        } catch (error) {
            console.error('Overslaan mislukt:', error);
        }
    };

    return (
        <div className="space-y-8">
            {/* Welcome Section */}
            <div>
                <h2 className="font-heading text-3xl font-semibold">Dashboard</h2>
                <p className="text-[var(--color-text-secondary)] mt-2">
                    {t('Overzicht van VIP gastonderzoek en statistieken')}
                </p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="stat-card">
                    <div className="stat-value">{stats.totalGuests}</div>
                    <div className="stat-label">{t('Totaal Gasten')}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{stats.vipGuests}</div>
                    <div className="stat-label">{t('VIP Gasten')}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{stats.pendingResearch}</div>
                    <div className="stat-label">{t('Wacht op Onderzoek')}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-value">{stats.recentImports}</div>
                    <div className="stat-label">{t('Recent Geïmporteerd')}</div>
                </div>
            </div>


            {/* Enrichment Progress Bar */}
            {enrichmentProgress && (enrichmentProgress.status === 'running' || enrichmentProgress.status === 'paused' || enrichmentProgress.status === 'stopped' || (enrichmentProgress.status === 'completed' && enrichmentProgress.progress === 100)) && (
                <div className={`card overflow-hidden border-2 transition-colors ${enrichmentProgress.status === 'stopped' ? 'border-red-200' : 'border-purple-200'}`}>
                    <div className={`p-4 border-b border-[var(--color-border)] ${enrichmentProgress.status === 'stopped' ? 'bg-red-50' : 'bg-purple-50'}`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="text-2xl animate-pulse">
                                    {enrichmentProgress.status === 'completed' ? '✅' : enrichmentProgress.status === 'stopped' ? '⏹️' : '🔍'}
                                </div>
                                <div className="flex-1">
                                    <h4 className={`font-semibold flex items-center gap-2 ${enrichmentProgress.status === 'stopped' ? 'text-red-800' : 'text-purple-800'}`}>
                                        {enrichmentProgress.status === 'completed'
                                            ? 'Onderzoek Voltooid!'
                                            : enrichmentProgress.status === 'paused'
                                                ? 'Onderzoek Gepauzeerd'
                                                : enrichmentProgress.status === 'stopped'
                                                    ? 'Onderzoek Gestopt'
                                                    : <span className="flex items-center gap-1"><span className="animate-spin text-xs">⟳</span>Bezig</span>}
                                        {enrichmentProgress.status === 'paused' && <span className="text-[10px] px-2 py-0.5 bg-purple-200 text-purple-700 rounded-full animate-pulse">GEPAUZEERD</span>}
                                        {enrichmentProgress.status === 'stopped' && <span className="text-[10px] px-2 py-0.5 bg-red-200 text-red-700 rounded-full">GESTOP T</span>}
                                    </h4>
                                    <p className={`text-sm ${enrichmentProgress.status === 'stopped' ? 'text-red-600' : 'text-purple-600'}`}>
                                        {enrichmentProgress.status === 'stopped'
                                            ? `Proces beëindigd op ${enrichmentProgress.completed} gasten`
                                            : enrichmentProgress.currentName
                                                ? `Onderzoeken: ${enrichmentProgress.currentName}`
                                                : `${enrichmentProgress.completed} van ${enrichmentProgress.total} gasten verrijkt`}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                {enrichmentProgress.status === 'running' && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handlePauseQueue}
                                            className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors"
                                            title="Pauzeren"
                                        >
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                                        </button>
                                        <button
                                            onClick={handleSkipGuest}
                                            className="p-2 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors"
                                            title="Huidige gast overslaan"
                                        >
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></svg>
                                        </button>
                                        <button
                                            onClick={handleStopQueue}
                                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                            title="Stoppen"
                                        >
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>
                                        </button>
                                    </div>
                                )}
                                {(enrichmentProgress.status === 'paused' || enrichmentProgress.status === 'stopped') && (
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleResumeQueue}
                                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                            title="Hervatten"
                                        >
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                        </button>
                                        {enrichmentProgress.status === 'paused' && (
                                            <button
                                                onClick={handleStopQueue}
                                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                title="Stoppen"
                                            >
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>
                                            </button>
                                        )}
                                    </div>
                                )}
                                <div className="text-2xl font-bold text-purple-700">
                                    {enrichmentProgress.progress}%
                                </div>
                                <button
                                    onClick={() => setEnrichmentProgress(null)}
                                    className="text-purple-400 hover:text-purple-600"
                                >
                                    ×
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="h-3 bg-purple-100">
                        <div
                            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                            style={{ width: `${enrichmentProgress.progress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Recent Guests */}{/* Recent Guests */}
            <div className="card">
                <div className="p-6 border-b border-[var(--color-border)]">
                    <h3 className="font-heading text-xl font-semibold">{t('Recente VIPs')}</h3>
                </div>

                {loading ? (
                    <div className="p-12 text-center text-[var(--color-text-secondary)]">
                        {t('Laden...')}
                    </div>
                ) : recentGuests.length > 0 ? (
                    <table className="table">
                        <thead>
                            <tr>
                                <th>{t('Naam')}</th>
                                <th>{t('Bedrijf')}</th>
                                <th>{t('Land')}</th>
                                <th>{t('VIP Score')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentGuests.map((guest) => (
                                <tr key={guest.id} className="clickable">
                                    <td className="font-medium">
                                        <div className="flex items-center gap-2">
                                            {guest.full_name}
                                            {enrichmentProgress?.current === guest.id && (
                                                <span className="inline-flex items-center text-[10px] text-purple-600 font-normal bg-purple-50 px-2 py-0.5 rounded-full">
                                                    <span className="animate-spin mr-1">⟳</span>
                                                    {t('Bezig')}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="text-[var(--color-text-secondary)]">
                                        {guest.company || guest.research_company || '-'}
                                    </td>
                                    <td className="text-[var(--color-text-secondary)]">
                                        {guest.country || '-'}
                                    </td>
                                    <td>
                                        {guest.vip_score ? (
                                            <span className={getVIPBadgeClass(guest.vip_score)}>
                                                {guest.vip_score}/10
                                            </span>
                                        ) : enrichmentProgress?.current === guest.id ? (
                                            <span className="text-[var(--color-text-secondary)] text-xs italic">
                                                {t('Analyse bezig...')}
                                            </span>
                                        ) : (
                                            <span className="text-[var(--color-text-secondary)] text-sm">
                                                {t('Niet onderzocht')}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="p-12 text-center">
                        <p className="text-[var(--color-text-secondary)]">
                            {t('Nog geen gasten geïmporteerd')}
                        </p>
                        <a
                            href="/import"
                            className="btn btn-primary mt-4 inline-flex"
                        >
                            {t('Gasten Importeren')}
                        </a>
                    </div>
                )}
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <a href="/import" className="card p-6 hover:border-[var(--color-accent-gold)] transition-colors block">
                    <div className="text-2xl mb-3">📋</div>
                    <h4 className="font-semibold mb-2">{t('CSV Importeren')}</h4>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                        {t('Upload een bestand om nieuwe gasten toe te voegen')}
                    </p>
                </a>
                <a href="/guests" className="card p-6 hover:border-[var(--color-accent-gold)] transition-colors block">
                    <div className="text-2xl mb-3">👤</div>
                    <h4 className="font-semibold mb-2">{t('Gast Toevoegen')}</h4>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                        {t('Handmatig een nieuwe gast registreren')}
                    </p>
                </a>
                <div
                    onClick={() => handleDownloadDailyReport('all')}
                    className="card p-6 hover:border-[var(--color-accent-gold)] transition-colors cursor-pointer group col-span-1 md:col-span-2 lg:col-span-2 flex flex-col items-center justify-center text-center py-10"
                >
                    <div className="text-4xl mb-4">📚</div>
                    <h4 className="font-semibold text-xl mb-2">{t('Download Rapport')}</h4>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                        {t('Download PDF van alle onderzochte gasten')}
                    </p>
                </div>
            </div>
        </div>
    );
}

export default Dashboard;
