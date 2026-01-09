/**
 * Perplexity Search Service
 * Fast, reliable search API as replacement for SERP API
 * 
 * Benefits:
 * - 2-5 second response times (vs 30-60s with SERP)
 * - Multi-query support (5 queries at once)
 * - Domain filtering (linkedin.com, etc.)
 * - Country/language targeting
 * - No timeouts or Puppeteer needed
 */

class PerplexitySearchService {
    constructor() {
        this.apiKey = process.env.PERPLEXITY_API_KEY;
        this.baseUrl = 'https://api.perplexity.ai/search';
        this.initialized = false;
    }

    initialize() {
        if (this.initialized) return;

        if (!this.apiKey) {
            console.warn('⚠️ PERPLEXITY_API_KEY not set - Perplexity search disabled');
            return;
        }

        console.log('🔮 Perplexity Search Service initialized');
        this.initialized = true;
    }

    isAvailable() {
        return Boolean(this.apiKey);
    }

    /**
     * Search using Perplexity API
     * @param {string|string[]} query - Single query or array of queries (max 5)
     * @param {Object} options - Search options
     * @returns {Promise<Object>} Search results
     */
    async search(query, options = {}) {
        if (!this.apiKey) {
            console.warn('⚠️ Perplexity API key not configured');
            return null;
        }

        const {
            maxResults = 10,
            country = null,
            domainFilter = null,
            languageFilter = null,
            maxTokensPerPage = 1024
        } = options;

        const startTime = Date.now();
        const queries = Array.isArray(query) ? query : [query];

        console.log(`🔮 Perplexity: Searching ${queries.length} quer${queries.length > 1 ? 'ies' : 'y'}...`);

        try {
            const body = {
                query: queries.length === 1 ? queries[0] : queries,
                max_results: maxResults,
                max_tokens_per_page: maxTokensPerPage
            };

            if (country) body.country = country;
            if (domainFilter) body.search_domain_filter = domainFilter;
            if (languageFilter) body.search_language_filter = languageFilter;

            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Perplexity API error ${response.status}: ${errorText}`);
                return null;
            }

            const data = await response.json();
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);

            // Normalize results
            const results = this.normalizeResults(data.results, queries.length > 1);

            console.log(`✅ Perplexity: ${results.length} results in ${duration}s`);

            return {
                results,
                searchId: data.id,
                duration: parseFloat(duration)
            };
        } catch (error) {
            console.error('❌ Perplexity search error:', error.message);
            return null;
        }
    }

    /**
     * Normalize Perplexity results to match our expected format
     */
    normalizeResults(results, isMultiQuery = false) {
        if (!results) return [];

        // For multi-query, flatten all results
        const flatResults = isMultiQuery
            ? results.flat()
            : results;

        return flatResults.map(r => ({
            title: r.title || '',
            link: r.url || '',
            snippet: r.snippet || '',
            date: r.date || null,
            source: 'perplexity'
        }));
    }

    /**
     * Search for a person - optimized multi-query search
     * @param {Object} guest - Guest object with full_name, country, company
     * @returns {Promise<Object>} Combined search results
     */
    async searchPerson(guest) {
        if (!this.apiKey) return null;

        const { full_name, country, company } = guest;

        // Build optimized queries (max 5)
        const queries = [];

        // Query 1: LinkedIn search (most important)
        queries.push(`"${full_name}" site:linkedin.com`);

        // Query 2: General professional search
        if (company) {
            queries.push(`"${full_name}" "${company}"`);
        } else if (country) {
            queries.push(`"${full_name}" ${country} professional`);
        }

        // Query 3: Social media (if not too many queries)
        if (queries.length < 3) {
            queries.push(`"${full_name}" site:instagram.com OR site:twitter.com`);
        }

        console.log(`🔮 Perplexity: Searching for ${full_name} (${queries.length} queries)`);

        // Country code mapping
        const countryCodeMap = {
            'nederland': 'NL', 'netherlands': 'NL', 'nl': 'NL',
            'belgië': 'BE', 'belgium': 'BE', 'be': 'BE',
            'duitsland': 'DE', 'germany': 'DE', 'de': 'DE',
            'frankrijk': 'FR', 'france': 'FR', 'fr': 'FR',
            'verenigd koninkrijk': 'GB', 'united kingdom': 'GB', 'uk': 'GB', 'gb': 'GB'
        };

        const countryCode = country ? countryCodeMap[country.toLowerCase()] : null;

        const searchResult = await this.search(queries, {
            maxResults: 10,
            country: countryCode,
            maxTokensPerPage: 1024
        });

        if (!searchResult) return null;

        // Deduplicate by URL
        const seenUrls = new Set();
        const uniqueResults = searchResult.results.filter(r => {
            if (seenUrls.has(r.link)) return false;
            seenUrls.add(r.link);
            return true;
        });

        return {
            results: uniqueResults,
            searchId: searchResult.searchId,
            duration: searchResult.duration,
            queriesUsed: queries.length
        };
    }

    /**
     * Quick LinkedIn-only search
     */
    async searchLinkedIn(name, country = null) {
        const query = `"${name}" site:linkedin.com/in`;

        const countryCodeMap = {
            'nederland': 'NL', 'netherlands': 'NL',
            'belgië': 'BE', 'belgium': 'BE',
            'duitsland': 'DE', 'germany': 'DE'
        };

        return this.search(query, {
            maxResults: 10,
            country: country ? countryCodeMap[country.toLowerCase()] : null,
            domainFilter: ['linkedin.com']
        });
    }
}

module.exports = new PerplexitySearchService();
