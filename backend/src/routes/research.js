const express = require('express');
const router = express.Router();
const db = require('../db/database');
const smartSearch = require('../services/smartSearch');
const vipScorer = require('../services/vipScorer');
const researchController = require('../services/researchController');

// POST /api/research/:guestId - Start research for a single guest
// POST /api/research/:guestId - Start research for a single guest
router.post('/:guestId', async (req, res) => {
    try {
        const guestId = parseInt(req.params.guestId);
        const { forceRefresh = false } = req.body;

        // Get language preference from Accept-Language header
        const language = req.headers['accept-language'] || 'nl';

        const result = await researchController.performResearch(guestId, { forceRefresh, language });

        res.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('Research error:', error);

        // Check for common issues
        if (error.message.includes('timeout')) {
            return res.status(504).json({
                error: 'Research timeout - dit kan gebeuren als de zoekopdrachten te lang duren. Probeer het opnieuw.',
                details: 'De research heeft meer dan 180 seconden geduurd. Dit kan komen door trage API responses of captcha problemen.'
            });
        }

        if (error.message.includes('2Captcha') || error.message.includes('captcha')) {
            return res.status(500).json({
                error: 'Google Search faalt - 2Captcha API key probleem',
                details: 'Controleer of TWO_CAPTCHA_API_KEY correct is ingesteld in Render environment variables.'
            });
        }

        // Handle specific "Guest not found" error from controller
        if (error.message === 'Gast niet gevonden') {
            return res.status(404).json({ error: 'Gast niet gevonden' });
        }

        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/research/:guestId - Clear research for a guest
router.delete('/:guestId', (req, res) => {
    try {
        const { guestId } = req.params;

        const result = db.prepare('DELETE FROM research_results WHERE guest_id = ?').run(guestId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Geen research gevonden om te verwijderen' });
        }

        res.json({
            success: true,
            message: 'Onderzoeksresultaten succesvol verwijderd'
        });

    } catch (error) {
        console.error('Clear research error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/research/:guestId/ai-analyze - Perform manual AI analysis
router.post('/:guestId/ai-analyze', async (req, res) => {
    try {
        const { guestId } = req.params;
        const { customInput } = req.body;

        if (!customInput || customInput.trim() === '') {
            return res.status(400).json({ error: 'Geen input opgegeven' });
        }

        // Get guest and existing research
        const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(guestId);
        const research = db.prepare('SELECT * FROM research_results WHERE guest_id = ?').get(guestId);

        if (!guest) {
            return res.status(404).json({ error: 'Gast niet gevonden' });
        }

        if (!research) {
            return res.status(404).json({ error: 'Geen bestaande research gevonden om te verrijken' });
        }

        // Get language preference
        const language = req.headers['accept-language'] || 'nl';

        // 1. Save backup of current report
        db.prepare(`
            UPDATE research_results SET
                previous_full_report = full_report,
                previous_vip_score = vip_score,
                custom_research_input = ?
            WHERE guest_id = ?
        `).run(customInput, guestId);

        // 2. Perform AI analysis with custom input
        const analysis = await smartSearch.analyzeWithCustomInput(guest, research, customInput, language);

        if (!analysis) {
            return res.status(500).json({ error: 'AI analyse is mislukt' });
        }

        // 3. Update research results with new findings
        db.prepare(`
            UPDATE research_results SET
                vip_score = ?,
                industry = ?,
                company_size = ?,
                is_owner = ?,
                employment_type = ?,
                notable_info = ?,
                influence_level = ?,
                net_worth = ?,
                full_report = ?,
                no_results_found = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE guest_id = ?
        `).run(
            analysis.vip_score,
            analysis.industry,
            analysis.company_size,
            analysis.is_owner === true ? 1 : (analysis.is_owner === false ? 0 : null),
            analysis.employment_type,
            analysis.notable_info,
            analysis.influence_level,
            analysis.net_worth_estimate,
            JSON.stringify(analysis.full_report),
            guestId
        );

        // Get updated research
        const updatedResearch = db.prepare('SELECT * FROM research_results WHERE guest_id = ?').get(guestId);

        res.json({
            success: true,
            message: 'Rapport succesvol bijgewerkt met AI',
            research: updatedResearch
        });

    } catch (error) {
        console.error('AI Analyze error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/research/:guestId/restore - Restore previous report
router.post('/:guestId/restore', (req, res) => {
    try {
        const { guestId } = req.params;

        const research = db.prepare('SELECT * FROM research_results WHERE guest_id = ?').get(guestId);

        if (!research || !research.previous_full_report) {
            return res.status(400).json({ error: 'Geen backup gevonden om te herstellen' });
        }

        // Restore from backup and clear backup
        db.prepare(`
            UPDATE research_results SET
                full_report = previous_full_report,
                vip_score = COALESCE(previous_vip_score, vip_score),
                previous_full_report = NULL,
                previous_vip_score = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE guest_id = ?
        `).run(guestId);

        const restoredResearch = db.prepare('SELECT * FROM research_results WHERE guest_id = ?').get(guestId);

        res.json({
            success: true,
            message: 'Vorig rapport succesvol hersteld',
            research: restoredResearch
        });

    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/research/batch - Research multiple guests
router.post('/batch', async (req, res) => {
    try {
        const { guestIds, skipExisting = true } = req.body;

        if (!guestIds || !Array.isArray(guestIds) || guestIds.length === 0) {
            return res.status(400).json({ error: 'Geen gasten geselecteerd' });
        }

        const results = {
            total: guestIds.length,
            completed: 0,
            skipped: 0,
            errors: []
        };

        for (const guestId of guestIds) {
            try {
                const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(guestId);
                if (!guest) {
                    results.errors.push({ guestId, error: 'Gast niet gevonden' });
                    continue;
                }

                // Check existing research
                const existingResearch = db.prepare('SELECT id FROM research_results WHERE guest_id = ?').get(guestId);
                if (existingResearch && skipExisting) {
                    results.skipped++;
                    continue;
                }

                // Perform smart search
                const searchResults = await smartSearch.searchGuest(guest);
                const vipScore = searchResults.vipScore || vipScorer.calculate(searchResults);
                const influenceLevel = searchResults.influenceLevel || vipScorer.getInfluenceLevel(vipScore);

                // Save results
                if (existingResearch) {
                    db.prepare(`
            UPDATE research_results SET
              profile_photo_url = ?, job_title = ?, company_name = ?, company_size = ?,
              industry = ?, linkedin_url = ?, linkedin_connections = ?, 
              linkedin_candidates = ?, needs_linkedin_review = ?,
              instagram_handle = ?, instagram_url = ?, instagram_followers = ?,
              twitter_handle = ?, twitter_url = ?, twitter_followers = ?,
              website_url = ?, notable_info = ?, full_report = ?, press_mentions = ?,
              net_worth = ?, followers_estimate = ?,
              vip_score = ?, influence_level = ?,
              raw_search_results = ?, 
              no_results_found = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE guest_id = ?
          `).run(
                        searchResults.profilePhotoUrl, searchResults.jobTitle, searchResults.companyName,
                        searchResults.companySize, searchResults.industry, searchResults.linkedinUrl,
                        searchResults.linkedinConnections,
                        JSON.stringify(searchResults.linkedinCandidates || []),
                        searchResults.needsLinkedInReview ? 1 : 0,
                        searchResults.instagramHandle, searchResults.instagramUrl, searchResults.instagramFollowers,
                        searchResults.twitterHandle, searchResults.twitterUrl, searchResults.twitterFollowers,
                        searchResults.websiteUrl,
                        searchResults.notableInfo, JSON.stringify(searchResults.fullReport || null),
                        searchResults.pressMentions, searchResults.netWorthEstimate, searchResults.followersEstimate,
                        vipScore, influenceLevel,
                        JSON.stringify(searchResults.rawResults),
                        searchResults.noResultsFound ? 1 : 0,
                        guestId
                    );
                } else {
                    db.prepare(`
            INSERT INTO research_results (
              guest_id, profile_photo_url, job_title, company_name, company_size,
              industry, linkedin_url, linkedin_connections, 
              linkedin_candidates, needs_linkedin_review,
              instagram_handle, instagram_url, instagram_followers, 
              twitter_handle, twitter_url, twitter_followers,
              website_url, notable_info, full_report, press_mentions,
              net_worth, followers_estimate,
              vip_score, influence_level, raw_search_results, no_results_found
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
                        guestId, searchResults.profilePhotoUrl, searchResults.jobTitle, searchResults.companyName,
                        searchResults.companySize, searchResults.industry, searchResults.linkedinUrl,
                        searchResults.linkedinConnections,
                        JSON.stringify(searchResults.linkedinCandidates || []),
                        searchResults.needsLinkedInReview ? 1 : 0,
                        searchResults.instagramHandle, searchResults.instagramUrl, searchResults.instagramFollowers,
                        searchResults.twitterHandle, searchResults.twitterUrl, searchResults.twitterFollowers,
                        searchResults.websiteUrl,
                        searchResults.notableInfo, JSON.stringify(searchResults.fullReport || null),
                        searchResults.pressMentions, searchResults.netWorthEstimate, searchResults.followersEstimate,
                        vipScore, influenceLevel, JSON.stringify(searchResults.rawResults),
                        searchResults.noResultsFound ? 1 : 0
                    );
                }

                results.completed++;

                // Delay between requests (quality over speed)
                await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (guestError) {
                results.errors.push({ guestId, error: guestError.message });
            }
        }

        res.json(results);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// In-memory enrichment queue
const enrichmentQueues = new Map();

// Helper to save queue to DB
function saveQueueToDb(queueId, data) {
    try {
        const existing = db.prepare('SELECT id FROM enrichment_queues WHERE id = ?').get(queueId);
        if (existing) {
            db.prepare(`
                UPDATE enrichment_queues SET 
                    completed = ?, 
                    next_index = ?, 
                    status = ?, 
                    errors = ?, 
                    updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `).run(
                data.completed,
                data.nextIndex,
                data.status,
                JSON.stringify(data.errors || []),
                queueId
            );
        } else {
            db.prepare(`
                INSERT INTO enrichment_queues (id, guest_ids, completed, next_index, status, errors, started_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                queueId,
                JSON.stringify(data.guestIds),
                data.completed,
                data.nextIndex,
                data.status,
                JSON.stringify(data.errors || []),
                data.startedAt
            );
        }
    } catch (error) {
        console.error('Error saving queue to DB:', error);
    }
}

// Function to resume any active queues (called on startup)
function resumeActiveQueues() {
    try {
        const activeQueues = db.prepare("SELECT * FROM enrichment_queues WHERE status IN ('running', 'paused')").all();
        console.log(`🔄 Found ${activeQueues.length} active/paused queues to resume...`);

        for (const q of activeQueues) {
            const guestIds = JSON.parse(q.guest_ids);
            const errors = JSON.parse(q.errors || '[]');

            enrichmentQueues.set(q.id, {
                total: guestIds.length,
                completed: q.completed,
                current: null,
                currentName: null,
                errors: errors,
                status: q.status,
                startedAt: q.started_at,
                guestIds: guestIds,
                nextIndex: q.next_index
            });

            if (q.status === 'running') {
                console.log(`▶️ Resuming queue ${q.id} from index ${q.next_index}`);
                processEnrichmentQueue(q.id, guestIds, q.next_index);
            }
        }
    } catch (error) {
        console.error('Error resuming active queues:', error);
    }
}

// POST /api/research/queue/start - Start async enrichment queue
router.post('/queue/start', (req, res) => {
    const { guestIds, batchId, concurrency = 3 } = req.body;

    if (!guestIds || !Array.isArray(guestIds) || guestIds.length === 0) {
        return res.status(400).json({ error: 'Geen gasten geselecteerd' });
    }

    // Limit concurrency to prevent overload (max 5)
    const actualConcurrency = Math.min(Math.max(1, parseInt(concurrency) || 1), 5);

    const queueId = batchId || `queue-${Date.now()}`;

    const queueData = {
        total: guestIds.length,
        completed: 0,
        current: null,
        currentName: null,
        currentProcessing: [], // Track multiple guests being processed
        errors: [],
        status: 'running',
        startedAt: new Date().toISOString(),
        guestIds: guestIds,
        nextIndex: 0,
        concurrency: actualConcurrency
    };

    // Initialize queue status
    enrichmentQueues.set(queueId, queueData);

    // Persist to DB
    saveQueueToDb(queueId, queueData);

    // Start async processing (parallel or sequential based on concurrency)
    if (actualConcurrency > 1) {
        console.log(`🚀 Starting parallel enrichment with concurrency: ${actualConcurrency}`);
        processEnrichmentQueueParallel(queueId, guestIds, actualConcurrency);
    } else {
        processEnrichmentQueue(queueId, guestIds);
    }

    res.json({
        success: true,
        queueId,
        total: guestIds.length,
        concurrency: actualConcurrency,
        message: `Enrichment gestart${actualConcurrency > 1 ? ` (${actualConcurrency}x parallel)` : ''}`
    });
});


// POST /api/research/queue/start-pending - Start enrichment for all guests who don't have results
router.post('/queue/start-pending', (req, res) => {
    try {
        const { concurrency = 3 } = req.body || {};

        const pendingGuests = db.prepare(`
            SELECT id FROM guests g
            WHERE NOT EXISTS (SELECT 1 FROM research_results r WHERE r.guest_id = g.id)
        `).all();

        if (pendingGuests.length === 0) {
            return res.json({
                success: true,
                total: 0,
                message: 'Geen wachtende gasten gevonden'
            });
        }

        // Limit concurrency to prevent overload (max 5)
        const actualConcurrency = Math.min(Math.max(1, parseInt(concurrency) || 1), 5);

        const guestIds = pendingGuests.map(g => g.id);
        const queueId = `pending-${Date.now()}`;

        const queueData = {
            total: guestIds.length,
            completed: 0,
            current: null,
            currentName: null,
            currentProcessing: [],
            errors: [],
            status: 'running',
            startedAt: new Date().toISOString(),
            guestIds: guestIds,
            nextIndex: 0,
            concurrency: actualConcurrency
        };

        // Initialize queue status
        enrichmentQueues.set(queueId, queueData);

        // Persist to DB
        saveQueueToDb(queueId, queueData);

        // Start async processing (parallel or sequential)
        if (actualConcurrency > 1) {
            console.log(`🚀 Starting parallel enrichment with concurrency: ${actualConcurrency}`);
            processEnrichmentQueueParallel(queueId, guestIds, actualConcurrency);
        } else {
            processEnrichmentQueue(queueId, guestIds);
        }

        res.json({
            success: true,
            queueId,
            total: guestIds.length,
            concurrency: actualConcurrency,
            message: `Enrichment gestart voor ${guestIds.length} gasten${actualConcurrency > 1 ? ` (${actualConcurrency}x parallel)` : ''}`
        });

    } catch (error) {
        console.error('Start pending error:', error);
        res.status(500).json({ error: error.message });
    }
});


// Async queue processor
async function processEnrichmentQueue(queueId, guestIds, startIndex = 0) {
    const queue = enrichmentQueues.get(queueId);
    if (!queue) return;

    for (let i = startIndex; i < guestIds.length; i++) {
        // Update next index for potential resume
        queue.nextIndex = i;
        saveQueueToDb(queueId, queue);

        // Handle stop
        if (queue.status === 'stopped') {
            console.log(`🛑 Queue ${queueId} stopped by user at index ${i}.`);
            break;
        }

        // Handle pause
        let wasPaused = false;
        while (queue.status === 'paused') {
            if (!wasPaused) {
                saveQueueToDb(queueId, queue);
                wasPaused = true;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (queue.status === 'stopped') break;
        }
        if (wasPaused && queue.status === 'running') {
            saveQueueToDb(queueId, queue);
        }
        if (queue.status === 'stopped') break;

        const guestId = guestIds[i];
        queue.current = guestId;

        // Reset skip flag for current guest
        queue.skipCurrent = false;

        try {
            const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(guestId);
            if (!guest) {
                queue.errors.push({ guestId, error: 'Gast niet gevonden' });
                queue.completed++;
                queue.nextIndex = i + 1;
                continue;
            }

            queue.currentName = guest.full_name;

            // Check existing research (Skip if already exists)
            const existingResearch = db.prepare('SELECT id FROM research_results WHERE guest_id = ?').get(guestId);
            if (existingResearch) {
                console.log(`⏩ Skipping ${guest.full_name} (already researched)`);
                queue.completed++;
                queue.nextIndex = i + 1;
                continue;
            }

            // Perform smart search with timeout
            console.log(`🔍 Enriching ${guest.full_name} (${i + 1}/${guestIds.length})`);

            // 60-second timeout for each guest
            const researchPromise = smartSearch.searchGuest(guest);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Research timeout (180s)')), 180000)
            );

            // Create a promise for manual skip
            const skipPromise = new Promise((resolve) => {
                const checkSkip = setInterval(() => {
                    if (queue.skipCurrent || queue.status === 'stopped') {
                        clearInterval(checkSkip);
                        resolve('skipped');
                    }
                }, 500);
            });

            const result = await Promise.race([researchPromise, timeoutPromise, skipPromise]);

            if (result === 'skipped') {
                console.log(`⏭️ Skipped ${guest.full_name} by user.`);
                queue.completed++;
                queue.nextIndex = i + 1;
                continue;
            }

            const searchResults = result;
            const vipScore = searchResults.vipScore || vipScorer.calculate(searchResults);
            const influenceLevel = searchResults.influenceLevel || vipScorer.getInfluenceLevel(vipScore);

            // Save results
            db.prepare(`
                INSERT INTO research_results (
                    guest_id, profile_photo_url, job_title, company_name, company_size,
                    industry, linkedin_url, linkedin_connections, 
                    linkedin_candidates, needs_linkedin_review,
                    instagram_handle, instagram_url, instagram_followers,
                    twitter_handle, twitter_url, twitter_followers,
                    website_url, notable_info, full_report, press_mentions,
                    net_worth, followers_estimate, vip_score, influence_level, raw_search_results, no_results_found
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                guestId, searchResults.profilePhotoUrl, searchResults.jobTitle, searchResults.companyName,
                searchResults.companySize, searchResults.industry, searchResults.linkedinUrl,
                searchResults.linkedinConnections,
                JSON.stringify(searchResults.linkedinCandidates || []),
                searchResults.needsLinkedInReview ? 1 : 0,
                searchResults.instagramHandle, searchResults.instagramUrl, searchResults.instagramFollowers,
                searchResults.twitterHandle, searchResults.twitterUrl, searchResults.twitterFollowers,
                searchResults.websiteUrl,
                searchResults.notableInfo, JSON.stringify(searchResults.fullReport || null),
                searchResults.pressMentions, searchResults.netWorthEstimate, searchResults.followersEstimate,
                vipScore, influenceLevel,
                JSON.stringify(searchResults.rawResults),
                searchResults.noResultsFound ? 1 : 0
            );

            // UPDATE THE MAIN GUEST RECORD with research findings
            updateGuestFromResearch(guestId, searchResults);

            queue.completed++;
            queue.nextIndex = i + 1;
            saveQueueToDb(queueId, queue);
            console.log(`✅ Completed ${guest.full_name} - VIP Score: ${vipScore}`);

            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (err) {
            console.error(`❌ Error enriching guest ${guestId} (${queue.currentName}):`, err.message);
            queue.errors.push({
                guestId,
                name: queue.currentName,
                error: err.message === 'Research timeout (60s)' ? 'Time-out bij onderzoek' : err.message
            });

            // Mark as "No data found" in DB to avoid retrying every time
            try {
                db.prepare(`
                    INSERT OR IGNORE INTO research_results (
                        guest_id, notable_info, vip_score, influence_level
                    ) VALUES (?, ?, 0, 'None')
                `).run(guestId, `Geen gegevens gevonden (${err.message})`);
            } catch (dbErr) {
                console.error(`Failed to save failure marker for guest ${guestId}:`, dbErr.message);
            }

            // Still increment completed so the queue moves on
            queue.completed++;
            queue.nextIndex = i + 1;
            saveQueueToDb(queueId, queue);
        }

    }

    if (queue.status !== 'stopped') {
        queue.status = 'completed';
        queue.current = null;
        queue.currentName = null;
        queue.completedAt = new Date().toISOString();
        saveQueueToDb(queueId, queue);
        console.log(`🎉 Enrichment queue ${queueId} completed: ${queue.completed}/${queue.total}`);
    }
}

// Parallel queue processor - processes multiple guests at once
async function processEnrichmentQueueParallel(queueId, guestIds, concurrency = 3) {
    const queue = enrichmentQueues.get(queueId);
    if (!queue) return;

    console.log(`🚀 Starting parallel processing of ${guestIds.length} guests with concurrency ${concurrency}`);

    // Helper function to process a single guest
    async function processGuest(guestId, index) {
        // Check if queue was stopped
        if (queue.status === 'stopped') {
            return { skipped: true };
        }

        // Wait if paused
        while (queue.status === 'paused') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (queue.status === 'stopped') return { skipped: true };
        }

        try {
            const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(guestId);
            if (!guest) {
                return { guestId, error: 'Gast niet gevonden' };
            }

            // Track current processing
            queue.currentProcessing.push({ guestId, name: guest.full_name });

            // Check existing research
            const existingResearch = db.prepare('SELECT id FROM research_results WHERE guest_id = ?').get(guestId);
            if (existingResearch) {
                console.log(`⏩ Skipping ${guest.full_name} (already researched)`);
                return { guestId, skipped: true, existing: true };
            }

            console.log(`🔍 [${index + 1}/${guestIds.length}] Enriching ${guest.full_name}`);

            // Perform smart search with timeout
            const researchPromise = smartSearch.searchGuest(guest);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Research timeout (180s)')), 180000)
            );

            // Create a promise for manual skip/stop
            const skipPromise = new Promise((resolve) => {
                const checkStatus = setInterval(() => {
                    if (queue.skipCurrent || queue.status === 'stopped') {
                        clearInterval(checkStatus);
                        resolve('skipped');
                    }
                }, 500);
            });

            const result = await Promise.race([researchPromise, timeoutPromise, skipPromise]);

            if (result === 'skipped') {
                console.log(`⏭️ Skipped ${guest.full_name} by user.`);
                return { guestId, skipped: true };
            }

            const searchResults = result;
            const vipScore = searchResults.vipScore || vipScorer.calculate(searchResults);
            const influenceLevel = searchResults.influenceLevel || vipScorer.getInfluenceLevel(vipScore);

            // Save results
            db.prepare(`
                INSERT INTO research_results (
                    guest_id, profile_photo_url, job_title, company_name, company_size,
                    industry, linkedin_url, linkedin_connections, 
                    linkedin_candidates, needs_linkedin_review,
                    instagram_handle, instagram_url, instagram_followers,
                    twitter_handle, twitter_url, twitter_followers,
                    website_url, notable_info, full_report, press_mentions,
                    net_worth, followers_estimate, vip_score, influence_level, raw_search_results
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                guestId, searchResults.profilePhotoUrl, searchResults.jobTitle, searchResults.companyName,
                searchResults.companySize, searchResults.industry, searchResults.linkedinUrl,
                searchResults.linkedinConnections,
                JSON.stringify(searchResults.linkedinCandidates || []),
                searchResults.needsLinkedInReview ? 1 : 0,
                searchResults.instagramHandle, searchResults.instagramUrl, searchResults.instagramFollowers,
                searchResults.twitterHandle, searchResults.twitterUrl, searchResults.twitterFollowers,
                searchResults.websiteUrl,
                searchResults.notableInfo, JSON.stringify(searchResults.fullReport || null),
                searchResults.pressMentions, searchResults.netWorthEstimate, searchResults.followersEstimate,
                vipScore, influenceLevel,
                searchResults.rawResults ? JSON.stringify(searchResults.rawResults) : null
            );

            // UPDATE THE MAIN GUEST RECORD with research findings
            updateGuestFromResearch(guestId, searchResults);

            console.log(`✅ Completed ${guest.full_name} - VIP Score: ${vipScore}`);
            return { guestId, success: true, vipScore };

        } catch (err) {
            console.error(`❌ Error enriching guest ${guestId}:`, err.message);

            // Mark as "No data found" in DB
            try {
                db.prepare(`
                    INSERT OR IGNORE INTO research_results (
                        guest_id, notable_info, vip_score, influence_level
                    ) VALUES (?, ?, 0, 'None')
                `).run(guestId, `Geen gegevens gevonden (${err.message})`);
            } catch (dbErr) {
                // Ignore DB errors
            }

            return { guestId, error: err.message };
        } finally {
            // Remove from currentProcessing
            queue.currentProcessing = queue.currentProcessing.filter(p => p.guestId !== guestId);
        }
    }

    // Process guests in batches with controlled concurrency
    const results = [];
    for (let i = 0; i < guestIds.length; i += concurrency) {
        if (queue.status === 'stopped') break;

        const batch = guestIds.slice(i, i + concurrency);
        const batchPromises = batch.map((guestId, batchIndex) =>
            processGuest(guestId, i + batchIndex)
        );

        const batchResults = await Promise.all(batchPromises);

        for (const result of batchResults) {
            if (result.error) {
                queue.errors.push({ guestId: result.guestId, error: result.error });
            }
            queue.completed++;
        }

        queue.nextIndex = Math.min(i + concurrency, guestIds.length);
        saveQueueToDb(queueId, queue);

        console.log(`📊 Progress: ${queue.completed}/${queue.total} (${Math.round(queue.completed / queue.total * 100)}%)`);

        // Small delay between batches to be nice to APIs
        if (i + concurrency < guestIds.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    if (queue.status !== 'stopped') {
        queue.status = 'completed';
        queue.currentProcessing = [];
        queue.completedAt = new Date().toISOString();
        saveQueueToDb(queueId, queue);
        console.log(`🎉 Parallel enrichment completed: ${queue.completed}/${queue.total}`);
    }
}


// GET /api/research/queue/active - Find any active queue
router.get('/queue/active', (req, res) => {
    let activeQueue = null;
    let activeId = null;

    // First look for running queues, then paused, then recently completed
    for (const [id, queue] of enrichmentQueues.entries()) {
        if (queue.status === 'running') {
            activeQueue = queue;
            activeId = id;
            break;
        }
    }

    // If no running queue, check for paused
    if (!activeQueue) {
        for (const [id, queue] of enrichmentQueues.entries()) {
            if (queue.status === 'paused') {
                activeQueue = queue;
                activeId = id;
                break;
            }
        }
    }

    // If still nothing, check for recently completed (within last 5 seconds)
    if (!activeQueue) {
        for (const [id, queue] of enrichmentQueues.entries()) {
            if (queue.status === 'completed' && queue.completedAt) {
                const completedAgo = Date.now() - new Date(queue.completedAt).getTime();
                if (completedAgo < 5000) {
                    activeQueue = queue;
                    activeId = id;
                    break;
                }
            }
        }
    }

    if (!activeQueue) {
        return res.json({ active: false });
    }

    res.json({
        active: true,
        queueId: activeId,
        ...activeQueue,
        progress: activeQueue.total > 0 ? Math.round((activeQueue.completed / activeQueue.total) * 100) : 0
    });
});

// POST /api/research/queue/:queueId/pause - Pause a running queue
router.post('/queue/:queueId/pause', (req, res) => {
    const queue = enrichmentQueues.get(req.params.queueId);
    if (!queue) return res.status(404).json({ error: 'Queue niet gevonden' });

    queue.status = 'paused';
    saveQueueToDb(req.params.queueId, queue);
    res.json({ success: true, status: 'paused' });
});

// POST /api/research/queue/:queueId/resume - Resume a paused or stopped queue
router.post('/queue/:queueId/resume', (req, res) => {
    const queue = enrichmentQueues.get(req.params.queueId);
    if (!queue) return res.status(404).json({ error: 'Queue niet gevonden' });

    const prevStatus = queue.status;
    queue.status = 'running';

    // If it was stopped, we need to restart the async processor
    if (prevStatus === 'stopped') {
        console.log(`▶️ Restarting stopped queue ${req.params.queueId} from index ${queue.nextIndex}`);
        processEnrichmentQueue(req.params.queueId, queue.guestIds, queue.nextIndex);
    }

    res.json({ success: true, status: 'running' });
    saveQueueToDb(req.params.queueId, queue);
});

// POST /api/research/queue/:queueId/stop - Stop a queue completely
router.post('/queue/:queueId/stop', (req, res) => {
    const queue = enrichmentQueues.get(req.params.queueId);
    if (!queue) return res.status(404).json({ error: 'Queue niet gevonden' });

    queue.status = 'stopped';
    saveQueueToDb(req.params.queueId, queue);
    res.json({ success: true, status: 'stopped' });
});

// POST /api/research/queue/:queueId/skip - Skip current guest
router.post('/queue/:queueId/skip', (req, res) => {
    const queue = enrichmentQueues.get(req.params.queueId);
    if (!queue) return res.status(404).json({ error: 'Queue niet gevonden' });

    queue.skipCurrent = true;
    res.json({ success: true, message: 'Overslaan geactiveerd' });
});


// GET /api/research/queue/:queueId - Get queue status
router.get('/queue/:queueId', (req, res) => {
    const queue = enrichmentQueues.get(req.params.queueId);

    if (!queue) {
        return res.status(404).json({ error: 'Queue niet gevonden' });
    }

    res.json({
        ...queue,
        progress: queue.total > 0 ? Math.round((queue.completed / queue.total) * 100) : 0
    });
});

// GET /api/research/queue/:queueId/stream - SSE stream for progress
router.get('/queue/:queueId/stream', (req, res) => {
    const queueId = req.params.queueId;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendStatus = () => {
        const queue = enrichmentQueues.get(queueId);
        if (!queue) {
            res.write(`data: ${JSON.stringify({ error: 'Queue niet gevonden' })}\n\n`);
            res.end();
            return false;
        }

        res.write(`data: ${JSON.stringify({
            ...queue,
            progress: queue.total > 0 ? Math.round((queue.completed / queue.total) * 100) : 0
        })}\n\n`);

        return queue.status !== 'completed';
    };

    // Send initial status
    sendStatus();

    // Poll and send updates
    const interval = setInterval(() => {
        const shouldContinue = sendStatus();
        if (!shouldContinue) {
            clearInterval(interval);
            res.end();
        }
    }, 1000);

    // Cleanup on disconnect
    req.on('close', () => {
        clearInterval(interval);
    });
});


// GET /api/research/:guestId - Get research results for a guest
router.get('/:guestId', (req, res) => {
    try {
        const { guestId } = req.params;

        const research = db.prepare('SELECT * FROM research_results WHERE guest_id = ?').get(guestId);

        if (!research) {
            return res.status(404).json({ error: 'Geen research gevonden' });
        }

        // Parse linkedin_candidates if it exists
        if (research.linkedin_candidates) {
            try {
                research.linkedin_candidates = JSON.parse(research.linkedin_candidates);
            } catch (e) {
                research.linkedin_candidates = [];
            }
        }

        res.json(research);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/research/:guestId/select-linkedin - Select a LinkedIn profile from candidates
router.put('/:guestId/select-linkedin', async (req, res) => {
    try {
        const { guestId } = req.params;
        const { candidateIndex, manualUrl, profilePhotoUrl: photoOverride } = req.body;

        // Get guest and existing research
        const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(guestId);
        const research = db.prepare('SELECT * FROM research_results WHERE guest_id = ?').get(guestId);

        if (!guest) {
            return res.status(404).json({ error: 'Gast niet gevonden' });
        }

        if (!research) {
            return res.status(404).json({ error: 'Geen research gevonden' });
        }

        let selectedCandidate;

        if (manualUrl) {
            console.log(`🔗 User provided manual LinkedIn URL: ${manualUrl}`);
            selectedCandidate = {
                url: manualUrl,
                title: guest.full_name,
                snippet: 'Handmatig ingevoerd profiel'
            };
        } else {
            // Parse candidates
            let candidates = [];
            try {
                candidates = JSON.parse(research.linkedin_candidates || '[]');
            } catch (e) {
                return res.status(400).json({ error: 'Geen LinkedIn kandidaten beschikbaar' });
            }

            if (candidateIndex === undefined || candidateIndex < 0 || candidateIndex >= candidates.length) {
                return res.status(400).json({ error: 'Ongeldige kandidaat index' });
            }

            selectedCandidate = candidates[candidateIndex];
            console.log(`🔗 User selected LinkedIn profile: ${selectedCandidate.url}`);
        }

        // Use thumbnail from selected candidate (or manual override if provided)
        const profilePhotoUrl = photoOverride || selectedCandidate.thumbnail || null;




        // Perform NEW AI analysis with this specific LinkedIn profile
        const linkedinInfo = {
            bestMatch: selectedCandidate,
            candidates: manualUrl ? [] : (JSON.parse(research.linkedin_candidates || '[]')),
            needsReview: false
        };

        const analysis = await smartSearch.analyzeWithAI(guest, linkedinInfo);
        const vipScore = analysis.vip_score || 5;
        const influenceLevel = analysis.influence_level || 'Gemiddeld';

        // Update research with selected LinkedIn profile AND new analysis
        db.prepare(`
            UPDATE research_results SET
                linkedin_url = ?,
                profile_photo_url = ?,
                job_title = ?,
                company_name = ?,
                company_size = ?,
                industry = ?,
                is_owner = ?,
                employment_type = ?,
                notable_info = ?,
                full_report = ?,
                vip_score = ?,
                influence_level = ?,
                needs_linkedin_review = 0,
                no_results_found = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE guest_id = ?
        `).run(
            selectedCandidate.url,
            profilePhotoUrl,
            selectedCandidate.jobTitle || analysis.job_title || research.job_title,
            selectedCandidate.company || analysis.company_name || research.company_name,
            analysis.company_size || research.company_size,
            analysis.industry || research.industry,
            analysis.is_owner === true ? 1 : (analysis.is_owner === false ? 0 : (research.is_owner)),
            analysis.employment_type || research.employment_type,
            analysis.notable_info || research.notable_info,
            JSON.stringify(analysis.full_report || null),
            vipScore,
            influenceLevel,
            guestId
        );

        res.json({
            success: true,
            message: 'LinkedIn profiel geselecteerd en rapport bijgewerkt',
            selected: selectedCandidate,
            analysis: analysis
        });

    } catch (error) {
        console.error('Select LinkedIn error:', error);
        res.status(500).json({ error: error.message });
    }
});


module.exports = {
    router,
    resumeActiveQueues
};
