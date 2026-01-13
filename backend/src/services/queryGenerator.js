const OpenAI = require('openai');

/**
 * AI-Powered Query Generator
 * Generates smart search query variations to find anyone online
 */
class QueryGenerator {
    constructor() {
        this.openai = null;
    }

    getOpenAI() {
        if (!this.openai) {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) return null;
            this.openai = new OpenAI({ apiKey });
        }
        return this.openai;
    }

    /**
     * Generate comprehensive search queries for a guest
     * Uses AI to create smart variations based on available info
     */
    async generateQueries(guest) {
        const openai = this.getOpenAI();

        // Fallback: Basic queries if no AI
        const basicQueries = this.generateBasicQueries(guest);

        if (!openai) {
            console.log(`📝 Generated ${basicQueries.length} basic queries (no AI)`);
            return basicQueries;
        }

        try {
            console.log(`🤖 Generating AI-powered search queries for ${guest.full_name}...`);

            // Extract company from email domain for better AI context
            let emailCompany = '';
            if (guest.email && guest.email.includes('@')) {
                const domain = guest.email.split('@')[1]?.toLowerCase() || '';
                const ignoredDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'];
                if (domain && !ignoredDomains.some(d => domain.includes(d))) {
                    emailCompany = domain.split('.')[0].replace(/[^a-z0-9]/g, ' ').trim();
                }
            }

            const prompt = `Generate comprehensive search queries to find EVERYTHING about this person online.

GUEST INFO:
- Name: ${guest.full_name}
- Company: ${guest.company || 'Unknown'} (Hint: possibly related to "${emailCompany}")
- Country: ${guest.country || 'Unknown'}
- City: ${guest.city || 'Unknown'}
- Email: ${guest.email || 'None'}

YOUR MISSION: Generate 15-20 strategic search queries that will find:
1. LinkedIn profile
2. Other social media (Facebook, Instagram, Twitter, TikTok, YouTube)
3. Professional presence (GitHub, Behance, company websites, directories)
4. News mentions, press releases, interviews
5. Personal websites, blogs, portfolios
6. Any other online presence

STRATEGY:
- Use name variations (Full Name, F. Lastname, Firstname L., nicknames if obvious)
- Combine with location, company, job keywords
- Use site: operators for targeted searches (linkedin.com, facebook.com, github.com, etc.)
- Try industry-specific searches if company/role hints at industry
- Include queries for finding mentions, not just profiles
- Mix broad and narrow queries

EXAMPLE OUTPUT (for "Fandry Baffour", "Pronk Juweel", "Netherlands"):
1. "Fandry Baffour" Amsterdam
2. "Fandry Baffour" "Pronk Juweel"
3. site:linkedin.com/in "Fandry Baffour"
4. site:linkedin.com/in "Fandry Baffour" Netherlands
5. "Fandry Baffour" software developer
6. site:facebook.com "Fandry Baffour"
7. site:instagram.com "Fandry Baffour"
8. site:github.com "Fandry Baffour"
9. "F. Baffour" programmer Amsterdam
10. "Fandry Baffour" engineer
... etc.

Return JSON array of strings:
["query 1", "query 2", ...]`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert at generating search queries to find people online. You understand SEO, search operators, and how to craft queries that maximize discovery across all platforms.'
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message.content);
            const aiQueries = result.queries || result.searchQueries || [];

            // Combine AI queries with basic ones (deduplicate)
            const allQueries = [...new Set([...aiQueries, ...basicQueries])];

            console.log(`✨ Generated ${allQueries.length} total queries (${aiQueries.length} AI + ${basicQueries.length} basic)`);
            return allQueries;

        } catch (error) {
            console.error('AI query generation error:', error.message);
            return basicQueries;
        }
    }

    /**
     * Generate comprehensive basic queries without AI
     * ULTIMATE FINDER: 25-30 queries covering ALL platforms
     */
    generateBasicQueries(guest) {
        const queries = [];
        const name = guest.full_name;
        const company = guest.company || '';
        const country = guest.country || '';
        const city = guest.city || '';
        const nameParts = name.toLowerCase().split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts[nameParts.length - 1] || '';
        const nameNoSpaces = name.toLowerCase().replace(/\s+/g, '');

        // ============================================
        // EMAIL DOMAIN EXTRACTION (NEW!)
        // Extract company name from email domain
        // e.g., 1@marriott.com -> "marriott"
        // ============================================
        let emailCompany = '';
        if (guest.email && guest.email.includes('@')) {
            const domain = guest.email.split('@')[1]?.toLowerCase() || '';
            // List of domains to ignore (personal email providers, booking platforms)
            const ignoredDomains = [
                'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
                'icloud.com', 'live.com', 'msn.com', 'aol.com', 'protonmail.com',
                'mail.com', 'me.com', 'gmx.com', 'yandex.com', 'zoho.com',
                'booking.com', 'expedia.com', 'hotels.com', 'airbnb.com', 'agoda.com',
                'tripadvisor.com', 'kayak.com', 'trivago.com'
            ];

            if (domain && !ignoredDomains.includes(domain)) {
                // Extract company name from domain (remove TLD)
                emailCompany = domain.split('.')[0]
                    .replace(/-/g, ' ')  // hotel-xyz -> hotel xyz
                    .replace(/_/g, ' ')  // hotel_xyz -> hotel xyz
                    .trim();

                // Only use if it's a reasonable company name (not too short)
                if (emailCompany.length < 3) {
                    emailCompany = '';
                }
            }
        }

        // ============================================
        // TIER 1: CORE IDENTITY QUERIES (High Priority)
        // ============================================
        queries.push(`"${name}" ${country}`.trim());
        queries.push(`"${name}" ${city}`.trim());
        queries.push(`"${name}" ${company}`.trim());
        if (company) {
            queries.push(`"${name}" "${company}"`);
            queries.push(`"${name}" "${company}" ${country}`.trim());
        }

        // NEW: Email domain company queries
        if (emailCompany && emailCompany !== company.toLowerCase()) {
            console.log(`📧 Adding email domain company to search: "${emailCompany}" (from ${guest.email})`);
            queries.push(`"${name}" "${emailCompany}"`);
            queries.push(`"${name}" "${emailCompany}" ${country}`.trim());
            queries.push(`site:linkedin.com/in "${name}" "${emailCompany}"`);
        }

        // ============================================
        // TIER 2: LINKEDIN (Critical for VIP identification)
        // ============================================
        queries.push(`site:linkedin.com/in "${name}"`);
        queries.push(`site:linkedin.com/in "${name}" ${country}`.trim());
        if (company) {
            queries.push(`site:linkedin.com/in "${name}" "${company}"`);
        }
        queries.push(`"${name}" linkedin profile`);

        // ============================================
        // TIER 3: FACEBOOK (Often has personal info)
        // ============================================
        queries.push(`site:facebook.com "${name}"`);
        queries.push(`site:facebook.com "${name}" ${country}`.trim());
        queries.push(`site:facebook.com "${name}" ${city}`.trim());

        // ============================================
        // TIER 4: INSTAGRAM & TWITTER
        // ============================================
        queries.push(`site:instagram.com "${name}"`);
        queries.push(`site:instagram.com "${nameNoSpaces}"`);
        queries.push(`site:twitter.com "${name}"`);
        queries.push(`site:x.com "${name}"`);

        // ============================================
        // TIER 5: PROFESSIONAL PLATFORMS
        // ============================================
        queries.push(`site:github.com "${name}"`);
        queries.push(`site:github.com "${nameNoSpaces}"`);
        queries.push(`site:medium.com "@${nameNoSpaces}"`);
        queries.push(`site:behance.net "${name}"`);
        queries.push(`site:dribbble.com "${name}"`);

        // ============================================
        // TIER 6: BUSINESS DIRECTORIES
        // ============================================
        queries.push(`site:crunchbase.com/person "${name}"`);
        queries.push(`site:angel.co "${name}"`);
        queries.push(`site:bloomberg.com "${name}"`);
        if (company) {
            queries.push(`"${name}" CEO "${company}"`);
            queries.push(`"${name}" founder "${company}"`);
            queries.push(`"${name}" director "${company}"`);
        }

        // ============================================
        // TIER 7: NEWS & MEDIA
        // ============================================
        queries.push(`"${name}" news ${country}`.trim());
        queries.push(`"${name}" interview`);
        queries.push(`"${name}" press release`);

        // ============================================
        // TIER 8: PERSONAL WEBSITES
        // ============================================
        if (firstName && lastName) {
            queries.push(`site:${firstName}${lastName}.com`);
            queries.push(`site:${firstName}-${lastName}.com`);
            queries.push(`site:${lastName}${firstName}.com`);
            queries.push(`"${firstName}${lastName}.com" OR "${firstName}-${lastName}.com"`);
        }
        queries.push(`site:about.me "${name}"`);
        queries.push(`site:linktree.com "${nameNoSpaces}"`);

        // ============================================
        // TIER 9: YOUTUBE (For influencers/speakers)
        // ============================================
        queries.push(`site:youtube.com "${name}"`);
        queries.push(`site:youtube.com/@${nameNoSpaces}`);

        // ============================================
        // TIER 10: PROFESSIONAL CONTEXT
        // ============================================
        queries.push(`"${name}" professional ${country}`.trim());
        queries.push(`"${name}" entrepreneur`);
        queries.push(`"${name}" speaker`);

        return queries.filter(q => q.length > 5); // Remove empty/too short queries
    }

    /**
     * Generate platform-specific queries
     */
    generatePlatformQueries(guest, platform) {
        const name = guest.full_name;
        const country = guest.country || '';
        const company = guest.company || '';

        const platformDomains = {
            linkedin: 'linkedin.com/in',
            facebook: 'facebook.com',
            instagram: 'instagram.com',
            twitter: 'twitter.com OR site:x.com',
            github: 'github.com',
            youtube: 'youtube.com',
            tiktok: 'tiktok.com',
            medium: 'medium.com',
            behance: 'behance.net',
            dribbble: 'dribbble.com'
        };

        const domain = platformDomains[platform.toLowerCase()];
        if (!domain) return [];

        const queries = [];
        queries.push(`site:${domain} "${name}"`);
        queries.push(`site:${domain} "${name}" ${country}`.trim());

        if (company) {
            queries.push(`site:${domain} "${name}" "${company}"`);
        }

        return queries;
    }
}

module.exports = new QueryGenerator();
