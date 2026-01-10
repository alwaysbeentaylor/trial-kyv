import { useLanguage } from '../../contexts/LanguageContext';

function LanguageSwitcher() {
    const { language, setLanguage } = useLanguage();

    return (
        <div className="flex items-center gap-1 bg-gray-100 rounded-full p-1">
            <button
                onClick={() => setLanguage('nl')}
                className={`px-2 py-1 rounded-full text-xs font-medium transition-all ${language === 'nl'
                        ? 'bg-white shadow-sm text-gray-900'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                title="Nederlands"
            >
                🇳🇱 NL
            </button>
            <button
                onClick={() => setLanguage('en')}
                className={`px-2 py-1 rounded-full text-xs font-medium transition-all ${language === 'en'
                        ? 'bg-white shadow-sm text-gray-900'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                title="English"
            >
                🇬🇧 EN
            </button>
        </div>
    );
}

export default LanguageSwitcher;
