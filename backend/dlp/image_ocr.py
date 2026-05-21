import base64
import io
import numpy as np
import easyocr
from PIL import Image

# Reader is stateful — loads neural net weights on first use.
# Instantiate once at module level — do NOT recreate per request.
_reader: easyocr.Reader | None = None


def _get_reader() -> easyocr.Reader:
    global _reader
    if _reader is None:
        # gpu=False: no CUDA required on VPS
        _reader = easyocr.Reader(["pt", "en"], gpu=False)
    return _reader


def extract_text_from_image(base64_image: str) -> str:
    """
    Accepts a base64-encoded image (PNG/JPEG/WebP, with or without data-URI prefix).
    Returns all text found via OCR as a single space-joined string.
    Raises ValueError if the base64 data is malformed or not a valid image.
    """
    if "," in base64_image:
        base64_image = base64_image.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(base64_image, validate=True)
    except Exception:
        raise ValueError("Invalid image data: base64 decode failed")

    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.verify()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        raise ValueError("Invalid image data: not a recognizable image format")

    # EasyOCR requires bytes or numpy array, not PIL Image
    image_np = np.array(image)
    reader = _get_reader()
    results: list[str] = reader.readtext(image_np, detail=0)
    return " ".join(results)
