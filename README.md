# Google Pay + PayPal 3DS Demo

Google Pay 整合 PayPal 嘅完整 demo，支援 3D Secure 驗證。

## 事前準備

1. **PayPal Sandbox Account** — 一個 PayPal Developer 帳號
2. **Google Pay API 開通** — 去 [Google Pay API Console](https://console.cloud.google.com/google-pay) enable
3. **Browser 加測試卡** — Chrome > Settings > Payment methods > Add card

### 測試卡（Google Pay Sandbox）

| Card Number | 用途 |
|---|---|
| `4111111111111111` | Visa 普通卡（成功付款） |
| `4000000000001091` | Visa 3DS Challenge Required |
| `4000000000001109` | Visa 3DS Frictionless |
| `4222222222222222` | Mastercard 普通卡 |
| `5555555555554444` | Mastercard 普通卡 |

> 去 Chrome Settings > Payment methods > Add card，填以上 card number + 任意 expiry/CVC

## 快速開始

```bash
# 1. Clone
git clone https://github.com/lixinbin1982/paypal-googlepay-demo.git
cd paypal-googlepay-demo

# 2. Install
npm install

# 3. 開 server
node server.js

# 4. 開 browser，去
http://localhost:4001
```

## 所需 Credentials

喺 `server.js` 最頂：

```javascript
const CLIENT_ID = '你的 PayPal REST API Client ID';
const CLIENT_SECRET = '你的 PayPal REST API Secret';
```

去 [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications) → **REST API Apps** 搵到。

## 個 Flow

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

| Endpoint | Method | 用途 |
|---|---|---|
| `/api/gpay-config` | GET | 攞 Google Pay config（PayPal SDK config） |
| `/api/create-order` | POST | 建立 PayPal order |
| `/api/order-details/:id` | GET | Check order status |
| `/api/capture-order` | POST | Capture 訂單 |
| `/api/confirm-payment-source` | POST | (備用) REST API confirm |
| `/api/confirm-gpay` | POST | (備用) GraphQL confirm proxy |

## 點解咁樣設計？

### Server Proxy
PayPal API 要求 server-side OAuth2 token，browser 直接 call 會被 CORS block。所以全部 REST API call 都經過 server proxy。

### SDK Native Confirm
`confirmOrder()` 用 PayPal JS SDK 嘅 `Googlepay().confirmOrder()` 直接喺 browser call PayPal GraphQL — SDK 會帶 cookies/headers，PayPal 先識得 decrypt Google Pay token。

### 3DS
當張卡需要 3DS 驗證，PayPal 會 return `PAYER_ACTION_REQUIRED`，前端用 `ThreeDomainSecure` component 開 iframe 做驗證，完成後先 capture。

> **注意：** Google Pay TEST 環境嘅 token 有機會唔支援 3DS test cards，但 production 用 real card 係正常嘅。

## Tech Stack

- **Frontend:** Vanilla JS + Google Pay API + PayPal JS SDK
- **Backend:** Node.js (raw http) — no Express, zero dependencies
- **SSL:** ngrok (for mobile testing)
