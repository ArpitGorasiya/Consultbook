import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';
import { Service } from '../models/service.model.js';
import { WorkingHours } from '../models/working-hours.model.js';

async function seed(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  const users = [
    {
      name: process.env.ADMIN_NAME ?? 'ConsultBook Admin',
      email: process.env.ADMIN_EMAIL ?? 'admin@consultbook.local',
      password: process.env.ADMIN_PASSWORD ?? 'Admin@12345',
      role: 'ADMIN',
    },
    {
      name: process.env.CUSTOMER_NAME ?? 'Sample Customer',
      email: process.env.CUSTOMER_EMAIL ?? 'customer@consultbook.local',
      password: process.env.CUSTOMER_PASSWORD ?? 'Customer@12345',
      role: 'CUSTOMER',
    },
  ] as const;
  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, 12);
    await User.updateOne(
      { email: user.email.toLowerCase() },
      {
        $setOnInsert: {
          name: user.name,
          email: user.email.toLowerCase(),
          passwordHash,
          role: user.role,
        },
      },
      { upsert: true },
    );
  }
  const services = [
    {
      name: 'Initial consultation',
      description: 'A focused first conversation to understand your goals.',
      durationMinutes: 30,
      price: 150000,
      isActive: true,
    },
    {
      name: 'Strategy session',
      description: 'A practical session to turn a challenge into a clear plan.',
      durationMinutes: 60,
      price: 300000,
      isActive: true,
    },
    {
      name: 'Follow-up session',
      description: 'Review progress and agree on useful next steps.',
      durationMinutes: 45,
      price: 200000,
      isActive: true,
    },
  ];
  for (const service of services)
    await Service.updateOne({ name: service.name }, { $setOnInsert: service }, { upsert: true });
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const working = weekday >= 1 && weekday <= 6;
    await WorkingHours.updateOne(
      { weekday },
      { $set: { weekday, opensAt: working ? '10:00' : null, closesAt: working ? '18:00' : null } },
      { upsert: true },
    );
  }
  await mongoose.disconnect();
}

seed().catch(async (error: unknown) => {
  console.error(error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
