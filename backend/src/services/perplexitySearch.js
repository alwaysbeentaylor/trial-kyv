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
     * @param {Object} options - Options including language preference
     * @returns {Promise<Object>} Complete analysis including VIP score, job, company, etc.
     */
    async analyzeWithSonar(guest, options = {}) {
        if (!this.apiKey) {
            console.warn('⚠️ Perplexity API key not configured');
            return null;
        }

        const startTime = Date.now();
        const { full_name, country, company, email } = guest;
        const language = options.language || 'nl';

        // Determine output language instructions
        const langInstructions = language === 'en'
            ? 'IMPORTANT: Write ALL text fields in ENGLISH. This includes jobTitle, company, knownFor, vipReason, notableInfo, companyDescription, etc.'
            : 'IMPORTANT: Write ALL text fields in DUTCH (Nederlands). This includes jobTitle, company, knownFor, vipReason, notableInfo, companyDescription, etc.';

        console.log(`🔮 Sonar: Analyzing ${full_name} (output: ${language})...`);

        // Extract email domain for company research (if valid)
        let emailDomain = null;
        let companyFromEmail = null;
        const ignoredDomains = [
            'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com',
            'booking.com', 'expedia.com', 'hotels.com', 'airbnb.com', 'agoda.com',
            'transavia.com', 'klm.com', 'ryanair.com', 'easyjet.com', 'lufthansa.com',
            'tripadvisor.com', 'kayak.com', 'trivago.com'
        ];

        if (email && email.includes('@')) {
            const domain = email.split('@')[1]?.toLowerCase();
            if (domain && !ignoredDomains.some(d => domain.includes(d.replace('.com', '')))) {
                emailDomain = domain;
                // Convert domain to company name guess (e.g., knowyourvip.com -> Know Your VIP)
                companyFromEmail = domain.split('.')[0]
                    .replace(/-/g, ' ')
                    .replace(/([a-z])([A-Z])/g, '$1 $2')
                    .split(' ')
                    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ');
            }
        }

        const emailContext = emailDomain
            ? `\nEMAIL DOMAIN: ${emailDomain} (Company might be: ${companyFromEmail})\nIMPORTANT: Research this company/website and determine what they do.`
            : '';

        const locationContext = country ? `\n\n⚠️ CRITICAL LOCATION FILTER:\n- The guest is from: ${country}\n- ONLY return results for people connected to ${country} (live there, work there, or are from there)\n- If you find someone with the same name but in a DIFFERENT country (e.g., USA, UK, Australia), set "found": false\n- Do NOT confuse people with similar names from other countries` : '';

        const prompt = `Act as a professional concierge analyst for a luxury hotel. Write in a WARM, CONVERSATIONAL style.

${langInstructions}

GUEST: ${full_name}
LOCATION: ${country || 'Unknown'}${emailContext}${locationContext}

CRITICAL RULES:
1. LOCATION MATCH IS MANDATORY - if the person you find is not from/in ${country || 'the specified location'}, return "found": false
2. Write like you're briefing a hotel manager, NOT like an academic paper
3. NO citation numbers like [1], [2], [3] - NEVER use these
4. NO source references in the text
5. Write in flowing, natural sentences
6. Keep it brief but informative (2-3 sentences max per field)
7. Use simple, clear language
8. ${language === 'en' ? 'Write ALL content in ENGLISH' : 'Write ALL content in DUTCH (Nederlands)'}

${emailDomain ? `COMPANY RESEARCH REQUIRED:
- Look up the website ${emailDomain} and determine what type of business it is
- Assess if ${full_name} is likely the owner or an employee based on the email prefix and company size
- If email starts with info@, contact@, or the person's name, they're more likely to be a decision-maker/owner` : ''}

Return ONLY this JSON:
{
  "found": true or false,
  "locationMatch": true or false,
  "foundLocation": "Where this person is actually from/based",
  "isCelebrity": boolean,
  "celebrityCategory": "entertainment|sports|business|politics|media|none",
  "knownFor": "${language === 'en' ? 'One clear sentence about what they are known for' : 'Eén duidelijke zin over waarvoor ze bekend staan'}",
  "jobTitle": "${language === 'en' ? 'Their current professional title' : 'Hun huidige professionele titel'}",
  "company": "${language === 'en' ? 'Their current organization or Independent if freelance' : 'Hun huidige organisatie of Zelfstandig als freelance'}",
  "companyType": "${language === 'en' ? 'What type of business (SaaS startup, Luxury hotel, etc.)' : 'Type bedrijf (SaaS startup, Luxe hotel, etc.)'}",
  "companyDescription": "${language === 'en' ? 'One sentence about what the company does' : 'Eén zin over wat het bedrijf doet'}",
  "ownershipLikelihood": "high|medium|low|unknown",
  "linkedinUrl": "LinkedIn URL if found",
  "instagramHandle": "handle without @",
  "twitterHandle": "handle without @",
  "location": "city/region",
  "vipScore": 1-10,
  "vipReason": "${language === 'en' ? 'One sentence explaining why this score' : 'Eén zin die deze score verklaart'}",
  "notableInfo": "${language === 'en' ? '2-3 sentences of key info a hotel should know. Write naturally, no citations.' : '2-3 zinnen met belangrijke info die een hotel moet weten. Schrijf natuurlijk, geen citaties.'}",
  "confidenceScore": 0.0-1.0,
  "sources": ["url1", "url2"]
}`;
        try {
            const response = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey} `,
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
                console.error(`❌ Sonar API error ${response.status}: ${errorText} `);
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
                // Detect AI refusals (privacy/guards)
                if (content.toLowerCase().includes('cannot fulfill') ||
                    content.toLowerCase().includes('privacy') ||
                    content.toLowerCase().includes('i am unable')) {
                    console.error('⚠️ Sonar refused request due to privacy/guards.');
                    return null;
                }

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

            console.log(`✅ Sonar analysis complete in ${duration}s - VIP Score: ${analysis.vipScore || 'N/A'} - Location Match: ${analysis.locationMatch}`);

            // If person not found OR location doesn't match, return null to trigger fallback
            if (analysis.found === false || (!analysis.jobTitle && !analysis.company && !analysis.linkedinUrl)) {
                console.log('⚠️ Sonar: Person not found with exact name match');
                return null;
            }

            // Check location match - if we found someone in wrong country, reject
            if (analysis.locationMatch === false && analysis.foundLocation) {
                console.log(`⚠️ Sonar: Found person but WRONG LOCATION - Expected: ${country}, Found: ${analysis.foundLocation}`);
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

                // Company research (from email domain)
                companyType: analysis.companyType || null,
                companyDescription: analysis.companyDescription || null,
                ownershipLikelihood: analysis.ownershipLikelihood || 'unknown',

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
