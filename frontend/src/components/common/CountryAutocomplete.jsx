import { useState, useRef, useEffect } from 'react';
import { COUNTRIES, searchCountries, getCountryName } from '../../utils/countries';
import { useLanguage } from '../../contexts/LanguageContext';

/**
 * Country autocomplete input component
 * Searches both Dutch and English country names
 */
function CountryAutocomplete({ value, onChange, placeholder = 'Type land...', className = '' }) {
    const { language } = useLanguage();
    const [inputValue, setInputValue] = useState(value || '');
    const [isOpen, setIsOpen] = useState(false);
    const [filteredCountries, setFilteredCountries] = useState([]);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    // Sync input value with external value
    useEffect(() => {
        setInputValue(value || '');
    }, [value]);

    // Filter countries as user types
    useEffect(() => {
        if (inputValue.trim()) {
            const results = searchCountries(inputValue, language);
            setFilteredCountries(results);
            setHighlightedIndex(0);
        } else {
            // Show top countries when empty
            setFilteredCountries(COUNTRIES.slice(0, 10));
        }
    }, [inputValue, language]);

    const handleInputChange = (e) => {
        const val = e.target.value;
        setInputValue(val);
        setIsOpen(true);
    };

    const handleSelect = (country) => {
        const name = getCountryName(country, language);
        setInputValue(name);
        onChange(name);
        setIsOpen(false);
    };

    const handleKeyDown = (e) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                setIsOpen(true);
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightedIndex(prev =>
                    prev < filteredCountries.length - 1 ? prev + 1 : prev
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0);
                break;
            case 'Enter':
                e.preventDefault();
                if (filteredCountries[highlightedIndex]) {
                    handleSelect(filteredCountries[highlightedIndex]);
                }
                break;
            case 'Escape':
                setIsOpen(false);
                break;
            case 'Tab':
                setIsOpen(false);
                break;
            default:
                break;
        }
    };

    const handleBlur = (e) => {
        // Delay to allow click on dropdown item
        setTimeout(() => {
            setIsOpen(false);
        }, 200);
    };

    // Scroll highlighted item into view
    useEffect(() => {
        if (listRef.current && isOpen) {
            const highlighted = listRef.current.children[highlightedIndex];
            if (highlighted) {
                highlighted.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [highlightedIndex, isOpen]);

    return (
        <div className="relative">
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onFocus={() => setIsOpen(true)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className={`input ${className}`}
                autoComplete="off"
            />

            {isOpen && filteredCountries.length > 0 && (
                <ul
                    ref={listRef}
                    className="absolute z-50 w-full mt-1 max-h-60 overflow-auto 
                               bg-[var(--color-bg-secondary)] border border-[var(--color-border)] 
                               rounded-lg shadow-lg"
                    style={{ top: '100%' }}
                >
                    {filteredCountries.map((country, index) => (
                        <li
                            key={country.code + country.nl}
                            onClick={() => handleSelect(country)}
                            className={`px-4 py-2 cursor-pointer flex items-center gap-2
                                       hover:bg-[var(--color-bg-tertiary)]
                                       ${index === highlightedIndex ? 'bg-[var(--color-bg-tertiary)]' : ''}`}
                        >
                            <span className="text-lg">{getFlagEmoji(country.code)}</span>
                            <span>{getCountryName(country, language)}</span>
                            {language === 'nl' && country.en !== country.nl && (
                                <span className="text-sm text-[var(--color-text-secondary)] ml-auto">
                                    {country.en}
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// Convert country code to flag emoji
function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '🌍';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt());
    return String.fromCodePoint(...codePoints);
}

export default CountryAutocomplete;
