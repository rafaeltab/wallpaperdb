"""File-only feedback audit; intentionally imports none of the evaluator code."""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def fraction(a, b):
    return a / b if b else None


def equivalent(actual, expected):
    if isinstance(expected, dict):
        return isinstance(actual, dict) and set(actual) == set(expected) and all(equivalent(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(equivalent(a, b) for a, b in zip(actual, expected))
    if isinstance(expected, float):
        return isinstance(actual, (float, int)) and math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-12)
    return actual == expected


def pair_summary(comparisons):
    counts = {name: sum(p["outcome"] == name for p in comparisons) for name in ["concordant", "discordant", "tied"]}
    assessed = sum(counts.values())
    return {"agreement": fraction(counts["concordant"] + counts["tied"] / 2, assessed), "assessedPairs": assessed,
            "totalPairs": len(comparisons), "coverage": fraction(assessed, len(comparisons)), **counts}


def accuracy(case, hits):
    scores = {}
    for hit in hits:
        assert isinstance(hit["id"], str) and hit["id"] not in scores
        assert isinstance(hit["score"], (int, float)) and math.isfinite(hit["score"])
        scores[hit["id"]] = hit["score"]
    expected = case.get("expectedRankedIds", [id for id in case["judgedIds"] if id not in case.get("excludedIds", [])])
    returned = [id for id in expected if id in scores]
    missing = [id for id in expected if id not in scores]
    comparisons = []
    for pair in case["preferencePairs"]:
        a, b = pair["preferred"], pair["other"]
        outcome = "missing"
        if a in scores and b in scores:
            outcome = "tied" if scores[a] == scores[b] else "concordant" if scores[a] > scores[b] else "discordant"
        comparisons.append({**pair, "outcome": outcome, "credit": {"missing": None, "tied": .5, "concordant": 1, "discordant": 0}[outcome]})
    all_pairs = pair_summary(comparisons)
    excluded = [id for id in case.get("excludedIds", []) if id in scores]
    output = {"metricPolicy": "strict-pair-query-macro-v1", "caseId": case["id"], "category": case["category"],
              "categories": case.get("categories", [case["category"]]), "groupId": case["groupId"],
              "status": "unscored" if not all_pairs["totalPairs"] else "partial" if missing else "complete",
              "allPairs": all_pairs, "withoutUncertain": pair_summary([p for p in comparisons if not p["uncertain"]]),
              "coverage": {"expectedIds": expected, "returnedIds": returned, "missingIds": missing, "fraction": fraction(len(returned), len(expected))},
              "eligibility": {"excludedReturned": excluded, "violations": len(excluded)},
              "discrepancies": [p for p in comparisons if p["outcome"] != "concordant"]}
    return output, comparisons


def summarize(records):
    status = collections.Counter(row["accuracy"]["status"] if row.get("status") in [None, "ok"] else row["status"] for row in records)
    available = [row for row in records if row.get("status") not in ["unsupported", "error"]]
    result = {"totalCases": len(records), "statusCounts": dict(status)}
    for key in ["allPairs", "withoutUncertain"]:
        assessed = [row for row in available if row["accuracy"][key]["agreement"] is not None]
        complete = [row for row in assessed if not row["accuracy"]["coverage"]["missingIds"]]
        assessed_pairs = sum(row["accuracy"][key]["assessedPairs"] for row in available)
        total_pairs = sum(row["accuracy"][key]["totalPairs"] for row in records)
        result[key] = {"queryMacroAgreement": fraction(sum(row["accuracy"][key]["agreement"] for row in assessed), len(assessed)),
                       "completeCaseMacroAgreement": fraction(sum(row["accuracy"][key]["agreement"] for row in complete), len(complete)),
                       "assessedCases": len(assessed), "completeCases": len(complete), "totalCases": len(records),
                       "assessedPairs": assessed_pairs, "totalPairs": total_pairs, "pairCoverage": fraction(assessed_pairs, total_pairs)}
    expected = sum(len(row["accuracy"]["coverage"]["expectedIds"]) for row in records)
    returned = sum(len(row["accuracy"]["coverage"]["returnedIds"]) for row in available)
    result["imageCoverage"] = {"expected": expected, "returned": returned, "fraction": fraction(returned, expected)}
    result["eligibilityViolations"] = sum(row["accuracy"]["eligibility"]["violations"] for row in records)
    return result


def audit(directory):
    directory = Path(directory)
    raw = {name: (directory / (name + ".json")).read_bytes() for name in ["run", "dataset", "corpus"]}
    run, dataset, corpus = [json.loads(raw[name]) for name in ["run", "dataset", "corpus"]]
    errors = []
    def check(condition, message):
        if not condition:
            errors.append(message)
    check(sha(canonical(dataset)) == run["dataset"]["hash"], "Dataset canonical hash differs (or non-ASCII key collation needs review).")
    check(dataset["sourceHashes"] == run["dataset"]["sourceHashes"], "Dataset source hashes differ.")
    check(run["dataset"]["caseCount"] == len(dataset["cases"]), "Dataset case count differs.")
    corpus_ids = {row["id"] for row in corpus}
    check(len(corpus_ids) == len(corpus) == run["dataset"]["corpusSize"], "Corpus inventory differs.")
    corpus_identity = sorted([{"id": row["id"], "sha256": row["sha256"]} for row in corpus], key=lambda row: row["id"])
    check(sha(canonical(corpus_identity)) == run["dataset"]["corpusHash"], "Corpus identity hash differs.")
    cases = {case["id"]: case for case in dataset["cases"]}
    for case in cases.values():
        ordered = [(a, b) for i, group in enumerate(case["orderGroups"]) for a in group for following in case["orderGroups"][i+1:] for b in following]
        pairs = [(pair["preferred"], pair["other"]) for pair in case["preferencePairs"]]
        check(ordered == pairs, "Strict pair derivation differs: " + case["id"])
    results = []
    outcomes = {}
    check([c["id"] for c in run["candidates"]] == [c["id"] for c in run["configuration"]["candidates"]], "Candidate inventory differs.")
    for candidate in run["candidates"]:
        records, pair_outcomes = [], {}
        check([row["caseId"] for row in candidate["cases"]] == list(cases), "Candidate case inventory differs: " + candidate["id"])
        for row in candidate["cases"]:
            case = cases[row["caseId"]]
            check(all(hit["id"] in corpus_ids for hit in row["hits"]), "Unknown corpus hit: " + candidate["id"] + "/" + case["id"])
            calculated, comparisons = accuracy(case, row["hits"])
            check(equivalent(row["accuracy"], calculated), "Case accuracy differs: " + candidate["id"] + "/" + case["id"])
            check(row["orderGroups"] == case["orderGroups"] and row["query"] == case["query"], "Query/judgment identity differs: " + case["id"])
            records.append({"status": row["status"], "accuracy": calculated})
            pair_outcomes.update({(case["id"], pair["preferred"], pair["other"]): pair["outcome"] for pair in comparisons})
        summary = summarize(records)
        categories = list(dict.fromkeys(record["accuracy"]["category"] for record in records))
        summary["categories"] = {category: summarize([record for record in records if record["accuracy"]["category"] == category]) for category in categories}
        check(equivalent(candidate["summary"]["accuracy"], summary), "Candidate aggregate differs: " + candidate["id"])
        outcomes[candidate["id"]] = pair_outcomes
        results.append({"id": candidate["id"], "index": candidate["configuration"].get("index"), "summary": summary,
                        "errorCases": [{"caseId": row["caseId"], "reason": row.get("reason")} for row in candidate["cases"] if row["status"] == "error"],
                        "timedFailures": sum(row["performance"].get("failures", 0) for row in candidate["cases"])})
    baseline = outcomes.get("favorite-baseline256", outcomes.get("favorite-utility-numeric"))
    if baseline:
        for row in results:
            row["pairOutcomeChangesFromBaseline"] = [{"caseId": key[0], "preferred": key[1], "other": key[2], "baseline": baseline[key], "candidate": outcome}
                                                    for key, outcome in outcomes[row["id"]].items() if outcome != baseline[key]]
    return {"runDirectory": str(directory), "runId": run["id"], "label": run["label"], "fileOnly": True,
            "integrityPassed": not errors, "errors": errors, "hashes": {name: sha(payload) for name, payload in raw.items()},
            "datasetHash": run["dataset"]["hash"], "candidates": results,
            "limitations": ["Agreement describes this single reviewer's development examples, including their quick-review caveat; no population accuracy claim.",
                            "Unsupported cases remain in coverage denominators and are not converted into zero agreement.",
                            "Independent arithmetic audit of saved judgments and hit scores; no service re-execution or image re-extraction."]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    report = audit(arguments.directory)
    if arguments.output:
        with arguments.output.open("x") as destination:
            json.dump(report, destination, indent=2)
            destination.write("\n")
    print(json.dumps({"runId": report["runId"], "integrityPassed": report["integrityPassed"], "errors": report["errors"],
                      "candidates": [{"id": c["id"], "agreement": c["summary"]["allPairs"]["queryMacroAgreement"],
                                      "withoutUncertain": c["summary"]["withoutUncertain"]["queryMacroAgreement"], "statusCounts": c["summary"]["statusCounts"],
                                      "pairChanges": len(c.get("pairOutcomeChangesFromBaseline", [])), "timedFailures": c["timedFailures"]} for c in report["candidates"]]}, indent=2))
    raise SystemExit(0 if report["integrityPassed"] else 1)
