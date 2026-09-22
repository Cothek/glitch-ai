# Pi Missing Features Implementation Plan

> **Date:** September 19, 2026
> **Author:** @coder
> **Status:** Draft v1
> **Scope:** Implementation plan for three missing Pi features: Taste Learning, Sub-agents, Plan Mode
> **Depends on:** `pi-migration-plan.md`

---

## Executive Summary

Pi's minimal philosophy means some features we want aren't built-in. This plan details how to implement three key missing features as Pi extensions:

1. **Taste Learning System** — Learn from user interactions (accept/reject/edit)
2. **Sub-agents** — Parallel task execution and specialized agents
3. **Plan Mode** — Structured task decomposition before execution

All three can be implemented as Pi extensions using TypeScript. Pi's extension system provides access to tools, commands, events, and the full TUI.

---

## 1. Taste Learning System

### What Command Code Has

Command Code's Taste system:
- Learns from every accept, reject, edit automatically
- Uses `taste-1` meta neuro-symbolic model
- Organizes learnings into packages (cli, typescript, architecture)
- Can push/pull taste with team
- Global taste across all projects
- Project-specific taste
- Linting via `npx taste lint`

### What We Need to Build

A Pi extension that:
1. **Monitors user interactions** — tracks accepts, rejects, edits
2. **Captures patterns** — extracts coding preferences and style
3. **Stores learnings** — persists taste profile to disk
4. **Applies preferences** — injects learned patterns into context
5. **Supports multiple scopes** — global, project-specific

### Architecture

```
taste-extension/
├── src/
│   ├── index.ts              # Extension entry point
│   ├── tracker.ts            # Interaction tracker
│   ├── analyzer.ts           # Pattern analyzer
│   ├── storage.ts            # Taste profile persistence
│   ├── injector.ts           # Context injection
│   └── types.ts              # Type definitions
├── package.json
└── tsconfig.json
```

### Core Components

#### 1. Interaction Tracker (`tracker.ts`)

Monitors tool calls and user responses:

```typescript
// Track these events:
- Tool call execution (bash, write, edit)
- User approval (yes/no/edit)
- Code modifications (diffs)
- Error corrections
- Manual edits to AI-generated code
```

**Data collected:**
```typescript
interface Interaction {
  timestamp: Date;
  tool: string;
  action: 'approve' | 'reject' | 'edit' | 'manual';
  originalCode: string;
  finalCode: string;
  context: {
    file: string;
    language: string;
    project: string;
  };
}
```

#### 2. Pattern Analyzer (`analyze.ts`)

Extracts patterns from interactions:

```typescript
// Pattern types:
- Code style (naming, formatting, structure)
- Architecture patterns (module organization, separation)
- Error handling preferences
- Testing patterns
- Documentation style
- Tool usage patterns
- Language-specific preferences
```

**Analysis methods:**
- Frequency analysis — what patterns appear most often
- Correlation analysis — what patterns are accepted vs rejected
- Temporal analysis — how preferences evolve over time
- Context analysis — what patterns work in what situations

#### 3. Taste Storage (`storage.ts`)

Persists taste profiles:

```
~/.pi/taste/
├── global.md                    # Global taste profile
├── projects/
│   ├── project-name.md          # Project-specific taste
│   └── ...
└── packages/
    ├── coding-style.md          # Organized by category
    ├── architecture.md
    ├── error-handling.md
    └── testing.md
```

**Storage format:**
```markdown
---
type: TasteProfile
scope: global|project
lastUpdated: 2026-09-19T00:00:00Z
---

## Coding Style
- Prefer `const` over `let` when possible
- Use descriptive variable names
- Maximum function length: 50 lines

## Architecture
- Separate concerns into modules
- Use dependency injection
- Prefer composition over inheritance

## Error Handling
- Always use try/catch for async operations
- Log errors with context
- Provide meaningful error messages
```

#### 4. Context Injection (`injector.ts`)

Injects learned patterns into context:

```typescript
// Injection points:
- System prompt (global taste)
- AGENTS.md (project taste)
- Before code generation (relevant patterns)
- During code review (preference matching)
```

**Injection strategy:**
- Load relevant taste based on current context
- Inject as system context (survives compaction)
- Progressive disclosure (summary first, details on-demand)
- Cache to avoid re-reading files

### Integration Points

#### Tool Call Monitoring
```typescript
// Hook into Pi's tool execution:
pi.on('tool:execute', async (tool, args) => {
  // Track the tool call
  await tracker.record(tool, args);
});

pi.on('tool:result', async (tool, result) => {
  // Track the result
  await tracker.recordResult(tool, result);
});
```

#### User Feedback Detection
```typescript
// Detect user responses:
pi.on('user:message', async (message) => {
  // Parse for approval/rejection signals
  if (isApproval(message)) {
    await tracker.recordApproval();
  } else if (isRejection(message)) {
    await tracker.recordRejection();
  }
});
```

#### Context Injection
```typescript
// Inject taste before each turn:
pi.on('before:turn', async (context) => {
  const taste = await loadRelevantTaste(context);
  context.systemPrompt += `\n\n## Learned Preferences\n${taste}`;
});
```

### Implementation Steps

1. **Week 1: Core tracking** — Build interaction tracker, basic storage
2. **Week 2: Pattern analysis** — Build analyzer, extract patterns
3. **Week 3: Context injection** — Build injector, test integration
4. **Week 4: Polish** — Multi-project support, export/import, UI

### Effort Estimate

**Total: 3-4 weeks (part-time)**
- Core extension: 1 week
- Pattern analysis: 1 week
- Context injection: 1 week
- Testing and polish: 1 week

### Comparison with Command Code

| Feature | Command Code Taste | Our Pi Extension |
|---------|-------------------|------------------|
| Learning mechanism | Automatic (taste-1 model) | Manual pattern extraction |
| Storage | Built-in model | Markdown files |
| Package organization | Built-in | Manual organization |
| Push/pull | Built-in | Git-based sharing |
| Linting | `npx taste lint` | Custom validation |
| Quality | Neuro-symbolic AI | Frequency analysis |

**Trade-off**: Our extension is simpler but less sophisticated. Command Code's Taste uses a dedicated AI model; ours uses statistical analysis. For most use cases, statistical analysis is sufficient.

---

## 2. Sub-agents

### What Command Code Has

Command Code has built-in sub-agent dispatch:
- Specialized agents (@coder, @reviewer, @testing, etc.)
- Model routing (free-to-paid fallback)
- Task delegation with context
- Result aggregation

### What We Need to Build

A Pi extension that:
1. **Defines sub-agents** — specialized agent configurations
2. **Dispatches tasks** — sends tasks to appropriate sub-agents
3. **Manages context** — shares relevant context between agents
4. **Aggregates results** — combines outputs from multiple agents

### Architecture

```
subagent-extension/
├── src/
│   ├── index.ts              # Extension entry point
│   ├── dispatcher.ts         # Task dispatcher
│   ├── agents/
│   │   ├── coder.ts          # Coder agent
│   │   ├── reviewer.ts       # Reviewer agent
│   │   ├── tester.ts         # Testing agent
│   │   └── planner.ts        # Planner agent
│   ├── context.ts            # Context management
│   └── types.ts              # Type definitions
├── package.json
└── tsconfig.json
```

### Core Components

#### 1. Sub-agent Definitions (`agents/`)

Each sub-agent has:
```typescript
interface SubAgent {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;           // Which model to use
  tools: string[];         // Which tools are allowed
  maxTokens: number;       // Context limit
}
```

**Built-in sub-agents:**
```typescript
// Coder agent
{
  name: 'coder',
  description: 'Write and edit code',
  systemPrompt: 'You are a senior developer...',
  model: 'anthropic/claude-sonnet-4-20250514',
  tools: ['read', 'write', 'edit', 'bash'],
  maxTokens: 100000
}

// Reviewer agent
{
  name: 'reviewer',
  description: 'Review code for quality',
  systemPrompt: 'You are a code reviewer...',
  model: 'anthropic/claude-sonnet-4-20250514',
  tools: ['read', 'grep', 'find'],
  maxTokens: 50000
}

// Tester agent
{
  name: 'tester',
  description: 'Write and run tests',
  systemPrompt: 'You are a QA engineer...',
  model: 'anthropic/claude-sonnet-4-20250514',
  tools: ['read', 'write', 'bash'],
  maxTokens: 50000
}

// Planner agent
{
  name: 'planner',
  description: 'Plan complex tasks',
  systemPrompt: 'You are a project planner...',
  model: 'anthropic/claude-sonnet-4-20250514',
  tools: ['read', 'grep', 'find'],
  maxTokens: 30000
}
```

#### 2. Task Dispatcher (`dispatcher.ts`)

Routes tasks to appropriate sub-agents:
```typescript
interface Task {
  id: string;
  description: string;
  requiredCapabilities: string[];
  context: TaskContext;
  priority: 'low' | 'medium' | 'high';
}

class Dispatcher {
  async dispatch(task: Task): Promise<TaskResult> {
    // 1. Analyze task requirements
    const agent = this.selectAgent(task);
    
    // 2. Prepare context
    const context = await this.prepareContext(task);
    
    // 3. Spawn sub-agent
    const result = await this.spawnAgent(agent, task, context);
    
    // 4. Return result
    return result;
  }
  
  private selectAgent(task: Task): SubAgent {
    // Match task capabilities to agent skills
    // Fallback to coder if no specific match
  }
}
```

#### 3. Context Management (`context.ts`)

Shares context between agents:
```typescript
class ContextManager {
  // Prepare context for sub-agent
  async prepareContext(task: Task): Promise<AgentContext> {
    return {
      projectFiles: await this.getRelevantFiles(task),
      memory: await this.getRelevantMemory(task),
      conventions: await this.getConventions(),
      previousWork: await this.getPreviousWork(task)
    };
  }
  
  // Aggregate results from multiple agents
  async aggregateResults(results: TaskResult[]): Promise<AggregatedResult> {
    // Merge outputs, resolve conflicts, prioritize
  }
}
```

#### 4. Spawning Pi Instances

**Option A: Use Pi's SDK**
```typescript
import { Pi } from '@earendil-works/pi-coding-agent';

const pi = new Pi({
  model: agent.model,
  systemPrompt: agent.systemPrompt,
  tools: agent.tools
});

const result = await pi.run(task.description, context);
```

**Option B: Spawn Pi processes**
```typescript
import { spawn } from 'child_process';

// Spawn Pi in print mode
const process = spawn('pi', [
  '--mode', 'json',
  '--model', agent.model,
  '-p', task.description
]);

// Capture output
process.stdout.on('data', (data) => {
  // Parse JSON events
});
```

**Option C: Use tmux (for interactive sub-agents)**
```typescript
import { exec } from 'child_process';

// Create tmux session for sub-agent
exec(`tmux new-session -d -s ${agent.name} "pi --model ${agent.model}"`);

// Send task
exec(`tmux send-keys -t ${agent.name} "${task.description}" Enter`);
```

### Integration Points

#### Command Registration
```typescript
// Register /dispatch command
pi.command('dispatch', 'Dispatch task to sub-agent', async (args) => {
  const task = parseTask(args);
  const result = await dispatcher.dispatch(task);
  return result.output;
});
```

#### Automatic Dispatch
```typescript
// Auto-dispatch based on complexity
pi.on('before:turn', async (context) => {
  if (isComplexTask(context.message)) {
    // Dispatch to planner first
    const plan = await dispatcher.dispatch({
      description: context.message,
      requiredCapabilities: ['planning']
    });
    
    // Then dispatch subtasks
    for (const subtask of plan.subtasks) {
      await dispatcher.dispatch(subtask);
    }
  }
});
```

### Implementation Steps

1. **Week 1: Core framework** — Dispatcher, agent definitions, basic spawning
2. **Week 2: Context management** — File selection, memory sharing, conventions
3. **Week 3: Agent implementations** — Coder, reviewer, tester, planner
4. **Week 4: Integration** — Commands, automatic dispatch, result aggregation

### Effort Estimate

**Total: 3-4 weeks (part-time)**
- Core framework: 1 week
- Context management: 1 week
- Agent implementations: 1 week
- Integration and testing: 1 week

### Comparison with Command Code

| Feature | Command Code Sub-agents | Our Pi Extension |
|---------|------------------------|------------------|
| Agent count | 12+ specialized | 4 built-in (extensible) |
| Model routing | Free-to-paid fallback | Manual model selection |
| Agent creation | CLI commands | Extension code |
| Context sharing | Automatic | Manual preparation |
| Result aggregation | Built-in | Custom implementation |

**Trade-off**: Command Code has more built-in agents and automatic routing. Our extension is simpler but requires manual configuration. We can add more agents over time.

---

## 3. Plan Mode

### What Command Code Has

Command Code has built-in plan mode:
- Structured planning phase before execution
- Task decomposition
- Dependency tracking
- Approval workflow
- Plan storage and versioning

### What We Need to Build

A Pi extension that:
1. **Detects complex tasks** — identifies when planning is needed
2. **Decomposes tasks** — breaks down into subtasks
3. **Tracks dependencies** — identifies task relationships
4. **Manages approval** — user approves plan before execution
5. **Stores plans** — persists plans for reference

### Architecture

```
plan-mode-extension/
├── src/
│   ├── index.ts              # Extension entry point
│   ├── detector.ts           # Complexity detector
│   ├── decomposer.ts         # Task decomposer
│   ├── dependency.ts         # Dependency tracker
│   ├── approval.ts           # Approval workflow
│   ├── storage.ts            # Plan persistence
│   └── types.ts              # Type definitions
├── package.json
└── tsconfig.json
```

### Core Components

#### 1. Complexity Detector (`detector.ts`)

Identifies when planning is needed:
```typescript
interface ComplexityFactors {
  fileCount: number;           // Files involved
  functionCount: number;       // Functions to modify
  dependencyCount: number;     // External dependencies
  estimatedTime: number;       // Estimated minutes
  riskLevel: 'low' | 'medium' | 'high';
}

class Detector {
  async detect(task: string): Promise<ComplexityFactors> {
    // Analyze task description
    // Scan codebase for related files
    // Estimate complexity
    // Return factors
  }
  
  shouldPlan(factors: ComplexityFactors): boolean {
    // Plan if:
    // - More than 3 files involved
    // - More than 5 functions to modify
    // - High risk level
    // - Estimated time > 30 minutes
  }
}
```

#### 2. Task Decomposer (`decomposer.ts`)

Breaks down tasks into subtasks:
```typescript
interface Plan {
  id: string;
  goal: string;
  subtasks: Subtask[];
  estimatedTime: number;
  riskAssessment: string;
}

interface Subtask {
  id: string;
  description: string;
  dependencies: string[];
  estimatedTime: number;
  files: string[];
  verification: string;
}

class Decomposer {
  async decompose(task: string, context: TaskContext): Promise<Plan> {
    // 1. Analyze task requirements
    // 2. Identify files involved
    // 3. Break into logical subtasks
    // 4. Identify dependencies
    // 5. Estimate time for each
    // 6. Add verification criteria
    // 7. Return plan
  }
}
```

#### 3. Dependency Tracker (`dependency.ts`)

Manages task relationships:
```typescript
class DependencyTracker {
  // Build dependency graph
  buildGraph(subtasks: Subtask[]): DependencyGraph {
    // Identify which tasks depend on which
    // Detect circular dependencies
    // Optimize execution order
  }
  
  // Get execution order (topological sort)
  getExecutionOrder(graph: DependencyGraph): Subtask[] {
    // Return tasks in dependency order
    // Parallelize independent tasks
  }
  
  // Check if task can start
  canStart(task: Subtask, completed: Set<string>): boolean {
    // All dependencies satisfied?
  }
}
```

#### 4. Approval Workflow (`approval.ts`)

Manages plan approval:
```typescript
class ApprovalWorkflow {
  async presentPlan(plan: Plan): Promise<boolean> {
    // 1. Format plan for display
    // 2. Show to user
    // 3. Wait for approval/rejection
    // 4. Return decision
  }
  
  async presentSubtask(subtask: Subtask): Promise<boolean> {
    // Approve individual subtask
    // Allow modifications
  }
  
  formatPlan(plan: Plan): string {
    // Create readable plan display
    return `
## Plan: ${plan.goal}

### Subtasks:
${plan.subtasks.map((t, i) => `
${i + 1}. ${t.description}
   - Dependencies: ${t.dependencies.join(', ') || 'None'}
   - Estimated time: ${t.estimatedTime} minutes
   - Files: ${t.files.join(', ')}
   - Verification: ${t.verification}
`).join('\n')}

### Total estimated time: ${plan.estimatedTime} minutes
### Risk assessment: ${plan.riskAssessment}
    `;
  }
}
```

#### 5. Plan Storage (`storage.ts`)

Persists plans:
```
~/.pi/plans/
├── active/
│   └── plan-2026-09-19.json    # Current plan
├── completed/
│   ├── plan-2026-09-18.json    # Completed plans
│   └── ...
└── templates/
    ├── feature.md              # Plan templates
    ├── refactor.md
    └── bugfix.md
```

**Plan format:**
```json
{
  "id": "plan-2026-09-19",
  "goal": "Add user authentication",
  "createdAt": "2026-09-19T00:00:00Z",
  "status": "in-progress",
  "subtasks": [
    {
      "id": "subtask-1",
      "description": "Create auth middleware",
      "status": "completed",
      "dependencies": [],
      "files": ["src/middleware/auth.ts"],
      "verification": "Tests pass"
    }
  ],
  "progress": {
    "completed": 1,
    "total": 5,
    "percent": 20
  }
}
```

### Integration Points

#### Automatic Detection
```typescript
// Auto-detect complex tasks
pi.on('before:turn', async (context) => {
  const complexity = await detector.detect(context.message);
  
  if (detector.shouldPlan(complexity)) {
    // Decompose task
    const plan = await decomposer.decompose(context.message, context);
    
    // Present for approval
    const approved = await approval.presentPlan(plan);
    
    if (approved) {
      // Store plan
      await storage.save(plan);
      
      // Execute plan
      await executePlan(plan);
    } else {
      // User rejected plan
      return 'Plan rejected. What would you like to do instead?';
    }
  }
});
```

#### Plan Commands
```typescript
// /plan command
pi.command('plan', 'Create a plan for a task', async (args) => {
  const plan = await decomposer.decompose(args, context);
  await approval.presentPlan(plan);
  return `Plan created: ${plan.id}`;
});

// /status command
pi.command('status', 'Show current plan status', async () => {
  const plan = await storage.getActive();
  if (plan) {
    return formatPlanStatus(plan);
  }
  return 'No active plan.';
});

// /approve command
pi.command('approve', 'Approve current plan', async () => {
  const plan = await storage.getActive();
  if (plan) {
    await executePlan(plan);
    return 'Plan approved and executing.';
  }
  return 'No active plan.';
});
```

### Implementation Steps

1. **Week 1: Core detection** — Complexity detector, basic planning
2. **Week 2: Decomposition** — Task decomposer, dependency tracking
3. **Week 3: Workflow** — Approval workflow, plan storage
4. **Week 4: Integration** — Commands, automatic detection, execution

### Effort Estimate

**Total: 3-4 weeks (part-time)**
- Core detection: 1 week
- Decomposition: 1 week
- Workflow: 1 week
- Integration: 1 week

### Comparison with Command Code

| Feature | Command Code Plan Mode | Our Pi Extension |
|---------|----------------------|------------------|
| Complexity detection | Built-in | Custom detector |
| Task decomposition | Built-in | Custom decomposer |
| Dependency tracking | Built-in | Custom tracker |
| Approval workflow | Built-in | Custom workflow |
| Plan storage | Session state | JSON files |
| Plan templates | Not specified | Custom templates |

**Trade-off**: Command Code has a more polished plan mode. Our extension is more flexible and customizable. We can iterate faster since we control the code.

---

## 4. Implementation Priority

### Recommended Order

1. **Plan Mode** (Week 1-4)
   - Most immediate value
   - Reduces wasted iteration
   - Builds foundation for other features

2. **Sub-agents** (Week 5-8)
   - Enables parallel execution
   - Builds on plan mode (dispatch subtasks)
   - Increases productivity

3. **Taste Learning** (Week 9-12)
   - Long-term value
   - Builds on sub-agents (track agent performance)
   - Continuous improvement

### Total Timeline

**12 weeks (3 months) part-time**
- Plan Mode: 4 weeks
- Sub-agents: 4 weeks
- Taste Learning: 4 weeks

### Resource Requirements

- **Developer time**: 10-15 hours/week
- **Testing time**: 5 hours/week
- **Documentation**: 2-3 hours/week

---

## 5. Integration Strategy

### Phase 1: Standalone Extensions (Weeks 1-4)

Build each extension independently:
- Plan Mode extension
- Sub-agent extension
- Taste Learning extension

Each can be installed and used separately.

### Phase 2: Integration (Weeks 5-8)

Connect extensions:
- Plan Mode dispatches subtasks to Sub-agents
- Sub-agents report back to Plan Mode
- Taste Learning tracks agent performance

### Phase 3: Optimization (Weeks 9-12)

Refine and optimize:
- Tune complexity detection
- Improve context sharing
- Enhance pattern analysis

---

## 6. Testing Strategy

### Unit Tests

Each component gets unit tests:
- Detector tests (complexity detection)
- Decomposer tests (task breakdown)
- Dispatcher tests (task routing)
- Tracker tests (interaction recording)
- Analyzer tests (pattern extraction)

### Integration Tests

Test extension integration:
- Plan Mode → Sub-agent dispatch
- Sub-agent → Taste Learning tracking
- Taste Learning → Context injection

### End-to-End Tests

Test complete workflows:
- Complex task → Plan → Approval → Execution → Review
- Multi-agent task → Parallel execution → Result aggregation
- Learning cycle → Pattern capture → Preference application

---

## 7. Documentation

### User Documentation

- **Plan Mode Guide** — How to use plan mode
- **Sub-agent Guide** — How to dispatch tasks
- **Taste Learning Guide** — How learning works
- **Configuration Reference** — All settings

### Developer Documentation

- **Extension Architecture** — How extensions work
- **API Reference** — Extension APIs
- **Contributing Guide** — How to add features

---

## 8. Success Metrics

### Plan Mode

- **Reduction in wasted iteration** — 30% fewer rejected attempts
- **Improved task completion** — 20% faster complex tasks
- **User satisfaction** — 4/5 rating on planning experience

### Sub-agents

- **Parallel execution** — 2x throughput on multi-file tasks
- **Specialization** — Better code quality from specialized agents
- **Context sharing** — Seamless collaboration between agents

### Taste Learning

- **Preference accuracy** — 80% of suggestions match user preferences
- **Learning speed** — Capture preferences within 5 interactions
- **Cross-project consistency** — Same preferences across projects

---

## 9. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Extension complexity | Medium | High | Start simple, iterate. Use Pi's examples. |
| Performance overhead | Low | Medium | Profile extensions, optimize hot paths |
| Context pollution | Medium | Medium | Careful context management, progressive disclosure |
| Learning accuracy | Medium | Low | Manual tuning, user feedback loop |
| Integration issues | Low | High | Comprehensive testing, gradual rollout |

---

## 10. Conclusion

Pi's minimal philosophy means we need to build these features ourselves. The good news:

1. **Pi's extension system is powerful** — we can build anything we need
2. **Examples exist** — sub-agent and plan-mode examples are available
3. **Open source** — we can customize and improve as needed
4. **Modular** — each extension is independent, can be built incrementally

**The trade-off is clear:**
- **Command Code**: Built-in features, less customization
- **Pi**: Build your own features, full control

For teams that want control and customization, Pi is the better choice. For teams that want features out-of-the-box, Command Code is better.

**Our recommendation:** Build these extensions for Pi. The investment pays off in:
- Full control over the codebase
- Customization to our exact needs
- No vendor lock-in
- Contribution back to the community

---

## 11. Reference to Pi Migration Plan

This plan is referenced in `pi-migration-plan.md` as the implementation strategy for Pi's three missing features:

- **Taste Learning** → Section 4.7 in Pi migration plan
- **Sub-agents** → Section 4.5 in Pi migration plan
- **Plan Mode** → Section 4.6 in Pi migration plan

The implementation order (Plan Mode → Sub-agents → Taste Learning) aligns with the migration phases:
- **Phase 2**: Plan Mode (during memory system setup)
- **Phase 3**: Sub-agents (during web/remote layer)
- **Phase 4**: Taste Learning (during mulahazah/watchdog adaptation)

---

*This plan is based on Pi's extension system and examples. Update as implementation progresses.*

*Next action: Start with Plan Mode extension (Week 1).*
