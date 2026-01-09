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

        // Build optimized queries (max 5) - LIKE GOOGLE DOES
        const queries = [];

        // Query 1: EXACT NAME SEARCH (most important - just like Google!)
        // This finds anyone with this exact name, regardless of platform
        queries.push(`"${full_name}"`);

        // Query 2: LinkedIn search (professional source)
        queries.push(`"${full_name}" site:linkedin.com`);

        // Query 3: Name + Country (helps narrow down for common names)
        if (country) {
            queries.push(`"${full_name}" ${country}`);
        }

        // Query 4: Name + Company if known
        if (company) {
            queries.push(`"${full_name}" "${company}"`);
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

    /**
     * SONAR - All-in-one search + analysis
     * Searches the web AND analyzes results in a single API call
     * Replaces: Search + Celebrity Detection + AI Matching + VIP Analysis
     * 
     * @param {Object} guest - Guest object with full_name, country, company, email
     * @returns {Promise<Object>} Complete analysis including VIP score, job, company, etc.
     */
    async analyzeWithSonar(guest) {
        if (!this.apiKey) {
            console.warn('⚠️ Perplexity API key not configured');
            return null;
        }

        const startTime = Date.now();
        const { full_name, country, company, email } = guest;

        console.log(`🔮 Sonar: Analyzing ${full_name}...`);

        const prompt = `You are a professional hospitality assistant helping a luxury hotel prepare for a guest's arrival.

GUEST NAME: ${full_name}
COUNTRY: ${country || 'Unknown'}
${company ? `COMPANY: ${company}` : ''}

Search for PUBLICLY AVAILABLE professional information about this person. We want to provide personalized service.

IMPORTANT RULES:
- ONLY return information if you find the EXACT person with this FULL NAME
- If you cannot find this specific person, return null values
- Do NOT guess or match partial names
- Focus on PUBLIC professional profiles (LinkedIn, company websites, news articles)

Find:
1. Current job title and company
2. LinkedIn profile URL (if available)
3. Any public recognition or achievements
4. Professional social media (if public figure)

Return ONLY this JSON (no explanation):
{
  "found": true or false,
  "isCelebrity": boolean,
  "celebrityCategory": "entertainment|sports|business|politics|media|none",
  "knownFor": "what they're known for or null",
  "jobTitle": "current role or null",
  "company": "current company or null", 
  "linkedinUrl": "full LinkedIn URL or null",
  "instagramHandle": "username without @ or null",
  "twitterHandle": "username without @ or null",
  "location": "city/region",
  "vipScore": 1-10,
  "vipReason": "brief explanation",
  "notableInfo": "relevant info for hotel staff",
  "confidenceScore": 0.0-1.0,
  "sources": ["url1", "url2"]
}`;

        try {
            const response = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'sonar',  // Use sonar for cost efficiency, sonar-pro for better quality
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,  // Low temperature for consistent structured output
                    max_tokens: 1000
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Sonar API error ${response.status}: ${errorText}`);
                return null;
            }

            const data = await response.json();
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);

            // Extract the content from the response
            const content = data.choices?.[0]?.message?.content;
            if (!content) {
                console.error('❌ Sonar returned empty content');
                return null;
            }

            // Parse JSON from response (handle markdown code blocks)
            let analysis;
            try {
                // Remove markdown code blocks if present
                let jsonStr = content;
                if (jsonStr.includes('```json')) {
                    jsonStr = jsonStr.split('```json')[1].split('```')[0];
                } else if (jsonStr.includes('```')) {
                    jsonStr = jsonStr.split('```')[1].split('```')[0];
                }
                analysis = JSON.parse(jsonStr.trim());
            } catch (parseError) {
                console.error('❌ Failed to parse Sonar JSON:', parseError.message);
                console.log('Raw content:', content.substring(0, 500));
                return null;
            }

            console.log(`✅ Sonar analysis complete in ${duration}s - VIP Score: ${analysis.vipScore || 'N/A'}`);

            // If person not found, return null to trigger fallback
            if (analysis.found === false || (!analysis.jobTitle && !analysis.company && !analysis.linkedinUrl)) {
                console.log('⚠️ Sonar: Person not found with exact name match');
                return null;
            }

            // Return normalized result
            return {
                // Celebrity info
                isCelebrity: analysis.isCelebrity || false,
                celebrityCategory: analysis.celebrityCategory || 'none',
                knownFor: analysis.knownFor || null,

                // Professional info
                jobTitle: analysis.jobTitle || null,
                company: analysis.company || null,
                linkedinUrl: analysis.linkedinUrl || null,
                location: analysis.location || null,

                // Social media
                instagramHandle: analysis.instagramHandle || null,
                instagramUrl: analysis.instagramHandle ? `https://instagram.com/${analysis.instagramHandle}` : null,
                twitterHandle: analysis.twitterHandle || null,
                twitterUrl: analysis.twitterHandle ? `https://x.com/${analysis.twitterHandle}` : null,

                // VIP analysis
                vipScore: analysis.vipScore || 5,
                vipReason: analysis.vipReason || null,
                notableInfo: analysis.notableInfo || null,

                // Meta
                confidenceScore: analysis.confidenceScore || 0.5,
                sources: analysis.sources || [],
                duration: parseFloat(duration),
                model: 'sonar'
            };
        } catch (error) {
            console.error('❌ Sonar analysis error:', error.message);
            return null;
        }
    }
}

module.exports = new PerplexitySearchService();
