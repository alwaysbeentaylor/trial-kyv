import { useState } from 'react';
import { apiFetch } from '../../utils/api';
import CountryAutocomplete from '../common/CountryAutocomplete';

function AddGuestForm({ onClose, onSuccess }) {
    const [formData, setFormData] = useState({
        full_name: '',
        email: '',
        phone: '',
        country: '',
        company: '',
        notes: ''
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    // Research always starts automatically - no checkbox needed
    const startResearch = true;

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.full_name.trim()) {
            setError('Naam is verplicht');
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const data = await apiFetch('/api/guests', {
                method: 'POST',
                body: JSON.stringify(formData)
            });

            // Start research in background (don't wait for completion)
            // This allows the form to close immediately and show "Bezig..." in the table
            if (startResearch && data.id) {
                apiFetch(`/api/research/${data.id}`, {
                    method: 'POST'
                }).catch(err => console.error('Auto-research failed:', err));
            }

            // onSuccess already calls setShowAddForm(false) via handleGuestUpdated
            if (onSuccess) onSuccess(data.id, startResearch);
        } catch (err) {
            setError(err.message || 'Opslaan mislukt');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal max-w-lg" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="p-6 border-b border-[var(--color-border)]">
                    <div className="flex items-center justify-between">
                        <h2 className="font-heading text-xl font-semibold">Nieuwe Gast Toevoegen</h2>
                        <button
                            onClick={onClose}
                            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-2xl"
                        >
                            ×
                        </button>
                    </div>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit}>
                    <div className="p-6 space-y-4">
                        {/* Name (required) */}
                        <div>
                            <label className="text-sm font-medium block mb-1">
                                Naam <span className="text-[var(--color-error)]">*</span>
                            </label>
                            <input
                                type="text"
                                value={formData.full_name}
                                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                className="input"
                                placeholder="Volledige naam"
                                autoFocus
                            />
                        </div>

                        {/* Email & Phone */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium block mb-1">E-mail</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="input"
                                    placeholder="email@voorbeeld.be"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium block mb-1">Telefoon</label>
                                <input
                                    type="tel"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    className="input"
                                    placeholder="+32 ..."
                                />
                            </div>
                        </div>

                        {/* Country with Autocomplete */}
                        <div>
                            <label className="text-sm font-medium block mb-1">Land</label>
                            <CountryAutocomplete
                                value={formData.country}
                                onChange={(country) => setFormData({ ...formData, country })}
                                placeholder="Type om te zoeken..."
                            />
                        </div>

                        {/* Company */}
                        <div>
                            <label className="text-sm font-medium block mb-1">Bedrijf</label>
                            <input
                                type="text"
                                value={formData.company}
                                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                                className="input"
                                placeholder="Bedrijfsnaam"
                            />
                        </div>

                        {/* Notes */}
                        <div>
                            <label className="text-sm font-medium block mb-1">Notities</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                className="input min-h-[80px]"
                                placeholder="Extra informatie..."
                            />
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                                {error}
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="p-6 border-t border-[var(--color-border)] flex justify-end gap-3 bg-[var(--color-bg-secondary)]">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn btn-secondary"
                        >
                            Annuleren
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="btn btn-primary"
                        >
                            {saving ? 'Opslaan...' : 'Gast Toevoegen'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default AddGuestForm;

