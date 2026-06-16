# Google Pay + PayPal 3DS Demo

A complete demo of Google Pay integration with PayPal, featuring 3D Secure authentication support.

## Prerequisites

1. **PayPal Sandbox Account** — sign up at [PayPal Developer](https://developer.paypal.com)
2. **Google Pay API** — enable via [Google Pay API Console](https://console.cloud.google.com/google-pay)
3. **Add test cards** — Chrome > Settings > Payment methods > Add card

### Test Cards (Google Pay Sandbox)

| Card Number | Purpose |
|---|---|
| `4111111111111111` | Visa success (no 3DS) |
| `4000000000001091` | Visa 3DS Challenge Required |
| `4000000000001109` | Visa 3DS Frictionless |
| `4222222222222222` | Mastercard success |
| `5555555555554444` | Mastercard success |

> Add these in Chrome Settings > Payment methods > Add card (any expiry/CVC works)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/lixinbin1982/paypal-googlepay-demo.git
cd paypal-googlepay-demo

# 2. Install
npm install

# 3. Start server
node server.js

# 4. Open browser
http://localhost:4001
```

## Credentials

At the top of `server.js`:

```javascript
const CLIENT_ID = 'your PayPal REST API Client ID';
const CLIENT_SECRET = 'your PayPal REST API Secret';
```

Get these from [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications) → **REST API Apps**.

## Flow

```
Browser                          Server                       PayPal
  │                                │                            │
  ├─ GET /api/gpay-config ────────►│                            │
  │◄── Google Pay config ──────────┤                            │
  │                                │                            │
  ├─ Google Pay isReadyToPay ──────┤ (browser → Google)        │
  ├─ Google Pay loadPaymentData ───┤                            │
  │◄── encrypted token ────────────┤                            │
  │                                │                            │
  ├─ POST /api/create-order ──────►│── POST /v2/checkout/orders ──►│
  │◄── order ID ──────────────────┤◄── order ──────────────────┤
  │                                │                            │
  ├─ SDK confirmOrder ─────────────┤ (browser → PayPal GraphQL) │
  │◄── payment token ✓ ────────────┤                            │
  │                                │                            │
  ├─ SDK 3DS check ────────────────┤                            │
  │  (if PAYER_ACTION_REQUIRED)    │                            │
  │  ├─ 3DS iframe popup ──────────┤                            │
  │  └─ onSuccess ─────────────────┤                            │
  │                                │                            │
  ├─ POST /api/capture-order ─────►│── POST /v2/checkout/orders ──►│
  │◄── COMPLETED! ────────────────┤◄── capture ────────────────┤
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/gpay-config` | GET | Fetch Google Pay config via PayPal SDK |
| `/api/create-order` | POST | Create a PayPal order |
| `/api/order-details/:id` | GET | Check order status |
| `/api/capture-order` | POST | Capture the order |
| `/api/confirm-payment-source` | POST | (Fallback) REST API confirm |
| `/api/confirm-gpay` | POST | (Fallback) GraphQL confirm proxy |

## Architecture Decisions

### Server Proxy
PayPal REST API requires server-side OAuth2 tokens. Direct browser calls get blocked by CORS, so all REST API calls go through an internal server proxy.

### SDK Native Confirm
`confirmOrder()` uses the PayPal JS SDK's built-in `Googlepay().confirmOrder()` to call PayPal GraphQL directly from the browser. The SDK sends the necessary cookies and auth headers — without them, PayPal can't decrypt the Google Pay token.

### 3DS
When a card requires 3DS authentication, PayPal returns `PAYER_ACTION_REQUIRED`. The frontend uses the `ThreeDomainSecure` component to show a 3DS challenge iframe, then captures the order on success.

> **Note:** Google Pay TEST tokens may not support 3DS test cards in sandbox. Production real-card tokens work correctly.

## Tech Stack

- **Frontend:** Vanilla JS + Google Pay API + PayPal JS SDK
- **Backend:** Node.js (raw http) — zero external dependencies
- **SSL/Tunnel:** ngrok (for mobile / external testing)
