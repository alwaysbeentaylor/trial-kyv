const db = require('../db/database');
const smartSearch = require('./smartSearch');
const vipScorer = require('./vipScorer');
const emailService = require('./emailService');

// Initialize email service on load
emailService.initialize();

/**
 * Normalize influence_level to Dutch values for database constraint
 * Database expects: 'Laag', 'Gemiddeld', 'Hoog', 'VIP'
 */
function normalizeInfluenceLevel(level) {
    if (!level) return 'Gemiddeld';

    const normalized = level.toLowerCase().trim();

    // Map English to Dutch
    const mapping = {
        'low': 'Laag',
        'medium': 'Gemiddeld',
        'high': 'Hoog',
        'vip': 'VIP',
        // Dutch values pass through
        'laag': 'Laag',
        'gemiddeld': 'Gemiddeld',
        'hoog': 'Hoog'
    };

    return mapping[normalized] || 'Gemiddeld';
}

/**
 * Helper to update main guest record with research findings
 */
function updateGuestFromResearch(guestId, searchResults) {
    try {
        console.log(`📝 Updating guest ${guestId} with research results: Job="${searchResults.jobTitle}", Company="${searchResults.companyName}"`);

        // Update company, country, AND job_title in the main guests table
        db.prepare(`
            UPDATE guests 
            SET company = COALESCE(NULLIF(?, ''), company),
                country = COALESCE(NULLIF(?, ''), country),
                job_title = COALESCE(NULLIF(?, ''), job_title)
            WHERE id = ?
        `).run(
            searchResults.companyName,
            searchResults.effectiveCountry || searchResults.socialMediaLocation || searchResults.instagramLocation || searchResults.twitterLocation,
            searchResults.jobTitle,
            guestId
        );
    } catch (err) {
        console.error('Failed to update guest from research:', err.message);
    }
}

/**
 * Perform research for a single guest
 * @param {number} guestId 
 * @param {Object} options { forceRefresh: boolean, language: 'nl' | 'en' }
 * @returns {Promise<Object>} Research results
 */
async function performResearch(guestId, options = {}) {
    const { forceRefresh = false, language = 'nl' } = options;

    // Get guest
    const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(guestId);
    if (!guest) {
        throw new Error('Gast niet gevonden');
    }

    // Check existing research
    const existingResearch = db.prepare('SELECT * FROM research_results WHERE guest_id = ?').get(guestId);
    if (existingResearch && !forceRefresh) {
        return {
            research: existingResearch,
            cached: true
        };
    }

    // Perform smart search (Wikipedia + AI) with 180s timeout
    let searchResults;
    try {
        const researchPromise = smartSearch.searchGuest(guest, { language });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Research timeout (180s)')), 180000)
        );

        searchResults = await Promise.race([researchPromise, timeoutPromise]);
    } catch (error) {
        throw error;
    }

    // Get VIP score from AI analysis or calculate
    const vipScore = searchResults.vipScore || vipScorer.calculate(searchResults);
    const rawInfluenceLevel = searchResults.influenceLevel || vipScorer.getInfluenceLevel(vipScore);
    const influenceLevel = normalizeInfluenceLevel(rawInfluenceLevel);

    // Save or update research results
    if (existingResearch) {
        db.prepare(`
        UPDATE research_results SET
          profile_photo_url = ?,
          job_title = ?,
          company_name = ?,
          company_size = ?,
          is_owner = ?,
          company_ownership_label = ?,
          employment_type = ?,
          industry = ?,
          linkedin_url = ?,
          linkedin_connections = ?,
          linkedin_candidates = ?,
          needs_linkedin_review = ?,
          instagram_handle = ?,
          instagram_url = ?,
          instagram_bio = ?,
          instagram_location = ?,
          instagram_followers = ?,
          twitter_handle = ?,
          twitter_url = ?,
          twitter_bio = ?,
          twitter_location = ?,
          twitter_member_since = ?,
          twitter_followers = ?,
          social_media_location = ?,
          facebook_url = ?,
          youtube_url = ?,
          website_url = ?,
          notable_info = ?,
          full_report = ?,
          press_mentions = ?,
          net_worth = ?,
          followers_estimate = ?,
          vip_score = ?,
          influence_level = ?,
          raw_search_results = ?,
          no_results_found = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE guest_id = ?
       `).run(
            searchResults.profilePhotoUrl,
            searchResults.jobTitle,
            searchResults.companyName,
            searchResults.companySize,
            searchResults.isOwner === true ? 1 : (searchResults.isOwner === false ? 0 : null),
            searchResults.companyOwnershipLabel || null,
            searchResults.employmentType,
            searchResults.industry,
            searchResults.linkedinUrl,
            searchResults.linkedinConnections,
            JSON.stringify(searchResults.linkedinCandidates || []),
            searchResults.needsLinkedInReview ? 1 : 0,
            searchResults.instagramHandle,
            searchResults.instagramUrl,
            searchResults.instagramBio,
            searchResults.instagramLocation,
            searchResults.instagramFollowers,
            searchResults.twitterHandle,
            searchResults.twitterUrl,
            searchResults.twitterBio,
            searchResults.twitterLocation,
            searchResults.twitterMemberSince,
            searchResults.twitterFollowers,
            searchResults.socialMediaLocation,
            searchResults.facebookUrl,
            searchResults.youtubeUrl,
            searchResults.websiteUrl,
            searchResults.notableInfo,
            JSON.stringify(searchResults.fullReport || null),
            searchResults.pressMentions,
            searchResults.netWorthEstimate,
            searchResults.followersEstimate,
            vipScore,
            influenceLevel,
            JSON.stringify(searchResults.rawResults),
            searchResults.noResultsFound ? 1 : 0,
            guestId
        );
    } else {
        db.prepare(`
        INSERT INTO research_results (
          guest_id, profile_photo_url, job_title, company_name, company_size, is_owner, company_ownership_label, employment_type,
          industry, linkedin_url, linkedin_connections, linkedin_candidates, needs_linkedin_review,
          instagram_handle, instagram_url, instagram_bio, instagram_location, instagram_followers,
          twitter_handle, twitter_url, twitter_bio, twitter_location, twitter_member_since, twitter_followers,
          social_media_location, facebook_url, youtube_url, website_url,
          notable_info, full_report, press_mentions, net_worth, followers_estimate, vip_score, influence_level, raw_search_results, no_results_found
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
            guestId,
            searchResults.profilePhotoUrl,
            searchResults.jobTitle,
            searchResults.companyName,
            searchResults.companySize,
            searchResults.isOwner === true ? 1 : (searchResults.isOwner === false ? 0 : null),
            searchResults.companyOwnershipLabel || null,
            searchResults.employmentType,
            searchResults.industry,
            searchResults.linkedinUrl,
            searchResults.linkedinConnections,
            JSON.stringify(searchResults.linkedinCandidates || []),
            searchResults.needsLinkedInReview ? 1 : 0,
            searchResults.instagramHandle,
            searchResults.instagramUrl,
            searchResults.instagramBio,
            searchResults.instagramLocation,
            searchResults.instagramFollowers,
            searchResults.twitterHandle,
            searchResults.twitterUrl,
            searchResults.twitterBio,
            searchResults.twitterLocation,
            searchResults.twitterMemberSince,
            searchResults.twitterFollowers,
            searchResults.socialMediaLocation,
            searchResults.facebookUrl,
            searchResults.youtubeUrl,
            searchResults.websiteUrl,
            searchResults.notableInfo,
            JSON.stringify(searchResults.fullReport || null),
            searchResults.pressMentions,
            searchResults.netWorthEstimate,
            searchResults.followersEstimate,
            vipScore,
            influenceLevel,
            searchResults.rawResults ? JSON.stringify(searchResults.rawResults) : null,
            searchResults.noResultsFound ? 1 : 0
        );
    }

    // UPDATE THE MAIN GUEST RECORD with research findings
    updateGuestFromResearch(guestId, searchResults);

    // Get updated research
    const research = db.prepare('SELECT * FROM research_results WHERE guest_id = ?').get(guestId);

    // Send email notification (async, don't wait)
    emailService.notifySingleResearch(guest, research).catch(err =>
        console.error('Email notification failed:', err.message)
    );

    return {
        research,
        cached: false
    };
}

module.exports = { performResearch };
