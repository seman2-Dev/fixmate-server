# FixMate Server

Express.js, MongoDB, JWT, Stripe and webhook API for the FixMate repair platform.

## Requirements

- Node.js 20+
- MongoDB
- A BetterAuth client deployed at `CLIENT_URL`
- Stripe test-mode credentials

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

The server runs on `http://localhost:5000`.

## Scripts

```bash
npm run build
npm test
npm run seed
npm start
```

## Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Express port |
| `MONGODB_URI` | MongoDB connection string |
| `DB_NAME` | Database name |
| `CLIENT_URL` | Trusted Next.js origin |
| `CLIENT_ORIGINS` | Comma-separated CORS origins |
| `JWKS_URL` | BetterAuth JWT JWKS endpoint |
| `STRIPE_SECRET_KEY` | Stripe test secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

## API

- Public service search, filter, sort and pagination
- Customer booking, cancellation and payment APIs
- Technician service CRUD and job status APIs
- Admin user, service, booking and payment APIs
- Profile, Stripe Checkout and idempotent payment verification APIs
- Stripe webhook payment confirmation at `/api/stripe/webhook`
- Health check at `/api/health`

## Production

The production API is intended to be deployed at `https://fixmate-server1.vercel.app`.
Set `CLIENT_URL` to the deployed Next.js origin, and set `CLIENT_ORIGINS` to a
comma-separated allowlist containing that origin. Set `JWKS_URL` to
`https://<client-domain>/api/auth/jwks`.

In Stripe, configure the webhook endpoint:
`https://fixmate-server1.vercel.app/api/stripe/webhook`

The event should subscribe to `checkout.session.completed`; copy the generated
signing secret into `STRIPE_WEBHOOK_SECRET`.

No secrets or `.env` files are committed.
