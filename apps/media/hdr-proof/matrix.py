"""Ledger inventory and a test-only request oracle.

This module does not implement Media, encode images, or certify a display. The
oracle protects native experiments from accidentally testing a weaker request.
Its unit tests do not qualify any codec path or production endpoint.
"""

import copy
from collections import Counter
import re


FORMATS = ("jpg", "avif", "png", "webp", "gif")
STATUSES = ("qualified", "tested and failed", "untested", "deliberately deferred", "incompatible with the requested selectors")
CHECKS = ("native_encoder", "independent_decoder", "structure", "appearance", "privacy")
SOURCES = (
    ("gainmap-jpeg", "Still Android/ISO or old/new Apple gain-map JPEG"),
    ("static-avif", "Still single-layer PQ/HLG AVIF, including alpha"),
    ("animated-pq", "Animated PQ AVIF with partial transparency"),
    ("animated-hlg", "Animated HLG AVIF with partial transparency"),
    ("hdr-png", "HDR PNG/APNG with recognized HDR signaling"),
    ("avif-gainmap", "AVIF with a gain map"),
    ("other-hdr", "Other producer-accepted but unqualified HDR source"),
    ("deferred-input", "HDR HEIC/HEIF or JPEG XL"),
    ("sdr", "SDR source"),
)
GEOMETRIES = {
    "contain": {"w": 58, "h": 38, "fit": "contain"},
    "cover": {"w": 40, "h": 40, "fit": "cover"},
    "fill": {"w": 40, "h": 48, "fit": "fill"},
    "upscale": {"w": 120, "h": 80, "fit": "contain"},
    "orientation": {"w": 58, "fit": "contain"},
}
GAINMAP_GEOMETRIES = {
    "contain": {"w": 173, "fit": "contain"},
    "cover": {"w": 173, "h": 173, "fit": "cover"},
    "fill": {"w": 173, "h": 211, "fit": "fill"},
    "upscale": {"w": 769, "fit": "contain"},
    "orientation": {"w": 173, "fit": "contain"},
}


def _policy(source, dynamic_range, output):
    if dynamic_range == "hdr" and (output == "gif" or source == "sdr"):
        return "reject", "HDR GIF is excluded; an SDR source cannot acquire fabricated HDR."
    if source == "deferred-input":
        return "later", "HEIC/HEIF input is after the HDR milestone; JPEG XL is outside the selected input set."
    if source == "sdr":
        return "generic contract", "SDR-origin SDR controls are governed by #250, outside the HDR-origin ledger."
    if source in {"animated-pq", "animated-hlg"} and output == "jpg":
        return "conditional reject", "Preserved motion/alpha cannot fit JPEG. Explicit static extraction plus alpha handling is a separate after-proof tuple."
    if source == "gainmap-jpeg" and output == "jpg":
        return "required", ("Preserve authored SDR base and reconstructed HDR appearance; validate ISO and Android metadata." if dynamic_range == "hdr" else "Select authored SDR base; preserve authored gamut unless sRGB is explicitly requested.")
    if source == "static-avif" and output == "avif":
        return "required", ("Same-transfer PQ/HLG AVIF at valid 8/10/12-bit P3/Rec.2020; preserve alpha." if dynamic_range == "hdr" else "Controlled sRGB tone mapping; ordinary white near 90 percent SDR signal; retain alpha.")
    if source == "animated-pq" and (output == "avif" or (dynamic_range == "sdr" and output == "webp")):
        return "required", "Preserve animation, timing, loop and fractional alpha; explicit static AVIF extraction also requires proof."
    if source == "animated-hlg" and dynamic_range == "hdr" and output == "avif":
        return "after proof", "Accepted source may be original-only. Animated HLG plus alpha derivatives are candidates, not a milestone gate."
    if output == "gif":
        return "after proof", "SDR only; fractional alpha requires explicit coercion; motion and 8-bit output limits apply."
    if source == "avif-gainmap":
        return "after proof", "Requires accepted input, gain-map recognition, independent reconstruction and exact conversion proof."
    if source == "hdr-png":
        return "after proof", "HDR PNG/APNG is container-capable. Input, native conversion and consumer qualification remain separate."
    if source == "other-hdr":
        return "after proof", "Accepted originals remain available. Unqualified source facts never authorize transformation."
    if dynamic_range == "hdr" and output in {"png", "webp"}:
        return "after proof", "Container possibility is distinct from native conversion and physical HDR presentation."
    if source == "gainmap-jpeg" and dynamic_range == "sdr":
        return "after proof", "Use the authored SDR base rather than tone mapping the HDR reconstruction."
    if source == "static-avif" and dynamic_range == "sdr" and output == "jpg":
        return "after proof", "First opaque OS wallpaper candidate; a usable SDR file is required, but no single encoding is mandatory."
    return "after proof", "Only the exact source, selectors, codec path and consumer combination may qualify."


def ledger_cells():
    """Return all 85 authoritative cells plus five labeled SDR control cells."""
    cells = []
    for source, label in SOURCES:
        for dynamic_range in ("hdr", "sdr"):
            for output in FORMATS:
                policy, reason = _policy(source, dynamic_range, output)
                status = {"reject": STATUSES[4], "conditional reject": STATUSES[4], "later": STATUSES[3]}.get(policy, "untested")
                selectors = {"range": dynamic_range, "gamut": "preserve", "depth": "preserve", "motion": "preserve", "transparency": "preserve"}
                if dynamic_range == "sdr" and source in {"static-avif", "animated-pq"} and output in {"avif", "webp"}:
                    selectors["gamut"] = "srgb"
                    if output == "webp":
                        selectors["depth"] = "8"
                    else:
                        selectors.pop("depth")
                cells.append({
                    "id": f"{source}:{dynamic_range}:{output}", "source_id": source,
                    "source": label, "range": dynamic_range, "output": output,
                    "in_hdr_ledger": not (source == "sdr" and dynamic_range == "sdr"),
                    "policy": policy, "required": policy == "required", "selectors": selectors,
                    "status": status, "reason": reason, "advertisable": False,
                    "original_available_if_accepted": True,
                    "consumer_status": "pending manual review",
                    "qualification_scope": "Only listed exact fixture/selector cases; no inferred cross-product.",
                    "alternative_selectors": ([{"motion": "static", "transparency": "coerce", "depth": "8", "status": "untested", "policy": "after proof"}] if policy == "conditional reject" else []),
                })
    return cells


def required_cases():
    """Legacy fixed coverage plan; its SDR AVIF depth-8 choice is not product policy.

    Keep these exact cases so additional candidates never erase their failures.
    Product requirements are evaluated separately with omitted-depth semantics.
    """
    cases = []

    def add(fixture, source, dynamic_range, output, gamut, depth="preserve", motion="preserve", transparency="preserve"):
        geometries = GAINMAP_GEOMETRIES if source == "gainmap-jpeg" else GEOMETRIES
        for geometry, dimensions in geometries.items():
            case_id = f"{fixture}:{dynamic_range}:{output}:{gamut}:{motion}:{geometry}"
            cases.append({
                "case_id": case_id, "fixture_id": fixture,
                "cell_id": f"{source}:{dynamic_range}:{output}", "geometry": geometry,
                "selectors": {"format": output, "range": dynamic_range, "gamut": gamut, "depth": depth, "motion": motion, "transparency": transparency, **dimensions},
                "required": True, "checks_required": list(CHECKS),
                "orientation_requirement": "fixtures with nonidentity orientation; baked geometry and equivalent display orientation",
            })
            if geometry == 'orientation':
                cases[-1]['source_transform_requirement'] = ({'exif_orientation': 6}
                    if source == 'gainmap-jpeg' else {'irot': 1, 'imir': None})

    for fixture in ("gainmap-android-iso", "gainmap-android-xmp", "gainmap-apple-old", "gainmap-apple-new"):
        add(fixture, "gainmap-jpeg", "hdr", "jpg", "preserve")
        add(fixture, "gainmap-jpeg", "sdr", "jpg", "preserve")
        add(fixture, "gainmap-jpeg", "sdr", "jpg", "srgb")
    for transfer in ("pq", "hlg"):
        for gamut in ("p3", "rec2020"):
            for depth in (8, 10, 12):
                for alpha in ("opaque", "alpha"):
                    fixture = f"avif-{transfer}-{gamut}-{depth}-{alpha}"
                    add(fixture, "static-avif", "hdr", "avif", "preserve")
                    add(fixture, "static-avif", "sdr", "avif", "srgb", depth="8")
    add("animated-pq-alpha", "animated-pq", "hdr", "avif", "preserve")
    add("animated-pq-alpha", "animated-pq", "hdr", "avif", "preserve", motion="static")
    add("animated-pq-alpha", "animated-pq", "sdr", "avif", "srgb", depth="8")
    add("animated-pq-alpha", "animated-pq", "sdr", "webp", "srgb", depth="8")
    return cases


def _measurement_failures(value, path="measurements"):
    if isinstance(value, dict):
        for failure in value.get("failures", []):
            yield {"gate": "appearance", "check": str(failure), "location": path}
        for key, child in value.items():
            if key != "failures":
                yield from _measurement_failures(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _measurement_failures(child, f"{path}[{index}]")


def _has_rejected_measurement(value):
    if isinstance(value, dict):
        return (value.get('passed') is False or bool(value.get('failures'))
                or any(_has_rejected_measurement(child) for child in value.values()))
    if isinstance(value, list):
        return any(_has_rejected_measurement(child) for child in value)
    return False


def _case_diagnostics(case):
    """Describe existing evidence without changing its qualification decision."""
    checks = case.get("checks", {})
    native = checks.get("native_encoder")
    outcome = "completed" if native is True else ("failed" if native is False and case.get("status") == "tested and failed" else "not established")
    detail = {"native_outcome": outcome, "measured_failures": [], "missing_evidence": [], "not_evaluated": []}
    if outcome != "completed":
        detail["not_evaluated"] = [key for key in CHECKS if key != "native_encoder" and checks.get(key) is not True]
        return detail
    if checks.get("independent_decoder") is not True:
        detail["missing_evidence"].append({"gate": "independent_decoder", "check": "independent_decode_not_established"})
    if checks.get("independent_source_decoder") is False:
        detail["missing_evidence"].append({"gate": "independent_source_decoder", "check": "independent_source_decode_not_established"})
    measurements = list(_measurement_failures(case.get("measurements", {})))
    for failure in measurements:
        category = "missing_evidence" if failure["check"].endswith("_missing") else "measured_failures"
        detail[category].append(failure)
    if checks.get("appearance") is not True and not measurements:
        detail["missing_evidence"].append({"gate": "appearance", "check": "appearance_result_details_missing"})
    for gate in ("structure", "privacy"):
        if checks.get(gate) is True:
            continue
        failed = [key for key, passed in case.get("structural_checks", {}).items() if passed is False] if gate == "structure" else []
        if failed:
            detail["measured_failures"].extend({"gate": gate, "check": key} for key in failed)
        else:
            detail["missing_evidence"].append({"gate": gate, "check": f"{gate}_rejection_details_missing"})
    if case.get("matches_coverage_plan") is False:
        detail["missing_evidence"].append({"gate": "coverage", "check": "exact_planned_fixture_or_selectors_not_tested"})
    return detail


def _diagnostic_counts(cases):
    completed = [case for case in cases if case["diagnostics"]["native_outcome"] == "completed"]
    return {
        "cases": len(cases),
        "native_completed": len(completed),
        "native_operation_failures": sum(case["diagnostics"]["native_outcome"] == "failed" for case in cases),
        "native_not_established": sum(case["diagnostics"]["native_outcome"] == "not established" for case in cases),
        "qualified": sum(case.get("status") == "qualified" for case in cases),
        "measured_failure_cases": sum(bool(case["diagnostics"]["measured_failures"]) for case in cases),
        "missing_evidence_cases": sum(bool(case["diagnostics"]["missing_evidence"]) for case in cases),
        "failed_gates_after_native_completion": dict(sorted(Counter(key for case in completed for key in sorted(set(CHECKS) | set(case.get("checks", {}))) if key != "native_encoder" and case.get("checks", {}).get(key) is not True).items())),
        "measured_failure_checks": dict(sorted(Counter(check for case in cases for check in {entry["check"] for entry in case["diagnostics"]["measured_failures"]}).items())),
        "missing_evidence_checks": dict(sorted(Counter(check for case in cases for check in {entry["check"] for entry in case["diagnostics"]["missing_evidence"]}).items())),
    }


def _diagnostic_summary(cells, plan):
    cases = [case for cell in cells for case in cell["evidence"]]
    planned = {case["case_id"] for case in plan}
    required = [case for case in cases if case.get("case_id") in planned and case.get("matches_coverage_plan") is True]
    by_cell = []
    for cell in cells:
        if cell["required"]:
            items = [case for case in required if case["cell_id"] == cell["id"]]
            by_cell.append({"cell_id": cell["id"], "planned_cases": sum(case["cell_id"] == cell["id"] for case in plan), **_diagnostic_counts(items)})
    return {
        "scope": "Diagnostic categories do not replace qualification statuses. Measured failures and missing evidence overlap. False downstream flags after a native-operation failure are not measured failures.",
        "required_plan_size": len(plan), "required_cases": _diagnostic_counts(required),
        "all_cases": _diagnostic_counts(cases), "required_cells": by_cell,
    }


def _source_transform_matches(evidence, planned):
    """Different source transforms cannot substitute for the declared probe."""
    expected = planned.get('source_transform_requirement')
    if not expected:
        return True
    source = evidence.get('orientation_source')
    if not isinstance(source, dict) or not re.fullmatch(r'[0-9a-f]{64}', str(source.get('sha256', ''))):
        return False
    facts = source.get('facts', {})
    if not isinstance(facts, dict) or facts.get('sha256', source['sha256']) != source['sha256']:
        return False
    if 'exif_orientation' in expected:
        observed = [source['orientation']] if 'orientation' in source else []
        if 'metadata' in facts:
            tags = facts['metadata']
            if not isinstance(tags, dict):
                return False
            observed.append(tags.get('IFD0:Orientation', tags.get('Orientation', 1)))
        native = evidence.get('native_candidate', {})
        if isinstance(native, dict) and 'source_orientation' in native:
            observed.append(native['source_orientation'])
        return bool(observed) and all(type(value) is int and value == expected['exif_orientation']
                                      for value in observed)
    info = facts.get('info', '')
    if not isinstance(info, str):
        return False
    rotations = re.findall(r'\birot\s*\(Rotation\)\s*:\s*([0-3])\b', info)
    tags = facts.get('exiftool', {})
    return (rotations == [str(expected['irot'])] and not re.search(r'\bimir\b', info)
            and isinstance(tags, dict) and tags.get('Rotation', expected['irot']) == expected['irot'])


def _product_coverage(cells, plan):
    """Match accepted product requests to independently qualified exact tuples."""
    by_cell = {cell['id']: cell for cell in cells}
    requirements = []
    for planned in plan:
        selectors = dict(planned['selectors'])
        selectable_depth = planned['cell_id'] in ('static-avif:sdr:avif', 'animated-pq:sdr:avif')
        if selectable_depth:
            selectors.pop('depth')
        expected = validate_selectors(selectors)
        matching = []
        for evidence in by_cell[planned['cell_id']]['evidence']:
            if (evidence.get('fixture_id') != planned['fixture_id']
                    or evidence.get('geometry') != planned['geometry']
                    or not _source_transform_matches(evidence, planned)):
                continue
            try:
                actual = validate_selectors(evidence.get('selectors', {}))
            except ProofRequestError:
                continue
            if selectable_depth:
                if actual['depth'] not in ('8', '10', '12'):
                    continue
                actual['depth'] = 'auto'
            if actual == expected and evidence['status'] in ('qualified', 'tested and failed'):
                matching.append(evidence)
        qualified = sorted({item['case_id'] for item in matching
                            if item['status'] == 'qualified' and not item.get('blockers')})
        requirements.append({
            'requirement_id': 'product:' + planned['case_id'],
            'coverage_case_id': planned['case_id'], 'cell_id': planned['cell_id'],
            'fixture_id': planned['fixture_id'], 'geometry': planned['geometry'],
            'selectors': selectors,
            'source_transform_requirement': planned.get('source_transform_requirement'),
            'depth_policy': 'Omitted depth permits a qualified supported AVIF depth.' if selectable_depth else 'Exact requested depth promise.',
            'status': 'qualified' if qualified else 'tested and failed' if matching else 'untested',
            'qualified_evidence': qualified,
            'tested_evidence': sorted({item['case_id'] for item in matching}),
        })
    rows = []
    for cell in cells:
        selected = [item for item in requirements if item['cell_id'] == cell['id']]
        if not selected:
            continue
        row = {'cell_id': cell['id'], 'required_count': len(selected),
               'qualified_count': sum(item['status'] == 'qualified' for item in selected),
               'untested_count': sum(item['status'] == 'untested' for item in selected)}
        row['codec_complete'] = row['qualified_count'] == row['required_count']
        cell['product_coverage'] = row
        rows.append(row)
    return {
        'scope': 'Accepted product requests across the declared fixture/geometry plan. Numeric-depth failures remain separate exact-case evidence. This does not implement runtime depth selection or qualify physical consumers.',
        'required_count': len(requirements),
        'qualified_count': sum(item['status'] == 'qualified' for item in requirements),
        'untested_count': sum(item['status'] == 'untested' for item in requirements),
        'requirements': requirements, 'cells': rows,
    }


def build_matrix(evidence):
    """Aggregate evidence fail-closed; successful encoding alone cannot qualify."""
    cells = ledger_cells()
    by_id = {cell["id"]: cell for cell in cells}
    errors = []
    grouped = {cell["id"]: [] for cell in cells}
    plan = required_cases()
    planned = {case["case_id"]: case for case in plan}
    evidence = list(evidence)
    duplicates = {case_id for case_id, count in Counter(item.get('case_id') for item in evidence).items()
                  if count > 1}
    errors.extend(f'Duplicate evidence case_id: {case_id}' for case_id in sorted(duplicates))
    for original in evidence:
        item = copy.deepcopy(original)
        cell_id = item.get("cell_id")
        if cell_id not in by_id:
            errors.append(f"Unknown ledger cell for evidence {item.get('case_id')}: {cell_id}")
            continue
        if item.get("status") not in STATUSES:
            errors.append(f"Invalid evidence status for {item.get('case_id')}: {item.get('status')}")
            item["status"] = "untested"
        if item.get('case_id') in duplicates:
            if item['status'] == 'qualified':
                item['status'] = 'tested and failed'
            item.setdefault('blockers', []).append('Duplicate case ID makes the native evidence ambiguous.')
        expected = planned.get(item.get("case_id"))
        if expected:
            try:
                matches_plan = (cell_id == expected['cell_id']
                                and item.get("fixture_id") == expected["fixture_id"]
                                and item.get("geometry") == expected["geometry"]
                                and _source_transform_matches(item, expected)
                                and validate_selectors(item.get("selectors", {})) == validate_selectors(expected["selectors"]))
            except ProofRequestError:
                matches_plan = False
            item["matches_coverage_plan"] = matches_plan
            if not matches_plan:
                errors.append(f"Evidence cell, selectors, fixture, or source transform do not match planned case: {item.get('case_id')}")
                item["status"] = "tested and failed"
                item.setdefault("blockers", []).append("Evidence cell, selectors, fixture, or source transform do not match the declared coverage-plan case.")
        checks = item.get("checks", {})
        missing = [key for key in sorted(set(CHECKS) | set(checks)) if checks.get(key) is not True]
        if item["status"] == "qualified" and missing:
            errors.append(f"Unsubstantiated qualification for {item.get('case_id')}; missing checks: {', '.join(missing)}")
            item["status"] = "tested and failed"
            item.setdefault("blockers", []).append("Incomplete qualification evidence: " + ", ".join(missing))
        if item['status'] == 'qualified' and (item.get('blockers') or _has_rejected_measurement(item.get('measurements', {}))):
            errors.append(f"Qualification contradicts recorded blockers or failed measurements: {item.get('case_id')}")
            item['status'] = 'tested and failed'
            item.setdefault('blockers', []).append('Recorded blockers or failed measurements prevent qualification.')
        item["diagnostics"] = _case_diagnostics(item)
        grouped[cell_id].append(item)
    for cell in cells:
        items = grouped[cell["id"]]
        expected = {case["case_id"] for case in plan if case["cell_id"] == cell["id"]}
        seen = {item.get("case_id") for item in items if item.get("status") in {"qualified", "tested and failed"} and item.get("matches_coverage_plan", True)}
        qualified = [item for item in items if item["status"] == "qualified"]
        cell["evidence"] = items
        cell["qualified_cases"] = qualified
        cell["missing_cases"] = sorted(expected - seen)
        cell["blockers"] = sorted({str(blocker) for item in items for blocker in item.get("blockers", [])})
        # Incompatible default tuples remain incompatible even when an explicitly
        # different static/coercion tuple was tested in the same ledger cell.
        if cell["policy"] not in {"reject", "conditional reject", "later"}:
            if any(item["status"] == "tested and failed" for item in items):
                cell["status"] = "tested and failed"
            elif items and qualified and len(qualified) == len(items) and not cell["missing_cases"]:
                cell["status"] = "qualified"
        cell["codec_qualified"] = cell["status"] == "qualified"
        # Physical consumer proof is a separate required gate. This suite never
        # turns file-only evidence into a production capability advertisement.
        cell["advertisable"] = False
    product_coverage = _product_coverage(cells, plan)
    return {
        "schema_version": 2, "scope": "Automated codec proof only; no production capability publication or physical-display certification.",
        "ledger_cell_count": 85, "generic_sdr_control_count": 5,
        "statuses": list(STATUSES), "cells": cells,
        "required_case_count": len(plan), "evidence_errors": errors,
        "coverage_plan_scope": "required_case_count and diagnostic_summary.required_cases retain the original fixed 320-case suite plan. Product requirements use product_coverage; SDR AVIF output depth was not mandated as 8 by the accepted contract.",
        "diagnostic_summary": _diagnostic_summary(cells, plan),
        "product_coverage": product_coverage,
        "milestone_qualified": False,
        "milestone_blockers": ["Physical browser/native viewer/OS wallpaper checks remain pending manual review."] + [row['cell_id'] for row in product_coverage['cells'] if not row['codec_complete']],
        "policy_sources": [
            "https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5874883153",
            "https://github.com/rafaeltab/wallpaperdb/issues/263#issuecomment-5870519681",
            "https://github.com/rafaeltab/wallpaperdb/issues/284",
            "https://github.com/rafaeltab/wallpaperdb/issues/250",
        ],
    }


class ProofRequestError(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def _background(value):
    if re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        return [int(value[offset:offset + 2], 16) for offset in (1, 3, 5)]
    match = re.fullmatch(r"rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)", value)
    if match and all(0 <= int(channel) <= 255 for channel in match.groups()):
        return [int(channel) for channel in match.groups()]
    raise ProofRequestError(400, "Background must be #RRGGBB or rgb(r,g,b) with 8-bit integer channels")


def validate_selectors(raw):
    selectors = dict(raw)
    accepted = {"format", "w", "width", "h", "height", "fit", "range", "gamut", "depth", "motion", "transparency"}
    if set(selectors) - accepted:
        raise ProofRequestError(400, "Unknown selectors: " + ", ".join(sorted(set(selectors) - accepted)))
    for alias, short in (("width", "w"), ("height", "h")):
        if alias in selectors and short in selectors:
            raise ProofRequestError(400, f"can not provide both {short} and {alias}")
        if alias in selectors:
            selectors[short] = selectors.pop(alias)
    enumerated = {
        "format": FORMATS, "fit": ("contain", "cover", "fill"),
        "range": ("preserve", "sdr", "hdr"), "gamut": ("preserve", "srgb", "p3", "rec2020"),
        "depth": ("preserve", "8", "10", "12", "16"), "motion": ("preserve", "static", "animated"),
    }
    for key, choices in enumerated.items():
        if key in selectors and str(selectors[key]) not in choices:
            raise ProofRequestError(400, f"Invalid {key}")
    if "depth" in selectors:
        selectors["depth"] = str(selectors["depth"])
    for dimension in ("w", "h"):
        value = selectors.get(dimension, "preserve")
        if value != "preserve":
            if not re.fullmatch(r"[1-9][0-9]*", str(value)):
                raise ProofRequestError(400, "Dimensions must be positive integers or preserve")
            value = int(value)
        selectors[dimension] = value
    if selectors.get("transparency", "preserve") not in {"preserve", "coerce"}:
        _background(selectors["transparency"])
    for key, default in {"fit": "contain", "range": "preserve", "gamut": "preserve", "depth": "auto", "motion": "preserve", "transparency": "preserve"}.items():
        selectors.setdefault(key, default)
    return selectors


def _no_fact_transform(selectors):
    return all(selectors[key] == "preserve" for key in ("w", "h", "range", "gamut", "motion", "transparency")) and selectors["depth"] in {"auto", "preserve"} and "format" not in selectors


def _alpha_operation(facts, selectors, output):
    transparency = selectors["transparency"]
    background = None
    if transparency not in {"preserve", "coerce"}:
        if not facts["alpha_capable"]:
            raise ProofRequestError(400, "Background is invalid for source formats without transparency capability")
        background = {"srgb_8bit": _background(transparency), "hdr_white": "reference white, not peak highlight"}
        return "none", "composite after converting sRGB background to output encoding", background
    alpha = facts["alpha"]
    if alpha != "none" and output == "jpg":
        if transparency == "preserve":
            raise ProofRequestError(422, "JPEG cannot preserve alpha")
        return "none", "drop channels without a background", background
    if alpha == "fractional" and output == "gif":
        if transparency == "preserve":
            raise ProofRequestError(422, "GIF cannot preserve fractional alpha")
        return "binary", "threshold alpha at 50 percent", background
    return alpha, "preserve alpha", background


def _missing_transform_facts(facts, dynamic_range):
    required = ["orientation"]
    # This proof's qualified HDR JPEG representation is a base plus gain map.
    # Reconstructing/transcoding that HDR needs both coded depths. An explicit
    # SDR extraction only selects the authored base, so its map depth is not a
    # precondition for that experiment and remains an unknown source fact.
    if facts.get("format") == "jpg" and facts.get("range") == "hdr" and dynamic_range == "hdr":
        required.append("map_depth")
    return [key for key in required if facts.get(key) is None]


def request_decision(facts, raw):
    """Validate an experiment request; never authorize unproved conversion.

    'unqualified' is an eligible candidate for a native experiment, not permission
    for production delivery. The proof code deliberately has no encoder callback.
    """
    selectors = validate_selectors(raw)
    if _no_fact_transform(selectors):
        return {"action": "original", "selectors": selectors}
    if selectors.get("format") == facts.get("format") and _no_fact_transform({key: value for key, value in selectors.items() if key != "format"}):
        return {"action": "original", "selectors": selectors}
    required = {"format", "range", "gamut", "depth", "width", "height", "motion", "alpha", "alpha_capable"}
    if any(key not in facts or facts[key] is None for key in required):
        return {"action": "metadata-pending", "selectors": selectors, "capabilities": []}
    output = selectors.get("format", facts["format"])
    dynamic_range = facts["range"] if selectors["range"] == "preserve" else selectors["range"]
    gamut = facts["gamut"] if selectors["gamut"] == "preserve" else selectors["gamut"]
    motion = facts["motion"] if selectors["motion"] == "preserve" else selectors["motion"]
    if facts["range"] == "sdr" and dynamic_range == "hdr":
        raise ProofRequestError(422, "Cannot fabricate HDR source content")
    if dynamic_range == "hdr" and output == "gif":
        raise ProofRequestError(422, "GIF is not an HDR output")
    alpha, alpha_operation, background = _alpha_operation(facts, selectors, output)
    if motion == "animated" and (facts["motion"] != "animated" or output == "jpg"):
        raise ProofRequestError(422, "Requested animation cannot be preserved or invented")
    supported_depths = {"jpg": (8,), "avif": (8, 10, 12), "png": (8, 16), "webp": (8,), "gif": (8,)}[output]
    depth_selector = selectors["depth"]
    depth = facts["depth"] if depth_selector == "preserve" else (int(depth_selector) if depth_selector != "auto" else (facts["depth"] if output == facts["format"] or facts["depth"] in supported_depths else supported_depths[-1]))
    # Existing accepted original bytes need no encoder depth support.
    dimension_match = all(selectors[key] in {"preserve", facts[fact]} for key, fact in (("w", "width"), ("h", "height")))
    matches = output == facts["format"] and dynamic_range == facts["range"] and gamut == facts["gamut"] and motion == facts["motion"] and depth == facts["depth"] and alpha == facts["alpha"] and dimension_match
    if matches:
        return {"action": "original", "selectors": selectors}
    missing_facts = _missing_transform_facts(facts, dynamic_range)
    if missing_facts:
        return {"action": "metadata-pending", "selectors": selectors, "capabilities": [], "missing_facts": missing_facts, "original_available": True}
    if depth not in supported_depths:
        raise ProofRequestError(422, f"The selected native {output} output cannot encode depth {depth}")
    map_depth = facts.get("map_depth") if dynamic_range == "hdr" and output == "jpg" else None
    return {
        "action": "unqualified", "selectors": selectors, "source_facts": copy.deepcopy(facts),
        "output_facts": {"format": output, "range": dynamic_range, "gamut": gamut, "depth": depth, "map_depth": map_depth, "motion": motion, "alpha": alpha},
        "alpha_operation": alpha_operation, "background": background,
        "frame_selection": "first fully composed frame" if facts["motion"] == "animated" and motion == "static" else "preserve frame sequence",
        "reason": "Eligible for native experiment only; unproved delivery remains unsupported (422).",
    }


def exact_original(original, decision):
    if decision.get("action") != "original":
        raise ValueError("Only a proven no-op may use the exact-original path")
    return original


def metadata_view(persisted_facts, evidence):
    """No byte reader exists in this boundary; this is not a Media endpoint."""
    required = ("format", "range", "gamut", "depth", "width", "height", "motion", "alpha", "alpha_capable")
    missing_facts = [key for key in required if persisted_facts.get(key) is None]
    missing_facts += _missing_transform_facts(persisted_facts, persisted_facts.get("range"))
    ready = not missing_facts
    capabilities = []
    if ready:
        for item in evidence:
            if item.get("source_facts") == persisted_facts and item.get("status") == "qualified" and all(item.get("checks", {}).get(key) is True for key in CHECKS):
                capabilities.append({"fixture_id": item.get("fixture_id"), "selectors": copy.deepcopy(item.get("selectors", {}))})
    return {"state": "ready" if ready else "metadata-pending", "source": copy.deepcopy(persisted_facts), "capabilities": capabilities, "missing_facts": missing_facts, "original_available": True}
