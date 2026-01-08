const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * Google Search service for guest research
 * Uses Puppeteer with 2Captcha reCAPTCHA solving and proxy support
 */

class GoogleSearchService {
    constructor() {
        this.browser = null;
        this.lastRequestTime = 0;
        this.minDelay = parseInt(process.env.GOOGLE_SEARCH_DELAY || '2500'); // 2.5 seconds between searches
        this.apiKey = process.env.TWO_CAPTCHA_API_KEY;
        this.proxyUrl = process.env.PROXY_URL;
        this.proxyAgent = this.proxyUrl ? new HttpsProxyAgent(this.proxyUrl) : null;

        // Log configuration on startup
        console.log('🔧 GoogleSearchService initialized:');
        console.log(`   📦 2Captcha API Key: ${this.apiKey ? '✅ Set (' + this.apiKey.substring(0, 8) + '...)' : '❌ NOT SET!'}`);
        console.log(`   🌐 Proxy URL: ${this.proxyUrl ? '✅ Set' : '❌ NOT SET (using 2Captcha residential proxies)'}`);
        console.log(`   ⏱️ Search delay: ${this.minDelay}ms`);
        this.cookies = new Map();
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        ];
        this.currentUserAgent = this.userAgents[0];

        // Bright Data RESIDENTIAL proxy - real home IPs that Google won't block
        // Format: http://username:password@host:port
        this.proxyPool = [
            'http://brd-customer-hl_18ddad31-zone-residential_proxy1:c9h2heunpf8n@brd.superproxy.io:33335'
        ];
        this.currentProxyIndex = 0;
        this.failedProxies = new Set();
        this.rotateProxyOnNextLaunch = false;
        this.currentProxyInfo = null;
    }

    /**
     * Fetch residential proxy config from 2Captcha API
     * Uses authenticated access (username:password) which works from any IP
     * Unlike whitelist, this doesn't require static IP
     */
    async fetch2CaptchaProxies() {
        if (!this.apiKey) {
            console.log('⚠️ No 2Captcha API key - cannot fetch residential proxies');
            return [];
        }

        // Check if we need to refresh (cache for 5 minutes)
        const now = Date.now();
        if (this.residentialProxies.length > 0 && (now - this.lastProxyFetch) < this.proxyFetchInterval) {
            return this.residentialProxies;
        }

        try {
            console.log('🔄 Fetching 2Captcha residential proxy credentials...');

            // Get account info which includes the proxy username
            const statusUrl = `https://api.2captcha.com/proxy?key=${this.apiKey}`;
            const statusRes = await fetch(statusUrl);
            const statusData = await statusRes.json();

            if (statusData.status === 'OK' && statusData.data?.username) {
                const proxyUsername = statusData.data.username;
                console.log(`✅ 2Captcha Proxy Account Status:`);
                console.log(`   👤 Username: ${proxyUsername}`);
                console.log(`   📊 Traffic Used: ${statusData.data?.use_flow?.toFixed(2) || 0} MB / ${statusData.data?.total_flow || 0} MB`);

                // 2Captcha residential proxy servers - these are the authenticated endpoints
                // Format: http://username:apikey@proxy-server:port
                // The proxy uses your 2Captcha API key as password
                const proxyServers = [
                    { host: 'proxy.2captcha.com', port: 8080 },
                    { host: 'proxy.2captcha.com', port: 8888 },
                ];

                // Build authenticated proxy URLs for Netherlands
                // Adding country/region parameters to the username
                this.residentialProxies = proxyServers.map(server => {
                    // Username format: user-country-nl for Netherlands targeting
                    const targetedUsername = `${proxyUsername}-country-nl`;
                    return `http://${targetedUsername}:${this.apiKey}@${server.host}:${server.port}`;
                });

                this.lastProxyFetch = now;

                console.log(`✅ Configured ${this.residentialProxies.length} 2Captcha residential proxy endpoints:`);
                this.residentialProxies.forEach((p, i) => {
                    // Log without showing full API key
                    const masked = p.replace(this.apiKey, this.apiKey.substring(0, 8) + '...');
                    console.log(`   ${i + 1}. ${masked}`);
                });

                return this.residentialProxies;
            } else {
                console.log('⚠️ 2Captcha proxy account check failed:', JSON.stringify(statusData));
                console.log('   💡 Make sure you have residential proxy traffic at: https://2captcha.com/enterpage/proxy');
            }
        } catch (error) {
            console.error('❌ Error fetching 2Captcha proxy info:', error.message);
        }

        return [];
    }

    /**
     * Get next proxy from rotation pool
     */
    async getNextProxy() {
        // Use proxy from pool
        if (this.proxyPool.length === 0) {
            console.log('⚠️ No proxies in pool - using direct connection');
            return null;
        }

        // Try to find a proxy that hasn't failed recently
        let attempts = 0;
        while (attempts < this.proxyPool.length) {
            const proxy = this.proxyPool[this.currentProxyIndex];
            this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxyPool.length;

            // Skip if this proxy failed recently
            if (!this.failedProxies.has(proxy)) {
                return proxy;
            }
            attempts++;
        }

        // All proxies failed, reset and try again
        this.failedProxies.clear();
        return this.proxyPool[0];
    }

    /**
     * Mark proxy as failed
     */
    markProxyFailed(proxy) {
        if (!proxy) return;
        this.failedProxies.add(proxy);
        // Remove from failed list after 5 minutes
        setTimeout(() => {
            this.failedProxies.delete(proxy);
        }, 5 * 60 * 1000);
    }

    /**
     * Get the currently active proxy URL
     */
    getCurrentProxy() {
        if (this.proxyPool.length === 0) return null;
        // Return the proxy that was last assigned (index - 1, wrapping)
        const idx = (this.currentProxyIndex - 1 + this.proxyPool.length) % this.proxyPool.length;
        return this.proxyPool[idx];
    }

    getRandomUserAgent() {
        if (!this.currentUserAgent) {
            this.currentUserAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
        }
        return this.currentUserAgent;
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async ensureDelay() {
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        if (timeSinceLastRequest < this.minDelay) {
            await this.delay(this.minDelay - timeSinceLastRequest);
        }
        this.lastRequestTime = Date.now();
    }

    async getBrowser(useProxy = true) {
        if (this.rotateProxyOnNextLaunch && this.browser) {
            await this.closeBrowser();
            this.rotateProxyOnNextLaunch = false;
        }

        if (!this.browser) {
            const args = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list'
            ];

            // Use proxy rotation if enabled
            if (useProxy) {
                const proxyUrl = await this.getNextProxy();
                if (proxyUrl) {
                    // 2Captcha whitelist proxies are simple format: http://ip:port (no auth needed)
                    // Other proxies may have auth: https://username:password@host:port
                    const simpleMatch = proxyUrl.match(/^https?:\/\/([^:@]+):(\d+)$/);
                    const authMatch = proxyUrl.match(/^https?:\/\/([^@]+)@([^:]+):(\d+)$/);

                    if (simpleMatch) {
                        // Simple proxy without auth (2Captcha whitelist)
                        const [, host, port] = simpleMatch;
                        args.push(`--proxy-server=${host}:${port}`);
                        this.currentProxyAuth = null;
                        this.currentProxyInfo = { url: proxyUrl, host, port, username: null, password: null };
                        console.log(`🌐 Using proxy: ${host}:${port} (no auth - whitelisted)`);
                    } else if (authMatch) {
                        // Proxy with auth
                        const [, auth, host, port] = authMatch;
                        let username = null;
                        let password = null;

                        // Split auth on last colon (password can't contain colons)
                        const lastColonIndex = auth.lastIndexOf(':');
                        if (lastColonIndex > 0) {
                            username = auth.substring(0, lastColonIndex);
                            password = auth.substring(lastColonIndex + 1);
                        } else {
                            username = auth;
                        }

                        args.push(`--proxy-server=${host}:${port}`);
                        this.currentProxyAuth = username && password ? { username, password } : null;
                        this.currentProxyInfo = { url: proxyUrl, host, port, username, password };
                        console.log(`🌐 Using proxy: ${host}:${port}${username && password ? ' (authenticated)' : ''}`);
                    } else {
                        console.log(`⚠️ Could not parse proxy URL: ${proxyUrl}`);
                    }
                }
            } else if (this.proxyUrl) {
                // Fallback to single proxy from env
                const urlMatch = this.proxyUrl.match(/^https?:\/\/(?:([^@]+)@)?([^:]+):(\d+)$/);
                if (urlMatch) {
                    const [, auth, host, port] = urlMatch;
                    let username = null;
                    let password = null;

                    if (auth) {
                        const lastColonIndex = auth.lastIndexOf(':');
                        if (lastColonIndex > 0) {
                            username = auth.substring(0, lastColonIndex);
                            password = auth.substring(lastColonIndex + 1);
                        } else {
                            username = auth;
                        }
                    }

                    args.push(`--proxy-server=${host}:${port}`);
                    this.currentProxyAuth = username && password ? { username, password } : null;
                    this.currentProxyInfo = { url: this.proxyUrl, host, port, username, password };
                    console.log(`🌐 Using proxy: ${host}:${port}${username && password ? ' (authenticated)' : ''}`);
                }
            }

            // Check if running in serverless environment or Render (which also needs chromium)
            // Render sets RENDER=true, or we can detect by checking if chromium executable exists
            const isServerless = process.env.AWS_LAMBDA_FUNCTION_VERSION ||
                process.env.VERCEL ||
                process.env.RENDER === 'true' ||
                process.env.RENDER_SERVICE_ID; // Render sets this automatically

            // Timeout configuration: longer for production/serverless
            const browserLaunchTimeout = isServerless ? 60000 : 30000;

            if (isServerless) {
                console.log('🌐 Using @sparticuz/chromium for serverless environment');

                // Additional stealth args to avoid bot detection
                const stealthArgs = [
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-infobars',
                    '--window-size=1920,1080',
                    '--start-maximized',
                    '--disable-extensions',
                    '--no-first-run',
                    '--disable-default-apps',
                    '--disable-popup-blocking',
                    '--disable-translate',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-component-update',
                    '--lang=nl-NL,nl',
                    '--accept-lang=nl-NL,nl,en-US,en'
                ];

                // Combine all args, removing duplicates
                const allArgs = [...new Set([...chromium.args, ...args, ...stealthArgs])];

                this.browser = await puppeteer.launch({
                    args: allArgs,
                    defaultViewport: { width: 1920, height: 1080 },
                    executablePath: await chromium.executablePath(),
                    headless: 'new', // Use new headless mode - harder to detect
                    timeout: browserLaunchTimeout,
                    ignoreDefaultArgs: ['--enable-automation'] // Remove automation flag
                });

                // Set default timeouts for all pages created from this browser in production
                this.browser.on('targetcreated', async (target) => {
                    const page = await target.page();
                    if (page) {
                        page.setDefaultNavigationTimeout(60000);
                        page.setDefaultTimeout(60000);
                    }
                });
            } else {
                // Local environment - use regular puppeteer (not puppeteer-core)
                try {
                    const puppeteerRegular = require('puppeteer');
                    this.browser = await puppeteerRegular.launch({
                        headless: 'new',
                        args,
                        timeout: browserLaunchTimeout
                    });
                } catch (error) {
                    // Fallback to chromium if regular puppeteer fails
                    console.log('⚠️ Regular puppeteer failed, falling back to chromium:', error.message);
                    this.browser = await puppeteer.launch({
                        args: chromium.args.concat(args),
                        defaultViewport: chromium.defaultViewport,
                        executablePath: await chromium.executablePath(),
                        headless: chromium.headless,
                        timeout: browserLaunchTimeout
                    });
                }
            }
        }
        return this.browser;
    }

    async closeBrowser() {
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (e) {
                // Ignore close errors
            }
            this.browser = null;
            // Reset proxy auth when closing browser
            this.currentProxyAuth = null;
            this.currentProxyInfo = null;
        }
    }

    /**
     * Make HTTP request (for 2Captcha API)
     * Don't use proxy for 2Captcha calls
     */
    async makeRequest(url, options = {}) {
        const is2Captcha = url.includes('2captcha.com');
        if (!is2Captcha && this.proxyAgent) {
            options.agent = this.proxyAgent;
        }
        return fetch(url, options);
    }

    /**
     * DEEP SEARCH: Scrape multiple Google pages for comprehensive results
     * @param {string} query - Search query
     * @param {number} totalResults - Total results to fetch (will paginate)
     * @returns {Array} - Array of {link, title, snippet}
     */
    async deepSearch(query, totalResults = 100) {
        console.log(`🔎 DEEP Google Search: "${query}" (target: ${totalResults} results)`);

        const allResults = [];
        const resultsPerPage = 10;
        const maxPages = Math.min(Math.ceil(totalResults / resultsPerPage), 10); // Max 10 pages (100 results)

        for (let page = 0; page < maxPages; page++) {
            const start = page * resultsPerPage;
            console.log(`📄 Fetching Google page ${page + 1}/${maxPages} (start=${start})...`);

            const pageResults = await this.searchWithPagination(query, resultsPerPage, start);

            if (pageResults.length === 0) {
                console.log(`⚠️ No more results found at page ${page + 1}, stopping...`);
                break;
            }

            allResults.push(...pageResults);

            if (allResults.length >= totalResults) {
                console.log(`✅ Reached target of ${totalResults} results`);
                break;
            }

            // Longer delay between pages to avoid rate limiting
            await this.delay(3000);
        }

        console.log(`📋 Deep search found ${allResults.length} total results for: ${query}`);
        return allResults;
    }

    /**
     * Search with pagination support
     * @param {string} query - Search query
     * @param {number} num - Results per page
     * @param {number} start - Starting index (0, 10, 20, etc.)
     */
    async searchWithPagination(query, num = 10, start = 0) {
        await this.ensureDelay();

        try {
            const browser = await this.getBrowser();
            const page = await browser.newPage();

            await page.setUserAgent(this.getRandomUserAgent());
            await page.setViewport({ width: 1920, height: 1080 });

            // Apply cookies
            if (this.cookies.size > 0) {
                const cookieArray = Array.from(this.cookies.entries()).map(([name, value]) => ({
                    name,
                    value,
                    domain: '.google.nl',
                    path: '/'
                }));
                await page.setCookie(...cookieArray);
            }

            // Build URL with pagination - use google.nl for Dutch results
            const encodedQuery = encodeURIComponent(query);
            const searchUrl = `https://www.google.nl/search?q=${encodedQuery}&hl=nl&num=${num}&start=${start}`;

            await page.goto(searchUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 45000
            });

            // Save cookies (only valid ones)
            try {
                const pageCookies = await page.cookies();
                pageCookies.forEach(cookie => {
                    if (cookie.name && cookie.value && typeof cookie.value === 'string') {
                        this.cookies.set(cookie.name, cookie.value);
                    }
                });
            } catch (e) { /* ignore */ }

            // Handle consent (only needed on first page)
            if (start === 0) {
                try {
                    await page.waitForSelector('button', { timeout: 3000 });
                    const buttons = await page.$$('button');
                    for (const button of buttons) {
                        const text = await page.evaluate(el => el.textContent, button);
                        if (text && (text.includes('Accept all') || text.includes('Alles accepteren') || text.includes('Ik ga akkoord') || text.includes('I agree'))) {
                            await button.click();
                            await this.delay(2000);
                            break;
                        }
                    }
                } catch (e) {
                    // No consent dialog
                }
            }

            // Check for CAPTCHA
            const hasCaptcha = await this.detectCaptcha(page);
            if (hasCaptcha) {
                console.log('🔒 Google reCAPTCHA detected during pagination!');
                await page.close();
                return []; // Stop pagination on CAPTCHA
            }

            // Wait for results
            const isProductionPagination = process.env.RENDER === 'true' || process.env.VERCEL || process.env.RENDER_SERVICE_ID;
            const paginationSelectorTimeout = isProductionPagination ? 20000 : 10000;
            await page.waitForSelector('#search, #rso', { timeout: paginationSelectorTimeout }).catch(() => { });

            // Extract results
            const results = await page.evaluate((num) => {
                const items = [];
                const resultElements = document.querySelectorAll('div.g, div[data-hveid] > div');

                resultElements.forEach((el, index) => {
                    if (items.length >= num) return;

                    const titleEl = el.querySelector('h3');
                    const linkEl = el.querySelector('a[href]');
                    const snippetEl = el.querySelector('div[data-sncf], .VwiC3b, .yXK7lf');

                    const title = titleEl?.textContent || '';
                    const link = linkEl?.href || '';
                    const snippet = snippetEl?.textContent || '';

                    if (title && link && !link.includes('google.com/search')) {
                        items.push({ title, link, snippet });
                    }
                });

                return items;
            }, num);

            await page.close();

            return results;

        } catch (error) {
            console.error(`Google pagination error (start=${start}):`, error.message);
            return [];
        }
    }

    /**
     * Main search method compatible with smartSearch.js
     * Returns array of { link, title, snippet }
     */
    async search(query, maxResults = 10, retryCount = 0) {
        const MAX_RETRIES = 4;
        await this.ensureDelay();

        try {
            const browser = await this.getBrowser(true);
            const page = await browser.newPage();

            // Set page-level default timeouts (production needs longer timeouts)
            const isProduction = process.env.RENDER === 'true' ||
                process.env.VERCEL ||
                process.env.RENDER_SERVICE_ID;
            const NAVIGATION_TIMEOUT = isProduction ? 60000 : 30000;
            const DEFAULT_TIMEOUT = isProduction ? 60000 : 30000;
            const SELECTOR_TIMEOUT = isProduction ? 20000 : 10000;

            page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
            page.setDefaultTimeout(DEFAULT_TIMEOUT);

            if (isProduction) {
                console.log(`⏱️ Production mode: Using ${NAVIGATION_TIMEOUT / 1000}s timeouts`);
            }

            // Authenticate proxy before any navigation
            if (this.currentProxyAuth) {
                try {
                    await page.authenticate({
                        username: this.currentProxyAuth.username,
                        password: this.currentProxyAuth.password
                    });
                    if (retryCount === 0) {
                        console.log(`🔐 Proxy authenticated: ${this.currentProxyAuth.username.substring(0, 20)}...`);
                    }
                    await this.delay(300);
                } catch (authError) {
                    console.error(`⚠️ Proxy authentication failed: ${authError.message}`);
                }
            }

            if (retryCount > 0) {
                this.currentUserAgent = this.userAgents[retryCount % this.userAgents.length];
            }
            await page.setUserAgent(this.getRandomUserAgent());
            await page.setViewport({ width: 1920, height: 1080 });

            // === STEALTH EVASION SCRIPTS ===
            // These scripts run before any page loads to mask automation
            await page.evaluateOnNewDocument(() => {
                // Override webdriver property
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                    configurable: true
                });

                // Override plugins to look like a real browser
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [
                        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                    ],
                    configurable: true
                });

                // Override languages
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['nl-NL', 'nl', 'en-US', 'en'],
                    configurable: true
                });

                // Override permissions query
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                        Promise.resolve({ state: Notification.permission }) :
                        originalQuery(parameters)
                );

                // Override chrome runtime
                window.chrome = {
                    runtime: {},
                    loadTimes: function () { },
                    csi: function () { },
                    app: {}
                };

                // Remove automation indicators from window
                delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
                delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
                delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

                // Override Hairline feature detection  
                Object.defineProperty(navigator, 'platform', {
                    get: () => 'Win32',
                    configurable: true
                });

                // Make permissions look natural
                Object.defineProperty(navigator, 'hardwareConcurrency', {
                    get: () => 8,
                    configurable: true
                });

                Object.defineProperty(navigator, 'deviceMemory', {
                    get: () => 8,
                    configurable: true
                });

                // Override connection type
                Object.defineProperty(navigator, 'connection', {
                    get: () => ({
                        effectiveType: '4g',
                        rtt: 50,
                        downlink: 10,
                        saveData: false
                    }),
                    configurable: true
                });
            });

            // Add extra headers to look more like a real browser
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'max-age=0',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            });


            // === DEBUG LOGGING FOR RENDER ===
            if (isProduction || retryCount === 0) {
                console.log('🔧 === BROWSER CONFIG DEBUG ===');
                console.log(`   🌐 Environment: ${isProduction ? 'PRODUCTION (Render/Vercel)' : 'LOCAL'}`);
                console.log(`   👤 User-Agent: ${this.getRandomUserAgent().substring(0, 50)}...`);
                console.log(`   🔌 Proxy: ${this.currentProxyInfo ? this.currentProxyInfo.host + ':' + this.currentProxyInfo.port : 'NONE'}`);
                console.log(`   🔐 Proxy Auth: ${this.currentProxyAuth ? 'YES' : 'NO'}`);
                console.log(`   🕵️ Stealth Mode: ENABLED (webdriver override, fake plugins, headers)`);
                console.log(`   🖥️ Headless: new (stealth mode)`);
                console.log(`   📐 Viewport: 1920x1080`);
                console.log('================================');
            }

            // DISABLED: Cookie reuse was causing Protocol errors and instability
            // Each search uses a fresh session which is more reliable
            this.cookies.clear();

            // Use Google.nl - often less strict on CAPTCHA than google.com
            const googleDomain = 'www.google.nl';
            // Skip homepage preload - go directly to search (faster)
            // try {
            //     await page.goto(`https://${googleDomain}`, {
            //         waitUntil: 'domcontentloaded',
            //         timeout: 15000
            //     });
            //     await this.delay(300);
            // } catch (e) {
            //     // Ignore - we'll load search page directly
            // }

            const encodedQuery = encodeURIComponent(query);
            const searchUrl = `https://${googleDomain}/search?q=${encodedQuery}&hl=nl&num=${maxResults}`;

            if (isProduction) {
                console.log(`🔍 DEBUG: Navigating to: ${searchUrl.substring(0, 80)}...`);
            }

            const handleConsent = async () => {
                try {
                    await page.waitForSelector('button', { timeout: 3000 });
                    const buttons = await page.$$('button');
                    for (const button of buttons) {
                        const text = await page.evaluate(el => el.textContent, button);
                        if (text && (text.includes('Accept all') || text.includes('Alles accepteren') || text.includes('Ik ga akkoord') || text.includes('I agree'))) {
                            await button.click();
                            await this.delay(1500);
                            break;
                        }
                    }
                } catch (e) {
                    // No consent dialog
                }
            };

            // DISABLED: Cookie saving - using fresh session per search is more reliable
            const saveCookies = async () => {
                // No-op: cookies disabled for stability
            };

            const loadSearchPage = async (retryCount = 0) => {
                try {
                    await page.goto(searchUrl, {
                        waitUntil: 'domcontentloaded',
                        timeout: NAVIGATION_TIMEOUT
                    });
                    await handleConsent();
                } catch (error) {
                    // Retry once for timeout errors (proxy connection might be slow)
                    if (error.name === 'TimeoutError' && retryCount === 0) {
                        console.log('⚠️ Navigation timeout, retrying after 2s...');
                        await this.delay(2000);
                        return loadSearchPage(1);
                    }
                    throw error;
                }
            };

            console.log(`🔍 Google Search: ${query}${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''}`);
            await loadSearchPage();

            // Wait a bit for page to fully load before checking CAPTCHA
            await this.delay(1000);

            // Debug: Log page info after load
            if (isProduction) {
                try {
                    const currentUrl = page.url();
                    const pageTitle = await page.title();
                    console.log('📄 DEBUG: Page loaded');
                    console.log(`   🔗 URL: ${currentUrl.substring(0, 100)}${currentUrl.length > 100 ? '...' : ''}`);
                    console.log(`   📝 Title: ${pageTitle.substring(0, 60)}${pageTitle.length > 60 ? '...' : ''}`);

                    // Quick check for obvious block indicators
                    if (currentUrl.includes('/sorry') || currentUrl.includes('captcha')) {
                        console.log('   ⚠️ WARNING: URL indicates possible block/CAPTCHA page!');
                    }
                } catch (e) {
                    console.log(`   ⚠️ Could not get page info: ${e.message}`);
                }
            }

            let captchaDetected = await this.detectCaptcha(page);
            if (captchaDetected) {
                console.log(`🔒 Google reCAPTCHA detected! (attempt ${retryCount + 1}/${MAX_RETRIES})`);

                // Log page info for debugging
                try {
                    const pageTitle = await page.title();
                    const pageUrl = page.url();
                    console.log(`   📄 Page title: ${pageTitle}`);
                    console.log(`   🔗 Page URL: ${pageUrl.substring(0, 80)}...`);
                } catch (e) {
                    // Ignore
                }

                let solved = false;
                if (this.apiKey) {
                    solved = await this.solveCaptcha(page, searchUrl);
                    if (solved) {
                        console.log('✅ reCAPTCHA solved! Reloading results...');
                        await this.delay(3000); // Longer wait for CAPTCHA to process
                        await loadSearchPage();
                        await this.delay(2000); // Wait for page to load
                        captchaDetected = await this.detectCaptcha(page);

                        if (captchaDetected) {
                            // CAPTCHA appeared AGAIN after solving - this proxy/session is flagged
                            console.log('⚠️ CAPTCHA re-appeared after solving! Proxy is flagged - rotating...');
                            await page.close();
                            this.cookies.clear();
                            this.markProxyFailed(this.getCurrentProxy());
                            await this.closeBrowser();

                            if (retryCount < MAX_RETRIES - 1) {
                                console.log('🔄 Retrying with fresh proxy...');
                                return this.search(query, maxResults, retryCount + 1);
                            }
                            return [];
                        } else {
                            // CAPTCHA solved successfully - rotate proxy for next query to prevent re-flagging
                            console.log('✅ CAPTCHA solved successfully! Will rotate proxy for next search.');
                            this.markProxyFailed(this.getCurrentProxy()); // Mark this one as used for CAPTCHA
                        }
                    } else {
                        console.log('❌ reCAPTCHA solution failed.');
                    }
                } else {
                    console.log('⚠️ 2Captcha API key missing - rotating proxy');
                }

                // If still have captcha (solve failed or no API key)
                if (captchaDetected && !solved) {
                    await page.close();
                    this.cookies.clear();
                    this.markProxyFailed(this.getCurrentProxy());
                    await this.closeBrowser();
                    if (retryCount < MAX_RETRIES - 1) {
                        console.log('🔄 Rotating proxy and retrying...');
                        return this.search(query, maxResults, retryCount + 1);
                    }
                    return [];
                }
            }

            // Wait for search results or check for errors
            try {
                await page.waitForSelector('#search, #rso, #topstuff, .g', { timeout: SELECTOR_TIMEOUT });
            } catch (e) {
                console.log('⚠️ Search results container not found, checking page content...');

                // Re-check for captcha - might have been missed
                const lateCaptcha = await this.detectCaptcha(page);
                if (lateCaptcha) {
                    console.log('🔒 CAPTCHA detected late! Attempting to solve...');
                    if (this.apiKey) {
                        const solved = await this.solveCaptcha(page, searchUrl);
                        if (solved) {
                            console.log('✅ Late CAPTCHA solved! Reloading...');
                            await this.delay(2000);
                            await loadSearchPage();
                            // Try waiting for results again
                            await page.waitForSelector('#search, #rso', { timeout: SELECTOR_TIMEOUT }).catch(() => { });
                        } else {
                            console.log('❌ Failed to solve late CAPTCHA');
                            await page.close();
                            this.markProxyFailed(this.getCurrentProxy());
                            await this.closeBrowser();
                            if (retryCount < MAX_RETRIES - 1) {
                                return this.search(query, maxResults, retryCount + 1);
                            }
                            return [];
                        }
                    } else {
                        console.log('❌ 2Captcha API key not set! Cannot solve CAPTCHA.');
                        console.log('💡 Set TWO_CAPTCHA_API_KEY in Render environment variables.');
                        await page.close();
                        this.markProxyFailed(this.getCurrentProxy());
                        await this.closeBrowser();
                        if (retryCount < MAX_RETRIES - 1) {
                            return this.search(query, maxResults, retryCount + 1);
                        }
                        return [];
                    }
                } else {
                    const pageContent = await page.content();
                    const hasResults = pageContent.includes('g-link') || pageContent.includes('result');
                    if (!hasResults) {
                        console.log('⚠️ No search results found in page content');
                        console.log(`   Page title: ${await page.title()}`);
                        console.log(`   Page URL: ${page.url()}`);
                    }
                }
            }

            const results = await page.evaluate((maxResults) => {
                const items = [];

                // Try multiple selectors for Google results
                const selectors = [
                    'div.g',
                    'div[data-hveid] > div',
                    'div.tF2Cxc',
                    'div[data-ved]',
                    '.yuRUbf',
                    'div[jscontroller]'
                ];

                let resultElements = [];
                for (const selector of selectors) {
                    resultElements = document.querySelectorAll(selector);
                    if (resultElements.length > 0) {
                        console.log(`Found ${resultElements.length} elements with selector: ${selector}`);
                        break;
                    }
                }

                resultElements.forEach((el) => {
                    if (items.length >= maxResults) return;

                    const titleEl = el.querySelector('h3, h2, .LC20lb, .DKV0Md');
                    const linkEl = el.querySelector('a[href]');
                    const snippetEl = el.querySelector('div[data-sncf], .VwiC3b, .yXK7lf, .s, .IsZvec');

                    const title = titleEl?.textContent || '';
                    const link = linkEl?.href || '';
                    const snippet = snippetEl?.textContent || '';

                    if (title && link && !link.includes('google.com/search') && !link.includes('google.com/url')) {
                        items.push({ title, link, snippet });
                    }
                });

                return items;
            }, maxResults);

            await page.close();

            console.log(`📋 Found ${results.length} Google results for: ${query}`);
            if (results.length === 0) {
                console.log('⚠️ No results found - this could indicate:');
                console.log('   1. CAPTCHA not detected/solved');
                console.log('   2. Google blocking the request');
                console.log('   3. Page structure changed');
                console.log('   4. No results actually exist for this query');
            }
            return results;

        } catch (error) {
            console.error('Google search error:', error.message);
            this.rotateProxyOnNextLaunch = true;
            this.cookies.clear();
            await this.closeBrowser();

            if (retryCount < MAX_RETRIES - 1) {
                return this.search(query, maxResults, retryCount + 1);
            }

            return [];
        }
    }

    /**
     * Detect if page has reCAPTCHA
     */
    async detectCaptcha(page) {
        try {
            // Check for reCAPTCHA iframe
            const captchaFrame = await page.$('iframe[src*="recaptcha"]');
            if (captchaFrame) {
                console.log('🔒 CAPTCHA detected: reCAPTCHA iframe found');
                return true;
            }

            // Check for Google CAPTCHA page elements
            const captchaDiv = await page.$('#captcha-form, .g-recaptcha, #recaptcha, .captcha-container');
            if (captchaDiv) {
                console.log('🔒 CAPTCHA detected: captcha form element found');
                return true;
            }

            // Check for "unusual traffic" message in page content (case-insensitive)
            const content = await page.content();
            const contentLower = content.toLowerCase();

            const captchaIndicators = [
                'unusual traffic',
                'not a robot',
                'captcha',
                'g-recaptcha',
                'recaptcha',
                'verify you are human',
                'verify you\'re human',
                'i\'m not a robot',
                'automated queries',
                'sorry...we\'re sorry',
                'onze systemen hebben ongebruikelijk verkeer',  // Dutch
                'ongewoon verkeer',  // Dutch
                'bent geen robot',  // Dutch
                'unusual traffic from your computer',
                '/sorry/index',
                'ipv4.google.com/sorry'
            ];

            for (const indicator of captchaIndicators) {
                if (contentLower.includes(indicator.toLowerCase())) {
                    console.log(`🔒 CAPTCHA detected: "${indicator}" found in page content`);
                    return true;
                }
            }

            // Check URL for captcha/sorry page
            const url = page.url();
            if (url.includes('/sorry') || url.includes('captcha') || url.includes('recaptcha')) {
                console.log(`🔒 CAPTCHA detected: URL contains captcha indicator (${url})`);
                return true;
            }

            // Check page title for blocked/captcha indicators
            const title = await page.title();
            const titleLower = title.toLowerCase();
            if (titleLower.includes('sorry') || titleLower.includes('captcha') || titleLower.includes('blocked')) {
                console.log(`🔒 CAPTCHA detected: Page title indicates block (${title})`);
                return true;
            }

            return false;
        } catch (error) {
            console.error('CAPTCHA detection error:', error.message);
            return false;
        }
    }

    /**
     * Solve Google reCAPTCHA using 2Captcha
     */
    async solveCaptcha(page, pageUrl) {
        try {
            console.log('🔍 Attempting to extract reCAPTCHA sitekey...');

            // Set up network listener to catch sitekey from requests
            let sitekeyFromNetwork = null;
            const networkListener = async (response) => {
                try {
                    const url = response.url();
                    if (url.includes('recaptcha') && url.includes('k=')) {
                        const match = url.match(/[?&]k=([^&]+)/);
                        if (match && match[1] && match[1].length > 20) {
                            sitekeyFromNetwork = match[1];
                            console.log(`🔑 Found sitekey in network request: ${sitekeyFromNetwork.substring(0, 20)}...`);
                        }
                    }
                } catch (e) {
                    // Ignore
                }
            };
            page.on('response', networkListener);

            // Wait for CAPTCHA to fully load - critical for production
            try {
                // Wait for any recaptcha iframe or element to appear
                const isProduction = process.env.RENDER === 'true' || process.env.VERCEL || process.env.RENDER_SERVICE_ID;
                const captchaWaitTimeout = isProduction ? 10000 : 5000;
                await page.waitForSelector('iframe[src*="recaptcha"], .g-recaptcha, [data-sitekey]', {
                    timeout: captchaWaitTimeout
                }).catch(() => {
                    console.log('⚠️ CAPTCHA elements not found with waitForSelector, trying anyway...');
                });

                // Additional wait for dynamic content - longer in production
                await this.delay(process.env.RENDER === 'true' ? 4000 : 2000);
            } catch (e) {
                console.log('⚠️ Wait for CAPTCHA elements timed out, continuing...');
            }

            // Extract reCAPTCHA sitekey - improved extraction with retries
            let sitekey = null;
            let extractionAttempt = 0;
            const maxExtractionAttempts = 3;

            // Use sitekey from network if found
            if (sitekeyFromNetwork) {
                sitekey = sitekeyFromNetwork;
                console.log(`🔑 Using sitekey from network request`);
            }

            while (!sitekey && extractionAttempt < maxExtractionAttempts) {
                extractionAttempt++;
                console.log(`🔍 Sitekey extraction attempt ${extractionAttempt}/${maxExtractionAttempts}...`);

                sitekey = await page.evaluate(() => {
                    const debug = {
                        iframes: [],
                        divs: [],
                        scripts: [],
                        found: null
                    };

                    // Method 1: Try to find sitekey in iframe src (most reliable)
                    const iframes = document.querySelectorAll('iframe');
                    for (const iframe of iframes) {
                        const src = iframe.src || '';
                        debug.iframes.push(src.substring(0, 100));
                        if (src.includes('recaptcha')) {
                            // Try multiple patterns
                            const patterns = [
                                /[?&]k=([^&]+)/,
                                /sitekey=([^&]+)/,
                                /\/recaptcha\/api2\/anchor\?k=([^&]+)/
                            ];
                            for (const pattern of patterns) {
                                const match = src.match(pattern);
                                if (match && match[1] && match[1].length > 20) {
                                    debug.found = `iframe: ${match[1]}`;
                                    return match[1];
                                }
                            }
                        }
                    }

                    // Method 2: Try to find in recaptcha div with data-sitekey
                    const recaptchaDivs = document.querySelectorAll('.g-recaptcha, [data-sitekey], div[class*="recaptcha"], div[id*="recaptcha"]');
                    for (const div of recaptchaDivs) {
                        const key = div.getAttribute('data-sitekey') || div.getAttribute('data-site-key');
                        if (key && key.length > 20) {
                            debug.found = `div: ${key}`;
                            return key;
                        }
                        debug.divs.push(div.className || div.id);
                    }

                    // Method 3: Search in script tags for sitekey
                    const scripts = document.querySelectorAll('script');
                    for (const script of scripts) {
                        const content = script.textContent || script.innerHTML || '';
                        debug.scripts.push(content.substring(0, 50));
                        const patterns = [
                            /sitekey['"]?\s*[:=]\s*['"]([^'"]+)['"]/i,
                            /['"]sitekey['"]\s*:\s*['"]([^'"]+)['"]/i,
                            /recaptcha.*?sitekey.*?['"]([A-Za-z0-9_-]{40})['"]/i
                        ];
                        for (const pattern of patterns) {
                            const match = content.match(pattern);
                            if (match && match[1] && match[1].length > 20) {
                                debug.found = `script: ${match[1]}`;
                                return match[1];
                            }
                        }
                    }

                    // Method 4: Search in page HTML for common sitekey patterns
                    const html = document.documentElement.innerHTML;
                    const patterns = [
                        /data-sitekey=["']([^"']+)["']/i,
                        /sitekey["']?\s*[:=]\s*["']([^"']+)["']/i,
                        /recaptcha[^"']*["']([A-Za-z0-9_-]{40})["']/i,
                        /\/recaptcha\/api2\/anchor\?k=([A-Za-z0-9_-]+)/i
                    ];

                    for (const pattern of patterns) {
                        const match = html.match(pattern);
                        if (match && match[1] && match[1].length > 20) {
                            debug.found = `html: ${match[1]}`;
                            return match[1];
                        }
                    }

                    // Method 5: Try to find in grecaptcha object if available
                    if (typeof window !== 'undefined' && window.grecaptcha) {
                        try {
                            const widgets = document.querySelectorAll('.g-recaptcha');
                            for (let i = 0; i < widgets.length; i++) {
                                try {
                                    const widgetId = window.grecaptcha.render(widgets[i], {});
                                    const response = window.grecaptcha.getResponse(widgetId);
                                    if (response) {
                                        // Can't get sitekey from response, but widget exists
                                    }
                                } catch (e) { }
                            }
                        } catch (e) { }
                    }

                    // Log debug info for troubleshooting
                    console.log('CAPTCHA Debug:', JSON.stringify(debug));
                    return null;
                });

                if (!sitekey && extractionAttempt < maxExtractionAttempts) {
                    console.log(`⚠️ Sitekey not found, waiting 2s before retry...`);
                    await this.delay(2000);
                }
            }

            // Remove network listener
            page.removeListener('response', networkListener);

            if (!sitekey) {
                console.log('⚠️ Could not extract reCAPTCHA sitekey from page');

                // Debug: Log page content to help troubleshoot
                try {
                    const pageContent = await page.content();
                    const hasRecaptcha = pageContent.includes('recaptcha') || pageContent.includes('g-recaptcha');
                    const hasIframe = pageContent.includes('<iframe');
                    console.log(`   📊 Debug: Page has 'recaptcha': ${hasRecaptcha}, has iframes: ${hasIframe}`);

                    // Try to get all iframe sources
                    const iframeSources = await page.evaluate(() => {
                        const iframes = Array.from(document.querySelectorAll('iframe'));
                        return iframes.map(iframe => iframe.src).filter(src => src);
                    });
                    if (iframeSources.length > 0) {
                        console.log(`   📋 Found ${iframeSources.length} iframe(s):`);
                        iframeSources.forEach((src, i) => {
                            console.log(`      ${i + 1}. ${src.substring(0, 100)}...`);
                        });
                    }
                } catch (e) {
                    console.log(`   ⚠️ Could not get debug info: ${e.message}`);
                }

                return false;
            } else {
                console.log(`🔑 Extracted sitekey: ${sitekey.substring(0, 20)}...`);
            }

            console.log(`🔑 Extracted sitekey: ${sitekey.substring(0, 20)}...`);

            // Create 2Captcha task
            const createTaskUrl = 'https://api.2captcha.com/createTask';
            const taskPayload = {
                clientKey: this.apiKey,
                task: {
                    type: 'RecaptchaV2TaskProxyless',
                    websiteURL: pageUrl,
                    websiteKey: sitekey
                }
            };

            const proxyInfo = this.currentProxyInfo;
            if (proxyInfo && proxyInfo.host && proxyInfo.port) {
                taskPayload.task.type = 'RecaptchaV2Task';
                taskPayload.task.proxyType = 'http';
                taskPayload.task.proxyAddress = proxyInfo.host;
                taskPayload.task.proxyPort = parseInt(proxyInfo.port, 10);
                if (proxyInfo.username && proxyInfo.password) {
                    taskPayload.task.proxyLogin = proxyInfo.username;
                    taskPayload.task.proxyPassword = proxyInfo.password;
                }
            }

            console.log('🚀 Sending reCAPTCHA to 2Captcha...');
            const createRes = await this.makeRequest(createTaskUrl, {
                method: 'POST',
                body: JSON.stringify(taskPayload),
                headers: { 'Content-Type': 'application/json' }
            });
            const createData = await createRes.json();

            if (createData.errorId !== 0) {
                console.error('2Captcha Error:', createData);
                return false;
            }

            const taskId = createData.taskId;
            console.log(`⏳ 2Captcha Task ID: ${taskId}. Waiting for solution...`);

            // Poll for result
            let solution = null;
            let attempts = 0;
            while (attempts < 40) { // Max 200 seconds
                await this.delay(5000);
                const resultUrl = 'https://api.2captcha.com/getTaskResult';
                const resultRes = await this.makeRequest(resultUrl, {
                    method: 'POST',
                    body: JSON.stringify({ clientKey: this.apiKey, taskId }),
                    headers: { 'Content-Type': 'application/json' }
                });
                const resultData = await resultRes.json();

                if (resultData.status === 'ready') {
                    solution = resultData.solution?.gRecaptchaResponse;
                    break;
                }
                if (resultData.errorId !== 0) {
                    console.error('2Captcha Result Error:', resultData);
                    return false;
                }
                attempts++;
            }

            if (!solution) {
                console.log('❌ 2Captcha timeout');
                return false;
            }

            console.log('💡 reCAPTCHA solved! Token length:', solution.length);

            // Inject solution token
            await page.evaluate((token) => {
                // Try multiple methods to inject the token
                const responseField = document.getElementById('g-recaptcha-response');
                if (responseField) {
                    responseField.innerHTML = token;
                    responseField.value = token;
                }

                // Try to find and call callback
                if (typeof grecaptcha !== 'undefined') {
                    const widgets = document.querySelectorAll('.g-recaptcha');
                    widgets.forEach((widget, i) => {
                        try {
                            grecaptcha.getResponse(i);
                        } catch (e) { }
                    });
                }

                // Try to submit form
                const form = document.querySelector('form');
                if (form) {
                    form.submit();
                }
            }, solution);

            // Wait for navigation or reload
            await this.delay(3000);

            return true;

        } catch (error) {
            console.error('CAPTCHA solving error:', error);
            return false;
        }
    }

    /**
     * Legacy method for backward compatibility
     * Maps old searchGuest() to new search() format
     */
    async searchGuest(guest) {
        let searchQuery = `"${guest.full_name}"`;
        if (guest.company) {
            searchQuery += ` "${guest.company}"`;
        }
        if (guest.country) {
            searchQuery += ` ${guest.country}`;
        }

        const results = await this.search(searchQuery, 10);

        // Convert to old format
        const linkedinResult = results.find(r => r.link && r.link.includes('linkedin.com/in/'));

        return {
            profilePhotoUrl: null,
            jobTitle: linkedinResult ? this.extractJobTitle(linkedinResult) : null,
            companyName: guest.company || null,
            companySize: null,
            industry: null,
            linkedinUrl: linkedinResult?.link || null,
            linkedinConnections: null,
            websiteUrl: null,
            notableInfo: results.slice(0, 3).map(r => r.snippet).join(' | '),
            pressMentions: null,
            rawResults: results
        };
    }

    extractJobTitle(result) {
        const titleText = result.title + ' ' + result.snippet;
        const titleMatch = titleText.match(/[-–]\s*([^-–|]*(?:CEO|CTO|CFO|COO|Director|Manager|Founder|Owner|Partner|Head|VP|President|Chief)[^-–|]*)/i);
        return titleMatch ? titleMatch[1].trim() : null;
    }

    /**
     * Fetch page content from a URL using Puppeteer
     * This allows us to visit pages and extract content
     * @param {string} url - URL to visit
     * @param {number} maxChars - Maximum characters to extract (default: 8000)
     * @returns {string|null} - Page text content
     */
    async fetchPageContent(url, maxChars = 8000) {
        if (!url) return null;

        try {
            console.log(`📄 Fetching page content: ${url.substring(0, 50)}...`);

            const browser = await this.getBrowser();
            const page = await browser.newPage();

            // Set user agent
            await page.setUserAgent(this.getRandomUserAgent());

            // Navigate to URL
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 15000
            });

            // Wait a bit for dynamic content
            await this.delay(2000);

            // Extract text content from page
            const content = await page.evaluate((maxChars) => {
                // Remove scripts, styles, and hidden elements
                const scripts = document.querySelectorAll('script, style, noscript, iframe');
                scripts.forEach(el => el.remove());

                // Get visible text content
                const body = document.body;
                if (!body) return '';

                let text = body.innerText || body.textContent || '';

                // Clean up whitespace
                text = text
                    .replace(/\s+/g, ' ')  // Multiple spaces to single space
                    .replace(/\n+/g, '\n')  // Multiple newlines to single newline
                    .trim();

                // Limit length
                if (text.length > maxChars) {
                    text = text.substring(0, maxChars);
                }

                return text;
            }, maxChars);

            await page.close();

            if (!content || content.length < 100) {
                console.log('⚠️ Page content too short or empty');
                return null;
            }

            console.log(`✅ Fetched ${content.length} characters from page`);
            return content;

        } catch (error) {
            console.error(`❌ Error fetching page content: ${error.message}`);
            return null;
        }
    }

    /**
     * Scrape LinkedIn profile headline from og:description meta tag
     * @param {string} linkedinUrl - LinkedIn profile URL
     * @returns {string|null} - LinkedIn headline/tagline
     */
    async scrapeLinkedInHeadline(linkedinUrl) {
        if (!linkedinUrl || !linkedinUrl.includes('linkedin.com/in/')) {
            return null;
        }

        try {
            console.log(`🔗 Scraping LinkedIn headline: ${linkedinUrl}`);

            const browser = await this.getBrowser();
            const page = await browser.newPage();

            // Set user agent
            await page.setUserAgent(this.getRandomUserAgent());

            // Navigate to LinkedIn profile
            await page.goto(linkedinUrl, {
                waitUntil: 'networkidle2',
                timeout: 15000
            });

            // Extract og:description meta tag (contains headline)
            const headline = await page.evaluate(() => {
                const ogDesc = document.querySelector('meta[property="og:description"]');
                if (!ogDesc) return null;

                const content = ogDesc.getAttribute('content');
                if (!content) return null;

                // LinkedIn og:description format: "Name | Headline"
                // or "Name - Headline"
                const parts = content.split(/[|\-]/);
                if (parts.length >= 2) {
                    return parts.slice(1).join('-').trim();
                }

                return content;
            });

            await page.close();

            if (headline && headline.length > 10) {
                console.log(`💼 Found LinkedIn headline: "${headline}"`);
                return headline;
            }

            console.log('⚠️ No LinkedIn headline found');
            return null;

        } catch (error) {
            console.error(`❌ Error scraping LinkedIn: ${error.message}`);
            return null;
        }
    }
}

module.exports = new GoogleSearchService();
