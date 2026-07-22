// verify-claim.js — OpenCode plugin: custom tool for verifying factual claims about code/infrastructure
// The AI calls this tool BEFORE asserting unverified information.
// Returns VERIFIED / UNVERIFIED / CONTRADICTED with supporting evidence.

import { tool } from "@opencode-ai/plugin";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export const VerifyClaimPlugin = async ({ directory }) => {
  const STOP_WORDS = new Set([
    "is","are","the","a","an","in","on","at","to","for","of","by","with",
    "uses","using","have","has","been","was","were","will","would","could",
    "should","may","might","shall","can","does","do","did","this","that",
    "these","those","its","their","our","your","my","his","her","not","no",
    "nor","but","or","and","we","it","as","be","if","from","than","so"
  ]);

  function extractTerms(claim) {
    // Remove punctuation, split into words
    const cleaned = claim.replace(/[.,!?;:'"]/g, "");
    const words = cleaned.split(/\s+/);
    // Filter stop words, take meaningful terms
    const meaningful = words
      .map(w => w.trim())
      .filter(w => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));
    // Deduplicate and limit to 5
    return [...new Set(meaningful)].slice(0, 5);
  }

  function sanitizeTerm(term) {
    return String(term).replace(/[^a-zA-Z0-9_\-\/]/g, "");
  }

  function runGrep(term, dir) {
    try {
      const safeTerm = sanitizeTerm(term);
      const result = execSync(
        `grep -rli "${safeTerm}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.md" "${dir}" 2>nul || echo "___NO_MATCHES___"`,
        { encoding: "utf-8", timeout: 10000, cwd: dir }
      );
      const lines = result.trim().split("\n").filter(l => l.trim() && l !== "___NO_MATCHES___" && !l.includes("No matches found"));
      return lines;
    } catch {
      return [];
    }
  }

  function runGlob(pattern, dir) {
    try {
      return existsSync(join(dir, pattern)) ? [pattern] : [];
    } catch {
      return [];
    }
  }

  function checkDirExists(dirPath) {
    try {
      return existsSync(dirPath);
    } catch {
      return false;
    }
  }

  function checkSpecificFile(filePath) {
    try {
      return existsSync(filePath);
    } catch {
      return false;
    }
  }

  return {
    tool: {
      verify_claim: tool({
        description: "Verify a factual claim about code, infrastructure, file existence, or technology choices. Call this BEFORE asserting any unverified claim about what exists or doesn't exist in the codebase.",
        args: {
          claim: tool.schema.string({
            description: "The claim to verify. Be specific. Example: 'The project uses Firestore for data persistence'",
          }),
          search_dirs: tool.schema.array(tool.schema.string()).optional().default(["."]),
          search_patterns: tool.schema.array(tool.schema.string()).optional().default(["**/*.{ts,tsx,js,jsx,py,go,rs,json,yaml,yml,md}"]),
          search_terms: tool.schema.array(tool.schema.string()).optional(),
        },
        async execute(args, context) {
          const dir = context.directory;
          const claim = args.claim;
          const searchTerms = args.search_terms || extractTerms(claim);
          const searchDirs = args.search_dirs || ["."];

          if (!searchTerms || searchTerms.length === 0) {
            return `🔍 Verify Claim: "${claim}"\n\nStatus: UNVERIFIED (confidence: 0.0)\nSummary: Could not extract meaningful search terms from claim.\n\nRecommendation: Provide more specific search terms via the search_terms parameter.`;
          }

          // Check if claim references a specific file path hint
          const fileHints = claim.match(/[\w/\\-]+\.\w{2,4}/g);
          let specificFiles = [];
          if (fileHints) {
            for (const hint of fileHints) {
              const fullPath = hint.startsWith(dir) ? hint : `${dir}/${hint}`;
              if (checkSpecificFile(fullPath)) {
                specificFiles.push(hint);
              } else {
                // Try glob-style search
                const matches = runGlob(hint, dir);
                specificFiles.push(...matches.map(m => m.replace(dir, "").replace(/^[\\/]/, "")));
              }
            }
            specificFiles = [...new Set(specificFiles)];
          }

          // Run grep for each term
          const evidence = [];
          for (const term of searchTerms) {
            const matches = runGrep(term, dir);
            // Deduplicate by normalizing paths
            const uniquePaths = [...new Set(matches.map(m => m.replace(/\\/g, "/")))];
            evidence.push({
              term,
              matchedFiles: uniquePaths,
              matchCount: uniquePaths.length,
            });
          }

          // Analyze results
          const totalMatches = evidence.reduce((sum, e) => sum + e.matchCount, 0);
          const uniqueFiles = [...new Set(evidence.flatMap(e => e.matchedFiles))];

          let status, confidence, summary;

          if (specificFiles.length > 0 && totalMatches >= 3) {
            status = "VERIFIED";
            confidence = 1.0;
            summary = `Found ${totalMatches} matches across ${uniqueFiles.length} files. Specific file(s) "${specificFiles[0]}" confirmed to exist.`;
          } else if (totalMatches >= 3) {
            status = "VERIFIED";
            confidence = 1.0;
            summary = `Found ${totalMatches} matches across ${uniqueFiles.length} files. Claim is strongly supported.`;
          } else if (totalMatches >= 1) {
            status = "VERIFIED";
            confidence = 0.7;
            summary = `Found ${totalMatches} match(es) across ${uniqueFiles.length} file(s). Claim is weakly supported — verify context before asserting.`;
          } else {
            // Check for contradicting evidence — search for related negative terms
            const negativeTerms = ["not", "no", "without", "lacking", "absent", "missing"];
            const hasNegative = negativeTerms.some(t => claim.toLowerCase().includes(t));

            if (hasNegative) {
              // Claim is negative (doesn't use X) — check if X actually exists
              const positiveTerms = searchTerms.filter(t => !negativeTerms.includes(t));
              const positiveEvidence = [];
              for (const term of positiveTerms) {
                const matches = runGrep(term, dir);
                if (matches.length > 0) {
                  positiveEvidence.push({ term, count: matches.length });
                }
              }
              if (positiveEvidence.length > 0) {
                status = "CONTRADICTED";
                confidence = 1.0;
                summary = `Claim says something doesn't exist, but found ${positiveEvidence.length} term(s) with matches: ${positiveEvidence.map(e => `${e.term} (${e.count}x)`).join(", ")}`;
              } else {
                status = "VERIFIED";
                confidence = 0.7;
                summary = `Negative claim. Searched ${searchTerms.length} terms, found 0 matches. Claim is weakly supported (absence of evidence is not evidence of absence).`;
              }
            } else {
              status = "UNVERIFIED";
              confidence = 0.0;
              summary = `Searched ${searchTerms.length} terms across ${searchDirs.length} directory/directories. Found 0 matches for any term.`;
            }
          }

          // Format response
          const evidenceLines = evidence.map(e =>
            `  • "${e.term}" → ${e.matchCount > 0 ? `${e.matchCount} file(s): ${e.matchedFiles.slice(0, 5).join(", ")}${e.matchedFiles.length > 5 ? ` +${e.matchedFiles.length - 5} more` : ""}` : "0 files"}`
          ).join("\n");

          let recommend;
          if (confidence >= 1.0) {
            recommend = "Claim is VERIFIED. Safe to assert with confidence.";
          } else if (confidence >= 0.7) {
            recommend = "Claim has some support but verify context before asserting. Say 'Based on what I found...' rather than stating as absolute fact.";
          } else {
            recommend = "Claim is UNVERIFIED. Do NOT state this as fact. Say 'Let me check' and verify properly.";
          }

          return [
            `🔍 Verify Claim: "${claim}"`,
            ``,
            `Status: ${status} (confidence: ${confidence})`,
            `Summary: ${summary}`,
            ``,
            `Terms Searched: ${searchTerms.join(", ")}`,
            `Directories Searched: ${searchDirs.join(", ")}`,
            ...(specificFiles.length > 0 ? [`Specific Files Found: ${specificFiles.join(", ")}`] : []),
            ``,
            `Evidence:`,
            evidenceLines,
            ``,
            `Recommendation: ${recommend}`,
          ].join("\n");
        },
      }),
    },
  };
};
