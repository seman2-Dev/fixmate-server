import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) throw new Error('MONGODB_URI is required');

const clientUrl = (process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/+$/, '');
const dbName = process.env.DB_NAME || 'fixmate';

const accounts = [
    { name: 'Emran Hasan', email: 'emran@fixmate.dev', role: 'customer', password: 'FixMate1@customer', phone: '+8801711111111', area: 'Mirpur, Dhaka', bio: '' },
    { name: 'Rafiq Electronics', email: 'rafiq@fixmate.dev', role: 'technician', password: 'FixMate1@technician', phone: '+8801733333333', area: 'Mirpur, Dhaka', bio: 'Certified smartphone and laptop technician with 8 years of repair experience.' },
    { name: 'Nusrat Cooling Care', email: 'nusrat@fixmate.dev', role: 'technician', password: 'FixMate1@technician', phone: '+8801744444444', area: 'Uttara, Dhaka', bio: 'AC, refrigerator and washing machine specialist for homes and offices.' },
    { name: 'FixMate Admin', email: 'admin@fixmate.dev', role: 'admin', password: 'FixMate1@admin', phone: '+8801755555555', area: 'Dhaka', bio: 'Platform administrator.' },
];

async function ensureAccount(account) {
    const response = await fetch(`${clientUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: clientUrl,
        },
        body: JSON.stringify({
            name: account.name,
            email: account.email,
            password: account.password,
            role: account.role,
        }),
    });
    if (response.ok) return;

    const body = await response.text();
    if (!body.toLowerCase().includes('already')) {
        console.warn(`Could not create ${account.email}: ${response.status} ${body}`);
    }
}

const mongo = new MongoClient(mongoUri);
await mongo.connect();
const db = mongo.db(dbName);
const users = db.collection('user');
const services = db.collection('services');
const bookings = db.collection('bookings');
const payments = db.collection('payments');

const seededEmails = accounts.map((account) => account.email);
const existingUsers = await users.find({ email: { $in: seededEmails } }).toArray();
const existingUserIds = existingUsers.map((user) => user._id);
await Promise.all([
    users.deleteMany({ email: { $in: seededEmails } }),
    db.collection('account').deleteMany({ userId: { $in: existingUserIds } }),
    db.collection('session').deleteMany({ userId: { $in: existingUserIds } }),
]);

for (const account of accounts) await ensureAccount(account);
await Promise.all(accounts.map((account) => users.updateOne(
    { email: account.email },
    {
        $set: {
            name: account.name,
            role: account.role,
            phone: account.phone,
            area: account.area,
            bio: account.bio,
            updatedAt: new Date(),
        },
    },
)));

await Promise.all([
    services.deleteMany({ technicianEmail: { $in: ['rafiq@fixmate.dev', 'nusrat@fixmate.dev'] } }),
    bookings.deleteMany({ customerEmail: { $in: ['emran@fixmate.dev', 'ayesha@fixmate.dev', 'tanvir@fixmate.dev'] } }),
    payments.deleteMany({ customerEmail: { $in: ['emran@fixmate.dev', 'ayesha@fixmate.dev', 'tanvir@fixmate.dev'] } }),
]);

const now = Date.now();
const serviceRows = [
    ['iPhone Screen Replacement', 'Smartphone', 'Professional front-screen replacement for modern iPhone models.', '/services/s01.jpg', 79, '1-2 hours', 'Shop Drop-off', 'Mirpur, Dhaka', 'rafiq@fixmate.dev'],
    ['Android Battery Replacement', 'Smartphone', 'Battery health restoration with genuine-compatible replacement cells.', '/services/s02.jpg', 35, '45-90 minutes', 'Home Visit', 'Mirpur, Dhaka', 'rafiq@fixmate.dev'],
    ['Laptop Deep Cleaning', 'Laptop & PC', 'Dust removal, thermal paste renewal and cooling performance check.', '/services/s03.jpg', 49, '2-3 hours', 'Shop Drop-off', 'Dhanmondi, Dhaka', 'rafiq@fixmate.dev'],
    ['Laptop Screen & Hinge Repair', 'Laptop & PC', 'Screen, hinge and frame diagnosis with professional replacement.', '/services/s04.jpg', 89, '1 day', 'Shop Drop-off', 'Dhanmondi, Dhaka', 'rafiq@fixmate.dev'],
    ['Split AC Installation', 'AC', 'Safe split AC mounting, copper setup, drainage and commissioning.', '/services/s05.jpg', 69, '3-4 hours', 'Home Visit', 'Uttara, Dhaka', 'nusrat@fixmate.dev'],
    ['AC General Servicing', 'AC', 'Filter cleaning, coil wash, gas pressure check and cooling test.', '/services/s06.jpg', 55, '2-3 hours', 'Home Visit', 'Uttara, Dhaka', 'nusrat@fixmate.dev'],
    ['Refrigerator Cooling Repair', 'Refrigerator', 'Diagnosis and repair for weak cooling, noise and frosting faults.', '/services/s07.jpg', 65, '3-5 hours', 'Home Visit', 'Gulshan, Dhaka', 'nusrat@fixmate.dev'],
    ['Compressor Replacement', 'Refrigerator', 'Compressor, relay and capacitor replacement for compatible refrigerators.', '/services/s08.jpg', 145, '1 day', 'Home Visit', 'Gulshan, Dhaka', 'nusrat@fixmate.dev'],
    ['LED TV Wall Mounting', 'TV', 'Secure TV wall mounting with cable routing and setup.', '/services/s09.jpg', 45, '1-2 hours', 'Home Visit', 'Banani, Dhaka', 'rafiq@fixmate.dev'],
    ['TV Backlight Repair', 'TV', 'Backlight strip and power-board diagnosis for LED and Smart TVs.', '/services/s10.jpg', 75, '1 day', 'Shop Drop-off', 'Banani, Dhaka', 'rafiq@fixmate.dev'],
    ['Washing Machine Drum Repair', 'Washing Machine', 'Drum, bearing and belt diagnosis with complete washing test.', '/services/s11.webp', 85, '4-6 hours', 'Home Visit', 'Uttara, Dhaka', 'nusrat@fixmate.dev'],
    ['Home Electrical Wiring', 'Electrical', 'Switch, socket and safe home circuit troubleshooting.', '/services/s12.jpg', 40, '2-4 hours', 'Home Visit', 'Mirpur, Dhaka', 'rafiq@fixmate.dev'],
];

const technicians = {
    'rafiq@fixmate.dev': 'Rafiq Electronics',
    'nusrat@fixmate.dev': 'Nusrat Cooling Care',
};

await services.insertMany(serviceRows.map((row, index) => ({
    title: row[0],
    category: row[1],
    description: row[2],
    image: row[3],
    basePrice: row[4],
    estimatedDuration: row[5],
    serviceMode: row[6],
    serviceArea: row[7],
    technicianName: technicians[row[8]],
    technicianEmail: row[8],
    approvalStatus: 'approved',
    isAvailable: true,
    createdAt: new Date(now - index * 3600000),
})));

const seededServices = await services.find({ technicianEmail: { $in: ['rafiq@fixmate.dev', 'nusrat@fixmate.dev'] } }).toArray();
const [service1, service2, service3, service4] = seededServices;
const makeBooking = (service, customerName, customerEmail, status, paymentStatus = 'unpaid', offset = 0) => ({
    serviceId: String(service._id),
    serviceTitle: service.title,
    serviceImage: service.image,
    category: service.category,
    basePrice: service.basePrice,
    technicianName: service.technicianName,
    technicianEmail: service.technicianEmail,
    customerName,
    customerEmail,
    customerPhone: '+8801711111111',
    address: 'House 12, Block C, Mirpur, Dhaka',
    preferredDate: new Date(now + (offset + 1) * 86400000),
    problemDescription: `Please inspect and repair ${service.title.toLowerCase()} for our home. We need a careful diagnosis and final quote.`,
    status,
    finalAmount: service.basePrice,
    paymentStatus,
    statusHistory: [{ status: 'requested', changedAt: new Date(now - 86400000 * 2) }],
    createdAt: new Date(now - offset * 3600000),
});

const bookingRows = [
    makeBooking(service1, 'Emran Hasan', 'emran@fixmate.dev', 'requested', 'unpaid', 1),
    makeBooking(service2, 'Emran Hasan', 'emran@fixmate.dev', 'accepted', 'unpaid', 2),
    makeBooking(service3, 'Emran Hasan', 'emran@fixmate.dev', 'in-progress', 'unpaid', 3),
    makeBooking(service4, 'Emran Hasan', 'emran@fixmate.dev', 'completed', 'unpaid', 4),
    makeBooking(service1, 'Emran Hasan', 'emran@fixmate.dev', 'completed', 'paid', 5),
];
for (const booking of bookingRows) {
    if (booking.status !== 'requested') booking.statusHistory.push({ status: 'accepted', changedAt: new Date(now - 86400000) });
    if (['in-progress', 'completed'].includes(booking.status)) booking.statusHistory.push({ status: 'in-progress', changedAt: new Date(now - 43200000) });
    if (booking.status === 'completed') booking.statusHistory.push({ status: 'completed', changedAt: new Date(now - 7200000) });
    if (booking.paymentStatus === 'paid') booking.statusHistory.push({ status: 'paid', changedAt: new Date(now - 3600000) });
}
const bookingDocuments = bookingRows.map((booking) => {
    if (['requested', 'accepted', 'in-progress'].includes(booking.status)) {
        return {
            ...booking,
            activeKey: `${booking.customerEmail}|${booking.serviceId}`,
        };
    }
    const { activeKey, ...completedBooking } = booking;
    return completedBooking;
});
const bookingResult = await bookings.insertMany(bookingDocuments);

const paidId = bookingResult.insertedIds[4];
await payments.insertOne({
    bookingId: String(paidId),
    serviceTitle: service1.title,
    customerName: 'Emran Hasan',
    customerEmail: 'emran@fixmate.dev',
    technicianName: service1.technicianName,
    technicianEmail: service1.technicianEmail,
    amount: service1.basePrice,
    currency: 'usd',
    transactionId: `pi_seed_${new ObjectId().toHexString()}`,
    stripeSessionId: `cs_seed_${new ObjectId().toHexString()}`,
    paymentStatus: 'paid',
    paidAt: new Date(now - 3600000),
});

await mongo.close();
console.log(`FixMate seed complete: ${accounts.length} accounts, ${serviceRows.length} services, ${bookingRows.length} bookings.`);
