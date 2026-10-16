"""Run with the ComfyUI Python: no model weights or network access required."""
import importlib.util
import io
import json
import unittest
from unittest.mock import patch
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location("vision", Path(__file__).parents[1] / "comfyui/QCharacterVision/vision.py")
vision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vision)


class AdapterTest(unittest.TestCase):
    def setUp(self):
        self.images = {r: Image.new("RGBA", (16, 32), (255, 20, 10, 0)) for r in ("front", "left", "back")}

    def test_cloud_and_nonvision_are_rejected_without_pull(self):
        with patch.object(vision, "_json", return_value={"capabilities": ["completion"], "details": {"format": "gguf"}}) as api:
            with self.assertRaises(ValueError):
                vision.analyze(self.images, "", "local")
            self.assertEqual(api.call_args[0][0], "/api/show")
            with self.assertRaises(ValueError):
                vision.analyze(self.images, "", "model-cloud")
            self.assertEqual(api.call_count, 1)

    def infer(self, events, preloaded=False, interrupt=lambda: None):
        with patch.object(vision.LOCAL_HTTP, "open", return_value=io.BytesIO(b"\n".join(json.dumps(e).encode() for e in events))) as post:
            result = vision.chat("local", list(self.images.values()), vision.prompt(["front", "left", "back"], "用户描述"), vision.SCHEMA, preloaded, interrupt)
            body = json.loads(post.call_args[0][0].data)
        self.assertEqual(len(body["messages"][0]["images"]), 3)
        self.assertEqual(body["messages"][0]["content"].count("图1=front"), 1)
        self.assertEqual(body.get("keep_alive"), None if preloaded else 0)
        return result

    def test_complete_only_and_preserve_preloaded_model(self):
        for preloaded in (True, False):
            result = self.infer([{"message": {"content": '{"findings": []}'}, "done": True}], preloaded)
            self.assertEqual(result["findings"], [])
        for events in ([{"message": {"content": '{}'}}], [{"message": {"content": '{}'}, "done": True, "done_reason": "length"}], [{"error": "out of memory"}]):
            with self.assertRaises((ValueError, RuntimeError)):
                self.infer(events)

    def test_cancellation_closes_stream(self):
        def cancel():
            raise InterruptedError("cancelled")
        with self.assertRaises(InterruptedError):
            self.infer([{"message": {"content": '{}'}, "done": True}], interrupt=cancel)

    def test_analyze_runs_independent_review_even_without_candidates(self):
        overview = {"summary": "初检", "observations": [{"role": r, "part": p} for r in self.images for p in ("hair", "clothes", "accessories")], "findings": [], "uncertainties": []}
        info = [{"capabilities": ["vision"], "details": {"format": "gguf"}}, {"models": []}]
        with patch.object(vision, "_json", side_effect=info), patch.object(vision, "chat", side_effect=[overview, {"summary": "复核", "checks": []}]) as chat:
            result = vision.analyze(self.images, "", "local")
        self.assertEqual(chat.call_count, 2)
        self.assertEqual(result["version"], 2)
        self.assertEqual(result["analysis"]["policy"], "visibility-v2")
        self.assertEqual(result["findings"], [])

    def test_structural_evidence_gates_do_not_turn_uncertainty_into_repair(self):
        base = dict(candidate_index=0, role="left", part="accessories", kind="count", title="纽扣数量", reason="对应面板上可见不同数量", reference_evidence="两个纽扣", target_evidence="三个纽扣", suggestion="移除多出的一个", confidence=.99, reference_count=2, target_count=3, bbox=[200, 200, 500, 500], reference_bbox=[200, 200, 500, 500], verdict="structural", reference_visibility="clear", target_visibility="clear", correspondence="same_component", basis="count", alternative="none", count_unit="per_component")
        candidates = [{"role": "left", "part": "accessories"}]
        for changes in [{"target_visibility": "partial"}, {"correspondence": "different_surface"}, {"alternative": "perspective"}, {"basis": "outline"}, {"count_unit": "whole_character"}, {"reference_count": 3}, {"reference_bbox": None}]:
            check = vision.review_checks([{**base, **changes}], candidates, ["front", "left", "back"])[0]
            self.assertEqual(check["verdict"], "uncertain")
            self.assertEqual(check["model_verdict"], "structural")
            self.assertTrue(check["gates"])
        real = vision.review_checks([dict(base)], candidates, ["front", "left", "back"])[0]
        self.assertEqual(real["verdict"], "structural")
        self.assertEqual(vision.finding_from_check(real, 0)["assessmentIndex"], 0)
        with self.assertRaises(ValueError):
            vision.review_checks([], candidates, ["front", "left", "back"])
        with self.assertRaises(ValueError):
            vision.review_checks([dict(base), dict(base)], candidates, ["front", "left", "back"])


if __name__ == "__main__":
    unittest.main()
