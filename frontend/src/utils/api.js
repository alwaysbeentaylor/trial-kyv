// Use VITE_API_URL if set, otherwise use relative URLs (which will be proxied by Vercel)
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const apiFetch = async (endpoint, options = {}) => {
    // If endpoint already starts with http, use it directly
    // Otherwise, prepend API_BASE_URL if set, or use relative URL
    const url = endpoint.startsWith('http')
        ? endpoint
        : API_BASE_URL
            ? `${API_BASE_URL}${endpoint}`
            : endpoint;

    console.log('API Call:', url, options.method || 'GET'); // Debug log

    // Get current app language for AI responses
    const currentLanguage = window.__appLanguage || localStorage.getItem('language') || 'nl';

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Accept-Language': currentLanguage,
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('API Error:', response.status, errorData); // Debug log
        throw new Error(errorData.error || `API error: ${response.status}`);
    }

    return response.json();
};

export const apiPostFile = async (endpoint, formData) => {
    const url = endpoint.startsWith('http')
        ? endpoint
        : API_BASE_URL
            ? `${API_BASE_URL}${endpoint}`
            : endpoint;

    console.log('API File Upload:', url); // Debug log

    const response = await fetch(url, {
        method: 'POST',
        body: formData,
        // Do NOT set Content-Type header for FormData, browser does it automatically with boundary
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('API Error:', response.status, errorData); // Debug log
        throw new Error(errorData.error || `API error: ${response.status}`);
    }

    return response.json();
};
