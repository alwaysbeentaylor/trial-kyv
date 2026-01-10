import { useState, useEffect, useRef, useCallback } from 'react';
import GuestModal from '../components/guests/GuestModal';
import AddGuestForm from '../components/guests/AddGuestForm';
import TypingAnimation from '../components/ui/TypingAnimation';
import { apiFetch } from '../utils/api';
import { useLanguage } from '../contexts/LanguageContext';


function Guests({ onUpdate }) {
    const { t } = useLanguage();
    const [guests, setGuests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all'); // all, vip, pending
    const [sortOrder, setSortOrder] = useState('newest'); // newest, oldest
    const [selectedGuest, setSelectedGuest] = useState(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [total, setTotal] = useState(0);
    const [selectedIds, setSelectedIds] = useState([]);
    const [downloadingSelected, setDownloadingSelected] = useState(false);
    const [deletingSelected, setDeletingSelected] = useState(false);
    const [researchingIds, setResearchingIds] = useState([]);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [enrichmentProgress, setEnrichmentProgress] = useState(null);
    const [showErrorDetails, setShowErrorDetails] = useState(false);

    // Paginering state
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Ref to track previous filter/sort values for smart page reset
    const prevFiltersRef = useRef({ search, filter, sortOrder, itemsPerPage });

    // Fetch gasten functie met useCallback voor stabiele referentie
    const fetchGuests = useCallback(async () => {
        setLoading(true);
        try {
            const offset = (currentPage - 1) * itemsPerPage;
            let url = `/api/guests?limit=${itemsPerPage}&offset=${offset}&sort=${sortOrder}`;
            if (search) url += `&search=${encodeURIComponent(search)}`;
            if (filter === 'vip') url += `&vipOnly=true`;
            if (filter === 'pending') url += `&hasResearch=false`;

            const data = await apiFetch(url);
            setGuests(data.guests || []);
            setTotal(data.total || 0);
        } catch (error) {
            console.log('Fout bij ophalen gasten');
        } finally {
            setLoading(false);
        }
    }, [currentPage, itemsPerPage, sortOrder, search, filter]);

    useEffect(() => {
        fetchGuests();
    }, [fetchGuests]);

    // Reset naar pagina 1 ALLEEN wanneer filters, zoekterm, of page size veranderen
    // Dit voorkomt reset tijdens automatische data refreshes
    useEffect(() => {
        const prevFilters = prevFiltersRef.current;
        const filtersChanged =
            prevFilters.search !== search ||
            prevFilters.filter !== filter ||
            prevFilters.sortOrder !== sortOrder ||
            prevFilters.itemsPerPage !== itemsPerPage;

        if (filtersChanged) {
            setCurrentPage(1);
            prevFiltersRef.current = { search, filter, sortOrder, itemsPerPage };
        }
    }, [search, filter, sortOrder, itemsPerPage]);

    // Track previous completed count for auto-refresh
    const prevCompletedRef = useRef(0);

    // Check voor actieve enrichment queue
    useEffect(() => {
        const checkActiveQueue = async () => {
            try {
                const data = await apiFetch('/api/research/queue/active');
                if (data.active) {
                    // Check if a new guest was completed - trigger refresh
                    if (data.completed > prevCompletedRef.current) {
                        console.log(`✅ Guest completed! Refreshing list... (${prevCompletedRef.current} -> ${data.completed})`);
                        fetchGuests();
                        if (onUpdate) onUpdate();
                    }
                    prevCompletedRef.current = data.completed;

                    setEnrichmentProgress(data);

                    // Auto-dismiss after completion (5 seconds after completed)
                    if (data.status === 'completed') {
                        // Final refresh when queue completes
                        fetchGuests();
                        if (onUpdate) onUpdate();
                        setTimeout(() => {
                            setEnrichmentProgress(null);
                        }, 5000);
                    }
                } else {
                    // No active queue - reset counter and clear progress if it was showing completed
                    prevCompletedRef.current = 0;
                    if (enrichmentProgress?.status === 'completed') {
                        setEnrichmentProgress(null);
                    }
                }
            } catch (err) {
                console.error('Fout bij checken actieve queue:', err);
            }
        };

        checkActiveQueue();
        // Poll every 2 seconds for faster updates
        const interval = setInterval(checkActiveQueue, 2000);
        return () => clearInterval(interval);
    }, [fetchGuests, onUpdate]);

    // Indien enrichment bezig is, ververs gastenlijst periodiek (backup refresh)
    useEffect(() => {
        if (enrichmentProgress && enrichmentProgress.status === 'running') {
            const interval = setInterval(() => {
                fetchGuests();
                if (onUpdate) onUpdate();
            }, 3000); // Faster refresh: 3 seconds instead of 5
            return () => clearInterval(interval);
        }
    }, [enrichmentProgress, fetchGuests, onUpdate]);

    const totalPages = Math.ceil(total / itemsPerPage);

    const handleToggleSelection = (id) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleSelectAll = () => {
        if (selectedIds.length === guests.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(guests.map(g => g.id));
        }
    };

    const handleDownloadSelected = async () => {
        if (selectedIds.length === 0) return;

        setDownloadingSelected(true);
        try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || '';
            const response = await fetch(`${API_BASE_URL}/api/reports/selected/pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guestIds: selectedIds })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `selectie-gastrapporten-${new Date().getTime()}.pdf`;
                a.click();
                window.URL.revokeObjectURL(url);
                setSelectedIds([]);
            }
        } catch (error) {
            console.error('Download geselecteerde gasten mislukt:', error);
        } finally {
            setDownloadingSelected(false);
        }
    };

    const handleDeleteSelected = async () => {
        if (selectedIds.length === 0) return;

        setDeletingSelected(true);
        try {
            const data = await apiFetch('/api/guests/bulk-delete', {
                method: 'POST',
                body: JSON.stringify({ guestIds: selectedIds })
            });
            console.log(data.message);
            setSelectedIds([]);
            setShowDeleteConfirm(false);
            fetchGuests();
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Verwijderen geselecteerde gasten mislukt:', error);
        } finally {
            setDeletingSelected(false);
        }
    };

    const handleBulkResearch = async () => {
        if (selectedIds.length === 0) return;

        try {
            const data = await apiFetch('/api/research/queue/start', {
                method: 'POST',
                body: JSON.stringify({ guestIds: selectedIds, concurrency: 1 })
            });
            console.log('Bulk research gestart:', data.queueId);
            setSelectedIds([]);
        } catch (error) {
            console.error('Bulk research mislukt:', error);
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
        // Immediate visual stop
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

    const handleResearch = async (guestId) => {
        if (researchingIds.includes(guestId)) return;

        setResearchingIds(prev => [...prev, guestId]);
        try {
            await apiFetch(`/api/research/${guestId}`, {
                method: 'POST'
            });
            // Small delay to ensure database is fully updated
            await new Promise(resolve => setTimeout(resolve, 500));
            // Force refresh the guest list
            await fetchGuests();
            if (onUpdate) onUpdate();
            console.log('✅ Research completed and list refreshed for guest:', guestId);
        } catch (error) {
            console.error('Research mislukt:', error);
        } finally {
            setResearchingIds(prev => prev.filter(id => id !== guestId));
        }
    };

    const handleDownloadPDF = async (guestId, guestName) => {
        try {
            const API_BASE_URL = import.meta.env.VITE_API_URL || '';
            const response = await fetch(`${API_BASE_URL}/api/reports/${guestId}/pdf`);
            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `gastrapport-${guestName.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;
                a.click();
                window.URL.revokeObjectURL(url);
            }
        } catch (error) {
            console.error('PDF download mislukt:', error);
        }
    };

    const handleGuestClick = async (guest) => {
        try {
            const fullGuest = await apiFetch(`/api/guests/${guest.id}`);
            setSelectedGuest(fullGuest);
        } catch (error) {
            console.error('Fout bij ophalen gastdetails:', error);
        }
    };

    const getVIPBadgeClass = (score) => {
        if (!score) return '';
        if (score >= 8) return 'vip-badge high';
        if (score >= 5) return 'vip-badge medium';
        return 'vip-badge low';
    };

    // Helper functie om status van een gast te bepalen
    const getGuestStatus = (guest) => {
        // Onderzocht: heeft vip_score of researched_at
        if (guest.vip_score || guest.researched_at) {
            return 'onderzocht';
        }

        // Individueel onderzoek bezig (via handleResearch)
        if (researchingIds.includes(guest.id)) {
            return 'bezig';
        }

        // Check active queue data
        if (enrichmentProgress) {
            // Is it currently being researched?
            const isProcessing = enrichmentProgress.current === guest.id ||
                enrichmentProgress.currentProcessing?.some(p => p.guestId === guest.id);
            if (isProcessing) return 'bezig';

            // Is it in the queue for later?
            const isInQueue = enrichmentProgress.guestIds?.includes(guest.id);
            if (isInQueue) {
                const guestIndex = enrichmentProgress.guestIds.indexOf(guest.id);
                if (guestIndex >= (enrichmentProgress.nextIndex || 0)) {
                    return 'wachtrij';
                }
            }
        }

        return null;
    };

    const handleGuestUpdated = (newGuestId, isResearching) => {
        fetchGuests();
        setSelectedGuest(null);
        setShowAddForm(false);
        if (onUpdate) onUpdate();

        // If a new guest was added with auto-research, track it
        if (newGuestId && isResearching) {
            setResearchingIds(prev => [...prev, newGuestId]);

            // Poll for completion and auto-refresh
            const checkCompletion = async () => {
                try {
                    const guest = await apiFetch(`/api/guests/${newGuestId}`);
                    if (guest.research?.vip_score) {
                        // Research complete - remove from researching and refresh
                        setResearchingIds(prev => prev.filter(id => id !== newGuestId));
                        fetchGuests();
                        if (onUpdate) onUpdate();
                        return true; // Done
                    }
                    return false; // Still researching
                } catch (err) {
                    console.error('Check completion error:', err);
                    return false;
                }
            };

            // Poll every 2 seconds until complete (max 3 minutes)
            let attempts = 0;
            const maxAttempts = 90; // 3 minutes
            const pollInterval = setInterval(async () => {
                attempts++;
                const isDone = await checkCompletion();
                if (isDone || attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    setResearchingIds(prev => prev.filter(id => id !== newGuestId));
                }
            }, 2000);
        }
    };

    // Bereken het bereik van getoonde items
    const startItem = total === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, total);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="font-heading text-3xl font-semibold">{t('Gasten')}</h2>
                    <p className="text-[var(--color-text-secondary)] mt-1">
                        {total} {t('gasten gevonden')}
                    </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    {selectedIds.length > 0 && (
                        <>
                            <button
                                onClick={() => setShowDeleteConfirm(true)}
                                disabled={deletingSelected}
                                className="btn btn-secondary border-red-500 text-red-500 hover:bg-red-50"
                            >
                                🗑️ {t('Verwijderen')} ({selectedIds.length})
                            </button>
                            <button
                                onClick={handleDownloadSelected}
                                disabled={downloadingSelected}
                                className={`btn btn-secondary border-[var(--color-accent-gold)] text-[var(--color-accent-gold)] ${downloadingSelected ? 'opacity-50' : ''}`}
                            >
                                {downloadingSelected ? `📄 ${t('Genereren...')}` : `📄 ${t('Download')} (${selectedIds.length})`}
                            </button>
                            <button
                                onClick={handleBulkResearch}
                                className="btn btn-secondary border-purple-500 text-purple-600 hover:bg-purple-50"
                            >
                                🔍 {t('Verrijken')}
                            </button>
                        </>
                    )}
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="btn btn-primary"
                    >
                        <span>+</span>
                        {t('Gast Toevoegen')}
                    </button>
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
                    {enrichmentProgress.errors && enrichmentProgress.errors.length > 0 && (
                        <div className="p-4 bg-red-50 border-t border-red-100">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-red-600 font-medium italic">
                                    ⚠️ {enrichmentProgress.errors.length} gasten overgeslagen door onderzoeksfouten.
                                </span>
                                <button
                                    onClick={() => setShowErrorDetails(!showErrorDetails)}
                                    className="text-[10px] text-red-500 underline hover:text-red-700"
                                >
                                    {showErrorDetails ? 'Details Verbergen' : 'Details Tonen'}
                                </button>
                            </div>

                            {showErrorDetails && (
                                <div className="mt-3 space-y-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                                    {enrichmentProgress.errors.map((err, idx) => (
                                        <div key={idx} className="flex justify-between items-start text-[10px] py-1 border-b border-red-100 last:border-0">
                                            <span className="font-semibold text-red-700">{err.name || 'Onbekende gast'}:</span>
                                            <span className="text-red-500 text-right ml-2">{err.error}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}


            {/* Filters en Sortering */}
            <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                    <input
                        type="text"
                        placeholder={t('Zoek op naam, email of bedrijf...')}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="input"
                    />
                </div>
                <div className="flex gap-2 flex-wrap">
                    {/* Status filters */}
                    <button
                        onClick={() => setFilter('all')}
                        className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                    >
                        {t('Alle')}
                    </button>
                    <button
                        onClick={() => setFilter('vip')}
                        className={`btn ${filter === 'vip' ? 'btn-primary' : 'btn-secondary'}`}
                    >
                        ★ VIP
                    </button>
                    <button
                        onClick={() => setFilter('pending')}
                        className={`btn ${filter === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
                    >
                        {t('Niet onderzocht')}
                    </button>

                    {/* Sortering dropdown */}
                    <select
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value)}
                        className="input"
                        style={{ width: 'auto', minWidth: '180px' }}
                    >
                        <optgroup label={t('Datum')}>
                            <option value="newest">{t('Nieuwste eerst')}</option>
                            <option value="oldest">{t('Oudste eerst')}</option>
                        </optgroup>
                        <optgroup label={t('Naam')}>
                            <option value="name_asc">{t('Naam A-Z')}</option>
                            <option value="name_desc">{t('Naam Z-A')}</option>
                        </optgroup>
                        <optgroup label={t('VIP Score')}>
                            <option value="vip_high">{t('Hoogste VIP eerst')}</option>
                            <option value="vip_low">{t('Laagste VIP eerst')}</option>
                        </optgroup>
                        <optgroup label={t('Bedrijf')}>
                            <option value="company_asc">{t('Bedrijf A-Z')}</option>
                            <option value="company_desc">{t('Bedrijf Z-A')}</option>
                        </optgroup>
                        <optgroup label={t('Land')}>
                            <option value="country_asc">{t('Land A-Z')}</option>
                            <option value="country_desc">{t('Land Z-A')}</option>
                        </optgroup>
                    </select>

                    {/* Per pagina dropdown */}
                    <select
                        value={itemsPerPage}
                        onChange={(e) => setItemsPerPage(parseInt(e.target.value))}
                        className="input"
                        style={{ width: 'auto', minWidth: '100px' }}
                    >
                        <option value="10">{t('10 per pagina')}</option>
                        <option value="50">{t('50 per pagina')}</option>
                        <option value="100">{t('100 per pagina')}</option>
                        <option value="250">{t('250 per pagina')}</option>
                    </select>
                </div>
            </div>

            {/* Guest Table */}
            <div className="card overflow-hidden">
                {loading ? (
                    <div className="p-12 text-center text-[var(--color-text-secondary)]">
                        {t('Laden...')}
                    </div>
                ) : guests.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th className="w-10">
                                        <input
                                            type="checkbox"
                                            checked={guests.length > 0 && selectedIds.length === guests.length}
                                            onChange={handleSelectAll}
                                            className="rounded border-[var(--color-border)] text-[var(--color-accent-gold)] focus:ring-[var(--color-accent-gold)]"
                                        />
                                    </th>
                                    <th>{t('Naam')}</th>
                                    <th>{t('Functie')}</th>
                                    <th>{t('Bedrijf')}</th>
                                    <th>{t('Land')}</th>
                                    <th>{t('Net Worth')}</th>
                                    <th>{t('VIP Score')}</th>
                                    <th>{t('Acties')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {guests.map((guest) => {
                                    const status = getGuestStatus(guest);
                                    const isBeingResearched = status === 'bezig';
                                    const isInQueue = status === 'wachtrij';
                                    return (
                                        <tr
                                            key={guest.id}
                                            className={`clickable transition-all duration-300 ${isBeingResearched
                                                ? 'bg-purple-50 ring-2 ring-purple-300 ring-inset animate-pulse'
                                                : isInQueue
                                                    ? 'bg-amber-50/50 ring-1 ring-amber-200 ring-inset'
                                                    : selectedIds.includes(guest.id)
                                                        ? 'bg-[var(--color-bg-secondary)]'
                                                        : ''
                                                }`}
                                            style={isBeingResearched ? { boxShadow: '0 0 15px rgba(147, 51, 234, 0.2)' } : isInQueue ? { boxShadow: '0 0 8px rgba(217, 119, 6, 0.1)' } : {}}
                                            onClick={() => handleGuestClick(guest)}
                                        >
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.includes(guest.id)}
                                                    onChange={() => handleToggleSelection(guest.id)}
                                                    className="rounded border-[var(--color-border)] text-[var(--color-accent-gold)] focus:ring-[var(--color-accent-gold)]"
                                                />
                                            </td>
                                            <td>
                                                <div className="flex items-center gap-3">
                                                    <div className="flex-shrink-0">
                                                        {guest.profile_photo_url ? (
                                                            <img
                                                                src={guest.profile_photo_url}
                                                                alt={guest.full_name}
                                                                className="w-10 h-10 rounded-full object-cover border border-[var(--color-border)] shadow-sm"
                                                                onError={(e) => {
                                                                    e.target.onerror = null;
                                                                    e.target.style.display = 'none';
                                                                    const placeholder = document.createElement('div');
                                                                    placeholder.className = "w-10 h-10 rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-secondary)] font-semibold shadow-sm";
                                                                    placeholder.innerText = guest.full_name.charAt(0).toUpperCase();
                                                                    e.target.parentNode.appendChild(placeholder);
                                                                }}
                                                            />
                                                        ) : (
                                                            <div className="w-10 h-10 rounded-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-text-secondary)] font-semibold shadow-sm">
                                                                {guest.full_name.charAt(0).toUpperCase()}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <div className="font-medium">
                                                            {guest.full_name}
                                                        </div>
                                                        {guest.email && (
                                                            <div className="text-xs text-[var(--color-text-secondary)]">
                                                                {guest.email}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                                        {guest.linkedin_url && (
                                                            <div className="relative group">
                                                                <a href={guest.linkedin_url} target="_blank" rel="noopener noreferrer"
                                                                    className={`social-icon ${guest.needs_linkedin_review ? 'border-yellow-500 text-yellow-500' : ''}`} title="LinkedIn">
                                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                                                        <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                                                                    </svg>
                                                                </a>
                                                                {guest.needs_linkedin_review === 1 && (
                                                                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                                                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                        {!guest.linkedin_url && guest.needs_linkedin_review === 1 && (
                                                            <span className="text-yellow-500" title="Review nodig">⚠️</span>
                                                        )}
                                                        {guest.instagram_url && (
                                                            <a href={guest.instagram_url} target="_blank" rel="noopener noreferrer"
                                                                className="social-icon" title="Instagram">
                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                                                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                                                                </svg>
                                                            </a>
                                                        )}
                                                        {guest.twitter_url && (
                                                            <a href={guest.twitter_url} target="_blank" rel="noopener noreferrer"
                                                                className="social-icon" title="Twitter/X">
                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                                                </svg>
                                                            </a>
                                                        )}
                                                        {guest.facebook_url && (
                                                            <a href={guest.facebook_url} target="_blank" rel="noopener noreferrer"
                                                                className="social-icon" title="Facebook">
                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                                                    <path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z" />
                                                                </svg>
                                                            </a>
                                                        )}
                                                        {guest.website_url && (
                                                            <a href={guest.website_url.startsWith('http') ? guest.website_url : `https://${guest.website_url}`}
                                                                target="_blank" rel="noopener noreferrer"
                                                                className="social-icon text-[var(--color-accent-gold)]" title="Website">
                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <circle cx="12" cy="12" r="10"></circle>
                                                                    <line x1="2" y1="12" x2="22" y2="12"></line>
                                                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                                                                </svg>
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="text-[var(--color-text-secondary)]">
                                                {guest.job_title || '-'}
                                            </td>
                                            <td className="text-[var(--color-text-secondary)]">
                                                {guest.research_company || guest.company || '-'}
                                            </td>
                                            <td className="text-[var(--color-text-secondary)]">
                                                {guest.country || '-'}
                                            </td>
                                            <td>
                                                {guest.net_worth ? (
                                                    <span className="text-sm font-medium text-[var(--color-accent-gold)]">
                                                        {guest.net_worth}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-[var(--color-text-secondary)]">-</span>
                                                )}
                                            </td>
                                            <td>
                                                {guest.vip_score ? (
                                                    <span className={getVIPBadgeClass(guest.vip_score)}>
                                                        {guest.vip_score}/10
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-[var(--color-text-secondary)]">
                                                        -
                                                    </span>
                                                )}
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <div className="flex gap-2">
                                                    {(() => {
                                                        const status = getGuestStatus(guest);

                                                        if (status === 'bezig') {
                                                            return (
                                                                <div className="flex items-center gap-2 px-3 py-1 bg-purple-50 rounded-lg border border-purple-100">
                                                                    <span className="animate-spin text-purple-600">⟳</span>
                                                                    <span className="text-[10px] font-medium text-purple-600 uppercase tracking-tight">
                                                                        Bezig
                                                                    </span>
                                                                </div>
                                                            );
                                                        }

                                                        if (status === 'wachtrij') {
                                                            return (
                                                                <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 rounded-lg border border-gray-100">
                                                                    <span className="text-[10px] font-medium text-gray-500 uppercase tracking-tight">
                                                                        Bezig
                                                                    </span>
                                                                </div>
                                                            );
                                                        }

                                                        if (status === 'onderzocht') {
                                                            return (
                                                                <button
                                                                    onClick={() => handleDownloadPDF(guest.id, guest.full_name)}
                                                                    className="btn btn-ghost text-xs px-3 py-1 hover:bg-gray-100 transition-all text-gray-700"
                                                                >
                                                                    📄 PDF
                                                                </button>
                                                            );
                                                        }

                                                        // Niet onderzocht - toon onderzoek knop
                                                        return (
                                                            <button
                                                                onClick={() => handleResearch(guest.id)}
                                                                className="btn btn-ghost text-xs px-3 py-1 hover:bg-[var(--color-accent-gold-lite)] transition-all"
                                                            >
                                                                🔍 Onderzoek
                                                            </button>
                                                        );
                                                    })()}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="p-12 text-center">
                        <p className="text-[var(--color-text-secondary)]">
                            {search || filter !== 'all'
                                ? t('Geen gasten gevonden met deze filters')
                                : t('Nog geen gasten geregistreerd')}
                        </p>
                    </div>
                )}

                {/* Paginering */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                        <div className="text-sm text-[var(--color-text-secondary)]">
                            Toon {startItem}-{endItem} van {total} gasten
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage(1)}
                                disabled={currentPage === 1}
                                className="btn btn-ghost text-xs px-3 py-1 disabled:opacity-40"
                                title="Eerste pagina"
                            >
                                ««
                            </button>
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                disabled={currentPage === 1}
                                className="btn btn-ghost text-xs px-3 py-1 disabled:opacity-40"
                            >
                                « Vorige
                            </button>

                            {/* Pagina nummers */}
                            <div className="flex items-center gap-1">
                                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                    let pageNum;
                                    if (totalPages <= 5) {
                                        pageNum = i + 1;
                                    } else if (currentPage <= 3) {
                                        pageNum = i + 1;
                                    } else if (currentPage >= totalPages - 2) {
                                        pageNum = totalPages - 4 + i;
                                    } else {
                                        pageNum = currentPage - 2 + i;
                                    }

                                    return (
                                        <button
                                            key={pageNum}
                                            onClick={() => setCurrentPage(pageNum)}
                                            className={`btn text-xs px-3 py-1 ${currentPage === pageNum ? 'btn-primary' : 'btn-ghost'}`}
                                        >
                                            {pageNum}
                                        </button>
                                    );
                                })}
                            </div>

                            <button
                                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                disabled={currentPage === totalPages}
                                className="btn btn-ghost text-xs px-3 py-1 disabled:opacity-40"
                            >
                                Volgende »
                            </button>
                            <button
                                onClick={() => setCurrentPage(totalPages)}
                                disabled={currentPage === totalPages}
                                className="btn btn-ghost text-xs px-3 py-1 disabled:opacity-40"
                                title="Laatste pagina"
                            >
                                »»
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
                    <div className="modal" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
                        <div className="p-6">
                            <h3 className="font-heading text-xl font-semibold mb-4">Gasten Verwijderen</h3>
                            <p className="text-[var(--color-text-secondary)] mb-6">
                                Weet je zeker dat je <strong>{selectedIds.length} gast{selectedIds.length !== 1 ? 'en' : ''}</strong> wilt verwijderen?
                                Dit verwijdert ook alle bijbehorende onderzoeksgegevens en kan niet ongedaan worden gemaakt.
                            </p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="btn btn-secondary"
                                >
                                    Annuleren
                                </button>
                                <button
                                    onClick={handleDeleteSelected}
                                    disabled={deletingSelected}
                                    className="btn"
                                    style={{
                                        background: 'linear-gradient(135deg, #DC2626, #B91C1C)',
                                        color: 'white'
                                    }}
                                >
                                    {deletingSelected ? 'Verwijderen...' : `🗑️ Verwijderen (${selectedIds.length})`}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Guest Modal */}
            {selectedGuest && (
                <GuestModal
                    guest={selectedGuest}
                    onClose={() => setSelectedGuest(null)}
                    onUpdate={handleGuestUpdated}
                    onResearch={handleResearch}
                    onDownloadPDF={handleDownloadPDF}
                />
            )}

            {/* Add Guest Form */}
            {showAddForm && (
                <AddGuestForm
                    onClose={() => setShowAddForm(false)}
                    onSuccess={handleGuestUpdated}
                />
            )}
        </div>
    );
}

export default Guests;
