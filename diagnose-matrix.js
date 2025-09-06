#!/usr/bin/env node
/**
 * Matrix Service Diagnostic Tool
 * 
 * This script helps debug Matrix service initialization issues.
 * Run with: node diagnose-matrix.js
 */

import { validateMatrixConfig } from './dist/environment.js';

console.log('🔍 Matrix Service Diagnostic Tool');
console.log('==================================\n');

// Check environment variables
const envVars = {
  MATRIX_HOMESERVER_URL: process.env.MATRIX_HOMESERVER_URL,
  MATRIX_ACCESS_TOKEN: process.env.MATRIX_ACCESS_TOKEN,
  MATRIX_USER_ID: process.env.MATRIX_USER_ID,
  MATRIX_ROOM_IDS: process.env.MATRIX_ROOM_IDS,
  MATRIX_ENCRYPTION_ENABLED: process.env.MATRIX_ENCRYPTION_ENABLED,
};

console.log('1. Environment Variables Check:');
console.log('------------------------------');

for (const [key, value] of Object.entries(envVars)) {
  if (value) {
    if (key === 'MATRIX_ACCESS_TOKEN') {
      console.log(`✅ ${key}: [PRESENT, length=${value.length}]`);
    } else {
      console.log(`✅ ${key}: ${value}`);
    }
  } else {
    if (key === 'MATRIX_ROOM_IDS' || key === 'MATRIX_ENCRYPTION_ENABLED') {
      console.log(`ℹ️  ${key}: [OPTIONAL, not set]`);
    } else {
      console.log(`❌ ${key}: [REQUIRED, not set]`);
    }
  }
}

console.log('\n2. Configuration Validation:');
console.log('----------------------------');

try {
  const config = validateMatrixConfig(envVars);
  console.log('✅ Configuration validation passed');
  
  // Additional checks
  if (config.MATRIX_USER_ID && !config.MATRIX_USER_ID.match(/^@.+:.+$/)) {
    console.log('⚠️  MATRIX_USER_ID format may be incorrect (should be @username:homeserver.tld)');
  }
  
  if (config.MATRIX_HOMESERVER_URL && !config.MATRIX_HOMESERVER_URL.startsWith('http')) {
    console.log('⚠️  MATRIX_HOMESERVER_URL should start with http:// or https://');
  }
  
} catch (error) {
  console.log('❌ Configuration validation failed:');
  console.log(`   ${error.message}`);
}

console.log('\n3. Common Issues & Solutions:');
console.log('----------------------------');
console.log('❌ "Matrix actions unavailable" usually means:');
console.log('   1. Missing required environment variables');
console.log('   2. Invalid MATRIX_ACCESS_TOKEN');
console.log('   3. Network connectivity issues');
console.log('   4. Invalid MATRIX_HOMESERVER_URL');
console.log('   5. Authentication problems');

console.log('\n💡 To fix:');
console.log('   1. Ensure all required env vars are set in your .env file');
console.log('   2. Verify your access token is valid and not expired');
console.log('   3. Test connectivity to your homeserver');
console.log('   4. Check the application logs for specific error messages');

if (!envVars.MATRIX_ACCESS_TOKEN) {
  console.log('\n🔑 To get a Matrix access token:');
  console.log('   1. Log into your Matrix account in a web client');
  console.log('   2. Go to Settings -> Help & About');
  console.log('   3. Scroll to "Advanced" section');
  console.log('   4. Copy the "Access Token"');
  console.log('   5. Add it to your .env file as MATRIX_ACCESS_TOKEN=your_token_here');
}

console.log('\n📋 Example .env configuration:');
console.log('MATRIX_HOMESERVER_URL=https://matrix.org');
console.log('MATRIX_ACCESS_TOKEN=syt_your_long_access_token_here');
console.log('MATRIX_USER_ID=@yourusername:matrix.org');
console.log('MATRIX_ROOM_IDS=!room1:matrix.org,!room2:matrix.org  # Optional');
console.log('MATRIX_ENCRYPTION_ENABLED=false  # Optional');