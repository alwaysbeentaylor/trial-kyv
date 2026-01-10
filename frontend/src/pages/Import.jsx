import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AddGuestForm from '../components/guests/AddGuestForm';
import { apiFetch, apiPostFile } from '../utils/api';
import { useLanguage } from '../contexts/LanguageContext';

function Import({ onUpdate }) {
    const { t } = useLanguage();
    const navigate = useNavigate();
    const [file, setFile] = useState(null);
    const [importing, setImporting] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [preview, setPreview] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [dragging, setDragging] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [autoEnrich, setAutoEnrich] = useState(true);
    const [batches, setBatches] = useState([]);
    const [showBatches, setShowBatches] = useState(false);
    const [deletingBatch, setDeletingBatch] = useState(null);
    const [enrichmentProgress, setEnrichmentProgress] = useState(null);
    const [selectedIndices, setSelectedIndices] = useState([]);

    // Load batches on mount
    useEffect(() => {
        loadBatches();

        // Check for active enrichment queue
        const checkActiveQueue = async () => {
            try {
                const data = await apiFetch('/api/research/queue/active');
                if (data.active) {
                    setEnrichmentProgress(data);
                }
            } catch (err) {
                console.error('Fout bij checken actieve queue:', err);
            }
        };

        checkActiveQueue();
        const interval = setInterval(checkActiveQueue, 3000);
        return () => clearInterval(interval);
    }, []);

    const loadBatches = async () => {
        try {
            const data = await apiFetch('/api/import/batches');
            setBatches(data);
        } catch (err) {
            console.error('Failed to load batches:', err);
        }
    };

    const isExcelFile = (filename) => {
        return /\.(xlsx|xls|xlxs|xlsm)$/i.test(filename);
    };

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragging(false);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile && /\.(csv|xlsx|xls|xlxs|xlsm)$/i.test(droppedFile.name)) {
            setFile(droppedFile);
            setError(null);
            setPreview(null);
            setResult(null);
        } else {
            setError('Alleen CSV en Excel bestanden zijn toegestaan');
        }
    }, []);

    const handleFileSelect = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            setFile(selectedFile);
            setError(null);
            setPreview(null);
            setResult(null);
        }
    };

    const handlePreview = async () => {
        if (!file) return;

        setPreviewing(true);
        setError(null);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const endpoint = isExcelFile(file.name) ? '/api/import/excel/preview' : '/api/import/csv';
            const data = await apiPostFile(endpoint, formData);

            if (isExcelFile(file.name)) {
                setPreview(data);
                // Select all by default
                if (data.sampleGuests) {
                    setSelectedIndices(data.sampleGuests.map(g => g.index));
                }
            } else {
                // CSV directly imports, show result
                setResult(data);
                setFile(null);
                if (onUpdate) onUpdate();
                loadBatches();
            }
        } catch (err) {
            setError(err.message || 'Preview mislukt');
        } finally {
            setPreviewing(false);
        }
    };

    const handleImport = async () => {
        if (!file) return;

        setImporting(true);
        setError(null);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('autoEnrich', autoEnrich);

        // Add selected indices
        if (selectedIndices.length > 0) {
            selectedIndices.forEach(idx => formData.append('selectedIndices[]', idx));
        }

        try {
            const endpoint = isExcelFile(file.name) ? '/api/import/excel' : '/api/import/csv';
            const data = await apiPostFile(endpoint, formData);

            setResult(data);
            setFile(null);
            setPreview(null);
            if (onUpdate) onUpdate();
            loadBatches();

            if (autoEnrich && data.newGuestIds && data.newGuestIds.length > 0) {
                await startEnrichment(data.newGuestIds, data.batchId);
            }

            // Redirect to guests page after successful import
            setTimeout(() => {
                navigate('/guests');
            }, 500);
        } catch (err) {
            setError(err.message || 'Import mislukt');
        } finally {
            setImporting(false);
        }
    };

    const startEnrichment = async (guestIds, batchId) => {
        try {
            const data = await apiFetch('/api/research/queue/start', {
                method: 'POST',
                body: JSON.stringify({ guestIds, batchId })
            });

            // Start polling for progress
            pollEnrichmentProgress(data.queueId);
        } catch (err) {
            console.error('Failed to start enrichment:', err);
        }
    };

    const pollEnrichmentProgress = (queueId) => {
        setEnrichmentProgress({ status: 'running', completed: 0, total: 0, progress: 0 });

        const interval = setInterval(async () => {
            try {
                const data = await apiFetch(`/api/research/queue/${queueId}`);
                setEnrichmentProgress(data);

                if (data.status === 'completed') {
                    clearInterval(interval);
                    if (onUpdate) onUpdate();
                    // Keep showing completed for 3 seconds then hide
                    setTimeout(() => setEnrichmentProgress(null), 3000);
                }
            } catch (err) {
                clearInterval(interval);
            }
        }, 1000);
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

    const handleDeleteBatch = async (batchId) => {
        if (!confirm('Weet je zeker dat je deze batch wilt verwijderen? Alle gasten en reserveringen worden verwijderd.')) {
            return;
        }

        setDeletingBatch(batchId);
        try {
            await apiFetch(`/api/import/batches/${batchId}`, {
                method: 'DELETE'
            });
            loadBatches();
            if (onUpdate) onUpdate();
        } catch (err) {
            setError(err.message || 'Verwijderen mislukt');
        } finally {
            setDeletingBatch(null);
        }
    };

    const handleGuestAdded = () => {
        setShowAddForm(false);
        if (onUpdate) onUpdate();
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleDateString('nl-NL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleToggleSelection = (index) => {
        setSelectedIndices(prev =>
            prev.includes(index)
                ? prev.filter(i => i !== index)
                : [...prev, index]
        );
    };

    const handleToggleAll = () => {
        if (selectedIndices.length === preview.sampleGuests.length) {
            setSelectedIndices([]);
        } else {
            setSelectedIndices(preview.sampleGuests.map(g => g.index));
        }
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="font-heading text-3xl font-semibold">{t('Importeren')}</h2>
                    <p className="text-[var(--color-text-secondary)] mt-2">
                        {t('Upload een Excel of CSV bestand, of voeg handmatig gasten toe')}
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => setShowBatches(!showBatches)}
                        className="btn btn-secondary"
                    >
                        📋 {t('Import Geschiedenis')}
                    </button>
                    <button
                        onClick={() => setShowAddForm(true)}
                        className="btn btn-primary"
                    >
                        <span>+</span>
                        {t('Gast Toevoegen')}
                    </button>
                </div>
            </div>

            {/* Batch History */}
            {showBatches && (
                <div className="card">
                    <div className="p-4 border-b border-[var(--color-border)]">
                        <h3 className="font-semibold">{t('Import Geschiedenis')}</h3>
                    </div>
                    {batches.length === 0 ? (
                        <div className="p-8 text-center text-[var(--color-text-secondary)]">
                            {t('Nog geen imports')}
                        </div>
                    ) : (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>{t('Datum')}</th>
                                    <th>{t('Bestand')}</th>
                                    <th>{t('Totaal')}</th>
                                    <th>{t('Nieuw')}</th>
                                    <th>{t('Bijgewerkt')}</th>
                                    <th>{t('Acties')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {batches.map((batch) => (
                                    <tr key={batch.id}>
                                        <td className="text-sm">{formatDate(batch.importedAt)}</td>
                                        <td className="font-medium">{batch.filename || batch.id}</td>
                                        <td>{batch.totalRows || '-'}</td>
                                        <td>
                                            <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                                                {batch.newGuests || 0}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                                                {batch.updatedGuests || 0}
                                            </span>
                                        </td>
                                        <td>
                                            <button
                                                onClick={() => handleDeleteBatch(batch.id)}
                                                disabled={deletingBatch === batch.id}
                                                className="text-red-600 hover:text-red-800 text-sm"
                                            >
                                                {deletingBatch === batch.id ? 'Verwijderen...' : '🗑️ Verwijderen'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* Upload Zone */}
            <div
                className={`upload-zone ${dragging ? 'dragging' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input').click()}
            >
                <input
                    type="file"
                    id="file-input"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileSelect}
                    className="hidden"
                />

                {file ? (
                    <div className="space-y-2">
                        <div className="text-4xl">{isExcelFile(file.name) ? '📊' : '📄'}</div>
                        <p className="font-medium">{file.name}</p>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                            {(file.size / 1024).toFixed(1)} KB
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="text-4xl">📋</div>
                        <p className="font-medium">{t('Sleep een bestand hierheen')}</p>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                            {t('Excel of CSV - klik om te selecteren')}
                        </p>
                    </div>
                )}
            </div>

            {/* Error */}
            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                    {error}
                </div>
            )}

            {/* Preview/Import Button */}
            {file && !preview && (
                <div className="flex justify-center gap-4">
                    <button
                        onClick={handlePreview}
                        disabled={previewing}
                        className="btn btn-primary px-8"
                    >
                        {previewing ? 'Laden...' : isExcelFile(file.name) ? '👁️ Preview' : 'Importeren'}
                    </button>
                    <button
                        onClick={() => { setFile(null); setPreview(null); }}
                        className="btn btn-secondary"
                    >
                        {t('Annuleren')}
                    </button>
                </div>
            )}

            {/* Preview Results */}
            {preview && (
                <div className="card">
                    <div className="p-6 border-b border-[var(--color-border)] bg-blue-50">
                        <h3 className="font-heading text-xl font-semibold text-blue-800">
                            📊 Import Preview
                        </h3>
                        <p className="text-blue-700 mt-1">
                            {preview.filename} - {preview.sheetName}
                        </p>
                    </div>

                    <div className="p-6 grid grid-cols-4 gap-4">
                        <div className="text-center">
                            <div className="text-3xl font-bold">{preview.totalRows}</div>
                            <div className="text-sm text-[var(--color-text-secondary)]">Totaal</div>
                        </div>
                        <div className="text-center">
                            <div className="text-3xl font-bold text-green-600">{preview.newGuests}</div>
                            <div className="text-sm text-[var(--color-text-secondary)]">Nieuwe gasten</div>
                        </div>
                        <div className="text-center">
                            <div className="text-3xl font-bold text-blue-600">{preview.existingGuests}</div>
                            <div className="text-sm text-[var(--color-text-secondary)]">Bestaande gasten</div>
                        </div>
                        <div className="text-center">
                            <div className="text-3xl font-bold text-orange-600">{preview.skipped}</div>
                            <div className="text-sm text-[var(--color-text-secondary)]">Overgeslagen</div>
                        </div>
                    </div>

                    {preview.warnings && preview.warnings.length > 0 && (
                        <div className="px-6 pb-4">
                            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                                <strong>Waarschuwingen:</strong>
                                <ul className="mt-1 list-disc list-inside">
                                    {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </div>
                        </div>
                    )}

                    {preview.sampleGuests && preview.sampleGuests.length > 0 && (
                        <div className="px-6 pb-4">
                            <h4 className="font-semibold mb-2">Selecteer gasten om te importeren:</h4>
                            <div className="max-h-96 overflow-y-auto border rounded-lg">
                                <table className="table text-sm">
                                    <thead className="sticky top-0 bg-white shadow-sm">
                                        <tr>
                                            <th className="w-10">
                                                <input
                                                    type="checkbox"
                                                    checked={preview.sampleGuests.length > 0 && selectedIndices.length === preview.sampleGuests.length}
                                                    onChange={handleToggleAll}
                                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                />
                                            </th>
                                            <th>Naam</th>
                                            <th>Email</th>
                                            <th>Land</th>
                                            <th>Kamer</th>
                                            <th>Bedrag</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {preview.sampleGuests.map((guest, i) => (
                                            <tr
                                                key={i}
                                                className={`hover:bg-gray-50 cursor-pointer ${!selectedIndices.includes(guest.index) ? 'opacity-60' : ''}`}
                                                onClick={() => handleToggleSelection(guest.index)}
                                            >
                                                <td onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIndices.includes(guest.index)}
                                                        onChange={() => handleToggleSelection(guest.index)}
                                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                </td>
                                                <td className="font-medium">{guest.fullName}</td>
                                                <td className="text-xs text-gray-500">{guest.email || '-'}</td>
                                                <td>{guest.country || '-'}</td>
                                                <td>{guest.roomCategory || '-'}</td>
                                                <td>{guest.totalAmount ? `€${guest.totalAmount.toFixed(2)}` : '-'}</td>
                                                <td>
                                                    {guest.isNew ? (
                                                        <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">Nieuw</span>
                                                    ) : (
                                                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">Update</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="mt-2 text-xs text-gray-500 italic">
                                {selectedIndices.length} van de {preview.sampleGuests.length} gasten geselecteerd voor import.
                            </div>
                        </div>
                    )}

                    <div className="p-4 border-t border-[var(--color-border)] flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={autoEnrich}
                                onChange={(e) => setAutoEnrich(e.target.checked)}
                                className="w-4 h-4"
                            />
                            <span className="text-sm">🔍 Automatisch onderzoek starten voor nieuwe gasten</span>
                        </label>

                        <div className="flex gap-3">
                            <button
                                onClick={() => { setPreview(null); setFile(null); }}
                                className="btn btn-secondary"
                            >
                                Annuleren
                            </button>
                            <button
                                onClick={handleImport}
                                disabled={importing || selectedIndices.length === 0}
                                className="btn btn-primary px-8"
                            >
                                {importing ? 'Importeren...' : `✓ ${selectedIndices.length} Gasten Importeren`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Format Help */}
            {result && (
                <div className="card">
                    <div className="p-6 border-b border-[var(--color-border)] bg-green-50">
                        <h3 className="font-heading text-xl font-semibold text-green-800">
                            ✓ Import Succesvol
                        </h3>
                        <p className="text-green-700 mt-1">
                            {result.newGuests || result.imported || 0} nieuwe gasten, {result.updatedGuests || 0} bijgewerkt
                            {result.errors > 0 && ` (${result.errors} fouten)`}
                        </p>
                    </div>

                    {result.guests && result.guests.length > 0 && (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Naam</th>
                                    <th>Email</th>
                                    <th>Land</th>
                                    <th>Check-in</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.guests.slice(0, 20).map((guest, index) => (
                                    <tr key={index}>
                                        <td className="font-medium">{guest.full_name}</td>
                                        <td className="text-[var(--color-text-secondary)]">
                                            {guest.email || '-'}
                                        </td>
                                        <td className="text-[var(--color-text-secondary)]">
                                            {guest.country || '-'}
                                        </td>
                                        <td className="text-[var(--color-text-secondary)]">
                                            {guest.check_in || '-'}
                                        </td>
                                        <td>
                                            {guest.is_new ? (
                                                <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                                                    Nieuw
                                                </span>
                                            ) : (
                                                <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                                                    Bijgewerkt
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    <div className="p-4 border-t border-[var(--color-border)] flex justify-between items-center">
                        <span className="text-sm text-[var(--color-text-secondary)]">
                            Batch ID: {result.batchId}
                        </span>
                        <button
                            onClick={() => setResult(null)}
                            className="btn btn-secondary"
                        >
                            Nieuwe Import
                        </button>
                    </div>
                </div>
            )}

            {/* Format Help */}
            <div className="card p-6">
                <h4 className="font-semibold mb-4">{t('Ondersteunde Formaten')}</h4>
                <div className="grid grid-cols-2 gap-6">
                    <div>
                        <h5 className="font-medium text-sm mb-2">📊 {t('Excel (Mews Export)')}</h5>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                            {t('Reserveringsrapporten worden automatisch herkend.')}
                        </p>
                    </div>
                    <div>
                        <h5 className="font-medium text-sm mb-2">📄 CSV</h5>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                            {t('Kolommen: guest_name, email, phone, country, company')}
                        </p>
                    </div>
                </div>
            </div>

            {/* Add Guest Modal */}
            {showAddForm && (
                <AddGuestForm
                    onClose={() => setShowAddForm(false)}
                    onSuccess={handleGuestAdded}
                />
            )}
        </div>
    );
}

export default Import;
