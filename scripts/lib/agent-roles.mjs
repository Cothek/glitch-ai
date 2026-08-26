const AGENT_ROLE_MAP = {
  'scout': 'scout',
  'validator': 'validator',
  'builder': 'builder',
  'distributor': 'distributor',
  'ops': 'ops',
  'coder': 'builder',
  'coder-paid': 'builder',
  'ui-designer': 'builder',
  'ui-designer-paid': 'builder',
  'reviewer': 'validator',
  'reviewer-paid': 'validator',
  'testing': 'validator',
  'testing-paid': 'validator',
  'general': 'ops',
  'general-paid': 'ops',
  'explore': 'scout',
  'explore-paid': 'scout',
  'vision': 'scout',
  'vision-paid': 'scout',
  'pentester': 'validator',
  'pentester-paid': 'validator',
  'memory': 'ops',
  'memory-paid': 'ops',
  'glitch-omni': 'ops'
};

const ROLE_PATTERNS = [
  { re: /scout/i, role: 'scout' },
  { re: /validat|review|check/i, role: 'validator' },
  { re: /build|implement|coder|feat|commit/i, role: 'builder' },
  { re: /distribut|deploy|publish/i, role: 'distributor' },
  { re: /monitor|ops|memory|record/i, role: 'ops' }
];

function resolveRoleFromAgent(agentName, title) {
  if (AGENT_ROLE_MAP[agentName]) return AGENT_ROLE_MAP[agentName];
  if (title) {
    for (const { re, role } of ROLE_PATTERNS) {
      if (re.test(title)) return role;
    }
  }
  return 'agent';
}

export { AGENT_ROLE_MAP, ROLE_PATTERNS, resolveRoleFromAgent };
