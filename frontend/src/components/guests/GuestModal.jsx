import { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import { useLanguage } from '../../contexts/LanguageContext';

function GuestModal({ guest, onClose, onUpdate, onResearch, onDownloadPDF }) {
    const { t } = useLanguage();
    const [vipScore, setVipScore] = useState(guest.research?.vip_score || 5);
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState({
        full_name: guest.full_name,
        email: guest.email || '',
        phone: guest.phone || '',
        country: guest.country || '',
        company: guest.company || '',
        notes: guest.notes || '',
        linkedin_url: guest.research?.linkedin_url || '',
        profile_photo_url: guest.research?.profile_photo_url || ''
    });
    const [saving, setSaving] = useState(false);
    const [researching, setResearching] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showCandidates, setShowCandidates] = useState(false);
    const [customInput, setCustomInput] = useState(guest.research?.custom_research_input || '');
    const [isCustomAnalyzing, setIsCustomAnalyzing] = useState(false);
    const [showAiAssistant, setShowAiAssistant] = useState(false);
    const [message, setMessage] = useState(null);
    const [showPhotoOverlay, setShowPhotoOverlay] = useState(false);
    const [showSources, setShowSources] = useState(false);

    // DEBUG: Log research data to console
    useEffect(() => {
        console.log('🔍 GuestModal Research Data:', guest.research);
        console.log('📋 LinkedIn Candidates:', guest.research?.linkedin_candidates);
        console.log('🔗 LinkedIn URL:', guest.research?.linkedin_url);
        console.log('🌐 Website URL:', guest.research?.website_url);
    }, [guest]);

    const handleVipScoreChange = async (newScore) => {
        setVipScore(newScore);
        try {
            await apiFetch(`/api/guests/${guest.id}/vip-score`, {
                method: 'PUT',
                body: JSON.stringify({ vip_score: newScore })
            });
        } catch (error) {
            console.error('VIP score update mislukt:', error);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await apiFetch(`/api/guests/${guest.id}`, {
                method: 'PUT',
                body: JSON.stringify(editData)
            });

            // Also update LinkedIn URL in research if changed
            if (editData.linkedin_url !== research?.linkedin_url) {
                await apiFetch(`/api/research/${guest.id}/select-linkedin`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        manualUrl: editData.linkedin_url,
                        profilePhotoUrl: editData.profile_photo_url
                    })
                });
            }

            setIsEditing(false);
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Opslaan mislukt:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleResearch = async (force = false) => {
        setResearching(true);
        try {
            await apiFetch(`/api/research/${guest.id}`, {
                method: 'POST',
                body: JSON.stringify({ forceRefresh: force })
            });
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Research mislukt:', error);
        } finally {
            setResearching(false);
        }
    };

    const handleAiAnalyze = async () => {
        if (!customInput.trim()) return;
        setIsCustomAnalyzing(true);
        setMessage(null);
        try {
            await apiFetch(`/api/research/${guest.id}/ai-analyze`, {
                method: 'POST',
                body: JSON.stringify({ customInput })
            });
            setMessage({ type: 'success', text: 'Rapport bijgewerkt!' });
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Analyse mislukt:', error);
            setMessage({ type: 'error', text: error.message || 'Fout bij analyse' });
        } finally {
            setIsCustomAnalyzing(false);
        }
    };

    const handleRestore = async () => {
        setMessage(null);
        try {
            await apiFetch(`/api/research/${guest.id}/restore`, {
                method: 'POST'
            });
            setMessage({ type: 'success', text: 'Vorig rapport hersteld' });
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Restore mislukt:', error);
            setMessage({ type: 'error', text: error.message || 'Herstellen mislukt' });
        }
    };

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const response = await apiFetch(`/api/guests/${guest.id}`, {
                method: 'DELETE'
            });

            if (onUpdate) onUpdate();
            onClose();
        } catch (error) {
            console.error('Verwijderen mislukt:', error);
        } finally {
            setDeleting(false);
        }
    };

    const handleClearResearch = async () => {
        if (!window.confirm('Weet je zeker dat je alle onderzoeksresultaten voor deze gast wilt wissen? De gast zelf blijft bestaan.')) {
            return;
        }

        try {
            await apiFetch(`/api/research/${guest.id}`, {
                method: 'DELETE'
            });
            if (onUpdate) onUpdate();
        } catch (error) {
            console.error('Wissen research mislukt:', error);
            alert('Fout bij het wissen van research: ' + error.message);
        }
    };

    const getInfluenceLevel = (score) => {
        if (score >= 9) return 'VIP';
        if (score >= 7) return 'Hoog';
        if (score >= 5) return 'Gemiddeld';
        return 'Laag';
    };

    const handleManualGoogleSearch = () => {
        const query = encodeURIComponent(`"${guest.full_name}" ${guest.company || ''} ${guest.country || ''} linkedin`);
        window.open(`https://www.google.com/search?q=${query}`, '_blank');
    };

    const research = guest.research;
    const rawResults = research?.raw_search_results ?
        (typeof research.raw_search_results === 'string' ? JSON.parse(research.raw_search_results) : research.raw_search_results)
        : [];
    const fallbackData = rawResults.find(r => r.type === 'google_fallback' && r.data)?.data;
    const isFallback = !!fallbackData;

    // Count sources that actually have usable URLs
    const usableSourcesCount = rawResults.filter(result => {
        const data = result.data;
        if (!data) return false;
        if (result.type === 'linkedin_search' && data.candidates?.length > 0) return true;
        if (result.type === 'celebrity_detection' && data.wikipediaUrl) return true;
        if (result.type === 'news_search' && data.articles?.length > 0) return true;
        if (result.type === 'instagram_search' && data.url) return true;
        if (result.type === 'twitter_search' && data.url) return true;
        if (result.type === 'google_fallback' && data.url) return true;
        if (result.type === 'email_domain' && data.websiteUrl) return true;
        return false;
    }).length;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="p-6 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-4">
                        <div className="flex-shrink-0">
                            {research?.profile_photo_url ? (
                                <img
                                    src={research.profile_photo_url}
                                    alt={guest.full_name}
                                    className="w-16 h-16 rounded-full object-cover border-2 border-[var(--color-accent-gold)] shadow-md cursor-zoom-in hover:scale-110 transition-transform"
                                    onClick={() => setShowPhotoOverlay(true)}
                                    onError={(e) => {
                                        e.target.onerror = null;
                                        e.target.style.display = 'none';
                                        const placeholder = document.createElement('div');
                                        placeholder.className = "w-16 h-16 rounded-full bg-[var(--color-bg-secondary)] border-2 border-[var(--color-border)] flex items-center justify-center text-xl font-bold text-[var(--color-accent-gold)] shadow-sm";
                                        placeholder.innerText = guest.full_name.charAt(0).toUpperCase();
                                        e.target.parentNode.appendChild(placeholder);
                                    }}
                                />
                            ) : (
                                <div className="w-16 h-16 rounded-full bg-[var(--color-bg-secondary)] border-2 border-[var(--color-border)] flex items-center justify-center text-xl font-bold text-[var(--color-accent-gold)] shadow-sm">
                                    {guest.full_name.charAt(0).toUpperCase()}
                                </div>
                            )}
                        </div>
                        <div className="flex-1">
                            <div className="flex items-start justify-between">
                                <div>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={editData.full_name}
                                            onChange={(e) => setEditData({ ...editData, full_name: e.target.value })}
                                            className="input text-xl font-heading font-semibold"
                                        />
                                    ) : (
                                        <h2 className="font-heading text-2xl font-semibold">{guest.full_name}</h2>
                                    )}
                                    {research?.job_title && (
                                        <p className="text-[var(--color-text-secondary)] mt-1">
                                            {research.job_title}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    {!isEditing ? (
                                        <button
                                            onClick={() => setIsEditing(true)}
                                            className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-accent-gold)] hover:bg-[var(--color-bg-secondary)] rounded-lg transition-colors"
                                            title="Bewerken"
                                        >
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                            </svg>
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={handleSave}
                                                disabled={saving}
                                                className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                                title="Opslaan"
                                            >
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="20 6 9 17 4 12"></polyline>
                                                </svg>
                                            </button>
                                            <button
                                                onClick={() => setIsEditing(false)}
                                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                title="Annuleren"
                                            >
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                                </svg>
                                            </button>
                                        </div>
                                    )}
                                    <button
                                        onClick={onClose}
                                        className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] rounded-lg transition-colors text-2xl leading-none"
                                    >
                                        ×
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* VIP Score */}
                <div className="p-6 bg-[var(--color-bg-secondary)] border-b border-[var(--color-border)]">
                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-sm text-[var(--color-text-secondary)] uppercase tracking-wide">
                                VIP Score
                            </span>
                            <div className="vip-score-display mt-2">
                                <span className="vip-score-number">{vipScore}</span>
                                <span className="vip-score-label">/10<br />{getInfluenceLevel(vipScore)}</span>
                            </div>
                        </div>
                        <div className="flex-1 max-w-xs ml-8">
                            <input
                                type="range"
                                min="1"
                                max="10"
                                value={vipScore}
                                onChange={(e) => handleVipScoreChange(parseInt(e.target.value))}
                                className="slider w-full"
                            />
                            <div className="flex justify-between text-xs text-[var(--color-text-secondary)] mt-1">
                                <span>1</span>
                                <span>5</span>
                                <span>10</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Info Grid */}
                <div className="p-6 grid grid-cols-2 gap-4">
                    <div>
                        <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide block mb-1">
                            E-mail
                        </span>
                        {isEditing ? (
                            <input
                                type="email"
                                value={editData.email}
                                onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                                className="input"
                            />
                        ) : (
                            <span className="text-sm">{guest.email || '-'}</span>
                        )}
                    </div>
                    <div>
                        <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide block mb-1">
                            Telefoon
                        </span>
                        {isEditing ? (
                            <input
                                type="tel"
                                value={editData.phone}
                                onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                                className="input"
                            />
                        ) : (
                            <span className="text-sm">{guest.phone || '-'}</span>
                        )}
                    </div>
                    <div>
                        <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide block mb-1">
                            Land
                        </span>
                        {isEditing ? (
                            <input
                                type="text"
                                value={editData.country}
                                onChange={(e) => setEditData({ ...editData, country: e.target.value })}
                                className="input"
                            />
                        ) : (
                            <span className="text-sm">{guest.country || '-'}</span>
                        )}
                    </div>
                    <div>
                        <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide block mb-1">
                            Bedrijf
                        </span>
                        {isEditing ? (
                            <input
                                type="text"
                                value={editData.company}
                                onChange={(e) => setEditData({ ...editData, company: e.target.value })}
                                className="input"
                            />
                        ) : (
                            <div className="flex items-center gap-2">
                                <span className="text-sm">{research?.company_name || guest.company || '-'}</span>
                                {research?.company_ownership_label && (
                                    <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                                        {research.company_ownership_label}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                    <div>
                        <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide block mb-1">
                            Totaal Verblijven
                        </span>
                        <span className="text-sm">{guest.total_stays || 1}x</span>
                    </div>
                    <div>
                        <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide block mb-1">
                            Eerste Bezoek
                        </span>
                        <span className="text-sm">{guest.first_seen || '-'}</span>
                    </div>

                    {isEditing && (
                        <div className="col-span-2">
                            <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide block mb-1">
                                Profielfoto URL
                            </span>
                            <input
                                type="text"
                                value={editData.profile_photo_url}
                                onChange={(e) => setEditData({ ...editData, profile_photo_url: e.target.value })}
                                className="input"
                                placeholder="Plak hier een directe link naar een afbeelding..."
                            />
                            <p className="text-[10px] text-gray-500 mt-1">
                                Tip: Rechtermuisknop op een LinkedIn foto &gt; "Afbeeldingadres kopiëren"
                            </p>
                        </div>
                    )}

                    <div className="col-span-2">
                        <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide block mb-1">
                            LinkedIn URL
                        </span>
                        {isEditing ? (
                            <input
                                type="url"
                                value={editData.linkedin_url}
                                onChange={(e) => setEditData({ ...editData, linkedin_url: e.target.value })}
                                className="input"
                                placeholder="https://www.linkedin.com/in/..."
                            />
                        ) : (
                            <span className="text-sm truncate block font-mono text-xs">{research?.linkedin_url || '-'}</span>
                        )}
                    </div>
                </div>

                {/* Research Results */}
                {research && (
                    <div className="p-6 border-t border-[var(--color-border)]">
                        <h4 className="font-semibold text-sm text-[var(--color-accent-gold)] uppercase tracking-wide mb-4">
                            Onderzoeksresultaten
                        </h4>

                        {research.no_results_found === 1 && (
                            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-4 text-red-700 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="text-2xl mt-0.5">⚠️</div>
                                <div className="space-y-1">
                                    <p className="font-bold text-base leading-tight">Geen openbare informatie gevonden</p>
                                    <p className="text-sm opacity-90 leading-relaxed">
                                        Onze onderzoeker kon geen betrouwbare publieke profielen, nieuwsberichten of bedrijfsgegevens vinden voor deze gast.
                                        Dit kan betekenen dat de gast een zeer beperkte online aanwezigheid heeft of dat de gegevens afgeschermd zijn.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Financial Info & Follower Breakdown */}
                        {(research.net_worth || research.followers_estimate || research.instagram_followers || research.twitter_followers) && (
                            <div className="mb-4 p-4 bg-[var(--color-bg-secondary)] rounded-lg">
                                <div className="grid grid-cols-2 gap-4">
                                    {research.net_worth && (
                                        <div>
                                            <span className="text-xs text-[var(--color-text-secondary)] uppercase">Net Worth</span>
                                            <div className="text-lg font-semibold text-[var(--color-accent-gold)]">{research.net_worth}</div>
                                        </div>
                                    )}
                                    {(research.followers_estimate || research.instagram_followers || research.twitter_followers) && (
                                        <div>
                                            <span className="text-xs text-[var(--color-text-secondary)] uppercase">Volgers (totaal)</span>
                                            <div className="text-lg font-semibold">{research.followers_estimate || 'Onbekend'}</div>
                                        </div>
                                    )}
                                </div>
                                {/* Follower Breakdown by Platform */}
                                {(research.instagram_followers || research.twitter_followers) && (
                                    <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                                        <span className="text-[10px] text-[var(--color-text-secondary)] uppercase font-semibold block mb-2">Uitsplitsing per platform</span>
                                        <div className="flex flex-wrap gap-3">
                                            {research.instagram_followers && (
                                                <div className="flex items-center gap-1.5 text-sm">
                                                    <span className="w-4 h-4 rounded bg-gradient-to-tr from-[#833AB4] via-[#FD1D1D] to-[#F77737] flex items-center justify-center">
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
                                                            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073z" />
                                                        </svg>
                                                    </span>
                                                    <span className="font-medium">{research.instagram_followers.toLocaleString()}</span>
                                                    <span className="text-[var(--color-text-secondary)] text-xs">Instagram</span>
                                                </div>
                                            )}
                                            {research.twitter_followers && (
                                                <div className="flex items-center gap-1.5 text-sm">
                                                    <span className="w-4 h-4 rounded bg-black flex items-center justify-center">
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
                                                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                                        </svg>
                                                    </span>
                                                    <span className="font-medium">{research.twitter_followers.toLocaleString()}</span>
                                                    <span className="text-[var(--color-text-secondary)] text-xs">X / Twitter</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Social Media Links */}
                        <div className="flex flex-wrap gap-3 mb-4">
                            {research.linkedin_url && (
                                <div className="flex items-center gap-2">
                                    <a href={research.linkedin_url} target="_blank" rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-3 py-2 bg-[#0077B5] text-white rounded-lg text-sm hover:opacity-90">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                                        </svg>
                                        LinkedIn
                                    </a>
                                    {research.linkedin_candidates && research.linkedin_candidates.length > 1 && (
                                        <button
                                            onClick={() => setShowCandidates(!showCandidates)}
                                            className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm hover:bg-[var(--color-bg-secondary)] transition-colors"
                                            title="Andere kandidaten bekijken"
                                        >
                                            {showCandidates ? '✕' : '🔄 Wissel'}
                                        </button>
                                    )}
                                </div>
                            )}
                            {research.instagram_url && (
                                <a href={research.instagram_url} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F77737] text-white rounded-lg text-sm hover:opacity-90">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                                    </svg>
                                    Instagram
                                </a>
                            )}
                            {research.twitter_url && (
                                <a href={research.twitter_url} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 bg-black text-white rounded-lg text-sm hover:opacity-90">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                    </svg>
                                    X / Twitter
                                </a>
                            )}
                            {research.facebook_url && (
                                <a href={research.facebook_url} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 bg-[#1877F2] text-white rounded-lg text-sm hover:opacity-90">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z" />
                                    </svg>
                                    Facebook
                                </a>
                            )}
                            {research.youtube_url && (
                                <a href={research.youtube_url} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 bg-[#FF0000] text-white rounded-lg text-sm hover:opacity-90">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                                    </svg>
                                    YouTube
                                </a>
                            )}
                            {research.website_url && (
                                <a href={research.website_url.startsWith('http') ? research.website_url : `https://${research.website_url}`}
                                    target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 bg-[var(--color-accent-gold)] text-white rounded-lg text-sm hover:opacity-90 transition-all shadow-sm">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <line x1="2" y1="12" x2="22" y2="12"></line>
                                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                                    </svg>
                                    Website
                                </a>
                            )}

                            {/* Sources Toggle Button */}
                            <button
                                onClick={() => setShowSources(!showSources)}
                                className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 border border-gray-200 rounded-lg text-sm hover:bg-gray-200 transition-colors"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                                </svg>
                                Bronnen {usableSourcesCount > 0 && `(${usableSourcesCount})`}
                            </button>
                        </div>

                        {/* Sources List */}
                        {showSources && usableSourcesCount > 0 && (
                            <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg animate-in fade-in slide-in-from-top-2 duration-200">
                                <h5 className="font-semibold text-xs text-uppercase text-gray-500 mb-3 tracking-wide">Geraadpleegde Bronnen</h5>
                                <div className="flex flex-wrap gap-2">
                                    {rawResults.map((result, idx) => {
                                        const data = result.data;
                                        if (!data) return null;

                                        // LinkedIn
                                        if (result.type === 'linkedin_search' && data.candidates?.length > 0) {
                                            return data.candidates.map((c, cIdx) => c.url && (
                                                <a key={`li-${idx}-${cIdx}`} href={c.url} target="_blank" rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0077B5] text-white rounded-full text-xs font-medium hover:bg-[#005885] transition-colors">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
                                                    LinkedIn
                                                </a>
                                            ));
                                        }

                                        // Wikipedia
                                        if (result.type === 'celebrity_detection' && data.wikipediaUrl) {
                                            return (
                                                <a key={`wiki-${idx}`} href={data.wikipediaUrl} target="_blank" rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 text-white rounded-full text-xs font-medium hover:bg-gray-800 transition-colors">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.09 13.119c-.936 1.932-2.217 4.548-2.853 5.728-.616 1.074-1.127.931-1.532.029-1.406-3.321-4.293-9.144-5.651-12.409-.251-.601-.441-.987-.619-1.139-.181-.15-.554-.24-1.122-.271C.103 5.033 0 4.982 0 4.898v-.455l.052-.045c.924-.005 5.401 0 5.401 0l.051.045v.434c0 .119-.075.176-.225.176l-.564.031c-.485.029-.727.164-.727.436 0 .135.053.33.166.601 1.082 2.646 4.818 10.521 4.818 10.521l.136.046 2.411-4.81-.482-1.067-1.658-3.264s-.318-.654-.428-.872c-.728-1.443-.712-1.518-1.447-1.617-.207-.028-.344-.084-.344-.207v-.422l.05-.054h4.517l.054.045v.436c0 .135-.076.18-.229.18l-.377.016c-.612.06-.612.144-.383.639 1.379 2.888 2.383 4.871 2.383 4.871l2.094-4.037c.264-.521.168-.775-.186-.855l-.678-.074c-.15 0-.226-.057-.226-.176v-.496l.05-.045h4.206l.054.054v.436c0 .135-.075.189-.226.189-.556.046-1.275.286-1.664.872l-2.723 5.347.477.976s2.398 4.854 3.062 6.146c.615 1.074 1.063.976 1.47.187.58-1.179 1.809-3.713 2.657-5.611l.496-1.067c.076-.165.15-.283.15-.346 0-.225-.272-.324-.795-.361l-.586-.016c-.151 0-.227-.057-.227-.189v-.422l.051-.054h5.074l.054.054v.436c0 .135-.076.189-.227.189-.557.046-1.231.24-1.582.601l-4.286 8.716-.168.001z" /></svg>
                                                    Wikipedia
                                                </a>
                                            );
                                        }

                                        // News
                                        if (result.type === 'news_search' && data.articles?.length > 0) {
                                            return (
                                                <a key={`news-${idx}`} href={data.articles[0].url} target="_blank" rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-full text-xs font-medium hover:bg-red-700 transition-colors">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 11h8m-8 4h4" /></svg>
                                                    Nieuws ({data.articles.length})
                                                </a>
                                            );
                                        }

                                        // Instagram
                                        if (result.type === 'instagram_search' && data.url) {
                                            return (
                                                <a key={`ig-${idx}`} href={data.url} target="_blank" rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 text-white rounded-full text-xs font-medium hover:opacity-90 transition-opacity">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" /></svg>
                                                    @{data.handle}
                                                </a>
                                            );
                                        }

                                        // Twitter/X
                                        if (result.type === 'twitter_search' && data.url) {
                                            return (
                                                <a key={`tw-${idx}`} href={data.url} target="_blank" rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black text-white rounded-full text-xs font-medium hover:bg-gray-800 transition-colors">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                                                    @{data.handle}
                                                </a>
                                            );
                                        }

                                        // Google/fallback
                                        if (result.type === 'google_fallback' && data.url) {
                                            return (
                                                <a key={`google-${idx}`} href={data.url} target="_blank" rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded-full text-xs font-medium hover:bg-blue-600 transition-colors">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                                                    Website
                                                </a>
                                            );
                                        }

                                        // Company website
                                        if (result.type === 'email_domain' && data.websiteUrl) {
                                            return (
                                                <a key={`company-${idx}`} href={data.websiteUrl} target="_blank" rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-full text-xs font-medium hover:bg-emerald-700 transition-colors">
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M3 7v1a3 3 0 003 3h12a3 3 0 003-3V7M3 7l9-4 9 4" /></svg>
                                                    {data.companyName || 'Bedrijf'}
                                                </a>
                                            );
                                        }

                                        return null;
                                    })}
                                </div>
                            </div>
                        )}

                        {/* LinkedIn Review/Selection Section */}
                        {research.linkedin_candidates && (
                            <div className={`mb-6 p-4 border rounded-lg ${research.needs_linkedin_review === 1 ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}`}>
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">{research.needs_linkedin_review === 1 ? '⚠️' : '📋'}</span>
                                        <h5 className={`font-semibold text-sm ${research.needs_linkedin_review === 1 ? 'text-yellow-800' : 'text-gray-800'}`}>
                                            {research.needs_linkedin_review === 1 ? 'LinkedIn Review Nodig' : 'Beschikbare LinkedIn Profielen'}
                                        </h5>
                                    </div>
                                    <button
                                        onClick={() => setShowCandidates(!showCandidates)}
                                        className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${showCandidates
                                            ? 'bg-white border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-gray-100'
                                            : 'bg-[var(--color-accent-gold)] border-[var(--color-accent-gold)] text-white hover:opacity-90'
                                            }`}
                                    >
                                        {showCandidates ? 'Verbergen' : 'Bekijk Opties'}
                                    </button>
                                </div>

                                {showCandidates && (
                                    <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
                                        <p className={`text-xs mb-4 ${research.needs_linkedin_review === 1 ? 'text-yellow-700' : 'text-gray-600'}`}>
                                            {research.needs_linkedin_review === 1
                                                ? 'We hebben meerdere profielen gevonden. Kies de juiste persoon:'
                                                : 'Bekijk andere profielen die we hebben gevonden voor deze gast:'}
                                        </p>
                                        <div className="space-y-3">
                                            {(() => {
                                                try {
                                                    const candidates = typeof research.linkedin_candidates === 'string'
                                                        ? JSON.parse(research.linkedin_candidates)
                                                        : research.linkedin_candidates;

                                                    return candidates.map((candidate, idx) => (
                                                        <div key={idx} className="flex items-start gap-3 p-3 bg-white rounded border border-gray-200 hover:border-[var(--color-accent-gold)] transition-colors group">
                                                            {candidate.thumbnail && (
                                                                <img src={candidate.thumbnail} alt="" className="w-12 h-12 rounded object-cover shadow-sm" />
                                                            )}
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-medium text-sm truncate group-hover:text-[var(--color-accent-gold)] transition-colors">
                                                                    {candidate.profileName || candidate.title}
                                                                </div>
                                                                <div className="text-[10px] text-gray-500 line-clamp-2 mb-2">{candidate.snippet}</div>
                                                                <div className="flex gap-2">
                                                                    <a href={candidate.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] text-blue-600 hover:underline">
                                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                                                                            <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                                                                        </svg>
                                                                        Bekijk Profiel
                                                                    </a>
                                                                    <button
                                                                        onClick={async () => {
                                                                            try {
                                                                                await apiFetch(`/api/research/${guest.id}/select-linkedin`, {
                                                                                    method: 'PUT',
                                                                                    body: JSON.stringify({ candidateIndex: idx })
                                                                                });
                                                                                setShowCandidates(false);
                                                                                if (onUpdate) onUpdate();
                                                                            } catch (e) {
                                                                                console.error(e);
                                                                            }
                                                                        }}
                                                                        className={`text-[10px] font-bold px-2 py-1 rounded border ${candidate.url === research.linkedin_url
                                                                            ? 'bg-green-100 text-green-800 border-green-200 cursor-default'
                                                                            : 'bg-white text-green-600 border-green-600 hover:bg-green-50'}`}
                                                                    >
                                                                        {candidate.url === research.linkedin_url ? 'Geselecteerd' : 'Selecteer deze persoon'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ));
                                                } catch (e) {
                                                    return <p className="text-xs text-red-500">Fout bij laden kandidaten</p>;
                                                }
                                            })()}
                                            <button
                                                onClick={handleResearch}
                                                className="text-[10px] text-gray-500 hover:text-gray-700 italic underline mt-2 block w-full text-center"
                                            >
                                                Niemand klopt? Probeer onderzoek opnieuw met aangepaste gegevens.
                                            </button>
                                            <button
                                                onClick={handleManualGoogleSearch}
                                                className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold mt-2 block w-full text-center hover:underline"
                                            >
                                                Of zoek handmatig op Google voor meer resultaten
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="space-y-6">
                            {research.industry && (
                                <div className="flex items-start gap-2 p-3 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)]">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-accent-gold)] mt-0.5">
                                        <rect x="2" y="10" width="20" height="12" rx="2" ry="2"></rect>
                                        <path d="M7 10V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5"></path>
                                        <line x1="12" y1="14" x2="12" y2="18"></line>
                                        <line x1="8" y1="14" x2="8" y2="18"></line>
                                        <line x1="16" y1="16" x2="16" y2="16"></line>
                                    </svg>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] text-[var(--color-text-secondary)] uppercase font-semibold">Industrie / Sector</span>
                                        <span className="text-sm font-medium">{research.industry}</span>
                                    </div>
                                </div>
                            )}

                            {/* Full Report Display */}
                            {(() => {
                                let fullReport = null;
                                try {
                                    fullReport = typeof research.full_report === 'string'
                                        ? JSON.parse(research.full_report)
                                        : research.full_report;
                                } catch (e) {
                                    console.error('Failed to parse full report', e);
                                }

                                if (!fullReport) return research.notable_info && (
                                    <div className="mt-4 p-4 bg-[var(--color-bg-secondary)] rounded-lg border-l-4 border-[var(--color-accent-gold)]">
                                        <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide block mb-2">
                                            Opmerkelijke Info
                                        </span>
                                        <p className="text-sm">{research.notable_info}</p>
                                    </div>
                                );

                                return (
                                    <div className="space-y-3 mt-6">
                                        {/* Executive Summary - Compact Hero */}
                                        {fullReport.executive_summary && (
                                            <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200 p-4">
                                                <div className="flex items-start gap-3">
                                                    <span className="text-2xl">📋</span>
                                                    <div className="flex-1">
                                                        <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-2">{t('Samenvatting')}</h4>
                                                        <p className="text-sm leading-relaxed text-gray-700">
                                                            {/* Clean up citation marks from AI output */}
                                                            {fullReport.executive_summary.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim()}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Quick Stats Row */}
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                            {fullReport.professional_background?.current_role && (
                                                <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                                                    <span className="text-[10px] uppercase font-bold text-blue-600 block mb-1">{t('Rol')}</span>
                                                    <p className="text-sm font-medium text-gray-800 line-clamp-2">{fullReport.professional_background.current_role}</p>
                                                </div>
                                            )}
                                            {fullReport.company_analysis?.company_name && (
                                                <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                                                    <span className="text-[10px] uppercase font-bold text-emerald-600 block mb-1">{t('Bedrijf')}</span>
                                                    <p className="text-sm font-medium text-gray-800 line-clamp-2">{fullReport.company_analysis.company_name}</p>
                                                </div>
                                            )}
                                            {fullReport.professional_background?.industry_expertise && (
                                                <div className="bg-purple-50 rounded-lg p-3 border border-purple-100">
                                                    <span className="text-[10px] uppercase font-bold text-purple-600 block mb-1">{t('Sector')}</span>
                                                    <p className="text-sm font-medium text-gray-800 line-clamp-2">{fullReport.professional_background.industry_expertise}</p>
                                                </div>
                                            )}
                                            {research.vip_score && (
                                                <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                                                    <span className="text-[10px] uppercase font-bold text-amber-600 block mb-1">{t('VIP Score')}</span>
                                                    <p className="text-xl font-bold text-amber-700">{research.vip_score}/10</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Collapsible Detail Sections */}
                                        <div className="space-y-2">
                                            {/* Professional Details - Collapsible */}
                                            {(fullReport.professional_background?.career_trajectory || fullReport.professional_background?.notable_achievements) && (
                                                <details className="group bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                                    <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors list-none">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-lg">👤</span>
                                                            <span className="text-sm font-semibold text-gray-800">{t('Professionele Details')}</span>
                                                        </div>
                                                        <span className="transform group-open:rotate-180 transition-transform text-gray-400">▼</span>
                                                    </summary>
                                                    <div className="px-4 pb-4 pt-0 border-t border-gray-100 space-y-3">
                                                        {fullReport.professional_background?.career_trajectory && (
                                                            <div>
                                                                <span className="text-[10px] uppercase font-bold text-gray-500 block mb-1">📈 Carrière</span>
                                                                <p className="text-sm text-gray-700">{fullReport.professional_background.career_trajectory.replace(/\[\d+\]/g, '')}</p>
                                                            </div>
                                                        )}
                                                        {fullReport.professional_background?.notable_achievements && (
                                                            <div>
                                                                <span className="text-[10px] uppercase font-bold text-gray-500 block mb-1">🏆 Prestaties</span>
                                                                <p className="text-sm text-gray-700">{fullReport.professional_background.notable_achievements.replace(/\[\d+\]/g, '')}</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </details>
                                            )}

                                            {/* Company Details - Collapsible */}
                                            {(fullReport.company_analysis?.company_type || fullReport.company_analysis?.company_description || fullReport.company_analysis?.ownership_likelihood || fullReport.company_analysis?.company_position || fullReport.company_analysis?.employee_count) && (
                                                <details className="group bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                                    <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors list-none">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-lg">🏢</span>
                                                            <span className="text-sm font-semibold text-gray-800">Bedrijfsdetails</span>
                                                            {fullReport.company_analysis?.ownership_likelihood === 'high' && (
                                                                <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">Waarschijnlijk eigenaar</span>
                                                            )}
                                                        </div>
                                                        <span className="transform group-open:rotate-180 transition-transform text-gray-400">▼</span>
                                                    </summary>
                                                    <div className="px-4 pb-4 pt-0 border-t border-gray-100 space-y-3">
                                                        {fullReport.company_analysis?.company_type && (
                                                            <div>
                                                                <span className="text-[10px] uppercase font-bold text-gray-500 block mb-1">🏷️ Type Bedrijf</span>
                                                                <p className="text-sm text-gray-700">{fullReport.company_analysis.company_type}</p>
                                                            </div>
                                                        )}
                                                        {fullReport.company_analysis?.company_description && (
                                                            <div>
                                                                <span className="text-[10px] uppercase font-bold text-gray-500 block mb-1">📝 Wat doen ze</span>
                                                                <p className="text-sm text-gray-700">{fullReport.company_analysis.company_description}</p>
                                                            </div>
                                                        )}
                                                        {fullReport.company_analysis?.ownership_likelihood && fullReport.company_analysis.ownership_likelihood !== 'unknown' && (
                                                            <div>
                                                                <span className="text-[10px] uppercase font-bold text-gray-500 block mb-1">👤 Rol Inschatting</span>
                                                                <p className="text-sm text-gray-700">
                                                                    {fullReport.company_analysis.ownership_likelihood === 'high' && '🟢 Waarschijnlijk eigenaar of besluitvormer'}
                                                                    {fullReport.company_analysis.ownership_likelihood === 'medium' && '🟡 Mogelijk leidinggevende positie'}
                                                                    {fullReport.company_analysis.ownership_likelihood === 'low' && '⚪ Waarschijnlijk medewerker'}
                                                                </p>
                                                            </div>
                                                        )}
                                                        {fullReport.company_analysis?.company_position && (
                                                            <div>
                                                                <span className="text-[10px] uppercase font-bold text-gray-500 block mb-1">📊 Marktpositie</span>
                                                                <p className="text-sm text-gray-700">{fullReport.company_analysis.company_position}</p>
                                                            </div>
                                                        )}
                                                        {fullReport.company_analysis?.employee_count && (
                                                            <div>
                                                                <span className="text-[10px] uppercase font-bold text-gray-500 block mb-1">👥 Medewerkers</span>
                                                                <p className="text-sm text-gray-700">{fullReport.company_analysis.employee_count}</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </details>
                                            )}

                                            {/* VIP Indicators - Collapsible */}
                                            {(fullReport.vip_indicators?.wealth_signals || fullReport.vip_indicators?.influence_factors || fullReport.vip_indicators?.status_markers) && (
                                                <details className="group bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl border border-purple-200 overflow-hidden">
                                                    <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-purple-100/50 transition-colors list-none">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-lg">⭐</span>
                                                            <span className="text-sm font-semibold text-purple-800">VIP Indicatoren</span>
                                                        </div>
                                                        <span className="transform group-open:rotate-180 transition-transform text-purple-400">▼</span>
                                                    </summary>
                                                    <div className="px-4 pb-4 pt-0 border-t border-purple-200">
                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                                                            {fullReport.vip_indicators?.wealth_signals && (
                                                                <div className="bg-white/70 rounded-lg p-3 border border-purple-100">
                                                                    <span className="text-[10px] uppercase font-bold text-purple-600 block mb-1">💰 Vermogen</span>
                                                                    <p className="text-xs text-gray-700">{fullReport.vip_indicators.wealth_signals}</p>
                                                                </div>
                                                            )}
                                                            {fullReport.vip_indicators?.influence_factors && (
                                                                <div className="bg-white/70 rounded-lg p-3 border border-purple-100">
                                                                    <span className="text-[10px] uppercase font-bold text-purple-600 block mb-1">🌟 Invloed</span>
                                                                    <p className="text-xs text-gray-700">{fullReport.vip_indicators.influence_factors}</p>
                                                                </div>
                                                            )}
                                                            {fullReport.vip_indicators?.status_markers && (
                                                                <div className="bg-white/70 rounded-lg p-3 border border-purple-100">
                                                                    <span className="text-[10px] uppercase font-bold text-purple-600 block mb-1">👑 Status</span>
                                                                    <p className="text-xs text-gray-700">{fullReport.vip_indicators.status_markers}</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </details>
                                            )}
                                        </div>

                                        {/* Service Recommendations - Action Card */}
                                        {fullReport.service_recommendations && (
                                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                                <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-lg">🎯</span>
                                                            <h5 className="text-sm font-bold text-white uppercase tracking-wide">Service Aanbevelingen</h5>
                                                        </div>
                                                        {fullReport.service_recommendations?.priority_level && (
                                                            <span className="bg-white/20 text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase">
                                                                {fullReport.service_recommendations.priority_level}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="p-4 space-y-4">
                                                    {/* Quick Win - Highlighted */}
                                                    {fullReport.service_recommendations?.quick_win && (
                                                        <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-lg p-4 border-l-4 border-amber-400">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <span className="text-lg">⚡</span>
                                                                <span className="text-xs font-bold uppercase text-amber-700">Quick Win</span>
                                                            </div>
                                                            <p className="text-sm font-medium text-gray-800">
                                                                {fullReport.service_recommendations.quick_win}
                                                            </p>
                                                        </div>
                                                    )}

                                                    {/* Service Categories */}
                                                    {fullReport.service_recommendations?.categories?.length > 0 && (
                                                        <div className="space-y-2">
                                                            {fullReport.service_recommendations.categories.map((cat, idx) => (
                                                                <details key={idx} className="group border border-gray-200 rounded-lg overflow-hidden bg-gray-50 transition-all hover:border-amber-300">
                                                                    <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-100 transition-colors list-none">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-sm">{idx === 0 ? '💬' : idx === 1 ? '📰' : '🎁'}</span>
                                                                            <span className="text-sm font-semibold text-gray-800">{cat.title}</span>
                                                                        </div>
                                                                        <span className="transform group-open:rotate-180 transition-transform text-xs text-gray-400">▼</span>
                                                                    </summary>
                                                                    <div className="p-3 pt-0 bg-white border-t border-gray-100">
                                                                        <ul className="space-y-2">
                                                                            {cat.items?.map((item, i) => (
                                                                                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                                                                                    <span className="text-amber-500 mt-0.5">•</span>
                                                                                    <span>{item}</span>
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    </div>
                                                                </details>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Fallback for old format */}
                                                    {!fullReport.service_recommendations?.categories && (fullReport.service_recommendations?.special_attention || fullReport.service_recommendations?.communication_style || fullReport.service_recommendations?.gift_suggestions) && (
                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                            {fullReport.service_recommendations?.special_attention && (
                                                                <div className="bg-gray-50 rounded-lg p-3">
                                                                    <span className="text-[10px] uppercase font-bold text-gray-500">Focus</span>
                                                                    <p className="text-sm text-gray-700 mt-1">{fullReport.service_recommendations.special_attention}</p>
                                                                </div>
                                                            )}
                                                            {fullReport.service_recommendations?.communication_style && (
                                                                <div className="bg-gray-50 rounded-lg p-3">
                                                                    <span className="text-[10px] uppercase font-bold text-gray-500">Communicatie</span>
                                                                    <p className="text-sm text-gray-700 mt-1">{fullReport.service_recommendations.communication_style}</p>
                                                                </div>
                                                            )}
                                                            {fullReport.service_recommendations?.gift_suggestions && (
                                                                <div className="bg-gray-50 rounded-lg p-3">
                                                                    <span className="text-[10px] uppercase font-bold text-gray-500">Cadeau Tip</span>
                                                                    <p className="text-sm text-gray-700 mt-1">{fullReport.service_recommendations.gift_suggestions}</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {fullReport.additional_notes && (
                                            <div className="text-xs italic text-[var(--color-text-secondary)]">
                                                * {fullReport.additional_notes}
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* AI Research Assistant */}
                <div className="p-6 border-t border-[var(--color-border)]">
                    <button
                        onClick={() => setShowAiAssistant(!showAiAssistant)}
                        className="flex items-center justify-between w-full text-left"
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-lg">✨</span>
                            <h4 className="font-semibold text-sm text-[var(--color-text-primary)] uppercase tracking-wide">
                                Onderzoeks Assistent
                            </h4>
                        </div>
                        <span className={`transform transition-transform ${showAiAssistant ? 'rotate-180' : ''}`}>
                            ▼
                        </span>
                    </button>

                    {showAiAssistant && (
                        <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-2">
                            <p className="text-xs text-[var(--color-text-secondary)]">
                                Voed de assistent met informatie die je zelf hebt gevonden (links naar artikelen, LinkedIn posts, of je eigen bevindingen) om een scherper rapport te krijgen.
                            </p>

                            <textarea
                                value={customInput}
                                onChange={(e) => setCustomInput(e.target.value)}
                                className="input min-h-[120px] text-sm resize-none"
                                placeholder="Plak hier je bevindingen om het rapport te verfijnen..."
                                disabled={isCustomAnalyzing}
                            />

                            {message && (
                                <div className={`p-3 rounded-lg text-xs flex justify-between items-center ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                                    }`}>
                                    <span>{message.type === 'success' ? '✅' : '❌'} {message.text}</span>
                                    <button onClick={() => setMessage(null)} className="opacity-50 hover:opacity-100">✕</button>
                                </div>
                            )}

                            <div className="flex gap-2 justify-end">
                                {research?.previous_full_report && (
                                    <button
                                        onClick={handleRestore}
                                        className="btn btn-secondary text-xs py-2 px-4"
                                        title="Vorig rapport herstellen"
                                    >
                                        ↩️ Ongedaan maken
                                    </button>
                                )}
                                <button
                                    onClick={handleAiAnalyze}
                                    disabled={isCustomAnalyzing || !customInput.trim()}
                                    className="btn btn-primary text-xs py-2 px-4 flex items-center gap-2 shadow-sm"
                                >
                                    {isCustomAnalyzing ? (
                                        <>
                                            <span className="animate-spin text-sm">🔄</span>
                                            Bezig met verwerken...
                                        </>
                                    ) : (
                                        <>✨ Analyseer Verder</>
                                    )}
                                </button>
                            </div>

                            <p className="text-[10px] text-[var(--color-text-secondary)] italic">
                                Tip: Hoe meer context je geeft, hoe krachtiger het rapport. Het systeem combineert dit met bestaande LinkedIn data.
                            </p>
                        </div>
                    )}
                </div>

                {/* Notes */}
                {(isEditing || guest.notes) && (
                    <div className="p-6 border-t border-[var(--color-border)]">
                        <span className="text-xs text-[var(--color-text-secondary)] uppercase tracking-wide block mb-2">
                            Notities
                        </span>
                        {isEditing ? (
                            <textarea
                                value={editData.notes}
                                onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                                className="input min-h-[80px]"
                                placeholder="Voeg notities toe..."
                            />
                        ) : (
                            <p className="text-sm">{guest.notes}</p>
                        )}
                    </div>
                )}

                {/* Actions */}
                <div className="p-6 border-t border-[var(--color-border)] flex justify-between items-center bg-[var(--color-bg-secondary)]">
                    <div className="flex gap-2">
                        {isEditing ? (
                            <>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="btn btn-primary"
                                >
                                    {saving ? 'Opslaan...' : 'Opslaan'}
                                </button>
                                <button
                                    onClick={() => setIsEditing(false)}
                                    className="btn btn-secondary"
                                >
                                    Annuleren
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="btn btn-secondary"
                                >
                                    ✏️ Bewerken
                                </button>
                                {showDeleteConfirm ? (
                                    <div className="flex gap-2 items-center">
                                        <span className="text-sm text-red-600">Weet je het zeker?</span>
                                        <button
                                            onClick={handleDelete}
                                            disabled={deleting}
                                            className="btn text-white px-3 py-1 text-sm"
                                            style={{ backgroundColor: '#dc2626' }}
                                        >
                                            {deleting ? 'Bezig...' : 'Ja, verwijder'}
                                        </button>
                                        <button
                                            onClick={() => setShowDeleteConfirm(false)}
                                            className="btn btn-secondary px-3 py-1 text-sm"
                                        >
                                            Nee
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        {research && (
                                            <button
                                                onClick={handleClearResearch}
                                                className="btn btn-secondary text-amber-600 border-amber-200 hover:bg-amber-50"
                                                title="Onderzoeksresultaten wissen"
                                            >
                                                🧹 Wissen
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setShowDeleteConfirm(true)}
                                            className="btn btn-secondary"
                                            style={{ color: '#dc2626' }}
                                        >
                                            🗑️ Verwijderen
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div className="flex gap-2">
                        {research && (
                            <button
                                onClick={() => handleResearch(true)}
                                disabled={researching}
                                className="btn btn-secondary"
                            >
                                {researching ? '🔄 Vernieuwen...' : '🔄 Herhaal Onderzoek'}
                            </button>
                        )}
                        {!research && (
                            <button
                                onClick={() => handleResearch(false)}
                                disabled={researching}
                                className="btn btn-secondary"
                            >
                                {researching ? '🔍 Zoeken...' : '🔍 Onderzoek Starten'}
                            </button>
                        )}
                        <button
                            onClick={() => onDownloadPDF(guest.id, guest.full_name)}
                            className="btn btn-primary"
                        >
                            📄 PDF Downloaden
                        </button>
                    </div>
                </div>
            </div>

            {/* Photo Overlay */}
            {showPhotoOverlay && research?.profile_photo_url && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-90 animate-in fade-in duration-200 cursor-zoom-out"
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowPhotoOverlay(false);
                    }}
                >
                    <img
                        src={research.profile_photo_url}
                        alt={guest.full_name}
                        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-200"
                    />
                    <button
                        className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors p-4"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowPhotoOverlay(false);
                        }}
                    >
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
}

export default GuestModal;
