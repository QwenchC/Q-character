import json
import numpy as np
from PIL import Image
import comfy.model_management as model_management
from .vision import analyze


class QCharacterVisionReview:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"front": ("IMAGE",), "model": ("STRING", {"default": "qwen3.6:35b-a3b"}), "description": ("STRING", {"default": "", "multiline": True})},
                "optional": {"left": ("IMAGE",), "back": ("IMAGE",), "right": ("IMAGE",)}}

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    RETURN_TYPES = ("STRING",)
    FUNCTION = "review"
    CATEGORY = "Q Character"
    OUTPUT_NODE = True

    def review(self, front, model, description, left=None, back=None, right=None):
        model_management.unload_all_models()
        model_management.soft_empty_cache()
        images = {role: Image.fromarray(np.clip(tensor[0].cpu().numpy() * 255, 0, 255).astype(np.uint8))
                  for role, tensor in (("front", front), ("left", left), ("back", back), ("right", right)) if tensor is not None}
        result = analyze(images, description, model, model_management.throw_exception_if_processing_interrupted)
        text = json.dumps(result, ensure_ascii=False)
        return {"ui": {"text": [text]}, "result": (text,)}


NODE_CLASS_MAPPINGS = {"QCharacterVisionReview": QCharacterVisionReview}
NODE_DISPLAY_NAME_MAPPINGS = {"QCharacterVisionReview": "Q Character · 本地视觉一致性检查"}
