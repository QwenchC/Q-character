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
        replies = [{"capabilities": ["vision"], "details": {"format": "gguf"}}, {"models": [{"name": "local"}] if preloaded else []}]
        with patch.object(vision, "_json", side_effect=replies), patch.object(vision.LOCAL_HTTP, "open", return_value=io.BytesIO(b"\n".join(json.dumps(e).encode() for e in events))) as post:
            result = vision.analyze(self.images, "用户描述", "local", interrupt)
            body = json.loads(post.call_args[0][0].data)
        self.assertEqual(len(body["messages"][0]["images"]), 3)
        self.assertEqual(body["messages"][0]["content"].count("图1=front"), 1)
        self.assertEqual(body.get("keep_alive"), None if preloaded else 0)
        return result

    def test_complete_only_and_preserve_preloaded_model(self):
        for preloaded in (True, False):
            result = self.infer([{"message": {"content": '{"findings": []}'}, "done": True}], preloaded)
            self.assertEqual(result["model"], "local")
        for events in ([{"message": {"content": '{}'}}], [{"message": {"content": '{}'}, "done": True, "done_reason": "length"}], [{"error": "out of memory"}]):
            with self.assertRaises((ValueError, RuntimeError)):
                self.infer(events)

    def test_cancellation_closes_stream(self):
        def cancel():
            raise InterruptedError("cancelled")
        with self.assertRaises(InterruptedError):
            self.infer([{"message": {"content": '{}'}, "done": True}], interrupt=cancel)


if __name__ == "__main__":
    unittest.main()
