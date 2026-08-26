const { isSessionToolRunning } = require('./scripts/lib/agent-watchdog-helpers.mjs');

const result = isSessionToolRunning('ses_fe89aaad0ffeYAaimbyUJqoOVQ');
console.log('isSessionToolRunning result:', JSON.stringify(result, null, 2));