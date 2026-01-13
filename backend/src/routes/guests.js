const express = require('express');
const router = express.Router();
const db = require('../db/database');
const researchController = require('../services/researchController');

// GET /api/guests - List all guests with filters
router.get('/', (req, res) => {
    try {
        const { search, country, hasResearch, vipOnly, sort = 'newest', limit = 100, offset = 0 } = req.query;

        let query = `
      SELECT 
        g.*,
        r.vip_score,
        r.job_title,
        r.company_name as research_company,
        r.industry,
        r.linkedin_url,
        r.instagram_url,
        r.instagram_handle,
        r.twitter_url,
        r.twitter_handle,
        r.facebook_url,
        r.youtube_url,
        r.website_url,
        r.net_worth,
        r.followers_estimate,
        r.influence_level,
        r.researched_at,
        r.profile_photo_url,
        r.needs_linkedin_review,
        r.linkedin_candidates,
        r.raw_search_results,
        (SELECT COUNT(*) FROM reservations WHERE guest_id = g.id) as reservation_count
      FROM guests g
      LEFT JOIN research_results r ON r.guest_id = g.id
      WHERE 1=1
    `;

        const params = [];

        if (search) {
            query += ` AND (g.full_name LIKE ? OR g.email LIKE ? OR g.company LIKE ? OR r.job_title LIKE ? OR r.company_name LIKE ?)`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        if (country) {
            query += ` AND g.country = ?`;
            params.push(country);
        }

        if (hasResearch === 'true') {
            query += ` AND r.id IS NOT NULL`;
        } else if (hasResearch === 'false') {
            query += ` AND r.id IS NULL`;
        }

        if (req.query.minVipScore) {
            query += ` AND r.vip_score >= ?`;
            params.push(parseInt(req.query.minVipScore));
        } else if (vipOnly === 'true') {
            query += ` AND r.vip_score >= 7`;
        }

        // Sortering met meerdere opties
        let orderClause = '';
        switch (sort) {
            case 'oldest':
                orderClause = 'g.created_at ASC';
                break;
            case 'newest':
                orderClause = 'g.created_at DESC';
                break;
            case 'name_asc':
                orderClause = 'g.full_name COLLATE NOCASE ASC';
                break;
            case 'name_desc':
                orderClause = 'g.full_name COLLATE NOCASE DESC';
                break;
            case 'vip_high':
                orderClause = 'COALESCE(r.vip_score, 0) DESC, g.created_at DESC';
                break;
            case 'vip_low':
                orderClause = 'COALESCE(r.vip_score, 0) ASC, g.created_at DESC';
                break;
            case 'company_asc':
                orderClause = 'COALESCE(r.company_name, g.company, "") COLLATE NOCASE ASC, g.full_name COLLATE NOCASE ASC';
                break;
            case 'company_desc':
                orderClause = 'COALESCE(r.company_name, g.company, "") COLLATE NOCASE DESC, g.full_name COLLATE NOCASE ASC';
                break;
            case 'country_asc':
                orderClause = 'COALESCE(g.country, "") COLLATE NOCASE ASC, g.full_name COLLATE NOCASE ASC';
                break;
            case 'country_desc':
                orderClause = 'COALESCE(g.country, "") COLLATE NOCASE DESC, g.full_name COLLATE NOCASE ASC';
                break;
            default:
                orderClause = 'g.created_at DESC';
        }
        query += ` ORDER BY ${orderClause} LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), parseInt(offset));

        const guests = db.prepare(query).all(...params);

        // Get total count for pagination
        let countQuery = `
      SELECT COUNT(*) as total FROM guests g
      LEFT JOIN research_results r ON r.guest_id = g.id
      WHERE 1=1
    `;
        const countParams = [];

        if (search) {
            countQuery += ` AND (g.full_name LIKE ? OR g.email LIKE ? OR g.company LIKE ? OR r.job_title LIKE ? OR r.company_name LIKE ?)`;
            const searchTerm = `%${search}%`;
            countParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        if (country) {
            countQuery += ` AND g.country = ?`;
            countParams.push(country);
        }

        if (hasResearch === 'true') {
            countQuery += ` AND r.id IS NOT NULL`;
        } else if (hasResearch === 'false') {
            countQuery += ` AND r.id IS NULL`;
        }

        if (req.query.minVipScore) {
            countQuery += ` AND r.vip_score >= ?`;
            countParams.push(parseInt(req.query.minVipScore));
        } else if (vipOnly === 'true') {
            countQuery += ` AND r.vip_score >= 7`;
        }

        const { total } = db.prepare(countQuery).get(...countParams);

        res.json({
            guests,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/guests/:id - Get single guest with full details
router.get('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const guest = db.prepare(`
      SELECT * FROM guests WHERE id = ?
    `).get(id);

        if (!guest) {
            return res.status(404).json({ error: 'Gast niet gevonden' });
        }

        // Get research results
        const research = db.prepare(`
      SELECT * FROM research_results WHERE guest_id = ?
    `).get(id);

        // Get reservations
        const reservations = db.prepare(`
      SELECT * FROM reservations WHERE guest_id = ? ORDER BY check_in_date DESC
    `).all(id);

        // Get deal suggestions
        const suggestions = db.prepare(`
      SELECT * FROM deal_suggestions WHERE guest_id = ? ORDER BY generated_at DESC
    `).all(id);

        res.json({
            ...guest,
            research,
            reservations,
            suggestions
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/guests - Add guest manually
router.post('/', (req, res) => {
    try {
        const { full_name, email, phone, country, company, notes } = req.body;

        if (!full_name || full_name.trim() === '') {
            return res.status(400).json({ error: 'Naam is verplicht' });
        }

        // Check if guest with same name exists (case-insensitive)
        const existingByName = db.prepare('SELECT id, full_name FROM guests WHERE LOWER(full_name) = LOWER(?)').get(full_name.trim());
        if (existingByName) {
            return res.status(409).json({
                error: `Er bestaat al een gast met de naam "${existingByName.full_name}"`,
                existingId: existingByName.id
            });
        }

        // Check if guest with same email exists
        if (email) {
            const existing = db.prepare('SELECT id FROM guests WHERE email = ?').get(email);
            if (existing) {
                return res.status(409).json({
                    error: 'Er bestaat al een gast met dit e-mailadres',
                    existingId: existing.id
                });
            }
        }

        const result = db.prepare(`
      INSERT INTO guests (full_name, email, phone, country, company, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(full_name.trim(), email || null, phone || null, country || null, company || null, notes || null);

        const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(result.lastInsertRowid);

        // Automatically start research in background
        // We do NOT await this promise because we want to return the guest immediately to the UI
        try {
            const language = req.headers['accept-language'] || 'nl';
            console.log(`🚀 Triggering auto-research for new guest: ${guest.full_name} (${language})`);
            researchController.performResearch(guest.id, { language })
                .then(() => console.log(`✅ Auto-research completed for guest ${guest.id}: ${guest.full_name}`))
                .catch(err => console.error(`❌ Auto-research failed for guest ${guest.id}:`, err.message));
        } catch (researchError) {
            console.error('Failed to trigger auto-research:', researchError);
            // Don't fail the request, just log it
        }

        res.status(201).json(guest);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/guests/:id - Update guest
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, email, phone, country, company, notes } = req.body;

        const existing = db.prepare('SELECT id FROM guests WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Gast niet gevonden' });
        }

        db.prepare(`
      UPDATE guests 
      SET full_name = COALESCE(?, full_name),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          country = COALESCE(?, country),
          company = COALESCE(?, company),
          notes = COALESCE(?, notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(full_name, email, phone, country, company, notes, id);

        // Also update profile_photo_url if provided in body
        const { profile_photo_url } = req.body;
        if (profile_photo_url !== undefined) {
            const hasResearch = db.prepare('SELECT id FROM research_results WHERE guest_id = ?').get(id);
            if (hasResearch) {
                db.prepare(`
                    UPDATE research_results 
                    SET profile_photo_url = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE guest_id = ?
                `).run(profile_photo_url, id);
            } else if (profile_photo_url) {
                db.prepare(`
                    INSERT INTO research_results (guest_id, profile_photo_url)
                    VALUES (?, ?)
                `).run(id, profile_photo_url);
            }
        }


        const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(id);

        res.json(guest);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/guests/:id - Delete guest
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;

        const existing = db.prepare('SELECT id FROM guests WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ error: 'Gast niet gevonden' });
        }

        db.prepare('DELETE FROM guests WHERE id = ?').run(id);

        res.json({ success: true, message: 'Gast verwijderd' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/guests/bulk-delete - Delete multiple guests at once
router.post('/bulk-delete', (req, res) => {
    try {
        const { guestIds } = req.body;

        if (!guestIds || !Array.isArray(guestIds) || guestIds.length === 0) {
            return res.status(400).json({ error: 'Geen gasten geselecteerd om te verwijderen' });
        }

        // Begin transaction for bulk delete
        const deleteGuest = db.prepare('DELETE FROM guests WHERE id = ?');
        const deleteResearch = db.prepare('DELETE FROM research_results WHERE guest_id = ?');
        const deleteReservations = db.prepare('DELETE FROM reservations WHERE guest_id = ?');
        const deleteSuggestions = db.prepare('DELETE FROM deal_suggestions WHERE guest_id = ?');

        const deleteMany = db.transaction((ids) => {
            let deletedCount = 0;
            for (const id of ids) {
                // Delete related data first
                deleteResearch.run(id);
                deleteReservations.run(id);
                deleteSuggestions.run(id);
                // Then delete the guest
                const result = deleteGuest.run(id);
                if (result.changes > 0) deletedCount++;
            }
            return deletedCount;
        });

        const deletedCount = deleteMany(guestIds);

        res.json({
            success: true,
            message: `${deletedCount} gast${deletedCount !== 1 ? 'en' : ''} verwijderd`,
            deletedCount
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/guests/:id/vip-score - Update VIP score manually
router.put('/:id/vip-score', (req, res) => {
    try {
        const { id } = req.params;
        const { vip_score } = req.body;

        if (vip_score < 1 || vip_score > 10) {
            return res.status(400).json({ error: 'VIP score moet tussen 1 en 10 zijn' });
        }

        // Check if research exists - only allow update if research already exists
        const research = db.prepare('SELECT id FROM research_results WHERE guest_id = ?').get(id);

        if (!research) {
            return res.status(400).json({ error: 'Voer eerst onderzoek uit voordat je de VIP score kunt aanpassen' });
        }

        db.prepare(`
        UPDATE research_results 
        SET vip_score = ?, updated_at = CURRENT_TIMESTAMP
        WHERE guest_id = ?
      `).run(vip_score, id);

        const updatedResearch = db.prepare('SELECT * FROM research_results WHERE guest_id = ?').get(id);

        res.json(updatedResearch);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/guests/countries/list - Get list of all countries
router.get('/countries/list', (req, res) => {
    try {
        const countries = db.prepare(`
      SELECT DISTINCT country FROM guests 
      WHERE country IS NOT NULL AND country != ''
      ORDER BY country
    `).all();

        res.json(countries.map(c => c.country));

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
