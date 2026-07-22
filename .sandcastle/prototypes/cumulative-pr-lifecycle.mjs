// PROTOTYPE — throwaway state model for wallpaperdb#184.
// Run interactively: node .sandcastle/prototypes/cumulative-pr-lifecycle.mjs
// Run a scenario:  node .sandcastle/prototypes/cumulative-pr-lifecycle.mjs --scenario success

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const state = {
    mainAtStart: "main@0",
    runTip: "main@0",
    promoted: [],
    quarantined: [],
    events: [],
};

function apply(command) {
    const [action, value] = command.trim().split(/\s+/, 2);

    switch (action) {
        case "start": {
            const issue = Number(value);
            if (!Number.isInteger(issue)) throw new Error("usage: start <issue>");
            if (state.candidate) throw new Error(`issue ${state.candidate.issue} is already active`);
            const branch = `sandcastle/issue-${issue}`;
            state.candidate = {
                issue,
                branch,
                baseTip: state.runTip,
                head: `${branch}@1`,
                pr: "none",
                ciGreen: false,
                reviewStable: false,
            };
            state.events.push(`started #${issue} from immutable tip ${state.runTip}`);
            break;
        }
        case "draft": {
            const candidate = requireCandidate();
            if (candidate.pr !== "none") throw new Error(`PR already exists for ${candidate.branch}; reconcile it instead of creating another`);
            candidate.pr = "draft";
            state.events.push(`opened draft PR for #${candidate.issue} against main`);
            break;
        }
        case "green": {
            const candidate = requireCandidate();
            if (candidate.pr === "none") throw new Error("open the draft PR first");
            candidate.ciGreen = true;
            state.events.push(`GitHub checks green for #${candidate.issue}`);
            break;
        }
        case "reviewed": {
            const candidate = requireCandidate();
            if (candidate.pr === "none") throw new Error("open the draft PR first");
            candidate.reviewStable = true;
            state.events.push(`automatic review stable for #${candidate.issue}`);
            break;
        }
        case "promote": {
            const candidate = requireCandidate();
            if (!candidate.ciGreen || !candidate.reviewStable) throw new Error("promotion requires green CI and stable review simultaneously");
            candidate.pr = "ready";
            state.runTip = candidate.head;
            state.promoted.push({ issue: candidate.issue, branch: candidate.branch, tip: candidate.head });
            state.events.push(`froze #${candidate.issue}; marked PR ready; closed issue; promoted ${candidate.head}`);
            state.candidate = undefined;
            break;
        }
        case "quarantine": {
            const candidate = requireCandidate();
            candidate.pr = "draft";
            state.quarantined.push({ issue: candidate.issue, branch: candidate.branch, head: candidate.head });
            state.events.push(`quarantined #${candidate.issue}; retained draft PR; run tip remains ${state.runTip}`);
            state.candidate = undefined;
            break;
        }
        case "mutate": {
            const promoted = state.promoted.find((item) => item.issue === Number(value));
            if (!promoted) throw new Error(`issue ${value} is not a promoted tip`);
            throw new Error(`immutable promoted tip ${promoted.tip}: add corrective work as a new ticket at ${state.runTip}`);
        }
        case "show":
        case "":
            break;
        default:
            throw new Error("commands: start <issue>, draft, green, reviewed, promote, quarantine, mutate <issue>, show, quit");
    }

    show();
}

function requireCandidate() {
    if (!state.candidate) throw new Error("no active candidate");
    return state.candidate;
}

function show() {
    console.log(JSON.stringify(state, null, 2));
}

function expectFailure(command, includes) {
    try {
        apply(command);
        throw new Error(`expected '${command}' to fail`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes(includes)) throw error;
        console.log(`EXPECTED FAILURE: ${message}`);
    }
}

function runScenario(name) {
    if (name === "success") {
        for (const command of ["start 201", "draft", "green", "reviewed", "promote", "start 202"]) apply(command);
        if (state.candidate?.baseTip !== "sandcastle/issue-201@1") throw new Error("next ticket did not inherit the promoted tip");
        console.log("SCENARIO PASS: success");
        return;
    }

    if (name === "quarantine") {
        for (const command of ["start 201", "draft", "green", "reviewed", "promote", "start 202", "draft", "quarantine", "start 203"]) apply(command);
        if (state.candidate?.baseTip !== "sandcastle/issue-201@1") throw new Error("quarantine advanced or lost the last green tip");
        console.log("SCENARIO PASS: quarantine");
        return;
    }

    if (name === "duplicate-pr") {
        for (const command of ["start 201", "draft"]) apply(command);
        expectFailure("draft", "PR already exists");
        console.log("SCENARIO PASS: duplicate-pr");
        return;
    }

    if (name === "immutable-tip") {
        for (const command of ["start 201", "draft", "green", "reviewed", "promote"]) apply(command);
        expectFailure("mutate 201", "immutable promoted tip");
        console.log("SCENARIO PASS: immutable-tip");
        return;
    }

    throw new Error("scenarios: success, quarantine, duplicate-pr, immutable-tip");
}

const scenarioIndex = process.argv.indexOf("--scenario");
if (scenarioIndex !== -1) {
    runScenario(process.argv[scenarioIndex + 1] ?? "");
} else {
    console.log("PROTOTYPE: cumulative PR lifecycle. Type 'show' or a command; 'quit' exits.");
    show();
    const readline = createInterface({ input: stdin, output: stdout });
    while (true) {
        const command = await readline.question("> ");
        if (command.trim() === "quit") break;
        try {
            apply(command);
        } catch (error) {
            console.error(`REJECTED: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    readline.close();
}

