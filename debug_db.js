const db = require('./backend/src/db/database');

try {
    const guests = db.prepare('SELECT g.id, g.full_name, g.job_title as guest_job, r.job_title as research_job, r.vip_score FROM guests g LEFT JOIN research_results r ON r.guest_id = g.id').all();
    console.log('Guests with research data:', JSON.stringify(guests, null, 2));

    const research = db.prepare('SELECT * FROM research_results').all();
    console.log('Research Results Count:', research.length);
    if (research.length > 0) {
        console.log('Sample Research:', JSON.stringify(research[0], null, 2));
    }
} catch (error) {
    console.error('Error:', error);
}
