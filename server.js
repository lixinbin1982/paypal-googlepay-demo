const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4001;
const CLIENT_ID = 'AVJ64pXVas3BtB-YrVVMFfCAZx2r2RlEjn0TwRtpGGNxqhhR-DRILDWX8gONSh-jSgunDQucOrVplXtm';
const CLIENT_SECRET = 'EF7BTKS5-hA43DK29EJ9cfAvSWPKkaQ1tAd9wy6BeUhAtoZ55NSG-vddh42_zp1QXrCSa77dTCuJIMzj';
const PAYPAL_API = 'https://api-m.sandbox.paypal.com';

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}

// Get PayPal access token
async function getAccessToken() {
  const tokenRes = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('Failed to get access token: ' + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

// Proxy PayPal GraphQL (sandbox.paypal.com/graphql)
async function proxyGraphQL(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const paypalRes = await fetch('https://www.sandbox.paypal.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const data = await paypalRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

const server = http.createServer(async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Proxy GraphQL calls to PayPal sandbox
  if (req.url.startsWith('/api/graphql') || req.url.startsWith('/graphql')) {
    return proxyGraphQL(req, res);
  }

  // Get Google Pay config (server-side)
  if (req.method === 'GET' && req.url === '/api/gpay-config') {
    try {
      const gqlRes = await fetch('https://www.sandbox.paypal.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `
            query getGooglePayConfig(
              $clientId: String!
              $merchantId: [String]!
              $merchantOrigin: String!
              $buyerCountry: CountryCodes
            ) {
              googlePayConfig(
                clientId: $clientId
                merchantId: $merchantId
                merchantOrigin: $merchantOrigin
                buyerCountry: $buyerCountry
              ){
                isEligible
                apiVersion
                apiVersionMinor
                countryCode
                allowedPaymentMethods{
                  type
                  parameters{
                    allowedAuthMethods
                    allowedCardNetworks
                    billingAddressRequired
                    assuranceDetailsRequired
                    billingAddressParameters { format }
                  }
                  tokenizationSpecification{
                    type
                    parameters {
                      gateway
                      gatewayMerchantId
                    }
                  }
                }
                merchantInfo {
                  merchantOrigin
                  merchantId
                }
              }
            }`,
          variables: {
            clientId: CLIENT_ID,
            merchantId: [],
            merchantOrigin: 'localhost:4001',
            buyerCountry: 'US',
          },
        }),
      });
      const data = await gqlRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Create PayPal order (server-side) — with 3DS processing_instruction
  if (req.method === 'POST' && req.url === '/api/create-order') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { amount, currency } = JSON.parse(body);
        const token = await getAccessToken();

        const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [{
              amount: { currency_code: currency || 'USD', value: amount || '132.97' }
            }]
          }),
        });
        const orderData = await orderRes.json();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: orderData.id }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Get order details (check status, processing_instruction, etc.)
  if (req.method === 'GET' && req.url.startsWith('/api/order-details/')) {
    try {
      const orderId = req.url.replace('/api/order-details/', '');
      const token = await getAccessToken();

      const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const orderData = await orderRes.json();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(orderData));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Authorize order (for 3DS intent)
  if (req.method === 'POST' && req.url === '/api/authorize-order') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { orderId } = JSON.parse(body);
        const token = await getAccessToken();

        const authRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/authorize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });
        const authData = await authRes.json();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(authData));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Capture PayPal order
  if (req.method === 'POST' && req.url === '/api/capture-order') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { orderId } = JSON.parse(body);
        const token = await getAccessToken();

        const captureRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });
        const captureData = await captureRes.json();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(captureData));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Confirm Google Pay payment via PayPal GraphQL (server-side)
  if (req.method === 'POST' && req.url === '/api/confirm-gpay') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { orderId, paymentMethodData } = JSON.parse(body);
        
        const gqlRes = await fetch('https://www.sandbox.paypal.com/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `
              mutation ApproveGooglePayPayment(
                $paymentMethodData: GooglePayPaymentMethodData!
                $orderID: String!
                $clientID: String!
                $productFlow: String
              ) {
                approveGooglePayPayment(
                  paymentMethodData: $paymentMethodData
                  orderID: $orderID
                  clientID: $clientID
                  productFlow: $productFlow
                )
              }`,
            variables: {
              paymentMethodData,
              clientID: CLIENT_ID,
              orderID: orderId,
              productFlow: 'CUSTOM_DIGITAL_WALLET',
            },
          }),
        });
        const data = await gqlRes.json();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Confirm payment source via REST API (uses OAuth2, no browser cookies needed)
  if (req.method === 'POST' && req.url === '/api/confirm-payment-source') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { orderId, paymentToken } = JSON.parse(body);
        const token = await getAccessToken();

        // Try parsing paymentToken as JSON (might be {signature, signedMessage} format)
        let resolvedToken = paymentToken;
        try {
          const parsed = JSON.parse(paymentToken);
          if (parsed.signature && parsed.signedMessage) {
            resolvedToken = parsed;
            console.log('[debug] Token is JSON with signature+signedMessage');
          }
        } catch (e) {}
        
        const tokenFirstChars = typeof paymentToken === 'string' ? paymentToken.substring(0, 100) : JSON.stringify(paymentToken).substring(0,100);
        console.log('[debug] Token starts with: ' + tokenFirstChars);

        const confirmPayload = {
          payment_source: {
            google_pay: {
              token: resolvedToken
            }
          }
        };
        console.log('[debug] confirm payload: ' + JSON.stringify(confirmPayload).substring(0, 300));

        const confirmRes = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/confirm-payment-source`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(confirmPayload),
        });
        const confirmData = await confirmRes.json();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(confirmData));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  serveFile(res, path.join(__dirname, 'www', filePath));
});

server.listen(PORT, () => {
  console.log(`🚀 Ben's Shop - Google Pay + 3DS Demo running at http://localhost:${PORT}`);
  console.log(`ℹ️  Endpoints:`);
  console.log(`     GET  /api/gpay-config          - Get Google Pay config`);
  console.log(`     POST /api/create-order         - Create PayPal order`);
  console.log(`     GET  /api/order-details/:id    - Get order status`);
  console.log(`     POST /api/authorize-order      - Authorize order (3DS)`);
  console.log(`     POST /api/capture-order        - Capture PayPal order`);
  console.log(`     POST /api/confirm-gpay         - Confirm Google Pay payment`);
});
