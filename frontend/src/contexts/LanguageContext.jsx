import { createContext, useContext, useState, useEffect } from 'react';
import translations from '../utils/translations';

const LanguageContext = createContext();

// Detect browser language
const detectBrowserLanguage = () => {
    const browserLang = navigator.language || navigator.userLanguage || 'nl';
    // Check if it starts with 'nl' for Dutch, otherwise default to English
    if (browserLang.toLowerCase().startsWith('nl')) return 'nl';
    if (browserLang.toLowerCase().startsWith('en')) return 'en';
    // For other languages, check if they're likely Dutch speakers (BE, etc.)
    if (browserLang.toLowerCase().includes('be')) return 'nl';
    return 'en'; // Default to English for international users
};

// Get saved language or detect from browser
const getInitialLanguage = () => {
    const saved = localStorage.getItem('language');
    if (saved && (saved === 'nl' || saved === 'en')) {
        return saved;
    }
    return detectBrowserLanguage();
};

export function LanguageProvider({ children }) {
    const [language, setLanguageState] = useState(getInitialLanguage);

    // Save to localStorage when language changes
    const setLanguage = (lang) => {
        setLanguageState(lang);
        localStorage.setItem('language', lang);
    };

    // Translation function
    const t = (text) => {
        if (!text) return text;

        const langTranslations = translations[language];
        if (langTranslations && langTranslations[text]) {
            return langTranslations[text];
        }

        // Fallback: return original text
        return text;
    };

    // Expose language for API calls (to generate research in correct language)
    useEffect(() => {
        // Make language available globally for API calls
        window.__appLanguage = language;
    }, [language]);

    return (
        <LanguageContext.Provider value={{ language, setLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
}

export default LanguageContext;
