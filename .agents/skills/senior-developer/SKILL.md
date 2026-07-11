---
name: senior-developer
description: "MUST use when building new features, implementing complex workflows,
              creating server actions, designing data layers, structuring Next.js projects,
              or when the task involves full-stack implementation patterns.
              Use alongside ui-design skill when feature has both backend and frontend."
---

# Senior Developer — Full-Stack Implementation Patterns

## Activation
When this skill activates, output:
"Senior dev patterns engaged..."

## Core Principles

1. **Read before write** — Understand existing code, conventions, and architecture before adding anything
2. **Follow existing patterns** — Match the codebase's style, imports, component choices, state management approach
3. **Progressive enhancement** — Ship the simplest working version first, then layer on polish
4. **Separation of concerns** — Server actions, UI components, data access, and email templates each have their own files
5. **TypeScript everywhere** — Proper types for all props, states, and server action returns

## Implementation Protocol

### Phase 1: Reconnaissance
1. Read the file(s) you'll be modifying in full
2. Check sibling files for conventions (import style, component patterns)
3. Verify all imports/components you need already exist in the project
4. Check `.env` for relevant API keys and config
5. Understand the data model (Firestore collections, types, relationships)

### Phase 2: Data Layer First
1. Create server actions in `src/lib/<feature>.ts` with `'use server'`
2. Define TypeScript types/interfaces for all entities
3. Handle every DB operation: create, read, update, delete
4. Add proper error handling with try/catch and meaningful error messages
5. Return typed responses — never `any`

### Phase 3: UI Layer
1. Build the most critical user-facing page first
2. Follow existing layout patterns (Card, CardHeader, CardContent, CardFooter)
3. Use existing shadcn/ui components — don't reinvent
4. Handle all states: loading, empty, error, success, edge cases
5. Mobile-first responsive design
6. Match existing import style and class ordering

### Phase 4: Integration
1. Wire up server actions to UI
2. Use optimistic updates for better UX (match existing patterns)
3. Show toast notifications for success/error feedback
4. Add loading states during async operations

## Next.js Patterns

### Server Action Pattern
```typescript
'use server';

export async function doSomething(input: string): Promise<{ success: true; data: Result } | { success: false; error: string }> {
  try {
    // validate, operate, return
    return { success: true, data: result };
  } catch (e: any) {
    console.error('[Feature] Error:', e.message);
    return { success: false, error: e.message };
  }
}
```

### Client Component Pattern
```typescript
'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

export function MyComponent() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleAction = async () => {
    setIsLoading(true);
    try {
      const result = await serverAction();
      toast({ title: 'Done', description: 'Action succeeded.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };
}
```

### Optimistic Update Pattern
```typescript
const newItem = { id: Math.random().toString(), ...formData };
setItems(prev => [...prev, newItem]);
try {
  await serverAction(formData);
} catch (e: any) {
  setItems(prev => prev.filter(i => i.id !== newItem.id));
  toast({ variant: 'destructive', title: 'Failed', description: e.message });
}
```

## Mandatory Rules
1. **Never import from unused barrel files** — import directly from the specific module path
2. **Every server action gets try/catch** — unhandled rejections crash Next.js
3. **Every form validates client-side before sending** — don't rely solely on server validation
4. **No `any` types in function signatures** — use proper generics or `unknown`
5. **All strings visible to users go through `toast()`** — never `alert()` or `console.log` for user feedback
6. **Don't create new UI components if existing shadcn ones work** — consistency over creativity
7. **Every state is handled** — loading, empty, error, success, and edge cases like "already exists"
8. **Mobile-first breakpoints** — design for `sm` first, enhance for `md` and `lg`
9. **DRY on first reuse** — the second occurrence of any type, utility, constant, or logic pattern is already a violation. Extract immediately. Parameterize differences rather than copy-pasting with minor tweaks.
10. **Database query safety** — never return full records to the client. Always select specific fields. Always paginate queries that could return >50 rows.
11. **Parallelize independent operations** — use Promise.all() for independent data fetches. Never await sequentially when operations are independent.
12. **No unnecessary dependencies** — check native APIs (fetch, URL, Intl, crypto) first. Don't add a package for <30 lines of code.
13. **Comments explain WHY, not WHAT** — no restated-code comments, no self-referential comments. Only explain the non-obvious.
14. **Intellectual honesty** — verify library functions exist before using them. Never invent APIs. Say "I don't know" rather than fabricating. Distinguish compiling from working.

## File Organization
```
src/lib/<feature>.ts         — All server actions for this feature
src/app/admin/<feature>/     — Admin pages
src/app/(main)/<feature>/    — Public pages
src/components/<feature>.tsx — Reusable UI components
```

## Level History
- **Lv.1** — Base: Full-stack implementation protocol with Next.js patterns, server action patterns, and file organization conventions.
