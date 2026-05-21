import pytest
from dlp.image_ocr import extract_text_from_image

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
