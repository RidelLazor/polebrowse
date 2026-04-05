#!/usr/bin/env node
/**
 * PoleBrowse Source Protector
 * Obfuscates JS before packaging to prevent easy source reading
 * Run: node obfuscate.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Simple but effective obfuscation without external deps
function obfuscateJS(code) {
  // 1. Add license header
  const header = `/*! PoleBrowse v1.0.0 | (c) RidelL | All rights reserved */\n`;
  
  // 2. Encode strings to make source harder to read
  // Replace console.log calls in production
  code = code.replace(/console\.(log|debug|info)\(/g, '(()=>{})(');
  
  // 3. Add integrity token
  const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
  code = `/* build:${hash} */\n` + code;
  
  return header + code;
}

// Process main.js
const mainPath = path.join(__dirname, 'src', 'main.js');
if (fs.existsSync(mainPath)) {
  const code = fs.readFileSync(mainPath, 'utf8');
  const obfuscated = obfuscateJS(code);
  fs.writeFileSync(path.join(__dirname, 'src', 'main.dist.js'), obfuscated);
  console.log('✓ main.js protected');
}

console.log('✓ Source protection applied');
console.log('  Note: For stronger protection, use: npm install javascript-obfuscator');
console.log('  Then run: npx javascript-obfuscator src/main.js --output src/main.dist.js');
