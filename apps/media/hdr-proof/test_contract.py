"""Proof-adapter contract tests, never claims about production Media behavior."""

import hashlib
import unittest

from matrix import (
    ProofRequestError,
    build_matrix,
    exact_original,
    ledger_cells,
    metadata_view,
    request_decision,
    required_cases,
    validate_selectors,
)


FACTS = {
    "format": "avif", "range": "hdr", "gamut": "rec2020", "depth": 10,
    "width": 128, "height": 96, "motion": "animated", "alpha": "fractional",
    "alpha_capable": True, "orientation": 1,
}


class InventoryTests(unittest.TestCase):
    def test_every_authoritative_ledger_cell_and_five_sdr_controls_exist(self):
        cells = ledger_cells()
        self.assertEqual(len(cells), 90)
        self.assertEqual(len({cell["id"] for cell in cells}), 90)
        self.assertEqual(sum(cell["in_hdr_ledger"] for cell in cells), 85)
        self.assertEqual({cell["output"] for cell in cells}, {"jpg", "avif", "png", "webp", "gif"})
        self.assertFalse(any(cell["status"] == "qualified" for cell in cells))

    def test_hdr_png_and_webp_are_candidates_not_intrinsically_impossible(self):
        for cell in ledger_cells():
            if cell["source_id"] == "static-avif" and cell["range"] == "hdr" and cell["output"] in {"png", "webp"}:
                self.assertEqual(cell["policy"], "after proof")
                self.assertEqual(cell["status"], "untested")

    def test_required_paths_cannot_disappear_when_they_fail(self):
        cases = required_cases()
        self.assertTrue(any(case["fixture_id"] == "gainmap-apple-old" for case in cases))
        self.assertTrue(any(case["fixture_id"] == "gainmap-apple-new" for case in cases))
        for transfer in ("pq", "hlg"):
            for gamut in ("p3", "rec2020"):
                for depth in (8, 10, 12):
                    fixture = f"avif-{transfer}-{gamut}-{depth}-alpha"
                    self.assertTrue(any(case["fixture_id"] == fixture for case in cases), fixture)
        cell = next(cell for cell in build_matrix([])["cells"] if cell["id"] == "animated-pq:sdr:webp")
        self.assertTrue(cell["required"])
        self.assertEqual(cell["status"], "untested")
        self.assertTrue(cell["missing_cases"])

    def test_encoder_success_and_extension_do_not_qualify_a_path(self):
        evidence = [{"case_id": "probe", "cell_id": "static-avif:hdr:avif", "status": "qualified", "checks": {"native_encoder": True}, "output": "looks-hdr.avif"}]
        report = build_matrix(evidence)
        cell = next(cell for cell in report["cells"] if cell["id"] == "static-avif:hdr:avif")
        self.assertNotEqual(cell["status"], "qualified")
        self.assertEqual(cell["qualified_cases"], [])
        self.assertTrue(report["evidence_errors"])


class DiagnosticTests(unittest.TestCase):
    def case(self, **changes):
        planned = next(case for case in required_cases() if case["cell_id"] == "static-avif:hdr:avif")
        return {**planned, "status": "tested and failed", "checks": {key: True for key in ("native_encoder", "independent_decoder", "structure", "appearance", "privacy")}, **changes}

    def diagnosed(self, evidence):
        report = build_matrix(evidence)
        cell = next(cell for cell in report["cells"] if cell["id"] == "static-avif:hdr:avif")
        return report, cell["evidence"]

    def test_native_failure_does_not_claim_failed_privacy_or_pixel_measurements(self):
        case = self.case(checks={key: False for key in ("native_encoder", "independent_decoder", "structure", "appearance", "privacy")}, blockers=["avifenc exited -11"])
        report, evidence = self.diagnosed([case])
        detail = evidence[0]["diagnostics"]
        self.assertEqual(detail["native_outcome"], "failed")
        self.assertEqual(detail["measured_failures"], [])
        self.assertEqual(detail["missing_evidence"], [])
        self.assertEqual(set(detail["not_evaluated"]), {"independent_decoder", "structure", "appearance", "privacy"})
        summary = report["diagnostic_summary"]["all_cases"]
        self.assertEqual(summary["native_operation_failures"], 1)
        self.assertEqual(summary["measured_failure_cases"], 0)
        self.assertEqual(summary["failed_gates_after_native_completion"], {})

    def test_measured_failures_and_missing_evidence_can_overlap(self):
        case = self.case()
        case["checks"].update(structure=False, appearance=False)
        case["structural_checks"] = {"alpha": False, "depth": True}
        case["measurements"] = {"frames": [{"passed": False, "failures": ["ordinary_white_signal", "gamut_mapping_reference_missing"]}]}
        report, evidence = self.diagnosed([case])
        detail = evidence[0]["diagnostics"]
        self.assertEqual({failure["check"] for failure in detail["measured_failures"]}, {"alpha", "ordinary_white_signal"})
        self.assertEqual({failure["check"] for failure in detail["missing_evidence"]}, {"gamut_mapping_reference_missing"})
        summary = report["diagnostic_summary"]["all_cases"]
        self.assertEqual(summary["native_completed"], 1)
        self.assertEqual(summary["measured_failure_cases"], 1)
        self.assertEqual(summary["missing_evidence_cases"], 1)
        self.assertEqual(summary["failed_gates_after_native_completion"], {"appearance": 1, "structure": 1})
        self.assertEqual(evidence[0]["status"], "tested and failed")

    def test_missing_probes_are_not_reported_as_bad_rendered_pixels(self):
        case = self.case()
        case["checks"]["appearance"] = False
        case["measurements"] = {"frames": [{"passed": False, "failures": ["ordinary_white_probe_missing", "shadow_probe_missing"]}]}
        report, evidence = self.diagnosed([case])
        self.assertEqual(evidence[0]["diagnostics"]["measured_failures"], [])
        self.assertEqual(report["diagnostic_summary"]["all_cases"]["missing_evidence_cases"], 1)

    def test_unavailable_independent_decoder_is_an_evidence_gap(self):
        case = self.case()
        case["checks"].update(independent_decoder=False, appearance=False)
        report, evidence = self.diagnosed([case])
        detail = evidence[0]["diagnostics"]
        self.assertEqual({failure["gate"] for failure in detail["missing_evidence"]}, {"independent_decoder", "appearance"})
        self.assertEqual(detail["measured_failures"], [])
        self.assertEqual(report["diagnostic_summary"]["all_cases"]["native_operation_failures"], 0)

    def test_encoded_facts_alone_do_not_establish_measured_rejection(self):
        case = self.case(facts={"width": 57, "height": 38})
        case["checks"].update(structure=False, appearance=False)
        report, evidence = self.diagnosed([case])
        detail = evidence[0]["diagnostics"]
        self.assertEqual(detail["measured_failures"], [])
        self.assertEqual({failure["gate"] for failure in detail["missing_evidence"]}, {"structure", "appearance"})
        self.assertEqual(report["diagnostic_summary"]["all_cases"]["missing_evidence_cases"], 1)

    def test_required_summary_counts_only_exact_planned_cases(self):
        required = self.case()
        required["checks"]["appearance"] = False
        optional = self.case(case_id="optional-identity", status="qualified")
        report, evidence = self.diagnosed([required, optional])
        summary = report["diagnostic_summary"]
        self.assertEqual(summary["all_cases"]["cases"], 2)
        self.assertEqual(summary["all_cases"]["qualified"], 1)
        self.assertEqual(summary["required_cases"]["cases"], 1)
        self.assertEqual(summary["required_cases"]["qualified"], 0)
        self.assertEqual(summary["required_plan_size"], 320)
        self.assertEqual(summary["required_cases"]["native_completed"], 1)
        self.assertEqual([case["status"] for case in evidence], ["tested and failed", "qualified"])

    def test_missing_coverage_stays_unqualified_even_with_one_qualified_tuple(self):
        case = next(case for case in required_cases() if case["cell_id"] == "static-avif:hdr:avif")
        evidence = {**case, "status": "qualified", "checks": {key: True for key in ("native_encoder", "independent_decoder", "structure", "appearance", "privacy")}}
        cell = next(cell for cell in build_matrix([evidence])["cells"] if cell["id"] == case["cell_id"])
        self.assertEqual(cell["status"], "untested")
        self.assertEqual(len(cell["qualified_cases"]), 1)
        self.assertTrue(cell["missing_cases"])

    def test_failure_blocks_complete_coverage(self):
        evidence = [{"case_id": "native-failure", "cell_id": "gainmap-jpeg:hdr:jpg", "status": "tested and failed", "checks": {"native_encoder": False}, "blockers": ["Apple gain-map decode error"]}]
        cell = next(cell for cell in build_matrix(evidence)["cells"] if cell["id"] == "gainmap-jpeg:hdr:jpg")
        self.assertEqual(cell["status"], "tested and failed")
        self.assertIn("Apple gain-map decode error", cell["blockers"])
        self.assertFalse(cell["advertisable"])

    def test_case_id_without_matching_selectors_cannot_fulfill_coverage(self):
        case = next(case for case in required_cases() if case["cell_id"] == "static-avif:hdr:avif")
        evidence = {**case, "selectors": {**case["selectors"], "depth": "8"}, "status": "qualified", "checks": {key: True for key in ("native_encoder", "independent_decoder", "structure", "appearance", "privacy")}}
        report = build_matrix([evidence])
        cell = next(cell for cell in report["cells"] if cell["id"] == case["cell_id"])
        self.assertIn(case["case_id"], cell["missing_cases"])
        self.assertEqual(cell["qualified_cases"], [])
        self.assertEqual(cell["evidence"][0]["status"], "tested and failed")
        self.assertTrue(report["evidence_errors"])


class ProductCoverageTests(unittest.TestCase):
    """Aggregation rules only; these records never stand in for native proof."""

    def sdr_case(self, *, depth, qualified):
        planned = next(case for case in required_cases() if case['cell_id'] == 'static-avif:sdr:avif')
        checks = {key: True for key in ('native_encoder', 'independent_decoder', 'structure', 'appearance', 'privacy')}
        checks['appearance'] = qualified
        return {**planned, 'case_id': planned['case_id'] + (f':depth-{depth}' if depth != 8 else ''),
                'selectors': {**planned['selectors'], 'depth': str(depth)},
                'status': 'qualified' if qualified else 'tested and failed', 'checks': checks}

    def test_omitted_depth_requirement_accepts_exact_qualified_twelve_bit_evidence(self):
        failed = self.sdr_case(depth=8, qualified=False)
        passed = self.sdr_case(depth=12, qualified=True)
        report = build_matrix([failed, passed])
        coverage = report['product_coverage']
        self.assertEqual(coverage['required_count'], 320)
        self.assertEqual(coverage['qualified_count'], 1)
        item = next(item for item in coverage['requirements'] if item['coverage_case_id'] == failed['case_id'])
        self.assertNotIn('depth', item['selectors'])
        self.assertEqual(item['qualified_evidence'], [passed['case_id']])
        cell = next(cell for cell in report['cells'] if cell['id'] == failed['cell_id'])
        self.assertEqual(cell['evidence'][0]['status'], 'tested and failed')
        self.assertEqual(report['diagnostic_summary']['required_cases']['qualified'], 0)
        self.assertFalse(cell['advertisable'])

    def test_depth_flexibility_does_not_change_fixture_geometry_or_alpha_promise(self):
        for change in ({'w': 99}, {'transparency': 'coerce'}, {'motion': 'static'}):
            evidence = self.sdr_case(depth=12, qualified=True)
            evidence['selectors'].update(change)
            report = build_matrix([evidence])
            self.assertEqual(report['product_coverage']['qualified_count'], 0)

    def test_same_dimensions_do_not_substitute_contain_for_source_orientation(self):
        planned = next(case for case in required_cases()
                       if case['cell_id'] == 'gainmap-jpeg:sdr:jpg' and case['geometry'] == 'contain')
        evidence = {**planned, 'case_id': planned['case_id'] + ':alternative', 'status': 'qualified',
                    'checks': {key: True for key in ('native_encoder', 'independent_decoder',
                               'structure', 'appearance', 'privacy')}}
        report = build_matrix([evidence])
        self.assertEqual(report['product_coverage']['qualified_count'], 1)
        orientation = next(item for item in report['product_coverage']['requirements']
                           if item['fixture_id'] == planned['fixture_id']
                           and item['cell_id'] == planned['cell_id'] and item['geometry'] == 'orientation')
        self.assertEqual(orientation['qualified_evidence'], [])

    def test_webp_requirement_retains_eight_bit_depth_and_full_alpha(self):
        report = build_matrix([])
        webp = [item for item in report['product_coverage']['requirements'] if item['cell_id'] == 'animated-pq:sdr:webp']
        self.assertEqual(len(webp), 5)
        self.assertTrue(all(item['selectors']['depth'] == '8' for item in webp))
        self.assertTrue(all(item['selectors']['transparency'] == 'preserve' for item in webp))

    def test_incomplete_native_evidence_cannot_fulfill_omitted_depth_requirement(self):
        evidence = self.sdr_case(depth=12, qualified=True)
        evidence['checks']['independent_decoder'] = False
        report = build_matrix([evidence])
        self.assertEqual(report['product_coverage']['qualified_count'], 0)
        self.assertTrue(report['evidence_errors'])

    def test_other_exif_orientations_do_not_fulfill_the_six_orientation_requirement(self):
        planned = next(case for case in required_cases()
                       if case['cell_id'] == 'gainmap-jpeg:sdr:jpg' and case['geometry'] == 'orientation')
        for orientation in range(1, 9):
            with self.subTest(orientation=orientation):
                evidence = {**planned, 'case_id': planned['case_id'] + f':orientation-{orientation}',
                    'status': 'qualified', 'checks': {key: True for key in
                        ('native_encoder', 'independent_decoder', 'structure', 'appearance', 'privacy')},
                    'orientation_source': {'orientation': orientation, 'sha256': 'a' * 64}}
                report = build_matrix([evidence])
                self.assertEqual(report['product_coverage']['qualified_count'], int(orientation == 6))
                # Successful alternative orientations remain qualified for
                # their own exact cases, but cannot replace the required6.
                case = next(cell for cell in report['cells'] if cell['id'] == planned['cell_id'])['evidence'][0]
                self.assertEqual(case['status'], 'qualified')

    def test_missing_or_conflicting_source_orientation_facts_do_not_fulfill_coverage(self):
        planned = next(case for case in required_cases()
                       if case['cell_id'] == 'gainmap-jpeg:sdr:jpg' and case['geometry'] == 'orientation')
        sources = [None, {'orientation': 6},
                   {'orientation': 6, 'sha256': 'a' * 64, 'facts': {'metadata': {'IFD0:Orientation': 2}}}]
        for source in sources:
            with self.subTest(source=source):
                evidence = {**planned, 'case_id': planned['case_id'] + ':alternative', 'status': 'qualified',
                    'checks': {key: True for key in
                        ('native_encoder', 'independent_decoder', 'structure', 'appearance', 'privacy')}}
                if source is not None:
                    evidence['orientation_source'] = source
                self.assertEqual(build_matrix([evidence])['product_coverage']['qualified_count'], 0)

    def test_avif_rotation_and_mirror_must_match_the_declared_source_transform(self):
        planned = next(case for case in required_cases()
                       if case['cell_id'] == 'static-avif:hdr:avif' and case['geometry'] == 'orientation')
        for info, expected in [(' * irot (Rotation)      : 1\n', 1),
                               (' * irot (Rotation)      : 3\n', 0),
                               (' * irot (Rotation)      : 1\n * imir (Mirror) : 0\n', 0),
                               ('Transformations: None\n', 0)]:
            with self.subTest(info=info):
                evidence = {**planned, 'case_id': planned['case_id'] + ':alternative', 'status': 'qualified',
                    'checks': {key: True for key in
                        ('native_encoder', 'independent_decoder', 'structure', 'appearance', 'privacy')},
                    'orientation_source': {'sha256': 'a' * 64, 'facts': {'info': info}}}
                self.assertEqual(build_matrix([evidence])['product_coverage']['qualified_count'], expected)

    def test_duplicate_evidence_ids_cannot_provide_unambiguous_coverage(self):
        evidence = self.sdr_case(depth=12, qualified=True)
        report = build_matrix([evidence, dict(evidence)])
        self.assertEqual(report['product_coverage']['qualified_count'], 0)
        self.assertTrue(any('Duplicate' in error for error in report['evidence_errors']))

    def test_failed_measurements_override_a_green_qualification_summary(self):
        for measured in ({'passed': False, 'failures': ['shadow.delta_e_max']},
                         {'passed': False}, {'failures': ['ordinary_white_signal']}):
            with self.subTest(measured=measured):
                evidence = self.sdr_case(depth=12, qualified=True)
                evidence['measurements'] = {'frames': [measured]}
                report = build_matrix([evidence])
                self.assertEqual(report['product_coverage']['qualified_count'], 0)
                self.assertTrue(report['evidence_errors'])

    def test_a_qualified_record_with_blockers_remains_visibly_unqualified(self):
        evidence = self.sdr_case(depth=12, qualified=True)
        evidence['blockers'] = ['Required reconstruction unavailable']
        report = build_matrix([evidence])
        cell = next(cell for cell in report['cells'] if cell['id'] == evidence['cell_id'])
        self.assertEqual(cell['evidence'][0]['status'], 'tested and failed')
        self.assertEqual(cell['qualified_cases'], [])

    def test_a_planned_id_cannot_move_its_evidence_to_another_ledger_cell(self):
        evidence = self.sdr_case(depth=8, qualified=True)
        evidence['cell_id'] = 'animated-pq:sdr:avif'
        report = build_matrix([evidence])
        cell = next(cell for cell in report['cells'] if cell['id'] == evidence['cell_id'])
        self.assertFalse(cell['evidence'][0]['matches_coverage_plan'])
        self.assertEqual(report['diagnostic_summary']['required_cases']['qualified'], 0)


class ProofRequestTests(unittest.TestCase):
    def reject(self, selectors, status, facts=FACTS):
        with self.assertRaises(ProofRequestError) as caught:
            request_decision(facts, selectors)
        self.assertEqual(caught.exception.status, status)

    def test_unknown_facts_allow_only_proven_original(self):
        self.assertEqual(request_decision({}, {})["action"], "original")
        self.assertEqual(request_decision({}, {"range": "preserve", "depth": "preserve"})["action"], "original")
        self.assertEqual(request_decision({}, {"w": "32"})["action"], "metadata-pending")
        self.assertEqual(request_decision({}, {"format": "jpg"})["action"], "metadata-pending")

    def test_matching_extension_needs_only_known_format_for_noop(self):
        self.assertEqual(request_decision({"format": "jpg"}, {"format": "jpg"})["action"], "original")
        self.assertEqual(request_decision({"format": "jpg"}, {"format": "avif"})["action"], "metadata-pending")

    def test_original_bytes_and_private_metadata_are_exact(self):
        original = b"\xff\xd8EXIF:GPS=secret\x00gain-map\xff\xd9"
        delivered = exact_original(original, request_decision({}, {}))
        self.assertIs(delivered, original)
        self.assertEqual(hashlib.sha256(delivered).hexdigest(), hashlib.sha256(original).hexdigest())

    def test_transformation_cannot_be_returned_as_original(self):
        with self.assertRaises(ValueError):
            exact_original(b"native output", {"action": "candidate"})

    def test_metadata_reads_persisted_facts_without_byte_supplier(self):
        facts = {**FACTS, "map_depth": None}
        view = metadata_view(facts, [])
        self.assertEqual(view["source"], facts)
        self.assertEqual(view["capabilities"], [])
        self.assertEqual(metadata_view({}, [])["state"], "metadata-pending")

    def test_capabilities_cannot_borrow_qualification_from_other_sources(self):
        evidence = {"status": "qualified", "source_facts": {**FACTS, "depth": 8}, "selectors": {"format": "webp"}, "checks": {key: True for key in ("native_encoder", "independent_decoder", "structure", "appearance", "privacy")}}
        self.assertEqual(metadata_view(FACTS, [evidence])["capabilities"], [])

    def test_accepted_original_noop_does_not_require_encoder_depth_support(self):
        odd_source = {**FACTS, "format": "webp", "depth": 10}
        self.assertEqual(request_decision(odd_source, {"format": "webp", "range": "hdr"})["action"], "original")

    def test_matching_explicit_selectors_do_not_encode(self):
        decision = request_decision(FACTS, {"format": "avif", "range": "hdr", "gamut": "rec2020", "depth": "10", "motion": "animated", "w": "128", "h": "96"})
        self.assertEqual(decision["action"], "original")

    def test_no_hdr_fabrication_from_sdr(self):
        self.reject({"range": "hdr"}, 422, {**FACTS, "range": "sdr"})

    def test_no_silent_hdr_to_sdr_or_hdr_gif(self):
        self.reject({"format": "gif", "depth": "8", "transparency": "coerce"}, 422)
        decision = request_decision(FACTS, {"range": "sdr", "gamut": "srgb", "format": "webp", "depth": "8"})
        self.assertEqual(decision["selectors"]["range"], "sdr")
        self.assertEqual(decision["action"], "unqualified")

    def test_preserved_wide_gamut_is_not_replaced_by_srgb(self):
        decision = request_decision(FACTS, {"range": "sdr", "format": "avif"})
        self.assertEqual(decision["output_facts"]["gamut"], "rec2020")
        self.assertEqual(decision["action"], "unqualified")

    def test_omitted_depth_and_explicit_preserve_have_different_promises(self):
        selectors = {"range": "sdr", "gamut": "srgb", "format": "webp"}
        omitted = request_decision(FACTS, selectors)
        self.assertEqual(omitted["selectors"]["depth"], "auto")
        self.assertEqual(omitted["output_facts"]["depth"], 8)
        self.reject({**selectors, "depth": "preserve"}, 422)
        self.reject({**selectors, "depth": "10"}, 422)

    def test_no_quality_only_rejection_of_8_bit_hdr(self):
        decision = request_decision({**FACTS, "depth": 8}, {"w": "63", "depth": "preserve"})
        self.assertEqual(decision["action"], "unqualified")
        self.assertEqual(decision["output_facts"]["depth"], 8)

    def test_gainmap_hdr_preserve_tracks_both_depths(self):
        facts = {**FACTS, "format": "jpg", "depth": 8, "map_depth": 8, "motion": "static", "alpha": "none", "alpha_capable": False}
        hdr = request_decision(facts, {"w": "63", "depth": "preserve"})
        self.assertEqual(hdr["output_facts"]["depth"], 8)
        self.assertEqual(hdr["output_facts"]["map_depth"], 8)
        sdr = request_decision(facts, {"range": "sdr", "depth": "preserve"})
        self.assertEqual(sdr["output_facts"]["depth"], 8)
        self.assertIsNone(sdr["output_facts"]["map_depth"])
        self.assertEqual(sdr["source_facts"]["map_depth"], 8)

    def test_unknown_gainmap_depth_blocks_hdr_transform_but_not_original(self):
        source = {**FACTS, "format": "jpg", "depth": 8, "motion": "static", "alpha": "none", "alpha_capable": False}
        for facts in (source, {**source, "map_depth": None}):
            with self.subTest(facts=facts):
                decision = request_decision(facts, {"w": "63", "depth": "preserve"})
                self.assertEqual(decision["action"], "metadata-pending")
                self.assertIn("map_depth", decision["missing_facts"])
                self.assertEqual(request_decision(facts, {"format": "jpg", "depth": "preserve"})["action"], "original")
                self.assertEqual(request_decision(facts, {"w": "128", "range": "hdr", "depth": "8"})["action"], "original")

    def test_explicit_sdr_base_extraction_does_not_require_map_depth(self):
        facts = {**FACTS, "format": "jpg", "depth": 8, "map_depth": None, "motion": "static", "alpha": "none", "alpha_capable": False}
        decision = request_decision(facts, {"range": "sdr", "depth": "preserve", "w": "63"})
        self.assertEqual(decision["action"], "unqualified")
        self.assertEqual(decision["output_facts"]["depth"], 8)
        self.assertIsNone(decision["output_facts"]["map_depth"])
        self.assertIsNone(decision["source_facts"]["map_depth"])

    def test_unknown_orientation_blocks_geometry_but_not_proven_noop(self):
        source = {key: value for key, value in FACTS.items() if key != "orientation"}
        for facts in (source, {**source, "orientation": None}):
            decision = request_decision(facts, {"w": "63"})
            self.assertEqual(decision["action"], "metadata-pending")
            self.assertIn("orientation", decision["missing_facts"])
            self.assertEqual(request_decision(facts, {"format": "avif"})["action"], "original")
            self.assertEqual(request_decision(facts, {"w": "128", "h": "96"})["action"], "original")

    def test_metadata_cannot_publish_capabilities_with_missing_structural_facts(self):
        missing_map = {**FACTS, "format": "jpg", "depth": 8, "map_depth": None, "motion": "static", "alpha": "none", "alpha_capable": False}
        missing_orientation = {**FACTS, "orientation": None}
        for facts in (missing_map, missing_orientation):
            evidence = {"source_facts": facts, "status": "qualified", "checks": {key: True for key in ("native_encoder", "independent_decoder", "structure", "appearance", "privacy")}, "selectors": {"w": 63}}
            view = metadata_view(facts, [evidence])
            self.assertEqual(view["state"], "metadata-pending")
            self.assertEqual(view["capabilities"], [])
            self.assertTrue(view["original_available"])

    def test_jpeg_cannot_preserve_motion_or_alpha(self):
        self.reject({"format": "jpg", "range": "sdr"}, 422)
        self.reject({"format": "jpg", "range": "sdr", "motion": "static"}, 422)
        decision = request_decision(FACTS, {"format": "jpg", "range": "sdr", "motion": "static", "transparency": "coerce", "depth": "8"})
        self.assertEqual(decision["alpha_operation"], "drop channels without a background")
        self.assertEqual(decision["frame_selection"], "first fully composed frame")

    def test_gif_fractional_alpha_requires_explicit_coercion(self):
        self.reject({"format": "gif", "range": "sdr", "depth": "8"}, 422)
        decision = request_decision(FACTS, {"format": "gif", "range": "sdr", "depth": "8", "transparency": "coerce"})
        self.assertEqual(decision["alpha_operation"], "threshold alpha at 50 percent")

    def test_static_source_cannot_acquire_animation(self):
        self.reject({"motion": "animated"}, 422, {**FACTS, "motion": "static"})

    def test_background_is_srgb_reference_white_and_rejects_jpeg_sources(self):
        decision = request_decision(FACTS, {"transparency": "#FFFFFF", "w": "63"})
        self.assertEqual(decision["background"], {"srgb_8bit": [255, 255, 255], "hdr_white": "reference white, not peak highlight"})
        self.reject({"transparency": "#FFFFFF"}, 400, {**FACTS, "format": "jpg", "alpha_capable": False})
        opaque = {**FACTS, "alpha": "none"}
        self.assertEqual(request_decision(opaque, {"transparency": "rgb(255,255,255)"})["action"], "original")

    def test_invalid_and_conflicting_selectors_are_malformed(self):
        for selectors in ({"w": "2", "width": "2"}, {"h": "2", "height": "2"}, {"w": "0"}, {"w": "-1"}, {"quality": "90"}, {"depth": "9"}, {"transparency": "remove"}, {"transparency": "#fff"}, {"transparency": "rgb(256,0,0)"}, {"format": "jpeg"}):
            with self.subTest(selectors=selectors):
                self.reject(selectors, 400)

    def test_aliases_preserve_and_fit_modes_are_explicit(self):
        normalized = validate_selectors({"width": "37", "height": "preserve", "fit": "contain"})
        self.assertEqual(normalized["w"], 37)
        self.assertEqual(normalized["h"], "preserve")
        for fit in ("contain", "cover", "fill"):
            self.assertEqual(request_decision(FACTS, {"w": "200", "h": "200", "fit": fit})["action"], "unqualified")


if __name__ == "__main__":
    unittest.main()
