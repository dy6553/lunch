import { readFile } from 'node:fs/promises';
import { sign } from 'node:crypto';

const [command = 'seed', credentialPath = '.secrets/firebase-service-account.json', email] = process.argv.slice(2);
const credential = JSON.parse(await readFile(credentialPath, 'utf8'));

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({
    iss: credential.client_email,
    sub: credential.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    iat: now,
    exp: now + 3600,
  }))}`;
  const assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), credential.private_key).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error(`OAuth failed: ${response.status} ${await response.text()}`);
  return (await response.json()).access_token;
}

async function request(url, options = {}) {
  const token = await accessToken();
  const response = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...options.headers },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function seed() {
  const base = `https://firestore.googleapis.com/v1/projects/${credential.project_id}/databases/(default)/documents`;
  const now = new Date().toISOString();
  await Promise.all([
    request(`${base}/cafeterias/main`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: {
        waitingCount: { integerValue: '0' },
        serviceRatePerMinute: { integerValue: '30' },
        serviceStartsAt: { stringValue: '12:00' },
        serviceEndsAt: { stringValue: '13:20' },
        status: { stringValue: 'OPEN' },
        autoDecreaseEnabled: { booleanValue: true },
        updatedAt: { timestampValue: now },
        lastSensorAt: { timestampValue: now },
      } }),
    }),
    request(`${base}/gateStates/main`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: {
        pendingSensor: { stringValue: '' },
        pendingAt: { integerValue: '0' },
        lastEventAt: { timestampValue: now },
      } }),
    }),
  ]);
  console.log('Seeded cafeterias/main and gateStates/main.');
}

async function grantAdmin() {
  if (!email) throw new Error('Usage: node scripts/firebase-setup.mjs grant-admin <credential> <email>');
  const root = `https://identitytoolkit.googleapis.com/v1/projects/${credential.project_id}`;
  const result = await request(`${root}/accounts:batchGet?maxResults=1000`);
  const user = (result.users ?? []).find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
  if (!user) throw new Error(`Firebase user not found: ${email}. Sign in to /admin once, then retry.`);
  await request(`${root}/accounts:update`, {
    method: 'POST',
    body: JSON.stringify({ localId: user.localId, customAttributes: JSON.stringify({ admin: true }) }),
  });
  console.log(`Granted admin claim to ${email}.`);
}

async function verifyAdmins() {
  const root = `https://identitytoolkit.googleapis.com/v1/projects/${credential.project_id}`;
  const result = await request(`${root}/accounts:batchGet?maxResults=1000`);
  const admins = (result.users ?? [])
    .filter((user) => {
      try { return JSON.parse(user.customAttributes ?? '{}').admin === true; }
      catch { return false; }
    })
    .map((user) => user.email ?? user.localId);
  console.log(`Administrators (${admins.length}): ${admins.join(', ') || 'none'}`);
}

if (command === 'seed') await seed();
else if (command === 'grant-admin') await grantAdmin();
else if (command === 'verify-admins') await verifyAdmins();
else throw new Error(`Unknown command: ${command}`);
