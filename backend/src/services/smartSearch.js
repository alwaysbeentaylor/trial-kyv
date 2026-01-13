const OpenAI = require('openai');
const companyScraper = require('./companyScraper');
const knowledgeGraph = require('./knowledgeGraph');
const googleSearch = require('./googleSearch');
const perplexitySearch = require('./perplexitySearch');
const queryGenerator = require('./queryGenerator');

/**
 * Email domains that should NOT be treated as companies/employers
 * Includes personal email providers and travel/booking platforms
 */
const IGNORED_EMAIL_DOMAINS = [
    // Personal email providers
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.nl', 'yahoo.fr', 'yahoo.de', 'yahoo.co.uk',
    'hotmail.com', 'hotmail.nl', 'hotmail.fr', 'hotmail.de', 'hotmail.co.uk',
    'outlook.com', 'live.com', 'live.nl', 'msn.com',
    'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aol.nl',
    'protonmail.com', 'proton.me', 'tutanota.com',
    'gmx.com', 'gmx.de', 'gmx.nl', 'mail.com', 'zoho.com',
    'yandex.com', 'yandex.ru', 'mail.ru', 'qq.com', '163.com',
    // Travel/Booking platforms (guests book through these, don't work there)
    'expedia.com', 'booking.com', 'hotels.com', 'agoda.com', 'trivago.com',
    'airbnb.com', 'vrbo.com', 'tripadvisor.com', 'kayak.com', 'priceline.com',
    'travelocity.com', 'orbitz.com', 'hotwire.com', 'lastminute.com',
    'momondo.com', 'skyscanner.com', 'cheaptickets.com',
    // Airlines & Transport (guests booked travel, don't work there)
    'transavia.com', 'klm.com', 'klm.nl', 'airfrance.com', 'airfrance.fr',
    'lufthansa.com', 'britishairways.com', 'easyjet.com', 'ryanair.com',
    'vueling.com', 'iberia.com', 'emirates.com', 'qatar.com', 'etihad.com',
    'united.com', 'delta.com', 'aa.com', 'americanairlines.com',
    'southwest.com', 'jetblue.com', 'spirit.com', 'frontier.com',
    'thalys.com', 'eurostar.com', 'ns.nl', 'sncf.com', 'bahn.de', 'tgv.com',
    'flixbus.com', 'blablacar.com', 'uber.com', 'lyft.com',
    // Generic/Test
    'example.com', 'test.com', 'email.com', 'temp-mail.org'
];

/**
 * Format large numbers to human-readable format (e.g. 18K, 1.2M)
 */
function formatNumber(num) {
    if (!num || isNaN(num)) return null;
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toString();
}

/**
 * Smart Search Service
 * for guest research
 * Focuses on LinkedIn as primary source via SerpAPI
 */

class SmartSearchService {
    constructor() {
        this.openai = null;
    }

    getOpenAI() {
        if (!this.openai && process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        }
        return this.openai;
    }

    /**
     * Helper to fetch with a timeout
     */
    async fetchWithTimeout(url, options = {}, timeout = 30000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(id);
            return response;
        } catch (error) {
            clearTimeout(id);
            throw error;
        }
    }

    /**
     * Parse LinkedIn search result title to extract job title and company
     * Example: "Maxim Van Trimpont - Front Office Manager bij La Réserve Resort | LinkedIn"
     * Returns: { jobTitle: "Front Office Manager", company: "La Réserve Resort" }
     */
    parseLinkedInTitle(title, guestName) {
        if (!title) return null;

        // Remove "| LinkedIn" suffix
        let cleanTitle = title.replace(/\s*\|\s*LinkedIn.*$/i, '').trim();

        // Try to split by " - " to separate name from role
        const parts = cleanTitle.split(' - ');
        if (parts.length < 2) return null;

        // The first part should contain the name, rest is job info
        const jobPart = parts.slice(1).join(' - ').trim();
        if (!jobPart) return null;

        // Try to split job part by "bij", "at", "@" to get company
        const companyMatch = jobPart.match(/^(.+?)\s+(?:bij|at|@)\s+(.+)$/i);
        if (companyMatch) {
            let potentialCompany = companyMatch[2].trim();

            // Filter out "LinkedIn" and common locations as company names
            if (potentialCompany.toLowerCase().includes('linkedin') ||
                potentialCompany.match(/(Region|Area|Belgium|Netherlands|France|United Kingdom|USA)/i)) {
                return {
                    jobTitle: jobPart, // Fallback to full string if company detection is dubious
                    company: null
                };
            }

            return {
                jobTitle: companyMatch[1].trim(),
                company: potentialCompany
            };
        }

        // If no company separator found, the whole thing is the job title
        return {
            jobTitle: jobPart,
            company: null
        };
    }

    /**
     * Extract company information from email domain
     * Determines if guest is owner or employee based on company size and role
     */
    async extractCompanyFromEmail(guest) {
        if (!guest.email) return null;

        // Extract domain from email
        const emailParts = guest.email.split('@');
        if (emailParts.length !== 2) return null;

        const domain = emailParts[1].toLowerCase();

        // Skip personal email providers and booking platforms
        if (IGNORED_EMAIL_DOMAINS.includes(domain)) {
            console.log(`📧 Skipping ignored email domain: ${domain}`);
            return null;
        }

        console.log(`📧 Analyzing business email domain: ${domain}`);

        try {
            // Step 1: Extract company name from domain as fallback
            const domainName = domain.split('.')[0];
            // Convert domain to readable company name (knowyourvip -> KnowYourVIP, mycompany -> MyCompany)
            const domainCompanyName = domainName
                .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space before capitals
                .replace(/[-_]/g, ' ') // Replace dashes/underscores with spaces
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join('');

            console.log(`   📌 Domain suggests company: ${domainCompanyName}`);

            // Step 2: Try Google search for more info (but don't fail if captcha)
            const websiteUrl = `https://${domain}`;
            let companyResults = [];

            try {
                console.log(`   🔍 Searching Google for company info: ${domain}`);
                companyResults = await googleSearch.search(`"${domain}" company`, 3) || [];
            } catch (searchError) {
                console.log(`   ⚠️ Google search failed (captcha?), using domain name as company`);
            }
            const derivedFromDomainOnly = companyResults.length === 0;

            // Step 3: Use AI to analyze (even without search results, we have domain info)
            const openai = this.getOpenAI();
            if (!openai) {
                // Fallback without AI - use domain name as company
                return {
                    domain,
                    websiteUrl,
                    companyName: domainCompanyName,
                    industry: 'Unknown',
                    companySize: 'Unknown'
                };
            }

            const prompt = `Analyze this company information to determine:
1. The official company name (convert domain to proper company name if no search results)
2. What industry/sector they operate in
3. Company size estimate (Micro/Klein/Middelgroot/Groot)
4. Whether "${guest.full_name}" is likely the OWNER/FOUNDER or an EMPLOYEE

GUEST INFO:
- Name: ${guest.full_name}
- Email: ${guest.email}
- Country: ${guest.country || 'Unknown'}

EMAIL DOMAIN: ${domain}
DOMAIN COMPANY NAME SUGGESTION: ${domainCompanyName}
WEBSITE URL: ${websiteUrl}

${companyResults.length > 0 ? `SEARCH RESULTS:
${companyResults.slice(0, 3).map(r => `- ${r.title}: ${r.snippet}`).join('\n')}` : 'NO SEARCH RESULTS AVAILABLE - Use domain name to derive company name (e.g., knowyourvip.com = KnowYourVIP)'}

RULES:
- If domain is like "knowyourvip.com", company name is likely "KnowYourVIP" or "Know Your VIP"
- Convert camelCase/lowercase domains to proper company names
- If no search results, derive company name from domain and mark industry as "Unknown"

Return JSON:
{
  "companyName": "Official or derived company name",
  "industry": "Industry/sector or Unknown",
  "companySize": "Unknown if no data",
  "isOwner": null,
  "ownerConfidence": 0,
  "ownerReason": "Cannot determine without more data",
  "description": "Brief company description or Unknown"
}`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a business analyst. Determine company details and ownership status from available data.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message.content);

            if (derivedFromDomainOnly) {
                result.isOwner = null;
                result.ownerConfidence = 0.1;
                result.ownerReason = 'Derived from email domain naming only';
                result.ownerLabel = 'Possible owner (uncertain, derived from domain naming only)';
                result.ownershipDetermination = 'domain_only';
            } else {
                result.ownerLabel = result.isOwner === true
                    ? (result.ownerConfidence >= 0.7 ? 'Likely owner' : 'Possible owner (needs confirmation)')
                    : (result.isOwner === false ? 'Likely employee' : 'Ownership unknown');
                result.ownershipDetermination = 'search_results';
            }

            console.log(`🏢 Email domain analysis: ${result.companyName} (${result.companySize}) - ${result.ownerLabel}`);

            return {
                domain,
                websiteUrl,
                ...result,
                source: 'email_domain'
            };
        } catch (error) {
            console.error('Email domain analysis error:', error.message);
            // Fallback: derive company name from domain
            const domainName = domain.split('.')[0];
            const fallbackName = domainName
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                .replace(/[-_]/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join('');
            console.log(`   📌 Using fallback company name: ${fallbackName}`);
            return {
                domain,
                websiteUrl: `https://${domain}`,
                companyName: fallbackName,
                industry: 'Unknown',
                companySize: 'Unknown',
                isOwner: null,
                ownerConfidence: 0.1,
                ownerReason: 'Derived from email domain naming only (fallback)',
                ownerLabel: 'Possible owner (uncertain, derived from domain naming only)',
                ownershipDetermination: 'domain_only'
            };
        }
    }

    /**
     * Verify if a location string matches the target country.
     * Robust check for city/country names in various languages.
     */
    verifyLocationMatch(location, targetCountry) {
        if (!location || !targetCountry) return true; // Can't verify, assume match

        const locLower = location.toLowerCase();
        const targetLower = targetCountry.toLowerCase().trim();

        // Get all terms for the target country (cities, variations)
        const countryMap = {
            'nederland': ['nederland', 'netherlands', 'nl', 'holland', 'amsterdam', 'rotterdam', 'utrecht', 'den haag', 'the hague', 'eindhoven', 'groningen'],
            'netherlands': ['nederland', 'netherlands', 'nl', 'holland', 'amsterdam', 'rotterdam', 'utrecht', 'den haag', 'the hague', 'eindhoven', 'groningen'],
            'belgië': ['belgië', 'belgium', 'be', 'brussel', 'brussels', 'antwerpen', 'antwerp', 'gent', 'ghent', 'brugge', 'bruges'],
            'belgium': ['belgië', 'belgium', 'be', 'brussel', 'brussels', 'antwerpen', 'antwerp', 'gent', 'ghent', 'brugge', 'bruges'],
            'duitsland': ['duitsland', 'germany', 'de', 'berlin', 'münchen', 'munich', 'hamburg', 'frankfurt', 'köln', 'cologne'],
            'germany': ['duitsland', 'germany', 'de', 'berlin', 'münchen', 'munich', 'hamburg', 'frankfurt', 'köln', 'cologne'],
            'frankrijk': ['frankrijk', 'france', 'fr', 'paris', 'lyon', 'marseille', 'toulouse', 'nice'],
            'france': ['frankrijk', 'france', 'fr', 'paris', 'lyon', 'marseille', 'toulouse', 'nice'],
            'verenigd koninkrijk': ['verenigd koninkrijk', 'united kingdom', 'uk', 'england', 'london', 'manchester', 'birmingham', 'glasgow', 'edinburgh'],
            'united kingdom': ['verenigd koninkrijk', 'united kingdom', 'uk', 'england', 'london', 'manchester', 'birmingham', 'glasgow', 'edinburgh'],
            'uk': ['verenigd koninkrijk', 'united kingdom', 'uk', 'england', 'london', 'manchester', 'birmingham', 'glasgow', 'edinburgh'],
            'spanje': ['spanje', 'spain', 'es', 'madrid', 'barcelona', 'valencia', 'sevilla', 'seville'],
            'spain': ['spanje', 'spain', 'es', 'madrid', 'barcelona', 'valencia', 'sevilla', 'seville'],
            'italië': ['italië', 'italy', 'it', 'rome', 'milaan', 'milan', 'napels', 'naples', 'venetië', 'venice'],
            'italy': ['italië', 'italy', 'it', 'rome', 'milaan', 'milan', 'napels', 'naples', 'venetië', 'venice'],
            'egypte': ['egypte', 'egypt', 'eg', 'cairo', 'alexandria', 'giza'],
            'egypt': ['egypte', 'egypt', 'eg', 'cairo', 'alexandria', 'giza'],
        };

        const terms = countryMap[targetLower] || [targetLower];
        const isMatch = terms.some(term => locLower.includes(term.toLowerCase()));

        // Check if location explicitly mentions a DIFFERENT country
        const allOtherTerms = Object.entries(countryMap)
            .filter(([country]) => !terms.includes(country)) // Exclude target country
            .flatMap(([, termList]) => termList);

        const mentionsOtherCountry = allOtherTerms.some(term => locLower.includes(term.toLowerCase()));

        // STRICT: If location mentions another country, it's NOT a match
        if (mentionsOtherCountry && !isMatch) {
            console.log(`❌ Location mismatch: "${location}" contains terms from a different country than "${targetCountry}"`);
            return false;
        }

        // If location matches target country terms, it's a match
        if (isMatch) {
            console.log(`✅ Location verified: "${location}" matches guest country: "${targetCountry}"`);
            return true;
        }

        // If location doesn't match AND doesn't mention another country, allow it (could be a city we don't know)
        // But if it mentions another known country, reject it
        if (mentionsOtherCountry) {
            console.log(`❌ Location mismatch: "${location}" is from a different country than "${targetCountry}"`);
            return false;
        }

        // Unknown location - can't verify, assume no issue
        return true;
    }

    /**
     * Use AI to select the best match from candidates
     */
    getCountrySearchTerms(country) {
        if (!country) return [];
        const countryLower = country.toLowerCase().trim();
        const terms = {
            'nederland': ['Nederland', 'Netherlands', 'NL'],
            'netherlands': ['Nederland', 'Netherlands', 'NL'],
            'belgië': ['België', 'Belgium', 'BE'],
            'belgium': ['België', 'Belgium', 'BE'],
            'duitsland': ['Duitsland', 'Germany', 'DE'],
            'germany': ['Duitsland', 'Germany', 'DE'],
            'frankrijk': ['Frankrijk', 'France', 'FR'],
            'france': ['Frankrijk', 'France', 'FR'],
            'verenigd koninkrijk': ['United Kingdom', 'UK', 'England'],
            'united kingdom': ['United Kingdom', 'UK', 'England'],
            'uk': ['United Kingdom', 'UK', 'England'],
            'spanje': ['Spanje', 'Spain', 'ES'],
            'spain': ['Spanje', 'Spain', 'ES'],
            'italië': ['Italië', 'Italy', 'IT'],
            'italy': ['Italië', 'Italy', 'IT'],
            'egypte': ['Egypt', 'EG', 'Cairo'],
            'egypt': ['Egypt', 'EG', 'Cairo'],
        };

        return terms[countryLower] || [country];
    }

    /**
     * Filter search results based on country match
     * Checks title, snippet, and URL for country indicators
     */
    filterResultsByCountry(results, targetCountry) {
        if (!targetCountry) return results; // No country specified, return all

        // Normalize country names (common variations)
        const countryMap = {
            'nederland': ['nederland', 'netherlands', 'nl', 'holland', 'amsterdam', 'rotterdam', 'utrecht', 'den haag', 'the hague', 'eindhoven', 'groningen'],
            'netherlands': ['nederland', 'netherlands', 'nl', 'holland', 'amsterdam', 'rotterdam', 'utrecht', 'den haag', 'the hague', 'eindhoven', 'groningen'],
            'belgië': ['belgië', 'belgium', 'be', 'brussel', 'brussels', 'antwerpen', 'antwerp', 'gent', 'ghent', 'brugge', 'bruges'],
            'belgium': ['belgië', 'belgium', 'be', 'brussel', 'brussels', 'antwerpen', 'antwerp', 'gent', 'ghent', 'brugge', 'bruges'],
            'duitsland': ['duitsland', 'germany', 'de', 'berlin', 'münchen', 'munich', 'hamburg', 'frankfurt', 'köln', 'cologne'],
            'germany': ['duitsland', 'germany', 'de', 'berlin', 'münchen', 'munich', 'hamburg', 'frankfurt', 'köln', 'cologne'],
            'frankrijk': ['frankrijk', 'france', 'fr', 'paris', 'lyon', 'marseille', 'toulouse', 'nice'],
            'france': ['frankrijk', 'france', 'fr', 'paris', 'lyon', 'marseille', 'toulouse', 'nice'],
            'verenigd koninkrijk': ['verenigd koninkrijk', 'united kingdom', 'uk', 'england', 'london', 'manchester', 'birmingham', 'glasgow', 'edinburgh'],
            'united kingdom': ['verenigd koninkrijk', 'united kingdom', 'uk', 'england', 'london', 'manchester', 'birmingham', 'glasgow', 'edinburgh'],
            'uk': ['verenigd koninkrijk', 'united kingdom', 'uk', 'england', 'london', 'manchester', 'birmingham', 'glasgow', 'edinburgh'],
            'verenigde staten': ['verenigde staten', 'united states', 'usa', 'u.s.', 'america', 'new york', 'los angeles', 'chicago', 'california', 'florida', 'texas'],
            'united states': ['verenigde staten', 'united states', 'usa', 'u.s.', 'america', 'new york', 'los angeles', 'chicago', 'california', 'florida', 'texas'],
            'usa': ['verenigde staten', 'united states', 'usa', 'u.s.', 'america', 'new york', 'los angeles', 'chicago', 'california', 'florida', 'texas'],
            'spanje': ['spanje', 'spain', 'es', 'madrid', 'barcelona', 'valencia', 'sevilla', 'seville'],
            'spain': ['spanje', 'spain', 'es', 'madrid', 'barcelona', 'valencia', 'sevilla', 'seville'],
            'italië': ['italië', 'italy', 'it', 'rome', 'milaan', 'milan', 'napels', 'naples', 'venetië', 'venice'],
            'italy': ['italië', 'italy', 'it', 'rome', 'milaan', 'milan', 'napels', 'naples', 'venetië', 'venice'],
            'egypte': ['egypte', 'egypt', 'eg', 'cairo', 'alexandria', 'giza'],
            'egypt': ['egypte', 'egypt', 'eg', 'cairo', 'alexandria', 'giza'],
            'verenigde arabische emiraten': ['vae', 'uae', 'emiraten', 'emirates', 'dubai', 'abu dhabi', 'sharjah'],
            'united arab emirates': ['vae', 'uae', 'emiraten', 'emirates', 'dubai', 'abu dhabi', 'sharjah'],
            'uae': ['vae', 'uae', 'emiraten', 'emirates', 'dubai', 'abu dhabi', 'sharjah'],
        };

        const normalizedTarget = targetCountry.toLowerCase().trim();

        // Find best match in country map
        let searchTerms = [normalizedTarget];
        for (const [key, terms] of Object.entries(countryMap)) {
            if (normalizedTarget.includes(key) || key.includes(normalizedTarget)) {
                searchTerms = terms;
                break;
            }
        }

        // Get all other countries' terms for conflict detection
        const allOtherTerms = Object.entries(countryMap)
            .filter(([key]) => !searchTerms.some(st => key.includes(st) || st.includes(key)))
            .flatMap(([, terms]) => terms);

        return results.filter(result => {
            const text = `${result.title || ''} ${result.snippet || ''} ${result.link || ''}`.toLowerCase();

            // Check if any country indicator is present
            const matchesTargetCountry = searchTerms.some(term => text.includes(term.toLowerCase()));

            // Check for conflicting countries
            const hasConflictingCountry = allOtherTerms.some(term => {
                // Strong indicators are cities and country codes that are unlikely to be false positives
                const strongIndicators = [
                    'cairo', 'amsterdam', 'london', 'paris', 'berlin', 'madrid', 'rome', 'brussels', 'antwerp', 'rotterdam',
                    'dubai', 'abu dhabi', 'new york', 'los angeles', 'california', 'chicago', 'houston',
                    'alexandria', 'giza', 'uae', 'vae', 'usa'
                ];

                return strongIndicators.includes(term.toLowerCase()) &&
                    text.includes(term.toLowerCase()) &&
                    !matchesTargetCountry;
            });

            // If we have a country match, include it
            if (matchesTargetCountry) return true;

            // If there's a conflicting country indicator, exclude it
            if (hasConflictingCountry) {
                console.log(`   🚫 Excluding result (wrong country): ${result.title?.substring(0, 50)}... (${result.link})`);
                return false;
            }

            // If no country info found, include it (might be generic/global)
            return true;
        });
    }

    async selectBestMatchWithAI(guest, searchResults, celebrityInfo = null) {
        const openai = this.getOpenAI();
        if (!openai) return null;

        try {
            const resultsInfo = searchResults.map((r, i) =>
                `Result ${i}:
                Title: ${r.title}
                URL: ${r.link}
                Snippet: ${r.snippet}`
            ).join('\n\n');

            const prompt = `I need you to identify the correct person from these search results.
GUEST:
Name: ${guest.full_name}
Company: ${guest.company || 'Unknown'}
Country: ${guest.country || 'Unknown'}

${celebrityInfo?.isCelebrity ? `SUSPECTED PUBLIC FIGURE: ${celebrityInfo.knownFor} (Confidence: ${celebrityInfo.confidence})` : ''}

SEARCH RESULTS:
${resultsInfo}

INSTRUCTIONS:
1. **PRIMARY GOAL**: Find the most likely identity for this guest.
2. **PRIORITY**: LinkedIn is the preferred professional source, BUT if the guest is a **Public Figure** (Presenter, Artist, Musician, etc.), their Wikipedia or verified social media may be more relevant than an outdated LinkedIn profile.
3. **IDENTIFY PUBLIC FIGURES**: 
   - Look for results like **Wikipedia**, **News Articles**, **IMDb**, or **Verified Social Media** handles.
   - If you see strong evidence that "Name" is a well-known person (e.g. a famous presenter/singer in the Netherlands), and one LinkedIn result shows a "Student" or "Unknown Person" with the same name, **REJECT the student** as a namesake mismatch.
   - If multiple "Name" people exist, prioritize the one that matches the guest's likely status (most guests in this system are high-profile).
4. **GOLDEN RULE**: Only select a LinkedIn profile if you are confident it is the RIGHT "Name". If there's a namesake student and a famous presenter, the famous person is the likely guest.
5. **LOCATION CHECK - CRITICAL**: The result MUST match the guest's country. 
   - If guest is in "Nederland" (Netherlands), DO NOT match results from other countries.
   - Check the snippet for location indicators.
6. **STUDENTS**: If the guest appears to be a Student (on LinkedIn), match it ONLY if there's no evidence of a more "famous" or "relevant" namesake.
7. **IMPOSTORS**: Be very careful with namesakes/homonyms.

7. **CRITICAL - INTELLIGENTLY ANALYZE THE SNIPPET**: You are an AI with world knowledge. Use it!

   READ the snippet carefully and UNDERSTAND what each piece means:

   Example snippet: "Software Engineer · Ervaring: Pronk Juweel · Opleiding: NOVI Hogeschool · Locatie: Amsterdam"

   YOUR ANALYSIS PROCESS:
   a) IDENTIFY job titles: "Software Engineer", "Full stack-ontwikkelaar" = current job
   b) IDENTIFY companies: "Ervaring:" means work experience, so "Pronk Juweel" is their EMPLOYER
   c) DISTINGUISH education from work: "Opleiding:" means education, so "NOVI Hogeschool" is a SCHOOL (NOT their employer!)
   d) EXTRACT location: "Amsterdam, Noord-Holland, Nederland" = city and country
   e) USE YOUR KNOWLEDGE: You know that:
      - "Hogeschool" = Dutch for "University/College" → it's education, NOT a company
      - "Ervaring:" / "Experience:" → points to their current/past employer
      - "Opleiding:" / "Education:" → points to where they studied
      - Job titles: Software Engineer, Developer, Manager, CEO, etc.

   COMMON PATTERNS:
   - "Name - Job Title" → extract Job Title
   - "Job · Ervaring: Company" → Job = job title, Company = employer
   - "Location · Job · Company" → separate location from professional info
   - "Job bij/at Company" → "bij" and "at" both mean working at that company

   DO NOT confuse schools with companies! If you see "Hogeschool", "University", "College", "School" → that's education, NOT employment.

Return JSON:
{
  "bestIndex": [integer index of the match, or null],
  "confidence": [0.0 to 1.0],
  "extractedJobTitle": "[The person's current job role/title. Examples: 'Software Engineer', 'Full stack-ontwikkelaar', 'CEO', 'Manager']",
  "extractedCompany": "[Their current EMPLOYER (look after 'Ervaring:', 'bij', 'at'). DO NOT put schools here! Only actual companies.]",
  "extractedLocation": "[City and country, e.g., 'Amsterdam, Nederland']",
  "extractedEducation": "[School/University if mentioned (look after 'Opleiding:', 'Education:'), e.g., 'NOVI Hogeschool']",
  "reason": "[Explain: Which result you chose, what job/company/location you found, and why you're confident this is the right person]"
}`;

            console.log(`🤖 AI matching guest against ${searchResults.length} results...`);
            searchResults.forEach((r, i) => {
                console.log(`  [${i}] ${r.title} - ${r.link}`);
            });
            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert researcher with deep knowledge of professional titles, companies, and educational institutions worldwide. You understand Dutch and English. You can distinguish between employers and schools. You prioritize LinkedIn profiles above all other sources. Use your knowledge to intelligently parse snippets and extract accurate professional information.'
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message.content);

            console.log('\n🔍 ========== DEBUG: AI RESPONSE ==========');
            console.log(JSON.stringify(result, null, 2));
            console.log('==========================================\n');

            if (result.bestIndex !== null && result.confidence >= 0.8 && !result.isHistorical) {
                const bestSource = searchResults[result.bestIndex];

                // Use AI-extracted information (AI is now better at parsing all formats)
                let finalJobTitle = result.extractedJobTitle || null;
                let finalCompany = result.extractedCompany || null;
                let finalLocation = result.extractedLocation || null;
                let finalEducation = result.extractedEducation || null;

                console.log('\n🔍 ========== DEBUG: EXTRACTED DATA ==========');
                console.log(`Job Title: "${finalJobTitle}"`);
                console.log(`Company: "${finalCompany}"`);
                console.log(`Location: "${finalLocation}"`);
                console.log(`Education: "${finalEducation}"`);
                console.log(`Guest Country: "${guest.country || 'Unknown'}"`);
                console.log('=============================================\n');

                // CRITICAL: Verify location matches guest's country
                if (guest.country && finalLocation) {
                    const locationMatches = this.verifyLocationMatch(finalLocation, guest.country);
                    if (!locationMatches) {
                        console.log(`❌ Location mismatch! Result location: "${finalLocation}" does not match guest country: "${guest.country}" - REJECTING match`);
                        return null;
                    }
                    console.log(`✅ Location verified: "${finalLocation}" matches guest country: "${guest.country}"`);
                }

                // CRITICAL: Verify the result contains the guest's name identity
                // This prevents matching "Sem" to "Marco" just because the last name is the same
                const guestNameParts = guest.full_name.toLowerCase().split(/\s+/).filter(p => p.length >= 2);
                const firstName = guestNameParts[0];
                const lastName = guestNameParts[guestNameParts.length - 1];
                const resultText = (bestSource.title + ' ' + bestSource.snippet).toLowerCase();

                // 1. Check last name (mandatory)
                if (lastName && !resultText.includes(lastName)) {
                    console.log(`❌ Name mismatch! Guest last name "${lastName}" not found in result - REJECTING match`);
                    return null;
                }

                // 2. Check first name (mandatory)
                // We only allow first name mismatch IF celebrityInfo explicitly says this is a known alias
                const isKnownAlias = celebrityInfo?.isCelebrity &&
                    (celebrityInfo.aliases?.some(a => a.toLowerCase().includes(firstName)) ||
                        celebrityInfo.primaryName?.toLowerCase().includes(firstName));

                if (firstName && !resultText.includes(firstName) && !isKnownAlias) {
                    console.log(`❌ Name mismatch! Guest first name "${firstName}" not found in result and not a documented alias - REJECTING match`);
                    return null;
                }

                console.log(`✨ Match found! ${bestSource.link} (Conf: ${result.confidence})`);

                // Log what the AI extracted
                if (finalJobTitle || finalCompany || finalEducation) {
                    console.log(`🤖 AI extracted: Job="${finalJobTitle}", Company="${finalCompany}", Location="${finalLocation}", Education="${finalEducation}"`);
                }

                // Fallback: try parseLinkedInTitle if AI didn't extract anything
                if (bestSource.link?.includes('linkedin.com/in/') && bestSource.title && (!finalJobTitle || !finalCompany)) {
                    const parsed = this.parseLinkedInTitle(bestSource.title, guest.full_name);
                    if (parsed) {
                        if (parsed.jobTitle && !finalJobTitle) finalJobTitle = parsed.jobTitle;
                        if (parsed.company && !finalCompany) finalCompany = parsed.company;
                        console.log(`💼 Fallback parsed from LinkedIn title: ${parsed.jobTitle} @ ${parsed.company}`);
                    }
                }

                return {
                    url: bestSource.link,
                    title: bestSource.title,
                    snippet: bestSource.snippet,
                    jobTitle: finalJobTitle,
                    company: finalCompany,
                    location: finalLocation,
                    education: finalEducation,
                    sourceType: 'google_fallback',
                    reason: result.reason,
                    confidence: result.confidence
                };
            }

            if (result.isHistorical) {
                console.log('🏛️ Discarding match because it refers to a historical figure.');
            }

            console.log('❌ No clear match found in Google fallback.');
            return null;
        } catch (error) {
            console.error('AI fallback selection error:', error);
            return null;
        }
    }



    /**
     * Search for Instagram profile using SerpAPI
     * Prioritizes verified/official accounts for celebrities
     * Returns comprehensive profile data including bio, location, etc.
     */
    async searchInstagram(guest) {
        try {
            // ============================================
            // STEP 1: Google Search (PRIMARY)
            // ============================================
            const primaryQueries = [
                `site:instagram.com "${guest.full_name}"`,
                `"${guest.full_name}" instagram profile`
            ];

            for (const query of primaryQueries) {
                const results = await googleSearch.search(query, 5);

                const instagramResults = results.filter(r =>
                    r.link?.includes('instagram.com/') &&
                    !r.link?.includes('/p/') &&
                    !r.link?.includes('/reel/')
                );

                for (const result of instagramResults) {
                    const handleMatch = result.link.match(/instagram\.com\/([^\/\?]+)/);
                    if (handleMatch && handleMatch[1] !== 'explore' && handleMatch[1] !== 'accounts') {
                        const handle = handleMatch[1];

                        // Verify with AI
                        const isMatch = await this.verifySocialProfile(guest, {
                            platform: 'Instagram',
                            handle: handle,
                            title: result.title,
                            snippet: result.snippet
                        });

                        if (isMatch) {
                            console.log(`📸 Instagram found: @${handle}`);
                            const profileData = await this.extractInstagramProfileData(handle, result, guest);
                            return profileData;
                        }
                    }
                }
            }

            // ============================================
            // STEP 2: FUZZY SEARCH - Try username without spaces
            // Many users have handles like "maximvantrimpont" not "Maxim Van Trimpont"
            // ============================================
            const nameNoSpaces = guest.full_name.toLowerCase().replace(/\s+/g, '');
            const fuzzyQueries = [
                `instagram.com/${nameNoSpaces}`,
                `"@${nameNoSpaces}" instagram`
            ];

            console.log(`📸 Trying fuzzy Instagram search: ${nameNoSpaces}`);

            for (const query of fuzzyQueries) {
                const results = await googleSearch.search(query, 5);

                const instagramResults = results.filter(r =>
                    r.link?.includes('instagram.com/') &&
                    !r.link?.includes('/p/') &&
                    !r.link?.includes('/reel/')
                );

                for (const result of instagramResults) {
                    const handleMatch = result.link.match(/instagram\.com\/([^\/\?]+)/);
                    if (handleMatch && handleMatch[1] !== 'explore' && handleMatch[1] !== 'accounts') {
                        const handle = handleMatch[1];

                        // Check if handle matches the name pattern
                        const handleLower = handle.toLowerCase().replace(/[._-]/g, '');
                        if (handleLower.includes(nameNoSpaces.substring(0, 8))) {
                            // If handle is an EXACT match of the name without spaces, skip AI verification
                            if (handleLower === nameNoSpaces) {
                                console.log(`📸 Instagram found via EXACT fuzzy match: @${handle}`);
                                const profileData = await this.extractInstagramProfileData(handle, result, guest);
                                return profileData;
                            }

                            // For partial matches, verify with AI
                            const isMatch = await this.verifySocialProfile(guest, {
                                platform: 'Instagram',
                                handle: handle,
                                title: result.title,
                                snippet: result.snippet
                            });

                            if (isMatch) {
                                console.log(`📸 Instagram found via fuzzy search: @${handle}`);
                                const profileData = await this.extractInstagramProfileData(handle, result, guest);
                                return profileData;
                            }
                        }
                    }
                }
            }

            console.log(`📸 No verified Instagram found for ${guest.full_name}`);
            return { url: null, handle: null, followers: null, bio: null, location: null, linkedTwitter: null };
        } catch (error) {
            console.error('Instagram search error:', error);
            return { url: null, handle: null, followers: null, bio: null, location: null, linkedTwitter: null };
        }
    }

    /**
     * Extract comprehensive Instagram profile data using SerpAPI and AI
     */
    async extractInstagramProfileData(handle, searchResult, guest) {
        const profileData = {
            url: `https://instagram.com/${handle}`,
            handle: handle,
            followers: null,
            following: null,
            posts: null,
            bio: null,
            location: null,
            linkedTwitter: null,
            linkedWebsite: null,
            jobTitle: null,
            company: null,
            verified: false
        };

        try {
            // Extract thumbnail from search result (profile photo)
            if (searchResult.thumbnail) {
                profileData.profilePhoto = searchResult.thumbnail;
                console.log(`📸 Found Instagram thumbnail: ${searchResult.thumbnail.substring(0, 50)}...`);
            }

            // Parse followers from snippet - support Dutch "4,7 mln. volgers" and English "4.7M followers"
            // Dutch: "4,7 mln. volgers" or "4.7 miljoen volgers"
            const dutchFollowersMatch = searchResult.snippet?.match(/(\d+(?:[.,]\d+)?)\s*(?:mln\.?|miljoen)\s*volgers/i);
            if (dutchFollowersMatch) {
                profileData.followers = this.parseFollowerCount(dutchFollowersMatch[0]);
                console.log(`📊 Dutch followers match: ${dutchFollowersMatch[0]} -> ${profileData.followers}`);
            } else {
                // English: "4.7M followers" or "4,700,000 followers"  
                const followersMatch = searchResult.snippet?.match(/(\d+(?:[.,]\d+)?)\s*[MKmk]?\s*[Ff]ollowers/i);
                if (followersMatch) {
                    profileData.followers = this.parseFollowerCount(followersMatch[0]);
                    console.log(`📊 English followers match: ${followersMatch[0]} -> ${profileData.followers}`);
                }
            }

            // Parse following count
            const followingMatch = searchResult.snippet?.match(/(\d+(?:[.,]\d+)?)\s*(?:volgend|[Ff]ollowing)/i);
            if (followingMatch) {
                profileData.following = this.parseFollowerCount(followingMatch[0]);
            }

            // Parse posts count - Dutch "berichten" or English "posts"
            const postsMatch = searchResult.snippet?.match(/(\d+(?:[.,]\d+)?)\s*(?:berichten|[Pp]osts)/i);
            if (postsMatch) {
                profileData.posts = this.parseFollowerCount(postsMatch[0]);
            }

            // Use AI to extract detailed profile information from the search result
            const openai = this.getOpenAI();
            if (openai) {
                const prompt = `Extract detailed profile information from this Instagram search result.

Title: ${searchResult.title || ''}
Snippet: ${searchResult.snippet || ''}
URL: ${searchResult.link || ''}

Extract the following information (return null for any field you cannot find):

Return JSON:
{
    "bio": "The profile bio/description",
    "location": "The location from the profile",
    "linkedTwitter": "Twitter handle or URL if mentioned in bio",
    "linkedWebsite": "Any website URL mentioned",
    "jobTitle": "Their profession or job title if mentioned",
    "company": "Company or team they work for",
    "verified": true/false if account appears to be verified/official
}`;

                const response = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You are an expert at extracting information from social media profiles. Be precise and only extract information that is clearly present.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    response_format: { type: "json_object" }
                }, { timeout: 45000 });

                const extracted = JSON.parse(response.choices[0].message.content);

                // Merge extracted data
                if (extracted.bio) profileData.bio = extracted.bio;
                if (extracted.location) profileData.location = extracted.location;
                if (extracted.linkedTwitter) {
                    // Clean up Twitter reference
                    let tw = extracted.linkedTwitter;
                    if (tw.includes('twitter.com/') || tw.includes('x.com/')) {
                        const match = tw.match(/(?:twitter|x)\.com\/([^\/\?]+)/);
                        if (match) tw = match[1];
                    }
                    profileData.linkedTwitter = tw.replace('@', '');
                }
                if (extracted.linkedWebsite) profileData.linkedWebsite = extracted.linkedWebsite;
                if (extracted.jobTitle) profileData.jobTitle = extracted.jobTitle;
                if (extracted.company) profileData.company = extracted.company;
                if (extracted.verified) profileData.verified = extracted.verified;
            }

        } catch (error) {
            console.error('Error extracting Instagram profile data:', error);
        }

        return profileData;
    }

    /**
     * Search for Twitter/X profile using SerpAPI
     * Prioritizes verified/official accounts for celebrities
     * Returns comprehensive profile data including bio, location, etc.
     */
    async searchTwitter(guest) {
        try {
            // ============================================
            // STEP 1: Google Search (PRIMARY)
            // ============================================
            const primaryQueries = [
                `site:x.com "${guest.full_name}"`,
                `site:twitter.com "${guest.full_name}"`,
                `"${guest.full_name}" twitter profile`
            ];

            for (const query of primaryQueries) {
                const results = await googleSearch.search(query, 5);

                const twitterResults = results.filter(r =>
                    (r.link?.includes('twitter.com/') || r.link?.includes('x.com/')) &&
                    !r.link?.includes('/status/')
                );

                for (const result of twitterResults) {
                    const handleMatch = result.link.match(/(?:twitter|x)\.com\/([^\/\?]+)/);
                    if (handleMatch && !['search', 'explore', 'home', 'i', 'intent'].includes(handleMatch[1])) {
                        const handle = handleMatch[1];

                        // Verify with AI
                        const isMatch = await this.verifySocialProfile(guest, {
                            platform: 'Twitter/X',
                            handle: handle,
                            title: result.title,
                            snippet: result.snippet
                        });

                        if (isMatch) {
                            console.log(`🐦 Twitter/X found: @${handle}`);
                            const profileData = await this.extractTwitterProfileData(handle, result, guest);
                            return profileData;
                        }
                    }
                }
            }

            console.log(`🐦 No verified Twitter/X found for ${guest.full_name}`);
            return { url: null, handle: null, followers: null, bio: null, location: null, memberSince: null, linkedInstagram: null };
        } catch (error) {
            console.error('Twitter search error:', error);
            return { url: null, handle: null, followers: null, bio: null, location: null, memberSince: null, linkedInstagram: null };
        }
    }

    /**
     * Extract comprehensive Twitter profile data using SerpAPI and AI
     */
    async extractTwitterProfileData(handle, searchResult, guest) {
        const profileData = {
            url: `https://x.com/${handle}`,
            handle: handle,
            followers: null,
            following: null,
            bio: null,
            location: null,
            memberSince: null,
            linkedInstagram: null,
            linkedWebsite: null,
            jobTitle: null,
            company: null,
            verified: false
        };

        try {
            // Extract thumbnail from search result (profile photo)
            if (searchResult.thumbnail) {
                profileData.profilePhoto = searchResult.thumbnail;
                console.log(`📸 Found Twitter thumbnail: ${searchResult.thumbnail.substring(0, 50)}...`);
            }

            // Parse followers from snippet - support Dutch "4,7 mln. volgers" and English "4.7M followers"
            const dutchFollowersMatch = searchResult.snippet?.match(/(\d+(?:[.,]\d+)?)\s*(?:mln\.?|miljoen)\s*volgers/i);
            if (dutchFollowersMatch) {
                profileData.followers = this.parseFollowerCount(dutchFollowersMatch[0]);
                console.log(`📊 Dutch Twitter followers match: ${dutchFollowersMatch[0]} -> ${profileData.followers}`);
            } else {
                const followersMatch = searchResult.snippet?.match(/(\d+(?:[.,]\d+)?)\s*[MKmk]?\s*[Ff]ollowers/i);
                if (followersMatch) {
                    profileData.followers = this.parseFollowerCount(followersMatch[0]);
                }
            }

            // Parse following count
            const followingMatch = searchResult.snippet?.match(/(\d+(?:[.,]\d+)?)\s*(?:volgend|[MKmk]?\s*[Ff]ollowing)/i);
            if (followingMatch) {
                profileData.following = this.parseFollowerCount(followingMatch[0]);
            }

            // Use AI to extract detailed profile information from the search result
            const openai = this.getOpenAI();
            if (openai) {
                const prompt = `Extract detailed profile information from this Twitter/X search result.

Title: ${searchResult.title || ''}
Snippet: ${searchResult.snippet || ''}
URL: ${searchResult.link || ''}

Extract the following information (return null for any field you cannot find):

Return JSON:
{
    "bio": "The profile bio/description",
    "location": "The location from the profile",
    "memberSince": "When they joined (e.g., 'July 2013' or 'juli 2013')",
    "linkedInstagram": "Instagram handle or URL if mentioned in bio",
    "linkedWebsite": "Any website URL mentioned",
    "jobTitle": "Their profession or job title if mentioned",
    "company": "Company or team they work for (e.g., @sksturm means SK Sturm Graz)",
    "verified": true/false if account appears to be verified/official
}`;

                const response = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You are an expert at extracting information from social media profiles. Be precise and only extract information that is clearly present.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    response_format: { type: "json_object" }
                }, { timeout: 45000 });

                const extracted = JSON.parse(response.choices[0].message.content);

                // Merge extracted data
                if (extracted.bio) profileData.bio = extracted.bio;
                if (extracted.location) profileData.location = extracted.location;
                if (extracted.memberSince) profileData.memberSince = extracted.memberSince;
                if (extracted.linkedInstagram) {
                    // Clean up Instagram reference
                    let ig = extracted.linkedInstagram;
                    if (ig.includes('instagram.com/')) {
                        const match = ig.match(/instagram\.com\/([^\/\?]+)/);
                        if (match) ig = match[1];
                    }
                    profileData.linkedInstagram = ig.replace('@', '');
                }
                if (extracted.linkedWebsite) profileData.linkedWebsite = extracted.linkedWebsite;
                if (extracted.jobTitle) profileData.jobTitle = extracted.jobTitle;
                if (extracted.company) profileData.company = extracted.company;
                if (extracted.verified) profileData.verified = extracted.verified;
            }

            // Try to find location
            if (!profileData.location) {
                const locationPatterns = [
                    /(?:📍|Located in|From|Based in)\s*([^,]+(?:,\s*[^,]+)?)/i,
                    /([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)?(?:,\s*[A-Z]{2,})?)/
                ];
                for (const pattern of locationPatterns) {
                    const match = searchResult.snippet?.match(pattern); // snippet text from searchResult
                    if (match && match[1].length < 50) {
                        profileData.location = match[1].trim();
                        break;
                    }
                }
            }

            // Try to get more details with a dedicated Twitter profile search using Google
            const profileQuery = `site:x.com/${handle} OR site:twitter.com/${handle}`;
            const profileResults = await googleSearch.search(profileQuery, 5);

            if (profileResults.length > 0) {
                // Look for the main profile result
                const mainProfile = profileResults.find(r =>
                    (r.link?.endsWith(`/${handle}`) || r.link?.includes(`/${handle}?`)) &&
                    !r.link?.includes('/status/')
                );

                if (mainProfile) {
                    // Extract additional info from the dedicated profile search
                    const snippetText = (mainProfile.snippet || '') + ' ' + (mainProfile.title || '');

                    // Try to find Instagram link in snippet
                    if (!profileData.linkedInstagram) {
                        const igMatch = snippetText.match(/instagram\.com\/([\w.]+)/i);
                        if (igMatch) profileData.linkedInstagram = igMatch[1];
                    }

                    // Try to find location
                    if (!profileData.location) {
                        const locationPatterns = [
                            /(?:📍|Located in|From|Based in)\s*([^,]+(?:,\s*[^,]+)?)/i,
                            /([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)?(?:,\s*[A-Z]{2,})?)/
                        ];
                        for (const pattern of locationPatterns) {
                            const match = snippetText.match(pattern);
                            if (match && match[1].length < 50) {
                                profileData.location = match[1].trim();
                                break;
                            }
                        }
                    }
                }
            }

        } catch (error) {
            console.error('Error extracting Twitter profile data:', error);
        }

        return profileData;
    }

    /**
     * Verify a social media profile belongs to the guest using AI
     */
    async verifySocialProfile(guest, profile) {
        const openai = this.getOpenAI();
        if (!openai) {
            // Without AI, do basic name matching
            const text = (profile.title + ' ' + profile.snippet).toLowerCase();
            const nameParts = guest.full_name.toLowerCase().split(/\s+/);
            return nameParts.every(part => part.length < 3 || text.includes(part));
        }

        try {
            const prompt = `Is this ${profile.platform} profile for "${guest.full_name}"?

Profile handle: @${profile.handle}
Title: ${profile.title}
Snippet: ${profile.snippet}

IMPORTANT:
- For celebrities, the handle often won't match their full name (e.g., Drake uses @champagnepapi)
- Look for verified indicators, official mentions, or the name in the bio/title
- Be especially careful with common names - require strong evidence
- Some celebrities have deleted or locked accounts - if the info suggests this, return false

Return JSON: { "isMatch": true/false, "confidence": 0.0-1.0, "reason": "brief explanation" }`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are an expert at identifying celebrity and public figure social media accounts. Be careful to distinguish between official accounts and fan accounts.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            }, { timeout: 45000 });

            const result = JSON.parse(response.choices[0].message.content);
            console.log(`🤖 Social verification for @${profile.handle}: ${result.isMatch ? 'Match' : 'No match'} (${Math.round(result.confidence * 100)}%) - ${result.reason}`);

            return result.isMatch && result.confidence >= 0.7;
        } catch (error) {
            console.error('Social profile verification error:', error);
            return false;
        }
    }

    /**
     * Parse follower count strings like "10M followers", "5.2K followers", "4,7 mln. volgers"
     * Supports both English (M/K) and Dutch (mln./miljoen, k/duizend) formats
     */
    parseFollowerCount(str) {
        if (!str) return null;

        // Log for debugging
        console.log(`📊 Parsing follower count from: "${str}"`);

        // Try Dutch format first: "4,7 mln." or "4.7 miljoen"
        const dutchMatch = str.match(/(\d+(?:[.,]\d+)?)\s*(?:mln\.?|miljoen)/i);
        if (dutchMatch) {
            const num = parseFloat(dutchMatch[1].replace(',', '.')) * 1000000;
            console.log(`📊 Parsed Dutch millions: ${num}`);
            return Math.round(num);
        }

        // Try "duizend" or Dutch K format
        const dutchKMatch = str.match(/(\d+(?:[.,]\d+)?)\s*(?:k|duizend)/i);
        if (dutchKMatch) {
            const num = parseFloat(dutchKMatch[1].replace(',', '.')) * 1000;
            console.log(`📊 Parsed Dutch thousands: ${num}`);
            return Math.round(num);
        }

        // Standard English format: 10M, 5.2K, 1.5M
        const englishMatch = str.match(/(\d+(?:[.,]\d+)?)\s*([MKmk])\b/);
        if (englishMatch) {
            let num = parseFloat(englishMatch[1].replace(',', '.'));
            const multiplier = englishMatch[2].toUpperCase();

            if (multiplier === 'M') num *= 1000000;
            else if (multiplier === 'K') num *= 1000;

            console.log(`📊 Parsed English format: ${num}`);
            return Math.round(num);
        }

        // Plain number (no suffix) - only use if it's a large number (likely followers not posts)
        const plainMatch = str.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:followers?|volgers?)/i);
        if (plainMatch) {
            // Remove thousand separators and parse
            const numStr = plainMatch[1].replace(/[.,](?=\d{3})/g, '');
            const num = parseInt(numStr, 10);
            console.log(`📊 Parsed plain number with followers keyword: ${num}`);
            return num;
        }

        // Fallback: just try to find a number followed by M/K anywhere
        const fallbackMatch = str.match(/(\d+(?:[.,]\d+)?)\s*([MKmk])/);
        if (fallbackMatch) {
            let num = parseFloat(fallbackMatch[1].replace(',', '.'));
            const multiplier = fallbackMatch[2].toUpperCase();

            if (multiplier === 'M') num *= 1000000;
            else if (multiplier === 'K') num *= 1000;

            console.log(`📊 Parsed fallback: ${num}`);
            return Math.round(num);
        }

        console.log(`📊 Could not parse follower count from: "${str}"`);
        return null;
    }

    /**
     * Detect if a person is likely a celebrity (for prioritizing social media search)
     * ULTIMATE FINDER: Also detects aliases (Sean Carter = Jay-Z, Stefani Germanotta = Lady Gaga)
     */
    async detectCelebrity(guest, linkedinInfo) {
        // STEP 1: Try Knowledge Graph first (most reliable, if enabled)
        const kgResult = await knowledgeGraph.detectCelebrity(guest.full_name);

        if (kgResult.isCelebrity && kgResult.confidence >= 0.5) {
            console.log(`📚 Celebrity detected via Knowledge Graph: ${kgResult.knownFor}`);
            return {
                isCelebrity: true,
                confidence: kgResult.confidence,
                category: kgResult.category,
                knownFor: kgResult.knownFor,
                detailedDescription: kgResult.detailedDescription,
                wikipediaUrl: kgResult.wikipediaUrl,
                officialImage: kgResult.officialImage,
                socialMediaPriority: this.inferSocialPriority(kgResult.category),
                source: 'knowledge_graph',
                aliases: kgResult.aliases || []
            };
        }

        // STEP 2: GPT-based detection with ALIAS RECOGNITION
        const openai = this.getOpenAI();
        if (!openai) return { isCelebrity: false, category: null, source: 'none' };

        try {
            console.log(`🧠 GPT celebrity + alias check for: ${guest.full_name}`);

            const prompt = `You are identifying if "${guest.full_name}" is a FAMOUS person OR an alias/real name of a famous person.

USE YOUR TRAINING KNOWLEDGE. You know millions of celebrities and their REAL NAMES and STAGE NAMES.

ALIAS DETECTION (CRITICAL):
- Many celebrities use stage names. If the input is a REAL NAME, identify the famous persona.
- Examples:
  * "Sean Carter" or "Shawn Corey Carter" → Jay-Z (rapper)
  * "Stefani Germanotta" → Lady Gaga (singer)
  * "Marshall Mathers" → Eminem (rapper)
  * "Robyn Fenty" → Rihanna (singer)
  * "Curtis Jackson" → 50 Cent (rapper)
  * "Onika Maraj" → Nicki Minaj (rapper)
  * "Abel Tesfaye" → The Weeknd (singer)
  * "Aubrey Graham" → Drake (rapper)
  * "Dwayne Johnson" → The Rock (actor/wrestler)
  * "Eric Bishop" → Jamie Foxx (actor)
  * "Reginald Dwight" → Elton John (musician)
- Also works in reverse: if someone enters "Jay-Z", recognize it.

CATEGORIES:
- entertainment: musicians, actors, directors, producers, comedians, artists
- sports: professional athletes, olympians, coaches, racing drivers
- media: TV hosts, journalists, YouTubers, major influencers (1M+ followers)
- politics: presidents, prime ministers, ministers, famous politicians
- business: ONLY globally famous CEOs (Elon Musk, Jeff Bezos level)

GUEST INFO:
- Input Name: ${guest.full_name}
- Country hint: ${guest.country || 'Unknown'}

RULES:
1. If the name is a KNOWN ALIAS or REAL NAME of a celebrity, return isCelebrity: true.
2. CRITICAL: If the input name is NOT the same person, return isCelebrity: false.
   - Example Input: "Sem van Ginkel"
   - Fact: Marco van Ginkel is famous. Sem is NOT Marco.
   - Action: RETURN isCelebrity: false.
   - Example Input: "Sean Carter"
   - Fact: This IS Jay-Z's real name.
   - Action: RETURN isCelebrity: true.
3. If the first name is different and you cannot find a documented alias link, it is a namesake mismatch. Return isCelebrity: false.
4. Return the PRIMARY/MOST FAMOUS name as "primaryName".
5. List all known aliases in the "aliases" array.
6. If unsure or the name is too common (e.g. "John Smith"), return isCelebrity: false.

Return JSON:
{
  "isCelebrity": true/false,
  "primaryName": "The most famous name (stage name if applicable)",
  "aliases": ["List of all known names/aliases"],
  "confidence": 0.85-1.0 if you KNOW them, 0.0-0.5 if guessing,
  "category": "entertainment|sports|media|politics|business|null",
  "knownFor": "Their claim to fame in 1-2 sentences",
  "socialMediaPriority": "instagram|twitter|both|null",
  "wikipediaUrl": "https://en.wikipedia.org/wiki/... or null",
  "twitterHandle": "@handle or null",
  "instagramHandle": "@handle or null"
}`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a celebrity identification expert with encyclopedic knowledge of famous people worldwide, including their REAL NAMES and STAGE NAMES. If someone gives you a real name like "Sean Carter", you MUST recognize this as Jay-Z. Answer based on your training data.'
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            }, { timeout: 30000 });

            const result = JSON.parse(response.choices[0].message.content);
            result.source = 'gpt';

            if (result.isCelebrity) {
                // Check if we detected an alias
                const inputName = guest.full_name.toLowerCase();
                const primaryName = result.primaryName?.toLowerCase() || '';
                const isAlias = inputName !== primaryName && result.primaryName;

                if (isAlias) {
                    console.log(`🎭 ALIAS DETECTED: "${guest.full_name}" is actually "${result.primaryName}"!`);
                }
                console.log(`⭐ CELEBRITY CONFIRMED: ${result.primaryName || guest.full_name} - ${result.category} (${Math.round(result.confidence * 100)}%)`);
                console.log(`   → ${result.knownFor}`);
                if (result.aliases?.length > 0) {
                    console.log(`   → Aliases: ${result.aliases.join(', ')}`);
                }
            } else {
                console.log(`👤 Not a celebrity: ${guest.full_name}`);
            }

            // Infer social priority if not set
            if (result.isCelebrity && !result.socialMediaPriority) {
                result.socialMediaPriority = this.inferSocialPriority(result.category);
            }

            return result;
        } catch (error) {
            console.error('Celebrity detection error:', error);
            return { isCelebrity: false, category: null, source: 'error' };
        }
    }

    /**
     * Infer social media priority based on celebrity category
     */
    inferSocialPriority(category) {
        if (category === 'entertainment') return 'instagram';
        if (category === 'sports') return 'instagram';
        if (category === 'politics') return 'twitter';
        if (category === 'business') return 'twitter';
        return 'both';
    }

    /**
     * Determine if we should invest time in social media searches.
     * 
     * BUSINESS RULE:
     * - Celebrities in entertainment/sports/media → YES, search socials
     * - Standard business people → NO, LinkedIn is enough
     * - Unknown (no LinkedIn or celebrity info) → YES, might be influential
     * 
     * This prevents wasting time searching for the personal Instagram of a CEO,
     * which is usually private and not useful for hotel staff.
     */
    shouldSearchSocialMedia(celebrityInfo, linkedinInfo, options = {}) {
        const { hasCompanyFromEmail = false } = options;
        // If confirmed celebrity in entertainment/sports/media → Always search
        if (celebrityInfo.isCelebrity) {
            const publicCategories = ['entertainment', 'sports', 'media'];
            if (publicCategories.includes(celebrityInfo.category)) {
                console.log(`✅ Social search: Celebrity in ${celebrityInfo.category}`);
                return true;
            }
            // Business/Politics celebrities might still be public figures
            if (celebrityInfo.confidence >= 0.9) {
                console.log(`✅ Social search: High-confidence celebrity (${celebrityInfo.category})`);
                return true;
            }
        }

        // If we already confirmed a company via email domain, skip socials for business guests
        if (hasCompanyFromEmail) {
            console.log('❌ Social search skipped: Company confirmed via email domain');
            return false;
        }

        // If no LinkedIn found → Search socials as fallback discovery
        if (!linkedinInfo?.bestMatch) {
            console.log(`✅ Social search: No LinkedIn found, using socials as discovery`);
            return true;
        }

        // LinkedIn found for standard business person → Skip personal socials
        console.log(`❌ Social search skipped: Standard business guest with LinkedIn`);
        return false;
    }

    /**
     * Verify if a social media account matches the celebrity status
     * Prevents Jay-Z being matched to an account with 200 followers.
     */
    async verifySocialMediaRelevance(guest, result, celebrityInfo, platform) {
        if (!result || !result.url) return result;

        console.log(`🕵️ Verifying ${platform} for celebrity ${guest.full_name}...`);

        // Rule 1: Verified accounts are usually safe
        // (We can't easily check blue tick without complex scraping, but high followers is a proxy)

        // Rule 2: Follower count sanity check
        const followers = result.followers;

        if (followers !== null) {
            // Thresholds
            const MIN_CELEBRITY_FOLLOWERS = 50000; // 50k
            const SUSPICIOUS_CELEBRITY_FOLLOWERS = 5000; // 5k

            console.log(`📊 Account has ${followers} followers. Celebrity Threshold: ${MIN_CELEBRITY_FOLLOWERS}`);

            if (followers < SUSPICIOUS_CELEBRITY_FOLLOWERS) {
                console.warn(`❌ REJECTED: ${guest.full_name} is a celebrity but this account has only ${followers} followers.`);
                return { url: null, handle: null, followers: null, bio: null };
            }

            if (followers < MIN_CELEBRITY_FOLLOWERS) {
                console.warn(`⚠️ WARNING: Low follower count for a celebrity (${followers}). Keeping but flagging.`);
                // We could ask AI to double check description here if we wanted
            }
        } else {
            // Logic when we couldn't parse followers:
            // If we are SURE it's a huge celebrity (Confidence > 0.9), we might reject unverified/unscraped profiles
            if (celebrityInfo.confidence >= 0.9) {
                console.warn(`⚠️ Could not verify followers for MAJOR celebrity. Proceeding with caution.`);
            }
        }

        return result;
    }

    /**
     * Search for recent news about the guest using SerpAPI
     * Returns relevant news from the last 6 months
     */
    async searchRecentNews(guest) {
        const guestName = guest.full_name;
        try {
            // FAST MODE: Single quick search, max 3 results, no AI verification
            console.log(`📰 Quick news search for ${guestName}...`);

            // Use Google for news search
            const articles = await googleSearch.search(`"${guestName}" news`, 3);

            if (articles.length > 0) {
                console.log(`📰 Found ${articles.length} news articles`);
                return {
                    articles: articles.slice(0, 3), // Max 3 articles
                    hasNews: true
                };
            }

            console.log(`📰 No news found for ${guestName}`);
            return { articles: [], hasNews: false };
        } catch (error) {
            console.error('News search error:', error);
            return { articles: [], hasNews: false };
        }
    }

    /**
     * Check if news articles are actually about THIS guest
     */
    async verifyNewsRelevance(guest, articles) {
        const openai = this.getOpenAI();
        if (!openai) return articles; // Fallback if no OpenAI

        try {
            const articlesText = articles.map((a, i) => `[${i}] Title: ${a.title}\nSnippet: ${a.snippet}`).join('\n\n');
            const prompt = `I have found news articles for a guest: "${guest.full_name}".
Help me verify if these articles are about THIS SPECIFIC PERSON or someone else with the same name.

GUEST CONTEXT:
Name: ${guest.full_name}
Company: ${guest.company || 'Unknown'}
Location: ${guest.country || 'Unknown'}
Known Job: ${guest.job_title || 'Unknown'}

ARTICLES FOUND:
${articlesText}

INSTRUCTIONS:
1. Compare the context (company, industry, location) with the article content.
2. If an article is about a crime (fraud, murder, etc.) and the guest context is a reputable business person, ASSUME IT IS A FALSE POSITIVE unless the company/location matches perfectly.
3. Be strict. Better to miss an article than to accuse a guest of a crime.
4. "Leslie Okyere" (Founder NL Connekt) is NOT the "Leslie Okyere" convicted of bank fraud in the US.
5. Return a JSON array of indices that are SAFE and RELEVANT.

Return JSON:
{
  "relevantMetrics": [0, 2] // indices of valid articles
}`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a strict reputation manager. You filter out news about namesakes.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.0,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message.content);
            const validIndices = result.relevantMetrics || [];

            return articles.filter((_, i) => validIndices.includes(i));
        } catch (error) {
            console.error('News verification error:', error);
            return []; // Fail safe: return nothing if verification errors
        }
    }


    /**
     * Use AI to select the best match from candidates
     */
    async verifyCandidatesWithAI(guest, candidates) {
        const openai = this.getOpenAI();
        if (!openai || candidates.length === 0) {
            return {
                candidates,
                bestMatch: candidates[0],
                needsReview: candidates.length > 1
            };
        }

        try {
            const candidatesInfo = candidates.map((c, i) =>
                `Candidate ${i}: 
                Name on profile: ${c.profileName || 'Unknown'}
                Title: ${c.title}
                Snippet: ${c.snippet}`
            ).join('\n\n');

            const prompt = `Which of these LinkedIn candidates is the best match for this guest?
            
GUEST INFO:
Name: ${guest.full_name}
Company: ${guest.company || 'Unknown'}
Country: ${guest.country || 'Unknown'}

CANDIDATES:
${candidatesInfo}

INSTRUCTIONS:
1. EXTREEM STRENG OP LOCATIE: Als het land of de regio niet overeenkomt (bijv. Zwitserland vs België), verlaag de confidence direct naar 0, tenzij er expliciet bewijs is van een verhuizing in het profiel.
2. Be EXTREMELY strict. If the company doesn't match and the name is common, it's likely NOT a match.
3. If NOTHING matches perfectly (no company/location match), return bestMatchIndex: null. DO NOT guess based on high status if the location is wrong.
4. CATEGORISCHE AFWIJZING: Als een kandidaat overduidelijk een historisch figuur is (geboren pre-1940), wijs deze dan direct af.
5. If multiple candidates look similar and you are not 90% sure, set bestMatchIndex to null or set matchesIdentity to false so the user MUST review.
6. PREFER SOCIAL PROOF: If one profile has indicators of high status (e.g. "500+ connections", "Director", "Managing Partner") and the other looks junior or incomplete, prefer the high-status one ONLY if the location/company matches.

Return JSON:
{
  "bestMatchIndex": [index of the best match, or null if NO good match],
  "confidence": [0-1 score, be conservative],
  "reason": "short explanation",
  "matchesIdentity": [true if it's almost certainly the same person, false otherwise]
}

NOTE: We are looking for successful business professionals, entrepreneurs, and decision-makers. Priority should be given to candidates whose profile matches the industry or company mentioned.`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are an expert at verifying identities across the web. Be strict about matching names and companies.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message.content);
            const bestIndex = result.bestMatchIndex;

            if (bestIndex !== null && bestIndex >= 0 && bestIndex < candidates.length) {
                const bestMatch = candidates[bestIndex];
                const needsReview = !result.matchesIdentity || result.confidence < 0.8 || candidates.length > 1;

                console.log(`🤖 AI selected Candidate ${bestIndex} with ${Math.round(result.confidence * 100)}% confidence. Reason: ${result.reason}`);

                return {
                    candidates,
                    bestMatch,
                    needsReview,
                    aiVerification: result
                };
            }

            console.log(`🤖 AI found no clear match. Reason: ${result.reason}`);
            return { candidates, bestMatch: null, needsReview: true, aiVerification: result };

        } catch (error) {
            console.error('AI verification error:', error);
            return {
                candidates,
                bestMatch: candidates[0],
                needsReview: candidates.length > 1
            };
        }
    }

    /**
     * Use OpenAI to analyze LinkedIn, News, and Company info to calculate VIP score
     * Generates a comprehensive guest report with confidence levels
     */
    async analyzeWithAI(guest, linkedinInfo, celebrityInfo = null, newsInfo = null, fallbackInfo = null, allResults = [], emailDomainInfo = null, language = 'nl') {
        const openai = this.getOpenAI();
        if (!openai) {
            console.log('OpenAI not configured, using basic scoring');
            return this.basicAnalysis(linkedinInfo, celebrityInfo);
        }

        try {
            console.log('\n🔍 ========== DEBUG: ANALYZE WITH AI - INPUT DATA ==========');
            console.log('LinkedinInfo.bestMatch:', JSON.stringify(linkedinInfo.bestMatch, null, 2));
            console.log('=============================================================\n');

            // Build context from LinkedIn
            const linkedinContext = linkedinInfo.bestMatch ? `
LINKEDIN DATA:
- Titel: ${linkedinInfo.bestMatch.title}
- Functie: ${linkedinInfo.bestMatch.jobTitle || 'Onbekend'}
- Bedrijf: ${linkedinInfo.bestMatch.company || 'Onbekend'}
- Bio Snippet: ${linkedinInfo.bestMatch.snippet || 'Geen'}` : 'Geen LinkedIn profiel gevonden.';

            // Build context from Fallback (if no LinkedIn)
            let fallbackContext = '';
            if (fallbackInfo) {
                fallbackContext = `
GEVONDEN WEB PROFIEL (AI-geselecteerd):
- Titel: ${fallbackInfo.title}
- Bron: ${fallbackInfo.url}
- Gedetecteerde Functie: ${fallbackInfo.jobTitle || 'Onbekend'}
- Gedetecteerd Bedrijf: ${fallbackInfo.company || 'Onbekend'}
- Snippet: ${fallbackInfo.snippet}`;

                // Include deep-scraped content if available (MUCH RICHER DATA!)
                if (fallbackInfo.deepContent) {
                    fallbackContext += `

VOLLEDIGE WEBSITE INHOUD (Deep Scraped):
${fallbackInfo.deepContent.substring(0, 6000)}`;
                }
            }

            // Build celebrity context
            const celebrityContext = celebrityInfo?.isCelebrity ? `
KNOWLEDGE GRAPH DATA (CELEBRITY):
- Categorie: ${celebrityInfo.category || 'Onbekend'}
- Bekend van: ${celebrityInfo.knownFor || 'Onbekend'}
- Vermelding: ${celebrityInfo.detailedDescription || 'Nvt'}` : '';

            // Build news context
            const newsContext = newsInfo?.hasNews ? `
RECENT NIEUWS (Laatste 6 maanden):
${newsInfo.articles.map(a => `- ${a.title} (${a.source}): ${a.snippet}`).join('\n')}` : 'Geen recent nieuws gevonden.';

            // Build results context from all search snippets (VERY IMPORTANT FOR CONTEXT!)
            const searchResultsContext = allResults && allResults.length > 0 ? `
ALGEMENE ZOEKRESULTATEN (Snippets):
${allResults.map((r, i) => `${i + 1}. ${r.title}: ${r.snippet} (Bron: ${r.url})`).join('\n')}` : '';

            // Build email domain context (CRITICAL: This is verified company info from email domain)
            const emailDomainContext = emailDomainInfo?.companyName ? `
EMAIL DOMAIN ANALYSE (VERIFIED COMPANY INFO):
- Bedrijfsnaam: ${emailDomainInfo.companyName}
- Website: ${emailDomainInfo.websiteUrl || 'Niet gevonden'}
- Eigenaar Status: ${emailDomainInfo.ownerLabel || 'Onbekend'}
- Eigenaar Reden: ${emailDomainInfo.ownerReason || 'Nvt'}
- Vertrouwen: ${emailDomainInfo.ownerConfidence ? (emailDomainInfo.ownerConfidence * 100).toFixed(0) + '%' : 'Nvt'}
${emailDomainInfo.companyDescription ? `- Bedrijfsbeschrijving: ${emailDomainInfo.companyDescription}` : ''}
${emailDomainInfo.industry ? `- Industrie: ${emailDomainInfo.industry}` : ''}
${emailDomainInfo.companySize ? `- Bedrijfsgrootte: ${emailDomainInfo.companySize}` : ''}` : '';

            // Build company context
            const companyContext = guest.company_info ? `
BEDRIJFS DATA:
- Naam: ${guest.company_info.name}
- Industry: ${guest.company_info.industry || 'Onbekend'}
- Grootte: ${guest.company_info.size || 'Onbekend'}
- Beschrijving: ${guest.company_info.description || 'Onbekend'}
${guest.company_info.deep_info ? `
WEBSITE ANALYSE:
- Missie: ${guest.company_info.deep_info.mission}
- Diensten: ${guest.company_info.deep_info.products_services?.join(', ')}
- Doelgroep: ${guest.company_info.deep_info.target_market}` : ''}` : '';

            let prompt;
            if (language === 'en') {
                prompt = `You are a VIP guest analyst for a 5-star luxury hotel. Analyze the data about "${guest.full_name}" and write a professional report.

--- STRICT RULES ---
1. NO SPECULATION: State only what is directly supported by the data.
2. NO FLUFF: Write factually and professionally. No standard opening sentences or pleasantries.
3. NATURAL TEXT: Avoid the word "null" or "unknown" in the report text. If information is missing, leave it out so it reads naturally. No empty spaces or gaps in lists.
4. FORMATTING: Use compact notation for numbers (e.g., 18k instead of 18,000).
5. PERSONALIZED RECOMMENDATIONS: Make service recommendations truly specific to this person. No generic "be polite" advice, but actions based on their interests, role, or recent achievements.
6. CONFIDENCE SCORING: Provide a confidence score ("high", "medium", "low") for each important field.
7. CRITICAL VIEW & ANTI-HISTORY: Be extremely critical of sources. Is this really the living person currently staying at our hotel?
   - HISTORICAL FIGURES: If you see data about people born in the 19th or early 20th century (e.g., 1882), or people long deceased: IGNORE COMPLETELY. DO NOT report a history lesson.
   - NAMESAKES: If the name is common and there is no match with country/company, assume it is a namesake and report nothing.
   - RESULT IF NO INFO: If there is no current, relevant information about the guest as a living person, set all fields to "null" or "No information found" and set noResultsFound to true. NEVER report on someone else just because the name is the same.
8. FOCUS ON VIP STATUS: We are looking for work experience, wealth, titles, and influence of the CURRENT person.
9. STUDENT STATUS - CRITICAL VERIFICATION: If you see "Student" or "Student at [School]" as a position:
   - VERIFICATION: Check if this is a current student or an outdated profile
   - CONTEXT CHECK: If there is also work experience, company name, or other professional indicators, "Student" is likely WRONG or OUTDATED
   - PREFERENCE: If there is both "Student" and a company name/work experience, use the COMPANY NAME and WORK EXPERIENCE as the primary source
   - ALERT: If someone has a company (email domain info) but LinkedIn says "Student", the LinkedIn data is likely outdated - use the company info
   - DO NOT REPORT: Report "Student" only if there are NO other professional indicators and it is clearly a current student
10. EMAIL DOMAIN INFO IS PRIORITY: If there is EMAIL DOMAIN ANALYSIS data, ALWAYS use this as the primary source for:
   - Company Name (company_analysis.company_name)
   - Website URL (use emailDomainInfo.websiteUrl)
   - Company Description (company_analysis.company_description)
   - Industry (industry field)
   - Company Size (company_size field)
   - This is verified information directly from the email domain and takes PRECEDENCE over all other sources.

--- DATA INPUT ---
NAME: ${guest.full_name}
EMAIL: ${guest.email || 'Unknown'}
COUNTRY: ${guest.country || 'Unknown'}
NOTES: ${guest.notes || 'None'}

${emailDomainContext}
${linkedinContext}
${fallbackContext}
${searchResultsContext}
${celebrityContext}
${newsContext}
${companyContext}

--- OUTPUT FORMAT (JSON) ---
{
  "vip_score": { "value": 1-10, "confidence": "high/medium/low", "reason": "..." },
  "industry": { "value": "...", "confidence": "..." },
  "company_size": { "value": "Micro/Small/Medium/Large", "confidence": "..." },
  "is_owner": { "value": true/false/null, "confidence": "..." },
  "employment_type": { "value": "...", "confidence": "..." },
  "influence_level": { "value": "Low/Medium/High/VIP", "confidence": "..." },
  "net_worth_estimate": { "value": "...", "confidence": "..." },
  "notable_info": "Max 150 chars summary",
  "full_report": {
    "executive_summary": "Powerful summary of 2-3 sentences.",
    "professional_background": {
      "current_role": "Current role and responsibilities",
      "career_trajectory": "Short description of career path",
      "industry_expertise": "Areas of expertise",
      "notable_achievements": "Important achievements"
    },
    "company_analysis": {
      "company_name": "Company Name (USE EMAIL DOMAIN INFO IF AVAILABLE - verified info)",
      "company_description": "What the company does (USE EMAIL DOMAIN INFO if available)",
      "company_position": "Market position",
      "employee_count": "Number of employees if known"
    },
    "vip_indicators": {
      "wealth_signals": "Indications of wealth",
      "influence_factors": "Factors indicating influence",
      "status_markers": "Status markers like titles"
    },
    "service_recommendations": {
      "priority_level": "Standard/Elevated/VIP/Ultra-VIP",
      "quick_win": "Most impactful direct action (max 100 chars). E.g., 'Congratulate on recent IPO of [Company]'.",
      "categories": [
        {
          "title": "Personal Attention",
          "items": ["Concrete tip 1", "Concrete tip 2"]
        },
        {
          "title": "Conversation Topics & News",
          "items": ["Refer to [News Fact]", "Ask about [Interest]"]
        },
        {
          "title": "Hospitality & Gestures",
          "items": ["Suggestion for drink/gift", "Specific room adjustment"]
        }
      ]
    },
    "additional_notes": "Any extra relevant information"
  }
}`;
            } else {
                prompt = `Je bent een VIP-gastanalist voor een 5-sterren luxe hotel. Analyseer de data over "${guest.full_name}" en schrijf een professioneel rapport.

--- STRIKTE REGELS ---
1. GEEN SPECULATIE: Vermeld alleen wat direct uit de data blijkt.
2. GEEN FLUFF: Schrijf feitelijk en zakelijk. Geen standaard openingszinnen of beleefdheidsvormen.
3. NATUURLIJKE TEKST: Vermijd het woord "null" of "onbekend" in de rapport-текsten. Als informatie er niet is, laat het dan gewoon achterwege uit het verhaal. Geen lege plekken of gaten in opsommingen.
4. FORMATTERING: Gebruik voor getallen (zoals volgers) compacte notaties (bijv. 18k in plaats van 18.000).
5. GEPERSONALISEERDE AANBEVELINGEN: Maak de service aanbevelingen echt specifiek voor deze persoon. Geen algemene "wees beleefd" adviezen, maar acties gebaseerd op hun interesses, rol of recente prestaties.
6. CONFIDENCE SCORING: Geef voor elk belangrijk veld een confidence score ("high", "medium", "low").
7. KRITISCHE BLIK & ANTI-HISTORIE: Wees extreem kritisch op de bronnen. Is dit echt de levende persoon die nu in ons hotel verblijft? 
   - HISTORISCHE FIGUREN: Als je data ziet over mensen geboren in de 19e of vroege 20e eeuw (bijv. 1882), of mensen die al lang overleden zijn: NEGEER DEZE COMPLEET. Rapporteer GEEN geschiedenisles.
   - NAAMGENOTEN: Als de naam veelvoorkomend is en er is geen match met land/bedrijf, neem dan aan dat het een naamgenoot is en rapporteer niets. 
   - RESULTAAT BIJ GEEN INFO: Als er geen actuele, relevante informatie is over de gast als levende persoon, zet dan alle velden op "null" of "Geen informatie gevonden" en zet noResultsFound op true. Rapporteer NOOIT over iemand anders alleen omdat de naam hetzelfde is.
8. FOCUS OP VIP STATUS: We zoeken werkervaring, vermogen, titels en invloed van de HUIDIGE persoon.
9. STUDENT STATUS - KRITISCHE VERIFICATIE: Als je "Student" of "Student at [School]" ziet als functie:
   - VERIFICATIE: Controleer of dit een actuele student is of een verouderd profiel
   - CONTEXT CHECK: Als er ook werkervaring, bedrijfsnaam, of andere professionele indicatoren zijn, dan is "Student" waarschijnlijk VERKEERD of VEROUderd
   - VOORKEUR: Als er zowel "Student" als een bedrijfsnaam/werkervaring is, gebruik dan de BEDRIJFSNAAM en WERKERVARING als primaire bron
   - ALERT: Als iemand een bedrijf heeft (email domain info) maar LinkedIn zegt "Student", dan is de LinkedIn data waarschijnlijk verouderd - gebruik de bedrijfsinfo
   - RAPPORTEER NIET: Rapporteer "Student" alleen als er GEEN andere professionele indicatoren zijn en het duidelijk een actuele student is
10. EMAIL DOMAIN INFO IS PRIORITY: Als er EMAIL DOMAIN ANALYSE data is, gebruik deze ALTIJD als primaire bron voor:
   - Bedrijfsnaam (company_analysis.company_name)
   - Website URL (gebruik emailDomainInfo.websiteUrl)
   - Bedrijfsbeschrijving (company_analysis.company_description)
   - Industrie (industry field)
   - Bedrijfsgrootte (company_size field)
   Dit is geverifieerde informatie direct uit het email domein en heeft VOORRANG boven alle andere bronnen.

--- DATA INPUT ---
NAAM: ${guest.full_name}
E-MAIL: ${guest.email || 'Onbekend'}
LAND: ${guest.country || 'Onbekend'}
NOTITIES: ${guest.notes || 'Geen'}

${emailDomainContext}
${linkedinContext}
${fallbackContext}
${searchResultsContext}
${celebrityContext}
${newsContext}
${companyContext}

--- OUTPUT FORMAT (JSON) ---
{
  "vip_score": { "value": 1-10, "confidence": "high/medium/low", "reason": "..." },
  "industry": { "value": "...", "confidence": "..." },
  "company_size": { "value": "Micro/Klein/Middelgroot/Groot", "confidence": "..." },
  "is_owner": { "value": true/false/null, "confidence": "..." },
  "employment_type": { "value": "...", "confidence": "..." },
  "influence_level": { "value": "Laag/Gemiddeld/Hoog/VIP", "confidence": "..." },
  "net_worth_estimate": { "value": "...", "confidence": "..." },
  "notable_info": "Max 150 tekens samenvatting",
  "full_report": {
    "executive_summary": "Krachtige samenvatting van 2-3 zinnen.",
    "professional_background": {
      "current_role": "Huidige functie en verantwoordelijkheden",
      "career_trajectory": "Korte beschrijving van carrièrepad",
      "industry_expertise": "Expertisegebieden",
      "notable_achievements": "Belangrijke prestaties"
    },
    "company_analysis": {
      "company_name": "Bedrijfsnaam (GEBRUIK EMAIL DOMAIN INFO ALS DIT BESCHIKBAAR IS - dit is geverifieerde info)",
      "company_description": "Wat doet het bedrijf (GEBRUIK EMAIL DOMAIN INFO als beschikbaar)",
      "company_position": "Marktpositie",
      "employee_count": "Aantal werknemers indien bekend"
    },
    "vip_indicators": {
      "wealth_signals": "Indicaties van vermogen",
      "influence_factors": "Factoren die invloed aangeven",
      "status_markers": "Statusmarkers zoals titels"
    },
    "service_recommendations": {
      "priority_level": "Standaard/Verhoogd/VIP/Ultra-VIP",
      "quick_win": "De meest impactvolle directe actie (max 100 tekens). Bijv: 'Feliciteer met recente beursgang van [Bedrijf]'.",
      "categories": [
        {
          "title": "Persoonlijke Aandacht",
          "items": ["Concrete tip 1", "Concrete tip 2"]
        },
        {
          "title": "Gespreksonderwerpen & Nieuws",
          "items": ["Refereer aan [Nieuwsfeit]", "Vraag naar [Interesse]"]
        },
        {
          "title": "Gastvrijheid & Attenties",
          "items": ["Suggestie voor drankje/cadeau", "Specifieke kamer-aanpassing"]
        }
      ]
    },
    "additional_notes": "Eventuele extra relevante informatie"
  }
} `;
            }

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: language === 'en' ? 'You are a ruthlessly factual VIP analyst. You hate fluff and speculation. You report only what is proven.' : 'Je bent een meedogenloos feitelijke VIP-analist. Je haat fluff en speculatie. Je rapporteert alleen wat bewezen is.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 2500,
                response_format: { type: "json_object" }
            }, { timeout: 45000 });

            const content = response.choices[0]?.message?.content;
            if (!content) return this.basicAnalysis(linkedinInfo);

            const result = JSON.parse(content);

            // Flatten generic fields for backward compatibility while keeping confidence data
            return {
                ...result,
                vip_score: result.vip_score.value,
                industry: result.industry.value,
                company_size: result.company_size.value,
                is_owner: result.is_owner.value,
                employment_type: result.employment_type.value,
                influence_level: result.influence_level.value,
                net_worth_estimate: result.net_worth_estimate.value,
                confidence_scores: {
                    vip_score: result.vip_score.confidence,
                    industry: result.industry.confidence,
                    is_owner: result.is_owner.confidence
                }
            };
        } catch (error) {
            console.error('AI analysis error:', error);
            return this.basicAnalysis(linkedinInfo);
        }
    }


    /**
     * Specialized analysis that incorporates manual research findings provided by the user.
     * Combines existing research results with new findings to create a superior report.
     */
    async analyzeWithCustomInput(guest, existingResearch, customInput, language = 'nl') {
        const openai = this.getOpenAI();
        if (!openai) {
            console.log('OpenAI not configured for custom analysis');
            return null;
        }

        try {
            // Build context from existing research
            const existingContext = `
BESTAANDE RESEARCH DATA:
- Job Title: ${existingResearch.job_title || 'Onbekend'}
- Bedrijf: ${existingResearch.company_name || 'Onbekend'}
- Industry: ${existingResearch.industry || 'Onbekend'}
- VIP Score: ${existingResearch.vip_score || '5'}
- LinkedIn: ${existingResearch.linkedin_url || 'Niet gevonden'}
- Instagram: ${existingResearch.instagram_handle || 'Niet gevonden'}
- Twitter: ${existingResearch.twitter_handle || 'Niet gevonden'}
- Samenvatting: ${existingResearch.notable_info || 'Geen'}
- Full Report (bestaand): ${existingResearch.full_report ? 'Beschikbaar' : 'Niet beschikbaar'}
`;

            let prompt;
            if (language === 'en') {
                prompt = `You are a VIP guest analyst for a 5-star luxury hotel. A colleague has MANUALLY found additional information about a guest. Your task is to combine this new information with the existing research data to generate a premium report.

GUEST INFO:
Name: ${guest.full_name}
Country: ${guest.country || 'Unknown'}
${guest.notes ? `Hotel notes: ${guest.notes}` : ''}

${existingContext}

NEW MANUALLY FOUND INFORMATION (PRIORITY):
${customInput}

INSTRUCTIONS:
1. The NEW MANUAL INFORMATION is leading and often more current or specific.
2. Write factually and professionally. NO SPECULATION or fluff.
3. NO NULL: Never use the word "null" in descriptive texts. If information is missing, leave it out so it reads naturally.
4. NUMBERS: Format numbers compactly (e.g., 10k, 5m).
5. PERSONALIZED RECOMMENDATIONS: Make these very specific and extensive based on all info.
6. Write in professional English.
7. The report must be very detailed for hotel management.

Generate a DETAILED JSON response:
{
  "vip_score": [updated 1-10 score],
  "industry": "[sector]",
  "company_size": "[Micro/Small/Medium/Large]",
  "is_owner": [true/false/null],
  "employment_type": "[Owner/CEO/Director/Manager/etc]",
  "notable_info": "[short updated summary, max 150 chars]",
  "influence_level": "[Low/Medium/High/VIP]",
  "net_worth_estimate": "[updated estimated wealth if applicable]",
  "full_report": {
    "executive_summary": "[new summary]",
    "professional_background": {
      "current_role": "[details]",
      "career_trajectory": "[details]",
      "industry_expertise": "[details]",
      "notable_achievements": "[details]"
    },
    "company_analysis": {
      "company_name": "[company name]",
      "company_description": "[details]",
      "company_position": "[details]",
      "estimated_revenue": "[details]",
      "employee_count": "[details]"
    },
    "vip_indicators": {
      "wealth_signals": "[details]",
      "influence_factors": "[details]",
      "status_markers": "[details]"
    },
    "service_recommendations": {
      "priority_level": "[Standard/Elevated/VIP/Ultra-VIP]",
      "quick_win": "[Most impactful direct action]",
      "categories": [
        {
          "title": "Combined Insights",
          "items": ["[item]", "[item]"]
        },
        {
          "title": "New Opportunities",
          "items": ["[item]", "[item]"]
        }
      ]
    },
    "additional_notes": "[combined extra relevant information]"
  }
}`;
            } else {
                prompt = `Je bent een VIP-gastanalist voor een 5-sterren luxe hotel. Een collega heeft HANDMATIG aanvullende informatie gevonden over een gast. Jouw taak is om deze nieuwe informatie te combineren met de bestaande research data om een premium rapport te genereren.

GASTINFORMATIE:
Naam: ${guest.full_name}
Land: ${guest.country || 'Onbekend'}
${guest.notes ? `Hotel opmerkingen: ${guest.notes}` : ''}

${existingContext}

NIEUWE HANDMATIG GEVONDEN INFORMATIE (PRIORITEIT):
${customInput}

INSTRUCTIES:
1. De NIEUWE HANDMATIGE INFORMATIE is leidend en vaak actueler of specifieker.
2. Schrijf feitelijk en zakelijk. GEEN SPECULATIE of fluff.
3. GEEN NULL: Gebruik nooit het woord "null" in de beschrijvende teksten. Als informatie ontbreekt, laat het weg uit het verhaal zodat het natuurlijk leest.
4. GETALLEN: Formatteer getallen compact (bijv. 10k, 5m).
5. GEPERSONALISEERDE AANBEVELINGEN: Maak deze zeer specifiek en uitgebreid gebaseerd op alle info.
6. Schrijf in professioneel Nederlands.
7. Het rapport moet zeer gedetailleerd zijn voor hotel management.

Genereer een GEDETAILLEERD JSON-antwoord:
{
  "vip_score": [bijgewerkte 1-10 score],
  "industry": "[sector]",
  "company_size": "[Micro/Klein/Middelgroot/Groot]",
  "is_owner": [true/false/null],
  "employment_type": "[Eigenaar/CEO/Directeur/Manager/etc]",
  "notable_info": "[korte bijgewerkte samenvatting, max 150 tekens]",
  "influence_level": "[Laag/Gemiddeld/Hoog/VIP]",
  "net_worth_estimate": "[bijgewerkt geschat vermogen if applicable]",
  "full_report": {
    "executive_summary": "[nieuwe samenvatting]",
    "professional_background": {
      "current_role": "[details]",
      "career_trajectory": "[details]",
      "industry_expertise": "[details]",
      "notable_achievements": "[details]"
    },
    "company_analysis": {
      "company_name": "[bedrijfsnaam]",
      "company_description": "[details]",
      "company_position": "[details]",
      "estimated_revenue": "[details]",
      "employee_count": "[details]"
    },
    "vip_indicators": {
      "wealth_signals": "[details]",
      "influence_factors": "[details]",
      "status_markers": "[details]"
    },
    "service_recommendations": {
      "priority_level": "[Standaard/Verhoogd/VIP/Ultra-VIP]",
      "quick_win": "[Meest impactvolle directe actie]",
      "categories": [
        {
          "title": "Gecombineerde Inzichten",
          "items": ["[item]", "[item]"]
        },
        {
          "title": "Nieuwe Kansen",
          "items": ["[item]", "[item]"]
        }
      ]
    },
    "additional_notes": "[gecombineerde extra relevante informatie]"
  }
}`;
            }

            const response = await openai.chat.completions.create({
                model: 'gpt-4o', // Use GPT-4o for more critical custom analysis
                messages: [
                    { role: 'system', content: language === 'en' ? 'You are an expert VIP guest analyst. You integrate manual data with automatic research into a premium guest report.' : 'Je bent een expert VIP-gastanalist. Je integreert handmatige data met automatische research tot een premium gastrapport.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 2500,
                response_format: { type: "json_object" }
            });

            const content = response.choices[0]?.message?.content;
            if (!content) return null;

            return JSON.parse(content);
        } catch (error) {
            console.error('Custom AI analysis error:', error);
            return null;
        }
    }

    /**
     * Basic analysis when AI is not available
     */
    basicAnalysis(linkedinInfo, celebrityInfo = null) {
        // Celebrities get higher base score
        const baseScore = celebrityInfo?.isCelebrity ? 8 : 5;
        const influenceLevel = celebrityInfo?.isCelebrity ? 'VIP' : 'Gemiddeld';

        if (linkedinInfo?.bestMatch) {
            return {
                vip_score: celebrityInfo?.isCelebrity ? 9 : 6,
                industry: celebrityInfo?.category || null,
                notable_info: celebrityInfo?.knownFor || linkedinInfo.bestMatch.snippet?.substring(0, 150),
                influence_level: influenceLevel,
                net_worth_estimate: null
            };
        }
        return {
            vip_score: baseScore,
            industry: celebrityInfo?.category || null,
            notable_info: celebrityInfo?.knownFor || null,
            influence_level: influenceLevel,
            net_worth_estimate: null
        };
    }

    /**
     * Use AI to detect if a person is a public figure based on early broad search results.
     * This helps distinguish between famous people and regular namesakes.
     */
    async detectCelebrityWithAI(guest, broadResults) {
        if (!broadResults || broadResults.length === 0) return null;

        const openai = this.getOpenAI();
        if (!openai) return null;

        try {
            const resultsText = broadResults.map((r, i) =>
                `Result ${i}: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.link}`
            ).join('\n\n');

            const prompt = `Analyze these search results for "${guest.full_name}" from "${guest.country || 'Unknown'}".

Determine if this person is a WIDELY KNOWN Public Figure.

SEARCH RESULTS:
${resultsText}

CRITICAL RULES - BE CONSERVATIVE:
- ONLY return isPublicFigure=true for people who are genuinely famous (actors, musicians, top athletes, major politicians, TV presenters with NATIONAL recognition).
- Business executives, CEOs, entrepreneurs are NOT public figures (even if they have Wikipedia).
- Local politicians, city council members are NOT public figures.
- Former sports club directors, football managers are NOT public figures.
- Authors, academics, scientists are usually NOT public figures (unless household names).
- If unsure, return isPublicFigure=false.
- Wikipedia article is NOT sufficient alone - they need to be genuinely famous/recognizable.
- Strong indicators: IMDb profile, verified social media with 100k+ followers, multiple entertainment news sources.

Return JSON:
{
  "isPublicFigure": boolean (true ONLY for genuine celebrities that most people would recognize),
  "confidence": number (0-1, be conservative - only 0.9+ for truly famous people),
  "category": string (e.g. 'entertainment', 'sports', 'business', 'none'),
  "knownFor": string (short description),
  "reason": string (short explanation)
}`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are an expert in identifying genuinely famous public figures. Be VERY conservative - only flag true celebrities that most people would recognize.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message.content);

            // Increased threshold from 0.7 to 0.85 to be more conservative
            if (result.isPublicFigure && result.confidence >= 0.85) {
                console.log(`🌟 AI detected Public Figure: ${guest.full_name} (${result.knownFor}) - Conf: ${result.confidence}`);
                return {
                    isCelebrity: true,
                    confidence: result.confidence,
                    category: result.category,
                    knownFor: result.knownFor,
                    source: 'ai_early_detection'
                };
            }

            return null;
        } catch (error) {
            console.error('Error in early celebrity detection:', error);
            return null;
        }
    }

    /**
     * ULTIMATE FINDER - Main search function for guest research
     * Strategy: Collect EVERYTHING first, then analyze
     * 
     * 1. Knowledge Graph (Celebrity/Alias Detection)
     * 2. Generate 25-30 AI-powered queries
     * 3. Execute ALL queries on Google
     * 4. Extract platforms from results
     * 5. AI analyzes ALL data together
     */
    async searchGuest(guest, options = {}) {
        // Extract language from options (default to 'nl' for Dutch)
        const language = options.language || 'nl';
        console.log(`\n🚀 ========== FAST FINDER: ${guest.full_name} ==========`);
        console.log(`🌐 Output language: ${language}`);
        const startTime = Date.now();

        // ============================================
        // SONAR MODE: Try to do everything in 1 API call
        // ============================================
        if (perplexitySearch.isAvailable()) {
            perplexitySearch.initialize();

            console.log('🔮 Using Sonar (all-in-one search + analysis)...');
            const sonarResult = await perplexitySearch.analyzeWithSonar(guest, { language });

            if (sonarResult) {
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`🏁 SONAR complete in ${duration}s - VIP Score: ${sonarResult.vipScore}`);

                // Return Sonar result in our standard format
                return {
                    profilePhotoUrl: null,
                    jobTitle: sonarResult.jobTitle,
                    companyName: sonarResult.company,
                    companySize: null,
                    isOwner: false,
                    ownerReason: null,
                    companyOwnershipLabel: null,
                    companyOwnershipConfidence: null,
                    companyOwnershipReason: null,
                    companyOwnershipDetermination: null,
                    employmentType: null,
                    industry: sonarResult.celebrityCategory !== 'none' ? sonarResult.celebrityCategory : null,
                    linkedinUrl: sonarResult.linkedinUrl,
                    linkedinConnections: null,
                    linkedinCandidates: [],
                    needsLinkedInReview: false,
                    instagramUrl: sonarResult.instagramUrl,
                    instagramHandle: sonarResult.instagramHandle,
                    instagramFollowers: null,
                    instagramBio: null,
                    instagramLocation: null,
                    twitterUrl: sonarResult.twitterUrl,
                    twitterHandle: sonarResult.twitterHandle,
                    twitterFollowers: null,
                    twitterBio: null,
                    twitterLocation: null,
                    twitterMemberSince: null,
                    socialMediaLocation: sonarResult.location,
                    effectiveCountry: guest.country || sonarResult.location,
                    facebookUrl: null,
                    youtubeUrl: null,
                    websiteUrl: sonarResult.sources?.[0] || null,
                    notableInfo: sonarResult.notableInfo,
                    fullReport: {
                        executive_summary: sonarResult.notableInfo || `${guest.full_name} is ${sonarResult.jobTitle ? sonarResult.jobTitle : 'een professional'} ${sonarResult.company ? 'bij ' + sonarResult.company : ''}.`,
                        professional_background: {
                            current_role: sonarResult.jobTitle || null,
                            career_trajectory: sonarResult.knownFor || null,
                            industry_expertise: sonarResult.celebrityCategory !== 'none' ? sonarResult.celebrityCategory : null,
                            notable_achievements: sonarResult.vipReason || null
                        },
                        company_analysis: {
                            company_name: sonarResult.company || null,
                            company_type: sonarResult.companyType || null,
                            company_description: sonarResult.companyDescription || null,
                            ownership_likelihood: sonarResult.ownershipLikelihood || null,
                            company_position: null,
                            employee_count: null
                        },
                        vip_indicators: {
                            wealth_signals: sonarResult.ownershipLikelihood === 'high' ? 'Waarschijnlijk eigenaar/beslisser' : (sonarResult.vipScore >= 8 ? 'Significante indicaties van vermogen' : null),
                            influence_factors: sonarResult.vipReason || null,
                            status_markers: sonarResult.isCelebrity ? `Bekend als ${sonarResult.celebrityCategory}` : (sonarResult.ownershipLikelihood === 'high' ? 'Besluitvormer / Eigenaar' : null)
                        },
                        service_recommendations: {
                            priority_level: sonarResult.vipScore >= 9 ? 'Ultra-VIP' : sonarResult.vipScore >= 7 ? 'VIP' : sonarResult.vipScore >= 5 ? 'Verhoogd' : 'Standaard',
                            quick_win: sonarResult.ownershipLikelihood === 'high' && sonarResult.company
                                ? `Als ondernemer van ${sonarResult.company} - vraag naar hun bedrijf en ervaringen`
                                : (sonarResult.company ? `Verwelkom bij naam en toon interesse in ${sonarResult.company}` : null),
                            categories: []
                        },
                        additional_notes: sonarResult.sources?.length > 0 ? `Bronnen: ${sonarResult.sources.join(', ')}` : null,
                        vip_reason: sonarResult.vipReason,
                        sources: sonarResult.sources,
                        confidence: sonarResult.confidenceScore
                    },
                    pressMentions: null,
                    netWorthEstimate: null,
                    followersEstimate: null,
                    vipScore: sonarResult.vipScore,
                    influenceLevel: sonarResult.vipScore >= 9 ? 'VIP' : sonarResult.vipScore >= 7 ? 'Hoog' : sonarResult.vipScore >= 4 ? 'Gemiddeld' : 'Laag',
                    isCelebrity: sonarResult.isCelebrity,
                    celebrityCategory: sonarResult.celebrityCategory,
                    rawResults: [{ type: 'sonar_analysis', data: sonarResult }],
                    emailDomainInfo: null,
                    newsArticles: [],
                    confidenceScores: { overall: sonarResult.confidenceScore },
                    noResultsFound: !sonarResult.jobTitle && !sonarResult.company && !sonarResult.linkedinUrl
                };
            }

            console.log('⚠️ Sonar failed, falling back to traditional flow...');
        }

        // ============================================
        // FALLBACK: Traditional multi-step flow (if Sonar unavailable/fails)
        // ============================================
        let celebrityInfo = { isCelebrity: false, confidence: 0, category: null, knownFor: null };
        let linkedinInfo = { candidates: [], bestMatch: null, needsReview: false };
        let fallbackMatch = null;

        // Email Domain Analysis
        let emailDomainInfo = null;
        let effectiveCompany = guest.company;

        if (guest.email && !guest.company) {
            console.log('📧 Analyzing email domain...');
            emailDomainInfo = await this.extractCompanyFromEmail(guest);
            if (emailDomainInfo && emailDomainInfo.companyName) {
                effectiveCompany = emailDomainInfo.companyName;
                console.log(`   ✅ Found company from email: ${effectiveCompany}`);
            }
        }

        if (!guest.company && effectiveCompany) {
            guest.company = effectiveCompany;
        }

        // Initialize search state
        const allResults = [];
        const seenUrls = new Set();
        let linkedInFound = false;

        // --- STEP 1: PARALLEL DISCOVERY ---
        // Run Perplexity Search AND an initial Google probe Query simultaneously
        // This saves ~8-12s in the traditional flow
        console.log(`🔍 Starting parallel discovery for ${guest.full_name}...`);

        const discoveryPromises = [];

        // 1. Perplexity Search
        if (perplexitySearch.isAvailable()) {
            discoveryPromises.push(perplexitySearch.searchPerson(guest).then(res => ({ source: 'perplexity', data: res })));
        }

        // 2. Initial Google Probe (Exact Name)
        discoveryPromises.push(googleSearch.search(`"${guest.full_name}"`, 10).then(res => ({ source: 'google', data: res })));

        const discoveryResults = await Promise.allSettled(discoveryPromises);

        // Process results from both sources
        for (const res of discoveryResults) {
            if (res.status === 'fulfilled' && res.value.data) {
                const source = res.value.source;
                const items = source === 'perplexity' ? res.value.data.results : res.value.data;

                if (items && Array.isArray(items)) {
                    for (const result of items) {
                        const link = result.link || result.url;
                        if (link && !seenUrls.has(link)) {
                            seenUrls.add(link);
                            allResults.push({ ...result, link });
                            if (link.includes('linkedin.com/in/')) {
                                linkedInFound = true;
                                console.log(`   ✅ LinkedIn found via ${source}: ${link}`);
                            }
                        }
                    }
                }
            }
        }

        console.log(`📊 Discovery phase complete: ${allResults.length} unique results found (LinkedIn: ${linkedInFound ? '✓' : '✗'})`);

        // AI Celebrity Detection - ONLY if no LinkedIn found
        // LinkedIn always takes priority over celebrity assumptions
        if (!linkedInFound) {
            const aiDetection = await this.detectCelebrityWithAI(guest, allResults);
            // Require 0.9+ confidence AND a name match in results to activate celebrity mode
            if (aiDetection && aiDetection.isCelebrity && aiDetection.confidence >= 0.9) {
                // Check if the primary name or aliases are actually present in our search results snippets
                const primaryNameLower = aiDetection.primaryName?.toLowerCase();
                const someResultsMatch = allResults.some(r =>
                    (r.title + ' ' + (r.snippet || '')).toLowerCase().includes(primaryNameLower) ||
                    (r.title + ' ' + (r.snippet || '')).toLowerCase().includes(guest.full_name.toLowerCase())
                );

                if (someResultsMatch) {
                    celebrityInfo = aiDetection;
                    console.log(`🌟 Confirmed Public Figure FOUND in results. Skipping deep person-search to avoid namesake mismatches.`);
                } else {
                    console.log(`⚠️ AI thinks it's a celebrity (${aiDetection.primaryName}), but no matching results found. Continuing deep search.`);
                }
            }
        } else {
            console.log(`📋 LinkedIn found - skipping celebrity detection (LinkedIn takes priority)`);
        }

        // ============================================
        // STEP 2: GOOGLE BACKUP - Always run if no LinkedIn found
        // This catches people Perplexity might miss
        // ============================================
        if (!linkedInFound && !celebrityInfo.isCelebrity) {
            console.log('🔍 Step 2: Running Google SERP backup (Perplexity might have missed results)...');

            // Query 1: Exact name like Google does
            const exactNameQuery = `"${guest.full_name}"`;
            const googleResults = await googleSearch.search(exactNameQuery, 10);

            if (googleResults && googleResults.length > 0) {
                let newResultsCount = 0;
                for (const result of googleResults) {
                    if (result.link && !seenUrls.has(result.link)) {
                        seenUrls.add(result.link);
                        allResults.push(result);
                        newResultsCount++;
                        if (result.link.includes('linkedin.com/in/')) {
                            linkedInFound = true;
                            console.log(`   ✅ LinkedIn found via Google: ${result.link}`);
                        }
                    }
                }
                if (newResultsCount > 0) {
                    console.log(`   📊 Google added ${newResultsCount} new results`);
                }
            }

            // Query 2: LinkedIn specific if still not found
            if (!linkedInFound) {
                const linkedInQuery = `site:linkedin.com/in "${guest.full_name}"`;
                const linkedInResults = await googleSearch.search(linkedInQuery, 5);

                if (linkedInResults && linkedInResults.length > 0) {
                    for (const result of linkedInResults) {
                        if (result.link && !seenUrls.has(result.link)) {
                            seenUrls.add(result.link);
                            allResults.push(result);
                            if (result.link.includes('linkedin.com/in/')) {
                                linkedInFound = true;
                                console.log(`   ✅ LinkedIn profile found: ${result.link}`);
                            }
                        }
                    }
                }
            }
        }

        // Check if we found anything at all
        if (allResults.length === 0) {
            console.log('⚠️ Discovery and backup searches failed to find any results.');
        }

        // Fallback: if nothing found, try 1-2 generic queries
        if (allResults.length === 0) {
            console.log('⚠️ No results found, trying fallback queries...');
            const fallbackQueries = [];

            // Add country-specific fallback queries
            if (guest.country) {
                const countryTerms = this.getCountrySearchTerms(guest.country);
                countryTerms.forEach(term => {
                    fallbackQueries.push(`"${guest.full_name}" ${term}`.trim());
                });
            } else {
                fallbackQueries.push(`"${guest.full_name}" ${guest.country || ''}`.trim());
            }

            if (effectiveCompany) {
                fallbackQueries.push(`"${guest.full_name}" ${effectiveCompany}`);
            }

            const finalFallbackQueries = fallbackQueries.filter(Boolean).slice(0, 2);

            for (const query of finalFallbackQueries) {
                try {
                    console.log(`   🔎 Fallback: ${query.substring(0, 60)}...`);
                    const results = await googleSearch.search(query, 3);
                    for (const result of (results || [])) {
                        if (result.link && !seenUrls.has(result.link)) {
                            seenUrls.add(result.link);
                            allResults.push(result);
                        }
                    }
                    if (allResults.length > 0) break; // Stop if we found something
                    await delay(1500);
                } catch (error) {
                    console.error(`   ⚠️ Fallback query failed`);
                }
            }
        }

        console.log(`✅ Collected ${allResults.length} unique results`);

        if (allResults.length === 0) {
            console.error('❌ CRITICAL: No search results found at all!');
        }

        // ============================================
        // STEP 4: Extract Platform-Specific Profiles
        // ============================================
        console.log('🎯 Step 4: Extracting platform profiles...');
        const platforms = this.extractPlatformProfiles(allResults);

        console.log(`   📊 LinkedIn: ${platforms.linkedin.length} profiles`);
        console.log(`   📊 Facebook: ${platforms.facebook.length} profiles`);
        console.log(`   📊 GitHub: ${platforms.github.length} profiles`);
        console.log(`   📊 Twitter: ${platforms.twitter.length} profiles`);
        console.log(`   📊 Instagram: ${platforms.instagram.length} profiles`);
        console.log(`   📊 News: ${platforms.news.length} articles`);
        console.log(`   📊 Websites: ${platforms.websites.length} found`);

        // ============================================
        // STEP 5: Find Best LinkedIn Match
        // ============================================
        // FAST PATH: If we have a LinkedIn with exact name match in title, skip AI
        // BUT: Also check location to avoid wrong-country matches
        const guestNameLower = guest.full_name.toLowerCase();
        const guestCountryLower = (guest.country || '').toLowerCase();

        // Location mismatch keywords - if snippet contains these but doesn't match guest country, reject
        const usLocations = ['chicago', 'new york', 'los angeles', 'san francisco', 'boston', 'miami', 'seattle', 'denver', 'austin', 'dallas', 'houston', 'atlanta', 'phoenix', 'philadelphia', 'california', 'texas', 'florida', 'united states', 'usa', 'u.s.', 'america'];
        const ukLocations = ['london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'liverpool', 'edinburgh', 'united kingdom', 'uk', 'britain'];
        const uaeLocations = ['dubai', 'abu dhabi', 'uae', 'united arab emirates', 'sharjah', 'ajman'];
        const gulfLocations = ['saudi arabia', 'qatar', 'bahrain', 'kuwait', 'oman', 'riyadh', 'doha', 'jeddah'];
        const egyptLocations = ['egypt', 'cairo', 'alexandria', 'giza', 'egyptian'];
        const middleEastLocations = [...uaeLocations, ...gulfLocations]; // Combine for backward compatibility

        const perfectLinkedIn = platforms.linkedin.find(r => {
            const titleLower = (r.title || '').toLowerCase();
            const snippetLower = (r.snippet || '').toLowerCase();
            const linkLower = (r.link || '').toLowerCase();
            const nameMatches = titleLower.includes(guestNameLower) && r.link.includes('linkedin.com/in/');

            if (!nameMatches) return false;

            // Universal location check: If guest has a country, verify the location matches
            if (guestCountryLower) {
                // FIRST: Check LinkedIn URL prefix (uk.linkedin.com, ca.linkedin.com, etc.)
                const urlCountryMatch = linkLower.match(/^https?:\/\/([a-z]{2})\.linkedin\.com/);
                const urlCountryCode = urlCountryMatch ? urlCountryMatch[1] : null;

                // Map country codes to regions
                const usUrlCodes = ['us', 'www']; // www is usually US
                const ukUrlCodes = ['uk', 'gb'];
                const euUrlCodes = ['nl', 'be', 'de', 'fr', 'es', 'it', 'pt', 'at', 'ch'];
                const meUrlCodes = ['ae', 'sa', 'qa', 'bh', 'kw', 'om'];

                const guestIsUAE = guestCountryLower.includes('emirates') || guestCountryLower.includes('uae') || guestCountryLower.includes('dubai');
                const guestIsUS = guestCountryLower.includes('united states') || guestCountryLower.includes('usa') || guestCountryLower.includes('america');
                const guestIsUK = guestCountryLower.includes('kingdom') || guestCountryLower.includes('uk') || guestCountryLower.includes('britain');
                const guestIsEU = ['netherlands', 'nederland', 'belgium', 'belgië', 'germany', 'deutschland', 'france', 'spain', 'italy'].some(c => guestCountryLower.includes(c));

                // URL prefix-based filtering (most reliable)
                if (urlCountryCode) {
                    if (guestIsUAE && (usUrlCodes.includes(urlCountryCode) || ukUrlCodes.includes(urlCountryCode))) {
                        console.log(`⚠️ LinkedIn SKIPPED (${urlCountryCode}.linkedin.com for UAE guest): ${r.link}`);
                        return false;
                    }
                    if (guestIsUS && (meUrlCodes.includes(urlCountryCode) || ukUrlCodes.includes(urlCountryCode))) {
                        console.log(`⚠️ LinkedIn SKIPPED (${urlCountryCode}.linkedin.com for US guest): ${r.link}`);
                        return false;
                    }
                    if (guestIsUK && (usUrlCodes.includes(urlCountryCode) || meUrlCodes.includes(urlCountryCode))) {
                        console.log(`⚠️ LinkedIn SKIPPED (${urlCountryCode}.linkedin.com for UK guest): ${r.link}`);
                        return false;
                    }
                    if (guestIsEU && usUrlCodes.includes(urlCountryCode)) {
                        console.log(`⚠️ LinkedIn SKIPPED (${urlCountryCode}.linkedin.com for EU guest): ${r.link}`);
                        return false;
                    }
                }

                // SECOND: Check snippet content for location indicators
                const snippetHasUSLocation = usLocations.some(loc => snippetLower.includes(loc));
                const snippetHasUKLocation = ukLocations.some(loc => snippetLower.includes(loc));
                const snippetHasMiddleEastLocation = middleEastLocations.some(loc => snippetLower.includes(loc));
                const snippetHasEgyptLocation = egyptLocations.some(loc => snippetLower.includes(loc));
                const snippetHasUAELocation = uaeLocations.some(loc => snippetLower.includes(loc));

                const guestIsEgypt = guestCountryLower.includes('egypt') || guestCountryLower.includes('egypte');

                if (guestIsUAE) {
                    if (snippetHasUSLocation || snippetHasUKLocation || snippetHasEgyptLocation) {
                        console.log(`⚠️ LinkedIn SKIPPED (US/UK/Egypt snippet for UAE guest): ${r.link}`);
                        return false;
                    }
                }
                else if (guestIsEgypt) {
                    if (snippetHasUSLocation || snippetHasUKLocation || snippetHasUAELocation) {
                        console.log(`⚠️ LinkedIn SKIPPED (US/UK/UAE snippet for Egypt guest): ${r.link}`);
                        return false;
                    }
                }
                else if (guestIsUS && (snippetHasMiddleEastLocation || snippetHasUKLocation || snippetHasEgyptLocation)) {
                    console.log(`⚠️ LinkedIn SKIPPED (non-US snippet for US guest): ${r.link}`);
                    return false;
                }
                else if (guestIsUK && (snippetHasUSLocation || snippetHasMiddleEastLocation || snippetHasEgyptLocation)) {
                    console.log(`⚠️ LinkedIn SKIPPED (non-UK snippet for UK guest): ${r.link}`);
                    return false;
                }
                else if (guestIsEU && (snippetHasUSLocation || snippetHasEgyptLocation)) {
                    console.log(`⚠️ LinkedIn SKIPPED (US/Egypt snippet for EU guest): ${r.link}`);
                    return false;
                }
                // Generic check for any other country
                else {
                    if (snippetHasUSLocation && !guestCountryLower.includes('state') && !guestCountryLower.includes('usa') && !guestCountryLower.includes('america')) {
                        console.log(`⚠️ LinkedIn SKIPPED (US snippet for ${guest.country} guest): ${r.link}`);
                        return false;
                    }
                }
            }

            return true;
        });

        let aiResult = null;

        if (perfectLinkedIn) {
            // FAST PATH: Skip AI, use title parsing directly
            console.log(`⚡ Fast match: LinkedIn title contains "${guest.full_name}" - skipping AI`);

            // Extract location from snippet for verification
            const snippetLower = (perfectLinkedIn.snippet || '').toLowerCase();
            let extractedLocation = null;

            // Try to extract location from snippet (usually format: "Name. Title. Company. Location.")
            const locationPatterns = [
                /\.\s*([^.]+?),\s*([^.]+?)\.\s*\d+\s*follow/i,  // "City, Country. X followers"
                /\.\s*([^.]+?),\s*([^.]+?)\.\s*\d+\s*connect/i, // "City, Country. X connections"
            ];
            for (const pattern of locationPatterns) {
                const match = perfectLinkedIn.snippet.match(pattern);
                if (match) {
                    extractedLocation = `${match[1]}, ${match[2]}`.trim();
                    break;
                }
            }

            const parsed = this.parseLinkedInTitle(perfectLinkedIn.title, guest.full_name);
            aiResult = {
                url: perfectLinkedIn.link,
                title: perfectLinkedIn.title,
                snippet: perfectLinkedIn.snippet,
                confidence: 0.95,
                extractedJobTitle: parsed?.jobTitle,
                extractedCompany: parsed?.company,
                location: extractedLocation
            };
        } else {
            // Prepare candidates for AI matching (LinkedIn + Broad/Social/Wikipedia)
            const aiCandidates = allResults.filter(r => {
                const link = r.link.toLowerCase();
                const title = (r.title || '').toLowerCase();
                const snippetLower = (r.snippet || '').toLowerCase();
                const nameParts = guest.full_name.toLowerCase().split(' ');
                const matchesName = nameParts.some(part => part.length > 3 && title.includes(part));

                // Skip LinkedIn results with wrong country location
                if (link.includes('linkedin.com/in') && guestCountryLower) {
                    // Check LinkedIn URL prefix for country (uk.linkedin.com, ca.linkedin.com, etc.)
                    const urlCountryMatch = link.match(/^https?:\/\/([a-z]{2})\.linkedin\.com/);
                    const urlCountryCode = urlCountryMatch ? urlCountryMatch[1] : null;

                    // Map country codes to regions
                    const usCountryCodes = ['us', 'www']; // www is usually US
                    const ukCountryCodes = ['uk', 'gb'];
                    const euCountryCodes = ['nl', 'be', 'de', 'fr', 'es', 'it', 'pt', 'at', 'ch'];
                    const meCountryCodes = ['ae', 'sa', 'qa', 'bh', 'kw', 'om'];

                    const guestIsUAE = guestCountryLower.includes('emirates') || guestCountryLower.includes('uae') || guestCountryLower.includes('dubai');
                    const guestIsUS = guestCountryLower.includes('united states') || guestCountryLower.includes('usa') || guestCountryLower.includes('america');
                    const guestIsUK = guestCountryLower.includes('kingdom') || guestCountryLower.includes('uk') || guestCountryLower.includes('britain');
                    const guestIsEU = ['netherlands', 'nederland', 'belgium', 'belgië', 'germany', 'deutschland', 'france', 'spain', 'italy'].some(c => guestCountryLower.includes(c));
                    const guestIsEgypt = guestCountryLower.includes('egypt') || guestCountryLower.includes('egypte');

                    // URL-based filtering
                    if (urlCountryCode) {
                        if (guestIsUAE && (usCountryCodes.includes(urlCountryCode) || ukCountryCodes.includes(urlCountryCode))) {
                            console.log(`⚠️ AI candidate SKIPPED (${urlCountryCode}.linkedin.com for UAE guest): ${link}`);
                            return false;
                        }
                        if (guestIsUS && (meCountryCodes.includes(urlCountryCode) || ukCountryCodes.includes(urlCountryCode))) {
                            console.log(`⚠️ AI candidate SKIPPED (${urlCountryCode}.linkedin.com for US guest): ${link}`);
                            return false;
                        }
                        if (guestIsUK && (usCountryCodes.includes(urlCountryCode) || meCountryCodes.includes(urlCountryCode))) {
                            console.log(`⚠️ AI candidate SKIPPED (${urlCountryCode}.linkedin.com for UK guest): ${link}`);
                            return false;
                        }
                        if (guestIsEU && usCountryCodes.includes(urlCountryCode)) {
                            console.log(`⚠️ AI candidate SKIPPED (${urlCountryCode}.linkedin.com for EU guest): ${link}`);
                            return false;
                        }
                    }

                    // Snippet-based filtering (backup)
                    const snippetHasUSLocation = usLocations.some(loc => snippetLower.includes(loc));
                    const snippetHasUKLocation = ukLocations.some(loc => snippetLower.includes(loc));
                    const snippetHasEgyptLocation = egyptLocations.some(loc => snippetLower.includes(loc));
                    const snippetHasUAELocation = uaeLocations.some(loc => snippetLower.includes(loc));
                    const snippetHasMiddleEastLocation = middleEastLocations.some(loc => snippetLower.includes(loc));

                    if (guestIsUAE) {
                        if (snippetHasUSLocation || snippetHasUKLocation || snippetHasEgyptLocation) {
                            console.log(`⚠️ AI candidate SKIPPED (US/UK/Egypt snippet for UAE guest): ${link}`);
                            return false;
                        }
                    } else if (guestIsEgypt) {
                        if (snippetHasUSLocation || snippetHasUKLocation || snippetHasUAELocation || snippetHasMiddleEastLocation) {
                            console.log(`⚠️ AI candidate SKIPPED (US/UK/Gulf snippet for Egypt guest): ${link}`);
                            return false;
                        }
                    } else if (guestIsEU && (snippetHasUSLocation || snippetHasEgyptLocation)) {
                        console.log(`⚠️ AI candidate SKIPPED (US/Egypt snippet for EU guest): ${link}`);
                        return false;
                    }
                }

                return link.includes('linkedin.com/in') ||
                    link.includes('wikipedia.org') ||
                    link.includes('imdb.com') ||
                    link.includes('instagram.com/') ||
                    link.includes('x.com/') ||
                    link.includes('twitter.com/') ||
                    matchesName;
            }).slice(0, 15);

            console.log(`🤖 AI Matching: Analyzing ${aiCandidates.length} potential matches (LinkedIn and Broad search)...`);
            aiResult = await this.selectBestMatchWithAI(guest, aiCandidates, celebrityInfo);
        }

        if (aiResult && aiResult.confidence >= 0.6) {
            const isLinkedIn = aiResult.url?.includes('linkedin.com/in/');

            // CRITICAL: Verify location matches guest's country BEFORE extracting any data
            let locationMismatch = false;
            if (guest.country && aiResult.location) {
                const locationMatches = this.verifyLocationMatch(aiResult.location, guest.country);
                if (!locationMatches) {
                    console.log(`❌ Match SKIPPED (wrong country): "${aiResult.location}" - Guest country: "${guest.country}"`);
                    locationMismatch = true;
                }
            }

            // COMPANY MISMATCH CHECK: If we know company from email, verify the found profile matches
            let companyMismatch = false;
            if (emailDomainInfo && emailDomainInfo.companyName && aiResult.company) {
                const emailCompanyLower = emailDomainInfo.companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
                const foundCompanyLower = aiResult.company.toLowerCase().replace(/[^a-z0-9]/g, '');

                // Check if companies are similar (allowing for variations like "Know Your VIP" vs "KnowYourVIP")
                const emailCompanyWords = emailDomainInfo.companyName.toLowerCase().split(/\s+/);
                const foundCompanyWords = aiResult.company.toLowerCase().split(/\s+/);

                // Check for any word overlap or substring match
                const hasOverlap = emailCompanyWords.some(word =>
                    word.length > 3 && (foundCompanyLower.includes(word) || emailCompanyLower.includes(foundCompanyWords.find(w => w.length > 3) || ''))
                );

                const isSubstring = emailCompanyLower.includes(foundCompanyLower) || foundCompanyLower.includes(emailCompanyLower);

                if (!hasOverlap && !isSubstring && emailCompanyLower !== foundCompanyLower) {
                    console.log(`❌ Match SKIPPED (company mismatch): Email says "${emailDomainInfo.companyName}" but profile shows "${aiResult.company}"`);
                    console.log(`   📧 Email domain company is trusted as primary source (80%+ accuracy)`);
                    companyMismatch = true;
                }
            }

            // Only process if location AND company match (or no constraints)
            if (!locationMismatch && !companyMismatch) {
                console.log(`✨ Match found! ${isLinkedIn ? '(LinkedIn)' : '(Broad Search)'} - Conf: ${Math.round(aiResult.confidence * 100)}%`);

                if (isLinkedIn) {
                    // Extract job title and company
                    let extractedJobTitle = aiResult.jobTitle;
                    let extractedCompany = aiResult.company;

                    const parsed = this.parseLinkedInTitle(aiResult.title, guest.full_name);
                    if (parsed) {
                        if (parsed.jobTitle) extractedJobTitle = parsed.jobTitle;
                        if (parsed.company) extractedCompany = parsed.company;
                    }

                    linkedinInfo.bestMatch = {
                        url: aiResult.url,
                        title: aiResult.title,
                        snippet: aiResult.snippet,
                        jobTitle: extractedJobTitle || aiResult.extractedJobTitle,
                        company: extractedCompany || aiResult.extractedCompany
                    };
                } else {
                    // It's a broad search match (Wikipedia, Official site, etc.)
                    fallbackMatch = aiResult;
                }

                linkedinInfo.candidates = platforms.linkedin.map(r => ({
                    url: r.link,
                    title: r.title,
                    snippet: r.snippet
                }));
            }
        }

        // ============================================
        // STEP 6: Find Best Non-LinkedIn Match (if no LinkedIn and not already matched)
        // ============================================
        if (!linkedinInfo.bestMatch && !fallbackMatch && platforms.websites.length > 0) {
            console.log('🌐 Step 6: Analyzing alternative profiles...');
            let nonLinkedIn = [...platforms.websites, ...platforms.news];

            // Filter by country if specified
            if (guest.country && nonLinkedIn.length > 0) {
                const beforeCount = nonLinkedIn.length;
                nonLinkedIn = this.filterResultsByCountry(nonLinkedIn, guest.country);
                const afterCount = nonLinkedIn.length;
                if (beforeCount !== afterCount) {
                    console.log(`   🌍 Filtered alternative results by country (${guest.country}): ${beforeCount} → ${afterCount}`);
                }
            }

            if (nonLinkedIn.length > 0) {
                const aiResult = await this.selectBestMatchWithAI(guest, nonLinkedIn, celebrityInfo);
                if (aiResult && aiResult.confidence >= 0.7) {
                    console.log(`✨ Alternative match found: ${aiResult.url}`);
                    fallbackMatch = aiResult;
                }
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n🏁 FAST FINDER complete in ${duration}s`);
        console.log(`   Results: ${allResults.length} | LinkedIn: ${linkedinInfo.bestMatch ? '✓' : '✗'}`);
        console.log(`========================================================\n`);

        // Pass emailDomainInfo to finalizeResearch so it doesn't run again
        return this.finalizeResearch(guest, linkedinInfo, celebrityInfo, fallbackMatch, allResults, emailDomainInfo, language);
    }

    /**
     * Extract platform-specific profiles from search results
     * Categorizes results by platform for targeted analysis
     */
    extractPlatformProfiles(results) {
        const isNewsSource = (url) => {
            const newsDomains = ['reuters.com', 'bloomberg.com', 'forbes.com', 'businessinsider.com',
                'techcrunch.com', 'theguardian.com', 'bbc.com', 'cnn.com', 'nytimes.com', 'wsj.com',
                'news.google.com', 'finance.yahoo.com', 'cnbc.com', 'nos.nl', 'rtv.nl', 'ad.nl',
                'telegraaf.nl', 'volkskrant.nl', 'nu.nl', 'rtlnieuws.nl'];
            return newsDomains.some(domain => url?.toLowerCase().includes(domain));
        };

        const isSocialMedia = (url) => {
            const socialDomains = ['linkedin.com', 'facebook.com', 'twitter.com', 'x.com',
                'instagram.com', 'tiktok.com', 'youtube.com', 'github.com'];
            return socialDomains.some(domain => url?.toLowerCase().includes(domain));
        };

        return {
            linkedin: results.filter(r =>
                r.link?.includes('linkedin.com/in/') &&
                !r.link?.includes('/posts/') &&
                !r.link?.includes('/pulse/')
            ),
            facebook: results.filter(r =>
                r.link?.includes('facebook.com/') &&
                !r.link?.includes('/posts/') &&
                !r.link?.includes('/photos/') &&
                !r.link?.includes('/events/')
            ),
            github: results.filter(r =>
                r.link?.includes('github.com/') &&
                !r.link?.includes('/issues/') &&
                !r.link?.includes('/pull/')
            ),
            twitter: results.filter(r =>
                (r.link?.includes('twitter.com/') || r.link?.includes('x.com/')) &&
                !r.link?.includes('/status/')
            ),
            instagram: results.filter(r =>
                r.link?.includes('instagram.com/') &&
                !r.link?.includes('/p/') &&
                !r.link?.includes('/reel/')
            ),
            youtube: results.filter(r =>
                r.link?.includes('youtube.com/') &&
                (r.link?.includes('/@') || r.link?.includes('/c/') || r.link?.includes('/user/'))
            ),
            news: results.filter(r => isNewsSource(r.link)),
            websites: results.filter(r =>
                r.link &&
                !isSocialMedia(r.link) &&
                !isNewsSource(r.link) &&
                !r.link?.includes('wikipedia.org')
            )
        };
    }

    /**
     * Helper to wrap up the research process
     */
    async finalizeResearch(guest, linkedinInfo, celebrityInfo, fallbackMatch, allResults = [], emailDomainInfoFromSearch = null, language = 'nl') {
        // Initialize results with defaults
        let instagramResult = { url: null, handle: null, followers: null };
        let twitterResult = { url: null, handle: null, followers: null };
        let newsInfo = { articles: [], results: [] };

        // SPEED: Deep scraping DISABLED - wastes 15+ seconds and usually times out anyway
        // The AI already has enough context from search snippets
        // if (fallbackMatch && fallbackMatch.url && !fallbackMatch.url.includes('linkedin.com') && !celebrityInfo.isCelebrity) {
        //     const deepContent = await googleSearch.fetchPageContent(fallbackMatch.url, 8000);
        //     if (deepContent) {
        //         fallbackMatch.deepContent = deepContent;
        //     }
        // }

        // ============================================
        // STEP 3: Email Domain Analysis (skip if already done in searchGuest)
        // ============================================
        let emailDomainInfo = emailDomainInfoFromSearch;
        if (!emailDomainInfo && guest.email) {
            console.log('📧 Running email domain analysis (not done earlier)...');
            emailDomainInfo = await this.extractCompanyFromEmail(guest);
        }

        // Note: celebrityInfo is already fetched at the start of searchGuest and passed here
        // -----------------------------------------------
        // STEP 2: CELEBRITY DETECTION (EARLY EXIT)
        // -----------------------------------------------
        // If we are 100% sure it is a celebrity (e.g. via Knowledge Graph), we might skip detailed LinkedIn hunting
        // or ensure we only accept social accounts that MATCH that celebrity status.

        if (celebrityInfo.isCelebrity && celebrityInfo.confidence >= 0.9) {
            console.log(`🌟 Confirmed Celebrity: ${guest.full_name} (${celebrityInfo.knownFor}). Adjusting search strategy...`);
            // We can still try to find socials, but we must be VERY STRICT.
        }

        // ============================================
        // STEP 3: SOCIAL MEDIA DISCOVERY
        // ============================================
        // BUSINESS RULE: Skip social media for standard business people.
        // Their Instagram/Twitter is likely personal and not useful for hotel staff.
        // Only search socials for:
        // - Confirmed celebrities (entertainment, sports, media)
        // - People with public online presence (high VIP score indicators)

        const hasCompanyFromEmail = Boolean(emailDomainInfo?.companyName);
        let shouldSearchSocials = this.shouldSearchSocialMedia(celebrityInfo, linkedinInfo, { hasCompanyFromEmail });

        // STRICT RULE: If LinkedIn OR any confident match is found, skip social media to reduce noise
        if (linkedinInfo.bestMatch || fallbackMatch) {
            console.log(`📋 Profile found - Skipping social media search to reduce noise.`);
            shouldSearchSocials = false;
        }

        // TRY TO REUSE PROBE DATA FIRST (no new searches if found)
        if (allResults.length > 0) {
            let profiles = this.extractPlatformProfiles(allResults);

            // Filter all platform profiles by country if specified
            if (guest.country) {
                Object.keys(profiles).forEach(platform => {
                    if (Array.isArray(profiles[platform]) && profiles[platform].length > 0 && platform !== 'websites' && platform !== 'news') {
                        const before = profiles[platform].length;
                        profiles[platform] = this.filterResultsByCountry(profiles[platform], guest.country);
                        const after = profiles[platform].length;
                        if (before !== after) {
                            console.log(`   🌍 Filtered ${platform} results by country (${guest.country}): ${before} → ${after}`);
                        }
                    }
                });
            }

            // STRICT: Only reuse if URL actually contains instagram.com
            if (profiles.instagram.length > 0 && profiles.instagram[0].link?.includes('instagram.com')) {
                const bestInsta = profiles.instagram[0];
                instagramResult = {
                    url: bestInsta.link,
                    handle: bestInsta.link.split('instagram.com/')[1]?.split('/')[0]?.split('?')[0],
                    followers: null,
                    profilePhoto: null,
                    source: 'probe_reuse'
                };
                console.log(`♻️ Reusing Instagram from probe: ${instagramResult.url}`);
            }

            // STRICT: Only reuse if URL actually contains twitter.com or x.com
            if (profiles.twitter.length > 0 && (profiles.twitter[0].link?.includes('twitter.com') || profiles.twitter[0].link?.includes('x.com/'))) {
                const bestTwitter = profiles.twitter[0];
                twitterResult = {
                    url: bestTwitter.link,
                    handle: bestTwitter.link.split('twitter.com/')[1]?.split('/')[0]?.split('?')[0] || bestTwitter.link.split('x.com/')[1]?.split('/')[0]?.split('?')[0],
                    followers: null,
                    profilePhoto: null,
                    source: 'probe_reuse'
                };
                console.log(`♻️ Reusing Twitter from probe: ${twitterResult.url}`);
            }
        }

        if (shouldSearchSocials) {
            console.log(`🔍 Searching social media presence (parallel)...`);

            // Determine priority based on celebrity type (or default)
            const priority = celebrityInfo.socialMediaPriority || 'both';

            // Prepare search promises
            const searchPromises = [];
            let instagramIdx = -1;
            let twitterIdx = -1;

            if ((priority === 'instagram' || priority === 'both') && !instagramResult.url) {
                instagramIdx = searchPromises.length;
                searchPromises.push(this.searchInstagram(guest));
            }

            if ((priority === 'twitter' || priority === 'both') && !twitterResult.url) {
                twitterIdx = searchPromises.length;
                searchPromises.push(this.searchTwitter(guest));
            }

            // Always search news in parallel too (unless we already have super strong signals for a celebrity)
            // If it's a confirmed celebrity and we already found socials in probe, we can skip news to save time
            const skipNews = !celebrityInfo.isCelebrity || (instagramResult.url || twitterResult.url);
            let newsIdx = -1;

            if (!skipNews) {
                newsIdx = searchPromises.length;
                searchPromises.push(this.searchRecentNews(guest));
            } else {
                console.log(`⚡ fast-mode: Skipping news search for identified celebrity`);
            }

            // Wait for all searches to complete (or fail)
            const results = await Promise.allSettled(searchPromises);

            // Extract results
            if (instagramIdx !== -1) {
                const res = results[instagramIdx];
                if (res.status === 'fulfilled') {
                    instagramResult = res.value;
                    if (celebrityInfo.isCelebrity) {
                        instagramResult = await this.verifySocialMediaRelevance(guest, instagramResult, celebrityInfo, 'instagram');
                    }
                }
            }

            if (twitterIdx !== -1) {
                const res = results[twitterIdx];
                if (res.status === 'fulfilled') {
                    twitterResult = res.value;
                    if (celebrityInfo.isCelebrity) {
                        twitterResult = await this.verifySocialMediaRelevance(guest, twitterResult, celebrityInfo, 'twitter');
                    }
                }
            }

            // News Info Result
            const newsRes = results[newsIdx];
            if (newsRes && newsRes.status === 'fulfilled') {
                newsInfo = newsRes.value;
            }

            // If nothing found on priority platform, try the other as fallback (if not already searched)
            if (priority === 'instagram' && !instagramResult.url && twitterIdx === -1) {
                twitterResult = await this.searchTwitter(guest);
            } else if (priority === 'twitter' && !twitterResult.url && instagramIdx === -1) {
                instagramResult = await this.searchInstagram(guest);
            }
        } else {
            console.log(`📋 Skipping social media search`);
            // STRICT RULE: Only search news for confirmed public figures
            if (celebrityInfo.isCelebrity) {
                newsInfo = await this.searchRecentNews(guest);
            }
        }
        // --------------------------

        // --- Company & Final Analysis (PARALLEL) ---
        // We start company lookup and AI analysis at the same time to save 10-15s
        let companyInfo = null;
        let analysis = null;

        const targetCompany = guest.company || (linkedinInfo.bestMatch && linkedinInfo.bestMatch.company);

        console.log(`🚀 Starting Final Analysis & Company Lookup in parallel...`);
        const parallelPromises = [];

        // 1. Final AI Analysis (Primary) - We always run this
        const analysisPromiseIdx = parallelPromises.length;
        parallelPromises.push(this.analyzeWithAI(guest, linkedinInfo, celebrityInfo, newsInfo, fallbackMatch, allResults, emailDomainInfo, language));

        // 2. Company Research (Optional)
        let companyLookupIdx = -1;

        const isInvalidCompany = ['hotmail', 'gmail', 'yahoo', 'outlook', 'live', 'icloud', 'aol', 'protonmail',
            'expedia', 'booking', 'hotels', 'agoda', 'trivago', 'airbnb', 'tripadvisor', 'kayak', 'priceline']
            .some(p => targetCompany?.toLowerCase().includes(p));

        const wellKnownCompanies = [
            'essent', 'kpn', 'ing bank', 'rabobank', 'abn amro', 'philips', 'shell', 'unilever',
            'heineken', 'akzonobel', 'asml', 'booking.com', 'adyen', 'wolters kluwer', 'randstad',
            'proximus', 'belfius', 'bnp paribas', 'kbc bank', 'telenet', 'orange', 'vodafone',
            'deloitte', 'pwc', 'kpmg', 'ernst & young', 'mckinsey', 'boston consulting', 'accenture', 'capgemini',
            'microsoft', 'google', 'amazon', 'apple', 'meta platforms', 'ibm', 'oracle', 'sap',
            'albert heijn', 'jumbo supermarkten', 'lidl', 'aldi', 'ikea', 'mediamarkt', 'coolblue',
            'ns', 'prorail', 'schiphol', 'klm', 'transavia', 'brussels airlines', 'lufthansa'
        ];
        const companyLower = targetCompany ? targetCompany.toLowerCase().trim() : null;
        const isWellKnown = companyLower ? wellKnownCompanies.some(c =>
            companyLower === c || companyLower.startsWith(c + ' ') || companyLower.startsWith(c + ',')
        ) : false;

        if (targetCompany && !celebrityInfo.isCelebrity && !isInvalidCompany && !isWellKnown) {
            console.log(`🏢 Parallel: Starting company lookup for ${targetCompany}`);
            companyLookupIdx = parallelPromises.length;
            parallelPromises.push(companyScraper.searchCompany(targetCompany, {
                guestCountry: guest.country,
                guestCity: guest.city || null
            }));
        } else if (targetCompany) {
            console.log(`⚡ Parallel: Skipping company lookup (known/celebrity/invalid)`);
        }

        // Wait for both to complete
        const finalResults = await Promise.allSettled(parallelPromises);

        // Extract Analysis Result
        const analysisRes = finalResults[analysisPromiseIdx];
        if (analysisRes.status === 'fulfilled') {
            analysis = analysisRes.value;
            console.log(`🤖 AI Analysis: VIP Score ${analysis.vip_score}`);
        } else {
            console.error('❌ Final AI Analysis failed:', analysisRes.reason);
            // Minimal fallback analysis
            analysis = { vip_score: 5, industry: { value: 'Onbekend' }, full_report: {} };
        }

        // Extract Company Result
        if (companyLookupIdx !== -1) {
            const companyRes = finalResults[companyLookupIdx];
            if (companyRes.status === 'fulfilled') {
                companyInfo = companyRes.value;
                guest.company_info = companyInfo;
                console.log(`🏢 Parallel: Company lookup complete`);
            }
        }
        // -----------------------------

        // Get best LinkedIn data
        const bestMatch = linkedinInfo.bestMatch;

        // 📸 PHOTO SELECTION - DISABLED (User request: "Foto zoektoch is ook niet nodig mag weg!")
        let profilePhotoUrl = null;

        // Calculate total followers for VIP scoring
        const totalFollowers = (instagramResult.followers || 0) + (twitterResult.followers || 0);

        // Prioritize job title and company from social media if LinkedIn not available
        // AI analysis is now a high-priority source for professional context
        // BUT: If email domain indicates "Possible owner", use that as job title if no other job title found

        // ONLY use celebrity info if we actually confirmed them in the search results
        const celebrityMatched = celebrityInfo.isCelebrity &&
            (allResults.some(r => r.link?.includes('wikipedia.org') || r.link?.includes('imdb.com')) ||
                linkedinInfo.bestMatch?.url?.includes('linkedin.com/in/') ||
                fallbackMatch?.url);

        let effectiveJobTitle = bestMatch?.jobTitle ||
            fallbackMatch?.jobTitle ||
            twitterResult.jobTitle ||
            instagramResult.jobTitle ||
            (celebrityMatched ? celebrityInfo.knownFor : null) ||
            null;

        // If no job title found, but email domain indicates possible owner, use "Mogelijke eigenaar"
        if (!effectiveJobTitle && emailDomainInfo?.ownerLabel &&
            (emailDomainInfo.ownerLabel.includes('Possible owner') ||
                emailDomainInfo.ownerLabel.includes('Mogelijke eigenaar') ||
                emailDomainInfo.ownerLabel.includes('Likely owner'))) {
            effectiveJobTitle = 'Mogelijke eigenaar';
        }

        // Only use AI-generated current_role if we still don't have a job title
        if (!effectiveJobTitle) {
            effectiveJobTitle = analysis.full_report?.professional_background?.current_role ||
                analysis.industry?.value ||
                null;
        }

        // Company priority: LinkedIn > Email Domain > AI Analysis > Social > Input
        const effectiveCompany = bestMatch?.company ||
            emailDomainInfo?.companyName ||
            fallbackMatch?.company ||
            analysis.full_report?.company_analysis?.company_name ||
            twitterResult.company ||
            instagramResult.company ||
            guest.company;

        // Enhanced country detection - try to extract from AI or social media
        const effectiveCountry = guest.country ||
            (typeof analysis.full_report?.personal_profile?.location === 'string' ? analysis.full_report.personal_profile.location.split(',').pop()?.trim() : null) ||
            (typeof twitterResult.location === 'string' ? twitterResult.location.split(',').pop()?.trim() : null) ||
            (typeof instagramResult.location === 'string' ? instagramResult.location.split(',').pop()?.trim() : null) ||
            null;

        // Combine location info - prefer Twitter which often has location in bio
        const socialMediaLocation = twitterResult.location || instagramResult.location || null;

        // Get website from social media if not found elsewhere, or from company info
        // IMPORTANT: Filter out LinkedIn URLs - they are NOT company websites
        const fallbackUrl = fallbackMatch?.url;
        const isValidFallbackWebsite = fallbackUrl &&
            !fallbackUrl.toLowerCase().includes('linkedin.com') &&
            !fallbackUrl.toLowerCase().includes('facebook.com') &&
            !fallbackUrl.toLowerCase().includes('twitter.com') &&
            !fallbackUrl.toLowerCase().includes('instagram.com');

        // Also validate companyInfo.website
        const companyWebsite = companyInfo?.website;
        const isValidCompanyWebsite = companyWebsite &&
            !companyWebsite.toLowerCase().includes('linkedin.com') &&
            !companyWebsite.toLowerCase().includes('facebook.com') &&
            !companyWebsite.toLowerCase().includes('wikipedia.org');

        const effectiveWebsite = (isValidCompanyWebsite ? companyWebsite : null) ||
            emailDomainInfo?.websiteUrl ||
            (isValidFallbackWebsite ? fallbackUrl : null) ||
            twitterResult.linkedWebsite ||
            instagramResult.linkedWebsite ||
            null;

        console.log(`🌐 Website selection: company=${companyWebsite || 'none'}, fallback=${fallbackUrl || 'none'}, effective=${effectiveWebsite || 'none'}`);

        // Use linked Instagram from Twitter if we didn't find Instagram directly
        if (!instagramResult.url && twitterResult.linkedInstagram) {
            console.log(`📸 Using Instagram link from Twitter: @${twitterResult.linkedInstagram}`);
            instagramResult = {
                ...instagramResult,
                url: `https://instagram.com/${twitterResult.linkedInstagram}`,
                handle: twitterResult.linkedInstagram
            };
        }

        // Use linked Twitter from Instagram if we didn't find Twitter directly
        if (!twitterResult.url && instagramResult.linkedTwitter) {
            console.log(`🐦 Using Twitter link from Instagram: @${instagramResult.linkedTwitter}`);
            twitterResult = {
                ...twitterResult,
                url: `https://x.com/${instagramResult.linkedTwitter}`,
                handle: instagramResult.linkedTwitter
            };
        }

        // Check if we found ANY significant data
        // More lenient check - if we found LinkedIn, company, job title, or any analysis data, we have results
        const hasLinkedIn = linkedinInfo?.bestMatch?.url;

        // Exclude placeholder values that mean "no info"
        const noInfoValues = ['unknown', 'geen informatie gevonden', 'geen informatie', 'niet gevonden', 'onbekend', 'n/a', 'none', '-'];
        const isRealValue = (val) => val && !noInfoValues.includes(val.toLowerCase().trim());

        const hasCompany = isRealValue(effectiveCompany);
        const hasJobTitle = isRealValue(effectiveJobTitle);
        const hasAnalysis = analysis?.vip_score > 0;
        const hasTwitter = twitterResult.url;
        const hasInstagram = instagramResult.url;
        const hasNews = newsInfo.articles?.length > 0;
        const hasCelebrityInfo = celebrityInfo.isCelebrity;

        // Instagram only counts as a result if:
        // 1. It's a celebrity/artist (social media is relevant for them)
        // 2. OR there are other "hard" results (LinkedIn, company, job title, Twitter, news)
        // NOTE: hasAnalysis is NOT included because AI always generates a VIP score even without real data
        // If only Instagram is found and it's not a celebrity, treat as no results
        const hasHardResults = hasLinkedIn || hasCompany || hasJobTitle || hasTwitter || hasNews;
        const hasMeaningfulSocialMedia = hasTwitter ||
            (hasInstagram && (hasCelebrityInfo || hasHardResults));

        // FOLLOWER THRESHOLD: For individuals (not celebrities), only show social if 5000+ followers
        // This prevents showing random personal Instagram accounts for regular guests
        const MIN_FOLLOWERS_FOR_INDIVIDUALS = 5000;

        const instagramFollowers = instagramResult.followers || 0;
        const twitterFollowers = twitterResult.followers || 0;

        const hasSubstantialInstagram = hasCelebrityInfo || instagramFollowers >= MIN_FOLLOWERS_FOR_INDIVIDUALS;
        const hasSubstantialTwitter = hasCelebrityInfo || twitterFollowers >= MIN_FOLLOWERS_FOR_INDIVIDUALS;

        // Determine if Instagram should be included in results
        // RULES:
        // 1. Celebrity → Always include
        // 2. Has LinkedIn + Other hard results → Include if 5000+ followers
        // 3. No LinkedIn → Include if 5000+ followers (influencer-level)
        // 4. Business person with LinkedIn → NO social media (LinkedIn is enough)
        const shouldIncludeInstagram = hasCelebrityInfo ||
            (hasInstagram && hasSubstantialInstagram && (hasHardResults || !hasLinkedIn));

        const shouldIncludeTwitter = hasCelebrityInfo ||
            (hasTwitter && hasSubstantialTwitter && (hasHardResults || !hasLinkedIn));

        // Debug logging
        if (hasInstagram) {
            if (shouldIncludeInstagram) {
                console.log(`✅ Instagram included (celebrity=${hasCelebrityInfo}, followers=${instagramFollowers}, threshold=${MIN_FOLLOWERS_FOR_INDIVIDUALS})`);
            } else {
                console.log(`🚫 Instagram EXCLUDED (not celebrity, followers=${instagramFollowers} < ${MIN_FOLLOWERS_FOR_INDIVIDUALS})`);
            }
        }

        if (hasTwitter) {
            if (shouldIncludeTwitter) {
                console.log(`✅ Twitter included (celebrity=${hasCelebrityInfo}, followers=${twitterFollowers})`);
            } else {
                console.log(`🚫 Twitter EXCLUDED (not celebrity, followers=${twitterFollowers} < ${MIN_FOLLOWERS_FOR_INDIVIDUALS})`);
            }
        }

        const noResultsFound = !hasLinkedIn &&
            !hasCompany &&
            !hasJobTitle &&
            !hasAnalysis &&
            !hasMeaningfulSocialMedia &&
            !hasNews &&
            !hasCelebrityInfo &&
            !fallbackMatch &&
            !guest.company_info?.deep_info;

        if (noResultsFound) {
            console.log(`⚠️ No significant information found for ${guest.full_name}`);
        } else {
            console.log(`✅ Found data for ${guest.full_name}: LinkedIn=${!!hasLinkedIn}, Company=${!!hasCompany}, JobTitle=${!!hasJobTitle}, Analysis=${!!hasAnalysis}`);
        }

        // Build results object with comprehensive social media data
        return {
            profilePhotoUrl: profilePhotoUrl,
            jobTitle: effectiveJobTitle,
            companyName: effectiveCompany,
            companySize: emailDomainInfo?.companySize || analysis.company_size || null,
            isOwner: emailDomainInfo?.isOwner ?? analysis.is_owner,
            ownerReason: emailDomainInfo?.ownerReason || null,
            companyOwnershipLabel: emailDomainInfo?.ownerLabel || null,
            companyOwnershipConfidence: emailDomainInfo?.ownerConfidence ?? null,
            companyOwnershipReason: emailDomainInfo?.ownerReason || null,
            companyOwnershipDetermination: emailDomainInfo?.ownershipDetermination || null,
            employmentType: analysis.employment_type || null,
            industry: analysis.industry || celebrityInfo.category,
            linkedinUrl: bestMatch?.url || null,
            linkedinConnections: null,
            // Candidates weggelaten - te veel ruis, alleen beste match tonen
            linkedinCandidates: [],
            needsLinkedInReview: false,

            // Instagram data (only include if meaningful or celebrity)
            instagramUrl: shouldIncludeInstagram ? instagramResult.url : null,
            instagramHandle: shouldIncludeInstagram ? instagramResult.handle : null,
            instagramFollowers: shouldIncludeInstagram ? instagramResult.followers : null,
            instagramBio: shouldIncludeInstagram ? instagramResult.bio : null,
            instagramLocation: shouldIncludeInstagram ? instagramResult.location : null,

            // Twitter data (only include if meaningful or celebrity)
            twitterUrl: shouldIncludeTwitter ? twitterResult.url : null,
            twitterHandle: shouldIncludeTwitter ? twitterResult.handle : null,
            twitterFollowers: shouldIncludeTwitter ? twitterResult.followers : null,
            twitterBio: shouldIncludeTwitter ? twitterResult.bio : null,
            twitterLocation: shouldIncludeTwitter ? twitterResult.location : null,
            twitterMemberSince: shouldIncludeTwitter ? twitterResult.memberSince : null,

            // Combined/derived data
            socialMediaLocation: socialMediaLocation,
            effectiveCountry: effectiveCountry,

            facebookUrl: null,
            youtubeUrl: null,
            websiteUrl: effectiveWebsite,
            notableInfo: analysis.notable_info,
            fullReport: analysis.full_report || null,
            pressMentions: null,
            netWorthEstimate: analysis.net_worth_estimate,
            followersEstimate: formatNumber(totalFollowers),
            vipScore: analysis.vip_score,
            influenceLevel: analysis.influence_level,
            isCelebrity: celebrityInfo.isCelebrity,
            celebrityCategory: celebrityInfo.category,
            rawResults: [
                { type: 'linkedin_search', data: linkedinInfo },
                { type: 'celebrity_detection', data: celebrityInfo },
                { type: 'news_search', data: newsInfo },
                // Only include Instagram in rawResults if it should be shown
                ...(shouldIncludeInstagram ? [{ type: 'instagram_search', data: instagramResult }] : []),
                { type: 'twitter_search', data: twitterResult },
                { type: 'google_fallback', data: fallbackMatch },
                { type: 'email_domain', data: emailDomainInfo },
                { type: 'ai_analysis', data: analysis }
            ],
            emailDomainInfo: emailDomainInfo,
            newsArticles: newsInfo.articles || [],
            confidenceScores: analysis.confidence_scores || null,
            noResultsFound: noResultsFound
        };
    }
}

module.exports = new SmartSearchService();
