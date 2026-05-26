/**
 * Quick test to verify the proxy is working.
 * Usage: node plugins/test-proxy.mjs
 */

const res = await fetch('http://localhost:4101/assets/index-OWaaLVms.js');
console.log('Status:', res.status);
console.log('OK:', res.ok);
const text = await res.text();
console.log('Length:', text.length);
console.log('First 100 chars:', text.substring(0, 100));
