import base64
import io
import numpy as np
import easyocr
from PIL import Image
import asyncio
import logging

logger = logging.getLogger(__name__)

# Reader is stateful — loads neural net weights on first use.
# Instantiate once at module level — do NOT recreate per request.
_reader: easyocr.Reader | None = None
_reader_initialized = False


def _get_reader() -> easyocr.Reader:
    global _reader
    if _reader is None:
        # gpu=False: no CUDA required on VPS
        _reader = easyocr.Reader(["pt", "en"], gpu=False)
    return _reader


async def pre_warm_reader():
    """
    Pre-initializes the EasyOCR Reader on application startup to avoid
    cold-start delay on first OCR request. Runs in executor (background thread).
    """
    global _reader_initialized

    def _init_in_thread():
        """Initialize reader in thread to avoid blocking event loop."""
        try:
            logger.info("Starting EasyOCR Reader pre-warming...")
            reader = _get_reader()
            logger.info(f"EasyOCR Reader pre-warmed successfully. Model ready for language: ['pt', 'en']")
            return True
        except Exception as e:
            logger.error(f"Failed to pre-warm EasyOCR Reader: {e}")
            return False

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _init_in_thread)
        _reader_initialized = result
        if result:
            logger.info("EasyOCR Reader pre-warming completed successfully")
        else:
            logger.warning("EasyOCR Reader pre-warming failed, will initialize on first request")
    except Exception as e:
        logger.error(f"Error during EasyOCR Reader pre-warming: {e}")
        _reader_initialized = False


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
