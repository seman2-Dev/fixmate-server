import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import Stripe from 'stripe';
import { canMoveStatus } from './lib/business.js';

// Third-party clients are initialized once and shared by every API route.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// BetterAuth runs on the deployed Next.js client and issues the JWTs consumed here.
const clientUrl = (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/+$/, '');
// CLIENT_ORIGINS accepts a comma-separated allowlist; add the production domain before deployment.
const origins = (process.env.CLIENT_ORIGINS || clientUrl).split(',').map((o) => o.trim().replace(/\/+$/, ''));

// CORS and JSON parsing run before protected route middleware.
app.use(cors({
    origin(origin, callback) {
        if (!origin || origins.includes(origin)) return callback(null, true);
        callback(new Error('Origin not allowed by CORS'));
    },
}));
app.use((req, res, next) => {
    if (req.originalUrl === '/api/payments/webhook') return next();
    express.json()(req, res, next);
});

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
console.log('You successfully connected to MongoDB!');

// The application uses only these four business collections.
const database = client.db(process.env.DB_NAME || 'fixmate');
const users = database.collection('user'); // BetterAuth's user collection = our users collection
const services = database.collection('services');
const bookings = database.collection('bookings');
const payments = database.collection('payments');

// Unique indexes enforce duplicate active requests and one payment per checkout booking.
await bookings.createIndex({ activeKey: 1 }, { unique: true, sparse: true });
await payments.createIndex({ stripeSessionId: 1 }, { unique: true });
await payments.createIndex({ bookingId: 1 }, { unique: true });

app.get('/', (req, res) => {
    res.send('fixmate server is running');
})

// ======================= Validation and query helpers =======================

const categories = ['Smartphone', 'Laptop & PC', 'AC', 'Refrigerator', 'TV', 'Washing Machine', 'Electrical'];
const serviceModes = ['Home Visit', 'Shop Drop-off'];
const approvals = ['pending', 'approved', 'rejected'];
const statuses = ['requested', 'accepted', 'rejected', 'in-progress', 'completed', 'cancelled'];
const roles = ['customer', 'technician', 'admin'];

const toId = (id) => (typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : null);
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const hideKey = { projection: { activeKey: 0 } };

// =========================== JWT and role middleware ====================

const jwks = createRemoteJWKSet(new URL(process.env.JWKS_URL || `${clientUrl}/api/auth/jwks`));

// 401: no token, bad token or expired token. The role comes from the database, not from the token.
const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).send({ message: 'Unauthorized' });
    }

    let user = null;
    try {
        const { payload } = await jwtVerify(token, jwks, { issuer: clientUrl, audience: clientUrl });
        user = await users.findOne({ email: String(payload.email).toLowerCase() });
        if (user && payload.sub && payload.sub !== String(user._id)) user = null;
    } catch {
        user = null;
    }
    if (!user) {
        return res.status(401).send({ message: 'Unauthorized' });
    }

    req.user = { ...user, role: user.role || 'customer' };
    next();
}

// 403: valid user, wrong role. Must be used after verifyToken
const verifyRole = (role) => (req, res, next) => {
    if (req.user.role !== role) {
        return res.status(403).send({ message: 'Forbidden' });
    }
    next();
}
const verifyCustomer = verifyRole('customer');
const verifyTechnician = verifyRole('technician');
const verifyAdmin = verifyRole('admin');

// =========== payments: save + webhook (the webhook needs the raw body, so it comes before express.json) ==============
// Used by the success page AND the webhook. A payment is never saved twice
// (unique stripeSessionId and bookingId), and a booking only goes unpaid -> paid.
const savePayment = async (session) => {
    if (session.payment_status !== 'paid') return { status: 409, message: 'Payment is not completed' };

    const bookingId = toId(session.metadata?.bookingId);
    const booking = bookingId ? await bookings.findOne({ _id: bookingId }) : null;
    if (!booking || booking.customerEmail !== session.metadata?.customerEmail) {
        return { status: 404, message: 'Booking not found for this payment' };
    }
    if (booking.status !== 'completed' || session.amount_total !== Math.round(booking.finalAmount * 100)) {
        return { status: 409, message: 'Paid amount does not match the booking' };
    }

    let payment = await payments.findOne({ stripeSessionId: session.id });
    if (!payment) {
        const newPayment = {
            bookingId: String(booking._id),
            serviceTitle: booking.serviceTitle,
            customerName: booking.customerName,
            customerEmail: booking.customerEmail,
            technicianName: booking.technicianName,
            technicianEmail: booking.technicianEmail,
            amount: booking.finalAmount,
            currency: 'usd',
            transactionId: session.payment_intent?.id || session.payment_intent || session.id,
            stripeSessionId: session.id,
            paymentStatus: 'paid',
            paidAt: new Date(),
        };
        try {
            const result = await payments.insertOne(newPayment);
            payment = { ...newPayment, _id: result.insertedId };
        } catch (err) {
            if (err.code !== 11000) throw err;
            payment = await payments.findOne({ bookingId: String(booking._id) }); // saved a moment ago by the other path
        }
    }

    await bookings.updateOne(
        { _id: booking._id, paymentStatus: 'unpaid' },
        {
            $set: { paymentStatus: 'paid' },
            $push: { statusHistory: { status: 'paid', changedAt: new Date() } },
        },
    );
    return { payment };
}

// Stripe webhook: a wrong signature gets 400
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    } catch {
        return res.status(400).send({ message: 'Invalid Stripe signature' });
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const result = await savePayment(event.data.object);
        if (!result.payment) console.log('webhook ignored:', result.message); // answer 200 so Stripe does not retry forever
    }
    res.send({ received: true });
})

app.use(express.json());

// ===================== Public and technician services =====================

// Challenge 1: search, filter and sort run in MongoDB
// GET /api/services?q=&category=&mode=&sort=newest|price-asc|price-desc&limit=
app.get('/api/services', async (req, res) => {
    const q = text(req.query.q);
    const category = text(req.query.category);
    const mode = text(req.query.mode);
    const sort = text(req.query.sort);
    const limit = req.query.limit === undefined ? 0 : Number(req.query.limit);
    const page = req.query.page === undefined ? 1 : Number(req.query.page);

    if (category && !categories.includes(category)) return res.status(400).send({ message: 'Invalid category' });
    if (mode && !serviceModes.includes(mode)) return res.status(400).send({ message: 'Invalid service mode' });
    if (sort && !['newest', 'price-asc', 'price-desc'].includes(sort)) return res.status(400).send({ message: 'Invalid sort' });
    if (req.query.limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
        return res.status(400).send({ message: 'limit must be between 1 and 100' });
    }
    if (req.query.page !== undefined && (!Number.isInteger(page) || page < 1)) {
        return res.status(400).send({ message: 'page must be a positive integer' });
    }

    // only approved and available services are public
    const query = { approvalStatus: 'approved', isAvailable: true };
    if (category) query.category = category;
    if (mode) query.serviceMode = mode;
    if (q) {
        const search = { $regex: q.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
        query.$or = [{ title: search }, { category: search }];
    }

    let sortBy = { createdAt: -1 };
    if (sort === 'price-asc') sortBy = { basePrice: 1 };
    if (sort === 'price-desc') sortBy = { basePrice: -1 };

    const total = limit ? await services.countDocuments(query) : 0;
    const cursor = services.find(query).sort(sortBy);
    if (limit) {
        cursor.skip((page - 1) * limit).limit(limit);
        res.set('X-Total-Count', String(total));
        res.set('X-Total-Pages', String(Math.max(1, Math.ceil(total / limit))));
        res.set('X-Current-Page', String(page));
    }
    res.send(await cursor.toArray());
})

// the logged-in technician's own services (any approval status)
app.get('/api/services/mine', verifyToken, verifyTechnician, async (req, res) => {
    const result = await services.find({ technicianEmail: req.user.email }).sort({ createdAt: -1 }).toArray();
    res.send(result);
})

app.get('/api/services/:id', async (req, res) => {
    const id = toId(req.params.id);
    const service = id ? await services.findOne({ _id: id, approvalStatus: 'approved', isAvailable: true }) : null;
    if (!service) return res.status(404).send({ message: 'Service not found' });

    // technician summary for the details page
    const technician = await users.findOne({ email: service.technicianEmail }, { projection: { name: 1, image: 1, area: 1, bio: 1 } });
    res.send({ ...service, technician });
})

// checks the service form. Returns an error message (or '') and the clean data
const readService = (body) => {
    const service = {
        title: text(body.title),
        category: text(body.category),
        description: text(body.description),
        image: text(body.image),
        basePrice: Number(body.basePrice),
        estimatedDuration: text(body.estimatedDuration),
        serviceMode: text(body.serviceMode),
        serviceArea: text(body.serviceArea),
    };
    let error = '';
    if (service.title.length < 3) error = 'Title must be at least 3 characters';
    else if (!categories.includes(service.category)) error = 'Choose a valid category';
    else if (service.description.length < 20) error = 'Description must be at least 20 characters';
    else if (!/^https?:\/\//i.test(service.image)) error = 'Service image is required';
    else if (!(service.basePrice > 0)) error = 'Base price must be a positive number';
    else if (!service.estimatedDuration) error = 'Estimated duration is required';
    else if (!serviceModes.includes(service.serviceMode)) error = 'Choose a valid service mode';
    else if (!service.serviceArea) error = 'Service area is required';
    return { error, service };
}

app.post('/api/services', verifyToken, verifyTechnician, async (req, res) => {
    const { error, service } = readService(req.body || {});
    if (error) return res.status(400).send({ message: error });

    const newService = {
        ...service,
        technicianName: req.user.name, // from the logged-in technician, never from the body
        technicianEmail: req.user.email,
        approvalStatus: 'pending',
        isAvailable: true,
        createdAt: new Date(),
    };
    const result = await services.insertOne(newService);
    res.status(201).send({ ...newService, _id: result.insertedId });
})

// edit the service (full form) or switch availability (only { isAvailable }). Owner only
app.patch('/api/services/:id', verifyToken, verifyTechnician, async (req, res) => {
    const id = toId(req.params.id);
    const service = id ? await services.findOne({ _id: id }) : null;
    if (!service) return res.status(404).send({ message: 'Service not found' });
    if (service.technicianEmail !== req.user.email) return res.status(403).send({ message: 'Forbidden' });

    const body = req.body || {};
    if (Object.keys(body).length === 1 && typeof body.isAvailable === 'boolean') {
        await services.updateOne({ _id: id }, { $set: { isAvailable: body.isAvailable } });
        return res.send({ message: 'Availability updated' });
    }

    const { error, service: changes } = readService(body);
    if (error) return res.status(400).send({ message: error });
    // an edited service must be approved again
    await services.updateOne({ _id: id }, { $set: { ...changes, approvalStatus: 'pending' } });
    res.send({ message: 'Service updated and sent for approval again' });
})

app.delete('/api/services/:id', verifyToken, verifyTechnician, async (req, res) => {
    const id = toId(req.params.id);
    const service = id ? await services.findOne({ _id: id }) : null;
    if (!service) return res.status(404).send({ message: 'Service not found' });
    if (service.technicianEmail !== req.user.email) return res.status(403).send({ message: 'Forbidden' });

    await services.deleteOne({ _id: id });
    res.send({ message: 'Service deleted' });
})

// ======================= Customer and technician bookings =======================

// customer sends a repair request
app.post('/api/bookings', verifyToken, verifyCustomer, async (req, res) => {
    const body = req.body || {};
    const customerPhone = text(body.customerPhone);
    const address = text(body.address);
    const problemDescription = text(body.problemDescription);
    const date = text(body.preferredDate);

    if (customerPhone.length < 7) return res.status(400).send({ message: 'Enter a valid phone number' });
    if (address.length < 5) return res.status(400).send({ message: 'Enter your address' });
    if (problemDescription.length < 20) return res.status(400).send({ message: 'Problem description must be at least 20 characters' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
        return res.status(400).send({ message: 'Choose a valid preferred date' });
    }
    if (date < new Date().toISOString().slice(0, 10)) {
        return res.status(400).send({ message: 'Preferred date must be today or in the future' });
    }

    const serviceId = toId(body.serviceId);
    const service = serviceId ? await services.findOne({ _id: serviceId, approvalStatus: 'approved', isAvailable: true }) : null;
    if (!service) return res.status(404).send({ message: 'This service is not available' });

    const customer = req.user;
    // service and technician details are copied, so the booking stays correct if the service changes later
    const booking = {
        serviceId: String(service._id),
        serviceTitle: service.title,
        serviceImage: service.image,
        category: service.category,
        basePrice: service.basePrice,
        technicianName: service.technicianName,
        technicianEmail: service.technicianEmail,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone,
        address,
        preferredDate: new Date(date),
        problemDescription,
        status: 'requested',
        finalAmount: service.basePrice,
        paymentStatus: 'unpaid',
        statusHistory: [{ status: 'requested', changedAt: new Date() }],
        // unique + sparse index: one active request per customer per service
        activeKey: `${customer.email}|${service._id}`,
        createdAt: new Date(),
    };

    try {
        const result = await bookings.insertOne(booking);
        delete booking.activeKey;
        res.status(201).send({ ...booking, _id: result.insertedId });
    } catch (err) {
        if (err.code === 11000) return res.status(409).send({ message: 'You already have an active request for this service' });
        throw err;
    }
})

// a customer only gets their own bookings (the email comes from the token, not from the URL)
app.get('/api/bookings/my', verifyToken, verifyCustomer, async (req, res) => {
    const result = await bookings.find({ customerEmail: req.user.email }, hideKey).sort({ createdAt: -1 }).toArray();
    res.send(result);
})

// the customer can cancel only while the job is still requested
app.patch('/api/bookings/:id/cancel', verifyToken, verifyCustomer, async (req, res) => {
    const id = toId(req.params.id);
    const booking = id ? await bookings.findOne({ _id: id }) : null;
    if (!booking) return res.status(404).send({ message: 'Booking not found' });
    if (booking.customerEmail !== req.user.email) return res.status(403).send({ message: 'Forbidden' });

    // the status is part of the filter, so an accept at the same moment cannot be overwritten
    const result = await bookings.updateOne(
        { _id: id, status: 'requested' },
        {
            $set: { status: 'cancelled' },
            $unset: { activeKey: '' },
            $push: { statusHistory: { status: 'cancelled', changedAt: new Date() } },
        }
    );
    if (result.matchedCount === 0) return res.status(409).send({ message: 'Only a requested job can be cancelled' });
    res.send({ message: 'Booking cancelled' });
})

// a technician only gets the bookings that belong to them
app.get('/api/bookings/technician', verifyToken, verifyTechnician, async (req, res) => {
    const result = await bookings.find({ technicianEmail: req.user.email }, hideKey).sort({ createdAt: -1 }).toArray();
    res.send(result);
})

// Challenge 3: the job status pipeline. Current status -> the only statuses it can move to
app.patch('/api/bookings/:id/status', verifyToken, verifyTechnician, async (req, res) => {
    const id = toId(req.params.id);
    const booking = id ? await bookings.findOne({ _id: id }) : null;
    if (!booking) return res.status(404).send({ message: 'Booking not found' });
    // only the technician who owns the job can change it
    if (booking.technicianEmail !== req.user.email) return res.status(403).send({ message: 'Forbidden' });

    const status = text(req.body?.status);
    if (!statuses.includes(status)) return res.status(400).send({ message: 'Invalid status' });
    if (!canMoveStatus(booking.status, status)) {
        return res.status(409).send({ message: `A ${booking.status} job cannot be changed to ${status}` });
    }

    const changes = { status };
    if (status === 'completed') {
        const finalAmount = req.body.finalAmount;
        if (typeof finalAmount !== 'number' || !(finalAmount > 0) || !Number.isFinite(finalAmount)) {
            return res.status(400).send({ message: 'Final amount must be a number greater than 0' });
        }
        changes.finalAmount = finalAmount;
    }

    // rejected and completed jobs are not active any more, so the customer can request the service again
    const update = { $set: changes };
    update.$push = { statusHistory: { status, changedAt: new Date() } };
    if (status === 'rejected' || status === 'completed') update.$unset = { activeKey: '' };

    // the current status is part of the filter, so two quick requests cannot both win
    const result = await bookings.updateOne({ _id: id, status: booking.status }, update);
    if (result.matchedCount === 0) return res.status(409).send({ message: 'The job was changed by someone else, refresh and try again' });
    res.send({ message: `Job is now ${status}` });
})

// ======================= Stripe checkout and payment verification =======================

// Pay Now. The amount always comes from the booking in the database, never from the client.
// Only a completed and unpaid booking of the logged-in customer can be paid.
app.post('/api/payments/create-checkout-session', verifyToken, verifyCustomer, async (req, res) => {
    const id = toId(req.body?.bookingId);
    const booking = id ? await bookings.findOne({ _id: id }) : null;
    if (!booking) return res.status(404).send({ message: 'Booking not found' });
    if (booking.customerEmail !== req.user.email) return res.status(403).send({ message: 'Forbidden' });
    if (booking.status !== 'completed' || booking.paymentStatus !== 'unpaid') {
        return res.status(409).send({ message: 'Only a completed and unpaid job can be paid' });
    }

    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: booking.customerEmail,
        line_items: [{
            quantity: 1,
            price_data: {
                currency: 'usd',
                unit_amount: Math.round(booking.finalAmount * 100), // cents
                product_data: { name: booking.serviceTitle },
            },
        }],
        metadata: { bookingId: String(booking._id), customerEmail: booking.customerEmail },
        success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl}/payment/cancel`,
    });
    res.send({ sessionId: session.id, url: session.url });
})

// the /payment/success page calls this with the session_id from the URL
app.get('/api/payments/verify', verifyToken, verifyCustomer, async (req, res) => {
    const sessionId = text(req.query.session_id);
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return res.status(400).send({ message: 'session_id is required' });

    // ask Stripe, never trust the browser
    let session;
    try {
        session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch {
        return res.status(404).send({ message: 'Payment session not found' });
    }
    if (session.metadata?.customerEmail !== req.user.email) return res.status(403).send({ message: 'Forbidden' });

    const result = await savePayment(session);
    if (!result.payment) return res.status(result.status).send({ message: result.message });
    res.send(result.payment);
})

// the logged-in customer's payment history
app.get('/api/payments/my', verifyToken, verifyCustomer, async (req, res) => {
    const result = await payments.find({ customerEmail: req.user.email }).sort({ paidAt: -1 }).toArray();
    res.send(result);
})

// ======================= Protected admin operations =======================

app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res) => {
    const result = await users
        .find({}, { projection: { name: 1, email: 1, image: 1, role: 1, phone: 1, area: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .toArray();
    res.send(result);
})

// role changes only happen here. An admin cannot change their own role
app.patch('/api/admin/users/:id/role', verifyToken, verifyAdmin, async (req, res) => {
    const id = toId(req.params.id);
    const role = text(req.body?.role);
    if (!roles.includes(role)) return res.status(400).send({ message: 'Role must be customer, technician or admin' });

    const user = id ? await users.findOne({ _id: id }) : null;
    if (!user) return res.status(404).send({ message: 'User not found' });
    if (String(user._id) === String(req.user._id)) return res.status(403).send({ message: 'You cannot change your own role' });

    await users.updateOne({ _id: id }, { $set: { role } });
    res.send({ message: `${user.name} is now a ${role}` });
})

// all services of all technicians (?approvalStatus= filter), pending ones first
app.get('/api/admin/services', verifyToken, verifyAdmin, async (req, res) => {
    const approvalStatus = text(req.query.approvalStatus);
    if (approvalStatus && !approvals.includes(approvalStatus)) return res.status(400).send({ message: 'Invalid approval status' });

    const result = await services.find(approvalStatus ? { approvalStatus } : {}).sort({ createdAt: -1 }).toArray();
    result.sort((a, b) => (b.approvalStatus === 'pending') - (a.approvalStatus === 'pending'));
    res.send(result);
})

app.patch('/api/admin/services/:id/approval', verifyToken, verifyAdmin, async (req, res) => {
    const id = toId(req.params.id);
    const approvalStatus = text(req.body?.approvalStatus);
    if (!approvals.includes(approvalStatus)) return res.status(400).send({ message: 'approvalStatus must be approved, rejected or pending' });

    const result = id ? await services.updateOne({ _id: id }, { $set: { approvalStatus } }) : null;
    if (!result || result.matchedCount === 0) return res.status(404).send({ message: 'Service not found' });
    res.send({ message: `Service ${approvalStatus}` });
})

// every booking on the platform (?status= filter)
app.get('/api/admin/bookings', verifyToken, verifyAdmin, async (req, res) => {
    const status = text(req.query.status);
    if (status && !statuses.includes(status)) return res.status(400).send({ message: 'Invalid status' });

    const result = await bookings.find(status ? { status } : {}, hideKey).sort({ createdAt: -1 }).toArray();
    res.send(result);
})

// every payment and the total revenue (added in cents so decimals never drift)
app.get('/api/admin/payments', verifyToken, verifyAdmin, async (req, res) => {
    const result = await payments.find({}).sort({ paidAt: -1 }).toArray();
    const cents = result.reduce((sum, payment) => sum + Math.round(payment.amount * 100), 0);
    res.send({ totalRevenue: cents / 100, payments: result });
})

// ========================= profile (every logged-in user) =====================

// only name, phone, area, bio and image are used. role and email are ignored
app.patch('/api/users/profile', verifyToken, async (req, res) => {
    const body = req.body || {};
    const name = text(body.name);
    const phone = text(body.phone);
    const area = text(body.area);
    const bio = text(body.bio);

    if (name.length < 2 || name.length > 60) return res.status(400).send({ message: 'Name must be 2-60 characters' });
    if (phone.length > 20) return res.status(400).send({ message: 'Phone number is too long' });
    if (area.length > 100) return res.status(400).send({ message: 'Area is too long' });
    if (bio.length > 500) return res.status(400).send({ message: 'Bio must be 500 characters or fewer' });

    const changes = { name, phone, area, bio, updatedAt: new Date() };
    if (body.image !== undefined) {
        const image = text(body.image);
        if (image && !/^https?:\/\//i.test(image)) return res.status(400).send({ message: 'Invalid image URL' });
        changes.image = image;
    }

    await users.updateOne({ _id: req.user._id }, { $set: changes });
    // keep the technician name on their services up to date
    if (req.user.role === 'technician') {
        await services.updateMany({ technicianEmail: req.user.email }, { $set: { technicianName: name } });
    }
    res.send({ message: 'Profile updated', user: { name, phone, area, bio, image: changes.image ?? req.user.image } });
})

// ============================= not found and errors =======================

app.use((req, res) => {
    res.status(404).send({ message: `Route not found: ${req.method} ${req.path}` });
})

app.use((err, req, res, next) => {
    // bad JSON is the client's fault, everything else is a server error
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).send({ message: status === 500 ? 'Internal server error' : 'Invalid request' });
})

app.listen(port, () => {
    console.log(`fixmate server is running on port: ${port}`);
})

export default app;