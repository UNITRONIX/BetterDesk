/**
 * BetterDesk Console - Server Entry Point
 * Professional Web Management Panel for RustDesk Server
 * 
 * @author UNITRONIX
 * @version 2.1.0
 * @license AGPL-3.0
 */

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const config = require('./config/config');
const securityMiddleware = require('./middleware/security');
const { initI18n } = require('./middleware/i18n');
const { apiLimiter } = require('./middleware/rateLimiter');
const { csrfTokenProvider, doubleCsrfProtection } = require('./middleware/csrf');
const authService = require('./services/authService');
const hbbsApi = require('./services/hbbsApi');
const serverBackend = require('./services/serverBackend');
const db = require('./services/database');
const { initWsProxy } = require('./services/wsRelay');
const { initBdRelay } = require('./services/bdRelay');
const { initChatRelay } = require('./services/chatRelay');
const { initRemoteRelay } = require('./services/remoteRelay');
const { startDiscoveryService } = require('./services/lanDiscovery');
const routes = require('./routes');
const rustdeskApiRoutes = require('./routes/rustdesk-api.routes');
const { getWanMiddlewareStack } = require('./middleware/wanSecurity');

// Create Express app
const app = express();

// Trust proxy (for rate limiting behind reverse proxy)
// Configurable via TRUST_PROXY env var: 0=disabled, 1=single proxy, 'loopback'=localhost only
// Default: false (safest). Set TRUST_PROXY=1 when behind nginx/Apache/cloudflare
const trustProxy = process.env.TRUST_PROXY !== undefined ? 
    (isNaN(process.env.TRUST_PROXY) ? process.env.TRUST_PROXY : parseInt(process.env.TRUST_PROXY, 10)) : false;
app.set('trust proxy', trustProxy);

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Ensure data directory exists
if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
}

// ============ Middleware Pipeline ============

// Security headers (Helmet)
app.use(securityMiddleware);

// Body parsing (2MB limit for base64 logo images)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

// Cookie parsing
app.use(cookieParser());

// Session management — also kept as a standalone middleware ref for WebSocket upgrades
const sessionMiddleware = session({
    secret: config.sessionSecret,
    name: 'betterdesk.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: config.httpsEnabled,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: config.sessionMaxAge
    }
});
app.use(sessionMiddleware);

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: config.isProduction ? '1d' : '0',
    etag: true
}));

// Serve proto files for remote client (protobufjs dynamic loading)
app.use('/protos', express.static(path.join(__dirname, 'protos'), {
    maxAge: config.isProduction ? '7d' : '0',
    etag: true
}));

// Rate limiting for API
app.use('/api/', apiLimiter);

// i18n middleware
app.use(initI18n());

// CSRF protection — generate token for views, validate on POST/PUT/DELETE/PATCH
app.use(csrfTokenProvider);
app.use(doubleCsrfProtection);

// ============ Routes ============

app.use('/', routes);

// ============ Error Handlers ============

// CSRF token mismatch
app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN' || err.message?.includes('csrf') || err.message?.includes('CSRF')) {
        res.status(403);
        // Always return JSON for API routes (fetch sends Accept: */*)
        if (req.path.startsWith('/api/') || (req.headers['content-type'] && req.headers['content-type'].includes('application/json'))) {
            return res.json({ success: false, error: 'Invalid CSRF token. Please refresh the page and try again.' });
        }
        if (req.accepts('html')) {
            return res.render('errors/500', {
                title: 'Forbidden',
                activePage: 'error',
                error: 'Invalid or missing CSRF token. Please refresh the page and try again.'
            });
        }
        return res.json({ success: false, error: 'Invalid CSRF token' });
    }
    next(err);
});

// 404 Not Found
app.use((req, res, next) => {
    res.status(404);
    
    if (req.accepts('html')) {
        res.render('errors/404', {
            title: req.t ? req.t('errors.not_found') : 'Not Found',
            activePage: 'error'
        });
    } else {
        res.json({
            success: false,
            error: 'Not Found'
        });
    }
});

// 500 Server Error
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    
    res.status(err.status || 500);
    
    // Always return JSON for API routes
    if (req.path.startsWith('/api/') || (req.headers['content-type'] && req.headers['content-type'].includes('application/json'))) {
        return res.json({
            success: false,
            error: config.isProduction ? 'Internal Server Error' : err.message
        });
    }
    
    if (req.accepts('html')) {
        res.render('errors/500', {
            title: req.t ? req.t('errors.server_error') : 'Server Error',
            activePage: 'error',
            error: config.isProduction ? null : err.message
        });
    } else {
        res.json({
            success: false,
            error: config.isProduction ? 'Internal Server Error' : err.message
        });
    }
});

// ============ Startup ============

/**
 * Load SSL certificates for HTTPS
 */
function loadSslCertificates() {
    const options = {};
    
    if (!config.sslCertPath || !config.sslKeyPath) {
        return null;
    }
    
    try {
        if (!fs.existsSync(config.sslCertPath)) {
            console.error(`SSL certificate not found: ${config.sslCertPath}`);
            return null;
        }
        if (!fs.existsSync(config.sslKeyPath)) {
            console.error(`SSL private key not found: ${config.sslKeyPath}`);
            return null;
        }
        
        options.cert = fs.readFileSync(config.sslCertPath);
        options.key = fs.readFileSync(config.sslKeyPath);
        
        // Optional CA bundle (for Let's Encrypt chain)
        if (config.sslCaPath && fs.existsSync(config.sslCaPath)) {
            options.ca = fs.readFileSync(config.sslCaPath);
        }
        
        return options;
    } catch (err) {
        console.error('Failed to load SSL certificates:', err.message);
        return null;
    }
}

/**
 * Create HTTP redirect server (redirects all HTTP to HTTPS)
 */
function createHttpRedirectServer() {
    const redirectApp = express();
    redirectApp.use((req, res) => {
        const httpsUrl = `https://${req.hostname}:${config.httpsPort}${req.url}`;
        res.redirect(301, httpsUrl);
    });
    
    return http.createServer(redirectApp);
}

async function startServer() {
    try {
        // Initialize database adapter (creates tables, runs migrations)
        await db.init();

        // Warm branding cache from database (must run after db.init)
        const brandingService = require('./services/brandingService');
        await brandingService.loadBranding();

        // Ensure default admin exists
        await authService.ensureDefaultAdmin();
        
        let server;
        let protocol = 'http';
        let displayPort = config.port;
        
        // HTTPS mode
        if (config.httpsEnabled) {
            const sslOptions = loadSslCertificates();
            
            if (sslOptions) {
                // Create HTTPS server
                server = https.createServer(sslOptions, app);
                protocol = 'https';
                displayPort = config.httpsPort;
                
                server.listen(config.httpsPort, config.host, () => {
                    printStartupBanner(protocol, displayPort);
                });
                
                // Optionally start HTTP redirect server
                if (config.httpRedirect) {
                    const redirectServer = createHttpRedirectServer();
                    redirectServer.listen(config.port, config.host, () => {
                        console.log(`  HTTP -> HTTPS redirect active on port ${config.port}`);
                        console.log('');
                    });
                    
                    // Graceful shutdown for redirect server too
                    const shutdownRedirect = () => { redirectServer.close(); };
                    process.on('SIGTERM', shutdownRedirect);
                    process.on('SIGINT', shutdownRedirect);
                }
            } else {
                console.warn('WARNING: HTTPS enabled but certificates not found/invalid');
                console.warn('Falling back to HTTP mode');
                server = http.createServer(app);
                server.listen(config.port, config.host, () => {
                    printStartupBanner(protocol, config.port);
                });
            }
        } else {
            // HTTP mode (default)
            server = http.createServer(app);
            server.listen(config.port, config.host, () => {
                printStartupBanner(protocol, config.port);
            });
        }
        
        // Initialize WebSocket proxy for remote desktop client
        initWsProxy(server);

        // Initialize BetterDesk native relay (WebSocket)
        initBdRelay(server);

        // Initialize Chat relay (WebSocket — agent ↔ operator)
        initChatRelay(server, sessionMiddleware);

        // Initialize Remote Desktop relay (WebSocket — agent JPEG ↔ browser viewer)
        initRemoteRelay(server, sessionMiddleware);

        // Start LAN Discovery UDP service
        startDiscoveryService();
        
        // ============ RustDesk Client API Server (dedicated port) ============
        let apiServer = null;
        if (config.apiEnabled) {
            apiServer = startRustDeskApiServer();
        }
        
        // ============ Periodic Housekeeping ============
        const housekeepingInterval = setInterval(async () => {
            await authService.cleanupHousekeeping();
            // Clean up old integration data (metrics >7d, audit >90d)
            try {
                await db.runIntegrationHousekeeping();
            } catch (err) {
                // Silent fail — don't crash the server for housekeeping
            }
        }, 60 * 60 * 1000); // Every hour
        
        // ============ Periodic Online Status Sync ============
        const syncInterval = parseInt(process.env.STATUS_SYNC_INTERVAL, 10) || 15; // seconds
        const heartbeatStaleThreshold = parseInt(process.env.HEARTBEAT_STALE_THRESHOLD, 10) || 90; // seconds
        const statusSyncInterval = setInterval(async () => {
            try {
                await serverBackend.syncOnlineStatus();
            } catch (err) {
                // Silent fail - don't crash the server
            }
            // Also clean up stale heartbeat-based online status
            try {
                if (typeof db.cleanupStaleOnlinePeers === 'function') {
                    await db.cleanupStaleOnlinePeers(heartbeatStaleThreshold);
                }
            } catch (err) {
                // Silent fail
            }
        }, syncInterval * 1000);
        
        // Initial sync on startup (after short delay for HBBS to be ready)
        setTimeout(async () => {
            try {
                const result = await serverBackend.syncOnlineStatus();
                if (result.synced > 0) {
                    console.log(`Initial status sync: ${result.synced} device(s) online`);
                }
            } catch (err) {
                // Silent fail
            }
        }, 5000);
        
        // Graceful shutdown
        const shutdown = (signal) => {
            console.log(`\n${signal} received. Shutting down gracefully...`);
            clearInterval(housekeepingInterval);
            clearInterval(statusSyncInterval);
            
            const closePromises = [new Promise(r => server.close(r))];
            if (apiServer) {
                closePromises.push(new Promise(r => apiServer.close(r)));
            }
            
            Promise.all(closePromises).then(() => {
                console.log('All servers closed.');
                process.exit(0);
            });
            
            // Force exit after 10 seconds
            setTimeout(() => {
                console.error('Forced shutdown after timeout');
                process.exit(1);
            }, 10000);
        };
        
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

/**
 * Start the dedicated RustDesk Client API server on a separate port.
 * This is a minimal, hardened Express app with only 4 endpoints.
 * Designed for WAN/internet exposure with aggressive security.
 */
function startRustDeskApiServer() {
    const apiApp = express();

    // Trust proxy (use same configuration as main app — TRUST_PROXY env var)
    apiApp.set('trust proxy', trustProxy);

    // Apply WAN security middleware stack
    const wanMiddleware = getWanMiddlewareStack();
    for (const mw of wanMiddleware) {
        apiApp.use(mw);
    }

    // JSON body parser with size limit (64KB for address book sync)
    apiApp.use(express.json({ limit: '64kb', strict: true }));

    // Mount RustDesk-compatible API routes
    apiApp.use('/', rustdeskApiRoutes);

    // Mount device-facing registration routes (LAN discovery pairing)
    const registrationRoutes = require('./routes/registration.routes');
    apiApp.use('/api/bd', registrationRoutes);

    // Catch-all for any unmatched routes (should not reach here due to pathWhitelist)
    apiApp.use((req, res) => {
        res.status(404).end();
    });

    // Error handler — never leak internal errors
    apiApp.use((err, req, res, next) => {
        if (err.type === 'entity.parse.failed') {
            console.warn('RustDesk API: JSON parse error from', req.socket?.remoteAddress);
            return res.status(400).json({ error: 'Invalid JSON' });
        }
        if (err.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Request too large' });
        }
        console.error('RustDesk API error:', err.message);
        res.status(500).json({ error: 'Server error' });
    });

    // Start HTTP or HTTPS server for RustDesk Client API
    let apiServerInstance;
    if (config.httpsEnabled) {
        const sslOptions = loadSslCertificates();
        if (sslOptions) {
            apiServerInstance = https.createServer(sslOptions, apiApp);
            console.log(`  ║   API TLS:   Enabled (HTTPS)`.padEnd(53) + '║');
        } else {
            console.warn('WARNING: HTTPS enabled but SSL certs invalid — API falling back to HTTP');
            apiServerInstance = http.createServer(apiApp);
        }
    } else {
        apiServerInstance = http.createServer(apiApp);
    }
    
    apiServerInstance.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`  ║   API Port:  ${config.apiPort} FAILED (port in use)`.padEnd(53) + '║');
            console.error(`  ║   Hint: Check if hbbs uses the same port, or`.padEnd(53) + '║');
            console.error(`  ║   set API_PORT env var (default: 21121)`.padEnd(53) + '║');
            console.log('  ║                                                  ║');
            console.error(`WARNING: RustDesk Client API could not start on port ${config.apiPort}`);
            console.error('Likely cause: hbbs API is on the same port. Client API default is 21121.');
            console.error('The admin panel continues to run normally on port ' + config.port);
            return; // Don't crash — let the panel continue running
        }
        throw err;
    });
    
    apiServerInstance.listen(config.apiPort, config.host, () => {
        console.log(`  ║   API Port:  ${config.apiPort} (RustDesk Client)`.padEnd(53) + '║');
        console.log('  ║                                                  ║');
    });

    // Set connection timeout (prevent slow loris)
    apiServerInstance.headersTimeout = 15000;
    apiServerInstance.requestTimeout = 10000;
    apiServerInstance.keepAliveTimeout = 5000;

    return apiServerInstance;
}

/**
 * Print startup banner with server info
 */
function printStartupBanner(protocol, port) {
    const sslStatus = config.httpsEnabled ? '🔒 HTTPS' : '🔓 HTTP';
    const apiStatus = config.apiEnabled ? `✅ Port ${config.apiPort}` : '❌ Disabled';
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════╗');
    console.log('  ║                                                  ║');
    console.log('  ║   🖥️  BetterDesk Console v' + config.appVersion.padEnd(23) + '  ║');
    console.log('  ║                                                  ║');
    console.log('  ╠══════════════════════════════════════════════════╣');
    console.log('  ║                                                  ║');
    console.log(`  ║   Panel:     ${protocol}://${config.host}:${port}`.padEnd(53) + '║');
    console.log(`  ║   Client API: ${apiStatus}`.padEnd(53) + '║');
    console.log(`  ║   Mode:      ${config.nodeEnv}`.padEnd(53) + '║');
    console.log(`  ║   Security:  ${sslStatus}`.padEnd(53) + '║');
    const dbLabel = (db.DB_TYPE === 'postgres' || db.DB_TYPE === 'postgresql')
        ? `PostgreSQL (${process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : 'localhost'})`
        : path.basename(config.dbPath);
    console.log(`  ║   Database:  ${dbLabel}`.padEnd(53) + '║');
    console.log('  ║                                                  ║');
    console.log('  ╚══════════════════════════════════════════════════╝');
    console.log('');
}

// Start the server
startServer();

module.exports = app;
