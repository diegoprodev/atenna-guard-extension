import pytest
import asyncio
from dlp.image_ocr import extract_text_from_image, pre_warm_reader

# 1×1 white PNG — minimal valid image, zero text
_BLANK_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def test_extract_text_blank_image_returns_empty_string():
    result = extract_text_from_image(_BLANK_PNG_B64)
    assert isinstance(result, str)
    assert result.strip() == ""


def test_extract_text_invalid_base64_raises_value_error():
    with pytest.raises(ValueError, match="Invalid image data"):
        extract_text_from_image("not-valid-base64!!!")


def test_extract_text_returns_string_type():
    result = extract_text_from_image(_BLANK_PNG_B64)
    assert type(result) is str


@pytest.mark.asyncio
async def test_pre_warm_reader_initializes_successfully():
    """Verify that pre_warm_reader initializes EasyOCR Reader without errors."""
    result = await pre_warm_reader()
    # pre_warm_reader doesn't return a value, but should complete without exception
    assert True


@pytest.mark.asyncio
async def test_pre_warm_reader_in_event_loop():
    """Test pre-warming in an actual asyncio event loop context."""
    # This simulates what FastAPI startup does
    await pre_warm_reader()

    # Verify that subsequent OCR calls work (Reader is initialized)
    result = extract_text_from_image(_BLANK_PNG_B64)
    assert isinstance(result, str)
