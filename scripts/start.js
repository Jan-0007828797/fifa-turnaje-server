const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function hasMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
  if (!fs.existsSync(migrationsDir)) return false;
  const entries = fs.readdirSync(migrationsDir).filter((name) => !name.startsWith('.'));
  return entries.length > 0;
}

try {
  run('npx prisma generate');
  if (hasMigrations()) {
    run('npx prisma migrate deploy');
  } else {
    console.log('> No prisma/migrations found, using prisma db push');
    run('npx prisma db push --accept-data-loss');
  }
  run('node prisma/seed.js');
} catch (error) {
  console.error('Startup preparation failed:', error.message);
  process.exit(1);
}

require('../src/index');
