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
npm run seed
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
- Stripe webhook payment confirmation

No secrets or `.env` files are committed.
