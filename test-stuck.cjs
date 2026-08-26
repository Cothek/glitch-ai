// Test the stuck detector
const Plugin = require("E:\\Glitch AI\\glitch-ai\\.opencode\\plugins\\stuck-detector.mjs");
const stuck = Plugin.detectStuck || Plugin.StuckDetectorPlugin?.detectStuck;

// Simulate 2 consecutive invalid tool calls
const history = [
  { tool: "invalid", args: {}, error: true },
  { tool: "invalid", args: {}, error: true }
];

// Also test with task tool + error
const history2 = [
  { tool: "task", args: {}, error: true },
  { tool: "task", args: {}, error: true }
];

if (stuck) {
  const result = stuck(history);
  console.log('2 invalid calls result:', JSON.stringify(result, null, 2));
  
  const result2 = stuck(history2);
  console.log('2 task+error calls result:', JSON.stringify(result2, null, 2));
} else {
  console.log('No detectStuck function found');
  console.log('Exports:', Object.keys(Plugin));
}