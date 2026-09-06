// parse-netstat.mjs — Extract PID from `netstat -ano` output for a given port.
//
// Extracted from plugins/model-ui/server.mjs getPortPid() for testability
// (reviewer MAJOR-2, 2026-09-05).

/**
 * Parse netstat -ano output and return the PID of the process listening on
 * the given port. Returns null if no listener is found.
 *
 * @param {string} netstatOutput — raw stdout from `netstat -ano`
 * @param {number} port — TCP port to look up
 * @returns {number|null}
 */
export function parsePortPid(netstatOutput, port) {
  const re = new RegExp(`[:\\s]${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)$`, 'm');
  const m = netstatOutput.match(re);
  return m ? parseInt(m[1], 10) : null;
}
