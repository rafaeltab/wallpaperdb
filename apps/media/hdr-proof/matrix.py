"""Ledger inventory and a test-only request oracle.

This module does not implement Media, encode images, or certify a display. The
oracle protects native experiments from accidentally testing a weaker request.
Its unit tests do not qualify any codec path or production endpoint.
"""

import copy
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
                    selectors["depth"] = "8"
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
    """Finite minimum coverage plan; extra observed tuples never erase its gaps."""
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


def build_matrix(evidence):
    """Aggregate evidence fail-closed; successful encoding alone cannot qualify."""
    cells = ledger_cells()
    by_id = {cell["id"]: cell for cell in cells}
    errors = []
    grouped = {cell["id"]: [] for cell in cells}
    plan = required_cases()
    planned = {case["case_id"]: case for case in plan}
    for original in evidence:
        item = copy.deepcopy(original)
        cell_id = item.get("cell_id")
        if cell_id not in by_id:
            errors.append(f"Unknown ledger cell for evidence {item.get('case_id')}: {cell_id}")
            continue
        if item.get("status") not in STATUSES:
            errors.append(f"Invalid evidence status for {item.get('case_id')}: {item.get('status')}")
            item["status"] = "untested"
        expected = planned.get(item.get("case_id"))
        if expected:
            try:
                matches_plan = item.get("fixture_id") == expected["fixture_id"] and validate_selectors(item.get("selectors", {})) == validate_selectors(expected["selectors"])
            except ProofRequestError:
                matches_plan = False
            item["matches_coverage_plan"] = matches_plan
            if not matches_plan:
                errors.append(f"Evidence selectors or fixture do not match planned case: {item.get('case_id')}")
                item["status"] = "tested and failed"
                item.setdefault("blockers", []).append("Evidence selectors or fixture do not match the declared coverage-plan case.")
        checks = item.get("checks", {})
        missing = [key for key in CHECKS if checks.get(key) is not True]
        if item["status"] == "qualified" and missing:
            errors.append(f"Unsubstantiated qualification for {item.get('case_id')}; missing checks: {', '.join(missing)}")
            item["status"] = "tested and failed"
            item.setdefault("blockers", []).append("Incomplete qualification evidence: " + ", ".join(missing))
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
    return {
        "schema_version": 1, "scope": "Automated codec proof only; no production capability publication or physical-display certification.",
        "ledger_cell_count": 85, "generic_sdr_control_count": 5,
        "statuses": list(STATUSES), "cells": cells,
        "required_case_count": len(plan), "evidence_errors": errors,
        "milestone_qualified": False,
        "milestone_blockers": ["Physical browser/native viewer/OS wallpaper checks remain pending manual review."] + [cell["id"] for cell in cells if cell["required"] and cell["status"] != "qualified"],
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
