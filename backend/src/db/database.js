const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'database.sqlite');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  -- Guests table
  CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    full_name TEXT NOT NULL,
    job_title TEXT,
    phone TEXT,
    country TEXT,
    company TEXT,
    first_seen DATE DEFAULT CURRENT_DATE,
    last_stay DATE,
    total_stays INTEGER DEFAULT 1,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Create index on email for faster lookups (not unique - email can be null)
  CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email);
  CREATE INDEX IF NOT EXISTS idx_guests_name ON guests(full_name);

  -- Research results table
  CREATE TABLE IF NOT EXISTS research_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER REFERENCES guests(id) ON DELETE CASCADE,
    profile_photo_url TEXT,
    job_title TEXT,
    company_name TEXT,
    company_size TEXT,
    industry TEXT,
    linkedin_url TEXT,
    linkedin_connections INTEGER,
    instagram_handle TEXT,
    instagram_followers INTEGER,
    twitter_handle TEXT,
    twitter_followers INTEGER,
    website_url TEXT,
    notable_info TEXT,
    full_report TEXT,
    press_mentions TEXT,
    vip_score INTEGER DEFAULT 5 CHECK(vip_score BETWEEN 1 AND 10),
    influence_level TEXT CHECK(influence_level IN ('Laag', 'Gemiddeld', 'Hoog', 'VIP')),
    raw_search_results TEXT,
    no_results_found INTEGER DEFAULT 0,
    researched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_research_guest ON research_results(guest_id);

  -- Deal suggestions table (for future AI integration)
  CREATE TABLE IF NOT EXISTS deal_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER REFERENCES guests(id) ON DELETE CASCADE,
    suggestion_type TEXT,
    suggestion_text TEXT,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Reservations table (links to Mews data)
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER REFERENCES guests(id) ON DELETE CASCADE,
    mews_reservation_id TEXT,
    room_number TEXT,
    room_category TEXT,
    check_in_date DATE,
    check_out_date DATE,
    number_of_guests INTEGER,
    total_amount DECIMAL,
    products TEXT,
    booking_status TEXT,
    import_batch_id TEXT,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_reservations_guest ON reservations(guest_id);
  CREATE INDEX IF NOT EXISTS idx_reservations_batch ON reservations(import_batch_id);

  -- Import batches table (for tracking Excel imports)
  CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    filename TEXT,
    imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_rows INTEGER DEFAULT 0,
    new_guests INTEGER DEFAULT 0,
    updated_guests INTEGER DEFAULT 0,
    skipped_rows INTEGER DEFAULT 0,
    status TEXT DEFAULT 'completed'
  );

  -- Guest history table (tracks field changes)
  CREATE TABLE IF NOT EXISTS guest_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_id INTEGER REFERENCES guests(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    import_batch_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_guest_history_guest ON guest_history(guest_id);

  -- Enrichment queues table (for persisting background research)
  CREATE TABLE IF NOT EXISTS enrichment_queues (
    id TEXT PRIMARY KEY,
    guest_ids TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    next_index INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    errors TEXT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- SerpAPI cache table (to reduce API costs)
  CREATE TABLE IF NOT EXISTS serpapi_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_hash TEXT UNIQUE NOT NULL,
    query_text TEXT NOT NULL,
    search_type TEXT NOT NULL,
    result_data TEXT NOT NULL,
    hit_count INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME DEFAULT (datetime('now', '+30 days'))
  );

  CREATE INDEX IF NOT EXISTS idx_serpapi_cache_hash ON serpapi_cache(query_hash);
  CREATE INDEX IF NOT EXISTS idx_serpapi_cache_expires ON serpapi_cache(expires_at);

  -- Page views table (landing page analytics)
  CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_hash TEXT NOT NULL,
    page_path TEXT NOT NULL,
    referrer TEXT,
    user_agent TEXT,
    country TEXT,
    city TEXT,
    visited_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_page_views_visitor ON page_views(visitor_hash);
  CREATE INDEX IF NOT EXISTS idx_page_views_date ON page_views(visited_at);

  -- Analytics events table (CTA clicks, form submissions, etc.)
  CREATE TABLE IF NOT EXISTS analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_hash TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT,
    page_path TEXT,
    occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_analytics_events_date ON analytics_events(occurred_at);
`);

// Migrations
try {
  // Research results migrations
  const researchInfo = db.prepare("PRAGMA table_info(research_results)").all();
  const hasFullReport = researchInfo.some(col => col.name === 'full_report');
  const hasInstagramUrl = researchInfo.some(col => col.name === 'instagram_url');
  const hasTwitterUrl = researchInfo.some(col => col.name === 'twitter_url');

  if (!hasFullReport) {
    console.log('🔄 Adding full_report column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN full_report TEXT").run();
    console.log('✅ Column added successfully');
  }

  if (!hasInstagramUrl) {
    console.log('🔄 Adding instagram_url column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN instagram_url TEXT").run();
    console.log('✅ instagram_url column added successfully');
  }

  if (!hasTwitterUrl) {
    console.log('🔄 Adding twitter_url column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN twitter_url TEXT").run();
    console.log('✅ twitter_url column added successfully');
  }

  // New social media profile columns
  const hasTwitterBio = researchInfo.some(col => col.name === 'twitter_bio');
  const hasTwitterLocation = researchInfo.some(col => col.name === 'twitter_location');
  const hasTwitterMemberSince = researchInfo.some(col => col.name === 'twitter_member_since');
  const hasInstagramBio = researchInfo.some(col => col.name === 'instagram_bio');
  const hasInstagramLocation = researchInfo.some(col => col.name === 'instagram_location');
  const hasSocialMediaLocation = researchInfo.some(col => col.name === 'social_media_location');

  if (!hasTwitterBio) {
    console.log('🔄 Adding twitter_bio column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN twitter_bio TEXT").run();
    console.log('✅ twitter_bio column added successfully');
  }

  if (!hasTwitterLocation) {
    console.log('🔄 Adding twitter_location column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN twitter_location TEXT").run();
    console.log('✅ twitter_location column added successfully');
  }

  if (!hasTwitterMemberSince) {
    console.log('🔄 Adding twitter_member_since column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN twitter_member_since TEXT").run();
    console.log('✅ twitter_member_since column added successfully');
  }

  if (!hasInstagramBio) {
    console.log('🔄 Adding instagram_bio column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN instagram_bio TEXT").run();
    console.log('✅ instagram_bio column added successfully');
  }

  if (!hasInstagramLocation) {
    console.log('🔄 Adding instagram_location column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN instagram_location TEXT").run();
    console.log('✅ instagram_location column added successfully');
  }

  if (!hasSocialMediaLocation) {
    console.log('🔄 Adding social_media_location column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN social_media_location TEXT").run();
    console.log('✅ social_media_location column added successfully');
  }

  // Guests table migrations
  const guestInfo = db.prepare("PRAGMA table_info(guests)").all();
  const hasAddress = guestInfo.some(col => col.name === 'address');
  const hasMarketingConsent = guestInfo.some(col => col.name === 'marketing_consent');
  const hasImportBatchId = guestInfo.some(col => col.name === 'import_batch_id');

  if (!hasAddress) {
    console.log('🔄 Adding address column to guests...');
    db.prepare("ALTER TABLE guests ADD COLUMN address TEXT").run();
    console.log('✅ address column added successfully');
  }

  if (!hasMarketingConsent) {
    console.log('🔄 Adding marketing_consent column to guests...');
    db.prepare("ALTER TABLE guests ADD COLUMN marketing_consent BOOLEAN").run();
    console.log('✅ marketing_consent column added successfully');
  }

  if (!hasImportBatchId) {
    console.log('🔄 Adding import_batch_id column to guests...');
    db.prepare("ALTER TABLE guests ADD COLUMN import_batch_id TEXT").run();
    console.log('✅ import_batch_id column added successfully');
  }

  const hasJobTitle = guestInfo.some(col => col.name === 'job_title');
  if (!hasJobTitle) {
    console.log('🔄 Adding job_title column to guests...');
    db.prepare("ALTER TABLE guests ADD COLUMN job_title TEXT").run();
    console.log('✅ job_title column added successfully');
  }

  // Reservations table migrations
  const reservationInfo = db.prepare("PRAGMA table_info(reservations)").all();
  const hasRoomCategory = reservationInfo.some(col => col.name === 'room_category');
  const hasTotalAmount = reservationInfo.some(col => col.name === 'total_amount');
  const hasProducts = reservationInfo.some(col => col.name === 'products');
  const hasBookingStatus = reservationInfo.some(col => col.name === 'booking_status');

  if (!hasRoomCategory) {
    console.log('🔄 Adding room_category column to reservations...');
    db.prepare("ALTER TABLE reservations ADD COLUMN room_category TEXT").run();
    console.log('✅ room_category column added successfully');
  }

  if (!hasTotalAmount) {
    console.log('🔄 Adding total_amount column to reservations...');
    db.prepare("ALTER TABLE reservations ADD COLUMN total_amount DECIMAL").run();
    console.log('✅ total_amount column added successfully');
  }

  if (!hasProducts) {
    console.log('🔄 Adding products column to reservations...');
    db.prepare("ALTER TABLE reservations ADD COLUMN products TEXT").run();
    console.log('✅ products column added successfully');
  }

  if (!hasBookingStatus) {
    console.log('🔄 Adding booking_status column to reservations...');
    db.prepare("ALTER TABLE reservations ADD COLUMN booking_status TEXT").run();
    console.log('✅ booking_status column added successfully');
  }

  // AI Research Assistant columns (custom input and undo/restore functionality)
  const hasCustomResearchInput = researchInfo.some(col => col.name === 'custom_research_input');
  const hasPreviousFullReport = researchInfo.some(col => col.name === 'previous_full_report');
  const hasPreviousVipScore = researchInfo.some(col => col.name === 'previous_vip_score');

  if (!hasCustomResearchInput) {
    console.log('🔄 Adding custom_research_input column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN custom_research_input TEXT").run();
    console.log('✅ custom_research_input column added successfully');
  }

  if (!hasPreviousFullReport) {
    console.log('🔄 Adding previous_full_report column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN previous_full_report TEXT").run();
    console.log('✅ previous_full_report column added successfully');
  }

  if (!hasPreviousVipScore) {
    console.log('🔄 Adding previous_vip_score column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN previous_vip_score INTEGER").run();
    console.log('✅ previous_vip_score column added successfully');
  }

  // CRITICAL: Missing columns that break research saving
  const hasLinkedinCandidates = researchInfo.some(col => col.name === 'linkedin_candidates');
  const hasNeedsLinkedinReview = researchInfo.some(col => col.name === 'needs_linkedin_review');
  const hasIsOwner = researchInfo.some(col => col.name === 'is_owner');
  const hasEmploymentType = researchInfo.some(col => col.name === 'employment_type');
  const hasNetWorth = researchInfo.some(col => col.name === 'net_worth');
  const hasFollowersEstimate = researchInfo.some(col => col.name === 'followers_estimate');
  const hasFacebookUrl = researchInfo.some(col => col.name === 'facebook_url');
  const hasYoutubeUrl = researchInfo.some(col => col.name === 'youtube_url');

  if (!hasLinkedinCandidates) {
    console.log('🔄 Adding linkedin_candidates column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN linkedin_candidates TEXT").run();
    console.log('✅ linkedin_candidates column added successfully');
  }

  if (!hasNeedsLinkedinReview) {
    console.log('🔄 Adding needs_linkedin_review column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN needs_linkedin_review INTEGER DEFAULT 0").run();
    console.log('✅ needs_linkedin_review column added successfully');
  }

  if (!hasIsOwner) {
    console.log('🔄 Adding is_owner column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN is_owner INTEGER").run();
    console.log('✅ is_owner column added successfully');
  }

  if (!hasEmploymentType) {
    console.log('🔄 Adding employment_type column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN employment_type TEXT").run();
    console.log('✅ employment_type column added successfully');
  }

  if (!hasNetWorth) {
    console.log('🔄 Adding net_worth column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN net_worth TEXT").run();
    console.log('✅ net_worth column added successfully');
  }

  if (!hasFollowersEstimate) {
    console.log('🔄 Adding followers_estimate column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN followers_estimate INTEGER").run();
    console.log('✅ followers_estimate column added successfully');
  }

  if (!hasFacebookUrl) {
    console.log('🔄 Adding facebook_url column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN facebook_url TEXT").run();
    console.log('✅ facebook_url column added successfully');
  }

  if (!hasYoutubeUrl) {
    console.log('🔄 Adding youtube_url column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN youtube_url TEXT").run();
    console.log('✅ youtube_url column added successfully');
  }

  // Add no_results_found migration
  const hasNoResultsFound = researchInfo.some(col => col.name === 'no_results_found');
  if (!hasNoResultsFound) {
    console.log('🔄 Adding no_results_found column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN no_results_found INTEGER DEFAULT 0").run();
    console.log('✅ no_results_found column added successfully');
  }

  // Add company ownership label migration
  const hasCompanyOwnershipLabel = researchInfo.some(col => col.name === 'company_ownership_label');
  if (!hasCompanyOwnershipLabel) {
    console.log('🔄 Adding company_ownership_label column to research_results...');
    db.prepare("ALTER TABLE research_results ADD COLUMN company_ownership_label TEXT").run();
    console.log('✅ company_ownership_label column added successfully');
  }

  // CRITICAL: Clean up duplicate research results to prevent lists from showing double entries
  console.log('🔄 Cleaning up any duplicate research results...');
  db.prepare(`
    DELETE FROM research_results 
    WHERE id NOT IN (
      SELECT MAX(id) FROM research_results GROUP BY guest_id
    )
  `).run();

  // Ensure unique index on guest_id so it never happens again
  try {
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_research_guest_id_unique ON research_results(guest_id)").run();
    console.log('✅ Unique index on research_results(guest_id) ensured');
  } catch (indexError) {
    console.warn('⚠️ Could not create unique index on guest_id:', indexError.message);
  }

} catch (error) {
  console.error('Migration error:', error);
}

console.log('📦 Database geïnitialiseerd:', dbPath);

module.exports = db;
