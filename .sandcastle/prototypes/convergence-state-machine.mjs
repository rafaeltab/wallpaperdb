#!/usr/bin/env node

// PROTOTYPE — throwaway executable model for WallpaperDB issue 185.
// Question: does the CI + automatic-review convergence state machine feel right?
// Run: node .sandcastle/prototypes/convergence-state-machine.mjs all
// Or:  node .sandcastle/prototypes/convergence-state-machine.mjs interactive

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const MAX_UNSUCCESSFUL_CYCLES = 10;

const terminalStates = new Set(["PROMOTED", "QUARANTINED"]);

class ConvergenceRun {
  constructor(name) {
    this.name = name;
    this.state = "IMPLEMENTING";
    this.head = null;
    this.ciGreenFor = null;
    this.reviewStableFor = null;
    this.unsuccessfulCycles = 0;
    this.ciAttempt = 0;
    this.prCreated = false;
    this.history = [];
    this.print("created");
  }

  dispatch(event, data = {}) {
    if (terminalStates.has(this.state)) {
      throw new Error(`${this.state} is terminal; event ${event} is invalid`);
    }

    const from = this.state;
    const handler = this.transitions()[this.state]?.[event];
    if (!handler) throw new Error(`event ${event} is invalid in ${this.state}`);

    handler(data);
    this.assertInvariants();
    this.history.push({ from, event, to: this.state, head: this.head });
    this.print(event);
    return this;
  }

  transitions() {
    return {
      IMPLEMENTING: {
        implemented: ({ sha }) => {
          this.replaceHead(sha);
          this.state = "LOCAL_VERIFYING";
        },
      },
      LOCAL_VERIFYING: {
        local_failed: () => {
          this.state = "LOCAL_FIXING";
        },
        local_passed: () => {
          this.state = this.prCreated ? "UPDATING_DRAFT_PR" : "PRE_PR_REVIEWING";
        },
      },
      LOCAL_FIXING: {
        local_fix_created: ({ sha }) => {
          this.replaceHead(sha);
          this.state = "LOCAL_VERIFYING";
        },
      },
      PRE_PR_REVIEWING: {
        pre_review_changed: ({ sha }) => {
          this.replaceHead(sha);
          this.state = "LOCAL_VERIFYING";
        },
        pre_review_stable: () => {
          this.state = "UPDATING_DRAFT_PR";
        },
      },
      UPDATING_DRAFT_PR: {
        pr_updated: ({ sha = this.head } = {}) => {
          this.requireCurrentHead(sha);
          this.prCreated = true;
          this.ciAttempt += 1;
          this.state = "WAITING_FOR_CI";
        },
      },
      WAITING_FOR_CI: {
        ci_pending: ({ sha = this.head } = {}) => {
          this.requireCurrentHead(sha);
        },
        ci_failed: ({ sha = this.head } = {}) => {
          this.requireCurrentHead(sha);
          this.state = "FIXER_DIAGNOSING";
        },
        ci_green: ({ sha = this.head } = {}) => {
          this.requireCurrentHead(sha);
          this.ciGreenFor = sha;
          this.state = "FINAL_REVIEWING";
        },
        stale_ci_result: ({ sha }) => {
          if (sha === this.head) throw new Error("stale_ci_result must refer to an old SHA");
        },
      },
      FIXER_DIAGNOSING: {
        fixer_rerun_flake: ({ evidence }) => {
          this.requireEvidence(evidence);
          if (this.recordUnsuccessfulCycle("diagnosed flake; rerun same SHA")) return;
          this.ciAttempt += 1;
          this.state = "WAITING_FOR_CI";
        },
        fixer_changed_code: ({ sha, evidence }) => {
          this.requireEvidence(evidence);
          if (this.recordUnsuccessfulCycle("deterministic CI failure; code changed")) return;
          this.replaceHead(sha);
          this.state = "LOCAL_VERIFYING";
        },
      },
      FINAL_REVIEWING: {
        final_review_changed: ({ reviewedSha = this.head, sha }) => {
          this.requireCurrentHead(reviewedSha);
          if (this.recordUnsuccessfulCycle("green CI followed by reviewer change")) return;
          this.replaceHead(sha);
          this.state = "LOCAL_VERIFYING";
        },
        final_review_stable: ({ sha = this.head } = {}) => {
          this.requireCurrentHead(sha);
          if (this.ciGreenFor !== sha) {
            throw new Error(`cannot promote ${sha}: authoritative CI is not green for current head`);
          }
          this.reviewStableFor = sha;
          this.state = "CONFIRMING_PROMOTION";
        },
      },
      CONFIRMING_PROMOTION: {
        convergence_confirmed: ({ sha = this.head } = {}) => {
          this.requireCurrentHead(sha);
          if (this.ciGreenFor !== sha || this.reviewStableFor !== sha) {
            throw new Error(`cannot promote ${sha}: CI and review do not both cover current head`);
          }
          this.state = "PROMOTED";
        },
      },
    };
  }

  replaceHead(sha) {
    if (!sha) throw new Error("a code-changing transition requires a SHA");
    if (sha === this.head) throw new Error(`code-changing transition did not change SHA ${sha}`);
    this.head = sha;
    this.ciGreenFor = null;
    this.reviewStableFor = null;
  }

  recordUnsuccessfulCycle(reason) {
    this.unsuccessfulCycles += 1;
    this.lastFailure = reason;
    if (this.unsuccessfulCycles >= MAX_UNSUCCESSFUL_CYCLES) {
      this.state = "QUARANTINED";
      return true;
    }
    return false;
  }

  requireCurrentHead(sha) {
    if (sha !== this.head) throw new Error(`event for stale SHA ${sha}; current head is ${this.head}`);
  }

  requireEvidence(evidence) {
    if (!evidence?.trim()) throw new Error("fixer decisions require recorded evidence");
  }

  assertInvariants() {
    if (this.ciGreenFor && this.ciGreenFor !== this.head) {
      throw new Error("green CI observation belongs to a stale SHA");
    }
    if (this.reviewStableFor && this.reviewStableFor !== this.head) {
      throw new Error("stable review observation belongs to a stale SHA");
    }
    if (this.state === "PROMOTED") {
      if (this.ciGreenFor !== this.head || this.reviewStableFor !== this.head) {
        throw new Error("promotion requires green CI and stable review for the same current SHA");
      }
    }
    if (this.state === "QUARANTINED" && this.unsuccessfulCycles !== MAX_UNSUCCESSFUL_CYCLES) {
      throw new Error("quarantine requires exactly ten unsuccessful cycles");
    }
  }

  snapshot() {
    return {
      scenario: this.name,
      state: this.state,
      head: this.head,
      ciGreenFor: this.ciGreenFor,
      reviewStableFor: this.reviewStableFor,
      unsuccessfulCycles: this.unsuccessfulCycles,
      ciAttempt: this.ciAttempt,
      prCreated: this.prCreated,
      lastFailure: this.lastFailure ?? null,
      terminal: terminalStates.has(this.state),
    };
  }

  print(event) {
    console.log(`\n[${this.name}] ${event}`);
    console.log(JSON.stringify(this.snapshot(), null, 2));
  }
}

function reachFirstCi(name, sha = "A") {
  return new ConvergenceRun(name)
    .dispatch("implemented", { sha })
    .dispatch("local_passed")
    .dispatch("pre_review_stable")
    .dispatch("pr_updated", { sha });
}

const scenarios = {
  happy() {
    reachFirstCi("happy")
      .dispatch("ci_green", { sha: "A" })
      .dispatch("final_review_stable", { sha: "A" })
      .dispatch("convergence_confirmed", { sha: "A" });
  },
  "code-fix"() {
    reachFirstCi("code-fix")
      .dispatch("ci_failed", { sha: "A" })
      .dispatch("fixer_changed_code", { sha: "B", evidence: "unit lane failed deterministically" })
      .dispatch("local_passed")
      .dispatch("pr_updated", { sha: "B" })
      .dispatch("ci_green", { sha: "B" })
      .dispatch("final_review_stable", { sha: "B" })
      .dispatch("convergence_confirmed", { sha: "B" });
  },
  flake() {
    reachFirstCi("flake")
      .dispatch("ci_failed", { sha: "A" })
      .dispatch("fixer_rerun_flake", { evidence: "same browser timeout in unchanged test" })
      .dispatch("ci_green", { sha: "A" })
      .dispatch("final_review_stable", { sha: "A" })
      .dispatch("convergence_confirmed", { sha: "A" });
  },
  "review-change"() {
    reachFirstCi("review-change")
      .dispatch("ci_green", { sha: "A" })
      .dispatch("final_review_changed", { sha: "B" })
      .dispatch("local_passed")
      .dispatch("pr_updated", { sha: "B" })
      .dispatch("ci_green", { sha: "B" })
      .dispatch("final_review_stable", { sha: "B" })
      .dispatch("convergence_confirmed", { sha: "B" });
  },
  "stale-event"() {
    const run = reachFirstCi("stale-event")
      .dispatch("ci_failed", { sha: "A" })
      .dispatch("fixer_changed_code", { sha: "B", evidence: "compile failure fixed" })
      .dispatch("local_passed")
      .dispatch("pr_updated", { sha: "B" });
    try {
      run.dispatch("ci_green", { sha: "A" });
    } catch (error) {
      console.log(`\n[stale-event] correctly rejected: ${error.message}`);
      run.print("stale result rejected; state unchanged");
    }
    run.dispatch("ci_green", { sha: "B" }).dispatch("final_review_stable", { sha: "B" })
      .dispatch("convergence_confirmed", { sha: "B" });
  },
  quarantine() {
    const run = reachFirstCi("quarantine");
    for (let cycle = 1; cycle <= MAX_UNSUCCESSFUL_CYCLES; cycle += 1) {
      run.dispatch("ci_failed", { sha: "A" }).dispatch("fixer_rerun_flake", {
        evidence: `flake diagnosis ${cycle}`,
      });
    }
  },
};

async function interactive() {
  const rl = createInterface({ input, output });
  console.log(`Available scenarios: ${Object.keys(scenarios).join(", ")}, all, quit`);

  if (!input.isTTY) {
    for await (const line of rl) {
      const answer = line.trim();
      console.log(`scenario> ${answer}`);
      if (answer === "quit" || answer === "exit") break;
      if (answer) runSelection(answer);
    }
    rl.close();
    return;
  }

  while (true) {
    const answer = (await rl.question("scenario> ")).trim();
    if (answer === "quit" || answer === "exit") break;
    if (answer) runSelection(answer);
  }
  rl.close();
}

function runSelection(selection) {
  if (selection === "all") {
    for (const scenario of Object.values(scenarios)) scenario();
    return;
  }
  const scenario = scenarios[selection];
  if (!scenario) throw new Error(`unknown scenario: ${selection}`);
  scenario();
}

const selection = process.argv[2] ?? "interactive";
if (selection === "interactive") await interactive();
else runSelection(selection);
