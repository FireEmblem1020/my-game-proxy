const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();
const PORT = process.env.PORT || 3000;

// 🛑 CHANGE THE TEXT INSIDE THE QUOTES TO YOUR CHOSEN PASSWORD
const PROXY_PASSWORD = "mysecretpassword";

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Helper functions to safely encode/decode URLs in the browser bar
const encodeUrl = (str) => Buffer.from(str).toString('base64');
const decodeUrl = (str) => Buffer.from(str, 'base64').toString('utf-8');

// 1. Serve the fake error page UI
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>404 Not Found</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #fff; color: #000; padding: 40px; margin: 0; }
                h1 { font-size: 24px; font-weight: 500; margin-top: 0; margin-bottom: 10px; }
                p { font-size: 14px; color: #333; margin: 0 0 20px 0; }
                hr { border: 0; border-top: 1px solid #ddd; margin: 20px 0; }
                .footer { font-size: 12px; color: #777; font-style: italic; }
                .hidden { display: none !important; }
                
                #secretTrigger { position: absolute; top: 0; left: 0; width: 40px; height: 40px; cursor: default; background: transparent; }
                .launcher-body { background-color: #121212 !important; color: #fff !important; display: flex !important; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 0; }
                .container { background: #1e1e1e; padding: 25px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); text-align: center; width: 360px; color: #fff; }
                .container input { width: 90%; padding: 10px; margin-bottom: 15px; border: 1px solid #444; border-radius: 4px; background: #2d2d2d; color: #fff; font-size: 14px; }
                .container button { background: #4CAF50; color: white; border: none; padding: 12px 15px; border-radius: 4px; cursor: pointer; font-weight: bold; width: 100%; font-size: 14px; }
                .container button:hover { background: #45a049; }
                .container h2, .container p { color: #fff; margin: 10px 0; }
            </style>
        </head>
        <body id="pageBody">

            <div id="secretTrigger" onclick="revealLauncher()"></div>

            <div id="errorScreen">
                <h1>Not Found</h1>
                <p>The requested URL was not found on this server.</p>
                <hr>
                <div class="footer">Apache/2.4.41 (Ubuntu) Server at Port 80</div>
            </div>

            <div id="launcherScreen" class="container hidden">
                <h2>Universal Proxy Launcher</h2>
                <p>Enter any URL or online game web link:</p>
                <input type="text" id="targetUrl" placeholder="https://example.com">
                <button onclick="launchProxy()">Launch Unblocked</button>
            </div>

            <script>
                let savedPassword = "";

                function revealLauncher() {
                    let passInput = prompt("Enter passcode:");
                    if (passInput !== null && passInput.trim() !== "") {
                        savedPassword = passInput;
                        document.getElementById('errorScreen').classList.add('hidden');
                        document.getElementById('launcherScreen').classList.remove('hidden');
                        document.getElementById('pageBody').classList.add('launcher-body');
                    }
                }

                function launchProxy() {
                    let url = document.getElementById('targetUrl').value.trim();
                    if (!url) { alert("Please enter a URL."); return; }
                    if (!url.startsWith('http://') && !url.startsWith('https://')) { url = 'https://' + url; }

                    // Convert destination to an obfuscated base64 string so path structures don't break routing
                    let b64Target = btoa(url);
                    let proxiedUrl = window.location.origin + '/service/' + b64Target + '/?pwd=' + encodeURIComponent(savedPassword);
                    
                    let blankWindow = window.open('about:blank', '_blank');
                    if (!blankWindow) {
                        alert("Pop-up blocked! Please click the icon in your address bar and allow pop-ups.");
                        return;
                    }

                    blankWindow.document.write(\`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Proxy Session</title>
                            <style>
                                body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
                                iframe { width: 100%; height: 100%; border: none; }
                            </style>
                        </head>
                        <body>
                            <iframe src="\${proxiedUrl}" allowfullscreen></iframe>
                        </body>
                        </html>
                    \`);
                    blankWindow.document.close();
                }
            </script>
        </body>
        </html>
    `);
});

// 2. Strip standard browser restrictions, CORS blocks, and framing rules
const removeSecurityHeaders = (proxyRes, req, res) => {
    delete proxyRes.headers['x-frame-options'];
    delete proxyRes.headers['content-security-policy'];
    delete proxyRes.headers['content-security-policy-report-only'];
    delete proxyRes.headers['cross-origin-embedder-policy'];
    delete proxyRes.headers['cross-origin-opener-policy'];
    proxyRes.headers['access-control-allow-origin'] = '*';
    proxyRes.headers['access-control-allow-headers'] = '*';
};

// 3. Dynamic Router Gateway
// This catches any request routing through '/service/[BASE64_URL]/' and maps it to the exact host domain
app.use('/service/:targetBase64', (req, res, next) => {
    const providedPassword = req.query.pwd || req.headers['x-proxy-pwd'];
    
    if (providedPassword !== PROXY_PASSWORD) {
        return res.status(403).send('<h1>403 Forbidden</h1><p>Access Denied.</p>');
    }

    let targetUrl;
    try {
        targetUrl = decodeUrl(req.params.targetBase64);
    } catch (e) {
        return res.status(400).send('Invalid target URL packet.');
    }

    createProxyMiddleware({
        target: targetUrl,
        changeOrigin: true,
        ws: true, // Enables full multi-channel WebSocket sync pipelines for real-time traffic
        pathRewrite: (path, req) => {
            // Strips out the local proxy route directory prefix so backend destinations get clean file paths
            return path.replace(new RegExp('^/service/' + req.params.targetBase64), '');
        },
        onProxyRes: removeSecurityHeaders,
        onError: (err, req, res) => {
            if (!res.headersSent) {
                res.status(500).send('Network framing transfer mismatch.');
            }
        }
    })(req, res, next);
});

const server = app.listen(PORT, () => {
    console.log('Universal Proxy Engine operational.');
});
