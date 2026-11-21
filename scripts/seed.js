import 'dotenv/config';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required');

const client = new MongoClient(uri);
await client.connect();

const db = client.db(process.env.DB_NAME || 'fixmate');
const users = db.collection('user');
const services = db.collection('services');
const bookings = db.collection('bookings');
const payments = db.collection('payments');

await users.createIndex({ email: 1 }, { unique: true });
await bookings.createIndex({ activeKey: 1 }, { unique: true, sparse: true });
await payments.createIndex({ stripeSessionId: 1 }, { unique: true });
await payments.createIndex({ bookingId: 1 }, { unique: true });

const demoUsers = [
  { name: 'Semanto Bolbol', email: 'admin@fixmate.dev', role: 'admin', phone: '+8801700000001', area: 'Rajshahi, Rajshahi', bio: 'FixMate platform administrator.', image: '' },
  { name: 'Rafiq Hasan', email: 'rafiq@fixmate.dev', role: 'technician', phone: '+8801711223344', area: 'Mirpur, Dhaka', bio: 'Mobile and laptop repair specialist.', image: '' },
  { name: 'Nusrat Jahan', email: 'nusrat@fixmate.dev', role: 'technician', phone: '+8801722556677', area: 'Dhanmondi, Dhaka', bio: 'AC and refrigeration technician.', image: '' },
  { name: 'Imran Khan', email: 'imran@fixmate.dev', role: 'technician', phone: '+8801733889900', area: 'Uttara, Dhaka', bio: 'TV, washing machine and electrical specialist.', image: '' },
  { name: 'Ayesha Rahman', email: 'ayesha@fixmate.dev', role: 'customer', phone: '+8801811100200', area: 'Banani, Dhaka', bio: '', image: '' },
];

for (const user of demoUsers) {
  await users.updateOne({ email: user.email }, { $set: { ...user, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
}

const catalog = [
  ['iPhone Screen Replacement', 'Smartphone', 'Genuine-grade OLED screen replacement with touch and Face ID checks.', '/services/s01.jpg', 85, 'Mirpur, Dhaka', 'rafiq@fixmate.dev', 'Rafiq Hasan'],
  ['Android Battery & Charging Port Fix', 'Smartphone', 'Battery and charging port diagnosis and replacement.', '/services/s02.jpg', 35, 'Mirpur, Dhaka', 'rafiq@fixmate.dev', 'Rafiq Hasan'],
  ['Laptop Deep Cleaning & Thermal Paste', 'Laptop & PC', 'Internal cleaning, fan service and thermal paste replacement.', '/services/s03.jpg', 40, 'Mirpur, Dhaka', 'rafiq@fixmate.dev', 'Rafiq Hasan'],
  ['Laptop SSD Upgrade & Windows Setup', 'Laptop & PC', 'SSD replacement, data migration and Windows setup.', '/services/s04.jpg', 55, 'Mirpur, Dhaka', 'rafiq@fixmate.dev', 'Rafiq Hasan'],
  ['Split AC Servicing & Gas Check', 'AC', 'Filter, coil and drain cleaning with refrigerant pressure check.', '/services/s05.jpg', 30, 'Dhanmondi, Dhaka', 'nusrat@fixmate.dev', 'Nusrat Jahan'],
  ['AC Compressor & PCB Repair', 'AC', 'Compressor, capacitor and inverter control board repair.', '/services/s06.jpg', 95, 'Dhanmondi, Dhaka', 'nusrat@fixmate.dev', 'Nusrat Jahan'],
  ['Refrigerator Not Cooling Repair', 'Refrigerator', 'Thermostat, fan, heater and gas leak diagnosis.', '/services/s07.jpg', 50, 'Dhanmondi, Dhaka', 'nusrat@fixmate.dev', 'Nusrat Jahan'],
  ['Fridge Door Seal & Compressor Relay', 'Refrigerator', 'Door gasket and start relay replacement.', '/services/s08.jpg', 28, 'Dhanmondi, Dhaka', 'nusrat@fixmate.dev', 'Nusrat Jahan'],
  ['LED/LCD TV Backlight Repair', 'TV', 'Backlight strip and power board diagnosis and repair.', '/services/s09.jpg', 60, 'Uttara, Dhaka', 'imran@fixmate.dev', 'Imran Khan'],
  ['Smart TV Software & Wi-Fi Repair', 'TV', 'Firmware, boot loop and Wi-Fi repair.', '/services/s10.jpg', 25, 'Uttara, Dhaka', 'imran@fixmate.dev', 'Imran Khan'],
  ['Washing Machine Drain & Spin Repair', 'Washing Machine', 'Drain pump, belt and bearing diagnosis and repair.', '/services/s11.webp', 45, 'Uttara, Dhaka', 'imran@fixmate.dev', 'Imran Khan'],
  ['Washer Motor & Control Board Fix', 'Washing Machine', 'Motor and automatic control board repair.', '/services/s12.jpg', 70, 'Uttara, Dhaka', 'imran@fixmate.dev', 'Imran Khan'],
  ['Home Electrical Fault Finding', 'Electrical', 'Breakers, lights and socket fault diagnosis.', '/services/s13.jpg', 22, 'Uttara, Dhaka', 'imran@fixmate.dev', 'Imran Khan'],
];

for (const [title, category, description, image, basePrice, serviceArea, technicianEmail, technicianName] of catalog) {
  await services.updateOne(
    { title, technicianEmail },
    {
      $set: {
        title, category, description, image, basePrice, estimatedDuration: '2-4 hours',
        serviceMode: 'Home Visit', serviceArea, technicianEmail, technicianName,
        approvalStatus: 'approved', isAvailable: true, updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}

console.log(`Seeded ${demoUsers.length} users and ${catalog.length} approved services`);
await client.close();
