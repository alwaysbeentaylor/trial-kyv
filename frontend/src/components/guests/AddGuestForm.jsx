import { useState } from 'react';
import { apiFetch } from '../../utils/api';
import CountryAutocomplete from '../common/CountryAutocomplete';
import { useLanguage } from '../../contexts/LanguageContext';

function AddGuestForm({ onClose, onSuccess }) {
    const { t } = useLanguage();
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
            setError(t('Naam is verplicht'));
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const data = await apiFetch('/api/guests', {
                method: 'POST',
                body: JSON.stringify(formData)
            });

            // onSuccess already calls setShowAddForm(false) via handleGuestUpdated
            if (onSuccess) onSuccess(data.id, startResearch);
        } catch (err) {
            setError(err.message || t('Opslaan mislukt'));
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
                        <h2 className="font-heading text-xl font-semibold">{t('Nieuwe Gast Toevoegen')}</h2>
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
                                {t('Naam')} <span className="text-[var(--color-error)]">*</span>
                            </label>
                            <input
                                type="text"
                                value={formData.full_name}
                                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                className="input"
                                placeholder={t('Volledige naam')}
                                autoFocus
                            />
                        </div>

                        {/* Email & Phone */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium block mb-1">{t('E-mail')}</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="input"
                                    placeholder={t('email@voorbeeld.be')}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium block mb-1">{t('Telefoon')}</label>
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
                            <label className="text-sm font-medium block mb-1">{t('Land')}</label>
                            <CountryAutocomplete
                                value={formData.country}
                                onChange={(country) => setFormData({ ...formData, country })}
                                placeholder={t('Type om te zoeken...')}
                            />
                        </div>

                        {/* Company */}
                        <div>
                            <label className="text-sm font-medium block mb-1">{t('Bedrijf')}</label>
                            <input
                                type="text"
                                value={formData.company}
                                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                                className="input"
                                placeholder={t('Bedrijfsnaam')}
                            />
                        </div>

                        {/* Notes */}
                        <div>
                            <label className="text-sm font-medium block mb-1">{t('Notities')}</label>
                            <textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                className="input min-h-[80px]"
                                placeholder={t('Extra informatie...')}
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
                            {t('Annuleren')}
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="btn btn-primary"
                        >
                            {saving ? t('Opslaan...') : t('Gast Toevoegen')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default AddGuestForm;

