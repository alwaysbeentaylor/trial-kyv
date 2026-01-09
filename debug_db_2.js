const db = require('./backend/src/db/database');

try {
    const results = db.prepare(`
        SELECT 
            g.id, 
            g.full_name, 
            g.job_title as g_job, 
            r.job_title as r_job, 
            r.vip_score,
            r.id as r_id
        FROM guests g 
        LEFT JOIN research_results r ON r.guest_id = g.id
        LIMIT 5
    `).all();

    console.log('--- Query Results ---');
    console.table(results);

    // Check collision behavior
    const collisionTest = db.prepare(`
        SELECT 
            g.*, 
            r.job_title 
        FROM guests g 
        LEFT JOIN research_results r ON r.guest_id = g.id
        LIMIT 1
    `).get();

    console.log('--- Collision Test Object Keys ---');
    console.log(Object.keys(collisionTest));
    console.log('job_title value:', collisionTest.job_title);

} catch (error) {
    console.error('Error:', error);
}
