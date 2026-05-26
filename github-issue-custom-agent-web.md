# Bug Report: Custom primary agents fail silently in web UI

## Description
Custom primary agents defined in opencode.json (or .opencode/agents/*.md) appear in the web UI dropdown but cannot process chat messages. Submitting a message produces an error sound with no visible error or console output. Built-in agents (build, plan) work normally.

Tested and confirmed on v1.15.7 through v1.15.10. Even a minimal custom agent with no prompt, no model, and no permissions fails the same way.

## OpenCode version
v1.15.10 (also reproduced on v1.15.7, v1.15.8, v1.15.9)

## Operating System
Windows 11

## Terminal
Windows Terminal (for CLI tests). Issue is in the web UI (opencode web).

## Steps to reproduce
1. Create an opencode.json with a custom primary agent:
   {
     "agent": {
       "my-agent": {
         "mode": "primary",
         "description": "Test custom agent"
       }
     }
   }
2. Run opencode web and open the browser
3. Select the custom agent from the dropdown
4. Type a message and submit
5. Expected: agent processes the message and responds
6. Actual: error sound plays, no response, no console errors

## Additional bugs found during investigation
- GET /agent?workspace=X crashes with a 500 error
- GET /agent?directory=X filters response to only native:true (built-in) agents, excluding all custom agents
- The SPA calls GET /agent?directory=<path>&workspace=<id>, triggering both issues
- A workaround for the /agent endpoint issues is to strip directory and workspace params at the proxy layer

## Notes
- The affected API endpoint (/agent) correctly returns the custom agent with mode:"primary" and native:false
- The client-side filter (mode !== "subagent" && !hidden) correctly includes the agent in the dropdown
- The failure happens server-side during session creation
- Overriding the built-in plan agent with a custom prompt also fails (the built-in prompt is used regardless)
- Custom primary agents work correctly in CLI/TUI mode
